---
slug: file-selection-annotations
issue: https://github.com/openrelik/openrelik/issues/160
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Design: File selection annotations

## Summary

Add persistent, selection-anchored comments with threaded replies to Runestone's four file viewers (`TextViewer`, `MarkdownViewer`, `TableViewer`, and `HexViewer`), plus a comment count indicator in folder listings. Analysts select lines, exact text spans, table rows, or byte offsets, attach a plain-text comment via a floating popover or toolbar action, and link teammates directly to any thread (`?comment=<id>#L82-L88`). Seven FastAPI endpoints under `/api/v1/files/{file_id}/annotations` back the UI with two new PostgreSQL tables (`FileAnnotation` and `FileAnnotationReply`).

## Background

Runestone already lets analysts mark lines, exact character columns, table rows, and byte offsets and share those coordinates in URL hashes (`#L12-L40`, `#L12C5-L14C20`, `#R5`, `#0x1f3-0x2a0`). Those links carry no context: analysts record explanations in external tickets or notes, and teammates opening the same evidence file cannot see what has already been reviewed or flagged.

Research and live prototyping on `prototype/file-selection-annotations` surfaced six constraints that shaped the final design:

1. OpenRelik evidence files are immutable after ingest, so selection coordinates never drift. Storing raw coordinate spans directly avoids the fuzzy-quote re-anchoring machinery needed by collaborative text editors.
2. Runestone's viewers are virtualized (`TextViewer`, `TableViewer`, `HexViewer`) and share the screen with `FileSidePanel`. A Google Docs-style floating right margin lane collides with `FileSidePanel`, breaks under horizontal scrolling and sorted/filtered tables, and stacks poorly beside 20px rows. Placing threads in a `Comments` tab inside `FileSidePanel` while keeping stepped highlights, gutter bars, and scrollbar ticks in the viewer works uniformly across all four viewers.
3. The CSS Custom Highlight API (`Highlight.priority`) resolves `background-color` conflicts by replacement rather than alpha blending. Running a per-visible-row interval sweep into three named highlight layers (`annotation`, `annotation-overlap`, `annotation-active`) preserves drag-selection without splitting DOM text nodes. `annotation-active` (priority 4) must outrank ephemeral URL `text-mark` (priority 3) so clicking a comment does not dim its highlight.
4. Prototyping the visual design established several refinements over the initial research notes:
   - Warm amber tokens in the design system's `warning` family work better than a separate purple hue. Whole-line annotations render as clean row backgrounds without text underlines; dotted underlines stay on resting inline column spans only.
   - Analysts expect a contextual popover near the cursor after selecting text rather than hunting for a toolbar icon. Anchoring a non-focus-stealing `<PopoverSurface>` (`@mousedown.prevent`) below the selection end keeps `⌘C` copying intact while surfacing `Comment` and `Copy link` immediately.
   - Clicking an annotated range inside a viewer must update the URL hash via `marks.set(...)` (suppressing `land()` scroll jumps) and sync `?comment=<id>`, while clicking a comment card in the sidebar jumps to the range and triggers a brief 750ms arrival pulse.
   - A small comment icon and count beside filenames in `FolderTable` lets analysts spot annotated files before opening them.
5. `FileSidePanel` previously carried `max-xl:hidden`, hiding it below 1280px. Turning it into a fixed overlay `<SlidePane>` below `xl` keeps comments usable on 1024px viewports.
6. Analysts frequently paste hostile strings (URLs, shell commands, control characters, bidi overrides) into notes. All comment and reply bodies render as escaped plain text without `v-html` or Markdown parsing.

## Proposal

### User interface (Runestone only)

Creation and selection flow:
- Finishing a text selection in `TextViewer` or `MarkdownViewer`, clicking or dragging gutter numbers in `TextViewer`, `TableViewer`, or `HexViewer`, or dragging a multi-byte range in `HexViewer` opens a floating `SelectionPopover` beside the selection end with `Comment` and `Copy link`. Single-byte clicks in `HexViewer` and single-row clicks in `TableViewer` leave the popover closed so routine inspection stays quiet.
- `SelectionPopover` uses `@mousedown.prevent` so it never steals focus or clears the browser selection; pressing `⌘C`/`Ctrl+C` copies as usual and dismisses the bar. Scrolling, wheel events, resizing, outside clicks, and `Escape` also dismiss it.
- The viewer toolbar retains a `MessageSquarePlus` button and `c` keyboard shortcut as fallbacks (including fullscreen `TableViewer` and keyboard-only selection).

