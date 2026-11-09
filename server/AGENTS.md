# AGENTS.md: server

The API, mediator, metrics exporter, GCS importer, and database migrations. The root
`AGENTS.md` covers the dev stack and the process; this covers working in `server/`.

## Layout

`src/` is the import root: modules import each other top-level
(`from datastores.sql.crud.folder import ...`), not as a package.

| Path                     | What                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `src/main.py`            | the FastAPI app; mounts the auth, health, and `api/v1` routers |
| `src/api/v1/`            | one router per resource; all Pydantic schemas in `schemas.py` |
| `src/auth/`              | `common.py` (current user, admin check), local, google, oidc, iap |
| `src/datastores/sql/`    | `models/`, `crud/` (access checks in `authz.py`), `alembic/`  |
| `src/lib/`               | helpers: celery, duckdb, LLM summary and chat, reporting      |
| `src/mediator/`, `src/metrics/`, `src/importers/gcp/` | separate services, each with its own Dockerfile |
| `src/tests/`             | mirrors the source tree; files are `*_test.py`                |
| `src/config.py`          | loads the TOML settings file                                  |

## Commands

Run from `server/`:

```bash
OPENRELIK_SERVER_SETTINGS=./settings_example.toml REDIS_URL=redis://test:1234 uv run --all-groups pytest
uv run --all-groups pytest src/tests/api/v1/folders_test.py   # one file (same env vars)
uv run --all-groups black src                                 # format
```

Tests need no database or Redis: `db` is a mocked session, and the Redis client and
access checks are mocked in `src/tests/conftest.py`. Black's default line length (88)
applies; there's no other formatter or linter config.

## Conventions

- Every file starts with the Apache 2.0 "Copyright <year> Google LLC" header, then a
  module docstring. Docstrings are Google style (`Args:`, `Returns:`).
- Routes get the user and session through `Depends(get_current_active_user)` and
  `Depends(get_db_connection)`, and check access with the helpers in
  `datastores/sql/crud/authz.py`. Database access goes through `crud/`, not queries in
  routers.
- New request and response models go in `api/v1/schemas.py`.
- A model change needs an Alembic revision in `src/datastores/sql/alembic/versions/`.
  Import a new model in `alembic/env.py`, or autogenerate won't see it.
- Write tests for new routes and CRUD functions beside the existing ones.

## Migrations

`./devctl stack up` runs the one-shot `migrate` service (`alembic upgrade head`, then it
creates the `dev` user) before the server starts; run it again with
`docker compose run --rm migrate`. To write a revision, autogenerate it against the
dev database. The source is mounted read-only, so mount the versions directory
writable:

```bash
docker compose run --rm \
  -v ./server/src/datastores/sql/alembic/versions:/app/openrelik/datastores/sql/alembic/versions \
  migrate alembic revision --autogenerate -m "add file tags"
```

Review the generated file; autogenerate misses some changes (renames, server defaults).

## Dev stack

- `./server/src` is mounted read-only at `/app/openrelik`; the server reloads with
  uvicorn, mediator and metrics restart under `dev/tools/reload/reload.py`.
- `libs/common` and `libs/ai-common` are mounted and first on `PYTHONPATH`, so local
  edits to them take effect in the stack. The tests and the images use the PyPI
  versions pinned in `uv.lock`; to test against a local library change, pass
  `--with-editable ../libs/<name>` to `uv run`.
- After changing `pyproject.toml` or `uv.lock`, rebuild: `./devctl stack up -b`.
- Settings: `.dev-local/config/settings.toml` in the checkout, mounted at
  `/etc/openrelik`. A new setting goes in `settings_example.toml` too; `./devctl init`
  renders new checkouts' settings from it.
