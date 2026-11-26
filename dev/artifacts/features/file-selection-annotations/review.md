---
slug: file-selection-annotations
issue: https://github.com/openrelik/openrelik/issues/160
created: 2026-11-26
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-26
PR: https://github.com/openrelik/openrelik/pull/163
Checks run:
- Server: `black --check` passed on the 4 new Python files; `pytest` -> 637 passed.
- Runestone: `npm run format:check`, `npm run lint:check --max-warnings=0`, `npm run type-check`, `vitest run` (161 files / 1,151 tests), and `npm run build` all passed.

What this change does:
Adds file selection annotations (comments and threaded replies anchored to line/column spans, table rows, or byte offsets) to the FastAPI server and Runestone web UI, without touching evidence files on disk. The backend adds `FileAnnotation` and `FileAnnotationReply` tables with an Alembic migration, seven ACL-checked endpoints under `/api/v1/files/{file_id}/annotations`, and a batched `annotation_count` query on folder listings. Runestone adds warm-amber highlight tokens, a floating selection popover, a `Comments` tab in `FileSidePanel`, URL deep-linking (`?comment=<id>#...`), and comment counts in `FolderTable`. Assumed load: multiple analysts concurrently viewing and annotating shared cases with large multi-gigabyte evidence files.

## Requirements
- R1: untested (models, check constraints, and `FileAnnotation.replies` soft-delete filtering/ordering are implemented, with no datastore tests)
- R2: done (Alembic migration `c8d4f2a91e05` is single head, registered in `alembic/env.py`, and matches the models)
- R3: done (all 7 routes are mounted; reply `PATCH` and `DELETE` routes have no tests)
- R4: untested (ACL, IDOR checks, author/admin gates, and soft-delete cascade are implemented, but reply `PATCH`/`DELETE` routes and all `crud/annotation.py` logic lack tests)
- R5: done (schema validation, `offset` filesize check, UTC `edited_at`, and `GET` ordering are implemented; `crud/annotation.py` behavior, oversized body, and `filesize == 0` lack tests)
- R6: done
- R7: done
- R8: broken: `useFileAnnotations` lacks a session-epoch guard across `await` (sign-out race) and calls `markFresh()` before an initial fetch finishes; also has no unit tests
- R9: done
- R10: done
- R11: broken: re-clicking an active comment card (or another comment on the same range) does not scroll the viewer, and `HexViewer` never plays the arrival pulse when opened from another view or deep link
- R12: broken: pressing `Escape` in `FileView` clears `?comment=` and `activeAnnotationId` without clearing the URL hash or overlap filter
- R13: done
- R14: done
- R15: untested (implemented in `FolderTable.vue`, no unit test)
- R16: done (all reported checks pass; several touched Runestone runtime files still have major untested paths)

## Must fix

1. **In-flight annotation requests can leak across sign-out and hide existing comments** (`web/runestone/src/composables/useFileAnnotations.ts:L37-60, L89-97, L125-197`)
   - **What this is:** Module-scoped cache (`byFile`) and CRUD helpers that load, cache, and mutate file annotations.
   - **Problem:** Neither `load()` nor the six mutation functions check a session epoch (a counter bumped on sign-out) after `await`. If a user creates or edits a comment and signs out (or hits 401) while the request is in flight, the resolved promise writes the previous user's comment into `byFile[id]` and marks `useQueryCache` fresh for 30 seconds after `clearFileAnnotations()` ran. Also, `createAnnotation()` and `deleteAnnotation()` call `markFresh()` even if the initial `list` fetch is still in flight, which aborts `list` and hides all existing annotations on that file for 30 seconds.
   - **Fix:** Add `let sessionEpoch = 0`, increment it in `clearFileAnnotations()`, capture `const epoch = sessionEpoch` before every `await`, and skip cache/store writes if `epoch !== sessionEpoch` (same pattern as `useStatus.ts:L45,L58,L115`). Only call `markFresh(annotationsKey(id))` in mutations when `queryState(annotationsKey(id)).status === 'success'`.
   - **If we skip it:** A subsequent operator on a shared browser can see the previous operator's comment, and creating a comment on a slow link before the list finishes loading wipes all other comments from view.

