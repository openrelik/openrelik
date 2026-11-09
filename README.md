# OpenRelik

[![Build Docker Images](https://github.com/openrelik/openrelik/actions/workflows/images.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/images.yml?query=branch%3Amain)
[![Python Unit Tests](https://github.com/openrelik/openrelik/actions/workflows/python-tests.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/python-tests.yml?query=branch%3Amain)
[![Frontend Unit Tests [sunstone]](https://github.com/openrelik/openrelik/actions/workflows/frontend-sunstone-tests.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/frontend-sunstone-tests.yml?query=branch%3Amain)
[![Version Check](https://github.com/openrelik/openrelik/actions/workflows/version-check.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/version-check.yml?query=branch%3Amain)
[![Test Coverage](https://img.shields.io/codecov/c/github/openrelik/openrelik/main?label=Test%20Coverage)](https://app.codecov.io/gh/openrelik/openrelik/tree/main)
[![server coverage](https://img.shields.io/codecov/c/github/openrelik/openrelik/main?component=server&label=server%20coverage)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/server)
[![workers coverage](https://img.shields.io/codecov/c/github/openrelik/openrelik/main?component=workers&label=workers%20coverage)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/workers)
[![libs coverage](https://img.shields.io/codecov/c/github/openrelik/openrelik/main?component=libs&label=libs%20coverage)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/libs)
[![web/sunstone coverage](https://img.shields.io/codecov/c/github/openrelik/openrelik/main?component=web-sunstone&label=web%2Fsunstone%20coverage)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/web/sunstone)

Every component of OpenRelik in one repository. Each was imported from its own
repository with its full history; the old repositories are archived.

| Directory            | What                                  | From                  |
| -------------------- | ------------------------------------- | --------------------- |
| server               | API, mediator, metrics, migrations    | openrelik-server      |
| web/sunstone         | web UI, codename sunstone (see web/)  | openrelik-ui          |
| workers              | task workers                          | openrelik-workers     |
| mcp                  | MCP server                            | openrelik-mcp-server  |
| libs/common          | shared Python library                 | openrelik-common      |
| libs/ai-common       | shared Python library (AI)            | openrelik-ai-common   |
| libs/python-client   | Python API client                     | openrelik-api-client  |
| libs/worker-common   | shared library for workers            | openrelik-workers     |
| deploy               | production deployment                 | openrelik-deploy      |

## Development

The whole stack runs from source with live reload. You need git, Docker with Compose
v2, and [uv](https://docs.astral.sh/uv/getting-started/installation/), which runs `./devctl`.

```bash
./devctl stack up    # start the stack in the background (first run: init, build, migrate the DB)
./devctl status      # what's running, problems, URLs
./devctl stack down  # stop it (the database is kept)
```

Open http://localhost:3000 and log in as `dev` / `dev`. The API is at
http://localhost:8710.

On a fresh checkout `./devctl stack up` runs `./devctl init` and builds the images first.

```bash
./devctl stack up -a                      # in the foreground with logs; rebuilds on dependency changes
./devctl stack up -b                      # rebuild images before starting
./devctl stack up -p plaso                # enable optional workers or the MCP server (see compose.yml)
./devctl stack restart server             # restart a service without recreating containers
./devctl stack up -- --force-recreate     # pass further options to docker compose up
./devctl stack list                       # list all stacks, their status, services, and ports
./devctl stack down -v                    # stop and delete the database (asks first)
./devctl stack logs -f                    # follow logs of all services
./devctl stack logs -f server mediator    # only some services (any docker compose logs options work)
docker compose ps                      # plain docker compose works in every checkout too
```

| Change in                                                   | Effect                                       |
| ----------------------------------------------------------- | -------------------------------------------- |
| `server/src`                                                | server hot-reloads; mediator/metrics restart |
| `web/sunstone`                                              | Vite HMR                                     |
| `workers/<name>/src`, `mcp/src`                             | that service restarts                        |
| `libs/*` (common, ai-common, python-client, worker-common)  | services using it restart                    |
| `pyproject.toml` / `uv.lock` / `package.json` / `yarn.lock` | `./devctl stack up -b` rebuilds the image    |

Live reload needs nothing running beside the stack: the source is bind-mounted into
the containers, so it also works after a restart and with plain `docker compose up`.
The server and Vite reload by themselves; the other services run under
`dev/tools/reload/reload.py`, which restarts them about a second after a change.
The libraries in `libs/` are bind-mounted too and put first on `PYTHONPATH`, so the
images use them instead of the PyPI versions they were built with.
Optional workers and the MCP server are behind profiles (see `compose.yml`).

### Worktrees

Each piece of work gets its own branch, checked out as a git worktree in
`.worktrees/<name>/`. A worktree runs its own stack, separate from the main checkout's:
it has its own `.env`, `.dev-local/` (config and data), Compose project
(`openrelik-<name>`) and ports (`3001`/`8711`, `3002`/`8712`, ...), so several stacks
can run at once. `create` starts the worktree's stack, and `remove` removes it.

```bash
./devctl worktree create case-tags        # create .worktrees/case-tags and start its stack
./devctl worktree sync case-tags          # rebase onto latest main (or parent branch)
./devctl worktree list                    # all checkouts, branches, stack states, and URLs
# ...edit in .worktrees/case-tags/, commit, push, gh pr create...
./devctl worktree remove case-tags        # once merged: remove stack, database, worktree, and branch
./devctl worktree remove -f case-tags     # or: abandon unmerged work (asks first)
```

The name is the branch name. Branch `code/<name>` lives in `.worktrees/<name>/`, and
other branches have `/` replaced: `./devctl worktree create design/case-tags` checks out
branch `design/case-tags` in `.worktrees/design-case-tags/` (see
`dev/README.md` for the branch kinds). A branch that exists only on origin, such
as a teammate's, is checked out tracking theirs. Pass `--no-stack` to `worktree create` to skip starting the stack immediately.

`remove` refuses while the worktree has uncommitted changes or the branch isn't merged
(squash merges are recognized through the PR, with `gh`). `remove --force` (`-f`) shows
what will be lost and asks first; it keeps an open PR and the pushed branch unless you
pass `--remote` (`-r`).

## License

Apache License 2.0, see [LICENSE](LICENSE).
