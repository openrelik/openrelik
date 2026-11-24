---
slug: remove-web-router
issue: https://github.com/openrelik/openrelik/issues/144
created: 2026-11-24
by: berggren (Johan Berggren)
---
# Remove web-router and UI switcher in favor of single-UI deployment

## Problem

OpenRelik currently deploys both `sunstone` and `runestone` behind `openrelik-web-router` (`dev/artifacts/features/ui-switcher/`, #107), with runtime cookie-based switching inside both UIs. Running a third container and maintaining asset path namespacing, Nginx routing scripts, and switcher menus in both frontends adds operational and maintenance overhead for a transition mechanism we do not need. Operators and developers only need one UI running per deployment.

## Proposal

Remove `openrelik-web-router` and the in-app UI switcher controls from both `sunstone` and `runestone`, and serve one web UI container directly on the UI port. Control which UI is deployed through Docker Compose: default both local development (`compose.yml`) and production deployments (`deploy/docker/docker-compose.yml`) to Runestone (`openrelik-web-runestone`), with Sunstone (`openrelik-web-sunstone`) selectable via configuration. Keep publishing `ghcr.io/openrelik/openrelik-ui` from `web/sunstone` so older deployments pulling `openrelik-ui` continue working without breaking.

## Users

Administrators deploying OpenRelik with Docker Compose who get a simpler single-container frontend setup defaulting to Runestone (with Sunstone still available), existing deployments continuing on `openrelik-ui`, and developers running a single Vite dev server without a proxy container in front of it.

## Open questions

- None.