2. **`Escape` leaves the URL hash and overlap filter active** (`web/runestone/src/views/FileView.vue:L223-231, L388-395`)
   - **What this is:** Keyboard handler in `FileView` that deselects an active comment when `Escape` is pressed.
   - **Problem:** When `activeAnnotationId.value !== null`, `KEYS.Escape` only clears `activeAnnotationId` and `?comment=`, without calling `deselectAnnotation()`. Pressing `Escape` from the sidebar leaves `#L...`/`#R...`/`#0x...` in the URL hash, keeps the yellow mark highlighted in the viewer, and leaves any overlap filter bar open, violating R12. Similarly, `watch(mark)` at L223 clears `activeAnnotationId` when a viewer clears `mark`, but leaves `filterIds`/`filterLabel` set.
   - **Fix:** Call `deselectAnnotation()` inside the `activeAnnotationId.value !== null` branch of `KEYS.Escape` (L390), and clear `filterIds.value = null; filterLabel.value = null` inside `watch(mark)` when `!next && prev`.
   - **If we skip it:** Analysts need two `Escape` presses to clear a selected comment's highlight and URL hash, and overlap filter bars stay stuck open.

3. **Clicking an already-selected comment card or a shared-range comment does not scroll the viewer** (`web/runestone/src/views/FileView.vue:L91-97, L301-307`; `web/runestone/src/composables/useMarkedRange.ts:L83-100`)
   - **What this is:** Sidebar click handler (`selectAnnotation`) that jumps the viewer to a comment's anchored range.
   - **Problem:** `useMarkedRange` only calls `land()` when `hashOf(model.value)` changes, and `writeUrl()` skips router updates when the hash is unchanged. If an analyst clicks comment #1 (anchored on `#L12-L14`), scrolls down to line 5,000, and clicks comment #1 again (or its "Jump to lines 12–14" chip, or a second comment anchored on `#L12-L14`), the hash does not change and the viewer stays at line 5,000, violating R11.
   - **Fix:** In each viewer (`TextViewer`, `TableViewer`, `HexViewer`, `MarkdownViewer`), watch `() => props.annotationPulse` and call `land(...)` on the viewer's current mark when it is set (`FileView` only increments `annotationPulse` on sidebar clicks and `?comment=` deep links, never on in-viewer clicks).
   - **If we skip it:** Clicking a comment card or its "Jump to ..." chip silently fails to scroll whenever that range is already in the URL hash.

4. **`HexViewer` misses the arrival pulse when opened via a sidebar comment or deep link** (`web/runestone/src/components/viewers/HexViewer.vue:L314-321, L498`)
   - **What this is:** Arrival pulse hook in `HexViewer` that flashes the active byte annotation for 750ms after jumping to it.
   - **Problem:** `HexViewer` mounts via `v-if="view === 'hex'"` after `FileView` has already incremented `annotationPulse`. Because `useAnnotationPulse` watches changes without `{ immediate: true }` and `HexViewer` does not call `trigger()` inside `useMarkedRange`'s `land` callback (unlike `TextViewer:L236`, `TableViewer:L301`, and `MarkdownViewer:L156`), jumping from Text/Table/Markdown to a byte comment or opening `?comment=<id>` for an offset comment never plays the pulse, violating R11 and R12.
   - **Fix:** Destructure `const { pulsing, trigger: triggerPulse } = useAnnotationPulse(() => props.annotationPulse)` in `HexViewer.vue:L498` and call `if (props.activeAnnotationIds.size) triggerPulse()` inside the `land` callback at L316.
   - **If we skip it:** Byte-offset comments never pulse when opened from a deep link or another viewer tab.

## Should fix

5. **Server CRUD layer, model constraints, and reply edit/delete routes have no tests** (`server/src/datastores/sql/crud/annotation.py:L1-230`; `server/src/tests/api/v1/annotations_test.py:L1-262`)
   - **What this is:** Database access layer for annotations/replies and the API route test suite.
   - **Problem:** Every test in `annotations_test.py` mocks the CRUD functions, and no `server/src/tests/datastores/annotation_test.py` exists. All 6 database check constraints, `FileAnnotation.replies` soft-delete exclusion/ordering, DB-level `file_id`/`annotation_id` IDOR filters, UTC `edited_at` updates, and cascading `soft_delete()` to active replies are completely untested. In addition, `PATCH` and `DELETE` on `/{file_id}/annotations/{annotation_id}/replies/{reply_id}`, admin `PATCH` `403`, `filesize == 0` offset `400`, and >10,000-character body `422` have zero route tests.
   - **Fix:** Add `server/src/tests/datastores/annotation_test.py` against an in-memory SQLite session (following `server/src/tests/datastores/status_test.py`) covering model constraints and all CRUD helpers, and add route tests in `annotations_test.py` for reply `PATCH`/`DELETE`, admin `PATCH` `403`, `filesize == 0`, and oversized bodies.
   - **If we skip it:** Regressions in soft-delete cascading, IDOR query filters, or reply authorization will not be caught by `pytest`.

