# Web UIs

Each web UI implementation lives in its own directory, named after a Viking Age
artifact (`sunstone`, `runestone`, `seax`, `mjolnir`, …). Codenames don't age
the way "ui", "ui-new" or "ui-v2" do, and say nothing about the technology, so
implementations can come and go without renames.

| Directory       | What                                                     | Status         |
| --------------- | -------------------------------------------------------- | -------------- |
| `web/sunstone`  | Vue 3 + Vuetify, the original OpenRelik UI               | default        |
| `web/runestone` | Vue 3 + TypeScript + Tailwind CSS, console UI            | in development |
| `web/router`    | Config-driven Nginx UI router (`openrelik-web-router`)   | multi-UI proxy |

Code shared between UIs (API client, types, auth) goes into `shared/` once a
second implementation needs it.

## Published images

Four images are built under `web/` and versioned together on `ui-v*` tags:

| Image | Context | Purpose |
| ----- | ------- | ------- |
| `ghcr.io/openrelik/openrelik-ui` | `web/sunstone` | Standalone Sunstone image for single-container deployments |
| `ghcr.io/openrelik/openrelik-web-sunstone` | `web/sunstone` | Sunstone UI behind `openrelik-web-router` |
| `ghcr.io/openrelik/openrelik-web-runestone` | `web/runestone` | Runestone UI behind `openrelik-web-router` |
| `ghcr.io/openrelik/openrelik-web-router` | `web/router` | Multi-UI router on port `8711` (`UI_PORT` in dev) |

## Multi-UI routing and switching

`openrelik-web-router` fronts any set of configured UI containers on a single origin so
OAuth/OIDC callbacks, CORS `allowed_origins`, and shared links stay consistent while
individual users choose their UI in the browser. API, upload, and download requests still
go straight to `openrelik-server` on `:8710`.

Configure the router through environment variables:

- `OPENRELIK_UIS`: comma-separated `id|Label|upstream_url` entries (default:
  `sunstone|Sunstone|http://openrelik-web-sunstone:8711,runestone|Runestone|http://openrelik-web-runestone:8711`).
  Each `id` must match `^[a-z0-9][a-z0-9-]*$` and each upstream must be `http://` or
  `https://`.
- `OPENRELIK_DEFAULT_UI`: default UI `id` when no valid `openrelik_ui` cookie is set
  (defaults to `sunstone`, or the first entry in `OPENRELIK_UIS` if not matched).

Router endpoints:

- `GET /__openrelik/uis.json`: returns `{ "default": "<id>", "uis": [{ "id", "name" }] }`
  with `Cache-Control: no-store` and no internal upstream URLs. First-party UIs read this
  endpoint to show or hide switcher controls dynamically.
- `GET /__openrelik/ui`: zero-JS HTML chooser page listing every registered UI. Useful if
  a custom frontend has no built-in switcher controls.
- `GET /__openrelik/switch/<id>`: sets the `openrelik_ui=<id>` cookie
  (`Path=/; Max-Age=31536000; SameSite=Lax`, plus `; Secure` on HTTPS) for allowlisted
  IDs and redirects (`302`) to `/`.
- `/assets/<id>/*`: routed directly to upstream `<id>` regardless of the `openrelik_ui`
  cookie. All other routes (including WebSocket upgrades) use the allowlisted
  `openrelik_ui` cookie and emit `Vary: Cookie`.

## Registering a custom frontend container

External teams can run a custom frontend alongside `sunstone` and `runestone` without
modifying router code:

1. Namespace static build assets under `/assets/<id>/` (matching your UI's `<id>`).
2. Serve `/index.html` with `Cache-Control: no-cache` and `Vary: Cookie` so browsers
   revalidate after switching UIs.
3. Add `,<id>|<Label>|http://<service>:<port>` to `OPENRELIK_UIS` in
   `deploy/docker/config.env` or your local `.env`.
4. Optionally fetch `GET /__openrelik/uis.json` to render switcher links in your UI, or
   link users to `/__openrelik/ui` to switch back.
