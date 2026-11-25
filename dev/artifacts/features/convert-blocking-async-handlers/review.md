---
slug: convert-blocking-async-handlers
issue: https://github.com/openrelik/openrelik/issues/150
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-25
Checks run:
- `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest` (589 passed)
- `uv run --all-groups black --check src/tests/api/v1/concurrency_test.py` (passed)

What this change does:
Converts synchronous FastAPI route handlers and shared authentication dependencies in `server/src/` from `async def` to plain `def`, so FastAPI runs them in background worker threads instead of blocking its single main event loop. Rewrites `upload_files` to use synchronous file I/O, simplifies `generate_workflow_name` to call the LLM directly, passes `exist_ok=True` to `os.makedirs` in `workflow_utils.run_workflow`, and adds concurrency and handler-signature regression tests. Scale was judged against concurrent analysts, workflow dispatches, and parallel multi-chunk file uploads hitting a single-worker Uvicorn API process.

## Requirements
- R1: done
- R2: partially tested: `generate_workflow_name` is converted and simplified, but no test runs its LLM call path
- R3: done
- R4: broken under concurrency and partially tested: parallel chunk uploads can race during reassembly or read half-written chunks, and `files_test.py` does not test retry failures or verify reassembled file bytes
- R5: done
- R6: done

## Must fix

1. **Concurrent chunk uploads can corrupt evidence files or fail with 500** (`server/src/api/v1/files.py:L394-416`)
   - **What this is:** `upload_files` writes each incoming chunk to disk, records the chunk number in a Redis set, and stitches all chunks into the final file once every chunk is recorded.
   - **Problem:** Moving `upload_files` from the single-threaded event loop (`async def`) to parallel worker threads (`def`) removes the single-threaded serialization between checking `redis_client.smembers` (L405) and calling `redis_client.delete` (L414). When a client uploads chunks of one file in parallel (as `web/sunstone/src/components/UploadFile.vue:L106` does using Resumable.js's default 3 simultaneous 10 MB uploads), two threads can both see all chunks present and both run reassembly, creating duplicate files or returning HTTP 500 when one thread removes chunk files the other is reading. In addition, `redis_client.sadd` runs inside the 4 MB write loop (L398), so a second thread can start reassembling a 10 MB chunk before the first thread finishes writing and closing it.
   - **Fix:** Track whether bytes were written inside the `with open(chunk_file_path, "wb")` block and call `redis_client.sadd` once after the block closes the file. Then guard reassembly with `if not redis_client.delete(redis_uploaded_chunks_key): return`, because Redis `DEL` is atomic (runs as one indivisible step) and returns `1` only to the single thread that actually deleted the key.
   - **If we skip it:** Parallel chunk uploads from Sunstone or API clients can silently save truncated evidence files, create duplicate file records, or abort with a permanent 500 error.

## Should fix

2. **Rewritten `upload_files` I/O lacks byte verification and retry failure tests** (`server/src/tests/api/v1/files_test.py:L333-401,L619-686`)
   - **What this is:** Unit tests for the chunked upload endpoint whose read, write, and reassembly loops were rewritten from `aiofiles` to synchronous `open` and `file.file.read`.
   - **Problem:** `test_upload_files_chunked` and `test_upload_files_complete` only assert HTTP `201` and mock calls; they never read the assembled output file on disk to verify its bytes or check that temporary chunk files were deleted. Neither test covers the 503 write-failure retry path (`files.py:L399-401`) or the 429 retry-limit cleanup path (`files.py:L383-390`), even though `spec.md` R4 lists retry failures as tested.
   - **Fix:** In `test_upload_files_complete`, verify the assembled file bytes match all chunks in order and that temporary chunks are removed; add tests for 503 retry incrementing, 429 retry exhaustion cleanup, and two concurrent requests finishing the final chunks.
   - **If we skip it:** A silent truncation, mis-ordered chunk stitch, or broken error cleanup in evidence uploads would pass CI undetected.

3. **Changed `generate_workflow_name` LLM call path has no test** (`server/src/api/v1/workflows.py:L666-671`)
   - **What this is:** The workflow name generator endpoint, updated to call `llm.generate(prompt=prompt)` directly in the worker thread instead of `loop.run_in_executor`.
   - **Problem:** The only two tests calling `/generate_name/` (`server/src/tests/api/v1/workflows_test.py:L1045,L1185`) return `403` on access checks and never reach `get_active_llm()` or `llm.generate(prompt=prompt)`.
   - **Fix:** Add a test in `server/src/tests/api/v1/workflows_test.py` mocking `get_workflow_with_access`, `get_active_llm`, and `manager.LLMManager`, and assert `GET /folders/1/workflows/1/generate_name/` returns `200` with the expected truncated name.
   - **If we skip it:** Regressions in `generate_workflow_name` after removing the executor wrapper will only surface when a user generates a workflow name on a live server.

Verdict: fix 1, 2, and 3 first.
Not checked: live multi-request behavior against a running Docker stack (`./devctl stack up`); verified from the diff, connected code, and the 589 passing unit tests.

---

# Review Round 2

Date: 2026-11-25
Checks run:
- `OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest` (593 passed)
- `uv run --all-groups black --check src/tests/api/v1/concurrency_test.py` (passed)

What this change does: Converts blocking FastAPI route handlers and shared auth dependencies in `server/src/api/v1/` and `server/src/auth/` from `async def` to plain `def`. FastAPI now runs them in its worker threadpool instead of stalling the single event loop on database, Redis, Argon2, HTTP, disk, or Celery calls. The change also switches `upload_files` to synchronous file I/O, fixes parallel chunk-upload and directory-creation races (`sadd` after closing the chunk file, atomic Redis `DEL` reassembly claim, and `os.makedirs(..., exist_ok=True)`), and adds deterministic concurrency and upload tests.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done

Verdict: LGTM

Checked the full diff, all touched modules, connected callers and helpers (`authz.py`, `database.py`, `main.py`, `file_hashes.py`, `celery_utils.py`, `healthz.py`, `conftest.py`, and upload clients), and the verified 593-test pytest run plus Black check on `concurrency_test.py`, assuming a single Uvicorn worker serving concurrent requests and multi-GB chunked uploads.
Not checked: live stack runs against real PostgreSQL, Redis, and Celery (`./devctl stack up`), since the test suite mocks those services.
