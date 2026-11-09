# AGENTS.md: workers

The task workers, one directory per worker, each its own Celery app, image, and uv
project. Their shared library is `libs/worker-common` (`openrelik_worker_common`).
The root `AGENTS.md` covers the dev stack and the process; this covers working in
`workers/`.

## Layout of a worker

`workers/strings/` is the simplest example:

| Path                  | What                                                       |
| --------------------- | ---------------------------------------------------------- |
| `src/app.py`          | the Celery app; `include=[...]` lists the task modules     |
| `src/tasks.py`        | the tasks (some workers have several modules instead)      |
| `tests/test_tasks.py` | tests; they import `from src import tasks`                 |
| `pyproject.toml`, `uv.lock` | the worker's dependencies                            |
| `Dockerfile`, `openrelik.yaml`, `README.md` | image, marketplace metadata, docs    |

## Tasks

```python
TASK_NAME = "openrelik-worker-strings.tasks.strings"
TASK_METADATA = {"display_name": "Strings", "description": "...", "task_config": [...]}

@celery.task(bind=True, name=TASK_NAME, metadata=TASK_METADATA)
def strings(self, pipe_result=None, input_files=None, output_path=None,
            workflow_id=None, task_config=None) -> str:
    input_files = get_input_files(pipe_result, input_files or [])
    output_file = create_output_file(output_path, display_name=...)
    ...
    return create_task_result(output_files=output_files, workflow_id=workflow_id, meta={})
```

- The task name is `openrelik-worker-<name>.tasks.<task>`. Its prefix is the Celery
  queue the worker listens on, so it has to match the directory name.
- `TASK_METADATA` is what the UI shows: the name, description, and the `task_config`
  form fields.
- Use the helpers in `openrelik_worker_common` (`task_utils`, `file_utils`,
  `reporting`, ...) for input files, output files, and results; don't reimplement
  them. Report progress with `self.send_event("task-progress", data=...)`.
- A new task module goes in `include=[...]` in `src/app.py`, or Celery won't load it.

## Commands

Run from the worker's directory:

```bash
uv run pytest                          # all tests
uv run pytest tests/test_tasks.py -k strings
```

Tests mock `get_input_files`, `create_output_file`, and `telemetry` in `src.tasks`, and
need no Redis. There's no formatter or linter config; match the surrounding code.
Every file starts with the Apache 2.0 "Copyright <year> Google LLC" header.

## Dev stack

- Nine workers are in `compose.yml`: strings (always), and grep, exif, plaso,
  extraction, capa, duckdb, yara, analyzer-config behind profiles
  (`./devctl stack up -p <name>`, or `-p workers` for all). The others aren't in the dev
  stack yet.
- `workers/<name>/src` is mounted read-only at `/openrelik/src`, and the worker
  restarts under `dev/tools/reload/reload.py` a few seconds after a change.
- The libraries in `libs/` are mounted and first on `PYTHONPATH`, so local edits to
  `worker-common` take effect in the stack. The tests use the PyPI version pinned in
  `uv.lock`; to test against a local library change, pass
  `--with-editable ../../libs/<name>` to `uv run`.
- The images are `linux/amd64`, so on Apple silicon they run emulated and restart
  slower than the server.
- After changing `pyproject.toml` or `uv.lock`, rebuild: `./devctl stack up -b`.

To add a worker to the stack, copy the `worker-strings` service in `compose.yml` and
change the name, build context, `src` mount, `-Q openrelik-worker-<name>`, and add
`profiles: [workers, <name>]`. The volumes list is repeated in full in each service
(YAML anchors can't merge lists).

## Known issues

- `duckdb/src/tasks.py` is still the worker template (`TEMPLATEWORKERNAME`), so the
  duckdb worker registers no usable task.
- The Dockerfiles' `CMD` uses `--app=src.tasks`; the dev stack uses `src.app`.
- New workers start from
  [openrelik-worker-template](https://github.com/openrelik/openrelik-worker-template)
  (see `README.md`); there's no template in this repository.
