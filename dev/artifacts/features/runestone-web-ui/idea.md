---
slug: runestone-web-ui
issue: https://github.com/openrelik/openrelik/issues/96
created: 2026-11-10
by: berggren (Johan Berggren)
---
# Runestone web UI

## Problem

The current web UI (`sunstone`) is built on Vuetify and pulls in a wide dependency tree (`axios`, `lodash`, `sass`, icon fonts, and charting wrappers). Material Design defaults add heavy spacing and component chrome that get in the way when inspecting dense forensic data such as file trees, task outputs, and timelines. Upgrading Vuetify and fighting its component styles also slows down routine UI work.

## Proposal

Build a new Vue 3 web UI, `runestone`, in `web/runestone/` alongside `sunstone` with minimal dependencies, dropping Vuetify in favor of plain Tailwind CSS and native HTML elements with no component library. Start fresh with native `fetch` for API requests and authentication rather than sharing Sunstone's client. Give it a minimalist, technical layout tuned for high information density, keyboard-friendly forensic workflows, and a pluggable file viewer. Keep `sunstone` running while `runestone` matures, reaching full feature parity before replacing `sunstone` as the default UI.

## Users

Forensic analysts and incident responders working through folders, files, workflows, and task reports in OpenRelik, as well as developers maintaining the frontend.

## Open questions

- None.
