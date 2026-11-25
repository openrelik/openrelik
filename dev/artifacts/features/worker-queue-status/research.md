---
slug: worker-queue-status
issue: https://github.com/openrelik/openrelik/issues/152
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Research: Worker and queue status page

## What I wanted to know

1. How Celery, Redis, and OpenRelik's server/mediator/metrics services track workers, queues, and tasks today, and how accurately we can break down queue length by both Celery queue name and registered worker task name.
2. How active workflows are stored, queried, and filtered by folder/group ACLs, and whether Celery inspection risks exposing sensitive case data across folders.
3. How Runestone implements `MetricsView.vue`, routing, navigation, polling, and query caching, and what needs to change to extend and rename it to Status.
4. Scale and performance limits under auto-refresh, large queue backlogs, and saturated workers during heavy forensic processing.
5. Prior art: how Celery Flower monitors workers, queues, and tasks on a Redis broker (Turbinia and Timesketch skipped per user preference).

## What I found

### 1. Current OpenRelik architecture (verified against code)

Runtime versions pinned in `server/uv.lock` and compose files:
- `celery==5.6.3`, `kombu==5.6.2`, `redis==6.4.0` (`server/uv.lock`)
- Redis 8 (`compose.yml:376`, `deploy/docker/docker-compose.yml:94`)
- Production server runs single-worker Uvicorn: `uvicorn main:app ... --workers 1` (`deploy/docker/docker-compose.yml:18`)

#### Existing taskqueue endpoints (`server/src/api/v1/taskqueue.py`, `server/src/lib/celery_utils.py`)
- `server/src/api/v1/taskqueue.py:34-81` already mounts 10 endpoints under `/api/v1/taskqueue` (authenticated via `get_current_active_user` and `verify_csrf` in `server/src/main.py:198-206`):
  - `GET /tasks/registered`
  - `GET /workers/stats/`, `/workers/configurations/`, `/workers/reports/`, `/workers/ping/`
  - `GET /tasks/active/`, `/tasks/scheduled/`, `/tasks/reserved/`, `/tasks/revoked/`
  - `GET /queues/active/`
- Runestone currently calls only `GET /taskqueue/tasks/registered` (`web/runestone/src/api/endpoints/taskqueue.ts:28-30`, cached 5 min in `web/runestone/src/composables/useWorkers.ts:32-33`). None of the other 9 endpoints are used by Runestone.
- Every function in `server/src/lib/celery_utils.py:19-123` calls `celery_instance.control.inspect().<method>()` directly with default `timeout=1.0`, no caching, and no `limit`.

#### Existing metrics service (`server/src/metrics/exporter.py`, `server/src/api/v1/metrics.py`)
- `openrelik-metrics` (`server/src/metrics/exporter.py:145-164`) subscribes continuously to Celery events (`celery_app.events.Receiver` + `celery_app.events.State`) and exposes Prometheus metrics on `:8080`, scraped every 10s (`compose.yml:593`).
- `QueueMetricsCollector` (`exporter.py:81-113`) discovers active queues via `celery_app.control.inspect().active_queues()` on every Prometheus scrape, then runs Redis `LLEN <queue_name>`.
- **Existing bug found**: `QueueMetricsCollector` emits `celery_queue_length` as a `CounterMetricFamily` (`exporter.py:106`) instead of a Gauge, and `server/src/api/v1/metrics.py:123` queries `increase(celery_queue_length_total[resolution])`. Because `increase()` interprets drops in queue length as Prometheus counter resets, the existing "Total tasks in queue" and "Tasks in queue" charts do not show true queue length when queues drain.
- **Prometheus is optional**: if `PROMETHEUS_SERVER_URL` is unset, `POST /api/v1/metrics/tasks` returns `[]` (`server/src/api/v1/metrics.py:114-115`). If Prometheus is down, it raises an HTTP error (`metrics.py:66`). Live Status sections should read from Celery/Redis and Postgres directly so they still work when Prometheus is absent or down.

#### Workers, queues, and tasks (`workers/`, `compose.yml`, `deploy/docker/docker-compose.yml`)
- Workers run with `--task-events --concurrency=N -Q openrelik-worker-<name>` (`compose.yml:415-583`, `deploy/docker/docker-compose.yml:119-152`).
- **One queue frequently serves multiple registered tasks.** Verified examples:
  - `openrelik-worker-extraction`: `image_export`, `extract_archive`, `extract_files` (`workers/extraction/src/`)
  - `openrelik-worker-plaso`: `log2timeline`, `psort` (`workers/plaso/src/`)
  - `openrelik-worker-grep`: `grep`, `ugrep` (`workers/grep/src/`)
  - `openrelik-worker-analyzer-config`: 6 analyzer tasks (`workers/analyzer-config/src/`)
  - `openrelik-worker-containers`, `dfindexeddb`, `os-creds`: 2 tasks each
