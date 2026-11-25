---
slug: worker-queue-status
issue: https://github.com/openrelik/openrelik/issues/152
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-25
Checks run:
- Server: `uv run --all-groups black --check` (18 touched files clean), `pytest` (612 passed)
- Database: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on PostgreSQL (`ix_task_workflow_id_non_terminal` verified)
- Runestone: `npm run format:check`, `npx prettier --check AGENTS.md`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (154 files / 1,125 tests passed, 95.65%–100% V8 line coverage on every touched runtime file), `npm run build`

What this change does: Adds three read-only status endpoints (`/api/v1/taskqueue/status`, `/api/v1/workflows/active`, and `/api/v1/configs/status`), a partial database index on non-terminal workflow tasks, and an HTTP timeout on Prometheus queries. In Runestone, it replaces `/metrics` (`MetricsView.vue`) with a live `/status` console (`StatusView.vue`) showing worker capacity, storage volumes, queues, active workflows, and collapsible historical metrics.

Assumed load: multiple Uvicorn API worker processes, 10+ browser tabs auto-refreshing `/status` every 15 seconds, concurrent Celery workers running multi-step forensic workflows over large disk images (minutes to hours per step), and large `file` and `task` tables.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: missing: returns HTTP 200 with zeroed counts instead of HTTP 503 when Redis is unreachable, and auto-refresh bypasses the 5s shared cache
- R6: missing: multi-process Redis cache hits leave live task snapshots empty or stale, and long-running chain handoffs can trigger false `stalled` flags
- R7: done
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done

## Must fix

1. **Unreachable Redis returns HTTP 200 with zeroed counts instead of 503** (`server/src/lib/celery_utils.py:L103-128, L221-241, L298-306, L431-438, L593-599`)
   - **What this is:** `get_cluster_status()` collects Celery worker state and Redis queue depths, raising `BrokerUnavailableError` (HTTP 503) when Redis cannot be reached.
   - **Problem:** `redis.from_url()` connects lazily, and every Redis or inspect failure in the function is caught and turned into an empty result (`_read_cached_status`, `_collect_inspect_snapshots`, `_discover_redis_queue_names`, `setex`). When Redis is down, `scan_queues` ends up empty so `_scan_redis_queues` returns early without calling Redis, and the route returns HTTP 200 with `workers_online: 0` (and caches it in memory for 5 seconds). The unit test at `celery_utils_test.py:L556-575` missed this because it mocked `_collect_inspect_snapshots` to return an online queue.
   - **Fix:** Ping Redis (or let `redis.exceptions.RedisError` propagate from `_read_cached_status` and `_discover_redis_queue_names`) so the `except` block at line 603 raises `BrokerUnavailableError` immediately. Update `test_get_cluster_status_raises_on_redis_unreachable` to return empty inspect snapshots.
   - **If we skip it:** During a Redis outage, operators see a healthy-looking "0 workers online" page instead of a broker error, masking the actual fault.

2. **Redis cache hits leave per-process live task snapshots empty or stale** (`server/src/lib/celery_utils.py:L299-304, L582-598, L613-626`)
   - **What this is:** `get_live_task_snapshot()` supplies active/queued Celery task UUIDs and online queues to `/api/v1/workflows/active` for `no_worker` and `stalled` detection.
   - **Problem:** `_last_live_snapshot` lives only in per-process memory while `STATUS_CACHE_KEY` is shared in Redis. With multiple Uvicorn workers, if Process A populates Redis and Process B serves `/taskqueue/status` from Redis, Process B resets `_last_collected_monotonic` without updating `_last_live_snapshot`: a cold Process B returns empty sets to `/workflows/active` (within the 1s cooldown), and a warm Process B keeps serving hours-old task UUIDs whenever Process A refreshes Redis first.
   - **Fix:** Store `live_snapshot` (`live_task_ids`, `online_queues`, `truncated_queues` as lists) inside the same Redis cache entry alongside `payload`, and restore `_last_live_snapshot` on Redis cache hits. Add a test for a Redis cache hit followed by `get_live_task_snapshot()`.
   - **If we skip it:** Under multi-process Uvicorn deployments, healthy workflows are falsely flagged as `no_worker` or `stalled` depending on which API worker handles the request.

