---
name: release
description: >
  Coordinate OpenRelik releases: platform minor releases, component patch
  releases, post-merge tagging, and next-cycle development setup. Enforces
  pre-flight verification, changelog updates, draft GitHub release notes, and a
  mandatory human approval gate before pushing tags or publishing. Use for
  "release the platform", "cut a release", "release a patch", "prepare release",
  or /release <platform|patch|tag|dev>.
---

# Release

Coordinates OpenRelik platform releases, component patch releases, tagging, and
development cycle transitions. Automates local version bumping, dependency
alignment, changelog updates, and draft release notes while enforcing a strict human
approval gate before any external git push, tag creation, or release publication.

## Core Rules

1. **Mandatory Human Approval**: Local preparations (branching, version bumps,
   dependency locking, version checks, changelog updates, and draft release notes)
   run autonomously. No remote git push (`git push origin ...`), tag publishing, or
   GitHub release publication (`gh release edit --draft=false`) may execute without
   the user's explicit, interactive approval.
2. **Batch Tag Pushing**: GitHub Actions workflows do not start when more than three
   tags are pushed in a single command. Always push tags in groups of at most three:
   `git push origin tag1 tag2 tag3`.
3. **No Direct Pushes to Protected Branches**: Pushes to `main` must go through pull
   requests. Release branches (`release/<major>.<minor>`) only receive release
   commits and cherry-picked fixes.
4. **Strict Version Verification**: Every release step must pass
   `python3 .github/scripts/check-versions.py` before committing.

---

## Subcommands

### 1. `/release platform <version>`

Orchestrates a platform minor release (`X.Y.0`, e.g. `0.19.0`). A platform release
updates all components across the monorepo.

#### Stage 1: Libraries to PyPI
1. Verify the current branch is `main` and the worktree is clean (`git status`).
2. Create branch `release/libs-<version>`:
   ```sh
   git switch -c release/libs-<version>
   ./devctl release lib common <version>
   ./devctl release lib ai-common <version>
   ./devctl release lib worker-common <version>
   ./devctl release lib python-client <version>
   ```
3. Open a pull request against `main` (`Refs #<issue>`).
4. Once merged, switch to `main`, pull, tag, and push the tags:
   ```sh
   git switch main && git pull
   ./devctl release tag
   ```
   **Approval Gate**: Show the tags created. Obtain approval, then push tags in
   groups of at most three:
   ```sh
   git push origin common-v<version> ai-common-v<version> worker-common-v<version>
   git push origin python-client-v<version>
   ```
5. Wait for the `Publish Python Packages` GitHub Actions workflow to publish all four
   packages to PyPI before proceeding to Stage 2.

#### Stage 2: Move Consumers to New Minor
1. Create branch `release/consumers-<version>` from `main`.
2. Update library dependencies in `server/pyproject.toml`, `mcp/pyproject.toml`, and
   all `workers/*/pyproject.toml` to depend on `~=<version>`:
   - `openrelik-common~=<version>`
   - `openrelik-ai-common~=<version>`
   - `openrelik-worker-common~=<version>`
   - `openrelik-python-client~=<version>`
3. Set each worker's package version in `workers/*/pyproject.toml` to `<version>`.
4. Relock all Python packages:
   ```sh
   (cd server && uv lock)
   (cd mcp && uv lock)
   for d in workers/*/; do (cd "$d" && uv lock); done
   ```
5. Verify versions pass: `python3 .github/scripts/check-versions.py`.
6. Commit: `git commit -am "Move consumers to <version> libraries"` (`Refs #<issue>`).
7. Open a pull request against `main` and merge it. Do not tag yet (workers are
   tagged with the platform in Stage 3).

#### Stage 3: Cut Release Branch and Release Platform
1. On `main`:
   ```sh
   git switch main && git pull
   git switch -c release/<major>.<minor>
   ./devctl release platform <version>
   ```
2. Update root `CHANGELOG.md` with a new section for `[<version>] - YYYY-MM-DD`,
   including a summary, major highlights, and component changes.
3. Commit changelog changes: `git commit -am "Update changelog for <version>"`.
4. Generate draft release notes and create a draft release on GitHub:
   ```sh
   gh release create v<version> --draft --title "OpenRelik <version>" --notes-file <notes-file>
   ```

