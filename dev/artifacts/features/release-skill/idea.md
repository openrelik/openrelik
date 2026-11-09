---
slug: release-skill
issue: https://github.com/openrelik/openrelik/issues/88
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Add release skill for platform, component, and patch releases

## Problem

Releasing OpenRelik involves multi-step coordination across monorepo components, version checks, git branches, and tags. While `./devctl release` handles local version bumping and tagging, maintainers still manually drive the end-to-end workflow for platform minor releases, patch releases, and component releases. Maintainers must also update the root changelog, draft GitHub release notes, and ensure no validation steps are skipped.

## Proposal

Add a `.agents/skills/release` skill that guides an agent through platform releases, component releases (workers, libraries, MCP), and patch releases using `./devctl release`. The skill updates the root `CHANGELOG.md` with a concise summary highlighting major changes, drafts the GitHub release with release notes via `gh release`, prepares commits and tags, and enforces a mandatory human approval gate before creating tags, pushing branches, or publishing releases.

## Users

OpenRelik maintainers preparing and publishing platform, component, and patch releases.

## Open questions

- None.
