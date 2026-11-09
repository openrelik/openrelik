---
slug: release-skill
issue: https://github.com/openrelik/openrelik/issues/88
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Research: Add release skill for platform, component, and patch releases

Notes and findings on designing a release skill for OpenRelik.

## What I wanted to know

1. How do platform releases, component patch releases, and development cycles work in OpenRelik today?
2. What does `./devctl release` do, and what manual steps remain unautomated?
3. What sequence constraints exist across monorepo components (PyPI publishing, consumer lockfiles, image building)?
4. How should the root `CHANGELOG.md` and GitHub release notes be formatted and maintained?
5. How should a release skill enforce human approval before irreversible actions (pushing tags, publishing packages, creating releases)?
6. What forensic provenance and supply-chain integrity guarantees must be preserved?

## What I found

### 1. Existing release architecture and tooling

OpenRelik consolidated its code from eight repositories into a single monorepo with release 0.18.0. Release workflows are documented in `dev/RELEASING.md` and `dev/PATCHING.md`, with core release automation in `dev/tools/devctl/src/devctl/release.py`.

#### devctl release commands
- `./devctl release platform <version>`:
  - Used for platform minor releases (`X.Y.0` where `patch == 0`).
  - Updates `VERSION`, `server/pyproject.toml`, `web/*/package.json`, `mcp/pyproject.toml`, `deploy/docker/config.env` (`OPENRELIK_VERSION` and worker version variables), and `deploy/docker/install.sh` (`RELEASES=(...)`).
  - Runs `.github/scripts/check-versions.py` as a non-bypassable gate.
  - Commits `Release <version>`.
  - Tags `v<version>`, `server-v<version>`, `ui-v<version>`, `mcp-v<version>`, and all matching workers/libraries if on `release/<major>.<minor>`.
- `./devctl release server|ui|mcp|lib <name>|worker <name> <version>`:
  - Bumps the specific component's `pyproject.toml` or `package.json`.
  - Runs `uv lock` (for Python packages) and `.github/scripts/check-versions.py`.
  - Commits `Release <label> <version>`.
  - Tags immediately if on a `release/*` branch; skips tagging if on a PR branch (to allow squash-merging before tagging).
- `./devctl release dev <version>`:
  - Advances `main` to `<next-minor>.dev0` across all platform components and libraries after cutting a release branch.
- `./devctl release tag [commit]`:
  - Inspects the commit against its parent to detect changed component versions and creates corresponding annotated git tags.

### 2. CI/CD pipelines and external triggers

- **PyPI (`.github/workflows/release-pypi.yml`)**:
  - Triggered on tag pushes: `common-v*`, `ai-common-v*`, `worker-common-v*`, `python-client-v*`.
  - Uses PyPI trusted publishing (OIDC).
  - Once published to PyPI, a release version is permanently immutable. A failed or bad release cannot be overwritten; it requires a new patch version.
- **Docker Images (`.github/workflows/images.yml`)**:
  - Triggered on tag pushes: `server-v*`, `ui-v*`, `mcp-v*`, `worker-*-v*`.
  - Tags images on GHCR with both the full version (e.g. `0.18.1`) and the floating minor tag (`0.18`).
  - Note: The platform tag `vX.Y.Z` itself builds no images; the component tags build them.
- **Tag push limitation**:
  - GitHub Actions will not trigger workflows if more than 3 tags are pushed in a single `git push`.
  - `devctl release` and `dev/RELEASING.md` explicitly enforce pushing tags in batches of at most 3 (`git push origin tag1 tag2 tag3`).

### 3. Workflow differences: Platform vs. Patch releases

| Aspect | Platform Release (`X.Y.0`) | Patch / Component Release (`X.Y.Z`) |
| --- | --- | --- |
| **Branch** | `release/<major>.<minor>` (cut from `main`) | `release/<major>.<minor>` (cherry-picked from `main`) or `main` (for workers) |
| **Scope** | Platform-wide: server, UI, MCP, libraries, 23 workers | Targeted component(s) |
| **Sequencing** | 1. Release libraries to PyPI<br>2. Move consumers to new minor & relock<br>3. Cut release branch & run `devctl release platform`<br>4. Push branch & tags<br>5. Advance `main` with `devctl release dev` | 1. Merge fix on `main`<br>2. Cherry-pick to `release/*`<br>3. Run `devctl release <component>`<br>4. Push branch & tags |
| **Tags** | 28+ tags (`v*`, `server-v*`, `ui-v*`, `mcp-v*`, `worker-*-v*`, `lib-*-v*`) | 1 or few component tags (e.g., `server-v0.18.1`) |

### 4. Gaps identified in current documentation

As noted in `dev/RELEASING.md` ("Not covered yet"):
1. Moving consumers to the new minor (updating dependencies across `server/`, `mcp/`, and all 23 workers in `workers/`) is currently done manually by hand.
2. No changelog files currently exist in the repository; notes have been placed directly in GitHub Releases.
3. External worker developers currently rely on release notes to discover breaking changes or new dependency requirements in `openrelik-worker-common`.

### 5. Changelog and Release Notes structure

- **Root `CHANGELOG.md`**:
  - Needs a consistent, durable format (e.g. Keep a Changelog structure adapted for monorepos).
  - Should include release date, version header, a concise summary of the release theme, highlights of major changes, and component breakdown.
- **GitHub Release (`gh release create`)**:
  - For platform releases (`vX.Y.0`), create a comprehensive release note attached to `vX.Y.0`.
  - Include sections established in 0.18.0:
    - Executive summary
    - Component version mapping table
    - Upgrade instructions & database migrations (`alembic upgrade head`)
    - Configuration changes (e.g. `settings_example.toml`)
    - What changed by component (Server, UI, Workers, Libraries)
    - Notes for worker authors (`openrelik-worker-common` changes)
  - For patch releases, create a targeted release for the component tag (or platform patch tag) summarizing the specific fix and cherry-picked commits.

