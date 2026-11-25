---
slug: worker-queue-status
issue: https://github.com/openrelik/openrelik/issues/152
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Worker and queue status page

## Problem

When workflows slow down or tasks stay pending, analysts and operators cannot tell from the UI whether workers are busy, idle, or offline, which specific queues are backed up, or whether storage volumes are filling up. The existing Metrics page in Runestone only shows historical aggregated totals from Prometheus, so answering basic operational questions like how many workers are busy, how many tasks are waiting on each worker queue, or which workflows are currently running requires inspecting Redis, Celery, or Postgres directly.

## Proposal

Extend the existing Runestone Metrics page and rename it to System status (`/status`, with `/metrics` redirecting to `/status`) so it shows live operational state alongside the historical metrics, without depending on Prometheus for the live view:

- Aggregate summary counters for online/busy/idle workers, capacity in use, running tasks, queued tasks, and accessible active workflows.
- Queue depth broken down by both Celery queue name and registered worker task name, combining broker-queued messages and tasks prefetched by workers, surfacing internal workers (such as `openrelik-hashing`), and showing offline queues that still have queued work in Redis.
- Online worker details showing state, queues, running/concurrency ratio, prefetched tasks, processed count, and uptime.
- Active workflows that the current user has access to, linking directly to each workflow folder, distinguishing tasks queued in Celery from downstream tasks waiting on upstream steps, and flagging stalled runs.
- Storage overview showing file counts, total tracked file size, unpurged soft-deleted trash, folder and workflow counts, and disk usage per configured storage provider.
- Historical Prometheus metrics preserved in a collapsible section below the live view, plus optional auto-refresh and manual refresh.

This targets Runestone only; Sunstone is unchanged.

## Users

Analysts waiting on workflows who want to see why a task has not started and track their active workflows, and platform operators monitoring worker capacity, queue backlogs, and storage headroom.

## Open questions

- None.
