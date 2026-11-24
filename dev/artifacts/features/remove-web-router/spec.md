---
slug: remove-web-router
issue: https://github.com/openrelik/openrelik/issues/144
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Spec: Remove web-router and UI switcher in favor of single-UI deployment

Implements `idea.md` (#144), superseding `dev/artifacts/features/ui-switcher/` (#107).

## Scope

- Delete `web/router/` (`openrelik-web-router`) and stop publishing its Docker image.
- Remove runtime UI switcher utilities, UI controls, tests, router-only asset namespacing, `VITE_HMR_CLIENT_PORT` plumbing, and Nginx `Vary: Cookie` headers from `web/runestone` and `web/sunstone`.
- Remove cross-UI `openrelik.auth.user` sessionStorage cleanup added to `web/sunstone`.
- Serve a single web UI directly on `UI_PORT` in `compose.yml` (Runestone active by default, Sunstone commented out below it) and a single `openrelik-ui` service on `:8711` in `deploy/docker/docker-compose.yml` defaulting to `openrelik-web-runestone` via `OPENRELIK_UI_IMAGE`.
- Keep publishing `openrelik-ui` from `web/sunstone/Dockerfile` (preserving compatibility for older deployments), alongside `openrelik-web-sunstone` (`web/sunstone/Dockerfile`) and `openrelik-web-runestone` (`web/runestone/Dockerfile`).
- Update CI image comments, `devctl` test fixture names, and docs (`web/README.md`, `README.md`, `AGENTS.md`).
- Out of scope: backend API or database changes, deleting the historical `dev/artifacts/features/ui-switcher/` record, or cutting `openrelik-ui` over to `web/runestone`.

## Requirements

- R1: `web/router/` is removed completely (`.dockerignore`, `Dockerfile`, `nginx/configure_router.sh`, `nginx/nginx.conf`), and no active code, compose file, CI config, or active documentation references `web-router`, `openrelik-web-router`, `OPENRELIK_UIS`, `OPENRELIK_DEFAULT_UI`, or `/__openrelik/`.
- R2: `web/runestone` removes `src/utils/uiSwitch.ts`, `src/utils/__tests__/uiSwitch.test.ts`, the UI selector in `SettingsDialog.vue`, the UI switch buttons in `AccountDialog.vue`, `clearUiSwitchCache()` in `stores/auth.ts`, and the corresponding switcher test cases in `SettingsDialog.test.ts` and `AccountDialog.test.ts`; reverts Vite `build.assetsDir` to Vite's default (`assets`), removes `VITE_HMR_CLIENT_PORT` from `vite.config.ts`, moves `public/assets/runestone/fonts/` back to `public/fonts/` and updates `src/assets/main.css`, `web/runestone/AGENTS.md`, and `web/runestone/docs/design-system.md` to reference `/fonts/` and `public/fonts/`; updates `nginx/substitute_env_variables.sh` to `ROOT_DIR=/usr/share/nginx/html/assets`; removes `Vary: Cookie` from `nginx/nginx.conf` (keeping `Cache-Control: no-cache` on `/index.html`); and passes `npm run check`, `npm run test:coverage` (>= 85% V8 line coverage on touched files), and `npm run build`.
- R3: `web/sunstone` removes `src/utils/uiSwitch.js`, `src/utils/__tests__/uiSwitch.spec.js`, the UI selector in `UserSettings.vue`, the UI switch menu items in `SystemMenu.vue`, and `sessionStorage.removeItem("openrelik.auth.user")` in `RestApiClient.js`, `ProfileMenu.vue`, and `Login.vue`; reverts Vite `build.assetsDir` to Vite's default (`assets`), removes `VITE_HMR_CLIENT_PORT` from `vite.config.mjs`, updates `nginx/substitute_env_variables.sh` to `ROOT_DIR=/usr/share/nginx/html/assets`, removes `Vary: Cookie` from `nginx/nginx.conf` (keeping `Cache-Control: no-cache` on `/index.html`); and passes `yarn test`, `yarn lint`, and `yarn build`.
- R4: `deploy/docker/docker-compose.yml` replaces `openrelik-web-router`, `openrelik-web-sunstone`, and `openrelik-web-runestone` with a single `openrelik-ui` service exposed on `127.0.0.1:8711:8711` using `image: ghcr.io/openrelik/${OPENRELIK_UI_IMAGE:-openrelik-web-runestone}:${OPENRELIK_UI_VERSION:-${OPENRELIK_VERSION}}` with `OPENRELIK_SERVER_URL`, `OPENRELIK_API_VERSION`, and `OPENRELIK_AUTH_METHODS`; `deploy/docker/config.env` removes `OPENRELIK_DEFAULT_UI` and `OPENRELIK_UIS` and sets `OPENRELIK_UI_IMAGE=openrelik-web-runestone` with a comment documenting `openrelik-web-sunstone` as the Sunstone option.
- R5: `compose.yml` removes `web-router`, runs `web-runestone` as the single active UI service bound to `127.0.0.1:${UI_PORT:-3000}:5173` (removing `VITE_HMR_CLIENT_PORT` and `--port 3050`), and keeps `web-sunstone` commented out right below it bound to `127.0.0.1:${UI_PORT:-3000}:3000` (without `VITE_HMR_CLIENT_PORT`) with a comment explaining how to swap UIs; `.env.example` removes `OPENRELIK_DEFAULT_UI` and `OPENRELIK_UIS`; `dev/tools/devctl/tests/test_units.py` renames stale `router` fixture labels.
- R6: `.github/images.toml` removes `openrelik-web-router` and keeps `openrelik-ui` (`web/sunstone/Dockerfile`), `openrelik-web-sunstone` (`web/sunstone/Dockerfile`), and `openrelik-web-runestone` (`web/runestone/Dockerfile`); `.github/scripts/images.py` passes `check` and selects those three web images on `ui-v*` tags; `.github/scripts/images.py` and `.github/workflows/images.yml` comments reflect the three web images; and `web/README.md`, `README.md`, and `AGENTS.md` document Runestone as the default UI, Sunstone as opt-in, and single-UI selection via Compose.

## Tasks

- [x] T1: Delete `web/router/.dockerignore`, `web/router/Dockerfile`, `web/router/nginx/configure_router.sh`, and `web/router/nginx/nginx.conf` (R1).
- [x] T2: Remove UI switcher code, tests, asset namespacing, `VITE_HMR_CLIENT_PORT`, and `Vary: Cookie` in `web/runestone`: delete `src/utils/uiSwitch.ts` and `src/utils/__tests__/uiSwitch.test.ts`; update `src/components/dialogs/SettingsDialog.vue`, `src/components/dialogs/AccountDialog.vue`, `src/stores/auth.ts`, `src/components/dialogs/__tests__/SettingsDialog.test.ts`, `src/components/dialogs/__tests__/AccountDialog.test.ts`, `vite.config.ts`, `nginx/nginx.conf`, `nginx/substitute_env_variables.sh`, `src/assets/main.css`, `AGENTS.md`, and `docs/design-system.md`; move `public/assets/runestone/fonts/` back to `public/fonts/` (R2).
- [ ] T3: Remove UI switcher code, tests, cross-UI sessionStorage cleanup, asset namespacing, `VITE_HMR_CLIENT_PORT`, and `Vary: Cookie` in `web/sunstone`: delete `src/utils/uiSwitch.js` and `src/utils/__tests__/uiSwitch.spec.js`; update `src/components/SystemMenu.vue`, `src/components/UserSettings.vue`, `src/RestApiClient.js`, `src/components/ProfileMenu.vue`, `src/views/Login.vue`, `vite.config.mjs`, `nginx/nginx.conf`, and `nginx/substitute_env_variables.sh` (R3).
- [ ] T4: Update `deploy/docker/docker-compose.yml` and `deploy/docker/config.env` to run a single `openrelik-ui` service on `127.0.0.1:8711:8711` using `OPENRELIK_UI_IMAGE=openrelik-web-runestone` by default (R4).
- [ ] T5: Update `compose.yml`, `.env.example`, and `dev/tools/devctl/tests/test_units.py` to remove `web-router`, serve `web-runestone` directly on `UI_PORT` (`:5173`), keep `web-sunstone` commented out in `compose.yml`, and clean up stale router test fixture names (R5).
- [ ] T6: Update `.github/images.toml`, `.github/scripts/images.py`, `.github/workflows/images.yml`, `web/README.md`, `README.md`, and `AGENTS.md` to drop `openrelik-web-router`, keep `openrelik-ui` on `web/sunstone`, and document single-UI selection with Runestone as default (R6).

## Tests

- R1: Run `rg -n "web[-_]router|uiSwitch|OPENRELIK_UIS|OPENRELIK_DEFAULT_UI|__openrelik|VITE_HMR_CLIENT_PORT|assets/sunstone|assets/runestone" --hidden -g '!.git' -g '!dev/artifacts/**'` and confirm zero matches.
- R2: Run `npm run check`, `npm run test:coverage`, and `npm run build` in `web/runestone/`, verifying `dist/assets/` bundle output, `dist/fonts/` self-hosted fonts, and >= 85% V8 line coverage on all touched runtime files.
- R3: Run `yarn test`, `yarn lint`, and `yarn build` in `web/sunstone/`, verifying `dist/assets/` bundle output.
- R4, R5: Validate `docker compose --env-file deploy/docker/config.env -f deploy/docker/docker-compose.yml config --quiet` and `docker compose -f compose.yml config --quiet`; run `uv run pytest` in `dev/tools/devctl/`; verify on a dev worktree stack (`./devctl stack up`) that `http://localhost:<UI_PORT>` serves Runestone directly with self-hosted fonts from `/fonts/` and no UI switcher controls in Settings or Account.
- R6: Run `python3 .github/scripts/images.py check`, `python3 .github/scripts/images.py matrix --registry ghcr.io/openrelik --sha test123 --all`, `python3 .github/scripts/images.py matrix --registry ghcr.io/openrelik --tag ui-v0.19.0` (against matching test version or verifying `--changed` on `web/sunstone/` and `web/runestone/`), and `uv run --python 3.12 .github/scripts/check-versions.py`.

## Rollout

- No database migrations or server configuration changes.
- Existing deployments pulling `ghcr.io/openrelik/openrelik-ui` continue receiving Sunstone on port `8711` unchanged.
- Fresh installs via `deploy/docker/install.sh` and deployments updating `deploy/docker/docker-compose.yml` and `deploy/docker/config.env` run a single `openrelik-ui` container on `:8711` using `ghcr.io/openrelik/openrelik-web-runestone` by default. Operators who want Sunstone set `OPENRELIK_UI_IMAGE=openrelik-web-sunstone` in `config.env` and recreate the container.
- Deployments upgrading from `openrelik-web-router` should run `docker compose up -d --remove-orphans` so the old `openrelik-web-router`, `openrelik-web-sunstone`, and `openrelik-web-runestone` containers are cleaned up.
- Local developers running `./devctl stack up` switch to `web-runestone` directly on `UI_PORT` (`--remove-orphans` removes the old `web-router` and `web-sunstone` containers).