### 6. Forensic integrity and supply-chain considerations

In digital forensics:
- **Reproducibility**: Evidence processing must be attributable to exact tool versions. Docker images and PyPI packages must match the exact git commit and tag.
- **Immutability**: Git tags and release packages must never be overwritten, retagged, or force-pushed.
- **Audit trail**: Every release commit must be verified against `.github/scripts/check-versions.py` to ensure no version skew between interdependent components.
- **Mandatory human gate**: Autonomous agents must never perform external network publications (pushing tags, publishing PyPI packages, publishing public GitHub releases) without explicit, interactive maintainer confirmation.

## Design for the Release Skill

### Skill structure: `.agents/skills/release/SKILL.md`

The skill uses explicit subcommands (Option B) matching the commands in `./devctl release`, giving maintainers deterministic control over each release operation:

1. `/release platform <version>`
   - Orchestrates the multi-stage platform minor release (`X.Y.0`).
   - Stage 1 (Libraries): Prepares library bumps (`./devctl release lib`), PR on `main`, tags after merge, and verifies PyPI publishing.
   - Stage 2 (Consumers): Automatically updates `~=X.Y.0` dependencies across server, MCP, and all 23 workers; relocks with `uv lock`; commits and opens PR on `main`.
   - Stage 3 (Platform release): Checks out `release/X.Y`, runs `./devctl release platform <version>`, updates `CHANGELOG.md`, and drafts the GitHub release notes (`gh release create --draft`).
   - Stage 4 (Human Approval Gate): Presents verification report and diffs; requires explicit maintainer approval before pushing branch, pushing tags (batched in groups of 3), and publishing the release.
   - Stage 5 (Dev cycle): Runs `./devctl release dev <next-minor>.0` on `main`.

2. `/release patch <component> <version>`
   - Orchestrates a component patch release (`X.Y.Z`).
   - Component choices: `server`, `ui`, `mcp`, `lib <name>`, or `worker <name>`.
   - Core components / libraries: Switched to `release/X.Y`, cherry-picks fix commit, runs `./devctl release <component> <version>`, updates `CHANGELOG.md`, and drafts patch release notes.
   - Workers: Prepares PR on `main` with relocked dependency and bumped worker version; tags after merge.
   - Human Approval Gate: Requires explicit approval before pushing branch, tag, and publishing release.

3. `/release tag [commit]`
   - Inspects merged commit, runs `./devctl release tag`, displays created tags, and requires approval before pushing tags to `origin` in batches of 3.

4. `/release dev <version>`
   - Advances `main` to `<next-minor>.dev0` across all platform components and libraries.

### Adopted Core Requirements

The skill will implement the following capabilities:
1. **Automated consumer dependency updates**: Automates Step 2 of `dev/RELEASING.md` by bumping worker and server library dependencies to `~=X.Y.0`, setting worker package versions, and running `uv lock` across all workers.
2. **Commit parsing and changelog generation**: Parses commits between the previous tag and `HEAD`, categorizes them by component, and generates the draft entry for root `CHANGELOG.md` as well as release notes for GitHub.
3. **Draft GitHub release preview**: Creates releases as drafts (`gh release create --draft`) so maintainers can inspect and preview the formatted notes on GitHub before publishing.

### Human Approval Gate Architecture

To ensure safety, the skill divides every release workflow into two phases:

1. **Phase 1: Local Preparation and Verification (Autonomous)**
   - Pre-flight checks: clean git worktree, correct branch, sync with remote (`git fetch origin`).
   - Run local release commands (`./devctl release ...`).
   - For platform releases: update consumer dependencies and run `uv lock` across workers.
   - Run version verification gate (`.github/scripts/check-versions.py`).
   - Parse commits, generate release summary, and update `CHANGELOG.md`.
   - Create draft GitHub release notes via `gh release create --draft`.
   - Present the release verification report (diffs, tags to be pushed, test commands).

2. **Phase 2: Execution and Publication (Gated by Human Approval)**
   - **Mandatory Stop**: The agent presents the full release summary, tags, and diffs to the maintainer and asks for explicit approval.
   - Only after receiving explicit approval:
     - Push the release branch to GitHub.
     - Push tags in safe batches of at most 3 (`git push origin tag1 tag2 tag3`).
     - Publish the GitHub release (`gh release edit <tag> --draft=false`).

## Ideas it gave me

The following proposals are confirmed for inclusion in the skill's design and spec:
- **Automated consumer bump helper**: Automate Step 2 of `dev/RELEASING.md` (updating worker and server dependencies to `~=X.Y.0` and running `uv lock`) during platform releases.
- **Changelog and release notes generator**: Inspect git commits between release tags, group changes by component, and draft both `CHANGELOG.md` and GitHub release notes.
- **Draft GitHub release preview**: Create releases with `--draft` first, enabling visual inspection on GitHub before maintainers approve publishing.

## Sources

- `dev/RELEASING.md`: Platform release instructions and sequencing.
- `dev/PATCHING.md`: Patch release instructions, cherry-picking, and worker releases.
- `dev/tools/devctl/src/devctl/release.py`: Source implementation of `./devctl release`.
- `.github/workflows/images.yml`: GHCR image build workflows and tag triggers.
- `.github/workflows/release-pypi.yml`: PyPI publishing workflow and OIDC permissions.
- `.github/scripts/check-versions.py`: Version validation gate.
- OpenRelik 0.18.0 GitHub Release: `https://github.com/openrelik/openrelik/releases/tag/v0.18.0`.
