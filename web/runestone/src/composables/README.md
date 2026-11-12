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
| [`useSettings`](#usesettings)                   | User settings reactive access (`appearance.theme`, `ai`, `explorer`) and `SettingsDialog` state.                  |
| [`useHelp`](#usehelp)                           | Reactive state and controls (`UseHelpReturn`) for opening/closing the `HelpDialog` shortcut sheet.                |
| [`useTooltip`](#usetooltip)                     | Singleton tooltip coordinator with warmup/cooldown grouping, auto-placement, shortcut parsing, and edge clamping. |
| [`useQueryCache`](#usequerycache)               | Shared cache of which server listings are loaded and how fresh they are (stale-while-revalidate).                 |
| [`useAutoRefresh`](#useautorefresh)             | Coalesced focus, visibility, and online refresh trigger for active views via the query cache.                     |
| [`useConnection`](#useconnection)               | App-wide network and server reachability status (`online`, `offline`, `unreachable`).                             |
| [`useFolderLoader`](#usefolderloader)           | Loads top-level pages, subfolders and folder paths through the query cache; per-listing load state.               |
| [`useRootPager`](#userootpager)                 | Server-side pagination of the top-level list: page in the URL, size from settings, clamping, next-page prefetch.  |
| [`useFolderSearch`](#usefoldersearch)           | Server-side folder search for the prompt (`/folders/all/?q=`): debounced, cached, cancellable.                    |
| [`useUploadQueue`](#useuploadqueue)             | Chunked uploads: 3 files at a time, sequential chunks, retries, cancel, in-session resume.                        |
| [`useDropZone`](#usedropzone)                   | Files and folders dropped on an element, without the usual drag-and-drop traps.                                   |
| [`useUploadPanel`](#useuploadpanel)             | Auto-opens and closes the uploads modal as active queue items start and finish.                                   |
| [`useFolderPrefetch`](#usefolderprefetch)       | Debounced background prefetching for hovered/focused folder rows.                                                 |
| [`useFolderPermissions`](#usefolderpermissions) | Cached per-folder operator roles (`FolderRole`) and item deletion checks.                                         |
| [`useItemActions`](#useitemactions)             | Shared action list for the selection toolbar and row context menu.                                                |
| [`useCaseRef`](#usecaseref)                     | Case reference lookup (`/case/:ref`), save/clear mutations, and 409 conflict handling.                            |
| [`useConfirm`](#useconfirm)                     | App-wide confirmation and single-line text prompt modal coordinator.                                              |
| [`useDownload`](#usedownload)                   | Direct browser file downloads, staggered multi-file batches, and sign-out cleanup.                                |
| [`useFolderActions`](#usefolderactions)         | Creates and renames folders on the server, with pending rows, in-flight saves and the last error.                 |
| [`useDelayedFlag`](#usedelayedflag)             | Loading-indicator timing: shown after 200 ms, then kept at least 300 ms.                                          |
| [`useNetworkActivity`](#usenetworkactivity)     | App-wide "loading…"/"saving…" from the API client's count of requests in flight.                                  |
| [`useGroupStacks`](#usegroupstacks)             | Session memory of collapsed/expanded workflow graph task stacks and input file cards.                             |
| [`usePanelWidth`](#usepanelwidth)               | Draggable, viewport-clamped, remembered width for resizable side panels.                                          |
| [`useTaskReport`](#usetaskreport)               | Singleton modal state for viewing a task's inspection reports.                                                    |
| [`useWorkflowDialog`](#useworkflowdialog)       | Modal state and open/close bridge for creating a new workflow on selected files.                                  |
| [`useWorkflowTemplates`](#useworkflowtemplates) | Query-cached saved workflow templates with inline rename, delete, and creation updates.                           |
| [`useFileDetails`](#usefiledetails)             | Loads full file metadata (hashes, libmagic, MIME) and polls briefly while background hashing finishes.            |
| [`useRangeText`](#userangetext)                 | Sequential 1 MiB byte-range text decoder (`UTF-16` / `UTF-8` / `Windows-1252`) with pause/resume.                 |
| [`useTextStream`](#usetextstream)               | Streaming line indexer over `useRangeText` with shared open views and LRU cache for recently visited files.       |
| [`useTableStream`](#usetablestream)             | Streaming CSV, TSV, and JSONL row parser over `useRangeText` with incremental type inference.                     |
| [`useTextSearch`](#usetextsearch)               | Incremental, sliced plain-text/regex finder over streamed lines (`MAX_HITS` capped).                              |
| [`useByteChunks`](#usebytechunks)               | Bounded 64 KiB byte-range LRU chunk cache with directional lookahead and abort for hex viewing.                   |
| [`useRowScroller`](#userowscroller)             | Row-indexed virtual scrollbar state and wheel/thumb/track gesture handling for large files.                       |
| [`useMarkedRange`](#usemarkedrange)             | Gutter click/Shift-click/drag line, row, or byte mark selection and URL hash link copying.                        |
| [`useLinkMenu`](#uselinkmenu)                   | Singleton menu state for untrusted links and images inside rendered Markdown.                                     |
| [`useApiKeys`](#useapikeys)                     | Query-cached personal API key list and one-shot creation/revocation for `AccountDialog`.                          |
| [`useShareDialog`](#usesharedialog)             | Query-cached folder collaborator ACLs, group/user search, and diffed role updates for `ShareDialog`.              |

---

### `useKeyboardShortcuts`

Coordinates application-wide keyboard shortcuts at the `window` level.

- Handles global commands: `⌘,` (settings), `⌘K` / `g` (path prompt focus or open prompt), and `?` (help).
- Manages modal hierarchy: When any modal is active, `Escape` automatically dismisses the topmost modal without propagating events to the underlying view.
- Respects text input focus via `isTyping()` so keystrokes aren't hijacked while the user types in form controls.

### `usePrompt`

Powers both the pop-up quick-open prompt (`Prompt.vue`) and the inline terminal path prompt (`PathBar.vue`), returning a typed `UsePromptReturn` handle whose entries are `PromptResult` discriminated-union members (`up`, `here`, `home`, `prev`, `mkdir`, `rm`, `item`) guarded by helpers such as `isRm`.

- Implements directory-relative and absolute path resolution (`/`, `../`, `cd`), `mkdir`, and `rm` (`confirmAction` deletion in the current folder).
- Performs ranked fuzzy matching with hit-highlight indices against the folder hierarchy.
- Manages keyboard traversal (`Tab` completion, `↑`/`↓` / `^P`/`^N` navigation, `Enter` navigation).

### `useRowSelection`

Manages row selection and active cursor state for tabular listings (e.g. `FolderTable.vue`), typed via `UseRowSelectionReturn`.

- Supports single-row selection, checkbox toggling, and select-all.
- Handles anchor-based contiguous range selections using `Shift+Click` and `Shift+Arrow` keys, keeping `anchorKey` by row key so background refreshes inserting or removing other rows do not break an active range.
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
- What runs on the inputs, and on each task's output, is a list of groups (`TaskGroup`). `addTask(folderId, at, …)` places a worker with an `AddAt`: `{ after }` starts a new group on a task's output (or the inputs'), `{ beside }` adds it to a task's group, `{ joinAll }` merges the groups on a task's output (or the inputs') into one and makes it their join (`canJoinAll`), `{ join }` makes it the group's join — a worker that runs once all of the group's tasks have finished, on all their outputs, saved as a Celery chord (`{type: 'chord', tasks, callback}`). Groups without a join are saved as their tasks with a `group` marker, so the grouping survives a reload. As in the original editor, a join is only offered after a free group — two or more with nothing chained after them (`canJoin`) — and once a group has one, nothing more can be chained after its tasks (`canChainAfter`). A join left with nothing to wait for becomes a plain task; a group left empty goes.
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

- Exposes reactive settings (`appearance.theme`, `ai`, `explorer`) connected to `useSettingsStore`.
- Controls the visibility and opening/closing of `SettingsDialog.vue` (`settingsOpen`, `openSettings`, `closeSettings`).

### `useHelp`

Lightweight bridge composable controlling the visibility of the keyboard shortcuts help dialog (`HelpDialog.vue`), typed via `UseHelpReturn`.

### `useTooltip`

Central coordinator for application-wide floating tooltips.

- Singleton reactive state: Drives a single top-layer `<Tooltip />` element in `App.vue`, avoiding DOM wrapper overhead across controls.
- Warmup and cooldown: Implements grouped tooltip ergonomics (250ms cold initial delay, 0ms instant delay when moving between adjacent controls within 500ms).
- Smart positioning & edge clamping: Automatically computes top/bottom/left/right placement relative to targets with viewport edge bounds clamping.
- Dismissal: Handles blur, click, window scroll, and global `Escape` events to dismiss immediately according to WCAG 1.4.13 standards.

### `useQueryCache`

Module-scoped record of which server listings are loaded and when. The data itself lives in the normalized Pinia stores (`stores/items.ts`, `stores/rootPages.ts`, `stores/workflows.ts`); fetchers write into them.

- `ensure(key, fetcher)`: fresh keys (30 s) cost no request, stale keys resolve at once and refresh in the background, and concurrent callers share one request. A request is aborted only when every caller waiting for it has left. A request that was aborted, or started before its key was invalidated, is never joined: the next `ensure()` starts a new one (otherwise a caller that leaves and comes straight back, or a refresh asked for just after an invalidate, would get an outdated answer or none).
- Per-key state (`idle` → `loading` → `success` | `error`, plus `isFetching` and `error`). A key that has loaded stays `success` while refreshing or after a failed refresh.
- `markFresh` for data known without asking (a new folder is empty; aborts any in-flight fetch so stale responses cannot overwrite it), `invalidate`, and `clearQueryCache` on sign-out.

### `useAutoRefresh`

Registers a view's refresh callback (`(options: { force: boolean }) => void`) for as long as its scope lives, coalescing window `focus`, `online`, and `visibilitychange` (`visible`) events within 1 s. Also exports `refreshAll(options)` so callers can force-refresh everything on screen (e.g. a connection Retry action).

### `useConnection`

Tracks app-wide connectivity (`online`, `offline`, `unreachable`) by combining `navigator.onLine` / browser `online`–`offline` events with the API client's `onReachability` signal so broken proxies or timeouts surface even when `navigator.onLine` stays `true`. Also exports `connectionIsConstrained()` to detect `saveData` or `2g`/`slow-2g` links.

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

A dropped folder is recreated on the server by `useUploadQueue.enqueueDrop()` and its files are uploaded into it — at the top level too, where only loose files have nowhere to go. Everything in the folder comes along, hidden files included. Above `LARGE_DROP` (200 files), `enqueue()` and `enqueueDrop()` ask for confirmation before starting rather than truncating the drop.

### `useUploadPanel`

Auto-opens the `'uploads'` modal when uploads start (`activeCount > 0`) unless minimized for the current batch, and closes it when the queue empties unless opened manually.

### `useFolderPrefetch`

Schedules background subfolder/file prefetching after the cursor or hover rests on a row for 150 ms (`MAX_CONCURRENT = 2`, only the latest candidate queues), skipping offline, unreachable, or constrained links and cancelling queued work on navigation.

### `useFolderPermissions`

Loads and caches the operator's `FolderRole` (`Owner`, `Editor`, `Viewer`, `No Access`) per folder (`ROLE_STALE_MS = 5 min`), exposes reactive target permissions for the selection bar, and checks `canDeleteItem` against parent folder ownership or the uploader's username (`ownerUsername`).

### `useItemActions`

Builds the context-sensitive action list shared by the selection toolbar and row context menu (`open`, `workflow`, `run`, `download`, `share`, `rename`, `case`, `copy-id`, `delete`), gated by selection shape, current folder, role, and admin status.

### `useCaseRef`

Resolves top-level case folder references (`/case/:ref`) via `useQueryCache`, saves or clears a folder's `case_ref`, tracks 409 ownership conflicts (`takenBy`), and forgets stale lookups on change or deletion (`forgetCases`, `clearCaseLookups`).

### `useConfirm`

Coordinates `<ConfirmDialog />` across the app for destructive confirmations (`confirmAction`) and single-line text prompts (`askForText`), resolving safely on confirm, cancel, Escape, or `clearConfirm()`.

### `useDownload`

Streams downloads directly to disk using hidden `_blank` anchor clicks (`downloadFile`), staggers multi-file batches by 300 ms (`downloadFiles`), and clears pending batch timers on sign-out (`clearDownloads`).

### `useGroupStacks`

Module-scoped session state (`UseGroupStacksReturn`) remembering which `TaskGroup` cards (`STACK_MIN = 3`) and multi-file input cards in `WorkflowGraph.vue` are stacked or open across views and folders.

### `usePanelWidth`

Manages draggable, remembered (`useRemembered`) side-panel widths (`PanelWidth`: `width`, `start`, `move`, `end`, `step`, `reset`) clamped between a minimum width and `viewportWidth * maxShare`.

### `useTaskReport`

Module-scoped modal coordinator (`openTaskReport`, `clearTaskReport`, `useTaskReport`) for viewing a task's findings in `TaskReportDialog.vue`, aligned with the modal stack so `Escape` and sign-out clear it cleanly.

### `useWorkflowDialog`

Module-scoped modal state and helpers (`useWorkflowDialog`, `openWorkflowDialog`) for launching `WorkflowDialog.vue` on selected files, gated on the `'workflow'` modal stack entry.

### `useWorkflowTemplates`

Loads saved workflow templates through `useQueryCache`, parses each spec via `workflowSpec.ts` into summary worker counts, and applies inline optimistic/confirmed updates for template save, rename, and delete.

### `useFileDetails`

Loads full file metadata (MD5/SHA-1/SHA-256 hashes, libmagic text, `dataType`, `mime`) through `useQueryCache`, merges it into `useItemsStore`, and briefly polls every 3 s while background hashing completes after upload.

### `useRangeText`

Creates a sequential 1 MiB byte-range text reader (`createRangeText`) for `FIRST_BYTES` (5 MB) / `MORE_BYTES` (10 MB) streaming, sniffing `UTF-16` BOM, `UTF-8`, or `Windows-1252` on the first chunk and supporting pause/resume/cancel.

### `useTextStream`

Indexes streamed lines (`utils/lines.ts`) over `useRangeText` for text and Markdown viewers, sharing open streams across views (e.g. rendered Markdown and source) and keeping up to `KEEP_FILES` (3) files under `KEEP_MAX` (64 MiB) in an LRU cache cleared on sign-out (`forgetTextFiles`).

### `useTableStream`

Parses CSV, TSV, and JSONL files incrementally as decoded text arrives (`useRangeText` + `utils/table.ts`), sniffing delimiters and inferring column types from the first `TYPE_SAMPLE` rows.

### `useTextSearch`

Searches loaded lines incrementally in `SLICE_LINES` (20,000-line) yields (`utils/textSearch.ts`), capping kept matches at `MAX_HITS` (10,000), continuing across newly arrived lines, and jumping to hits from the visible cursor position.

### `useByteChunks`

Maintains a bounded `MAX_CHUNKS` (32 × 64 KiB = 2 MiB) LRU cache backed by `useQueryCache` (`api.files.readRange`), pre-fetching one chunk in the scroll direction and aborting off-screen requests.

### `useRowScroller`

Drives virtual row-number scrolling (`UseRowScrollerReturn`) for hex and text viewers using `ResizeObserver`, sub-row trackpad wheel accumulation, and custom thumb/track pointer dragging.

### `useMarkedRange`

Handles gutter line/row/byte range marking (`UseMarkedRangeReturn`) via click, `Shift+Click`, and vertical pointer drag across viewers, scrolling to incoming URL hash marks and copying shareable URL hash links.

### `useLinkMenu`

Singleton coordinator (`openLinkMenu`, `closeLinkMenu`, `useLinkMenu`) for `LinkMenu.vue`, ensuring untrusted links and images inside rendered Markdown carry no `href` and only open or copy after explicit operator review.

### `useApiKeys`

Loads the user's API keys sorted by earliest expiry through `useQueryCache`, exposing one-shot token creation (`createApiKey`) and revocation (`deleteApiKey`) plus `AccountDialog` modal helpers.

### `useShareDialog`

Singleton coordinator (`openShareDialog`, `useShareDialog`) for `ShareDialog.vue` that loads folder ACLs and group directories via `useQueryCache`, searches directory users, and translates collaborator additions, removals, and role changes into folder share/unshare API calls.
