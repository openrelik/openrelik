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
