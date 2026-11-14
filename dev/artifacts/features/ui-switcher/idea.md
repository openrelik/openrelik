---
slug: ui-switcher
issue: https://github.com/openrelik/openrelik/issues/107
created: 2026-11-14
by: berggren (Johan Berggren)
---
# Serve multiple web UIs with user switching

## Problem

OpenRelik now ships two web UIs (`sunstone` and `runestone`). In development they run on separate ports (`:3000` and `:3050`), and in production only one UI container is served on `:8711`. Serving two UIs on separate ports or origins breaks single-origin expectations in OAuth/OIDC login callbacks, CORS `allowed_origins`, and shared report links, while swapping the `openrelik-ui` container image switches every user at once with no way for an individual user to switch back in the browser.

## Proposal

Run `sunstone` and `runestone` in separate containers behind a lightweight `openrelik-ui` Nginx router container on the existing UI port. Operators configure the default UI with an environment variable (`sunstone` initially, switching to `runestone` once feature parity lands), and individual users can switch between `sunstone` and `runestone` from the login screen, settings, or menu using a browser cookie without routing API, upload, or download traffic through the UI router.

## Users

Forensic analysts and incident responders who want to opt into `runestone` early or switch back to `sunstone` when needed, and administrators deploying OpenRelik with Docker Compose or Kubernetes who want a single configurable UI origin.

## Open questions

- None.
