---
slug: ui-switcher
issue: https://github.com/openrelik/openrelik/issues/107
created: 2026-11-16
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-16
Checks run:
- `configure_router.sh` shell tests and container `nginx -t` (including 50-char UI id)
- `web/sunstone`: `yarn lint:check`, `yarn test` (28 files, 464 tests), `yarn build`
- `web/runestone`: `npm run format:check`, `npm run lint:check`, `npm run type-check`, `npm run test:coverage` (152 files, 1,116 tests; `AccountDialog.vue` 100%, `SettingsDialog.vue` 100%, `LoginView.vue` 98.27%, `uiSwitch.ts` 94.31%), `npm run build`
- `docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/config.env config -q` and `docker compose -f compose.yml config -q`
- `uv run --directory dev/tools/devctl pytest` (42 passed)
- `uv run --python 3.12 .github/scripts/images.py check` (32 images, 34 builds), `images.py matrix` (`--all`, `--changed`, `--tag ui-v0.19.0`), `uv run --python 3.12 .github/scripts/check-versions.py` (0 errors, 26 warnings)
- End-to-end Docker smoke tests (`openrelik-ui:test`, `openrelik-web-runestone:test`, `openrelik-web-router:test` fronting 3 upstreams including HTTP/1.1 WebSocket upgrade)

What this change does: Adds a config-driven Nginx router (`openrelik-web-router` in `web/router/`) so `sunstone`, `runestone`, and optional third-party UI containers share one origin and port while users switch UIs by browser cookie. Namespaces static assets under `/assets/sunstone/` and `/assets/runestone/`, adds dynamic UI switcher controls backed by `GET /__openrelik/uis.json` to both UIs, routes dev (`compose.yml`, `devctl`) and deployment (`deploy/docker/`) traffic through the router, and updates CI release scripts and docs to publish all four web images together on `ui-v*` tags.

## Requirements
- R1: done (router Nginx config generation reviewed; container build and HTTP/WebSocket smoke checks not run in reviewer sandbox, verified separately by orchestrator)
- R2: done (Vite production builds output to `assets/sunstone` and `assets/runestone` with placeholders intact)
- R3: partial (explicit logout clears `openrelik.auth.user`, while `401` token refresh expiry and `/login` in Sunstone leave it behind; Sunstone UI switcher components have no component tests)
- R4: done (`AccountDialog.vue` 100%, `SettingsDialog.vue` 100%, `LoginView.vue` 98.27%, and `uiSwitch.ts` 94.31% V8 line coverage; all 1,116 Runestone tests pass)
- R5: done (`docker compose config` verified by orchestrator)
- R6: done (all 42 `devctl` pytest tests pass; `docker compose config` verified by orchestrator)
- R7: done (`images.py check`, `images.py matrix`, `check-versions.py` with 0 errors, and `test_release.py` pass)

## Must fix

1. **Stale Runestone user stays cached after Sunstone 401 expiry or re-login** (`web/sunstone/src/RestApiClient.js:L142-148`, `web/sunstone/src/views/Login.vue:L217-221`)
   - **What this is:** Sunstone's token refresh failure handler and login page setup when sharing the browser origin with Runestone.
   - **Problem:** `ProfileMenu.vue` clears `openrelik.auth.user` from `sessionStorage` (tab-scoped browser storage) on explicit logout, while `RestApiClient.js` on a failed `401` (unauthorized) token refresh only removes `csrfToken` before redirecting to `/login`, and `Login.vue` never clears it. If Alice uses Runestone, switches to Sunstone, lets her session expire, and Bob signs in on Sunstone and switches to Runestone, `useAuthStore()` reads Alice from `sessionStorage` and `router/index.ts:L100` skips fetching `/users/me/`, showing Alice's identity and user ID checks under Bob's session cookie.
   - **Fix:** Call `sessionStorage.removeItem("openrelik.auth.user")` in `RestApiClient.js:L146` right beside `sessionStorage.removeItem("csrfToken")` and in `Login.vue` `created()` so both session expiry and OAuth/local re-login clear cached Runestone user metadata.
   - **If we skip it:** After any session expiry and user switch in Sunstone within the same tab, Runestone displays the previous analyst's username and checks client-side folder delete permissions against the wrong user ID.