3. **Auto-refresh bypasses the 5-second shared Redis cache** (`web/runestone/src/composables/useStatus.ts:L53-69`, `web/runestone/src/views/StatusView.vue:L142-148`)
   - **What this is:** Background polling refreshes `/status` every 15 seconds while multiple operators keep the page open.
   - **Problem:** `refreshNow(true)` passes `force: true, background: true` to `loadStatus()`, and `loadClusterStatus()` forwards `refresh: force` to `api.taskqueue.status()`. Every background poll sends `?refresh=true`, bypassing the server's 5-second Redis cache whenever 1 second has passed in that Uvicorn process.
   - **Fix:** Pass `refresh: force && !background` in `loadClusterStatus()` (matching `storageForce` on line 105) so only manual Refresh clicks send `?refresh=true`, and update `useStatus.test.ts:L146-148`.
   - **If we skip it:** Ten open status tabs trigger up to 5x more parallel Celery `inspect()` broadcasts and Redis queue scans than the 5-second cache was designed to allow.

## Should fix

4. **Long-running chained steps flash false `stalled` during handoff** (`server/src/lib/workflow_utils.py:L629-658`)
   - **What this is:** The 60-second grace window prevents flagging a newly dispatched task as `stalled` before it appears in a cached Celery/Redis snapshot.
   - **Problem:** `create_workflow_signature()` inserts `Task` rows for every step in a chain or chord at workflow start (`t = 0`). When Step 1 runs for 10 minutes (typical for forensic disk workers) and succeeds, Step 2's own `updated_at` is still 10 minutes old, so if `/workflows/active` runs against a 5-second cached `live_task_ids` snapshot before Step 2 is scanned, `_task_age(step2)` exceeds 60 seconds and marks the workflow `stalled`.
   - **Fix:** Compute the grace-period age from the most recent `updated_at` (or `created_at`) across all tasks in the workflow rather than only the pending step's timestamp, and add a unit test for a chain handoff after 60 seconds.
   - **If we skip it:** Healthy multi-step forensic workflows flash red `stalled` alerts whenever a slow step finishes and hands off to the next step.

5. **Focus and auto-refresh abort in-flight loads instead of joining them** (`web/runestone/src/views/StatusView.vue:L122-128, L171-174`)
   - **What this is:** `StatusView.vue` keeps an `AbortController` so pending requests cancel when the user leaves `/status`.
   - **Problem:** `fetchLive()` aborts the shared controller on every call, including tab focus (`useAutoRefresh`) and 15-second auto-refresh. If `GET /configs/status` is still running (for example, a cold scan on a large `file` table) when the user switches windows back or a 15-second tick fires, `controller.abort()` cancels the running storage request and makes `useQueryCache` restart it from scratch.
   - **Fix:** Create a single `const controller = new AbortController()` for the view instance and abort it only in `onUnmounted()`. `useQueryCache.ensure()` already deduplicates concurrent calls per key.
   - **If we skip it:** Slow storage scans or initial loads get aborted and restarted whenever the window regains focus or auto-refresh ticks.

6. **Queue rows cannot be expanded with the keyboard** (`web/runestone/src/components/status/QueueStatusTable.vue:L76-94`)
   - **What this is:** Each queue row expands to show per-task running and queued counts.
   - **Problem:** Expanding is wired only to `@click` on `<tr>`, with no `<button>`, `tabindex`, or `aria-expanded`. Keyboard-only operators cannot open any queue row, violating Runestone's keyboard-first rule in `web/runestone/AGENTS.md`.
   - **Fix:** Wrap the chevron and queue name in a `<button type="button" :aria-expanded="expanded.has(queue.name)" @click.stop="toggleQueue(queue.name)">`, keeping the row `@click` handler for mouse clicks.
   - **If we skip it:** Operators navigating by keyboard cannot inspect per-task counts inside collapsed queues.

## Nice to have

7. **Reuse `count()` for queue and volume counts** (`web/runestone/src/components/status/QueueStatusTable.vue:L51`, `web/runestone/src/components/status/SystemStorageSection.vue:L49-50`)
   - **What this is:** Section headers show how many queues and storage volumes are loaded.
   - **Problem:** `QueueStatusTable.vue` displays `"1 queues"` when one queue exists, and `SystemStorageSection.vue` repeats singular/plural logic that `@/utils/format` already provides via `count()`.
   - **Fix:** Use `count(queues.length, 'queue')` and `count(storage.storage_providers.length, 'volume')`.
   - **If we skip it:** A single queue renders with a minor grammar mismatch ("1 queues").

