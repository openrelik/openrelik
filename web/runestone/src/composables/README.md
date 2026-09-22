# Composables (`src/composables/`)

This directory houses reusable, stateful Vue composables. They encapsulate keyboard coordination, table selection, navigation algorithms, and reactive bridges to the Pinia stores.

---

## Overview

| Composable                                      | Primary Responsibility                                                                                            |
| :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| [`useKeyboardShortcuts`](#usekeyboardshortcuts) | Global window keyboard dispatch (`⌘,`, `⌘K`, `?`, `g`, `Escape`) and modal focus/dismissal.                       |
| [`usePrompt`](#useprompt)                       | Terminal prompt navigation, fuzzy path search, `cd` autocompletion, and modal state.                              |
| [`useRowSelection`](#userowselection)           | Table cursor positioning, multi-row selection, and anchor-based `Shift` range selections.                         |
| [`useRemembered`](#useremembered)               | Safe, reactive `localStorage` state persistence with resilient fallback defaults.                                 |
| [`useRun`](#userun)                             | Worker execution orchestration, worker target configuration, and `RunDialog` modal bridge.                        |
| [`useSettings`](#usesettings)                   | User settings reactive access (`theme`, `density`, AI features) and `SettingsDialog` state.                       |
| [`useHelp`](#usehelp)                           | Reactive state and controls for opening/closing the `HelpDialog` shortcut sheet.                                  |
| [`useTooltip`](#usetooltip)                     | Singleton tooltip coordinator with warmup/cooldown grouping, auto-placement, shortcut parsing, and edge clamping. |
| [`useQueryCache`](#usequerycache)               | Shared cache of which server listings are loaded and how fresh they are (stale-while-revalidate).                 |
| [`useFolderLoader`](#usefolderloader)           | Loads top-level pages, subfolders and folder paths through the query cache; per-listing load state.               |
| [`useRootPager`](#userootpager)                 | Server-side pagination of the top-level list: page in the URL, size from settings, clamping, next-page prefetch.  |
| [`useFolderSearch`](#usefoldersearch)           | Server-side folder search for the prompt (`/folders/all/?q=`): debounced, cached, cancellable.                    |
| [`useFolderActions`](#usefolderactions)         | Creates and renames folders on the server, with pending rows, in-flight saves and the last error.                 |
| [`useDelayedFlag`](#usedelayedflag)             | Loading-indicator timing: shown after 200 ms, then kept at least 300 ms.                                          |
| [`useNetworkActivity`](#usenetworkactivity)     | App-wide "loading…"/"saving…" from the API client's count of requests in flight.                                  |

---

### `useKeyboardShortcuts`

Coordinates application-wide keyboard shortcuts at the `window` level.

- Handles global commands: `⌘,` (settings), `⌘K` / `g` (path prompt focus or open prompt), and `?` (help).
- Manages modal hierarchy: When any modal is active, `Escape` automatically dismisses the topmost modal without propagating events to the underlying view.
- Respects text input focus via `isTyping()` so keystrokes aren't hijacked while the user types in form controls.

### `usePrompt`

Powers both the pop-up quick-open prompt (`Prompt.vue`) and the inline terminal path prompt (`PathBar.vue`).

- Implements directory-relative and absolute path resolution (`/`, `../`, `cd`).
- Performs ranked fuzzy matching with hit-highlight indices against the folder hierarchy.
- Manages keyboard traversal (`Tab` completion, `↑`/`↓` / `^P`/`^N` navigation, `Enter` navigation).

### `useRowSelection`

Manages row selection and active cursor state for tabular listings (e.g. `FolderTable.vue`).

- Supports single-row selection, checkbox toggling, and select-all.
- Handles anchor-based contiguous range selections using `Shift+Click` and `Shift+Arrow` keys.
- Automatically computes aggregate statistics (e.g. total selected bytes).

### `useRemembered`

A lightweight, fault-tolerant reactive wrapper around the browser's `localStorage`.

- Gracefully handles restricted environments (private browsing, blocked storage) without crashing.
- Safely parses JSON with fallback to defaults if schemas change across releases.
- Deeply watches and syncs reactive state to persistent storage.

### `useRun`

Provides a reactive interface for running background forensic workers and workflows against selected files.

- Tracks target files and target folders for an execution run.
- Bridges state with the `useRunStore` and controls the visibility of `RunDialog.vue`.
- Supports run undo operations and tracks recent run execution notices.

### `useSettings`

Bridge composable for application configuration preferences.

- Exposes reactive settings (`theme`, `density`, `ai`) connected to `useSettingsStore`.
- Controls the visibility and opening/closing of `SettingsDialog.vue`.

### `useHelp`

Lightweight bridge composable controlling the visibility of the keyboard shortcuts help dialog (`HelpDialog.vue`).

### `useTooltip`

Central coordinator for application-wide floating tooltips and keyboard shortcut hints.

- Singleton reactive state: Drives a single top-layer `<Tooltip />` element in `App.vue`, avoiding DOM wrapper overhead across controls.
- Warmup and cooldown: Implements grouped tooltip ergonomics (250ms cold initial delay, 0ms instant delay when moving between adjacent controls within 500ms).
- Smart positioning & edge clamping: Automatically computes top/bottom/left/right placement relative to targets with viewport edge bounds clamping.
- Shortcut extraction: Parses shortcut strings formatted like `"Settings (⌘,)"` or `"Close (esc)"` into label text and miniature `<kbd>` keycap badges automatically.
- Dismissal: Handles blur, click, window scroll, and global `Escape` events to dismiss immediately according to WCAG 1.4.13 standards.

### `useQueryCache`

Module-scoped record of which server listings are loaded and when. The data itself lives in the normalized stores (`ITEMS`); fetchers write into them.

- `ensure(key, fetcher)`: fresh keys (30 s) cost no request, stale keys resolve at once and refresh in the background, and concurrent callers share one request. A request is aborted only when every caller waiting for it has left.
- Per-key state (`idle` → `loading` → `success` | `error`, plus `isFetching` and `error`). A key that has loaded stays `success` while refreshing or after a failed refresh.
- `markFresh` for data known without asking (a new folder is empty), `invalidate`, and `clearQueryCache` on sign-out.

### `useFolderLoader`

Loads what the explorer shows through the query cache. Skips `GET /folders/{id}` when the folder and its parents are already known from listings, so clicking into a folder costs one request, or none within 30 s. Exposes `listingState` and `folderState` for `LoadState` and the not-found view.

### `useFolderActions`

Creates and renames folders on the server. Creates show as placeholder rows until confirmed; renames apply at once, block a second rename while saving, and revert on failure. A new folder's subfolder listing is marked fresh, so opening it needs no request.

### `useDelayedFlag`

The timing for every loading indicator: on only after the work has taken 200 ms (fast responses never flash one), then visible for at least 300 ms (no blinking).

### `useNetworkActivity`

Subscribes to the API client's in-flight request count and exposes the status bar's `loading…` / `saving…` label. Background requests are not counted.

### `useRootPager`

Pagination of the top-level folder list, which the server pages (`GET /folders/all/`, newest created first, no other order).

- The page is in the URL (`/?page=3`, changed with `router.replace`), so reload and Back keep it; the size is `settings.explorer.pageSize` (25 / 40 / 100), and changing it keeps the first visible folder in view.
- Each page is its own query-cache entry (`folders:root:s{size}:p{page}`); its folder ids and the total live in `src/data/rootPages.ts`, the folders themselves in `ITEMS`.
- Past the last page it moves to the last one; once a page has loaded, the next is prefetched in the background (not offline or on constrained connections).
- New top-level folders are written into page 1 and deleted ones leave every page; other pages refetch when visited.

### `useFolderSearch`

Server-side search behind the prompt, for folders nobody has loaded yet (`GET /folders/all/?q=`, recursive over every folder the operator can reach, matching names).

- Runs only for a search from the top (at the root or `/…`) and for a name, not a path; asks after typing pauses (250 ms) and from 2 characters; a newer term cancels the older request; results are cached like any other query.
- Results are kept apart from `ITEMS`: the server does not say where a found folder lives. The prompt lists loaded matches first, then server matches marked `server`; opening one loads its real path.
