# Agent Guidelines: Feature Implementation & Architecture

This document instructs coding agents on how to design, implement, and maintain features in this codebase: a new web UI for [OpenRelik](https://openrelik.org), talking to the OpenRelik REST API. Follow these conventions to preserve system consistency, performance, and architectural simplicity.

Companion documents:
- [`docs/design-system.md`](docs/design-system.md): the visual and interaction rules (§1–§13).
- [`src/composables/README.md`](src/composables/README.md): what each major composable does. Add an entry when you add or substantially change a composable.
- [`docs/file-view-ideas.md`](docs/file-view-ideas.md): planned file-view features (strings, JSON tree, timeline, entropy, archives).

---

## 1. Core Principles

### Minimal Dependency Discipline
**Avoid adding new external dependencies.**
The runtime footprint is intentionally minimal: Vue, Vue Router, Pinia, Tailwind (with its Vite plugin) and Lucide icons. Everything else is written here. That includes the HTTP client (native `fetch`, `src/api/client.ts`), the Markdown renderer (`src/utils/markdown.ts`), the CSV/TSV/JSONL parser (`src/utils/table.ts`), the charts (`src/components/charts/LineChart.vue`, `src/utils/chart.ts`) and ID generation (`src/utils/id.ts`, which works without `crypto.randomUUID` on plain-HTTP servers).

Before reaching for `npm install`:
- Check if the requirement can be solved with modern browser APIs (Web Crypto, Clipboard API, `ResizeObserver`, `IntersectionObserver`, `URL`, `Intl`, `TextDecoder`).
- Check existing utilities (`src/utils/`), composables (`src/composables/`), or directives (`src/directives/`).
- If a utility is missing (e.g. string formatting, sorting, fuzzy filtering), implement a clean, typed 15–30 line pure helper in `src/utils/`.
- Do **not** install component libraries (Headless UI, Radix, PrimeVue, Vuetify), utility toolkits (Lodash, Ramda), positioning engines (Popper, Floating UI; use `src/utils/placement.ts`), Markdown/HTML renderers or sanitizers, chart libraries, or event buses (Mitt, EventEmitter). The application uses custom, high-performance, tailored primitives.

### Design System Compliance
Every new UI element must conform to [`docs/design-system.md`](docs/design-system.md):
- **Typography**: IBM Plex Sans for the interface, IBM Plex Mono (`font-mono`) for data: anything the operator copies, compares character by character or lines up (file contents, names, paths, hashes, IDs). Both self-hosted from `public/fonts/`; never load fonts from a third-party service. Use the 4-step type scale (`.card-title` 14px, body 13px, `.micro-label` 12px lowercase with `tracking-[0.06em]`, badge/keycap 11px).
- **Numbers & Dates**: Always apply `.tabular` (`tabular-nums`) to dynamic numbers, timestamps, and sizes to eliminate layout shift.
- **Buttons**: Exactly 5 variants (`primary` [max 1 per screen], `brand`, `secondary`, `danger` [never solid], `ghost`) and 2 heights (`default` 32px, `row` 24px).
- **Geometry**: Near-square corners (`4px` sheets/cards, `3px` controls, `2px` badges/checkboxes). No pill shapes.
- **Colors**: Use CSS tokens (`--color-surface`, `--color-sunken`, `--color-brand`, etc.) in Tailwind classes (`bg-surface`, `text-ink-muted`). Never invent custom hex codes.
- **Motion**: Every pane that opens and closes uses `SlidePane.vue` (§12 of the design system).
- **Shortcuts are not advertised**: keycaps (`KeyHint.vue`) appear in the Help dialog only (§11).

### Built for Slow Connections
**Design every feature for a slow, unreliable network from the start — not as a later optimisation.**
Operators use this console over VPNs, hotel Wi-Fi and congested links. The previous UI felt sluggish there because it refetched data on every navigation (e.g. the root folder list) and made the user wait for it. On a fast connection the app must feel instant; on a slow one it must stay responsive and honest about what it is waiting for.

Rules:
- **Never make the user wait for data they have already seen.** Render cached data at once and refresh behind it (stale-while-revalidate).
- **Never fetch what is still fresh.** Every server read goes through the query cache (`src/composables/useQueryCache.ts`, `ensure(key, fetcher)`): fresh keys (30 s by default; longer for slow-changing data such as workers and folder roles, 5 min) cost no request, concurrent callers share one request. Do not call the API directly from views or components for reads. **One exception:** entering a folder (or a top-level page) always refetches its listing behind the cached rows (`load(id, { revalidate: true })`), because files land in folders without the app knowing — task outputs, other users' uploads. Only the listing: the folder's own details and its parents keep the 30 s rule.
- **Every piece of data has its own load state** (`idle` / `loading` / `success` / `error`). "Empty" and "not loaded yet" must never be decided by a view-wide `isLoading` flag.
- **Write mutations into the cache instead of refetching.** Upsert the server's response into the store; `markFresh()` what is known without asking (a new folder is empty); `invalidate()` only when the server is the only source of truth.
- **Spend the network on what the user is doing now.** Run independent requests in parallel (no waterfalls), skip requests whose data is already known (e.g. no `GET /folders/{id}` when the path is loaded), pass an `AbortSignal` and cancel work the user has left behind, and mark prefetches `background: true` (see `useFolderPrefetch`, `useRootPager`). Skip prefetching when offline or on constrained connections.
- **Never read a whole file into the page.** Files can be multi-gigabyte disk images. Viewers read byte ranges (`api.files.readRange`, via `useByteChunks` / `useRangeText`) and draw only the rows on screen (`useRowScroller`); downloads go straight from the server's streaming endpoint to disk (`useDownload`).
- **Show waiting consistently.** Use `<LoadState>` for listings, row states for pending changes, and let the status bar's network indicator (`useNetworkActivity`, `useConnection`) show everything else. Indicators go through `useDelayedFlag` (show after 200 ms, keep ≥ 300 ms). The rules are in [`docs/design-system.md` §13](docs/design-system.md#13-loading-pending--network-states).
- **Fail gracefully.** Keep showing saved data when a refresh fails, offer Retry, and let failed data refresh on focus/reconnect (`useAutoRefresh`). Requests time out after 30 s without a response (`DEFAULT_TIMEOUT_MS` in `src/api/client.ts`).

Recipe for a new endpoint (e.g. files in a folder):
1. Add the typed call in `src/api/endpoints/`, accepting `{ signal, background }`, and register it in `src/api/index.ts`. Server response shapes go in `src/api/types.ts`.
2. Give the data a cache key (see `folderKeys` in `useFolderLoader.ts`) and a fetcher that writes into the normalized store.
3. Load it with `ensure()` from the view's loader; register the view's refresh with `useAutoRefresh`.
4. Render its state with `<LoadState>`; show pending mutations on their rows.
5. Verify request counts and behaviour on Chrome DevTools → Network → **Slow 4G** and **Offline**: revisiting a view within 30 s must cost zero requests, apart from the one listing refetch on entering a folder.

### Safe Rendering of Untrusted Content
File contents and worker reports are untrusted (this is a forensics tool: the files are evidence, and may be hostile).
- **No `v-html`, ever** (enforced by ESLint `vue/no-v-html`). Markdown is parsed into a typed tree (`src/utils/markdown.ts`) and rendered by components, so text reaches the page only as text. HTML files are shown as source, never rendered.
- **Links in rendered content carry no `href`.** They open the shared link menu (`useLinkMenu`, `LinkMenu.vue`), which shows where the link really goes (`src/utils/links.ts`) and lets the operator copy or open it. Images are only ever copied, never loaded.
- Unprintable bytes and control characters are shown escaped (`src/utils/bytes.ts`), never passed through.

---

## 2. Technology Stack

| Technology | Version | Purpose & Usage Conventions |
| :--- | :--- | :--- |
| **Vue** | `^3.5` | Composition API strictly. Always `<script setup lang="ts">`. Use `defineModel()`. |
| **TypeScript** | `~6.0` | Strict typing. Explicit types on props, emits, models, and composable returns. No `any`. |
| **Tailwind CSS** | `^4.3` | Utility-first styling via `@tailwindcss/vite` and design tokens in `src/assets/main.css`. |
| **Pinia** | `^4.0` | Global reactive state via setup stores (`defineStore('name', () => { ... })`). |
| **Vue Router** | `^5.2` | Application routing and path navigation (`src/router/index.ts`). |
| **Lucide Vue Next**| `^1.0` | Iconography, **imported only through `@/components/icons`** (see below). Standard size is `:size="13"` with `:stroke-width="1.5"` for dense UI; 11–12 for row-height controls. |
| **Vite** | `^8.1` | Build tooling and development server. |
| **Node** | `^22.18 \|\| >=24.12` | Tooling only. |

> IDs for tasks, groups and uploads come from `hexId()` in `src/utils/id.ts` (`crypto.getRandomValues`); do not add a UUID package.

### Development Setup
- `npm run dev` serves on `http://localhost:5173` and proxies `/api` and `/auth` to an OpenRelik server on `http://localhost:8710` (`vite.config.ts`).
- Environment overrides (`src/api/config.ts`): `VITE_OPENRELIK_SERVER_URL`, `VITE_OPENRELIK_API_VERSION` (default `v1`), `VITE_OPENRELIK_AUTH_METHODS` (comma-separated, default `local`), `VITE_USE_MOCK_API` (`true` enables a mock login in dev only).
- Import alias: `@/` → `src/`.

---

## 3. Architecture & Layer Interactions

The codebase follows a strict separation of concerns:

```
┌────────────────────────────────────────────────────────────────────────┐
│                               VIEWS                                    │
│                     (Page & layout orchestration)                      │
│   FolderView, FileView, MetricsView, LoginView, NotFoundView           │
└───────┬──────────────────────┬──────────────────────────┬──────────────┘
        │                      │                          │
        ▼                      ▼                          ▼
┌─────────────────┐    ┌─────────────────┐      ┌────────────────────────┐
│   COMPONENTS    │    │   COMPOSABLES   │      │        STORES          │
│ (Presentation & │    │  (Stateful UI & │      │ (Global App State &    │
│  user gestures) │◄───┤ business logic) │◄────►│  session lifecycle)    │
│  src/components │    │ src/composables │      │       src/stores       │
└───────┬─────────┘    └────────┬────────┘      └────────────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐
│   DIRECTIVES    │    │      UTILS      │    │          API            │
│  (Declarative   │    │  (Stateless     │    │ (HTTP client, typed     │
│   DOM hooks)    │    │  pure helpers)  │    │  endpoints, errors)     │
│ src/directives  │    │    src/utils    │    │        src/api          │
└─────────────────┘    └─────────────────┘    └─────────────────────────┘
```

Composables (and the auth store) call the API; views and components never do for reads.

### Routes (`src/router/index.ts`)
| Path | View | Notes |
| :--- | :--- | :--- |
| `/login` | `LoginView` | The only public route. |
| `/` | `FolderView` | Top-level folders, paged by the server (`?page=`). |
| `/folder/:id` | `FolderView` | A folder; owns a workflow panel when the folder is a workflow's. |
| `/folder/:folderId/file/:fileId` | `FileView` | Text, table, hex and Markdown viewers; marks in the URL hash (`#L12-L40`, see `utils/marks.ts`). |
| `/case/:ref(.*)` | → `/folder/:id` | Resolves a case reference (`useCaseRef`), else not found. |
| `/metrics` | `MetricsView` | |
| anything else | `NotFoundView` | |

Every route except `/login` requires a session; the guard hydrates it from the server and redirects to `/login?redirect=…`. A 401 the client cannot refresh calls `onUnauthorized` (wired in `src/main.ts`) and sends the operator to sign in.

### Layer Responsibilities

#### 1. Views (`src/views/`)
- Coordinate top-level layout panes: Top Bar $\rightarrow$ Workspace (List, plus a side pane where one earns its place) $\rightarrow$ Status Bar.
- Bind route params (`id`, query strings) to data sources and composables.
- Do not manipulate low-level DOM or implement raw algorithms directly in views; delegate to composables and child components.

#### 2. Components (`src/components/`)
- Categorized into focused subdirectories:
  - `base/`: Reusable primitives: `Button.vue`, `Switch.vue`, `LoadState.vue` (every listing's load state), `SlidePane.vue` (every pane that opens and closes), `PanelResizeHandle.vue` + `PanelToggle.vue` (resizable side panels, with `usePanelWidth`), `KeyValueRow.vue`, `Tooltip.vue`, `UserAvatar.vue`, `KeyHint.vue` (Help dialog only).
  - `layout/`: Shell structures: `PathBar.vue`, `StatusBar.vue`, `BrandLink.vue`, `SettingsTrigger.vue`, `UploadQueuePanel.vue`.
  - `dialogs/`: Modal sheets: `SettingsDialog`, `AccountDialog`, `HelpDialog`, `ShareDialog`, `RunDialog`, `WorkflowDialog`, `TaskReportDialog`, `ConfirmDialog`.
  - `icons/`: The icon barrel (`index.ts`). **Import icons from `@/components/icons`, never from `lucide-vue-next` directly**; add a re-export there when you need a new one.
  - Domain folders: `folders/` (explorer table, toolbar, pager, row menu, upload rows, case reference), `workflow/` (graph, tree, panel, task inspector), `viewers/` (text, table, hex, Markdown viewers and the file side panel), `markdown/` (rendered Markdown, link menu), `prompt/`, `charts/`, `metrics/`, `reports/`.
- Follow unidirectional data flow: **Props down, events up**. Use Vue 3.4 `defineModel()` for two-way bindings.
- Keep components small and focused. If a component exceeds ~300 lines, extract sub-components or stateful logic into composables. (Several already exceed this — `WorkflowGraph`, `FolderTable`, the viewers, `FolderView`; don't grow them further, extract when you touch them.)
- App-wide singletons are mounted once in `App.vue` (`Prompt`, the dialogs, `UploadQueuePanel`, `Tooltip`, `LinkMenu`). Add new app-wide overlays there, not inside views.

#### 3. Composables (`src/composables/`)
- Encapsulate reusable stateful logic, keyboard dispatchers, selection algorithms, data loaders, and store bridges.
- Follow the `use*` naming convention (`useRowSelection.ts`, `useKeyboardShortcuts.ts`, `useTooltip.ts`).
- Loaders over the query cache: `useFolderLoader`, `useRootPager`, `useFolderPrefetch`, `useFolderSearch`, `useFileDetails`, `useWorkflowLoader`, `useWorkers`, `useWorkflowTemplates`, `useApiKeys`, `useFolderPermissions`.
- Mutations: `useFolderActions`, `useItemActions` (the one list of row actions, shared by the selection bar and row menus), `useWorkflow`, `useCaseRef`, `useUploadQueue`.
- File reading: `useByteChunks`, `useRangeText`, `useTextStream`, `useTableStream`, `useTextSearch`, `useMarkedRange`, `useRowScroller`.
- Write a module-level header comment explaining what the composable is for and its non-obvious rules; the codebase relies on these.
- Clean up listeners, timers, and observers in `onUnmounted()` or return an explicit cleanup function.
- Always provide explicit TypeScript return types for exported composable functions.

#### 4. Stores (`src/stores/`)
- Use Pinia **setup store** syntax (`defineStore('name', () => { ... })`).
- Reserve stores strictly for state that outlives individual views:
  - Session and current user (`auth.ts`)
  - Active modal stack (`modals.ts`; add new modal names to `ModalType`)
  - User preferences and theme (`settings.ts`, persisted in `localStorage`)
  - The worker picker's target (`run.ts`)
  - Normalized server data, one copy per entity: folders and files (`items.ts`), the paginated top-level list (`rootPages.ts`), workflows (`workflows.ts`)
- Outside a component's setup (module-level functions in composables), call `useXStore()` inside the function, never at module top level: Pinia is not installed yet when modules load.
- Local UI state (cursor index, hover item, filter text, inline editing state) belongs in views or composables, **not** in global stores.

#### 5. Directives (`src/directives/`)
Registered globally by the plugin in `src/directives/index.ts`:
- `v-autofocus`: Focus an input when mounted.
- `v-trap-focus`: Keep Tab focus contained within an active modal sheet.
- `v-click-outside`: Dismiss popovers or inline editors when clicking outside.
- `v-scroll-into-view`: Keep keyboard-navigated cursor rows visible in scrollable lists (scrolls only its container, via `utils/scroll.ts`).
- `v-overflow-tooltip`: Show a tooltip only if the text content actually overflows its container (`scrollWidth > clientWidth`).
- `v-copy-to-clipboard` (alias `v-copy`): Copy text to clipboard with transient feedback states.
- `v-tooltip`: Bind hover tooltips to the global singleton tooltip coordinator.

#### 6. Utils (`src/utils/`)
- Pure, stateless helper functions: general (`format.ts`, `keyboard.ts`, `match.ts`, `scroll.ts`, `placement.ts`, `breakable.ts`, `id.ts`, `chart.ts`), file content (`bytes.ts`, `lines.ts`, `table.ts`, `textSearch.ts`, `markdown.ts`, `links.ts`, `marks.ts`, `preview.ts`), and domain helpers (`item.ts`, `upload.ts`, `caseRef.ts`, `report.ts`, `worker.ts`, `workflow.ts`, `workflowSpec.ts`).
- Zero reactive dependencies (`ref`, `reactive`), zero Pinia imports, and no DOM side-effects.
- Easily testable and deterministic.

#### 7. Types (`src/types/`)
- The app's own domain types (`Item` in `item.ts`; `Workflow`, `Task`, `TaskGroup`, `Report` in `workflow.ts`; `Worker` in `worker.ts`), as the UI uses them. Server response shapes stay in `src/api/types.ts`.
- Type declarations only: no values, no imports beyond other types. Import them with `import type`.

#### 8. API (`src/api/`)
- `client.ts`: the one HTTP client (native `fetch`): base URL, CSRF tokens, shared 401 refresh-and-retry, 30 s timeout, in-flight request counting (`onActivity`), reachability (`onReachability`), and chunked uploads with byte progress (`upload()`, the only XHR path).
- `endpoints/*.ts`: one typed module per server area (`auth`, `configs`, `directory`, `files`, `folders`, `metrics`, `taskqueue`, `users`, `workflows`), exposed as `api.<area>` from `src/api/index.ts`.
- `errors.ts`: every failed request rejects with an `ApiError` (`status` 0 means it never reached the server); show messages with `errorMessage(err, fallback)`.
- `session.ts`: guarded `sessionStorage` access. For browser storage use this or `useRemembered` (localStorage): both survive blocked storage (private windows), where a bare `localStorage` access throws.

### Disconnected Component Communication (No EventBus)

> [!IMPORTANT]
> **Do NOT install or implement an EventBus (`mitt`, EventEmitter, or global event hubs).**
> Event buses produce untyped, untraceable side-effects and memory leaks. Decoupled communication must use one of four patterns:

1. **Global App State & Modals**: Pinia setup stores (`src/stores/`).
   - *Rule*: Store holds state/actions; disconnected components bind via `computed()` / store methods. Every modal and sheet goes on the modal stack, which gives it `Escape` and keeps page shortcuts away while it is open.
   - *Example*: `useModalStore().openModal('settings')` opens `<SettingsDialog />` in `App.vue`.
2. **Subsystem Singletons**: Module-scoped reactive composables (`src/composables/`).
   - *Rule*: Module-level `ref()` / `reactive()` shared across imports without store overhead.
   - *Examples*: `useTooltip.ts` coordinates a single `<Tooltip />`; `openShareDialog(folder)`, `useWorkflowDialog().open(files, folderId)`, `useTaskReport`, `useLinkMenu`. For destructive actions use `await confirmAction({ … })` from `useConfirm.ts` — never the browser's `confirm()`/`alert()`.
3. **Imperative Remote Triggers**: Callback registration in stores.
   - *Rule*: Target registers execution callback on mount, unregisters on unmount; caller invokes store action.
   - *Example*: `PathBar.vue` registers `modalStore.registerPrompt(() => input.focus())`; `StatusBar.vue` / shortcuts trigger `modalStore.triggerPrompt()`.
4. **View-Level Sibling Orchestration**: Parent view conductor.
   - *Rule*: Siblings never communicate directly. The view binds them via composables (`useRowSelection`). Props down, events up.

---

## 4. Vue 3 Best Practices & Optimization Guidelines

### Performance
1. **Computed Caching**: Use `computed()` for derived state, filtering, and sorting. Avoid recalculating expensive arrays inside template expressions.
2. **Scroll & Keyboard Event Throttling**: Clean up global `window.addEventListener` listeners on `onUnmounted`. When listening to high-frequency events (`pointermove`), avoid triggering reactive updates unless thresholds are crossed.
3. **Fine-Grained Reactivity**: Use `ref` for primitive values and `shallowRef` for large collections or third-party objects that don't need deep property-level reactivity.
4. **Singleton DOM Elements**: Heavy floating elements (such as tooltips and the link menu) should use a single shared coordinator instance rather than spawning DOM nodes for every button or table cell.
5. **Draw Only What Is on Screen**: Long content (file lines, hex rows, table rows) is windowed by row number (`useRowScroller`), with fixed row heights; never render a whole file's rows.

### Readability & Simplicity
1. **Explicit Script Setup**:
   ```html
   <script setup lang="ts">
   // 1. Imports (external -> internal components -> composables/stores -> utils/types)
   import { computed, ref } from 'vue'
   import Button from '@/components/base/Button.vue'
   import { ChevronRight } from '@/components/icons'
   import { useSettings } from '@/composables/useSettings'
   import { formatSize } from '@/utils/format'
   import type { Item } from '@/types/item'

   // 2. Props & Emits / Models
   const props = defineProps<{ item: Item }>()
   const emit = defineEmits<{ select: [id: number] }>()
   const query = defineModel<string>('query', { default: '' })

   // 3. Reactive State & Composables
   const isExpanded = ref(false)

   // 4. Computed Properties
   const formattedSize = computed(() => formatSize(props.item.size))

   // 5. Methods & Lifecycle Hooks
   function handleClick() {
     emit('select', props.item.id)
   }
   </script>
   ```
2. **Early Returns**: Favor guard clauses over deeply nested `if/else` blocks.
3. **Template Declarativeness**: Leverage directives (`v-tooltip`, `v-autofocus`, `v-trap-focus`) instead of manual `$nextTick()` and `querySelector` DOM manipulation where possible.
4. **Comments Explain Why**: Doc comments state what a thing is for and the constraint behind a decision (e.g. why upload chunks go strictly one at a time), in plain sentences. Keep them accurate when you change the code.

---

## 5. Interaction Patterns Checklist for Features

When adding or modifying interactive features, ensure:

- [ ] **Keyboard First**: Is the feature accessible via keyboard? (Does it respect `isTyping()` so form inputs aren't hijacked?) Is it listed in `HelpDialog.vue`?
- [ ] **Escape Hierarchy**: Does `Escape` cancel the active operation (inline edit, filter, or modal) without collateral side-effects? Are new modals on the modal stack?
- [ ] **Symmetrical Ergonomics**: If a container opens on double-click, does an item activate on double-click? Does pressing `Enter` or `l` behave consistently?
- [ ] **Actions Live on Rows**: Row actions come from `useItemActions` so the row menu and selection bar never disagree, and hide what the operator's role forbids (`useFolderPermissions`).
- [ ] **No Layout Shift**: Do dynamic numbers or dates use `.tabular`? Are row heights locked?
- [ ] **Semantic Status**: Are status indicators using derived tints and borders instead of solid saturated backgrounds?
- [ ] **Button Constraints**: Are you using one of the 5 allowed variants and 2 allowed heights from `Button.vue`?
- [ ] **Tooltips & Accessibility**: Do icon buttons declare `aria-label` and `v-tooltip`? Icons from `@/components/icons`?
- [ ] **Untrusted Content**: No `v-html`; file and report content rendered as text; links through the link menu.
- [ ] **No EventBus**: Uses Pinia, module composables, or view orchestration for decoupled communication—no event emitters or mitt.
- [ ] **Slow Connections**: Do reads go through the query cache? Does revisiting a view within 30 s cost zero requests (apart from a folder's listing, refetched on entry)? Are independent requests parallel, and is abandoned work cancelled?
- [ ] **Consistent Loaders**: Do listings use `<LoadState>`, pending changes show on their rows, and indicators go through `useDelayedFlag` (§13 of the design system)? Tried on DevTools **Slow 4G** and **Offline**?

---

## 6. Testing & Verification

> [!NOTE]
> **Automated tests are currently skipped.**
> Automated test suites (e.g. Vitest / Cypress / Playwright) have not yet been implemented in this repository. Agents should **not** write or run test scripts until the testing framework is officially set up.
>
> **Verification Workflow for Agents**:
> 1. Run formatting: `npm run format` (`prettier --write --experimental-cli src/`).
> 2. Run linting: `npm run lint` (`eslint . --fix --cache`).
> 3. Run typechecking & build: `npm run build` (`vue-tsc --build` and `vite build`, in parallel).
> 4. Verify that all commands exit with code 0 before concluding your task.
> 5. For UI changes, check the change in the running app (`npm run dev`) where a server is available, including the slow-connection checks above.

### Commit Messages
Match the existing history: a short subject naming the area, a colon, then what changed in plain words — e.g. `Folder toolbar: the primary button keeps the right edge`, `SlidePane: one slide for every pane that opens and closes`. Prefix bug fixes with `Fix:`.