In-viewer highlighting and navigation:
- Saved annotations tint their spans across all four viewers using three stepped warm-amber levels (`--color-annotation-tint`, `--color-annotation-overlap`, `--color-annotation-active`): single annotation, two or more overlapping annotations, and the active selected thread.
- `TextViewer` renders whole-line annotations as full-row backgrounds (no text underlines) and inline column spans via CSS Custom Highlight API (`::highlight(annotation)` with a subtle dotted amber underline at rest; overlap and active layers without underlines). `TextViewer`, `TableViewer`, and `HexViewer` show a 2px amber gutter bar on annotated lines/rows; `TextViewer` and `HexViewer` also add ticks on their custom scrollbar tracks.
- Clicking an annotated region selects its thread (or filters the `Comments` tab to the overlapping threads at that point), opens the `Comments` tab, and updates the URL bar (`?comment=<id>#L...`) without scrolling away from the cursor.
- Clicking a comment card in the sidebar jumps the viewer to its range, updates the URL bar, and plays a 750ms arrival pulse (`annotation-pulse` on rows/blocks/cells, `annotation-line-flash` on the enclosing row for inline text spans, respecting `prefers-reduced-motion`). Hovering a card does not highlight the file.
- Clicking outside any annotated region in a viewer, clicking empty space in the `Comments` pane, or pressing `Escape` deselects the active comment and clears `?comment=` and the URL hash.

Comments tab in `FileSidePanel`:
- Adds a `Comments` tab with a tabular thread count (`Comments 3`) alongside `Details` and `Inspector`. When a file has comments, the `Comments` tab opens by default unless the user has pinned another tab.
- Threads render as a stack of compact cards: transparent with `border-border` when inactive, and a soft warm wash (`bg-warning-tint/35`) with `border-warning-icon/40` when selected. Internal dividers between root comments, replies, and the reply input run edge to edge inside each card.
- Each message has a single-line header: `sm` (18px) `UserAvatar`, author name, compact UTC timestamp (`Nov 25, 20:31` with full `YYYY-MM-DD HH:MM:SS UTC` on hover), right-aligned clickable coordinate chip (`L82-L88`, `R5`, `0x1f3-0x2a0`) on the root message, and a vertical `⋮` menu shown only on the selected thread.
- The root `⋮` menu offers `Copy link` (copies `?comment=<id>#...` for all users with file access), plus `Edit` (author only) and `Delete` (author or admin, with confirmation naming any replies that will be deleted). Replies show `⋮` with `Edit`/`Delete` when permitted.
- Bodies render as escaped plain text (`leading-snug`), clamped to 3 lines with a neutral `Show more` / `Show less` toggle when overflowing.
- The active thread ends with a borderless resting `Reply…` prompt that expands into a bordered `.field` textarea with `Cancel` and `Reply` (`Cmd/Ctrl+Enter` submits, `Escape` cancels).
- Opening a deep link (`?comment=<id>#L...`) opens the `Comments` tab, selects that thread, lands on its range, and triggers the arrival pulse.

Folder listing indicator:
- Files with active annotations display a small speech-bubble icon (light yellow `fill-annotation-active` with amber `text-warning-icon` stroke) and tabular count beside the filename in `FolderTable`. Creating or deleting an annotation updates the cached count in `useItemsStore` immediately.

### API endpoints

Dedicated router mounted under `/api/v1/files`:
- `GET /api/v1/files/{file_id}/annotations` -> `200 list[FileAnnotationResponse]`
- `POST /api/v1/files/{file_id}/annotations` -> `201 FileAnnotationResponse`
- `PATCH /api/v1/files/{file_id}/annotations/{annotation_id}` -> `200 FileAnnotationResponse`
- `DELETE /api/v1/files/{file_id}/annotations/{annotation_id}` -> `204`
- `POST /api/v1/files/{file_id}/annotations/{annotation_id}/replies` -> `201 FileAnnotationReplyResponse`
- `PATCH /api/v1/files/{file_id}/annotations/{annotation_id}/replies/{reply_id}` -> `200 FileAnnotationReplyResponse`
- `DELETE /api/v1/files/{file_id}/annotations/{annotation_id}/replies/{reply_id}` -> `204`