- **Internal non-workflow workers share the broker**: `openrelik-hashing` (`server/src/tasks/hashing/file_hashes_tasks.py:32-33`, queue `openrelik-hashing`, task `openrelik-hashing.tasks.generate_hashes`) registers without a `metadata` dict, so `get_registered_tasks()` (`server/src/lib/celery_utils.py:49-50`) skips it. It still appears in `inspect().stats()`, `inspect().active_queues()`, `inspect().active()`, and `inspect().reserved()`. After a large extraction creates thousands of files, `openrelik-hashing` can be a real queue bottleneck (`server/src/mediator/mediator.py:298-305`), so surfacing it (or distinguishing internal vs. workflow workers) is useful for operators.
- **Default prefetch multiplier is 4**: Neither `compose.yml`, `deploy/docker/docker-compose.yml`, nor worker `app.py` files (`workers/extraction/src/app.py`, `workers/plaso/src/app.py`) override `worker_prefetch_multiplier` (Celery default: 4). A worker with `--concurrency=4` pops up to `4 * 4 = 16` tasks off the Redis queue list into its local memory (`reserved`) and Redis's `unacked` hash.

---

### 2. Why queue depth and per-task breakdown are subtler than `LLEN` (high certainty; verified in Celery 5.6.3 / Kombu 5.6.2)

There are **four distinct places** a pending/running task can sit in OpenRelik:

| Stage | Where it lives | Visible via `LLEN`? | Visible via `inspect()`? | Visible in Postgres `task`? |
| --- | --- | --- | --- | --- |
| 1. Currently executing | Worker pool slot (`unacked` in Redis) | No | Yes (`active`) | Yes (`STARTED` / `PROGRESS`) |
| 2. Prefetched by worker | Worker memory (`unacked` in Redis) | No | Yes (`reserved`) | Yes (`RECEIVED` or `PENDING`) |
| 3. Waiting in broker queue | Redis list `<queue_name>` (and priority keys `<queue_name>\x06\x16{3,6,9}`) | Yes | No | Yes (`PENDING`) |
| 4. Waiting on upstream task in a chain/chord | Embedded in upstream task's Celery `callbacks`/chord header (not yet pushed to Redis) | No | No | Yes (`PENDING`) |

Two direct consequences for the Status page:

1. **The prefetch blind spot**: If a worker has `--concurrency=4` and default prefetch 4 (16 buffer slots), and an analyst queues 10 tasks, 4 are `active`, 6 are `reserved`, and `LLEN <queue_name>` is **0**. Showing only Redis `LLEN` makes a busy, backed-up worker appear to have a queue length of 0. Queue length per queue/task should either combine `broker_queued + reserved` (with a tooltip/breakdown) or show `running`, `reserved` (prefetched), and `queued` (in broker) distinctly.
2. **Per-task queue breakdown inside shared queues**:
   - `LLEN <queue_name>` only gives a total per Celery queue. It cannot split `openrelik-worker-extraction` into `image_export` vs. `extract_archive` vs. `extract_files`.
   - **Broker-queued messages** in Redis (`LRANGE <queue_name> 0 N-1`) are JSON envelopes whose top-level `headers["task"]` holds the exact Celery task name (e.g. `openrelik-worker-plaso.tasks.log2timeline`). Reading `headers["task"]` requires parsing each JSON item, which is fast for hundreds to low thousands of queued messages, but O(N) on queue size. If a queue has 50,000 items, an unbounded `LRANGE 0 -1` would stall Redis and copy tens of megabytes into the API process. A bounded scan (e.g. `LLEN` for exact queue total + `LRANGE 0 999` or `4999` to count per task name, flagging `is_truncated` / `"sampled from first N"` when `LLEN > limit`) stays safe at forensic scale.
   - **Priority keys**: Verified in `kombu.transport.redis.Channel._q_for_pri` (Kombu 5.6.2): priority 0 uses `<queue_name>` directly; priorities `3`, `6`, `9` use `<queue_name>\x06\x16{pri}`. OpenRelik does not currently pass task priorities (`workflow_utils.py:133-143`), so tasks land in `<queue_name>`, though checking priority keys via a single Redis pipeline is trivial if priorities are added later.
   - **Reserved (prefetched) tasks** from `inspect().reserved(safe=True)` already include `task["name"]` and `task["delivery_info"]["routing_key"]`, so they map cleanly to both registered task name and Celery queue name.
   - **Postgres `task` table cannot replace Redis for per-task queue counts**: `Task` (`server/src/datastores/sql/models/workflow.py:62-79`) does **not** store `task_name` or `queue_name` columns (only `display_name`; the Celery `task_name` is only inside `Workflow.spec_json`), includes un-queued downstream chain steps and dead post-failure `PENDING` tasks (see §3), and excludes non-workflow tasks like `openrelik-hashing`.

