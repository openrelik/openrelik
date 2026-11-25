---
slug: file-selection-annotations
issue: https://github.com/openrelik/openrelik/issues/160
created: 2026-11-25
by: berggren (Johan Berggren)
---
# Research: File selection annotations

## What I wanted to know

1. How to design a simple SQLAlchemy data model and FastAPI API for selection-anchored comments with threaded replies that fits OpenRelik's existing architecture (`BaseModel`, `authz.py`, Alembic, Pydantic schemas) and leaves room for tags and verdicts later without premature abstraction.
2. How Runestone's four file viewers (`TextViewer`, `TableViewer`, `HexViewer`, `MarkdownViewer`) handle selection coordinates, streaming, virtualization, and the side panel today, and what edge cases affect persistent annotations.
3. What UX best practices from Google Docs, GitHub, Hypothesis, VS Code, Timesketch, and Autopsy translate cleanly to Runestone's high-density Technical Console Design System (`web/runestone/docs/design-system.md`), especially for overlapping selections, virtualized scrolling, and narrow viewports.
4. What forensic integrity, provenance, untrusted-content safety, and scale constraints apply.

---

## What I found

### 1. OpenRelik server architecture and conventions

- **Base model and soft delete** (`server/src/datastores/sql/database.py:72-103`): Every SQLAlchemy model inherits `BaseModel`, which sets `__tablename__ = cls.__name__.lower()` and provides `id` (`BigInteger().with_variant(Integer, "sqlite")`), `created_at`, `updated_at` (both `DateTime(timezone=True)` with `func.now()`), `deleted_at`, `is_deleted`, `purged_at`, `is_purged`, and `soft_delete()`.
- **Soft-delete query gotcha** (`server/src/datastores/sql/database.py:185-204`, `server/src/datastores/sql/crud/folder.py:109`): The `before_compile` event listener automatically appends `is_deleted == False` ONLY on legacy `db.query(...)` calls. It does **not** run on `db.get(Model, id)` or SQLAlchemy 2.0 `select()` statements, and `relationship()` loaders need explicit filtering (`primaryjoin` or CRUD queries) so soft-deleted replies never leak into responses.
- **`updated_at` vs. edited timestamps** (`server/src/datastores/sql/database.py:91-93`): `BaseModel.updated_at` uses `onupdate=func.now()`, so any column update (including `soft_delete()` or a future resolve/reopen toggle) bumps `updated_at`. Tracking whether comment text was edited requires a dedicated nullable `edited_at` column rather than comparing `updated_at > created_at`.
- **File immutability** (`server/src/datastores/sql/models/file.py:67-129, 503-507`): Once uploaded or created by a worker, a `File`'s on-disk bytes are never mutated; its hashes (`hash_md5`, `hash_sha1`, `hash_sha256`, `hash_ssdeep`) and `filesize` stay fixed for its lifetime. Unlike Google Docs, where live document edits force complex OT/CRDT anchor tracking, OpenRelik selection coordinates never drift.
- **Authorization and IDOR prevention** (`server/src/datastores/sql/crud/authz.py:45-125, 172-238`; `server/src/api/v1/files.py:530-544`):
  - `@require_access(allowed_roles=[Role.VIEWER, Role.EDITOR, Role.OWNER])` already resolves direct `UserRole` and `GroupRole` grants on the `File`, falls back up the parent `Folder` chain, and stops on `Role.NO_ACCESS`. That matches the idea's rule ("inherit file/folder access; all readers can annotate") with zero new authz plumbing.
  - Because `@require_access` checks `file_id` from the URL path, every single-resource route must verify `annotation.file_id == file_id` (and `reply.annotation_id == annotation_id`) as `get_file_summary` does at `files.py:541-543`.
  - Ownership checks in existing routes use `entity.user_id != current_user.id and not current_user.is_admin` (see `server/src/api/v1/workflows.py:531`).
