---
slug: devctl-release-tools
issue: https://github.com/openrelik/openrelik/issues/83
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Spec: Add release management and version checking to devctl

Implements idea.md (#83).

## Scope

- Move `dev/release.py` functionality into `devctl` as a native click command group (`./devctl release <platform|server|ui|lib|mcp|worker|dev|tag>`).
- Delete `dev/release.py` without leaving a wrapper script.
- Move `dev/check-versions.py` to `.github/scripts/check-versions.py` and update repository root detection for the new path.
- Update GitHub Actions workflow `.github/workflows/version-check.yml` to run `.github/scripts/check-versions.py`.
- Run `.github/scripts/check-versions.py` from `./devctl release` as a non-bypassable pre-commit check before staging and committing release changes.
- Update monorepo documentation and workflow references that point to `dev/release.py` and `dev/check-versions.py`.
- Out of scope: changing release semantics, versioning rules, tagging conventions, or git push groupings.

## Requirements

- R1: `./devctl release` supports subcommands `platform`, `server`, `ui`, `lib`, `mcp`, `worker`, `dev`, and `tag` with the same arguments, validation, and tagging behaviour as `dev/release.py`.
- R2: `dev/release.py` is removed; all release operations run through `./devctl release`.
- R3: `dev/check-versions.py` is moved to `.github/scripts/check-versions.py`, correctly locates repository root, and passes `.github/workflows/version-check.yml`.
- R4: `./devctl release` executes `.github/scripts/check-versions.py` prior to committing release changes; if the version check fails, release changes are reverted and the command aborts with an error. No bypass flag is provided.
- R5: Monorepo documentation (`README.md`, `AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, `dev/PATCHING.md`, `deploy/README.md`) and CI workflows (`images.yml`, `release-pypi.yml`) are updated to reference `./devctl release` and `.github/scripts/check-versions.py`.
- R6: `devctl` automated tests in `dev/tools/devctl/tests` cover the new `release` CLI command group and its integration.

## Tasks

- [x] T1: Move `dev/check-versions.py` to `.github/scripts/check-versions.py`, update its `ROOT` path calculation, and update `.github/workflows/version-check.yml` (R3).
- [x] T2: Add `release` module in `dev/tools/devctl/src/devctl/` implementing release logic and subcommands, wired to `Repo.discover().root` (R1).
- [x] T3: Add Click CLI commands for `release` (`platform`, `server`, `ui`, `lib`, `mcp`, `worker`, `dev`, `tag`) to `dev/tools/devctl/src/devctl/cli.py` (R1).
- [x] T4: Enforce `.github/scripts/check-versions.py` execution within `devctl release` as an unavoidable pre-commit gate (R4).
- [x] T5: Remove `dev/release.py` and add unit/integration tests in `dev/tools/devctl/tests/test_release.py` (R1, R2, R4, R6).
- [x] T6: Update references across repo documentation (`AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, `dev/PATCHING.md`, `deploy/README.md`) and workflow comments (`images.yml`, `release-pypi.yml`) (R5).

## Tests

- R1, R4, R6: Unit tests in `dev/tools/devctl/tests/test_release.py` using pytest and CliRunner, verifying argument parsing, version validation, tagging logic, and failure handling when version check fails.
- R2: File absence check verifying `dev/release.py` does not exist.
- R3: Run `python3 .github/scripts/check-versions.py` directly and verify exit code 0 on the clean repository tree.
- R5: `git grep` verifying no stale references to `dev/release.py` or `dev/check-versions.py` remain in documentation or workflows.

## Rollout

Documentation updates in repo developer guides. No deployment, database migrations, or production configuration required.