Existing folder listing schema `FileResponseCompactList` gains `annotation_count: int = 0`, populated in `get_files_from_db()` via one batched `GROUP BY` query over `fileannotation`.

All annotation routes use `@require_access(allowed_roles=[Role.VIEWER, Role.EDITOR, Role.OWNER])` so permissions inherit from file and folder access and any reader can comment or reply. `PATCH` requires `user_id == current_user.id`; `DELETE` requires `user_id == current_user.id or current_user.is_admin`. Every single-resource route checks `annotation.file_id == file_id` (and `reply.annotation_id == annotation_id`) to prevent cross-file IDOR.

## Technical design

### Server (`server/src/`)

- `datastores/sql/models/file.py`: Add `FileAnnotation` and `FileAnnotationReply` inheriting `BaseModel` (auto-table names `fileannotation` and `fileannotationreply`, soft-delete fields, UTC timestamps).
  - `FileAnnotation`: `file_id` (FK `file.id`), `user_id` (FK `user.id`), `anchor_kind` (`Unicode(16)`: `'line' | 'row' | 'offset'`), `range_start` and `range_end` (`BigInteger` for >2 GiB offsets), nullable `range_start_col` and `range_end_col` (`Integer`), `body` (`UnicodeText`), nullable `edited_at` (`DateTime(timezone=True)`).
  - Database check constraints enforce valid `anchor_kind`, `range_end >= range_start`, lower bounds (`>= 0` for `offset`, `>= 1` for `line`/`row`), paired columns (`(range_start_col IS NULL) = (range_end_col IS NULL)`), columns on `line` only, and positive column values.
  - `FileAnnotation.replies` uses a `primaryjoin` filtering `is_deleted == False` ordered by `(created_at, id)` so soft-deleted replies never leak into eager-loaded responses.
  - Partial indexes `ix_fileannotation_file_id_active` on `(file_id, anchor_kind, range_start)` and `ix_fileannotationreply_annotation_id_active` on `(annotation_id, created_at)` with both `postgresql_where` and `sqlite_where` (`NOT is_deleted`).
- `datastores/sql/alembic/env.py` & `versions/c8d4f2a91e05_add_file_annotation_models.py`: Register models and create both tables, check constraints, and partial indexes.
- `api/v1/schemas.py`: Add `FileAnnotationCreateRequest`, `FileAnnotationUpdateRequest`, `FileAnnotationResponse`, `FileAnnotationReplyCreateRequest`, `FileAnnotationReplyUpdateRequest`, `FileAnnotationReplyResponse` (trimming bodies, rejecting empty text, capping length at 10,000 characters, and validating anchor invariants including `range_end_col > range_start_col` on single-line text spans). Add `annotation_count: int = 0` to `FileResponseCompactList`.
- `datastores/sql/crud/annotation.py` & `api/v1/annotations.py`: Implement list/get/create/update/soft-delete CRUD with explicit `is_deleted == False` filters and `selectinload(user, replies.user)`. Deleting a root annotation cascades `soft_delete()` to its active replies in the same transaction. `POST` validates `offset` `range_end < file.filesize` when `filesize` is known. Mount router under `/files` in `main.py` and `tests/conftest.py`.
- `datastores/sql/crud/file.py`: Add `_attach_annotation_counts(db, files)` to `get_files_from_db()` using one grouped `SELECT file_id, COUNT(*)` query for the listed file IDs.

### Web UI (`web/runestone/src/`)