- **Alembic and dual-dialect indexes** (`server/src/datastores/sql/alembic/env.py:9-18`, `server/src/datastores/sql/models/file.py:95-102`, `server/src/datastores/sql/alembic/versions/a7c3e9f1b402_add_non_terminal_task_workflow_index.py:24-31`): New models must be imported in `alembic/env.py`. Partial indexes declare both `postgresql_where=text("NOT is_deleted")` and `sqlite_where=text("NOT is_deleted")`.
- **Router size**: `server/src/api/v1/files.py` is already 702 lines. Putting annotation endpoints in a dedicated `server/src/api/v1/annotations.py` (mounted under `/files` in `server/src/main.py`) with CRUD in `server/src/datastores/sql/crud/annotation.py` follows `server/AGENTS.md` cleanly without bloating `files.py`.

### 2. Runestone viewers, marks, and layout constraints

- **Unified coordinate system already exists** (`web/runestone/src/utils/marks.ts:17-46`):
  - `MarkKind = 'line' | 'row' | 'offset'`
  - `Span = { from: number; to: number; fromCol?: number; toCol?: number }`
  - `line`: 1-based lines (`#L12`, `#L12-L40`), or 1-based line + 1-based UTF-16 caret columns (`#L12C5-L14C20`, both `fromCol` and `toCol` set). `TextViewer` and `MarkdownViewer` share `kind='line'`.
  - `row`: 1-based parsed table row index (`#R12`, `#R12-R40`) in `TableViewer`.
  - `offset`: 0-based inclusive byte offsets (`#0x1f3`, `#0x1f3-0x2a0`) in `HexViewer`. Must use 64-bit `BigInteger` in SQL (multi-GB disk images exceed 32-bit `INT`). Note JS `Number.MAX_SAFE_INTEGER` is `2^53 - 1` (~9 PB), already checked via `Number.isSafeInteger` in `marks.ts:76`.
- **Viewer-specific behavior and edge cases**:
  - **`TextViewer.vue`** (`web/runestone/src/components/viewers/TextViewer.vue`): Virtualized via `useRowScroller` (20px rows; only visible rows exist in the DOM). Lines longer than `ROW_CHARS = 2000` (`web/runestone/src/utils/lines.ts:30`) split into multiple rows. Already uses the **CSS Custom Highlight API** (`::highlight(text-mark)`, `TextViewer.vue:216-267`, `main.css:291-293`) to tint exact text spans without splitting text nodes, plus `pointAt(x, y)` (`TextViewer.vue:353-358`) to map pointer coordinates back to `(line, col)`, plus ticks on the custom scrollbar track (`hitMarks`, `TextViewer.vue:134-141`). Streams incrementally up to a 256 MiB auto-read cap (`StreamStatusBar`).
  - **`MarkdownViewer.vue`** (`web/runestone/src/components/viewers/MarkdownViewer.vue` & `MarkdownView.vue`): Renders up to `RENDER_MAX = 2_000_000` chars (~2 MiB). Marks map to source block ranges (`data-line`..`data-end`) using `kind='line'`. Annotations created in `Source` automatically overlap the corresponding blocks in `Rendered` (`MarkdownView.vue:75`), and annotations past `RENDER_MAX` can jump to `Source` via `emit('source', line)`.
  - **`TableViewer.vue`** (`web/runestone/src/components/viewers/TableViewer.vue`): Virtualized (24px rows) with client-side filtering and column sorting (`view`, lines 90-130). Row numbers (`line.index + 1`) stay tied to the original file order, so **when sorted or filtered, a multi-row annotation `#R12-R40` can be non-contiguous on screen or partially hidden**. `tryLand()` (`TableViewer.vue:265-283`) already clears active filters/sorts when jumping to a hidden row. Also has a **fullscreen mode** (`TableViewer.vue:417`, `<Teleport to="body">`) that covers `FileSidePanel`.
  - **`HexViewer.vue`** (`web/runestone/src/components/viewers/HexViewer.vue`): Virtualized 16-byte rows backed by 32 × 64 KiB LRU byte chunks (`useByteChunks`). Every byte renders in both the Hex and ASCII Text columns via `tone(offset)` (`HexViewer.vue:412-417`), which currently prioritizes `selected` > `hovered` > `marked`. Has its own custom scrollbar (`HexViewer.vue:606-620`) where annotation ticks can also appear.
