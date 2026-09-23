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
| [`useRun`](#userun)                             | `RunDialog` bridge: quick-run a worker on files, or add one to a draft workflow.                                  |
| [`useWorkflow`](#useworkflow)                   | Creates workflows, edits drafts (saved behind the edit), runs them; per-workflow saving/running state.            |
| [`useWorkflowLoader`](#useworkflowloader)       | Loads the workflow of the folder on screen and polls it in the background while tasks run.                        |
| [`useWorkers`](#useworkers)                     | The workers online, from the server's task registry, cached for five minutes.                                     |
| [`useSettings`](#usesettings)                   | User settings reactive access (`theme`, `density`, AI features) and `SettingsDialog` state.                       |
| [`useHelp`](#usehelp)                           | Reactive state and controls for opening/closing the `HelpDialog` shortcut sheet.                                  |
| [`useTooltip`](#usetooltip)                     | Singleton tooltip coordinator with warmup/cooldown grouping, auto-placement, shortcut parsing, and edge clamping. |
| [`useQueryCache`](#usequerycache)               | Shared cache of which server listings are loaded and how fresh they are (stale-while-revalidate).                 |
| [`useFolderLoader`](#usefolderloader)           | Loads top-level pages, subfolders and folder paths through the query cache; per-listing load state.               |
| [`useRootPager`](#userootpager)                 | Server-side pagination of the top-level list: page in the URL, size from settings, clamping, next-page prefetch.  |
| [`useFolderSearch`](#usefoldersearch)           | Server-side folder search for the prompt (`/folders/all/?q=`): debounced, cached, cancellable.                    |
| [`useUploadQueue`](#useuploadqueue)             | Chunked uploads: 3 files at a time, sequential chunks, retries, cancel, in-session resume.                        |
| [`useDropZone`](#usedropzone)                   | Files and folders dropped on an element, without the usual drag-and-drop traps.                                   |
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

Opens `RunDialog.vue` for one of two things, through `useRunStore`:

- `openRun(files, folderId)`: run one worker on files — a workflow of its own, created, given the worker and run at once (the status bar says where it went).
- `openAddToWorkflow(workflow, at)`: add a worker to a draft workflow, at an `AddAt` (see `useWorkflow`); does nothing where no worker may go.

### `useWorkflow`

Workflows on the server (`/folders/{id}/workflows/`), kept in the workflows store (`stores/workflows.ts`) by the folder each owns. Module-scoped, so a save keeps going when the user moves on.

- `createWorkflow(parentId, fileIds)`: the server makes the workflow and a new folder for it; both are written into the stores and marked fresh, so opening the folder costs no request.
- What runs on the inputs, and on each task's output, is a list of groups (`TaskGroup`). `addTask(folderId, at, …)` places a worker with an `AddAt`: `{ after }` starts a new group on a task's output (or the inputs'), `{ beside }` adds it to a task's group, `{ join }` makes it the group's join — a worker that runs once all of the group's tasks have finished, on all their outputs, saved as a Celery chord (`{type: 'chord', tasks, callback}`). Groups without a join are saved as their tasks with a `group` marker, so the grouping survives a reload. As in the original editor, a join is only offered after a free group — two or more with nothing chained after them (`canJoin`) — and once a group has one, nothing more can be chained after its tasks (`canChainAfter`). A join left with nothing to wait for becomes a plain task; a group left empty goes.
- `addTask` / `removeTask` / `setTaskOption` change a draft locally at once; the spec is saved behind them (debounced, one PATCH in flight, later edits saved after it). A load never overwrites edits the server has not got.
- `runWorkflow(folderId)`: cancels a pending save, sends the spec with a fresh uuid per task, and adopts the spec the server answers with — its uuids are the ones its task records carry.
- `workflowActivity(id)`: `saving`, `saveError`, `running`, `error`, for the panel.
- The spec conversion is pure, in `utils/workflowSpec.ts`; `runBlocker()` refuses what the server would answer with a 500.

### `useWorkflowLoader`

Used by the folder view. Loads the folder's workflow as soon as the folder is known to own one (`Item.workflowId`, from any listing), alongside the listing. While tasks are queued or running it polls every 3 s in the background, skipping a tick while a poll is still in flight, and stops when they are done or the view leaves. New output files refresh the folder's file listing.

### `useWorkers`

The task registry (`GET /taskqueue/tasks/registered`) as `Worker`s, sorted by name. Fresh for five minutes; the picker shows its `<LoadState>`, and a draft's Run button checks its tasks against it.

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

Module-scoped record of which server listings are loaded and when. The data itself lives in the normalized Pinia stores (`stores/items.ts`, `stores/rootPages.ts`, `stores/workflows.ts`); fetchers write into them.

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
- Each page is its own query-cache entry (`folders:root:s{size}:p{page}`); its folder ids and the total live in the root pages store (`src/stores/rootPages.ts`), the folders themselves in the items store.
- Past the last page it moves to the last one; once a page has loaded, the next is prefetched in the background (not offline or on constrained connections).
- New top-level folders are written into page 1 and deleted ones leave every page; other pages refetch when visited.

### `useFolderSearch`

Server-side search behind the prompt, for folders nobody has loaded yet (`GET /folders/all/?q=`, recursive over every folder the operator can reach, matching names).

- Runs only for a search from the top (at the root or `/…`) and for a name, not a path; asks after typing pauses (250 ms) and from 2 characters; a newer term cancels the older request; results are cached like any other query.
- Results are kept apart from the items store: the server does not say where a found folder lives. The prompt lists loaded matches first, then server matches marked `server`; opening one loads its real path.

### `useUploadQueue`

Uploads files into a folder in chunks (`POST /files/upload`), module-scoped so an upload survives navigating away.

- Three files at a time, **chunks of one file strictly one after another**: the server records a chunk as soon as its first bytes land, so two chunks of the same upload in flight can make it assemble a half-written one. One file, 2 MB chunks, on constrained connections.
- Refuses empty files (the server can never complete one) and checks the role (`canUpload`, Owner or Editor) before sending anything.
- Retries a chunk the server could not store (503) with backoff, and waits for the connection when there is none; 429 means the server threw the upload away, so a retry starts over with a new id.
- Progress is byte-level (`upload()` in `src/api/client.ts`, the one XHR path) and only reaches 100 % when the server confirms the file.
- Resume is in-session only: there is no way to ask the server which chunks it holds.
- `enqueueDrop()` takes what a drop carries: it recreates dropped folder trees (outermost first, so each knows its parent) and queues every file into the folder it came from.

### `useDropZone`

Files and folders dropped on an element: counts `dragenter`/`dragleave` instead of toggling (they fire per child), ignores drags that carry no files, and reports the drop even where dropping is not allowed so the caller can explain why. It hands over the dropped **entries**, taken while the drag data still exists, so folders can be walked.

A dropped folder is recreated on the server by `useUploadQueue.enqueueDrop()` and its files are uploaded into it — at the top level too, where only loose files have nowhere to go. Everything in the folder comes along, hidden files included. A drop of more than 500 files is cut short, and says so.