6. **Runestone annotation composable, `FileView` flows, panel mutations, and `FolderTable` count lack tests** (`web/runestone/src/composables/useFileAnnotations.ts`; `web/runestone/src/views/__tests__/FileView.test.ts`; `web/runestone/src/components/viewers/__tests__/FileAnnotationsPanel.test.ts`)
   - **What this is:** Frontend state management, view wiring, panel CRUD UI, and folder table comment indicator.
   - **Problem:** `useFileAnnotations.ts` is the only composable out of 47 in `src/composables/` without a unit test file; its cache writes, `useItemsStore` count sync, sign-out clearing, and `useAnnotationPulse` are untested. `FileView.test.ts` adds no tests for `?comment=` deep-linking, auto-opening the `Comments` tab, `Escape` deselection, or the `c` shortcut; `FileAnnotationsPanel.test.ts` does not test create/edit/delete/reply or author/admin menu gating; `FolderTable.test.ts` does not test `annotationCount`.
   - **Fix:** Add `src/composables/__tests__/useFileAnnotations.test.ts`, add annotation flow tests to `FileView.test.ts`, add mutation and permission cases to `FileAnnotationsPanel.test.ts`, and add a row indicator test to `FolderTable.test.ts`.
   - **If we skip it:** Broken flows like the `Escape` and sign-out bugs above will keep slipping past `vitest`, and touched runtime files fall below the 85% coverage floor in `web/runestone/AGENTS.md`.

7. **`FileAnnotationsPanel` carries edit, reply, and error state across file navigation** (`web/runestone/src/views/FileView.vue:L478-496`)
   - **What this is:** `<FileAnnotationsPanel>` mounted inside `<FileSidePanel>` on `FileView`.
   - **Problem:** Navigating directly between files reuses `FileView` and `<FileAnnotationsPanel>`. Local refs in `FileAnnotationsPanel` (`actionError`, `editingAnnotationId`, `editingReplyKey`, `editError`, `replyError`, `expandedReplyId`, `replyTextById`) are never reset when `file.id` changes, so a delete error banner or open edit/reply state from file A stays visible on file B.
   - **Fix:** Add `:key="file.id"` on `<FileAnnotationsPanel>` in `FileView.vue:L478`.
   - **If we skip it:** Operators navigating between files see stale error alerts or leftover edit/reply boxes from the previous file.

8. **Dead code: unused `formatAnnotationTime` helper and `Send` icon export** (`web/runestone/src/utils/annotations.ts:L226-232`; `web/runestone/src/components/icons/index.ts:L87`)
   - **What this is:** Timestamp formatter in `utils/annotations.ts` and `Send` re-export in the icons barrel.
   - **Problem:** Neither `formatAnnotationTime` (7 lines) nor `Send` (1 line) is imported or called anywhere in the codebase (`FileAnnotationsPanel.vue` uses `shortStamp` and `stamp`).
   - **Fix:** Delete `formatAnnotationTime` from `web/runestone/src/utils/annotations.ts` and remove `Send` from `web/runestone/src/components/icons/index.ts`.
   - **If we skip it:** Unused exports stay in the bundle and lower test coverage on `utils/annotations.ts`.

## Nice to have

9. **Strip `?comment=` when copying a selection link** (`web/runestone/src/composables/useMarkedRange.ts:L161-166`; `web/runestone/src/components/viewers/SelectionPopover.vue:L138-142`)
   - **What this is:** Link-copy helpers that build a shareable URL for a selected line, row, or byte range.
   - **Problem:** Both copy `window.location.href` and replace only `url.hash`. If a comment was previously selected (`?comment=5#0x05`) and the operator extends a byte selection with `Shift+Arrow` in `HexViewer` and presses `m` (or clicks `Copy link` before `router.replace` finishes), the copied URL keeps `?comment=5` and opens that comment instead of just the selected bytes.
   - **Fix:** Add `url.searchParams.delete('comment')` before `copyToClipboard` in `useMarkedRange.ts:L164` and `SelectionPopover.vue:L141`.
   - **If we skip it:** Links copied via keyboard selection after viewing a comment can point colleagues to the old comment ID.