## Should fix

2. **Unreachable `loc.reload()` branch in both UI switch helpers** (`web/runestone/src/utils/uiSwitch.ts:L210-215`, `web/sunstone/src/utils/uiSwitch.js:L197-208`)
   - **What this is:** The post-cookie navigation step in `switchToUi` in both frontends.
   - **Problem:** Both `normalizeUiSwitchPath` and `normalizeSunstonePath` strip URL `#` fragments, so `targetPath` never contains `#`. When `loc.hash` is non-empty, `currentPath` contains `#` and `targetPath === currentPath` is always false, making `loc.reload()` (and `reload` on `SwitchLocation` in `uiSwitch.ts:L32`) unreachable dead code.
   - **Fix:** Delete the `if (loc.hash && targetPath === currentPath ...)` block in `uiSwitch.ts` and `uiSwitch.js`, along with `reload` on `SwitchLocation` and the test stubs. Removing the `#` fragment in `loc.assign(targetPath)` already triggers a full page request.
   - **If we skip it:** Dead code stays in both modules and leaves `uiSwitch.ts:L214` uncovered.

3. **Fixed footer height clips wrapped switch buttons in `AccountDialog.vue`** (`web/runestone/src/components/dialogs/AccountDialog.vue:L403-416`)
   - **What this is:** The bottom bar of Runestone's account modal holding "Sign out" and the `flex-wrap` UI switch buttons.
   - **Problem:** The footer uses a fixed height `h-10` (40px) inside a dialog with `overflow-hidden` (`AccountDialog.vue:L224`). When three or more UIs are configured (or two UIs wrap on a narrow screen), the `flex-wrap` container wraps onto a second row taller than 40px and overflows the fixed footer bar.
   - **Fix:** Change `h-10` to `min-h-10 py-1.5` on `AccountDialog.vue:L405` so a single row stays 40px tall while wrapped rows expand cleanly.
   - **If we skip it:** Multi-UI switch buttons wrap past the footer border and clip when three or more UIs are registered.

4. **Test-only reset hook exported outside Runestone's auth lifecycle** (`web/runestone/src/utils/uiSwitch.ts:L46-49`, `web/runestone/src/stores/auth.ts:L80-114`)
   - **What this is:** `clearUiSwitchCache()` clears the module-scoped `cachedPromise` in `uiSwitch.ts` and is called only by test files.
   - **Problem:** `web/runestone/AGENTS.md` (§1 and §6) requires module-scoped caches to clear in `stores/auth.ts` `setUser(null)` and forbids exporting test-only reset hooks. Right now `clearUiSwitchCache()` is documented as "Primarily used by tests" and has no production caller.
   - **Fix:** Call `clearUiSwitchCache()` inside `setUser(null)` in `web/runestone/src/stores/auth.ts` (and update its JSDoc to match `clearWorkers()`), or remove the export and reset module state in tests with `vi.resetModules()`.
   - **If we skip it:** Module-level state leaks across sign-outs if router config changes, and `uiSwitch.ts` breaks Runestone's singleton reset convention.

## Nice to have

5. **Unused `ui_ids` variable in router generator** (`web/router/nginx/configure_router.sh:L100`)
   - **What this is:** A shell variable initialized to `""` before parsing `OPENRELIK_UIS`.
   - **Problem:** `ui_ids` is never read or assigned anywhere else in `configure_router.sh`.
   - **Fix:** Delete line 100 (`ui_ids=""`).
   - **If we skip it:** One harmless unused line remains in the entrypoint script.

Verdict: fix 1 through 4 first.
Lean: -12 lines possible.
Not checked: Full `./devctl stack up` interactive browser session with live Vite HMR and backend API (verified container images + HTTP/WebSocket upgrade via Docker smoke tests instead); external `google/osdfir-infrastructure` Helm chart (out of scope per spec).

