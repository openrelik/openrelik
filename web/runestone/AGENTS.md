# Agent Guidelines: Feature Implementation & Architecture

This document instructs coding agents on how to design, implement, and maintain features in this codebase. Follow these conventions to preserve system consistency, performance, and architectural simplicity.

---

## 1. Core Principles

### Minimal Dependency Discipline
**Avoid adding new external dependencies.**
The runtime footprint is intentionally minimal (~5 dependencies). Before reaching for an `npm install`:
- Check if the requirement can be solved with modern browser APIs (Web Crypto, Clipboard API, `ResizeObserver`, `IntersectionObserver`, `URL`, `Intl`).
- Check existing utilities (`src/utils/`), composables (`src/composables/`), or directives (`src/directives/`).
- If a utility is missing (e.g. string formatting, sorting, fuzzy filtering), implement a clean, typed 15–30 line pure helper in `src/utils/`.
- Do **not** install component libraries (Headless UI, Radix, PrimeVue, Vuetify), utility toolkits (Lodash, Ramda), positioning engines (Popper, Floating UI), or event buses (Mitt, EventEmitter). The application uses custom, high-performance, tailored primitives.

### Design System Compliance
Every new UI element must conform to [`docs/design-system.md`](file:///Users/jbn/s/projects/test-ui/docs/design-system.md):
- **Typography**: Single monospace face (`JetBrains Mono`). Use the 4-step type scale (`.card-title` 14px, body 13px, `.micro-label` 12px lowercase with `tracking-[0.06em]`, badge/keycap 11px).
- **Numbers & Dates**: Always apply `.tabular` (`tabular-nums`) to dynamic numbers, timestamps, and sizes to eliminate layout shift.
- **Buttons**: Exactly 5 variants (`primary` [max 1 per screen], `brand`, `secondary`, `danger` [never solid], `ghost`) and 2 heights (`default` 32px, `row` 24px).
- **Geometry**: Near-square corners (`4px` sheets/cards, `3px` controls, `2px` badges/checkboxes). No pill shapes.
- **Colors**: Use CSS tokens (`--color-surface`, `--color-sunken`, `--color-brand`, etc.) in Tailwind classes (`bg-surface`, `text-ink-muted`). Never invent custom hex codes.

---

## 2. Technology Stack

| Technology | Version | Purpose & Usage Conventions |
| :--- | :--- | :--- |
| **Vue** | `^3.5` | Composition API strictly. Always `<script setup lang="ts">`. Use `defineModel()`. |
| **TypeScript** | `~6.0` | Strict typing. Explicit types on props, emits, models, and composable returns. No `any`. |
| **Tailwind CSS** | `^4.3` | Utility-first styling via `@tailwindcss/vite` and design tokens in `src/assets/main.css`. |
| **Pinia** | `^4.0` | Global reactive state via setup stores (`defineStore('name', () => { ... })`). |
| **Vue Router** | `^5.2` | Application routing and path navigation. |
| **Lucide Vue Next**| `^1.0` | Iconography. Standard size is `:size="13"` with `:stroke-width="1.5"` for dense UI. |
| **Vite** | `^8.1` | Build tooling and development server. |

---

## 3. Architecture & Layer Interactions

The codebase follows a strict separation of concerns:

```
┌────────────────────────────────────────────────────────────────────────┐
│                               VIEWS                                    │
│                     (Page & layout orchestration)                      │
│      src/views/FolderView.vue, FileView.vue, NotFoundView.vue          │
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
┌─────────────────┐    ┌─────────────────┐
│   DIRECTIVES    │    │      UTILS      │
│  (Declarative   │    │  (Stateless     │
│   DOM hooks)    │    │  pure helpers)  │
│ src/directives  │    │    src/utils    │
└─────────────────┘    └─────────────────┘
```

### Layer Responsibilities

#### 1. Views (`src/views/`)
- Coordinate top-level layout panes: Top Bar $\rightarrow$ Multi-Pane Workspace (List + Inspector) $\rightarrow$ Status Bar.
- Bind route params (`id`, query strings) to data sources and composables.
- Do not manipulate low-level DOM or implement raw algorithms directly in views; delegate to composables and child components.

#### 2. Components (`src/components/`)
- Categorized into focused subdirectories:
  - `base/`: Reusable primitive components (`Button.vue`, `Switch.vue`, `KeyHint.vue`, `KeyValueRow.vue`, `Tooltip.vue`).
  - `layout/`: Shell layout structures (`PathBar.vue`, `StatusBar.vue`, `BrandLink.vue`).
  - `dialogs/`: Modal sheets (`SettingsDialog.vue`, `HelpDialog.vue`, `ShareDialog.vue`, `RunDialog.vue`).
  - Domain-specific folders (e.g. `folders/`, `workflow/`, `prompt/`).
- Follow unidirectional data flow: **Props down, events up**. Use Vue 3.4 `defineModel()` for two-way bindings.
- Keep components small and focused. If a component exceeds ~300 lines, extract sub-components or stateful logic into composables.

#### 3. Composables (`src/composables/`)
- Encapsulate reusable stateful logic, keyboard dispatchers, selection algorithms, and store bridges.
- Follow the `use*` naming convention (`useRowSelection.ts`, `useKeyboardShortcuts.ts`, `useTooltip.ts`).
- Clean up listeners, timers, and observers in `onUnmounted()` or return an explicit cleanup function.
- Always provide explicit TypeScript return types for exported composable functions.

#### 4. Stores (`src/stores/`)
- Use Pinia **setup store** syntax (`defineStore('name', () => { ... })`).
- Reserve stores strictly for state that outlives individual views:
  - Active modal stack (`modals.ts`)
  - User preferences and theme (`settings.ts`)
  - Background execution queues and notices (`run.ts`)
- Local UI state (cursor index, hover item, filter text, inline editing state) belongs in views or composables, **not** in global stores.

#### 5. Directives (`src/directives/`)
- Encapsulate declarative DOM behaviors to keep templates clean:
  - `v-autofocus`: Focus an input when mounted.
  - `v-trap-focus`: Keep Tab focus contained within an active modal sheet.
  - `v-click-outside`: Dismiss popovers or inline editors when clicking outside.
  - `v-scroll-into-view`: Keep keyboard-navigated cursor rows visible in scrollable lists.
  - `v-overflow-tooltip`: Show a tooltip only if the text content actually overflows its container (`scrollWidth > clientWidth`).
  - `v-copy-to-clipboard`: Copy text to clipboard with transient feedback states.
  - `v-tooltip`: Bind hover tooltips to the global singleton tooltip coordinator.

#### 6. Utils (`src/utils/`)
- Pure, stateless helper functions (e.g. `format.ts`, `keyboard.ts`, `match.ts`, `scroll.ts`).
- Zero reactive dependencies (`ref`, `reactive`), zero Pinia imports, and no DOM side-effects.
- Easily testable and deterministic.

### Disconnected Component Communication (No EventBus)

> [!IMPORTANT]
> **Do NOT install or implement an EventBus (`mitt`, EventEmitter, or global event hubs).**
> Event buses produce untyped, untraceable side-effects and memory leaks. Decoupled communication must use one of four patterns:

1. **Global App State & Modals**: Pinia setup stores (`src/stores/`).
   - *Rule*: Store holds state/actions; disconnected components bind via `computed()` / store methods.
   - *Example*: `useModalStore().openModal('share')` opens `<ShareDialog />` in `App.vue`.
2. **Subsystem Singletons**: Module-scoped reactive composables (`src/composables/`).
   - *Rule*: Module-level `ref()` / `reactive()` shared across imports without store overhead.
   - *Example*: `useTooltip.ts` coordinates a single `<Tooltip />`; `useShareDialog.ts` exports `openShareDialog()`.
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
4. **Singleton DOM Elements**: Heavy floating elements (such as tooltips) should use a single shared coordinator instance rather than spawning DOM nodes for every button or table cell.

### Readability & Simplicity
1. **Explicit Script Setup**:
   ```html
   <script setup lang="ts">
   // 1. Imports (external -> internal components -> composables/stores -> utils/types)
   import { computed, ref } from 'vue'
   import Button from '@/components/base/Button.vue'
   import { useSettings } from '@/composables/useSettings'
   import type { Item } from '@/data/folders'

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

---

## 5. Interaction Patterns Checklist for Features

When adding or modifying interactive features, ensure:

- [ ] **Keyboard First**: Is the feature accessible via keyboard? (Does it respect `isTyping()` so form inputs aren't hijacked?)
- [ ] **Escape Hierarchy**: Does `Escape` cancel the active operation (inline edit, filter, or modal) without collateral side-effects?
- [ ] **Symmetrical Ergonomics**: If a container opens on double-click, does an item activate on double-click? Does pressing `Enter` or `l` behave consistently?
- [ ] **No Layout Shift**: Do dynamic numbers or dates use `.tabular`? Are row heights locked?
- [ ] **Semantic Status**: Are status indicators using derived tints and borders instead of solid saturated backgrounds?
- [ ] **Button Constraints**: Are you using one of the 5 allowed variants and 2 allowed heights from `Button.vue`?
- [ ] **Tooltips & Accessibility**: Do icon buttons declare `aria-label` and `v-tooltip`?
- [ ] **No EventBus**: Uses Pinia, module composables, or view orchestration for decoupled communication—no event emitters or mitt.

---

## 6. Testing Note

> [!NOTE]
> **Automated tests are currently skipped.**
> Automated test suites (e.g. Vitest / Cypress / Playwright) have not yet been implemented in this repository. Agents should **not** write or run test scripts until the testing framework is officially set up.
>
> **Verification Workflow for Agents**:
> 1. Run formatting: `npm run format` (which executes `prettier --write ...`).
> 2. Run linting: `npm run lint` (which executes `eslint . --fix --cache`).
> 3. Run typechecking & build: `npm run build` (which executes `vue-tsc --build` and `vite build`).
> 4. Verify that all commands exit with code 0 before concluding your task.