- **Side panel and responsive constraint** (`web/runestone/src/views/FileView.vue:129-172, 279-285`, `web/runestone/src/components/viewers/FileSidePanel.vue:36-105`):
  - `FileSidePanel` is a resizable `<SlidePane>` (`416px` default, `280px` min) with tabs `Details` and `Inspector` (mounted via `<Teleport>` from `HexViewer` and `TableViewer`).
  - **Important constraint**: `FileSidePanel` currently carries `max-xl:hidden` (`FileSidePanel.vue:53`, `FileView.vue:272`), hiding it completely below `1280px` width! Runestone's own verification rules (`web/runestone/AGENTS.md:303`) test narrow `1024px` viewports, so relying exclusively on the current `max-xl:hidden` side panel would make annotations unusable on `1024px` screens unless narrow-viewport access (e.g., overlay `<SlidePane>` below `xl`) is added.
- **Design system & performance rules** (`web/runestone/docs/design-system.md`, `web/runestone/AGENTS.md`):
  - Zero new runtime dependencies; zero `v-html`; all timestamps in UTC with `.tabular`; locked OKLCH tokens in `src/assets/main.css` (dark + light, AAA/AA contrast, enforced by `tokens.test.ts`); `PopoverSurface` + `utils/placement.ts` for anchored popovers; `useQueryCache` (`ensure()`) + `useAutoRefresh` + `useDelayedFlag` for slow/offline connections; sign-out wipe in `stores/auth.ts`.
  - Existing keyboard shortcuts in `FileView` and viewers: `w` (workflow), `d` (download), `i` (details), `Escape` (clear selection → mark → back), `:` (go to line), `/` (find/filter), `m` (copy mark link), `f` (table fullscreen), `o` (go to offset), `[` / `]` (hex jump history). Notice `c` is currently **unused** across `FileView` and all four viewers (outside `isTyping()`).

### 3. UX best practices and prior art

- **Google Docs (inline highlights + contextual cards + overlap behavior)**:
  - *What makes it work*: Zero document reflow; pale tint on annotated spans that deepens on hover/active focus; bi-directional tether (clicking highlight focuses card, clicking card scrolls to and elevates highlight); overlapping highlights step up in tint darkness so multi-comment regions are immediately visible.
  - *What does NOT transfer directly to Runestone*: Google Docs positions cards vertically beside a fixed-width printed page with a push-and-shift collision engine. In Runestone's edge-to-edge virtualized viewers (20px rows, horizontal scrolling in text/tables, 100k+ lines, sorted tables where a range isn't even contiguous, and an existing right `FileSidePanel`), a floating margin lane would collide with `FileSidePanel`, starve horizontal space on 1280px–1440px screens, and displace cards far from 20px rows whenever comments cluster.
- **Hypothesis & W3C Web Annotation Data Model**:
  - Decouples storage (independent flat annotations with selectors) from client rendering (the viewer computes overlap regions dynamically).
  - Avoids DOM-splitting opacity bugs by computing non-overlapping atomic slices or layered highlight priority, and uses a sidebar to keep deep threads and replies out of the document canvas.
  - For OpenRelik, full W3C JSON-LD / `TextQuoteSelector` fuzzy anchoring is unnecessary because evidence files are immutable; however, borrowing the *storage/rendering decoupling* (each annotation stores its exact span independently; viewers compute overlaps on visible rows only) keeps both backend and frontend simple.
