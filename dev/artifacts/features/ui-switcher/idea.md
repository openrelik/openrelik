---
slug: ui-switcher
issue: https://github.com/openrelik/openrelik/issues/107
created: 2026-11-14
by: berggren (Johan Berggren)
---
# Serve multiple web UIs with user switching

## Problem

OpenRelik now ships two web UIs (`sunstone` and `runestone`), and external teams may also want to run custom frontend containers alongside them. Today development runs UIs on separate ports (`:3000` and `:3050`) and production serves a single `openrelik-ui` container on `:8711`. Serving UIs on separate ports or origins breaks single-origin expectations in OAuth/OIDC login callbacks, CORS `allowed_origins`, and shared report links. Replacing `openrelik-ui` in place would break existing deployments that pull `openrelik-ui` without updating their container topology, and swapping images flips every user at once with no way for an individual user to switch back in the browser.

## Proposal

Keep publishing `openrelik-ui` as standalone `sunstone` so current deployments continue working unchanged, and publish `openrelik-web-sunstone`, `openrelik-web-runestone`, and a config-driven `openrelik-web-router` alongside it. Multi-UI deployments (`deploy/docker/docker-compose.yml` and `compose.yml`) place `openrelik-web-router` on the UI port and register any number of first-party or third-party UI containers through configuration (`OPENRELIK_UIS` and `OPENRELIK_DEFAULT_UI`, defaulting to `sunstone`) with no hardcoded UI list. The router exposes the registered UI list to browsers and provides a built-in fallback switcher page so users can switch between any configured UIs from the login screen, settings, menu, or router URL via a browser cookie without routing API, upload, or download traffic through the router.

## Users

Forensic analysts and incident responders switching between `sunstone`, `runestone`, or custom frontends, external developers integrating custom UI containers via configuration, and administrators running standalone `openrelik-ui` or multi-UI Docker Compose and Kubernetes deployments.

## Open questions

- None.
