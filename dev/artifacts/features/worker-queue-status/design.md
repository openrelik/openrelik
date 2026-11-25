---
slug: worker-queue-status
issue: https://github.com/openrelik/openrelik/issues/152
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Design: Worker and queue status page

## Summary

Replace Runestone's `/metrics` view with a **System status** page at `/status` (redirecting `/metrics` to `/status`) that shows live Celery worker and queue state, active workflows the current user can access, storage volume and datastore counts, and the existing Prometheus historical metrics charts in a collapsible section. Three new read-only server endpoints back the live view without requiring Prometheus or exposing cross-case task arguments.

## Background

Today, Runestone's `MetricsView.vue` only displays historical Prometheus counters aggregated across all tasks and queues. When workflows slow down or tasks stay pending, analysts and operators cannot tell from the UI whether workers are busy, idle, or offline, which queues or tasks are backed up, or whether storage volumes are running low on disk space.

Research and prototyping on `prototype/worker-queue-status` highlighted five constraints that shape the design:

1. **Prefetch blind spot and shared queues**: Workers use Celery's default `worker_prefetch_multiplier=4`, so `LLEN` misses tasks already claimed into worker memory (`reserved`). Several queues also serve multiple registered tasks (`extraction`, `plaso`, `grep`, `analyzer-config`), so per-task backlog requires reading JSON `headers["task"]` from Redis `LRANGE` with an upper bound (`2000` messages per queue) alongside exact `LLEN`.
2. **Offline queues with backlog**: When a worker stops while tasks remain in Redis, `celery.control.inspect().active_queues()` stops reporting that queue. Discovering `openrelik-*` keys via `SCAN` surfaces offline queues whenever `LLEN > 0`.
3. **Inspect concurrency deadlock**: Calling `celery_instance.control.inspect()` concurrently from multiple threads on the shared global `Celery` app deadlocked Kombu's Redis pub/sub pool under load, blocking FastAPI's worker threads and exhausting the SQLAlchemy pool via `get_current_user`. Isolating each parallel `inspect()` call in a short-lived `Celery` instance (`broker_pool_limit=None`, explicit socket timeouts) with an in-memory + Redis TTL cache and a bounded lock eliminates this failure mode.
4. **Workflow pending split and zombies**: `workflow_utils.run_workflow()` creates Postgres `Task` rows (`PENDING`) for every node in the DAG upfront. Downstream tasks after a failed upstream task stay `PENDING` forever, and chained downstream tasks are not yet in Redis until their upstream step succeeds. Walking `spec_json` excludes unreachable post-failure tasks, splits `tasks_queued` (in Celery) from `tasks_waiting` (blocked on upstream), and cross-checks live Celery/Redis task UUIDs to flag `no_worker` or `stalled` workflows.
5. **Sensitive data isolation**: Existing `/api/v1/taskqueue/tasks/active/` and `/tasks/reserved/` endpoints return raw Celery `kwargs` (`input_files`, paths, `task_config`) across all users' folders. The Status page must only consume aggregated cluster counts plus per-user ACL-filtered active workflows.

## Proposal

### User interface (Runestone only)

