---
slug: ui-switcher
issue: https://github.com/openrelik/openrelik/issues/107
created: 2026-11-14
by: berggren (Johan Berggren)
---
# Serve multiple web UIs with user switching

## Problem

OpenRelik now ships two web UIs (`sunstone` and `runestone`). In development they run on separate ports (`:3000` and `:3050`), and in production only one UI container is served on `:8711`. Serving two UIs on separate ports or origins breaks single-origin expectations in OAuth/OIDC login callbacks, CORS `allowed_origins`, and shared report links. Replacing the existing `openrelik-ui` image in place would break current deployments that pull `openrelik-ui` without updating their container setup, and swapping UI images flips every user at once with no way for an individual user to switch back in the browser.

## Proposal

Keep publishing `openrelik-ui` as standalone `sunstone` so current deployments continue working unchanged, and publish three images alongside it: `openrelik-web-sunstone`, `openrelik-web-runestone`, and `openrelik-web-router`. Update `deploy/docker/docker-compose.yml` and the local development stack (`compose.yml`) to place `openrelik-web-router` on the UI port in front of `openrelik-web-sunstone` and `openrelik-web-runestone`. Operators pick the default UI with an environment variable (`sunstone` initially), and when served through `openrelik-web-router`, individual users can switch between `sunstone` and `runestone` from the login screen, settings, or menu using a browser cookie without routing API, upload, or download traffic through the router.

## Users

Forensic analysts and incident responders who want to opt into `runestone` early or switch back to `sunstone` when needed, and administrators running either existing standalone `openrelik-ui` deployments or multi-UI Docker Compose and Kubernetes deployments.

## Open questions

- None.