Verdict: fix 1 through 8 first.
Lean: -8 lines possible.
Not checked: live PostgreSQL Alembic upgrade/downgrade, browser visual rendering across dark/light themes and 1024px viewport width, and V8 coverage percentages.


---

# Review Round 2

Date: 2026-11-26
PR: https://github.com/openrelik/openrelik/pull/163 (commit `d6b19b6`)
Checks run:
- Server: `black` clean on all new/updated annotation files; `pytest` -> 649 passed (including 9 SQLite datastore tests and 18 route tests).
- Runestone: `npm run format:check`, `npm run lint:check --max-warnings=0`, `npm run type-check`, `vitest run` (162 files / 1,158 tests), and `npm run build` all passed.

What this change does: Adds file selection annotations and threaded replies to the OpenRelik server (SQLAlchemy models, Alembic migration, seven `/api/v1/files/{file_id}/annotations` routes, and batched folder comment counts) and the Runestone web UI (highlight layers across all four viewers, floating `SelectionPopover`, `Comments` sidebar tab, URL `?comment=<id>#...` deep-linking, and folder list comment badges). Assumed load: concurrent API requests and folders with hundreds to thousands of files, multi-gigabyte evidence files streamed in chunks, and dozens to hundreds of annotations per file.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done
- R9: done
- R10: broken: `TextViewer` paints inline highlights without counting whole-line annotations on the same line, and viewer highlight rendering has no tests
- R11: partial: switching comments in the sidebar briefly scrolls to the previous comment first, clicking blank or short whole-line rows in `TextViewer` deselects instead of opening the thread, and viewer click/jump paths have no tests
- R12: broken: pressing `Escape` once after clicking an annotated row in `TableViewer` only clears the row cursor and leaves the comment active and in the URL
- R13: done
- R14: done
- R15: done
- R16: done

## Must fix

1. **Whole-line and inline highlights clash in `TextViewer`** (`web/runestone/src/components/viewers/TextViewer.vue:L353-378`)
   - **What this is:** `paintAnnotations()` paints column-scoped annotations using the browser's CSS Custom Highlight API (which draws colored overlays above element backgrounds) while whole-line annotations use row background classes.
   - **Problem:** `paintAnnotations()` passes only `inlineAnnotations` into `computeTextRowSegments()`, ignoring whole-line annotations on the same line. If line 10 has both a whole-line comment and a column comment, activating the whole-line comment still paints the column span in the dimmer opaque `single` tint on top of the active row, punching a dim hole through the active highlight and its arrival pulse. When neither is active, the shared characters also render as `single` instead of `overlap`.
   - **Fix:** Inside `paintAnnotations()`, read `const wholeLayer = wholeLineRowLayer(lineNum - 1)` for each row. Skip non-active inline segments when `wholeLayer === 'active'`, and promote `seg.layer` from `'single'` to `'overlap'` whenever `wholeLayer !== 'none'`.
   - **If we skip it:** Any line carrying both a gutter comment and a text-span comment shows broken highlight stacking and a dark patch inside the active row.

2. **`Escape` takes two presses to deselect a comment in `TableViewer`** (`web/runestone/src/components/viewers/TableViewer.vue:L446-448, L480-484`)
   - **What this is:** Keyboard handler for `Escape` while the table grid has focus.
   - **Problem:** Clicking an annotated row sets `cursor.value`, sets the mark, activates the comment, and focuses the table scroller. Pressing `Escape` hits `cursor.value !== null` first, clears only `cursor.value`, and calls `event.stopPropagation()`. Because `rowBgClass` paints the active annotation above the cursor color, nothing changes visually, the comment stays selected, and `?comment=` plus `#R...` remain in the URL.
   - **Fix:** In `onKey` (and `onFullscreenKey`), handle `event.key === 'Escape' && props.activeAnnotationIds.size` before the `cursor.value !== null` check, clearing `cursor.value = null`, `marks.set(null)`, and emitting `selectAnnotations([], '')`.
   - **If we skip it:** Pressing `Escape` after clicking an annotated table row appears to do nothing and breaks R12.

## Should fix