#### Worker busy / idle counts
- Verified in Celery 5.6.3: `celery.events.state.Worker` (from `worker-heartbeat` events) tracks `alive`, `active` (running count), `processed`, `loadavg`, and `pid`, **but does NOT carry pool `max-concurrency`**, `active_queues`, or `registered` task names.
- Pool concurrency comes from `inspect().stats()[worker]["pool"]["max-concurrency"]` (and `pool.processes`).
- Currently executing tasks per worker come from `inspect().active()[worker]` (each entry has `name`, `id`, `time_start`, `worker_pid`, `delivery_info.routing_key`).
- Therefore:
  - Per worker node: `busy = len(active[w])`, `concurrency = stats[w]["pool"]["max-concurrency"]`, `idle = max(0, concurrency - busy)`, `reserved = len(reserved[w])`, `queues = [q["name"] for q in active_queues[w]]`.
  - Aggregate: total online workers (nodes), total busy slots vs. total capacity slots (and busy worker nodes vs. idle worker nodes — worth distinguishing in the UI, since 1 container with `--concurrency=4` running 2 tasks is 2/4 slots busy).
  - Note: a worker container can be scaled horizontally (multiple replicas listening on the same queue, e.g. `celery@host1` and `celery@host2` both on `openrelik-worker-plaso`). Grouping or showing workers per queue handles multi-replica deployments cleanly.

---

### 3. Active workflows, zombie `PENDING` tasks, and access control (high certainty; verified in code)

#### The zombie `PENDING` workflow bug
- When a workflow runs (`server/src/lib/workflow_utils.py:122-131`, `380-434`), `create_workflow_signature()` inserts a Postgres `Task` row with `status_short="PENDING"` for **every task in the workflow DAG upfront**, including chained downstream tasks and chord callbacks.
- When an upstream task fails (`FAILURE`), Celery never dispatches downstream tasks in the chain/chord, so `mediator.py:331-360` never receives events for them. Those downstream `Task` rows remain `status_short="PENDING"` in Postgres indefinitely.
- `server/src/api/v1/workflows.py:397-420` (`get_workflow_status`) treats any non-terminal task (`status_short NOT IN {"SUCCESS", "FAILURE", "REVOKED", "REJECTED"}`) as `"RUNNING"`, which misclassifies failed chains as still running.
- Runestone's own `isActive()` (`web/runestone/src/utils/workflow.ts:147-157`) already works around this by walking `spec_json`: tasks downstream of a failed task (or a chord join whose header had a failure) are treated as `skipped` (`"won't run"`) and do not count as active.
- **Impact on the Status page**:
  - A naive SQL query `SELECT workflows with task.status_short NOT IN ('SUCCESS', 'FAILURE', 'REVOKED', 'REJECTED')` will return old failed workflows forever as "Active workflows".
  - Over months on a busy instance, those zombie rows will also grow the candidate set returned from SQL.
  - **Clean fix options**:
    1. **Minimum needed in the Status endpoint**: Query candidate workflows from SQL (joining `Task` where `status_short IS NULL OR status_short NOT IN ('SUCCESS', 'FAILURE', 'REVOKED', 'REJECTED')`, filtering `~Workflow.is_deleted` and `~Folder.is_deleted`), then apply the same DAG `isActive` check in Python (using `spec_json` + task statuses) before returning.
    2. **Better long-term companion fix (optional/separate)**: Also update `mediator.py` on `FAILURE` to mark unreachable downstream tasks as `REVOKED`/`SKIPPED`, OR filter out workflows that have a `FAILURE` task and no `STARTED`/`PROGRESS`/`RECEIVED` task and no task UUID currently in Celery active/reserved/queued. (Careful: a parallel branch in a group can still be running while a sibling branch failed, so walking `spec_json` like `utils/workflow.ts:isActive()` is the exact rule!)

