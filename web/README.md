# Web UIs

Each web UI implementation lives in its own directory, named after a Viking Age
artifact (`sunstone`, `runestone`, `seax`, `mjolnir`, …). Codenames don't age
the way "ui", "ui-new" or "ui-v2" do, and say nothing about the technology, so
implementations can come and go without renames.

| Directory       | What                                              | Status          |
| --------------- | ------------------------------------------------- | --------------- |
| `web/runestone` | Vue 3 + TypeScript + Tailwind CSS, console UI     | default         |
| `web/sunstone`  | Vue 3 + Vuetify, the original OpenRelik UI        | legacy / opt-in |

Code shared between UIs (API client, types, auth) goes into `shared/` once a
second implementation needs it.

## Published images

Three images are built under `web/` and versioned together on `ui-v*` tags:

| Image                                       | Context         | Purpose                                                              |
| ------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| `ghcr.io/openrelik/openrelik-web-runestone` | `web/runestone` | Runestone UI (default in `deploy/docker/docker-compose.yml`)         |
| `ghcr.io/openrelik/openrelik-web-sunstone`  | `web/sunstone`  | Sunstone UI (opt-in via `OPENRELIK_UI_IMAGE`)                        |
| `ghcr.io/openrelik/openrelik-ui`            | `web/sunstone`  | Legacy Sunstone image kept for compatibility with older deployments  |

## Selecting a UI

Each deployment runs one web UI container directly on the UI port (`8711` in
production, `UI_PORT` in development), and the browser calls `openrelik-server`
directly on `:8710`.

- **Production (`deploy/docker/`)**: `deploy/docker/docker-compose.yml` runs a
  single `openrelik-ui` service configured by `OPENRELIK_UI_IMAGE` in
  `deploy/docker/config.env`. It defaults to `openrelik-web-runestone`. To
  deploy Sunstone instead, set `OPENRELIK_UI_IMAGE=openrelik-web-sunstone` in
  `config.env` and run `docker compose up -d`.
- **Development (`compose.yml`)**: `web-runestone` runs on `UI_PORT` (`3000` +
  worktree slot) by default. To run Sunstone instead, comment out `web-runestone`
  and uncomment `web-sunstone` in `compose.yml`, then run `./devctl stack up`.