3. **Switching comments in the sidebar briefly scrolls to the previous comment first** (`web/runestone/src/views/FileView.vue:L303-309`)
   - **What this is:** `selectAnnotation()` activates a clicked comment card, updates the URL hash, and bumps `annotationPulse` so the viewer scrolls and pulses.
   - **Problem:** `mark.value = annotationMark(annotation)` updates `route.hash` asynchronously through `writeUrl()` and Vue Router's async `beforeEach` guard, while `annotationPulse.value++` triggers each viewer's watcher immediately. On `nextTick()`, `mark.value` is still the previous comment's range, so the viewer scrolls to the old comment first (and in `TableViewer` clears filters and moves the cursor to the old row) before `router.replace` settles and jumps to the new comment.
   - **Fix:** In `selectAnnotation()`, check `const sameHash = formatMark(nextMark) === route.hash`, set `mark.value = nextMark` and `writeUrl({ comment: String(annotation.id) })`, and increment `annotationPulse.value++` only when `sameHash` is true. When the hash changes, `useMarkedRange` already lands on the new range and triggers the pulse once settled.
   - **If we skip it:** Clicking from one comment card to another produces a visible jump to the old location before landing on the new one.

4. **Clicking empty space on a whole-line annotated row in `TextViewer` deselects instead of opening the thread** (`web/runestone/src/components/viewers/TextViewer.vue:L560-582, L810-815`)
   - **What this is:** Click hit-testing in `TextViewer` that opens an annotation thread or clears the selection when clicking outside.
   - **Problem:** Whole-line annotations paint the full-width row `<div>`, while `<TextRow>` (`[data-row]`) only wraps the line's characters and has no text nodes on blank lines. Clicking the highlighted background on a blank line inside a multi-line comment (or to the right of a short line where `caretPositionFromPoint` returns the row `<div>`) makes `pointAt()` return `null`, so `onTextClick` falls through and deselects instead of selecting the comment.
   - **Fix:** Put `:data-line="row.line + 1"` on the row `<div>` at `L810`. When `pointAt()` returns `null` in `onTextClick`, look up `closest('[data-line]')` and hit-test `wholeLineAnnotations.value` on that line.
   - **If we skip it:** Clicking the highlighted amber bar on blank or short annotated lines closes the comment instead of opening it.

5. **Saving a comment while switching files writes the old comment into the new file's URL** (`web/runestone/src/components/viewers/FileAnnotationsPanel.vue:L113-129, L149-160, L227-263`)
   - **What this is:** Async handlers in `FileAnnotationsPanel` that emit `select` or mutate component state after awaiting API calls, confirmation dialogs, or clipboard writes.
   - **Problem:** `FileView` stays mounted when navigating from file A to file B, remounting `FileAnnotationsPanel` via `:key="file.id"`. If a user submits a comment on file A over a slow connection and opens file B before the POST finishes, `submitDraft()` still runs `emit('select', created)` after unmount, which invokes `FileView.selectAnnotation()` and writes file A's `?comment=<id>#...` onto file B's URL.
   - **Fix:** Track `let unmounted = false` (set in `onUnmounted`) and return early after `await` in `submitDraft()`, `copyCommentLink()`, `removeAnnotation()`, and `removeReply()`.
   - **If we skip it:** Slow-network file switches during comment creation leak the previous file's comment ID and line mark into the new file's URL and view.