---

# Review Round 2

Date: 2026-11-16
Round 1 resolutions (`1305fc6`):
- Fixed 1: cleared `openrelik.auth.user` on 401 refresh failure (`web/sunstone/src/RestApiClient.js`) and `/login` (`web/sunstone/src/views/Login.vue`), and updated `spec.md` (`R3`, `T3`).
- Fixed 2: removed unreachable `loc.reload()` branch and `reload` stubs in `web/sunstone/src/utils/uiSwitch.js`, `uiSwitch.spec.js`, `web/runestone/src/utils/uiSwitch.ts`, and `uiSwitch.test.ts`.
- Fixed 3: changed `h-10` to `min-h-10 flex-wrap py-1.5` in `web/runestone/src/components/dialogs/AccountDialog.vue`.
- Fixed 4: wired `clearUiSwitchCache()` into `setUser(null)` in `web/runestone/src/stores/auth.ts` and updated its JSDoc.
- Fixed 5: deleted unused `ui_ids=""` in `web/router/nginx/configure_router.sh`.

Checks run:
- `web/router`: `sh -n nginx/configure_router.sh`, local `OPENRELIK_UIS` script smoke check, and container `nginx -t`
- `web/sunstone`: `yarn lint:check`, `yarn test` (28 files, 464 tests), `yarn build`
- `web/runestone`: `npm run format:check`, `npm run lint:check`, `npm run type-check`, `npm run test:coverage` (152 files, 1,116 tests; `All files` 98.55% lines, `auth.ts` 97.01%, `uiSwitch.ts` 95.34%, `LoginView.vue` 98.27%), `npm run build`
- Clean-context Round 2 reviewer also verified `devctl` pytest (42 passed), `sh -n` across all three Nginx shell scripts, `images.py check` / `matrix`, and `check-versions.py` (0 errors)

## Requirements
- R1: partial: `web/router/nginx/configure_router.sh` has a regex bug in `$cookie_secure_flag` on direct `https` and no automated tests.
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done

## Should fix

1. **`$cookie_secure_flag` omits `; Secure` on direct HTTPS connections** (`web/router/nginx/configure_router.sh:L290-293`)
   - **What this is:** An Nginx `map` block combines the connection scheme and `X-Forwarded-Proto` header into `"$scheme:$http_x_forwarded_proto"` to add `; Secure` to the `openrelik_ui` cookie on HTTPS requests.
   - **Problem:** When Nginx itself handles TLS (`$scheme` is `https`) without an upstream proxy setting `X-Forwarded-Proto`, the input string is `"https:"`. The regex `"~(^|:)https([,\s]|$)"` requires `,`, whitespace, or end-of-string after `https`, so `"https:"` fails to match and sets an empty flag; uppercase `X-Forwarded-Proto: HTTPS` also misses because `~` is case-sensitive.
   - **Fix:** Add `:` to the trailing character class and make the match case-insensitive: `"~*(^|:)https([,:\s]|$)" "; Secure";`.
   - **If we skip it:** Any deployment that terminates TLS in the router Nginx or receives uppercase `X-Forwarded-Proto: HTTPS` issues the `openrelik_ui` cookie without the `Secure` attribute.

2. **`configure_router.sh` has no automated tests** (`web/router/nginx/configure_router.sh:L20-22`)
   - **What this is:** Startup shell script (355 lines) that parses `/etc/resolv.conf`, validates `OPENRELIK_UIS` entries, escapes UI names for JSON and HTML, and writes the router Nginx config, `uis.json`, and `ui.html`.
   - **Problem:** Even though the script defines `RESOLV_CONF`, `NGINX_CONF_OUT`, and `ROUTER_HTML_DIR` overrides for out-of-container testing, there are no automated tests exercising valid configs, malformed `OPENRELIK_UIS` errors, IPv6 resolvers, label escaping, or generated Nginx directives. That gap let finding 1 slip through.
   - **Fix:** Add a pytest module (for instance under `dev/tools/devctl/tests/`) or shell test run in CI that executes `configure_router.sh` against temporary directories and asserts both the generated files and the rejection of bad inputs.
   - **If we skip it:** Future edits to the router script can silently break Nginx config generation, input validation, or escaping without failing CI.