#### Database indexes for active workflow lookup
- Verified in `server/src/datastores/sql/models/workflow.py:67` and `alembic/versions/056d4d155b41_initial_migration.py:365`:
  - `task.status_short` **is indexed** (`ix_task_status_short`).
  - `task.workflow_id` and `workflow.folder_id` do **not** have explicit indexes in the models or Alembic migrations (Postgres does not auto-index foreign key columns). A partial index on `task (workflow_id) WHERE status_short IS NULL OR status_short NOT IN ('SUCCESS', 'FAILURE', 'REVOKED', 'REJECTED')` (or indexing `task.workflow_id`) would keep the active-workflow lookup O(active tasks) even with millions of historical tasks.

#### Access control (`server/src/datastores/sql/crud/authz.py`)
- Workflow access is governed by `workflow.folder` (`authz.py:128-146`), checked via `check_user_access(db, current_user, [Role.VIEWER, Role.EDITOR, Role.OWNER], folder=workflow.folder)`.
- `check_user_access()` (`authz.py:99-125`) walks `folder = folder.parent` up to the root, checking `UserRole` (stopping immediately on `Role.NO_ACCESS`, line 107-108) and `GroupRole` for every group in `user.groups`.
- Because `Role.NO_ACCESS` on an intermediate folder overrides ancestor grants, SQL-only root-folder filtering would be unsafe unless it replicates ancestor traversal (e.g. recursive CTE).
- Calling `check_user_access()` per candidate active workflow is authoritative and fast **if** candidate active workflows are bounded (typically 0–50; and eager-loading `Workflow.folder`, `Workflow.tasks`, `Workflow.user`, plus `user.groups` avoids extra lazy loads). Deduplicating by `folder_id` within a single request also avoids re-checking permissions if multiple active workflows sit in the same folder, though each workflow normally has its own subfolder (`workflow_utils.py:364-367`), so memoizing `(folder_id) -> bool` while walking ancestors collapses shared parent folder lookups dramatically.

---

### 4. Forensic & sensitive data check