6. **Annotation API endpoints and all four viewer integrations have no unit tests** (`web/runestone/src/api/endpoints/annotations.ts`, `web/runestone/src/components/viewers/__tests__/TextViewer.test.ts`, `TableViewer.test.ts`, `HexViewer.test.ts`, `MarkdownViewer.test.ts`)
   - **What this is:** New HTTP client methods for the seven annotation endpoints and all viewer-side highlight, hit-testing, popover, `Escape`, and `c`-shortcut code added across the four viewers.
   - **Problem:** `useFileAnnotations.test.ts` and `FileView.test.ts` mock `api.annotations.*`, leaving `api/endpoints/annotations.ts` at 0% coverage (violating `web/runestone/AGENTS.md`'s 85% per-file V8 line coverage floor). None of the four viewer test files named in `spec.md` (`TextViewer.test.ts`, `TableViewer.test.ts`, `HexViewer.test.ts`, `MarkdownViewer.test.ts`) test any annotation behavior, which is why findings 1 and 2 passed CI.
   - **Fix:** Add `web/runestone/src/api/__tests__/annotationsEndpoints.test.ts` (following `statusEndpoints.test.ts`) covering all seven endpoint calls, and add focused annotation tests to `TextViewer.test.ts`, `TableViewer.test.ts`, `HexViewer.test.ts`, and `MarkdownViewer.test.ts` covering highlight layers, click hit-testing and deselection, `Escape`, `selectionPopover` triggers/suppression, and `c`.
   - **If we skip it:** Broken endpoint URLs or regressions in viewer highlights, click hit-testing, and keyboard handling will slip past `vitest`.

## Nice to have

7. **Deleting an active comment leaves its URL hash behind, and empty click-clear duplicates `deselectAnnotation`** (`web/runestone/src/views/FileView.vue:L313-319, L345-356`)
   - **What this is:** State cleanup in `FileView` when the active comment is deleted or deselected from a viewer.
   - **Problem:** `onViewerAnnotationsClicked([], '')` duplicates `deselectAnnotation()` without clearing `mark.value`, leaving a stale hash if the user deselected from a different viewer tab (such as switching from Text to Hex). Similarly, `deleteAnnotationAndClear()` clears `activeAnnotationId` and `?comment=`, leaving the deleted comment's `#L...` / `#R...` / `#0x...` yellow URL mark active on screen.
   - **Fix:** Call `deselectAnnotation()` inside the `if (!ids.length)` branch (removing 4 lines), and set `mark.value = null` inside `deleteAnnotationAndClear()` when the deleted comment was active.
   - **If we skip it:** Deleting an active comment leaves a yellow URL mark on the range until the user clicks away or presses `Escape`.

Verdict: fix 1 through 6 first.
Lean: -4 lines possible.
Not checked: live PostgreSQL Alembic upgrade/downgrade, `npm run test:coverage` per-file V8 percentages, and manual browser checks in light/dark themes and 1024px viewport width.


---

# Review Round 3

Date: 2026-11-26
PR: https://github.com/openrelik/openrelik/pull/163 (commit `987ca7b`)
Checks run:
- Server (unchanged since `d6b19b6`): `black --check` clean on all new/updated annotation files; `pytest` -> 649 passed (including 9 SQLite datastore tests, 18 route tests, and batched folder `annotation_count` tests).
- Runestone: `npm run format`, `npm run lint:check` (`--max-warnings=0`), `npm run type-check`, `npm run test:coverage` (163 files / 1,166 tests passed; V8 line coverage 88.53%–100% on all 17 touched runtime files), and `npm run build` all passed.

What this change does: Adds selection-anchored comments and threaded replies across OpenRelik's backend and Runestone file viewers (text, rendered Markdown, table, and hex), plus a comment count indicator beside filenames in folder listings. The server stores coordinates and plain-text bodies in two new tables (`fileannotation` and `fileannotationreply`) with database check constraints, partial indexes, ACL checks, and IDOR checks, without modifying evidence files on disk. Assumed load: concurrent API requests over large folders and multi-gigabyte evidence files streamed in chunks by virtualized viewers.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done
- R9: done
- R10: done
- R11: done
- R12: done
- R13: done
- R14: done
- R15: done
- R16: done

## Nice to have

1. **Copied link for a hex comment on a Markdown file can keep `?view=rendered`** (`web/runestone/src/components/viewers/FileAnnotationsPanel.vue:L152-163`)
   - **What this is:** Builds a shareable URL (`?comment=<id>#...`) for a comment when the user picks Copy link from the thread menu.
   - **Problem:** If an analyst opens a Markdown file, selects an existing byte-offset comment, switches back to the Rendered tab (which puts `?view=rendered` on the URL while keeping the Comments tab and active thread open), and then copies the comment link, the URL keeps `?view=rendered` alongside `#0x...`. Opening that URL hits `FileContent.vue:L115`, where `?view=rendered` takes precedence over the offset hash, so the page opens in Rendered Markdown instead of Hex.
   - **Fix:** Drop the `view` query parameter when the annotation is not a line comment: `if (annotation.anchor_kind !== 'line') url.searchParams.delete('view')`.
   - **If we skip it:** A link copied from that specific tab-switch sequence opens the wrong viewer until the recipient clicks the comment card in the sidebar.

Verdict: LGTM
Note: Nice-to-have item 1 (`delete('view')` for non-line comments in `FileAnnotationsPanel.vue`) was applied before pushing.
Not checked: Live PostgreSQL `alembic upgrade` / `downgrade` and manual browser checks in light/dark themes and at 1024px viewport width.