## Nice to have

3. **Two Runestone design docs still cite the old font directory** (`web/runestone/docs/design-system.md:L143`, `web/runestone/docs/style-guide.md:L63`)
   - **What this is:** Documentation files in `web/runestone/docs/` describing where self-hosted IBM Plex font files live.
   - **Problem:** Both lines still refer to `public/fonts/` instead of `public/assets/runestone/fonts/`.
   - **Fix:** Update `public/fonts/` to `public/assets/runestone/fonts/` in `design-system.md`, and remove the stale `public/fonts/` note from `style-guide.md` (`web/runestone/.prettierignore` no longer lists fonts).
   - **If we skip it:** Someone reading those docs looks in the wrong directory for font files.

Verdict: fix 1 and 2 first.
Not checked (after `1305fc6`): multi-container router + Sunstone + Runestone Docker stack smoke test and `docker compose config` (not re-run since compose files did not change in `1305fc6`).

---

# Review Round 3

Date: 2026-11-16
Round 2 resolutions (`aa82339`):
- Fixed 1: updated `$cookie_secure_flag` regex to `"~*(^|:)https([,:\s]|$)"` in `web/router/nginx/configure_router.sh` so direct HTTPS and case-insensitive `X-Forwarded-Proto` set `; Secure`.
- Dismissed 2: automated tests for `web/router/nginx/configure_router.sh` deferred for now per user direction; script output, container `nginx -t`, and live `Set-Cookie` headers verified via smoke checks.
- Fixed 3: updated font directory paths in `web/runestone/docs/design-system.md` and `web/runestone/docs/style-guide.md`.

Checks run:
- `web/router`: `sh -n nginx/configure_router.sh`, local `configure_router.sh` config check, container `/docker-entrypoint.sh nginx -t`, live `curl` header checks (`X-Forwarded-Proto: HTTPS` includes `; Secure`, plain HTTP omits it)
- `web/sunstone`: `yarn lint:check`, `vitest` (28 files, 464 tests), `vite build` (assets under `assets/sunstone/` with all three `PLACEHOLDER_VITE_OPENRELIK_*` placeholders)
- `web/runestone`: `npx prettier --check docs/design-system.md docs/style-guide.md`, `npm run check`, `vitest` with V8 coverage (152 files, 1,116 tests, >= 95% line coverage on every touched runtime file), `vite build` (bundles and IBM Plex fonts under `assets/runestone/`)
- `dev/tools/devctl`: `uv run pytest` (42 passed)
- Repo scripts: `.github/scripts/images.py check` (32 images, 34 builds), `images.py matrix --changed`, `.github/scripts/check-versions.py` (0 errors)

What this change does: Adds a config-driven Nginx UI router (`openrelik-web-router`) that routes browser traffic between registered OpenRelik web UIs on a single origin using the `openrelik_ui` cookie and `/assets/<id>/` path prefixes. Namespaces Sunstone and Runestone build assets and runtime placeholder substitution under `assets/sunstone` and `assets/runestone`, wires dynamic UI switchers driven by `GET /__openrelik/uis.json` into `/login`, settings, and account/system menus (staying hidden when standalone or single-UI), and updates Docker Compose, `devctl`, and release/image scripts for all four UI images.

## Requirements
- R1: done (`configure_router.sh` automated tests deferred in Round 2)
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done

Verdict: LGTM

Not checked (on final commits `1305fc6`/`aa82339`): `docker compose config` and full multi-container + Vite HMR stack session (Compose files were unchanged after earlier Docker Compose and 3-upstream HTTP/WebSocket smoke verification).