- **CSS Custom Highlight API overlap mechanics (MDN / W3C spec)**:
  - `Highlight.priority` is **all-or-nothing per CSS property**: if two `Highlight` objects both set `background-color`, the higher-priority one completely replaces the lower-priority one rather than alpha-blending them.
  - **Clean zero-DOM-split solution for `TextViewer`**: Run an interval sweep over only the ~40 visible rows to partition ranges into 3 named `Highlight` layers with explicit priorities:
    1. `annotation` (`priority = 1`): single-annotation tint
    2. `annotation-overlap` (`priority = 2`): 2+ overlapping annotations (stepped darker tint, matching Google Docs' visual overlap cue)
    3. `annotation-active` (`priority = 3`): currently selected/hovered thread (vivid tint + subtle underline)
    4. `text-mark` (`priority = 4`): active URL/selection mark (or merged with `annotation-active` when jumping to a thread)
  - Because `TextViewer` already has `pointAt(x, y)` (`caretPositionFromPoint` / `caretRangeFromPoint`), clicking a painted highlight resolves `(line, col)` and hit-tests covering annotations without injecting clickable `<span>` wrappers that break drag-selection!
- **GitHub Pull Requests & VS Code Comments API**:
  - Selection creation mirrors what Runestone's `useMarkedRange` already does (click gutter, `Shift+Click`, drag, or select text/bytes). Adding a compact "Comment" button beside the existing `Copy link` button in the viewer bar (plus shortcut `c` and optional anchored quick-composer) fits existing muscle memory with zero visual clutter when nothing is selected.
  - Inline/gutter markers (quiet bar or count dot in the gutter) + scrollbar ticks let analysts spot annotated areas while scrolling large files quickly.
- **Timesketch & Autopsy (DFIR prior art)**:
  - Both store investigative comments/notes in a relational case database completely separate from read-only evidence/index data (preserving evidentiary integrity).
  - In DFIR, unlike collaborative prose editing, comments record **investigative findings and hypotheses** ("C2 beacon observed", "malicious scheduled task payload"). A Google Docs "Resolve" button that *hides* findings from default view can be dangerous in an investigation if a teammate misses a resolved finding—whereas keeping comments visible by default (and only adding resolve/status later if needed, or showing resolved count explicitly) avoids silent omissions.
- **Accessibility (W3C ARIA 1.3)**:
  - Use `role="comment"` on thread cards/replies with `<time datetime="...">` in UTC and author identity (`UserAvatar` + display name).
  - Keyboard navigation: `c` to start a comment on the active selection/mark, `Cmd/Ctrl+Enter` to submit, `Escape` to cancel composer (closing active annotation next, then selection, then mark, then back), and next/previous annotation stepping (avoiding `[` / `]` which `HexViewer` uses for jump history).

### 4. Forensic & security checks

- **Evidence integrity**: Source files are never modified; annotations live solely in PostgreSQL with `file_id` FK.
- **Provenance**: Every annotation and reply ties to `file_id` (which holds `uuid` and `hash_sha256`), `user_id`, UTC `created_at`, and `edited_at`. Soft-delete preserves deleted records in the DB (`is_deleted`, `deleted_at`) for auditability.
- **Untrusted content safety**: Analysts frequently quote hostile strings (URLs, scripts, shell commands, bidi overrides) inside comments. Comment bodies render strictly as escaped plain text (`whitespace-pre-wrap break-words`, with control/bidi characters escaped; no `v-html`, no Markdown parsing, no active links).
- **Coordinate determinism**:
  - `TextViewer` columns are 1-based UTF-16 code units on `\n`-split lines with trailing `\r` stripped (`lines.ts:91`). Deterministic across browsers/sessions; worth documenting explicitly if Python/MCP clients consume `range_start_col`/`range_end_col` later.
  - `HexViewer` offsets are 0-based raw byte offsets (`BigInteger` required for >2 GiB files).
  - `TableViewer` row numbers are 1-based parsed data rows (skipping CSV/TSV header row). Deterministic for a given `TableKind` parser version.
- **Scale & slow connections**:
  - Keep annotations out of `GET /api/v1/files/{file_id}` (`FileResponse`); serve them from `GET /api/v1/files/{file_id}/annotations` loaded in parallel via `useQueryCache` (`file:${fileId}:annotations`) and refreshed via `useAutoRefresh`.
  - Cap comment/reply body length (e.g., 10,000 chars) to prevent DB bloat.
  - Register cache reset in `web/runestone/src/stores/auth.ts` (`setUser(null)`).

---

## Options and trade-offs

### Data model

**Option A (Recommended): Two tables — `FileAnnotation` + `FileAnnotationReply`**

Follows `FileSummary`/`FileSummaryFeedback` and `FileChat`/`FileChatMessage` in `server/src/datastores/sql/models/file.py`.

```python
class FileAnnotation(BaseModel):
    # __tablename__ = "fileannotation" (from BaseModel)
    file_id: Mapped[int] = mapped_column(ForeignKey("file.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)

    # Matches MarkKind + Span in web/runestone/src/utils/marks.ts
    anchor_kind: Mapped[str] = mapped_column(Unicode(16), index=True)  # "line" | "row" | "offset"
    range_start: Mapped[int] = mapped_column(BigInteger)               # 1-based line/row, 0-based offset
    range_end: Mapped[int] = mapped_column(BigInteger)                 # inclusive, >= range_start
    range_start_col: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # line only, 1-based
    range_end_col: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)    # both set or both NULL

    body: Mapped[str] = mapped_column(UnicodeText)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

class FileAnnotationReply(BaseModel):
    # __tablename__ = "fileannotationreply" (from BaseModel)
    annotation_id: Mapped[int] = mapped_column(ForeignKey("fileannotation.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)
    body: Mapped[str] = mapped_column(UnicodeText)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
```

- *Constraints & indexes*:
  - Partial index `ix_fileannotation_file_id_active` on `(file_id, anchor_kind, range_start)` where `NOT is_deleted` (both PostgreSQL and SQLite).
  - Partial index `ix_fileannotationreply_annotation_id_active` on `(annotation_id, created_at)` where `NOT is_deleted`.
  - Check constraints: `anchor_kind IN ('line', 'row', 'offset')`, `range_end >= range_start`, `(range_start_col IS NULL) = (range_end_col IS NULL)`, `(anchor_kind = 'line' OR range_start_col IS NULL)`, and non-negative/1-based bounds (`(anchor_kind = 'offset' AND range_start >= 0) OR (anchor_kind IN ('line', 'row') AND range_start >= 1)`).
- *Pros*: Dead simple; strict `NOT NULL` anchor invariants; 1 INSERT to create a comment; 2 SQL queries (`FileAnnotation` + `selectinload(replies, user)`) to load a file's threads; matches existing `BaseModel` patterns; clean additive path for tags/verdicts later (either adding `annotation_type`/tag fields on `FileAnnotation` or attaching a child table to `fileannotation.id`).
- *Cons*: Deleting the root annotation soft-deletes the whole thread (same as Google Docs; confirm if replies exist).

**Option B: Single self-referential table (`FileAnnotation` with `parent_id`)**
- *Pros*: One table instead of two.
- *Cons*: Anchor columns must be nullable on replies, weakening DB check constraints; blurs anchor vs. reply semantics when tags/verdicts are added later.

**Option C: Separate `FileSelection` + `FileAnnotationComment` tables**
- *Pros*: Deleting the first comment can leave replies behind; multiple unrelated objects (comment, tag, verdict) could share one selection row.
- *Cons*: Extra table and join for every read/write today; speculative complexity before tags/verdicts are designed (against project simplicity rule).

### REST API shape

Dedicated router `server/src/api/v1/annotations.py` mounted under `/files`:
- `GET /api/v1/files/{file_id}/annotations`
- `POST /api/v1/files/{file_id}/annotations`
- `PATCH /api/v1/files/{file_id}/annotations/{annotation_id}`
- `DELETE /api/v1/files/{file_id}/annotations/{annotation_id}`
- `POST /api/v1/files/{file_id}/annotations/{annotation_id}/replies`
- `PATCH /api/v1/files/{file_id}/annotations/{annotation_id}/replies/{reply_id}`
- `DELETE /api/v1/files/{file_id}/annotations/{annotation_id}/replies/{reply_id}`

All routes use `@require_access(allowed_roles=[Role.VIEWER, Role.EDITOR, Role.OWNER])`. Editing (`PATCH`) is restricted to the author (`user_id == current_user.id`); deleting (`DELETE`) is restricted to the author or an admin (`user_id == current_user.id or current_user.is_admin`, matching `WorkflowTemplate` at `workflows.py:531`).

### UX layout for threads & overlapping highlights

**Option 1 (Recommended): `Comments` tab in `FileSidePanel` + Google Docs-style in-viewer highlight stacking + compact floating composer/peek**
- *How it works*:
  - **In-viewer**: Saved annotations tint their selection in all 4 viewers using dedicated OKLCH annotation highlight tokens in `web/runestone/src/assets/main.css` (so saved annotations stay visually distinct from temporary `warning` URL marks and search hits): `TextViewer` via 3-layer CSS Custom Highlight API + gutter indicator + scrollbar ticks; `MarkdownViewer` on enclosing blocks; `TableViewer` via row tint + gutter indicator; `HexViewer` via `tone(offset)` + gutter/scrollbar ticks. Overlapping spans step up in tint intensity; the active/hovered thread elevates to the strongest highlight.
  - **Creation**: Selecting/marking a range reveals an "Add comment" icon button beside the existing `Copy link` button in the viewer toolbar (plus keyboard shortcut `c`), opening an inline composer in the `Comments` tab (or a `<PopoverSurface>` composer if the side panel is closed / in fullscreen `TableViewer`).
  - **Side panel**: Adds a `Comments` tab (with tabular count, e.g., `Comments 3`) to `FileSidePanel` alongside `Details` and `Inspector`. Cards are ordered by file position, show author (`UserAvatar`), UTC timestamp, clickable coordinate chip (`L12–L40`, `R5`, `0x1f3–0x2a0`), plain-text body, and inline reply thread. Threads stay purely open (no resolve state in v1) and no evidence excerpt is copied into Postgres.
  - **Clicking an overlapping selection**: Highlights and filters/focuses the matching threads at that coordinate in the `Comments` tab (e.g., "2 comments at line 14 · Show all"), avoiding Google Docs' vertical margin pile-ups while keeping multi-thread disambiguation instant.
  - **Narrow viewports (`< 1280px`) & `TableViewer` fullscreen**: Allow opening `FileSidePanel` (or the Comments drawer) as an overlay `<SlidePane>` below `xl` instead of hiding it completely via `max-xl:hidden`.
- *Pros*: Fits Runestone's 3-tier console layout and `<SlidePane>` architecture; works uniformly across all 4 viewers including virtualized 100k-line files and sorted tables; never steals a second right column.
- *Cons*: On wide screens, switching between `HexInspector`/`TableDetail` and `Comments` requires toggling tabs in `FileSidePanel` (mitigated if clicking a highlight auto-focuses `Comments`, or with a compact `<PopoverSurface>` peek when `Inspector` is pinned).

**Option 2: True floating right margin rail inside each viewer (literal Google Docs)**
- *Pros*: Cards sit horizontally aligned with paragraphs in `MarkdownViewer`.
- *Cons*: Collides with `FileSidePanel`, breaks under horizontal scrolling (`TextViewer`, `TableViewer`), breaks when `TableViewer` is sorted/filtered, and suffers severe vertical displacement on dense 20px rows.

**Option 3: Popover-only threads (no side panel list)**
- *Pros*: Zero impact on `FileSidePanel` tabs; works cleanly in fullscreen `TableViewer`.
- *Cons*: Analysts cannot scan all annotations in a large file without manually scrolling past them—critical miss in DFIR triage when a file has 50,000 lines and 4 findings scattered across it.

---

## Settled decisions

- **Edit and delete permissions**: Author-only for editing (`user_id == current_user.id`); author or admin for deleting (`user_id == current_user.id or current_user.is_admin`, matching `WorkflowTemplate` at `workflows.py:531`).
- **Thread state**: Purely open notes for v1 (no resolve/reopen toggle or `resolved_at` column).
- **Stored excerpt**: Skipped for now; cards display coordinates without copying evidence text into Postgres.
- **Highlight color tokens**: Distinct OKLCH annotation highlight tokens in `web/runestone/src/assets/main.css` (dark + light, verified by `tokens.test.ts`) so saved annotations never look like temporary `warning` URL marks or search hits.
- **Comment formatting**: Plain text only (`whitespace-pre-wrap break-words`, control/bidi characters escaped).

## Open questions (for design)

- None.

### Prototype suggestion

Before committing to the `TextViewer` highlighting design, a small throwaway prototype in `prototype/file-selection-annotations` could validate **3-layer CSS Custom Highlight API stacking (`annotation` / `annotation-overlap` / `annotation-active`) + `pointAt()` click hit-testing** alongside existing search hits and drag-selection in dark and light themes. Everything else (data model, API, `FileSidePanel` tab) is low-risk and straightforward to design directly.

---

## Sources

### OpenRelik codebase
- `server/src/datastores/sql/database.py:72-103, 185-204` — `BaseModel`, timestamps, soft delete, `before_compile` filter
- `server/src/datastores/sql/models/file.py:67-192, 255-507` — `File`, `FileSummary`, `FileChat`, `FileChatMessage`, partial index pattern
- `server/src/datastores/sql/crud/authz.py:45-125, 172-238` — `check_user_access`, `@require_access`
- `server/src/api/v1/files.py:530-544` — `file_id` ownership check pattern on sub-resources
- `server/src/api/v1/workflows.py:513-536` — creator/admin delete permission pattern
- `server/src/datastores/sql/alembic/env.py:9-18` & `alembic/versions/a7c3e9f1b402_add_non_terminal_task_workflow_index.py` — Alembic model registration and dual PG/SQLite partial indexes
- `web/runestone/src/utils/marks.ts:17-121` — `Mark`, `MarkKind`, `Span`, URL hash formatting/parsing
- `web/runestone/src/composables/useMarkedRange.ts:17-168` — shared gutter selection and copy-link behavior
- `web/runestone/src/views/FileView.vue:88-286` — URL mark synchronization, side panel tabs, keyboard shortcuts
- `web/runestone/src/components/viewers/FileSidePanel.vue:36-105` — `<SlidePane>` side panel, tabs, `max-xl:hidden`
- `web/runestone/src/components/viewers/TextViewer.vue:134-401` — CSS Custom Highlight API, `pointAt()`, scrollbar ticks, virtualization
- `web/runestone/src/utils/lines.ts:30-147` — `ROW_CHARS`, CRLF stripping, `sourceOffset`/`shownOffset`
- `web/runestone/src/components/viewers/TableViewer.vue:90-130, 265-283, 417` — filter/sort index mapping, `tryLand()`, fullscreen teleport
- `web/runestone/src/components/viewers/HexViewer.vue:412-417, 545-620` — `tone(offset)`, dual hex/text columns, custom scrollbar
- `web/runestone/src/components/viewers/MarkdownViewer.vue:41-59` & `MarkdownView.vue:68-77` — `RENDER_MAX`, block line-range marking
- `web/runestone/src/assets/main.css:71-294` & `web/runestone/docs/design-system.md` — locked OKLCH tokens, `::highlight(text-mark)`, console layout & interaction rules

### External prior art & web standards (checked 2026-11-25)
- MDN & W3C CSS Custom Highlight API (`Highlight.priority`, non-blending property conflict resolution): https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API and https://www.w3.org/TR/css-highlight-api-1/
- W3C WAI-ARIA 1.3 Annotations (`role="comment"`, multi-ID `aria-details`): https://w3c.github.io/aria/#comment
- W3C Web Annotation Data Model & Hypothesis architecture: https://www.w3.org/TR/annotation-model/ and https://web.hypothes.is/
- Timesketch event comments & SQLAlchemy/OpenSearch split: https://timesketch.org/ and https://github.com/google/timesketch
- Autopsy / The Sleuth Kit tagging and comments on evidence: https://www.sleuthkit.org/autopsy/
- VS Code Comments API & GitHub multi-line PR review patterns: https://code.visualstudio.com/api/extension-guides/comment
