# AGENTS.md: web/sunstone

Sunstone, the OpenRelik web UI: a Vue 3 single-page app with Vuetify 3, Pinia, Vue
Router, and Vite. The root `AGENTS.md` covers the dev stack and the process; this
covers working in `web/sunstone/`.

## Layout

| Path                    | What                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `src/views/`            | pages (`Home.vue`, `Folder.vue`, `File.vue`, `Investigation.vue`, ...) |
| `src/components/`       | reusable components; `WorkflowCanvas/` and `InvestigationCanvas/` are the visual editors |
| `src/stores/`           | Pinia stores (`user`, `workflow`, `investigation`, `app`)      |
| `src/composables/`      | reusable logic (`useUserSettings`, `useWorkflowCanvasView`, ...) |
| `src/router/`, `src/layouts/default/` | routes and the app layout                        |
| `src/plugins/`          | Vuetify, and the `mitt` event bus (`eventbus.js`)              |
| `src/RestApiClient.js`  | the API client: Axios with auth and token refresh              |
| `src/settings.js`       | config from `VITE_OPENRELIK_*` variables                       |
| `src/styles/`           | global SCSS (`global.scss`, `settings.scss`)                   |
| `nginx/`                | the production image's nginx config                            |

`TEMPLATE.vue` in `src/components/` and `src/views/` is a starting point, but it
uses the Options API; write new components with `<script setup>`.

## Commands

The dev stack's `web-sunstone` container has the dependencies installed, so run them
there, from the checkout (main or `.worktrees/<slug>`):

```bash
docker compose exec web-sunstone yarn test                                   # all tests
docker compose exec web-sunstone yarn test src/stores/__tests__/user.spec.js # one file
docker compose exec web-sunstone yarn test -t "name of the test"             # one test
docker compose exec web-sunstone yarn lint                                   # eslint --fix
docker compose exec web-sunstone yarn build                                  # production build
```

Or, with Node and yarn on the host, `yarn install` and the same `yarn` commands in
`web/sunstone/`.

## Conventions

- New components use the Composition API (`<script setup>`). About half of the
  existing ones still use the Options API; don't convert them in unrelated changes.
- Shared state goes in a Pinia store.
- API calls go in `src/RestApiClient.js`, and components import them; no `axios` or
  `fetch` in components (`Login.vue` and `ProfileMenu.vue` are old exceptions).
- Use Vuetify components and utility classes first; custom SCSS in `src/styles/` only
  when they're not enough.
- Show loading states, and report errors to the user with the `AppSnackbar`.
- Tests are Vitest with Vue Test Utils and happy-dom, in `__tests__/*.spec.js` next
  to the code. Write them for new stores, composables, utilities, and canvas logic.
- ESLint (`plugin:vue/vue3-essential` and `eslint:recommended`) must pass; there's no
  Prettier. `.editorconfig`: 2-space indent, final newline.
- Every file starts with the Apache 2.0 "Copyright <year> Google LLC" header: a
  `/* */` comment in JS, an `<!-- -->` comment at the top of a `.vue` file.

## Dev stack

- `web/sunstone` is mounted at `/app`; Vite hot-reloads changes. `node_modules` is a
  volume in the container, filled by `yarn install` when it starts, so it's not on the
  host.
- The browser calls the API directly, at `VITE_OPENRELIK_SERVER_URL`
  (`http://localhost:<API_PORT>`); there's no proxy. In production the image is
  nginx, and `nginx/substitute_env_variables.sh` replaces the `PLACEHOLDER_*` values
  of `.env.production` in the built files when the container starts.
- After changing `package.json` or `yarn.lock`, rebuild: `./devctl stack up -b`.
