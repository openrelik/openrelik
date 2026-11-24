---
slug: convert-blocking-async-handlers
issue: https://github.com/openrelik/openrelik/issues/150
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Spec: Convert blocking async FastAPI handlers to sync def

Implements `idea.md` (#150).

## Scope

- Convert synchronous FastAPI route handlers and shared auth dependencies in `server/src/` from `async def` to plain `def` so FastAPI runs them in its AnyIO worker threadpool instead of blocking the single asyncio event loop.
- Convert `upload_files` in `server/src/api/v1/files.py` to plain `def` using synchronous file I/O (`file.file.read` and `open`) alongside its existing synchronous Redis and SQLAlchemy calls.
- Harden directory creation in `workflow_utils.run_workflow` with `exist_ok=True` for concurrent execution.
- Update direct unit tests of converted auth functions and add deterministic concurrency tests verifying that blocking handlers do not stall concurrent requests.
- Out of scope: changing `compose.yml` or `deploy/docker/docker-compose.yml` to run multiple Uvicorn workers (threadpool concurrency is sufficient), modifying genuinely async endpoints (`download_file_stream`, Authlib OAuth `login`/`auth`/`oidc_auth`, ADK SSE `start_investigation`/`get_adk_sse_session`), or modifying `main.py` startup lifespan helpers.

## Requirements

- R1: Auth dependencies and synchronous auth endpoints in `server/src/auth/common.py` (`verify_csrf`, `get_current_user`, `get_current_active_user`, `refresh`, `csrf`, `logout`), `server/src/auth/local.py` (`auth_local`), `server/src/auth/iap.py` (`login`), and `server/src/auth/google.py` (`auth_header_token`) are plain `def` functions (with `verify_csrf` as a synchronous generator) and preserve their existing HTTP responses, cookies, headers, and error codes.
- R2: All 15 `async def` endpoints in `server/src/api/v1/workflows.py` (`create_workflow`, both `get_workflow` handlers, `update_workflow`, `copy_workflow`, `delete_workflow`, `run_workflow`, `get_workflow_status`, `get_workflow_templates`, `get_workflow_template_by_id`, `create_workflow_template`, `update_workflow_template`, `delete_workflow_template`, `generate_workflow_name`, and `generate_workflow_report`) are plain `def` functions; `generate_workflow_name` calls `llm.generate(prompt=prompt)` directly without `asyncio.get_running_loop().run_in_executor`, unused `asyncio` and `functools` imports are removed, and `server/src/lib/workflow_utils.py` creates `output_path` with `os.makedirs(output_path, exist_ok=True)`.
- R3: Synchronous `async def` endpoints in `server/src/api/v1/users.py` (`get_api_key_for_current_user`, `create_api_key_for_current_user`, `delete_api_key`) and `server/src/api/v1/folders.py` (`update_folder`, `create_adk_session` and its inner helpers `_get_folder_contents` and `_create_adk_session`) are plain `def` functions with unchanged behavior.
- R4: `upload_files` in `server/src/api/v1/files.py` is a plain `def` function that reads uploaded chunks via `file.file.read(...)` and writes/reassembles files with standard synchronous `open(...)`, preserving chunk retry limits, Redis state handling, path traversal checks, file creation, and background hash generation.
- R5: Genuinely async endpoints remain `async def`: `download_file_stream` in `server/src/api/v1/files.py`, `login` and `auth` in `server/src/auth/google.py`, `login` and `oidc_auth` in `server/src/auth/oidc.py`, and `start_investigation` and `get_adk_sse_session` in `server/src/api/v1/folders.py`.
- R6: A blocking call inside a converted route handler or auth dependency does not block concurrent requests on the same single-process ASGI event loop; automated concurrency tests prove this deterministically without relying on wall-clock sleeps, and the full `server/` test suite passes with Black formatting intact.

## Tasks

- [x] T1: Convert `verify_csrf`, `get_current_user`, `get_current_active_user`, `refresh`, `csrf`, and `logout` in `server/src/auth/common.py`, `auth_local` in `server/src/auth/local.py`, `login` in `server/src/auth/iap.py`, and `auth_header_token` in `server/src/auth/google.py` from `async def` to `def`, and update direct unit tests in `server/src/tests/auth/common_test.py`, `server/src/tests/auth/local_test.py`, `server/src/tests/auth/iap_test.py`, and `server/src/tests/auth/google_test.py` (R1, R5).
- [x] T2: Convert all 15 `async def` route handlers in `server/src/api/v1/workflows.py` to `def`, simplify `generate_workflow_name` to call `llm.generate(prompt=prompt)` directly (removing unused `asyncio` and `functools` imports), and pass `exist_ok=True` to `os.makedirs(output_path, exist_ok=True)` in `server/src/lib/workflow_utils.py` (R2).
- [x] T3: Convert `get_api_key_for_current_user`, `create_api_key_for_current_user`, and `delete_api_key` in `server/src/api/v1/users.py`, and `update_folder` and `create_adk_session` (plus its inner helpers) in `server/src/api/v1/folders.py`, from `async def` to `def` (R3, R5).
- [x] T4: Convert `upload_files` in `server/src/api/v1/files.py` from `async def` to `def`, replacing `await file.read(...)` and `aiofiles.open(...)` inside `upload_files` with `file.file.read(...)` and synchronous `open(...)` while keeping `download_file_stream` async (R4, R5).
- [ ] T5: Add concurrency and handler-signature regression tests in `server/src/tests/api/v1/concurrency_test.py` verifying that (a) none of the converted routes/dependencies are coroutine or async-generator functions, (b) a blocked call in a converted route (such as `run_workflow`) and in `get_current_user` does not prevent a concurrent request from completing on the same ASGI event loop, and (c) run the full `server/` pytest suite and Black check (R1, R2, R3, R4, R5, R6).

## Tests

- R1: Run `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest src/tests/auth/` in `server/` and assert converted auth functions are not coroutine or async-generator functions.
- R2: Run `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest src/tests/api/v1/workflows_test.py src/tests/lib/workflow_utils_test.py` in `server/`.
- R3: Run `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest src/tests/api/v1/users_test.py src/tests/api/v1/folders_test.py` in `server/`.
- R4: Run `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest src/tests/api/v1/files_test.py` in `server/`, covering chunked upload, full chunk reassembly, retry failures, and unsafe identifier rejection.
- R5: Verify in `server/src/tests/api/v1/concurrency_test.py` that `download_file_stream`, `google.login`, `google.auth`, `oidc.login`, `oidc.oidc_auth`, `start_investigation`, and `get_adk_sse_session` remain coroutine functions.
- R6: Run `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest` and `uv run --all-groups black --check src` in `server/`; in `concurrency_test.py`, block one request on a `threading.Event` inside a mocked synchronous call and confirm a second concurrent request over the same `httpx.AsyncClient` ASGI transport completes and signals the event before timeout.

## Rollout

None. No database migrations, configuration changes, or deployment changes are required.
