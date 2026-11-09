---
slug: devctl-release-tools
issue: https://github.com/openrelik/openrelik/issues/83
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-09
Checks run:
- `uv run --directory dev/tools/devctl pytest`: 34 passed
- `uv run --python 3.12 .github/scripts/check-versions.py`: passed (0 errors, 26 warnings)

What this change does: Moves release management from `dev/release.py` into native `./devctl release` commands, relocates version consistency checking to `.github/scripts/check-versions.py`, and updates monorepo documentation and CI workflows to use the new command paths.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: untested

## Must fix
1. **Release commands target main repo root instead of active checkout** (`dev/tools/devctl/src/devctl/cli.py:L258-316`)
- **What this is:** Every command under `@cli.group() def release` passes `repo.root` to `release_module`.
- **Problem:** `Repo.discover().root` resolves to `common_dir.parent`, which is always the main repository checkout. Running `./devctl release ...` from within a git worktree (such as `.worktrees/patch-worker`) runs git checks and file modifications against the main checkout rather than the active worktree directory. If the main checkout has uncommitted changes, the command aborts claiming the worktree is not clean. If it is clean, it commits to whatever branch is active in the main checkout instead of the worktree branch.
- **Fix:** Pass `repo.resolve_checkout()` instead of `repo.root` to all `release_module` calls in `cli.py`.
- **If we skip it:** Maintainers creating releases or cherry-picking patches in git worktrees will make unintended commits on their main checkout and leave worktree branches unchanged.

## Should fix
2. **Missing test coverage for `platform` and `mcp` release commands** (`dev/tools/devctl/tests/test_release.py:L1-194`)
- **What this is:** Automated tests in `test_release.py` test `ui`, `server`, `lib`, `worker`, `dev`, and `tag`, but include no tests for `platform` or `mcp`.
- **Problem:** `platform` is the primary release command modifying `VERSION`, multiple manifest files, `config.env`, and `install.sh`. Regressions in platform release execution cannot be detected by CI before release time.
- **Fix:** Add CLI test cases for `devctl release platform` and `devctl release mcp` to `test_release.py`.
- **If we skip it:** Breakages in platform or MCP release flows will only surface when a release is attempted.

3. **Duplicated stub setup across test functions** (`dev/tools/devctl/tests/test_release.py:L43-181`)
- **What this is:** Five test functions individually create identical executable stub scripts for `uv` and `.github/scripts/check-versions.py`.
- **Problem:** 60 lines of repetitive setup boilerplate inflate `test_release.py` and complicate adding new tests.
- **Fix:** Move `uv` and `check-versions.py` stub creation into pytest fixtures in `test_release.py`.
- **If we skip it:** Unnecessary boilerplate persists and future tests will continue copy-pasting the same stubs.

## Nice to have
4. **Duplicate pyproject release logic and missing server manifest check** (`dev/tools/devctl/src/devctl/release.py:L194-235`)
- **What this is:** `release_server`, `release_lib`, `release_mcp`, and `release_worker` duplicate identical worktree checks, version parsing, tag validation, pyproject modifications, and commit logic. Unlike the other three, `release_server` does not check if `server/pyproject.toml` exists before opening it.
- **Problem:** A missing `server/pyproject.toml` crashes with an unhandled `FileNotFoundError` traceback instead of exiting via `ui.die`. Approximately 25 lines of boilerplate are duplicated across the four functions.
- **Fix:** Extract a helper function `_release_project(root, pyproject_path, tag_prefix, version, label)` that validates file existence, updates the version, and calls `commit_release`.
- **If we skip it:** Inconsistent error handling remains for missing server manifests and redundant code must be maintained.

5. **Post-commit advice omits path prefix for `devctl`** (`dev/tools/devctl/src/devctl/release.py:L143`)
- **What this is:** When a commit is made on a PR branch, `commit_release` prints instructions including `devctl release tag`.
- **Problem:** If `devctl` is not installed on `PATH`, copy-pasting this command fails with `command not found: devctl`. All other documentation and CLI examples use `./devctl`.
- **Fix:** Update line 143 to print `git switch main && git pull && ./devctl release tag`.
- **If we skip it:** Users following printed terminal output will encounter command execution failures.

Verdict: fix 1 first.

---

# Review Round 2

Date: 2026-11-09
Checks run:
- `uv run --directory dev/tools/devctl pytest`: 41 passed
- `uv run --python 3.12 .github/scripts/check-versions.py`: passed (0 errors, 26 warnings)

What this change does: Moves release management from `dev/release.py` into native `./devctl release` subcommands, relocates version consistency checking to `.github/scripts/check-versions.py`, and enforces it as an automatic pre-commit gate before staging release commits. It updates all developer documentation and CI workflows to use `./devctl release`, resolving checkout directories dynamically so release commands work from both the main repository checkout and isolated worktrees.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done

LGTM
Checked: all 8 `devctl release` subcommands, checkout resolution from worktrees, `check-versions.py` repository root detection and pre-commit reversal gate, test suites in `devctl` (41 passed, 100% release coverage), `libs/*` pytest suites, MCP server startup, and repo-wide references to release and version check tools.