8. **Remove leftover `uiSwitch` reference in spec** (`dev/artifacts/features/worker-queue-status/spec.md:L65`)
   - **What this is:** The Tests section of `spec.md` lists verification checks for R9–R12.
   - **Problem:** Line 65 still mentions `uiSwitch /status -> /metrics mapping`, even though R9 (line 34) and T9/T10 note that `uiSwitch.ts` was removed in #146.
   - **Fix:** Remove that phrase from line 65 of `spec.md`.
   - **If we skip it:** Future readers of the spec see a stale reference to a deleted module.

Verdict: fix 1, 2, 3, 4, 5, and 6 first.
Lean: -4 lines possible (single view-level `AbortController` in `StatusView.vue`, `count()` helper in `SystemStorageSection.vue`).
Not checked: Live end-to-end visual rendering on the running Docker stack and Slow 4G/Offline network behavior in Chrome DevTools (read-only review).

---

# Review Round 2

Date: 2026-11-25
Commit: `48d9293`
Checks run:
- Server: `uv run --all-groups black --check` clean, `pytest` (614 passed)
- Database: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on PostgreSQL (`ix_task_workflow_id_non_terminal` verified)
- Runestone: `npm run format:check`, `npx prettier --check AGENTS.md`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (154 files / 1,125 tests passed, 95.65%–100% V8 line coverage on every touched runtime file), `npm run build`

What this change does: Adds a live System status page (`/status`, replacing `/metrics`) in Runestone backed by three new server endpoints: `GET /api/v1/taskqueue/status` (Celery worker, queue, and backlog snapshot), `GET /api/v1/workflows/active` (DAG-aware active workflows filtered by folder permissions), and `GET /api/v1/configs/status` (datastore totals and storage volume disk usage). It also adds a partial database index on non-terminal workflow tasks and a 10-second timeout on Prometheus range queries.

Assumed load: Multiple Uvicorn server processes, 10+ open browser tabs auto-refreshing every 15 seconds, concurrent Celery workers running multi-hour forensic workflows over large disk images, and large `file` and `task` tables.

## Requirements
- R1: partial (isolated inspect apps drop `visibility_timeout`; non-list `openrelik-*` Redis keys trigger HTTP 503; see findings 1 and 2)
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: partial (per-provider `file_count` and `file_bytes` ignore `Folder.storage_provider`; see finding 3)
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done

## Must fix

1. **Isolated inspect apps reset `visibility_timeout` to 1 hour and can redeliver long-running forensic tasks** (`server/src/lib/celery_utils.py:L189-195`)
   - **What this is:** `_collect_inspect_snapshots` creates five short-lived `Celery` instances per status refresh so `inspect()` calls run in parallel without fighting over one connection pool.
   - **Problem:** Those temporary `Celery` instances do not call `configure_celery_app` and overwrite `broker_transport_options` without `visibility_timeout`, falling back to Kombu's 1-hour (3600s) default. Because each inspect call opens a fresh direct reply-queue consumer (`_vrestore_count == 0`), hitting the 1-second inspect timeout triggers Kombu's `restore_visible()` sweep against Redis `unacked_index` with a 1-hour cutoff, overriding OpenRelik's 24-hour protection in `libs/common/openrelik_common/celery_utils.py`.
   - **Fix:** Configure each temporary app with `configure_celery_app(Celery(broker=broker_url))` (from `openrelik_common.celery_utils`) and merge `socket_timeout` and `socket_connect_timeout` into its existing `broker_transport_options` dict. Assert `visibility_timeout` is kept in `test_collect_inspect_snapshots_uses_isolated_celery_apps`.
   - **If we skip it:** Any cluster running a worker with prefetch enabled (`OPENRELIK_CELERY_WORKER_DISABLE_PREFETCH=false`) or an older worker image on a multi-hour disk-image task will have tasks swept and redelivered in a loop once someone opens `/status`.

