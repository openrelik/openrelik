---
slug: release-skill
issue: https://github.com/openrelik/openrelik/issues/88
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Spec: Add release skill for platform, component, and patch releases

Implements idea.md (#88).

## Scope

- Create `.agents/skills/release/SKILL.md` implementing release coordination with explicit subcommands: `platform`, `patch`, `tag`, and `dev`.
- Automate consumer dependency updates for platform minor releases across `server/`, `mcp/`, and all first-party workers (`workers/*/pyproject.toml`) with `uv lock`.
- Establish and maintain root `CHANGELOG.md` with structured summaries and change highlights.
- Automate drafting release notes locally in `/tmp/` and creating GitHub releases via `gh release create` post-approval.
- Enforce a non-bypassable human approval gate prior to remote push or publication actions (`git push`, `gh release create`), including batching tag pushes in groups of at most three.
- Update repository documentation (`AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, `dev/PATCHING.md`) to reference the release skill.
- Out of scope: changing `./devctl release` commands, changing version check gate rules, or altering CI workflow triggers.

## Requirements

- R1: Define the `release` skill in `.agents/skills/release/SKILL.md` with standard YAML frontmatter, description, and explicit subcommands (`platform`, `patch`, `tag`, `dev`).
- R2: `/release platform <version>` coordinates the multi-stage platform release: library releases to PyPI, automated consumer dependency updates and `uv lock` in server/mcp/workers, release branch creation, `./devctl release platform`, changelog updates, draft GitHub release notes, a human approval gate, and advancing `main` with `./devctl release dev`.
- R3: `/release patch <component> <version>` coordinates component and core patch releases: cherry-picking fixes to `release/<minor>` for core/libs or creating PRs on `main` for workers, running `./devctl release`, updating `CHANGELOG.md`, drafting patch release notes, and requesting human approval.
- R4: `/release tag [commit]` inspects merged release commits, runs `./devctl release tag`, presents created tags, and prompts for human approval before pushing tags in batches of at most three.
- R5: The skill initializes and updates root `CHANGELOG.md` with release version, date, concise summary, highlights, and component changes.
- R6: The skill prepares release notes in `/tmp/` and creates the GitHub release via `gh release create` with formatted release notes, migrations, and notes for worker authors post-approval.
- R7: The skill enforces an explicit human approval gate prior to executing any remote push or publication action (`git push`, `gh release create`), presenting a summary of changed files, versions, and tags.
- R8: Repository documentation in `AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, and `dev/PATCHING.md` is updated to document the `release` skill.

## Tasks

- [x] T1: Create `.agents/skills/release/SKILL.md` defining skill frontmatter, execution model, pre-flight checks, and the human approval gate (R1, R7).
- [x] T2: Specify platform release workflow (`/release platform <version>`), including automated consumer dependency updates across `server/`, `mcp/`, and `workers/*/pyproject.toml` with `uv lock` (R1, R2).
- [x] T3: Specify component patch release workflow (`/release patch <component> <version>`) for core services, libraries, and workers (R1, R3).
- [x] T4: Specify tagging and post-merge push workflow (`/release tag [commit]`), enforcing tag batching of at most three (R1, R4, R7).
- [x] T5: Specify root `CHANGELOG.md` structure, initial creation, and update format, as well as release note drafting and `gh release create` (R5, R6).
- [x] T6: Update monorepo documentation (`AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, `dev/PATCHING.md`) to integrate the release skill (R8).

## Tests

- R1, R2, R3, R4, R7: Validate skill instructions against `./devctl release` syntax, git branching rules in `dev/RELEASING.md` and `dev/PATCHING.md`, and verify clear separation of preparation and approval-gated steps.
- R5: Verify root `CHANGELOG.md` structure adheres to monorepo conventions and Keep a Changelog principles.
- R6: Verify `gh release create` command syntax, argument flags, and release note markdown structure.
- R8: Documentation consistency check verifying skill discovery in `AGENTS.md` and process tables in `dev/README.md`.

## Rollout

Documentation and skill addition. No database migrations, daemon services, or production infrastructure required.