- `assets/main.css` & `assets/__tests__/tokens.test.ts`: Add `--color-annotation`, `--color-annotation-tint`, `--color-annotation-overlap`, and `--color-annotation-active` in dark (`#e8b45e`, `#3d2c10`, `#523b12`, `#664915`) and light (`#724d00`, `#fef6dc`, `#fcedbe`, `#f8df9b`) themes, verified by `tokens.test.ts` (>= 7:1 accent contrast, >= 6.5:1 ink contrast on all three highlight depths). Add `::highlight(annotation*)` rules and `annotation-pulse` / `annotation-line-flash` keyframes.
- `api/types.ts`, `api/endpoints/annotations.ts`, `api/index.ts`, `types/item.ts`, `composables/useFolderLoader.ts`: Add typed annotation DTOs, `api.annotations.*`, and `annotationCount` mapping from folder file listings.
- `utils/annotations.ts`: Pure helpers for `annotationMark`, `annotationSpan`, `annotationChip`, `annotationLabel`, `annotationHasColumns`, `annotationCoversText`, `annotationCoversRange`, `annotationsAtPoint`, `annotationLayerForRange`, sweep-line `computeTextRowSegments`, and `escapeAnnotationText` (escaping C0/C1 control chars and Unicode bidi overrides).
- `utils/placement.ts`: Add `pointAnchor(x, y)` and `selectionAnchor(fallbackX, fallbackY)` using the last non-empty `Range.getClientRects()` rect.
- `composables/useFileAnnotations.ts` & `stores/auth.ts`: `useQueryCache`-backed annotation loader and mutations (`file:${fileId}:annotations`), `useAutoRefresh` subscription, live `annotationCount` sync into `useItemsStore`, `useAnnotationPulse` timer helper, and `clearFileAnnotations()` on sign-out / 401.
- `composables/useMarkedRange.ts`: Track `dragSpan` synchronously so `onGutterDone(span, event)` fires on `pointerup` without racing async router hash updates.
- `components/viewers/SelectionPopover.vue`: Teleported `<PopoverSurface>` toolbar offering `Comment` and `Copy link` with `@mousedown.prevent` and automatic dismissal on copy, scroll, wheel, resize, outside `pointerdown`, and `Escape`.
- `components/viewers/FileAnnotationsPanel.vue` & `FileSidePanel.vue`: Minimalist card-based thread UI, `ResizeObserver`-driven 3-line clamping, `⋮` menu (`Copy link`, `Edit`, `Delete`), inline borderless-to-field reply box, and overlay `<SlidePane>` below `xl`.
- `views/FileView.vue`, `components/viewers/{FileContent,TextViewer,TableViewer,HexViewer,MarkdownViewer}.vue`, `components/markdown/MarkdownView.vue`, `components/folders/FolderTable.vue`, `components/dialogs/HelpDialog.vue`, `components/icons/index.ts`: Wire highlighting, hit-testing, click-outside deselection, URL `?comment=<id>#...` sync, arrival pulse, folder indicator, and `c` shortcut documentation.

## Alternatives considered

- **Single self-referential `FileAnnotation` table with `parent_id`**: Saves one table, but forces anchor columns to be nullable on replies, weakening database check constraints and mixing selection anchors with reply rows when tags or verdicts are added later.
- **Separate `FileSelection` + `FileAnnotationComment` tables**: Lets replies survive root comment deletion and lets multiple annotation types share one selection row, but adds an extra join to every read and write before tags or verdicts are designed.
- **Google Docs-style floating right margin lane**: Collides with `FileSidePanel`, breaks under horizontal scrolling and sorted/filtered tables, and pushes cards far from dense 20px rows.
- **Popover-only threads without a sidebar list**: Prevents analysts from scanning all findings across a 50,000-line file or large hex dump.
- **Separate violet/purple highlight palette**: Tested in the early prototype and dropped because it clashed with Runestone's calm console palette; stepped warm amber in the existing `warning` family reads naturally as a highlighter in both themes.
- **Toolbar-only comment button (no floating selection popover)**: Tested first and felt too far from the cursor after selecting text; adding `SelectionPopover` while keeping the toolbar button and `c` shortcut covers both pointer and keyboard workflows.

## Risks and open questions

- **Large files and high annotation counts**: `TextViewer`, `TableViewer`, and `HexViewer` compute highlight segments only for visible rows (~10–40 rows), keeping render cost independent of file size. A file with thousands of annotations would still scan the list per visible row; if that becomes a bottleneck later, pre-indexing annotations by line/offset range on load keeps lookups O(log N) without changing the API.
- **Table sorting and filtering**: `TableViewer` anchors annotations to 1-based file row order (`line.index + 1`). When a table is sorted or filtered, a multi-row annotation `#R12-R40` may appear split across non-contiguous rows or hidden by the filter. Jumping to a hidden annotation clears active filters and sorts via existing `tryLand()` behavior.
- **Coordinate determinism for future clients**: `TextViewer` columns are 1-based UTF-16 code units on `\n`-split lines with trailing `\r` stripped (`lines.ts`). Future Python or MCP clients consuming `range_start_col`/`range_end_col` will need to follow that convention.