2. **Non-list Redis keys starting with `openrelik-` break `/taskqueue/status` with HTTP 503** (`server/src/lib/celery_utils.py:L107-140`)
   - **What this is:** `_discover_redis_queue_names` scans Redis for keys matching `openrelik-*` to find offline queues that still hold queued tasks, and `_scan_redis_queues` pipelines `LLEN` across all of them.
   - **Problem:** Other parts of OpenRelik store non-list keys (Redis strings) in the same Redis database, including NBD mount locks (`f"{hostname}-/dev/nbd0"` in `libs/worker-common/openrelik_worker_common/mount_utils.py:L293`, which matches `openrelik-*` on any node named `openrelik-*`) and Timesketch sketch locks (`workers/timesketch/src/tasks.py:L114`). Running `pipe.llen()` on a string key raises `redis.exceptions.ResponseError` (`WRONGTYPE`), which `get_cluster_status` catches as `RedisError` and turns into `BrokerUnavailableError` (HTTP 503).
   - **Fix:** Run `pipe.execute(raise_on_error=False)` in `_scan_redis_queues` (both the `LLEN` and `LRANGE` pipelines) and skip entries that are `redis.exceptions.ResponseError` (connection and timeout errors still raise and return 503). Optionally filter with `_type="list"` in `scan_iter` where the client supports it, and add a unit test in `celery_utils_test.py` covering a `WRONGTYPE` key.
   - **If we skip it:** Mounting a disk image on an `openrelik-*` host or locking an `openrelik-*` sketch takes down the Status page's worker/queue feed and disables workflow stall detection for hours.

3. **Per-provider file counts and bytes misattribute files stored on non-default storage providers** (`server/src/datastores/sql/crud/status.py:L153-189`)
   - **What this is:** `get_system_storage_status_from_db` groups rows in `file` by `File.storage_provider` and falls back to `default_provider` when `File.storage_provider` is `NULL`.
   - **Problem:** Uploaded files and worker outputs never set `File.storage_provider` (`schemas.FileCreate` has no such field); they leave it `NULL` and inherit their volume from `Folder.storage_provider` up the folder tree (see `File.path` in `server/src/datastores/sql/models/file.py:L209-227` and `Folder.get_effective_storage_provider`). On any deployment with a second read-write provider (such as `extra_storage` in `settings_example.toml`), files inside folders created on that provider are counted under the default provider while the second provider shows `0 (0 B)`.
   - **Fix:** Build a small recursive CTE over `folder` to resolve each folder's effective storage provider (falling back to `"server_default"` if configured, else `default_provider`), left-join `file` to it on `File.folder_id`, and group by `COALESCE(File.storage_provider, folder_provider, default_provider)`. Add a test in `status_test.py` with a file whose `storage_provider` is `NULL` inside a subfolder of a non-default root folder.
   - **If we skip it:** Operators on multi-volume installations see `0 (0 B)` tracked files on secondary volumes right beside a nearly full disk usage bar, and changing `default` in `settings.toml` shifts historical file totals onto the wrong volume.

## Nice to have

4. **Redis cache hit resets local cache age to zero across Uvicorn workers** (`server/src/lib/celery_utils.py:L311-318`)
   - **What this is:** When a server process with an empty in-memory cache reads a snapshot from Redis, it stores that snapshot locally and updates `_last_collected_monotonic = time.monotonic()`.
   - **Problem:** If Process A cached a snapshot 4.5 seconds ago and Process B reads it from Redis, Process B treats it as 0 seconds old, serving it for up to 9.5 seconds total and ignoring `?refresh=true` for another second.
   - **Fix:** Store a Unix timestamp (`time.time()`) in the Redis cache envelope and set `_last_collected_monotonic = time.monotonic() - max(0.0, time.time() - cached_ts)` on a Redis hit.
   - **If we skip it:** Under multi-worker Uvicorn, snapshots can stay a few seconds staler than the 5-second TTL and a manual refresh right after a Redis cache hit can be throttled for up to 1 second.

5. **Section Retry buttons do not abort on route leave** (`web/runestone/src/views/StatusView.vue:L128-138`)
   - **What this is:** `retryCluster`, `retryWorkflows`, and `retryStorage` re-request a single failed feed when the user clicks Retry.
   - **Problem:** Unlike `fetchLive`, these three helpers do not pass `signal: controller.signal`, so navigating away from `/status` right after clicking Retry leaves those requests running on slow connections.
   - **Fix:** Pass `signal: controller.signal` in all three retry functions.
   - **If we skip it:** Retried requests finish in the background after leaving `/status`, using a small amount of bandwidth on slow links.

