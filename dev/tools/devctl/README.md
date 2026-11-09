# Developer CLI

`./devctl` in the repository root is a small shim that runs the `devctl` CLI in this
directory with uv. The CLI is a click application in `src/devctl/`:

| Module         | What                                                       |
| -------------- | ---------------------------------------------------------- |
| `cli.py`       | commands, options, and help texts                          |
| `checkout.py`  | checkouts, worktree paths, ports, and `init`               |
| `stacks.py`    | `init`, `status`, and `stack up/down/logs/list`            |
| `worktrees.py` | `worktree create/sync/list/remove` and stacked worktrees   |
| `envfile.py`   | `.env` parsing and config templates                        |
| `git.py`, `docker.py`, `gh.py`, `proc.py` | external commands               |
| `ui.py`        | output, prompts, and tables                                |

Each checkout runs its own copy, so a change here can be tried in a worktree
with that worktree's `./devctl`.

Run the tests (they use real git in temporary repositories, and stubs for docker
and gh):

```bash
uv run --directory dev/tools/devctl pytest
```

After changing dependencies in `pyproject.toml`, run `uv lock` here and commit
`uv.lock`.