#### Stage 4: Human Approval Gate
1. Present the release report to the user:
   - Branch: `release/<major>.<minor>`
   - Platform version: `<version>`
   - List of tags created locally
   - Diff of `CHANGELOG.md`
   - Link/preview of draft GitHub release
2. **STOP**: Ask the user for explicit confirmation to push the release branch, push
   the tags, and publish the GitHub release.
3. After approval:
   ```sh
   git push origin release/<major>.<minor>
   ```
   Wait for CI tests (`Python Unit Tests` and `Frontend Unit Tests [sunstone]`) to pass.
   Push all tags in batches of at most three (using the push commands printed by
   `./devctl release`).
   Publish GitHub release:
   ```sh
   gh release edit v<version> --draft=false
   ```

#### Stage 5: Start Next Minor on Main
1. Create branch `release/dev-<next-minor>` from `main`.
2. Run `./devctl release dev <next-minor>.0`.
3. Open a pull request against `main` and merge it.

---

### 2. `/release patch <component> <version>`

Orchestrates a patch release (`X.Y.Z`, e.g. `0.18.1`).

#### For Core Services and Libraries (`server`, `ui`, `mcp`, `lib <name>`)
1. Ensure the fix is already merged into `main`.
2. Check out the release branch:
   ```sh
   git switch release/<major>.<minor> && git pull
   git cherry-pick -x <commit-sha>
   ```
3. Prepare release commit and tag:
   ```sh
   ./devctl release <component> <version>
   ```
   (For libraries, use `./devctl release lib <name> <version>`).
4. Update `CHANGELOG.md` under the release branch with the patch details.
5. Commit changelog: `git commit -am "Update changelog for <component> <version>"`.
6. Draft GitHub release notes:
   ```sh
   gh release create <tag> --draft --title "Release <label> <version>" --notes-file <notes-file>
   ```
7. **Human Approval Gate**: Present the commit, tag, and changelog diff. Ask for
   explicit confirmation.
8. After approval:
   ```sh
   git push origin release/<major>.<minor>
   ```
   Wait for CI tests to pass.
   ```sh
   git push origin <tag>
   gh release edit <tag> --draft=false
   ```

#### For Workers (`worker <name> <version>`)
1. On a branch from `main`:
   ```sh
   cd workers/<name> && uv lock --upgrade-package openrelik-worker-common && cd -
   ./devctl release worker <name> <version>
   ```
2. Update `CHANGELOG.md` with the worker fix summary.
3. Commit, open PR on `main`, and merge.
4. On `main`:
   ```sh
   git switch main && git pull
   ./devctl release tag
   ```
5. **Human Approval Gate**: Present the created tag `worker-<name>-v<version>`. Ask for
   approval, then push:
   ```sh
   git push origin worker-<name>-v<version>
   ```
   Draft and publish GitHub release notes.

---

### 3. `/release tag [commit]`

Tags release commits merged via pull requests.
1. Run `./devctl release tag [commit]` (defaults to `HEAD`).
2. Inspect the created tags.
3. **Human Approval Gate**: Show the tags created. Require approval before pushing:
   ```sh
   git push origin tag1 tag2 tag3
   ```

---

### 4. `/release dev <version>`

Advances `main` to `<version>.dev0` after cutting a platform release branch.
1. Run `./devctl release dev <version>`.
2. Open pull request on `main`.


---

## Changelog and Release Notes Format

### Root `CHANGELOG.md`
Every release adds an entry at the top of root `CHANGELOG.md`:
```markdown
## [<version>] - YYYY-MM-DD

<Short summary highlighting theme of release>

### Server
- ...

### Web UI
- ...

### Workers
- ...

### Libraries
- ...
```

### GitHub Release Notes
Generate release notes using the structure established in OpenRelik `v0.18.0`:
1. **Title**: `OpenRelik <version>` (for platform) or `Release <component> <version>` (for patch).
2. **Executive Summary**: 2-3 paragraphs describing key capabilities and motivations.
3. **Component Version Table**: Mapping of all monorepo components and their versions.
4. **Upgrade and Installation Guide**: Docker Compose instructions, environment variable updates in `config.env`, and database migrations (`alembic upgrade head`).
5. **Detailed Change List**: Grouped by component (Server, UI, Workers, Libraries).
6. **For Worker Authors**: Breaking API changes, dependency updates, or instructions for external workers.
