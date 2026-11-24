---
slug: remove-web-router
issue: https://github.com/openrelik/openrelik/issues/144
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-24
Checks run:
- `rg` stray reference check across worktree (0 matches)
- `web/runestone`: `npm run check` (`vue-tsc --build`, `eslint --max-warnings=0`, `prettier --check`, 152 Vitest test files), V8 line coverage (`AccountDialog.vue` 100%, `SettingsDialog.vue` 100%, `auth.ts` 96.96%), `npm run build`, `npx prettier --check AGENTS.md docs/design-system.md`
- `web/sunstone`: `npm run test` (27 test files, 434 tests), `npm run lint`, `npm run build`
- `dev/tools/devctl`: `uv run pytest` (42 passed)
- `.github/scripts/images.py check` and `matrix` (`--all`, `--changed`)
- `.github/scripts/check-versions.py` (0 errors, 26 warnings)
- `docker compose config --quiet` on `compose.yml` and `deploy/docker/docker-compose.yml` (Runestone default and `OPENRELIK_UI_IMAGE=openrelik-web-sunstone`)
- Production Docker image smoke builds (`web/runestone/Dockerfile`, `web/sunstone/Dockerfile`) and `sh -n` on both `substitute_env_variables.sh` scripts
- Live dev stack smoke test (`./devctl stack up -w remove-web-router`, 8/8 services healthy, `http://localhost:3001/` and `/fonts/...` `200 OK`)

What this change does: Removes the `web/router` Nginx proxy (`openrelik-web-router`) and all in-app UI switcher code, tests, asset namespacing, and `Vary: Cookie` headers from Runestone and Sunstone. Both local development (`compose.yml`) and production (`deploy/docker/docker-compose.yml`) now serve one UI container directly, defaulting to Runestone with Sunstone selectable through Compose configuration, while `.github/images.toml` continues publishing `openrelik-ui` from `web/sunstone` for older deployments.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done

## Should fix

1. **Sunstone dev commands point to a commented-out Compose service** (`web/sunstone/AGENTS.md:L27-36`, `L58-62`)
   - **What this is:** The component guide tells developers and agents how to run Sunstone tests, lint, and builds on the dev stack.
   - **Problem:** `compose.yml` now comments out `web-sunstone` by default, so running `docker compose exec web-sunstone yarn test` (or `lint` / `build`) on a default stack fails with `no such service: web-sunstone`.
   - **Fix:** Update `web/sunstone/AGENTS.md` to state that `web-sunstone` is disabled by default in `compose.yml`: run `yarn` directly in `web/sunstone/`, or uncomment `web-sunstone` (and comment out `web-runestone`) in `compose.yml` before using `docker compose exec web-sunstone`.
   - **If we skip it:** Anyone following the root `AGENTS.md` -> `web/sunstone/AGENTS.md` instructions hits a broken test command on a fresh checkout.

## Nice to have

2. **Contributing guide lists only Sunstone as the web UI** (`CONTRIBUTING.md:L18-21`)
   - **What this is:** The top-level list of component `AGENTS.md` guides for contributors.
   - **Problem:** Root `AGENTS.md` and `README.md` now list `web/runestone` as the default UI and `web/sunstone` as legacy, while `CONTRIBUTING.md` still lists only `web/sunstone/AGENTS.md (web UI, codename sunstone)`.
   - **Fix:** Add `- web/runestone/AGENTS.md (default web UI, codename runestone)` and label `web/sunstone/AGENTS.md` as the legacy web UI.
   - **If we skip it:** Contributors working on the default UI miss `web/runestone/AGENTS.md` if they start from `CONTRIBUTING.md`.

Verdict: fix 1 first.

---

# Review Round 2

Date: 2026-11-24
Checks run:
- `rg` stray reference check across worktree (0 matches)
- `web/runestone`: `vue-tsc --noEmit` (all tsconfigs), `eslint --max-warnings=0`, `prettier --check` (`src/`, `AGENTS.md`, `docs/design-system.md`), `npm run check` and `npm run build` (no Runestone source changes since Round 1)
- `web/sunstone`: `eslint`, `npm run test` and `npm run build` (no Sunstone code changes since Round 1; docs-only fix in `web/sunstone/AGENTS.md`)
- `dev/tools/devctl`: `uv run pytest` (42 passed)
- `.github/scripts/images.py check` and `matrix`, `.github/scripts/check-versions.py` (0 errors)

What this change does: Deletes the `web/router` Nginx multi-UI proxy and removes runtime UI switcher utilities, menus, asset path namespacing, `VITE_HMR_CLIENT_PORT` handling, and `Vary: Cookie` headers from both `web/runestone` and `web/sunstone`. Both `compose.yml` and `deploy/docker/docker-compose.yml` now run a single UI container directly on the UI port defaulting to Runestone, with Sunstone selectable via configuration, while `.github/images.toml` keeps publishing `openrelik-ui` from `web/sunstone` alongside `openrelik-web-sunstone` and `openrelik-web-runestone`.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done

Verdict: LGTM
