# AGENTS.md

Instructions for coding agents working in the OpenRelik monorepo.

## Repository

| Directory          | What                                  |
| ------------------ | ------------------------------------- |
| server             | API, mediator, metrics, migrations    |
| web/sunstone       | web UI, codename sunstone             |
| workers            | task workers                          |
| mcp                | MCP server                            |
| libs/common        | shared Python library                 |
| libs/ai-common     | shared Python library (AI)            |
| libs/python-client | Python API client                     |
| libs/worker-common | shared library for workers            |
| deploy             | production deployment                 |
| dev                | dev process, its artifacts, ./devctl  |

Components with their own commands and conventions have an `AGENTS.md` of their own;
read it before changing code there: `server/AGENTS.md`, `web/sunstone/AGENTS.md`,
`workers/AGENTS.md`. It adds to this file; where they disagree, the component's
file wins.

For the other directories:
- `libs/*` and `dev/tools/devctl/`: run tests with `uv run pytest` in that directory.
- `mcp/`: check that it starts with `PYTHONPATH=src uv run --locked python -c 'import openrelik_mcp_server, main'` in `mcp/`.
- When changing `VERSION`, `LICENSE`, `pyproject.toml`, or `package.json`, run `uv run --python 3.12 dev/check-versions.py`.
- Every source file starts with the Apache 2.0 `Copyright <year> Google LLC` header.

## Development stack

`./devctl` runs the whole stack from source with live reload (see `README.md`):

```bash
./devctl stack up [-w <worktree>]         # start a stack in the background (first run: init, build, migrate)
./devctl stack restart [-w <wt>] [svc...] # restart containers without recreating them
./devctl status [-w <worktree>]           # what's running, problems, URLs
./devctl stack list                       # list all stacks, their status, services, and ports
./devctl stack logs [-w <worktree>] -f    # follow container logs
./devctl stack down [-w <worktree>]       # stop it (the database is kept)
./devctl worktree create <branch>         # create .worktrees/<slug> and start its stack (--no-stack to skip)
./devctl worktree sync [<name>]           # rebase worktree branch onto parent branch (or main)
./devctl worktree list                    # checkouts, branches, stack states, and ports
./devctl worktree remove <name>           # after merge: remove stack, worktree and branch (-f to abandon)
```

The main checkout's web UI is at http://localhost:3000 (user `dev`, password `dev`) and
API at http://localhost:8710; each worktree gets its own port slot (`3001`/`8711`,
`3002`/`8712`, ...), so multiple stacks can run simultaneously.

## Development process

See `dev/process.md`. Document templates live in `dev/templates/`,
and skills for the steps agents help with (`idea`, `research`, `design`, `adr`,
`spec`, `implement`, `review`) in `.agents/skills/`.

### Rules

- The repository holds every artifact of work that has started (idea, research, ADR,
  design, spec); GitHub holds the backlog of ideas (issues labeled `idea`), the
  conversation and the state (the idea's issue, its assignee and its checklist, PR
  reviews). Don't track status in files.
- Never approve or merge (adding the `accepted` label to an idea is an approval), and
  don't start a step whose input hasn't passed its human gate (see "Conventions" in
  `dev/process.md`).
- Publishing to GitHub (issues, PRs, comments) needs the user's explicit go-ahead.
- What you publish (issues, PRs, comments, commit messages) is model, provider and
  harness agnostic: no "Generated with" lines, co-author trailers, or tool names.
- Do prototype and implementation work in a worktree (`./devctl worktree create`),
  not on main. Pass `--no-stack` for document branches (`design/<slug>`, `adr/<slug>`,
  `spec/<slug>`). Refer to the issue in commits and PRs (`Refs #123`, and `Closes #123`
  on the code PR). A bugfix needs a failing regression test first and a commit message
  stating the symptom, the cause, and the fix.
- Follow the `AGENTS.md` of the component you change, if it has one.
