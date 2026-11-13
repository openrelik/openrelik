# Agent Guidelines: Feature Implementation & Architecture

This document instructs coding agents on how to design, implement, and maintain features in this codebase: a new web UI for [OpenRelik](https://openrelik.org), talking to the OpenRelik REST API. Follow these conventions to preserve system consistency, performance, safety, and architectural simplicity.

Companion documents:

- [`docs/design-system.md`](docs/design-system.md): visual and interaction rules (§1–§13).
- [`docs/style-guide.md`](docs/style-guide.md): full formatting, TypeScript, Vue, naming, and comment conventions. Note: §7's additional ESLint rules are a planned rollout, so enforce the guide's rules directly where `eslint.config.ts` does not check them yet.
- [`src/composables/README.md`](src/composables/README.md): inventory of all composables and their contracts. Add or update an entry whenever you add or substantially change a composable.

---

## 1. Core Principles & Implementation Direction

### Minimal Dependency Discipline

**Avoid adding new external dependencies.**
The runtime footprint is intentionally minimal: Vue, Vue Router, Pinia, Tailwind (with `@tailwindcss/vite`), and Lucide icons. Everything else is written in-house: the HTTP client (`src/api/client.ts`), Markdown parser (`src/utils/markdown.ts`), CSV/TSV/JSONL streaming parser (`src/utils/table.ts`), SVG charts (`src/components/charts/LineChart.vue`, `src/utils/chart.ts`), floating placement (`src/utils/placement.ts`), and ID generation (`hexId()` in `src/utils/id.ts`, using `crypto.getRandomValues` so it works on plain-HTTP servers).

Before reaching for `npm install`:

- Check modern browser APIs (`fetch`, Web Crypto `crypto.subtle`, Clipboard API, `ResizeObserver`, `IntersectionObserver`, `URL`, `Intl`, `TextDecoder`, CSS Custom Highlight API).
- Check existing utilities (`src/utils/`), composables (`src/composables/`), components (`src/components/base/`), and directives (`src/directives/`).
- Implement missing small helpers as pure, typed functions in `src/utils/`.
- Heavy format parsers (SQLite, EVTX, Registry hives, PE/ELF) do **not** belong in the browser: server workers convert artifacts to CSV/JSONL/Markdown/text, and the app renders those safely and incrementally.
- Tooling may add dev dependencies only when required, never runtime ones. Test dev dependencies are strictly **`vitest`**, **`@vitest/coverage-v8`**, **`@vue/test-utils`**, and **`happy-dom`**.
- Do **not** install component libraries, Lodash/Ramda, Popper/Floating UI, third-party Markdown/HTML sanitizers, chart libraries, or event buses (`mitt`, `EventEmitter`).

### Design System Compliance

The app is a high-density technical console instrument, not a consumer web app. Every UI element must conform to [`docs/design-system.md`](docs/design-system.md):

- **Typography**: `IBM Plex Sans` for UI and prose, `IBM Plex Mono` (`font-mono`) for data the operator copies, compares character by character, or lines up (file contents, names, paths, hashes, IDs, case references, offsets, detail values). Both are self-hosted from `public/fonts/`; never load external fonts. Use the 4-step type scale (`.card-title` 14px, body 13px, `.micro-label` 12px lowercase with `tracking-[0.06em]`, badge/keycap 11px).
- **Numbers & Dates**: Always apply `.tabular` (`tabular-nums`) to dynamic numbers, counters, timestamps, and sizes to eliminate layout shift.
- **Buttons**: Exactly 5 variants (`primary` [max 1 per view], `brand`, `secondary`, `danger` [never solid], `ghost`) and 2 heights (`default` 32px, `row` 24px) via `Button.vue`. Group buttons with space (`gap-1.5` / `w-1.5`), not vertical divider lines.
- **Geometry**: Near-square corners (`4px` sheets/cards, `3px` controls, `2px` badges/checkboxes). No pill shapes (`UserAvatar` 18px disc and the `Switch` internal knob are the only round elements).
- **Colors**: Use OKLCH-balanced CSS tokens (`--color-surface`, `--color-sunken`, `--color-brand`, etc.) from `src/assets/main.css` in Tailwind classes (`bg-surface`, `text-ink-muted`). Support both dark (default) and light (`:root[data-theme='light']`) themes. Never invent custom hex codes; use derived tints for status, never solid status banners.
- **Motion**: Every pane that opens and closes uses `<SlidePane>` (§12 of the design system). Transitions stay snappy (`120ms` / `200ms` with `ease-(--ease-standard)`).
- **Shortcuts are not advertised**: Keycaps (`KeyHint.vue`) appear in `HelpDialog.vue` only.

### Built for Slow Connections

**Design every feature for slow, high-latency, or lossy networks from the start.**

- **Never wait for data already seen**: Render cached data immediately and refresh behind it (stale-while-revalidate).
- **Never fetch what is still fresh**: Every server read goes through `useQueryCache` (`src/composables/useQueryCache.ts`, `ensure(key, fetcher)`): fresh keys (`DEFAULT_STALE_MS = 30_000`; `5 min` for slow-changing data like workers and folder roles) cost no request, and concurrent callers share one request. Never call `api.*` directly from views or components for reads. **One exception:** entering a folder (or top-level page) always refetches its listing behind cached rows (`load(id, { revalidate: true })`) because task outputs and collaborators' uploads land out of band; folder details and ancestors keep the 30 s rule.
- **Per-entity load states**: Every piece of data carries its own `QueryState` (`idle` / `loading` / `success` / `error` plus `isFetching`). Never decide "empty" vs "not loaded" from a view-wide `isLoading` flag.
- **Write mutations into the cache instead of refetching**: Upsert the server response into normalized stores (`items`, `rootPages`, `workflows`); call `markFresh()` for states known without asking (e.g., a newly created folder is empty); call `invalidate()` only when the server is sole truth.
- **Spend the network on active work**: Run independent requests in parallel (no waterfalls), skip requests whose data is already known (e.g., no `GET /folders/{id}` when the path is loaded), pass an `AbortSignal` and cancel abandoned work, and mark prefetches `background: true` (`useFolderPrefetch`, `useRootPager`). Skip prefetching when offline or on constrained links (`connectionIsConstrained()` in `src/composables/useConnection.ts`).
- **Never read a whole file into the page**: Files may be multi-gigabyte disk images. Viewers read byte ranges (`api.files.readRange` via `useByteChunks` 32 × 64 KiB LRU or `useRangeText` 1 MiB sequential chunks with `StreamStatusBar` asking before loading > 256 MiB into memory) and draw only visible rows (`useRowScroller`). Downloads stream straight to disk (`useDownload`). Uploads send one chunk at a time per file (`useUploadQueue`).
- **Show waiting consistently**: Use `<LoadState>` for listings, row states for pending mutations, and `StatusBar`'s network indicator (`useNetworkActivity`, `useConnection`) for background activity. All loading flags pass through `useDelayedFlag` (show after 200 ms, hold ≥ 300 ms).
- **Fail gracefully**: Keep showing saved data when a refresh fails, offer Retry, and auto-refresh stale/failed views on focus/visibility/reconnect (`useAutoRefresh`). Requests time out after `DEFAULT_TIMEOUT_MS` (30 s in `src/api/client.ts`).

Recipe for a new endpoint:

1. Add the typed call in `src/api/endpoints/`, accepting `CallOptions = Pick<RequestOptions, 'signal' | 'background'>`, and register it in `src/api/index.ts`. Server response shapes live in `src/api/types.ts`.
2. Give the data a cache key (see `folderKeys` in `useFolderLoader.ts`) and a fetcher that writes into a normalized Pinia store.
3. Load it with `ensure()` from a composable loader and wire view refresh with `useAutoRefresh`.
4. Render load/error/empty states with `<LoadState>` and pending edits on their rows.
5. Verify request counts and behaviour in Chrome DevTools → Network → **Slow 4G** and **Offline**: revisiting a view within 30 s must cost zero requests (apart from folder-entry listing revalidation).

### Safe Rendering of Untrusted Content (Forensics Safety)

File contents, filenames, URLs, and worker reports are hostile untrusted evidence:

- **Zero `v-html`** (enforced by ESLint `vue/no-v-html`). Markdown is parsed into a typed AST (`src/utils/markdown.ts`) and rendered as text nodes via `MarkdownView.vue` and `MarkdownInline.vue`.
- **HTML and SVG are shown as source**, never rendered or embedded as active markup.
- **Links carry no `href`; images carry no `src`**: Links and images in rendered Markdown open the singleton `LinkMenu.vue` (`useLinkMenu`, `src/utils/links.ts`), which exposes deceptive IDN/punycode hosts in ASCII (`xn--…`), blocks unsafe schemes (`javascript:`, `data:`, `vbscript:`, `file:`), escapes hidden/bidi/control characters (`‹U+…›`), and lets operators inspect/copy or explicitly open `http`/`https` URLs (`noopener`, `noreferrer`). Images are copy-only.
- **Escape control and undecodable bytes**: Control characters and unprintable bytes are escaped (`src/utils/bytes.ts`, `TextRow.vue`, `TableViewer.vue`, `TableDetail.vue`), and JSONL parsing guards prototype keys (`__proto__`).

### Session Isolation & Async Epoch Safety

- **Complete sign-out wipe**: On explicit sign-out or unrecoverable 401 (`onUnauthorized` in `src/main.ts`), `useAuthStore().setUser(null)` immediately clears **all** Pinia stores, module-scoped caches (`useQueryCache`, roles, cases, workers, templates, text streams, group stacks), pending workflow saves/timers, active uploads/downloads, and open modal/dialog singletons so a subsequent user never sees stale data or continues in-flight requests. Any new module-scoped state must register a reset hook and be cleared in `stores/auth.ts`.
- **Guard across `await`**: Async operations (loaders, inline edits, dialogs, debounced saves, polls) must verify the session, active route/entity ID, mount state, and request generation/epoch after `await` before mutating state.
- **Accepted bounded shortcuts**: When an intentional capacity or performance bound is accepted in code, document it inline with `shortcut: <limit>, <when to upgrade>` so future changes respect or consciously raise the bound.

---

## 2. Technology Stack & Tooling

| Technology          | Version               | Purpose & Usage Conventions                                                                                                           |
| :------------------ | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| **Vue**             | `^3.5`                | Composition API strictly (`<script setup lang="ts">`). Use `defineModel()`.                                                           |
| **TypeScript**      | `~6.0`                | `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` (`tsconfig.app.json`).                                                 |
| **Tailwind CSS**    | `^4.3`                | Utility-first styling via `@tailwindcss/vite` and design tokens in `src/assets/main.css`.                                             |
| **Pinia**           | `^4.0`                | Global reactive state via setup stores (`defineStore('name', () => { ... })`).                                                        |
| **Vue Router**      | `^5.2`                | Application routing and path navigation (`src/router/index.ts`).                                                                      |
| **Lucide Vue Next** | `^1.0`                | Iconography, **imported only through `@/components/icons`**. Standard `:size="13"` `:stroke-width="1.5"`; 11–12 for row controls.     |
| **Vite**            | `^8.1`                | Build tooling and dev server.                                                                                                         |
| **Vitest**          | `^5.1`                | Test runner (`environment: 'node'` by default) + `@vitest/coverage-v8` (`^5.1`). Dev dependency only.                                 |
| **Vue Test Utils**  | `^2.5`                | Component mounting (`@vue/test-utils`) + `happy-dom` (`^21.0`, opted in via `// @vitest-environment happy-dom`). Dev dependency only. |
| **Node**            | `^22.18 \|\| >=24.12` | Tooling only.                                                                                                                         |

### Development Setup

- `npm run dev` serves on `http://localhost:5173` and proxies `/api` and `/auth` to `http://localhost:8710` (`vite.config.ts`).
- Environment overrides (`src/api/config.ts`): `VITE_OPENRELIK_SERVER_URL`, `VITE_OPENRELIK_API_VERSION` (default `v1`), `VITE_USE_MOCK_API` (`true` enables dev-only offline login).
- Import alias: `@/` → `src/`.

---

## 3. Architecture & Layer Interactions

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

Composables (and `stores/auth.ts`) call the API; views and components never call `api.*` directly for reads.

### Routes (`src/router/index.ts`)

| Path                             | View            | Notes                                                                                               |
| :------------------------------- | :-------------- | :-------------------------------------------------------------------------------------------------- |
| `/login`                         | `LoginView`     | The only public route.                                                                              |
| `/`                              | `FolderView`    | Top-level folders, server-paged (`?page=`).                                                         |
| `/folder/:id`                    | `FolderView`    | Subfolder listing; owns a workflow panel when `workflowId` is set.                                  |
| `/folder/:folderId/file/:fileId` | `FileView`      | Text, table, hex, and Markdown viewers; marks in URL hash (`#L12-L40`, `#R12-R40`, `#0x1f3-0x2a0`). |
| `/case/:ref(.*)`                 | → `/folder/:id` | Resolves a case reference (`findCaseFolder` in `useCaseRef`), else `NotFoundView`.                  |
| `/metrics`                       | `MetricsView`   | Server metrics charts (`LineChart`, `MetricCard`).                                                  |
| anything else                    | `NotFoundView`  |                                                                                                     |

Every route except `/login` requires an authenticated session; the guard hydrates the user and redirects to `/login?redirect=…`. An unrecoverable 401 invokes `onUnauthorized` (`src/main.ts`), wipes session state, and redirects to `/login`.

### Layer Responsibilities

1. **Views (`src/views/`)**: Orchestrate top-level layout panes (Top Bar → Workspace → Status Bar) and bind route params/queries to composables and components. Delegate algorithms and DOM hooks to utils, composables, and directives.
2. **Components (`src/components/`)**:
   - `base/`: `Button`, `Switch`, `LoadState`, `SlidePane`, `PanelResizeHandle`, `PanelToggle`, `KeyValueRow`, `CopyValue`, `Tooltip`, `UserAvatar`, `KeyHint` (Help dialog only).
   - `layout/`: `PathBar`, `StatusBar`, `BrandLink`, `SettingsTrigger`, `UploadQueuePanel`.
   - `dialogs/`: `SettingsDialog`, `AccountDialog`, `HelpDialog`, `ShareDialog`, `RunDialog`, `WorkflowDialog`, `TaskReportDialog`, `ConfirmDialog`.
   - `icons/`: `index.ts` barrel. **Always import icons from `@/components/icons`**, never from `lucide-vue-next` directly.
   - Domain directories: `folders/` (`FolderTable`, `FolderToolbar`, `FolderPager`, `FolderStatusBar`, `ItemMenu`, `UploadRow`, `CaseRefPopover`), `workflow/` (`WorkflowGraph`, `WorkflowTree`, `WorkflowPanel`, `WorkflowSummary`, `TaskInspector`, `TaskStatusBadge`, `TaskStatusIcon`, `TaskRunningIcon`, plus pure `graphLayout.ts`), `viewers/` (`FileContent`, `FileDetails`, `FileSidePanel`, `TextViewer`, `TextRow`, `TextSearchBar`, `TableViewer`, `TableDetail`, `HexViewer`, `HexInspector`, `MarkdownViewer`, `StreamStatusBar`), `markdown/` (`MarkdownView`, `MarkdownInline`, `LinkMenu`), `prompt/` (`Prompt`, `PromptResults`), `charts/` (`LineChart`), `metrics/` (`MetricCard`), `reports/` (`PriorityBadge`).
   - **Data flow & splitting**: Props down, events up (`defineModel()` for two-way bindings). **Split by job — never by arbitrary line count**: extract pure layout/parsing/math into `src/utils/` (or a sibling pure module like `graphLayout.ts`), shared UI sections into focused components (like `StreamStatusBar.vue`), and reusable stateful logic into composables.
   - App-wide singletons are mounted once in `App.vue` (`Prompt`, dialogs, `UploadQueuePanel`, `Tooltip`, `LinkMenu`).
3. **Composables (`src/composables/`)**:
   - Listed and documented in [`src/composables/README.md`](src/composables/README.md). Every composable has a module-level header comment explaining its purpose and invariants, explicit TypeScript return types/interfaces, and proper cleanup (`onUnmounted`/`onScopeDispose` or returned cleanup).
   - Module-scoped singletons must document that they share state and expose a reset function wired into `stores/auth.ts` (`setUser(null)`).
4. **Stores (`src/stores/`)**:
   - Setup stores only (`defineStore('name', () => { ... })`), reserved for cross-view state: `auth.ts`, `modals.ts` (`ModalType`), `settings.ts`, `run.ts`, and normalized entity caches `items.ts`, `rootPages.ts`, `workflows.ts`.
   - Call `useXStore()` inside functions, never at module top level (Pinia is not installed at import time). Local UI state stays in views or composables.
5. **Directives (`src/directives/`)**:
   - Registered globally via `src/directives/index.ts`: `v-autofocus`, `v-trap-focus`, `v-click-outside`, `v-scroll-into-view`, `v-overflow-tooltip`, `v-copy-to-clipboard` (alias `v-copy`), `v-tooltip`.
6. **Utils (`src/utils/`)**:
   - Pure, stateless helpers (`breakable`, `bytes`, `caseRef`, `chart`, `format`, `id`, `item`, `keyboard`, `lines`, `links`, `markdown`, `marks`, `match`, `placement`, `preview`, `report`, `scroll`, `table`, `textSearch`, `upload`, `worker`, `workflow`, `workflowSpec`). Zero Vue reactivity (`ref`/`reactive`), zero Pinia imports, zero DOM side-effects.
7. **Types (`src/types/`)**:
   - App domain types (`item.ts`, `worker.ts`, `workflow.ts`). Server DTO shapes stay in `src/api/types.ts`. Type declarations only (no runtime values); import with `import type`.
8. **API (`src/api/`)**:
   - `client.ts` (native `fetch`, CSRF, 401 refresh-and-retry, 30 s timeout, `onActivity`, `onReachability`, XHR `upload()`), `endpoints/*.ts` (`auth`, `directory`, `files`, `folders`, `metrics`, `taskqueue`, `users`, `workflows`), `errors.ts` (`ApiError`, `errorMessage`), `session.ts` (guarded `sessionStorage`; use this or `useRemembered` for `localStorage` so blocked storage never throws).

### Disconnected Component Communication (No EventBus)

> [!IMPORTANT]
> **Do NOT install or implement an EventBus (`mitt`, EventEmitter, or global event hubs).**
> Decoupled communication must use one of four patterns:

1. **Global App State & Modals**: Pinia setup stores (`src/stores/`). Every modal/sheet pushes onto `useModalStore()` so `Escape` and keyboard gating work uniformly.
2. **Subsystem Singletons**: Module-scoped reactive composables (`useTooltip`, `useShareDialog`, `useWorkflowDialog`, `useTaskReport`, `useLinkMenu`, `useConfirm` via `confirmAction` / `askForText` — never browser `confirm()`/`alert()`).
3. **Imperative Remote Triggers**: Callback registration in stores (`PathBar.vue` registers focus with `modalStore.registerPrompt()`).
4. **View-Level Sibling Orchestration**: Parent view binds siblings via composables (`useRowSelection`); props down, events up.

---

## 4. Style, TypeScript & Vue Conventions

Prettier formats code; ESLint checks what `eslint.config.ts` covers; [`docs/style-guide.md`](docs/style-guide.md) defines the full code style:

### Formatting & Modules

- **Prettier**: `semi: false`, `singleQuote: true`, `printWidth: 100`, 2-space indent, trailing commas `all` (`.prettierrc.json`). Run `npm run format`; never format by hand.
- **Named exports only** (except framework defaults: `router`, `directives`, `api`). No new barrel files beyond `@/api` and `@/components/icons`.
- **Import paths**: `@/` for anything outside the current directory, `./` for a sibling in the same directory, **never `../`**.
- **Import syntax & order**: One import statement per module; mark type-only imports (`import type { … }` or inline `type`). Group in order:
  1. External packages (`vue`, `vue-router`, `pinia`)
  2. Components (`@/components/…`), then icons (`@/components/icons`)
  3. Composables and stores
  4. API, utils, then `import type`

### TypeScript Discipline

- **`interface` for object shapes; `type` for everything else** (unions, function types, aliases). **No `enum` or `namespace`** (use string literal unions or `as const` arrays/objects). **No `any`** (use `unknown` and narrow).
- **Discriminated unions over flag bags**: Give multi-variant types a `kind` field (like `PromptResult` in `usePrompt.ts`) rather than multiple optional booleans.
- **`null` vs `undefined`**: `undefined` means absent (optional property, lookup miss); `null` means deliberately empty (`error: string | null`, server `null`). Always use `===` / `!==`; use `??` for defaults so `0` and `''` survive.
- **Narrow, don't assert**: Prefer `if (!x)`, `typeof`, `in`, `instanceof`, and union discriminants. Use `as` only at trust boundaries (e.g., `event.target as HTMLInputElement`) — never `as unknown as T`. Use `!` only right after the check that guarantees it (`map.has(k)` → `map.get(k)!`, bounded loop `arr[i]!`). Prefer `satisfies` over `as` for typed literals. Never use `@ts-ignore` or `@ts-nocheck` (`@ts-expect-error` only with an explanation).
- **Functions & errors**: Prefer named `function` declarations (arrow constants only for one-expression helpers and callbacks). Limit positional parameters to 3 (use an options object beyond 3 or for booleans/optional settings). Favor early returns. Declare explicit return types on exported functions and explicit return interfaces on composables. Use `async`/`await`, `catch (err: unknown)` (or `catch {`), never swallow errors silently, show users `errorMessage(err, fallback)`, use `console.warn`/`console.error` only for hidden failures or broken invariants, and commit no `console.log`.

### Vue SFC Structure & Performance

- Always `<script setup lang="ts">`. Block order: `<script setup>` → `<template>` → `<style>` (rare; use Tailwind tokens).
  ```html
  <script setup lang="ts">
    // 1. Imports (external -> components & icons -> composables/stores -> api/utils/types)
    import { computed, ref } from 'vue'
    import Button from '@/components/base/Button.vue'
    import { ChevronRight } from '@/components/icons'
    import { useSettings } from '@/composables/useSettings'
    import { formatSize } from '@/utils/format'
    import type { Item } from '@/types/item'

    // 2. Props, Emits & Models (`withDefaults`, named-tuple `defineEmits`, `defineModel`)
    const props = withDefaults(defineProps<{ item: Item; disabled?: boolean }>(), {
      disabled: false,
    })
    const emit = defineEmits<{ select: [id: number] }>()
    const query = defineModel<string>('query', { default: '' })

    // 3. Reactive State & Composables
    const settings = useSettings()
    const isExpanded = ref(false)

    // 4. Computed Properties
    const formattedSize = computed(() => formatSize(props.item.size))

    // 5. Functions & Lifecycle Hooks
    function handleClick() {
      emit('select', props.item.id)
    }
  </script>
  ```
- **Templates**: Keep expressions to a single property access, comparison, or call (no multi-step logic or nested ternaries). Always set a stable `:key` on `v-for`. Never put `v-if` and `v-for` on the same element. Use PascalCase tags (`<LoadState />`). Hand-order Tailwind classes roughly: layout → box → typography → colour → state. Inline `style` is only for computed geometry (positions, resized widths).
- **Reactivity & Performance**: Use `ref` for values, `shallowRef` for large replaced collections, `reactive` for module state/maps (never destructure `reactive`). Derive with `computed`; use `watch` with explicit sources for side effects (prefer over `watchEffect`); `nextTick` only as a last resort with a comment. Clean up window listeners, timers, and observers on unmount. Use singleton floating UI (`Tooltip`, `LinkMenu`), `useRowScroller` for fixed-height windowed rows, and `useDelayedFlag` for loading indicators.

### Naming & Comments

- `camelCase` variables/functions/utility files, `PascalCase` types/interfaces/components (`useThing.ts`, `FolderTable.vue`), `SCREAMING_SNAKE` true constants. Acronyms are words (`Id`, `Url`, `Api`, `Csv`, never `ID`/`URL`). Include units on numbers (`SAVE_DELAY_MS`, `sizeBytes`). Booleans use `is`/`has`/`can`/`should` or a past participle.
- **Comments explain _why_** and non-obvious constraints (`/** … */` on exports and module headers; concise `//` inline comments where a reader would pause). No commented-out code. Keep doc comments accurate when modifying code.

---

## 5. Interaction Patterns Checklist

When adding or modifying interactive features, verify:

- [ ] **Keyboard First**: Accessible via keyboard? Respects `isTyping()` (`<input>`, `<textarea>`, `<select>`, `contenteditable`, and `PathBar` `data-prompt` except empty-line passthrough keys)? Listed in `HelpDialog.vue`? Keycaps shown only in `HelpDialog.vue`?
- [ ] **Escape Hierarchy**: `Escape` cancels the active operation (selection, inline edit, filter, menu, or topmost `useModalStore()` modal) without collateral side effects?
- [ ] **Symmetrical Ergonomics**: Single-click sets cursor; name click / double-click / `Enter` / `l` / `→` opens; `F2` or row menu renames (no press-and-hold).
- [ ] **Actions Live on Rows & Toolbar Edge**: Row actions come from `useItemActions` (shared by `ItemMenu` and selection bar) and respect `useFolderPermissions`. Primary view action keeps the right edge (`FolderToolbar`).
- [ ] **Viewer Mark Parity**: Marks in text (`#L…`), table (`#R…`), and hex (`#0x…`) follow `useMarkedRange` / `utils/marks.ts` (`bg-warning-tint` + 2px `warning` gutter bar, copy link, `Esc` clears selection then mark).
- [ ] **No Layout Shift**: Dynamic numbers and dates use `.tabular`; row heights are locked; panes open/close via `<SlidePane>`.
- [ ] **Semantic Status & Buttons**: Status uses `.badge` tints + borders; `Button.vue` uses only the 5 variants (max 1 `primary` per view, `danger` never solid) and 2 heights (`default`, `row`); toolbar groups separated by space, not divider lines.
- [ ] **Tooltips & Accessibility**: Icon-only buttons have `aria-label` and `v-tooltip` (only where it adds info not on screen); clipped text uses `v-overflow-tooltip`; icons come from `@/components/icons`.
- [ ] **Untrusted Content**: Zero `v-html`; file/report text rendered safely with escaped control/bidi chars; HTML/SVG shown as source; Markdown links/images carry no `href`/`src` and open `LinkMenu.vue`.
- [ ] **No EventBus & Clean Session Wipe**: Decoupled state uses Pinia/composables/triggers; any new module-scoped state is reset in `stores/auth.ts` on sign-out.
- [ ] **Slow Connections & Loaders**: Reads go through `useQueryCache`; independent loads run in parallel and cancel on leave; `<LoadState>` renders listing states; pending changes show on rows; indicators use `useDelayedFlag`; verified on DevTools **Slow 4G** and **Offline**.

---

## 6. Testing & Verification

Vitest covers every runtime `.ts` and `.vue` file in `src/` (excluding `src/**/__tests__/**`, `src/types/**`, and `src/api/types.ts`) at **≥ 85% V8 line coverage**. Add or update tests alongside every feature or bug fix.

### Running Tests & Checks

- **Full verification gate:** `npm run check` — runs `type-check`, `lint:check` (`--max-warnings=0`), `format:check` (`src/`), and `test` in parallel.
- **Full suite (single run):** `npm test` (`vitest run`).
- **Single file or test name:** `npx vitest run src/utils/__tests__/table.test.ts` or `npx vitest run -t "splits CRLF"`.
- **Watch mode:** `npm run test:watch` (`vitest`).
- **Whole-app V8 coverage:** `npm run test:coverage` — prints the summary and writes `coverage/coverage-summary.json`.
  - HTML report on demand: `npm run test:coverage -- --coverage.reporter=html`.
  - Single-file coverage: `npx vitest run --coverage --coverage.include=src/composables/useTableStream.ts src/composables/__tests__/useTableStream.test.ts`.
- **Production build:** `npm run build` (`vue-tsc --build` and `vite build`).

### Adding & Updating Tests

1. **Location & Type Checking**: Place tests at `src/<area>/__tests__/<module>.test.ts` (`vite.config.ts` matches `src/**/__tests__/*.test.ts`). `tsconfig.app.json` excludes `__tests__` from the app bundle; `tsconfig.vitest.json` type-checks them during `npm run type-check`. Keep every touched runtime file at **≥ 85% V8 line coverage**.
2. **Environment (`node` vs `happy-dom`)**: Vitest runs in **`node` by default**. Add `// @vitest-environment happy-dom` on line 1 only when a test needs a DOM (`components/`, `views/`, `directives/`, or browser-API composables).
3. **Imports & Assertions**: Import `describe`, `it`, `expect`, `vi`, `beforeEach`, and `afterEach` explicitly from `'vitest'` (`globals` is off). Test observable behaviour through public exports rather than internals. Use `it.each` for table-driven cases; do not write snapshot tests.
4. **Mocking & State Reset**:
   - Mock only the network boundary: `vi.mock('@/api', async (importOriginal) => ...)` for app code, or `vi.stubGlobal('fetch', ...)` in `src/api/__tests__/client.test.ts`.
   - Use real Pinia (`setActivePinia(createPinia())` in `beforeEach`) and fake timers (`vi.useFakeTimers()`) where time matters.
   - `vite.config.ts` enables `clearMocks`, `restoreMocks`, and `unstubGlobals`. Reset module-scoped singleton state in `beforeEach` through public APIs (e.g., `clearQueryCache()`, `forgetRoles()`, `clearUploads()`, `useModalStore().closeAllModals()`) — never export test-only reset hooks.
5. **Composables & Components**:
   - Run composables that register watchers or scope cleanup inside `effectScope()` (and call `scope.stop()`) or mount a minimal host component.
   - Mount Vue components with `@vue/test-utils` (`mount`), passing `global: { plugins: [pinia, directives, router] }` (`directives` from `@/directives`, `createMemoryHistory()` router) when using global directives or router links.
6. **Streaming & Chunked Parsers**: Verify streaming parsers and readers (`src/utils/table.ts`, `src/utils/lines.ts`, `useRangeText`, `useTableStream`, `useTextStream`) produce identical output across arbitrary byte or character chunk boundaries.
7. **Refactors vs Behaviour Changes**: Keep existing tests passing unchanged during a refactor. Change an assertion only when behaviour intentionally changes, in the same commit, and state why in the commit message. Mark an unfixed bug a test exposes with `it.fails(...)` and a comment naming the bug.

### Verification Workflow for Agents

1. Run targeted tests while iterating (`npx vitest run <path>`), then `npm run test:coverage` when adding files or branches.
2. Format and lint modified files: `npm run format` (`prettier --write --experimental-cli src/`) and `npm run lint` (`eslint . --fix --cache`). If editing root docs like `AGENTS.md`, check them with `npx prettier --check AGENTS.md`.
3. Run the non-fixing gate: `npm run check`, plus `npm run build` when verifying the production bundle.
4. Confirm all commands exit with code 0 before concluding.
5. For UI changes, verify behaviour in the running app (`npm run dev`) when a server is available, including the slow-connection checks in §1.

### Commit Messages

Match the existing history: a short subject naming the area, a colon, then what changed in plain words — e.g. `Folder toolbar: the primary button keeps the right edge`, `SlidePane: one slide for every pane that opens and closes`. Prefix bug fixes with `Fix:` and structural cleanups with `Refactor:`.