- **Evidence integrity / provenance**: Read-only monitoring view; never touches evidence files or modifies workflow/task state.
- **Timestamps**: Celery `time_start` on active tasks is a Unix epoch float from the worker's clock (UTC); Postgres `created_at`/`updated_at` are `DateTime(timezone=True)` (`server/src/datastores/sql/database.py:90-93`). Elapsed runtimes should be computed from UTC epochs or server time to avoid browser clock skew.
- **Sensitive data leakage (important finding!)**:
  - Today, `GET /api/v1/taskqueue/tasks/active/` and `/tasks/reserved/` (`server/src/api/v1/taskqueue.py:59-77`) are open to **any logged-in user** and return raw Celery task dicts. In OpenRelik (`workflow_utils.py:135-140`), task `kwargs` contain `input_files` (evidence filenames, paths, UUIDs), `output_path`, `workflow_id`, and `task_config` (which can contain search terms, YARA rules, regexes, or LLM prompts from other analysts' restricted cases).
  - The Status page must **not** call those raw endpoints from the browser. Instead, a dedicated server endpoint should:
    1. Return **only aggregate / operational metadata** for workers and queues (worker hostname, status, concurrency, busy/idle/reserved counts, queue names, registered task names and their running/reserved/queued counts) — zero filenames, paths, folder names, or `task_config` from inaccessible cases.
    2. Return **active workflows** strictly filtered through `check_user_access(..., VIEW_ROLES, folder=workflow.folder)` for `current_user`.
  - Worth noting separately: tightening permissions or redacting `kwargs` on the legacy `/taskqueue/tasks/*` endpoints is a good security follow-up (outside this feature's core scope, unless desired).

---

### 5. Scale & performance pitfalls (high certainty)

#### Pitfall A: `celery.control.inspect()` waits the full `timeout` on every broadcast
- Verified in `celery.app.control.Inspect._request` (Celery 5.6.3): `inspect()` broadcasts via Redis Pub/Sub (`pidbox`) with `timeout=1.0, limit=None`.
- Because `limit=None`, Celery **always blocks for the full 1.0s** waiting for unknown workers to reply, even if all workers reply in 5 ms.
- Issuing 4 sequential inspect calls (`stats`, `active`, `reserved`, `active_queues`, plus `registered`) takes **4–5 seconds** per API request.
- Under single-worker Uvicorn (`deploy/docker/docker-compose.yml:18`) with 10 analysts auto-refreshing every 15s, uncached inspect calls would generate 160–200 Redis pub/sub broadcasts/minute and hold Uvicorn threadpool slots continuously.

#### Pitfall B: Mitigating `inspect()` cost
There are three clean ways to avoid this, which can also be combined:
1. **Server-side short TTL cache + single-flight lock (3–5s)** in the API server: 20 users polling every 15s share at most one refresh every 3–5 seconds.
2. **Parallel + `limit`-targeted inspect**:
   - Run a discovery call (or reuse cached worker names, or run `stats`, `active`, `reserved`, `active_queues`, `registered` concurrently in threads with a tight timeout like `0.5s`–`1.0s`) — wall-clock drops from ~5s to ~1s (1 timeout instead of 5).
   - Or if workers are known from a first `ping()`/`stats()` (or cached list), pass `destination=workers, limit=len(workers)` to the remaining inspect calls so they return in ~10–50ms as soon as all workers reply, falling back to timeout only if a worker just died.
3. **Background event + periodic poller (Flower model)** — e.g. in `openrelik-metrics` (which already runs `celery_app.events.Receiver` + `State()` + `get_queue_lengths()`) writing a JSON status snapshot to a Redis key (`openrelik:status:snapshot` with a short TTL like 30s) every ~5s, or a background thread in `openrelik-server`.
   - **Trade-off**:
     - Putting snapshot publishing in `openrelik-metrics` makes `GET /api/v1/status` read one Redis key (~1ms, zero inspect load on API server, works identically with multiple Uvicorn workers!), **but** adds a soft dependency on `openrelik-metrics` running (fallback to on-demand cached inspect in `openrelik-server` if the Redis key is missing/stale gives the best of both worlds!).
     - Note: in `compose.yml` and `deploy/docker/docker-compose.yml`, `metrics` (`openrelik-metrics`) is a core always-on service (not behind a profile), just like `mediator`.

#### Pitfall C: Saturated workers during multi-TB forensic jobs
- In Celery's default `prefork` pool (used by OpenRelik workers), the **main process** handles `pidbox` control commands and heartbeats while **child processes** execute tasks (e.g. `log2timeline`, `image_export`, `yara`). So normally a busy worker still responds to `inspect()` even when all concurrency slots are full.
- However, under extreme host CPU/memory/I/O contention (or OOM thrashing), a worker may miss a 1.0s inspect timeout and temporarily disappear from `inspect()` replies, looking "offline".
- Keeping track of recently seen workers (e.g. from `worker-heartbeat` events or last-seen timestamp in Redis / cache) or distinguishing "online" vs "stale/unresponsive" avoids flapping workers disappearing silently during heavy load.

---

### 6. Prior art: Celery Flower

- Flower (the standard Celery monitoring UI) uses a **hybrid architecture**:
  1. **Celery Events stream (`-E` / `--task-events`)** into `celery.events.State`: tracks worker heartbeats (`online`/`offline`, `loadavg`, `processed`, `active` count) and task lifecycle events asynchronously without polling workers.
  2. **Celery `inspect` commands** (`stats`, `active_queues`, `active`, `reserved`, `registered`): used for information events don't carry (pool `max-concurrency`, queue bindings, prefetched `reserved` tasks, registered task list).
  3. **Direct Redis broker queries (`LLEN` across queue and priority keys)**: because Celery events never tell you how many unconsumed messages are sitting in Redis lists.
- Flower's UI separates:
  - **Workers table**: worker name, status (online/offline), active tasks, processed count, failed/succeeded, loadavg, concurrency.
  - **Broker / Queues table**: queue name and broker message count (`LLEN`).
  - **Tasks table**: filterable active/received/completed tasks.
- Flower does **not** break down Redis broker list counts by `task_name` out of the box (it only runs `LLEN` per queue), nor does it know about multi-tenant workflow ACLs. That is where OpenRelik's bounded `LRANGE` header scan + ACL-filtered active workflows add direct value over running Flower alongside OpenRelik.

---

### 7. Runestone integration details (`web/runestone/`)

Verified touchpoints in `web/runestone/src/`:
- **Route** (`web/runestone/src/router/index.ts:54-58`): currently `{ path: '/metrics', name: 'metrics', component: () => import('@/views/MetricsView.vue') }`. Rename to `/status` (`name: 'status'`, `StatusView.vue`) and add `{ path: '/metrics', redirect: '/status' }` so existing links/bookmarks keep working.
- **Footer navigation** (`web/runestone/src/components/layout/StatusBar.vue:107-114`): `<RouterLink to="/metrics">` labeled `metrics` → update to `to="/status"` labeled `status`.
- **UI Switcher** (`web/runestone/src/utils/uiSwitch.ts:136,152`): `normalizeCorePath` currently preserves `/metrics` when switching between Runestone and Sunstone. Sunstone still uses `/metrics` (not `/status`), so switching from Runestone `/status` to Sunstone should map `/status` → `/metrics` (or `/`), while switching from Sunstone `/metrics` to Runestone will land on `/status` via the redirect.
- **Existing `MetricsView.vue` patterns to preserve/reuse**:
  - Toolbar already has `PathBar`, page title, period/step selects, auto-refresh select (`No auto-refresh` / `15s` / `1m` / `5m`) persisted with `useRemembered`, manual `Refresh` button, and `document.hidden` + `navigator.onLine` guards (`MetricsView.vue:52-57,104-119`).
  - `MetricCard.vue` uses `useQueryCache` (`ensure()` + `queryState()`) and `useAutoRefresh`.
  - Note: `MetricCard.vue:21` keeps a module-scoped `seriesByKey` cache that isn't currently cleared in `stores/auth.ts`. Any new status store/cache (especially **active workflows**, which are user-scoped!) **must** expose a clear hook registered in `web/runestone/src/stores/auth.ts:81-116` (`setUser(null)`) to preserve Runestone's strict session-isolation guarantee (`web/runestone/AGENTS.md:71-75`).
  - Active workflow rows can reuse Runestone's existing workflow domain helpers (`src/utils/workflow.ts`, `TaskStatusBadge.vue`, `TaskRunningIcon.vue`, `workerShortName` from `src/utils/worker.ts`) and link straight to `/folder/${workflow.folder_id}`.
  - Design system fit (`web/runestone/AGENTS.md:29-39`): high-density console style, `.tabular` on all counts/durations/timestamps, `font-mono` on worker/queue/task identifiers, zero new npm dependencies.

---

## Architectural options & trade-offs

### Backend: Where live worker & queue status comes from

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| **A. Cached on-demand aggregator in `openrelik-server`** | New endpoint (e.g. `GET /api/v1/status` or `/api/v1/taskqueue/status`) runs parallel `inspect()` (`stats`, `active`, `reserved`, `active_queues`, `registered`) + Redis pipeline (`LLEN` + bounded `LRANGE` header scan), cached in-process (or Redis) for 3–5s with a single-flight lock. Active workflows queried from Postgres per user. | No changes to `openrelik-metrics` or compose/deploy; works everywhere out of the box; simple to test and reason about. | First request after cache expiry pays ~1s inspect latency; if a worker temporarily misses the 1s inspect timeout under heavy load it looks offline; per-process cache only deduplicates within 1 Uvicorn worker (fine today with `--workers 1`, or use Redis cache key to share across workers). |
| **B. `openrelik-metrics` publishes Redis snapshot + Option A fallback** | `openrelik-metrics` (already consuming Celery events + polling queues) writes a worker/queue snapshot to Redis every ~5s (`SETEX openrelik:celery_status 30 ...`). API reads it in ~1ms and falls back to Option A if missing/stale. | Sub-10ms API responses; zero `inspect()` load on Uvicorn; combines Celery event heartbeats (better offline detection) with `inspect()` concurrency/reserved data; works across multiple Uvicorn workers. | Touches two services (`metrics` + `server`); slight freshness lag (~5s) even on manual Refresh unless manual refresh triggers fallback or bypass. |

**Decision (2026-11-24)**: Go with **Option A** for now (cached on-demand aggregator in `openrelik-server` + separate per-user active-workflows endpoint). Revisit Option B later only if cache-miss inspect latency becomes noticeable in production.

### API shape: One endpoint vs. two

- **Separate user-scoped active workflows from shared cluster status** (two endpoints, e.g. `GET /api/v1/taskqueue/status` and `GET /api/v1/workflows/active`, called in parallel by Runestone):
  - Cluster worker/queue status is identical for all users → trivially cacheable in Redis with a 3–5s TTL, zero risk of accidentally caching one user's workflows and serving them to another user!
  - Active workflows are strictly per-user ACL-filtered from Postgres → fast DB query, independently refreshable, and cleanly isolated for session wipe on sign-out.
  - Both fail independently (if Redis/Celery inspect hiccups, active workflows from Postgres still render; if Prometheus is off, live Status still renders).

### UI layout: Extending Metrics → Status

- **Top summary strip** (always visible): Aggregate cards/counters — Online workers, Busy / Total slots, Active tasks, Prefetched (reserved) + Queued tasks, Your active workflows.
- **Two sections (or tabs: Live / Historical metrics)**:
  - **Live**:
    1. **Queues & tasks table** (grouped by Celery queue or flat with queue + registered task columns): Queue name, Online workers / Busy slots (`2 / 4`), Running, Reserved (prefetched), Queued in broker (with per-task breakdown when a queue has multiple tasks, plus truncation notice if > scan cap).
    2. **Workers detail** (expandable rows under each queue or separate compact table): Worker hostname, status, busy/concurrency slots, reserved count, loadavg/processed, and registered tasks.
    3. **Active workflows** (accessible to current user): Workflow/folder name (clickable link to `/folder/:id`), owner, progress (`done/total`, running/failed counts), elapsed time.
  - **Historical metrics**: The existing Prometheus `MetricCard` grid, with the `period` and `every` controls scoped to that section (so the top toolbar isn't cluttered with Prometheus-only selectors when looking at live status, while `Auto-refresh` and `Refresh` stay in the top toolbar and refresh everything).

## Open questions

1. **Internal workers (`openrelik-hashing`)**: Should internal workers without `TASK_METADATA` (currently `openrelik-hashing`) be shown in the queue/worker tables (perhaps marked `internal`), or hidden? Showing them helps diagnose post-extraction hashing backlogs.
2. **Prefetched (`reserved`) vs. broker-queued (`LLEN`)**: Should queue depth show `Queued` (broker + reserved combined) as one headline number with a breakdown tooltip, or separate `Running` / `Prefetched` / `Queued` columns?
3. **Bounded `LRANGE` cap**: Is scanning up to e.g. 2,000 queued messages per queue (falling back to exact `LLEN` + `"per-task counts from first 2,000"` when deeper) acceptable for multi-thousand-task backlogs?
4. **Zombie `PENDING` workflows**: Should we handle DAG-based filtering only in the active-workflows query, or also fix `mediator.py` to mark downstream tasks skipped/revoked when an upstream task fails?
5. **Existing Prometheus queue-length chart bug**: While extending Metrics → Status, should we leave `server/src/metrics/exporter.py` alone, or also fix `QueueMetricsCollector` (Gauge instead of Counter) as a separate bugfix?
6. **Layout**: Stacked sections on `/status` (Live status on top, Historical metrics below, collapsible) vs. tabs (`Live` / `Metrics`)?

### Suggested prototype (if needed)
- Built in `.worktrees/prototype-worker-queue-status` (`prototype/worker-queue-status`) and iterated against a live stack with `strings`, `extraction`, and `plaso` workers.

## Prototype learnings (2026-11-24)

Running the prototype under real workload (4 concurrent `log2timeline` tasks + `image_export` + multi-branch workflows + auto-refresh) uncovered several concrete technical and UX findings:

1. **Kombu pub/sub deadlock on shared `Celery` instance under parallel `inspect()`**:
   - Calling `celery_instance.control.inspect()` from 5 threads on the shared global `Celery` instance (while holding `with celery_instance.connection()` across an unbounded `_status_lock`) deadlocked Kombu's Redis pub/sub pool, leaking 17 Redis sockets, blocking all 40 AnyIO worker threads, and exhausting all 50 SQLAlchemy connections (because `get_current_user` holds a DB session until the route returns).
   - **Fix verified in prototype**: Each inspect thread creates a short-lived isolated `Celery(broker=broker_url)` with `broker_pool_limit=None` and explicit Redis `socket_timeout`/`socket_connect_timeout`, closed in `finally`. Queue scans and caching use a separate timeout-bounded `redis.from_url(...)` client, checked behind an in-memory fast path and a bounded `_status_lock.acquire(timeout=...)`. Also added `timeout=10` to `requests.get(prometheus_url)` in `server/src/api/v1/metrics.py`.

2. **`inspect().stats()` carries `uptime` and `prefetch_count`, not `loadavg`**:
   - Verified directly against live `worker-strings`, `worker-extraction`, and `worker-plaso` containers (`celery==5.6.3`). `loadavg` only arrives in `worker-heartbeat` events (and inside containers reports host `/proc/loadavg`, not per-container load). Deferred `loadavg` plotting; Workers table displays `uptime` instead.

3. **Offline queues with queued Redis backlog must be discovered via Redis `SCAN`**:
   - When `worker-plaso` was stopped while 2 `psort` tasks were still in Redis (`openrelik-worker-plaso`), `inspect().active_queues()` stopped listing that queue, hiding the backlog while Active Workflows still showed `1 queued`.
   - **Fix verified in prototype**: `scan_iter(match="openrelik-*")` discovers queue keys in Redis and includes offline queues (`workers_online=0`) whenever `LLEN > 0`, while checking `task_has_metadata.get(t) is False` (not `not .get(t, False)`) so offline queues are not mislabeled `internal`.

4. **Workflow pending tasks must distinguish `queued` (in Celery) from `waiting` (blocked on upstream)**:
   - Labeling all DB `PENDING` tasks `queued` contradicted the Celery Queues table whenever chained downstream tasks (`psort` after `log2timeline`) had not been published to Redis yet.
   - Walking `spec_json` to split `tasks_queued` (upstream all `SUCCESS` or root) from `tasks_waiting` (blocked on upstream) made workflow `running` and `queued` totals match Celery's live counts 1:1.
   - Cross-checking dispatched task UUIDs against cached Celery/Redis live IDs (with a 60s grace period and skipping queues where `LRANGE` was truncated) cleanly detects `no_worker` (in Redis for an offline queue) and `stalled` (missing from Celery and Redis after a worker crash/OOM).

5. **Storage & datastore overview (`GET /api/v1/configs/status`)**:
   - A single grouped query over `file` (`storage_provider`, `is_deleted`, `is_purged`) gives active file counts/bytes, soft-deleted unpurged Trash counts/bytes, and per-provider tracked totals in one scan, paired with `folder` (+ root), `workflow` counts, and `shutil.disk_usage()` per configured provider (never exposing raw host paths). Cached in Redis for 60s (5s cooldown on `?refresh=true`) so 15s auto-refresh does not re-scan Postgres.

6. **Runestone UX decisions validated in prototype**:
   - Replace `PathBar` prompt with `<BrandLink />` + `<h1>System status</h1>`.
   - Use `rem` font sizes everywhere (not `px`) so Runestone's `compact` / `normal` / `large` font-size presets scale the page cleanly.
   - Eliminate all `.badge` boxes in favor of calm colored inline text (matching `WorkflowSummary.vue` and `design-system.md` §1 Principle 2), with zero pulsating dots.
   - Queues start collapsed by default; collapse `Prefetched` + `Queued` + `Total waiting` into a single `Queued` column (with hover breakdown), keeping `Prefetched` in the Workers table only.
   - Replace confusing `Capacity 4/4` with `Running` (`busy/total`, red when full / amber with 1 free) in Queues/Workers and `Capacity in use` (`busy/total`, `N free`) in the summary strip.
   - Collapse Historical metrics by default so 10 Prometheus requests do not fire on every live refresh, and skip overlapping auto-refresh ticks when a live fetch is already in flight.
   - Use Runestone's `appearance-none pr-6 pl-2` + `ChevronDown` select pattern (as in `ShareDialog.vue`) for clean spacing.
   - Storage section titled `Storage` with `Files`, `Total size`, `Trash` (uncolored count + size), `Folders`, `Workflows`, and per-provider disk bar (`amber >= 80%`, `red >= 90%`, hiding redundant `server_default` key and hiding `default` tag when only one provider exists).

## Sources

- `server/src/api/v1/taskqueue.py:1-81`
- `server/src/lib/celery_utils.py:1-123`
- `server/src/api/v1/metrics.py:1-127`
- `server/src/metrics/exporter.py:1-174`
- `server/src/mediator/mediator.py:215-390`
- `server/src/api/v1/workflows.py:385-425`
- `server/src/lib/workflow_utils.py:74-145`, `380-434`
- `server/src/datastores/sql/models/workflow.py:30-101`
- `server/src/datastores/sql/crud/authz.py:45-169`
- `server/src/datastores/sql/database.py:72-205`
- `server/src/tasks/hashing/file_hashes_tasks.py:1-53`
- `server/uv.lock` (`celery==5.6.3`, `kombu==5.6.2`, `redis==6.4.0`)
- `compose.yml:120-599`, `deploy/docker/docker-compose.yml:1-173`
- `web/runestone/AGENTS.md`, `web/runestone/src/views/MetricsView.vue`, `web/runestone/src/components/metrics/MetricCard.vue`, `web/runestone/src/components/layout/StatusBar.vue`, `web/runestone/src/router/index.ts`, `web/runestone/src/utils/uiSwitch.ts`, `web/runestone/src/utils/workflow.ts`, `web/runestone/src/stores/auth.ts`
- Celery 5.6.3 & Kombu 5.6.2 installed source (`celery.app.control.Inspect._request`, `celery.events.state.Worker`, `kombu.transport.redis.Channel._q_for_pri`)
- Celery Monitoring & Management Guide / Flower docs (verified via web search, 2026-11-24)