Verdict: fix 1, 2, and 3 first.
Not checked: Live multi-worker stack execution against real Redis, Celery workers, and PostgreSQL (automated test suites, coverage, production build, and Alembic upgrade/downgrade were reported passing on `48d9293`).

---

# Review Round 3

Date: 2026-11-25
Commit: `9b5be5d`
Checks run:
- Server: `uv run --all-groups black --check` clean, `pytest` (616 passed)
- Database: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on PostgreSQL (`ix_task_workflow_id_non_terminal` verified)
- Live stack smoke test: `GET /api/v1/taskqueue/status?refresh=true` and `GET /api/v1/configs/status?refresh=true` succeeded against live Redis and PostgreSQL
- Runestone: `npm run format:check`, `npx prettier --check AGENTS.md`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (154 files / 1,125 tests passed, 95.65%–100% V8 line coverage on every touched runtime file), `npm run build`

What this change does: Adds three read-only status API endpoints covering Celery workers and queues (`GET /api/v1/taskqueue/status`), accessible active workflows (`GET /api/v1/workflows/active`), and datastore and disk usage (`GET /api/v1/configs/status`), backed by a partial database index on non-terminal tasks and a 10-second timeout on Prometheus queries. Replaces Runestone's `/metrics` page with a live `/status` view (redirecting `/metrics` to `/status`) that polls these feeds independently, collapses queues and historical Prometheus charts by default, and wipes cached status data on sign-out.

Assumed load: multiple Uvicorn server processes, 10 or more browser tabs auto-refreshing every 15 seconds, concurrent Celery workers running long multi-step forensic workflows over large disk images, and large `file` and `task` tables.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: partial: the 5-second refresh cooldown is tracked only in process memory and is bypassed across multiple Uvicorn workers (see finding 1)
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done

## Should fix

1. **Storage refresh cooldown is bypassed across Uvicorn workers** (`server/src/datastores/sql/crud/status.py:L125-148`)
   - **What this is:** `get_system_storage_status_from_db()` caches datastore and disk counts in Redis for 60 seconds and enforces a 5-second cooldown on `?refresh=true` to avoid repeated full scans of the `file` table and recursive `folder` tree.
   - **Problem:** The cooldown compares `time.monotonic()` against a process-local variable `_last_collected_monotonic` that starts at `0.0` and is never updated when serving a Redis cache hit. When multiple Uvicorn workers run, Worker 1 populates Redis and updates its own timer, while Workers 2 through N keep `_last_collected_monotonic` at `0.0`; a `?refresh=true` request hitting any other worker skips reading Redis and runs a full `file` table scan immediately.
   - **Fix:** Read `_read_cached_storage_status(client)` before deciding whether to bypass, and if `cached` exists, parse its `collected_at` UTC timestamp and return `cached` whenever `not refresh` or the cached age is under `STORAGE_REFRESH_COOLDOWN_SECONDS` (both before and inside `_storage_lock`). Add a multi-worker cooldown test in `server/src/tests/datastores/status_test.py` where Redis already holds a recent snapshot and `_last_collected_monotonic` is `0.0`.
   - **If we skip it:** Manual refreshes or concurrent operators clicking Refresh can trigger redundant full `file` and `folder` table scans on Postgres from each Uvicorn worker within the 5-second cooldown window.

Verdict: fix 1 first.
Not checked: live multi-worker Uvicorn behavior and runtime execution of the test suites (relied on the automated check results reported for HEAD `9b5be5d`).

---

# Review Round 4

Date: 2026-11-25
Commit: `bd8c71e`
Checks run:
- Server: `uv run --all-groups black --check` clean, `pytest` (616 passed)
- Database: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on PostgreSQL (`ix_task_workflow_id_non_terminal` verified)
- Live stack smoke test: `GET /api/v1/taskqueue/status?refresh=true` and `GET /api/v1/configs/status?refresh=true` succeeded against live Redis and PostgreSQL
- Runestone: `npm run format:check`, `npx prettier --check AGENTS.md`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (154 files / 1,125 tests passed, 95.65%–100% V8 line coverage on every touched runtime file), `npm run build`