- **Route and navigation**: `/status` (`StatusView.vue`), with `/metrics` redirecting to `/status`. Footer link in `StatusBar.vue` changes from `metrics` to `status`. `uiSwitch.ts` maps `/status` to `/metrics` when switching to Sunstone.
- **Top bar**: `<BrandLink />` + `<h1>System status</h1>` (omitting `PathBar`'s inline prompt), last snapshot UTC timestamp, `appearance-none` Auto-refresh selector (`No auto-refresh`, `15s`, `1m`, `5m`), and manual `Refresh` button.
- **Calm console layout**: Zero `.badge` boxes and zero pulsating dots across the page; all states render as calm inline colored text matching `WorkflowSummary.vue` and `design-system.md`. All typography uses `rem` units so Runestone's `compact` / `normal` / `large` font-size presets scale cleanly.
- **Sections top to bottom**:
  1. **Summary strip**: `Online workers` (busy/idle breakdown), `Capacity in use` (`busy/total`, `N free`, red when full and amber with 1 free), `Running tasks`, `Queued tasks` (with prefetched/broker split when prefetched > 0), `Active workflows`.
  2. **Queues and registered tasks**: Collapsed by default; columns `Queue / Task | Workers | Running | Queued`. Queue rows merge capacity into `Running` (`busy/total`, red/amber thresholds) and combine broker + prefetched into `Queued` (with hover breakdown). Expanding a queue reveals each registered task's `running` and `queued` counts. Offline queues with backlog show `offline` and `0` workers in red; internal workers (`openrelik-hashing`) show muted `internal`.
  3. **Active workflows**: Accessible active workflows linking to `/folder/:folderId`, owner, `·`-separated inline progress (`done/total`, amber `running`, `queued` with offline-queue tooltip when `no_worker`, muted `waiting`, red `failed`, red `stalled`), elapsed duration, and last updated UTC timestamp.
  4. **Workers**: Online worker hostnames, state (muted `idle`, amber `busy`), queues, `Running` (`busy/total`, red/amber thresholds), `Prefetched`, `Processed`, and `Uptime`.
  5. **Storage**: Aggregate row (`Files`, `Total size`, uncolored `Trash` count + bytes for soft-deleted unpurged files, `Folders` + root count, `Workflows`) and a per-provider table (`Storage provider`, `Mode`, `Files`, `Disk used` bar colored amber at >=80% and red at >=90%, `Free`). Redundant config keys (`server_default`) stay in hover tooltips; `default` is only shown when multiple providers are configured.
  6. **Historical metrics**: Collapsed by default; preserves all 10 Prometheus `MetricCard` charts and their `period`/`every` selectors, skipped during auto-refresh while collapsed.

### API endpoints

Splitting cluster status, active workflows, and storage status into three focused endpoints keeps caching scopes separate (never caching user-scoped workflows in a shared Redis key), allows independent failure/retry, and lets storage use a longer cache TTL than live queues:

- `GET /api/v1/taskqueue/status?refresh=false` -> `TaskqueueStatusResponse` (5s Redis + in-memory TTL cache, 1s refresh cooldown)
- `GET /api/v1/workflows/active` -> `list[ActiveWorkflowResponse]` (per-user ACL filtered via `check_user_access`)
- `GET /api/v1/configs/status?refresh=false` -> `SystemStorageStatusResponse` (60s Redis TTL cache, 5s refresh cooldown)

## Technical design

### Server (`server/src/`)

- **`api/v1/schemas.py`**: Pydantic models `TaskqueueStatusSummary`, `QueueTaskStatus`, `QueueStatus`, `WorkerStatus`, `TaskqueueStatusResponse`, `ActiveWorkflowResponse`, `StorageProviderStatus`, and `SystemStorageStatusResponse`.
- **`lib/celery_utils.py` & `api/v1/taskqueue.py`**:
  - `get_cluster_status(celery_instance, *, refresh=False)` runs parallel `inspect(timeout=1.0)` calls (`stats`, `active`, `reserved`, `active_queues`, `registered("metadata")`) using isolated per-thread `Celery` apps (`broker_pool_limit=None`, explicit Redis socket timeouts), discovers offline `openrelik-*` queues via `scan_iter`, pipelines `LLEN` and bounded `LRANGE 0 1999` across Kombu priority keys (`0, 3, 6, 9`), and aggregates without copying raw `args`/`kwargs`/`input_files`/`task_config`.
  - Caches the snapshot in memory and in Redis (`openrelik:taskqueue:status:v1`, 5s TTL) behind a timeout-bounded lock, and stores an internal live-task snapshot (`live_task_ids`, `online_queues`, `truncated_queues`) exposed via `get_live_task_snapshot()`.
- **`lib/workflow_utils.py`, `datastores/sql/crud/workflow.py`, & `api/v1/workflows.py`**:
  - `get_candidate_active_workflows_from_db(db)` queries non-deleted workflows in non-deleted folders that have at least one non-terminal `Task` (`status_short IS NULL OR status_short NOT IN ('SUCCESS', 'FAILURE', 'REVOKED', 'REJECTED')`), eager-loading `tasks`, `user`, and `folder`.
  - `summarize_workflow_tasks(spec_json, tasks, ...)` walks the workflow tree to exclude post-failure skipped tasks, split `tasks_queued` vs. `tasks_waiting`, and cross-check dispatched UUIDs against `get_live_task_snapshot()` (60s grace window, skipping truncated queues) to set `stall_reason` (`"no_worker"`, `"stalled"`, or `None`).
  - `GET /api/v1/workflows/active` filters via `check_user_access(db, current_user, VIEW_ROLES, folder=workflow.folder)` with per-request folder memoization.
- **`datastores/sql/models/workflow.py` & Alembic**: Add partial index `ix_task_workflow_id_non_terminal` on `task (workflow_id)` for non-terminal task states (`postgresql_where` and `sqlite_where`).
- **`datastores/sql/crud/status.py` & `api/v1/configs.py`**:
  - `get_system_storage_status_from_db(db, *, refresh=False)` runs a single grouped scan over `file` (`storage_provider`, `is_deleted`, `is_purged`), counts `folder` (total and root) and `workflow`, calls `shutil.disk_usage()` on each configured storage provider path (without returning the path), and caches in Redis (`openrelik:system:storage_status:v1`, 60s TTL).
- **`api/v1/metrics.py`**: Add explicit `timeout=10` to `requests.get(prometheus_url, ...)`.

### Web UI (`web/runestone/src/`)

- **API & state**: DTO types in `api/types.ts`, endpoints in `api/endpoints/{taskqueue,workflows,configs}.ts`, and `composables/useStatus.ts` using `useQueryCache` (`status:taskqueue`, `status:workflows`, `status:storage` keys; `5s` / `5s` / `60s` stale windows). `clearStatus()` is called from `stores/auth.ts` on sign-out / 401 so user-scoped active workflows never leak across sessions.
- **Components & view**: `views/StatusView.vue` replacing `MetricsView.vue`, composed of `components/status/{StatusSummaryStrip,QueueStatusTable,ActiveWorkflowsTable,WorkerStatusTable,SystemStorageSection}.vue` plus existing `components/metrics/MetricCard.vue`.
- **Routing & UI switcher**: `router/index.ts` (`/status` + `/metrics` redirect), `components/layout/StatusBar.vue`, and `utils/uiSwitch.ts` (`/status` -> `/metrics` for Sunstone).

## Alternatives considered

- **Event-driven snapshot publisher in `openrelik-metrics` (Option B in `research.md`)**: Having `openrelik-metrics` publish periodic worker/queue snapshots to Redis would give ~1ms API reads and include heartbeat `loadavg`, but couples live Status to a second service and adds stale-heartbeat cleanup complexity. On-demand cached aggregation in `openrelik-server` (Option A) works standalone with zero new service coupling and can be replaced behind the same `/api/v1/taskqueue/status` contract later if needed.
- **Calling existing `/api/v1/taskqueue/*` endpoints from the browser**: Rejected due to both cross-case sensitive data leakage (`input_files`, `task_config` in raw Celery `kwargs`) and latency (4–5 sequential 1s `inspect()` broadcasts per poll).
- **Single combined status endpoint**: Rejected because cluster status (5s shared cache), storage counts (60s shared cache), and active workflows (per-user ACL filtered) have different caching, security, and failure boundaries.
- **Plotting `loadavg` from Celery heartbeats**: Deferred because Linux `os.getloadavg()` inside containers reports host `/proc/loadavg` (producing identical lines across containers on Docker Compose) and requires Prometheus gauge support in `metrics.py`.

## Risks and open questions

- **Large Redis queues (>2,000 messages)**: Per-task breakdown scans up to `2000` messages per queue while `LLEN` remains exact; affected queues display `sampled 2000` and stall cross-checking suppresses false `stalled` flags on truncated queues.
- **Million-row `file` table scan for Storage**: Caching `GET /api/v1/configs/status` for 60s (and skipping forced refresh on background auto-refresh) keeps Postgres load low; if very large deployments see slow grouped scans, a periodic materialized count or longer TTL can be introduced without changing the API.
- **Stalled workflow recovery**: This change surfaces `stalled` workflows read-only; revoking or marking orphaned tasks failed remains a separate follow-up feature.
