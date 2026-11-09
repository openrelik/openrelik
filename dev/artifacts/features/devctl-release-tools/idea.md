---
slug: devctl-release-tools
issue: 83
created: 2026-11-09
---
# Add release management and version checking to devctl

## Problem

Release preparation lives in a standalone script (`dev/release.py`) separate from `./devctl`. Maintainers cutting releases have to switch tools and run Python scripts directly. Version consistency rules are enforced by `dev/check-versions.py`, which is run by `release.py`, called during CI in GitHub Actions, and referenced in development instructions for contributors changing version files.

## Proposal

Move `dev/release.py` into `./devctl` as a native command (`./devctl release ...`) without keeping a standalone wrapper in `dev/`. Move `dev/check-versions.py` to `.github/scripts/check-versions.py` for CI, and have `./devctl release` always run it as a non-bypassable pre-commit gate.

## Users

Maintainers preparing releases and contributors modifying versions across monorepo components.

## Open questions

- None.