What this change does: Adds three read-only status API endpoints (`GET /api/v1/taskqueue/status`, `GET /api/v1/workflows/active`, and `GET /api/v1/configs/status`), a partial database index on non-terminal workflow tasks, and a 10-second timeout on Prometheus queries. Replaces Runestone's `/metrics` page with a live `/status` view (redirecting `/metrics` to `/status`) showing worker capacity, storage volumes, queues, active workflows, and collapsible Prometheus charts.

Assumed load: multiple Uvicorn API workers serving 10+ auto-refreshing browser tabs every 15 seconds while Celery workers run long multi-step forensic workflows over large disk images, with large `file` and `task` tables.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: partial: the 1-second `?refresh=true` cooldown is checked only against process-local time, not the shared Redis snapshot timestamp (see finding 1)
- R6: done
- R7: done
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done

## Should fix

1. **Manual refresh cooldown does not work across multiple API workers** (`server/src/lib/celery_utils.py:L314-348`)
   - **What this is:** `get_cluster_status` caches the cluster snapshot in Redis for 5 seconds and limits `?refresh=true` requests to once per second so repeated refreshes do not flood Celery workers with inspect broadcasts.
   - **Problem:** When `refresh=True`, the function checks only the process-local `_last_collected_monotonic` clock and skips `_read_cached_status(redis_client)` whenever `can_bypass` is true. If two `?refresh=true` requests arrive 200 ms apart on different Uvicorn worker processes, the second worker ignores the `collected_ts` already stored in Redis and runs all five Celery `inspect()` broadcasts and the Redis queue scan again.
   - **Fix:** Always call `_read_cached_status(redis_client)` inside the lock and remove the `else: redis_client.ping()` branch (the Redis `GET` already verifies broker reachability). Return the cached payload and warm the local cache when `not refresh` or when `time.time() - cached_ts < STATUS_REFRESH_COOLDOWN_SECONDS` (treating a missing `cached_ts` as expired on `refresh=True`), matching `server/src/datastores/sql/crud/status.py`, and add a unit test for a cold worker receiving `refresh=True` inside the 1-second window.
   - **If we skip it:** On multi-worker deployments, repeated manual refreshes or multiple operators clicking Refresh bypass the 1-second cooldown and multiply Celery `inspect()` broadcasts across every API worker process.

Verdict: fix 1 first.
Not checked: Live execution of tests, migrations, and multi-worker load against Docker services (relied on the automated check results reported for `bd8c71e` because this review is read-only).

---

# Review Round 5

Date: 2026-11-25
Commit: `80e84e2`
Checks run:
- Server: `uv run --all-groups black --check` clean, `pytest` (616 passed)
- Database: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on PostgreSQL (`ix_task_workflow_id_non_terminal` verified)
- Live stack smoke test: `GET /api/v1/taskqueue/status?refresh=true` and `GET /api/v1/configs/status?refresh=true` succeeded against live Redis and PostgreSQL
- Runestone: `npm run format:check`, `npx prettier --check AGENTS.md`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (154 files / 1,125 tests passed, 95.65%–100% V8 line coverage on every touched runtime file), `npm run build`

What this change does: Replaces Runestone's `/metrics` page with a live System status console at `/status` (redirecting `/metrics` to `/status`) backed by three read-only server endpoints: `GET /api/v1/taskqueue/status`, `GET /api/v1/workflows/active`, and `GET /api/v1/configs/status`. It adds a partial database index on non-terminal workflow tasks, a `timeout=10` guard on Prometheus range queries, shared Redis caching with cross-worker refresh cooldowns, and DAG-aware active workflow and stall detection filtered by folder permissions.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done

Verdict: LGTM

Checked the full diff (`origin/main..80e84e2`), all 44 touched files, connected backend callers and models (`main.py`, `authz.py`, `folder.py`, `file.py`, `database.py`, `libs/common/openrelik_common/celery_utils.py`), connected Runestone modules (`useQueryCache.ts`, `useAutoRefresh.ts`, `MetricCard.vue`, `LoadState.vue`, `workflowSpec.ts`), Apache 2.0 headers, Alembic revision chaining, and behavior under an assumed load of multiple Uvicorn workers, 10+ browser tabs auto-refreshing every 15s, concurrent Celery workers running long multi-step forensic workflows over large disk images, and large `file` and `task` tables.

Not checked: did not re-run pytest, Alembic, Vitest, or live stack smoke tests in this read-only pass; relied on the automated check results reported for `80e84e2`.
