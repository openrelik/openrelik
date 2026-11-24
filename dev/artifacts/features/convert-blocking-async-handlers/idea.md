---
slug: convert-blocking-async-handlers
issue: https://github.com/openrelik/openrelik/issues/150
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Convert blocking async FastAPI handlers to sync def

## Problem

OpenRelik's API server runs a single Uvicorn worker in both local development (`compose.yml`, which uses `uvicorn --reload`) and Docker Compose deployments (`deploy/docker/docker-compose.yml`, which sets `--workers 1`). Several FastAPI routes and shared auth dependencies are declared with `async def` even though they execute synchronous blocking calls (SQLAlchemy queries, Celery `control.inspect()` broadcasts, Argon2 password verification, Redis commands, and synchronous HTTP requests).

Because FastAPI executes `async def` callables directly on the single asyncio event loop thread instead of its AnyIO worker threadpool, any blocking call inside them freezes the entire worker. Concurrent requests hang until the blocking call finishes, stalling other users, fast endpoints, and `/healthz` checks.

## Proposal

Convert synchronous FastAPI route handlers and auth dependencies that do not perform async I/O from `async def` to plain `def` so FastAPI runs them concurrently in its worker threadpool. Keep genuinely async endpoints (streaming file downloads, Authlib OAuth callbacks, and ADK SSE streams) as `async def`, and add concurrency tests verifying that slow blocking handlers do not block concurrent requests.

## Users

Analysts and operators using OpenRelik concurrently (including behind Nginx in production) who will no longer see requests stall when another request triggers a slow workflow dispatch, login, or database query, and developers running concurrent requests against the single-worker local dev stack.

## Open questions

- Should `upload_files` (`server/src/api/v1/files.py`), which currently mixes `aiofiles` with synchronous Redis and SQLAlchemy calls, be converted to plain `def` or kept `async def` with its blocking calls offloaded via `run_in_threadpool`?
- Should we also run multiple Uvicorn workers in `compose.yml` (via `dev/tools/reload/reload.py`) in a separate change, or is threadpool concurrency enough for local dev?
