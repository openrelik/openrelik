---
slug: file-selection-annotations
issue: https://github.com/openrelik/openrelik/issues/160
created: 2026-11-25
by: berggren (Johan Berggren)
---
# File selection annotations

## Problem

Runestone lets analysts link directly to selected text, lines, table rows, and byte offsets in a file, which helps when pointing a teammate to a finding over chat or in a ticket. Those links are ephemeral: OpenRelik does not store any context on the selection itself. Analysts who want to explain why a set of lines, rows, or bytes matters have to keep notes in external tools, losing the link to the file and making it hard for teammates opening the same file to see what has already been reviewed or flagged.

## Proposal

Add persistent comment annotations attached to file selections in Runestone, anchored to the existing selection types (text spans, lines, table rows, and byte offsets). Analysts can select a range in a file viewer, attach a comment, reply in threads, and read existing discussions in context, with the viewer highlighting and overlapping-selection behavior modeled on Google Docs. Files with comments also display a small comment indicator and count in folder listings so teammates can spot annotated evidence before opening it. This requires new backend data models and APIs to store selection annotations and replies, plus Runestone UI to add, read, reply to, and edit them.

Permissions inherit from file and folder access, and any user with read access to a file can annotate it.

This idea is scoped to comments (with threaded replies) in the Runestone file viewers, the folder-listing comment count indicator, and the backing API. Future annotation types (such as tags and verdicts), surfacing annotations in global search, reports, or exports, and Python client or MCP server support are out of scope for now and will follow separately.

## Users

Investigators analyzing files in Runestone who want to record findings directly on evidence, and teammates reviewing the same case who need to see prior notes and jump straight to the relevant selections in a file.

## Open questions

- None.
