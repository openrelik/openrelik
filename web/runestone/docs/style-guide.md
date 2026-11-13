# Style Guide: Formatting and TypeScript

How code in this repository is written. **Tools decide what tools can
decide.** Prettier owns formatting, ESLint owns the rules it can check, and
this document covers the rest and explains the choices. When this guide and a
tool disagree, the tool wins and this guide gets fixed.

Scope: TypeScript and Vue code under `src/`, plus config and docs at the root.
Visual and interaction rules are in [`design-system.md`](design-system.md);
architecture is in [`../AGENTS.md`](../AGENTS.md).

Written 2026-11-01 at `104b7fa`. The conventions describe what the code
already mostly does; §7 lists where it doesn't yet and how to get there.

---

## 1. Principles

1. **Consistency over preference.** One way to write each thing. A reader
   should never wonder whether two styles mean two things.
2. **Explicit over implicit, at boundaries.** Exported functions, props,
   emits and server shapes are fully typed. Inside a function, let inference
   work.
3. **The compiler is the first reviewer.** Prefer code the type checker can
   verify (narrowing, discriminated unions) over code a human must trust
   (casts, `!`).
4. **Boring is a feature.** Use the language and Vue the way their docs do.
   This guide follows the [TypeScript handbook][ts], the [Vue style
   guide][vue] and [typescript-eslint][tse]'s recommended rules, deviating
   only where noted.

[ts]: https://www.typescriptlang.org/docs/handbook/intro.html
[vue]: https://vuejs.org/style-guide/
[tse]: https://typescript-eslint.io/rules/

---

## 2. Formatting (Prettier)

**Prettier is the only formatter. Never format by hand, and never argue about
formatting in review.** If Prettier's output looks wrong, restructure the
code, don't fight the tool.

### Configuration

`.prettierrc.json`, unchanged:

| Option | Value | Why |
| :--- | :--- | :--- |
| `semi` | `false` | House style; Prettier inserts the rare guard semicolon itself. |
| `singleQuote` | `true` | House style. |
| `printWidth` | `100` | Matches `.editorconfig`; fits dense UI code without wrapping every call. |
| everything else | Prettier 3 defaults | Trailing commas `all`, arrow parens `always`, 2-space indent. |

`.editorconfig` sets UTF-8, LF line endings, 2-space indent, final newline and
no trailing whitespace for editors that don't run Prettier.

### Rules

- **Format the whole repository**, not only `src/`: config files, Markdown
  docs, `AGENTS.md`, JSON. `.prettierignore` excludes only generated or
  vendored files (`dist/`, `node_modules/`, `package-lock.json`,
  `public/fonts/`).
- **Format on save** in your editor (Prettier extension, using the repo's
  Prettier version). Agents run `npm run format` before finishing.
- **ESLint never formats.** `eslint-config-prettier` turns off every
  formatting rule, so the two tools never fight. Do not add stylistic ESLint
  rules (`@stylistic/*`, `vue/max-attributes-per-line`, …).
- **Prettier does not sort.** Import order and Tailwind class order are not
  formatted; see §3.4 and §4.5.
- **Formatting-only commits** (a Prettier upgrade, a config change) go in
  their own commit, listed in `.git-blame-ignore-revs` so `git blame` skips
  them. Enable it once per clone:
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

---

## 3. TypeScript

### 3.1 Compiler settings

From `@vue/tsconfig` plus `tsconfig.app.json`. These stay on:

- `strict`: all strict checks, including `useUnknownInCatchVariables`.
- `noUncheckedIndexedAccess`: `array[i]` and `record[key]` may be
  `undefined`. This is why the code has many lookups to handle; handle them
  (§3.6), don't switch the flag off.
- `verbatimModuleSyntax`: type-only imports must be marked (§3.4).
- Add `noFallthroughCasesInSwitch` (§7.3): a `case` that falls through is a
  bug far more often than a trick.

Never use `@ts-ignore` or `@ts-nocheck`. If the compiler is wrong, which is
rare, use `@ts-expect-error` with a comment saying why; it fails once the
error goes away.

### 3.2 Types

- **`interface` for object shapes, `type` for everything else**: unions,
  function types, aliases, mapped and conditional types.
  ```ts
  interface Upload { key: string; name: string; sent: number }
  type QueryStatus = 'idle' | 'loading' | 'success' | 'error'
  type Fetcher = (signal: AbortSignal) => Promise<void>
  ```
- **No `enum`, no `namespace`.** Use string literal unions; when the values
  are needed at runtime too, an `as const` object or array:
  ```ts
  const VARIANTS = ['primary', 'brand', 'secondary', 'danger', 'ghost'] as const
  type Variant = (typeof VARIANTS)[number]
  ```
- **No `any`.** Use `unknown` and narrow it. Server JSON arrives typed by the
  endpoint (`src/api/types.ts`); anything parsed from a file (`JSON.parse`) is
  `unknown` until checked.
- **Discriminated unions over flag bags.** When an object can be one of
  several kinds, give it a `kind` field, not several optional booleans:
  ```ts
  // No: which combinations are valid? What does { up: true, rm: true } mean?
  interface Result { up?: boolean; rm?: boolean; mkdir?: boolean; folderName?: string }
  // Yes: each kind carries exactly its own fields.
  type Result =
    | { kind: 'up' }
    | { kind: 'rm'; item: Item }
    | { kind: 'mkdir'; folderName: string }
  ```
  Switch on `kind`; the compiler checks each branch has the right fields.
  For exhaustiveness, end the switch with
  `default: return assertNever(result)`, a one-line helper
  (`function assertNever(x: never): never`) added to `utils/` with the first
  switch that needs it.
- **`Record<K, V>`** for dictionaries with known key types; **`Map`** when
  keys are added and removed at runtime or aren't strings.
- **`readonly` / `Readonly<T>`** on data a function must not change, and on
  state a composable hands out but owns (`Readonly<WorkflowActivity>`).
- **Generics only when a function is genuinely used with more than one
  type.** One type argument, named for what it is (`T` is fine when there's
  one). No conditional or mapped types to save a few lines of declarations.
- **Types live where they belong**: server shapes in `src/api/types.ts`, app
  domain types in `src/types/`, a type used by one module next to it.

### 3.3 `null` and `undefined`

- **`undefined` means absent**: an optional property (`name?: string`), a
  lookup that found nothing, a parameter not passed.
- **`null` means deliberately empty**: a value that exists but has nothing in
  it yet (`error: string | null`, `controller: AbortController | null`), and
  whatever the server sends as `null`.
- Don't make a property both optional and nullable (`x?: T | null`) unless
  the server really sends both.
- **Always `===` / `!==`**, including against `null` and `undefined`
  (`eqeqeq`). The code base has no loose equality today; keep it that way.
- Use `?.` and `??` freely. Use `??` rather than `||` for defaults, so `0`
  and `''` survive. `||` is for booleans.

### 3.4 Modules and imports

- **Named exports only.** Default exports exist only where a tool expects
  one (`router`, the `directives` plugin, `api`); don't add new ones. Named
  exports keep one name for one thing across the codebase.
- **`@/` for everything outside the current directory**; `./` for a sibling
  in the same directory; never `../`. Moving a file then never breaks its
  imports, and every import of a module reads the same.
- **Type-only imports are marked.** When every name is a type, use
  `import type { … }`. When a module gives both values and types, use one
  statement with inline `type`:
  ```ts
  import type { Item } from '@/types/item'
  import { api, errorMessage, type WorkflowRecord } from '@/api'
  ```
  One import statement per module. (The code already follows this exactly;
  §7 makes ESLint keep it that way.)
- **Import order**, separated into these groups (not enforced by a tool;
  keep it by hand):
  1. External packages (`vue`, `vue-router`, `pinia`).
  2. Components (`@/components/…`), then icons (`@/components/icons`).
  3. Composables and stores.
  4. API, utils, then types (`import type`).
- **No barrel files** beyond the existing two (`@/api`,
  `@/components/icons`). Import from the module that defines the thing.
- **No import-time side effects** other than defining module state. Don't
  call stores, the router or the API at module top level (Pinia isn't
  installed yet; see `AGENTS.md` §3).

### 3.5 Functions

- **`function` declarations for named functions**, including exported ones.
  They read top-down, hoist, and show up by name in stack traces.
  **One-expression helpers** may be arrow constants:
  ```ts
  const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'
  ```
  Arrow functions are otherwise for callbacks.
- **Exported functions declare their return type.** Internal functions may
  rely on inference. Composables declare an explicit return interface
  (`UseUploadQueueReturn`), as `AGENTS.md` already requires.
- **Parameters:** at most three positional ones. Beyond that, or for any
  boolean or optional setting, take an options object:
  `ensure(key, fetcher, { signal, background })`, not
  `ensure(key, fetcher, signal, true)`.
- **Early returns** over nested `if`/`else`. A function whose body doesn't
  fit on a screen probably does more than one thing.
- **`const` by default; `let` only when the variable is reassigned; never
  `var`.**
- **Don't mutate parameters**, unless the function exists to do so and its
  name says so (`mapFolderToItem` returns; `upsert` writes).

### 3.6 Narrowing, casts and `!`

- **Narrow, don't assert.** `if (!item) return`, `typeof`, `in`,
  `instanceof`, discriminants. The compiler then proves the rest.
- **`as` only at trust boundaries:** DOM APIs that return a supertype
  (`event.target as HTMLInputElement`), and data that has been validated by
  hand just before. Never `as` to silence an error, never `as unknown as T`.
- **Prefer `satisfies`** to check that a literal fits a type without
  widening or casting it:
  ```ts
  const STATUS_LABEL = { running: 'running', success: 'done' } satisfies Partial<Record<TaskStatus, string>>
  ```
- **Non-null `!` only right after the check that makes it true, when the
  compiler can't follow it**: `map.get(key)!` straight after `map.has(key)`,
  `arr[i]!` inside a loop bounded by `arr.length`. If the reason isn't on
  the same or previous line, use a guard instead. (The code has 158, in 35
  files; §7.4 explains how they get reviewed.)

### 3.7 Async and errors

- **`async`/`await`** over `.then()` chains. `.then()` is fine for a
  deliberate fire-and-forget; mark that with `void promise` or a comment so it
  isn't mistaken for a forgotten `await`.
- **Every request takes an `AbortSignal`** where the caller can leave
  (`AGENTS.md` §1).
- **Throw `Error` subclasses, never strings or plain objects.** API failures
  are `ApiError`. Show users `errorMessage(err, fallback)`, never
  `err.message` directly.
- **`catch (err: unknown)`** (named `err`, typed explicitly although `strict`
  already makes it `unknown`, so readers don't need to know the flag).
  **`catch {`** when the error isn't used.
- **Don't swallow errors silently.** A `catch` either handles the error
  (state, message, retry), rethrows it, or says in a comment why it's safe to
  ignore.
- **Logging:** `console.warn('[module] what failed:', detail)` only for
  failures the user doesn't see and a developer would want to know about.
  `console.error` for invariants broken. **No `console.log` in committed
  code.**

### 3.8 Classes

Not used, except `ApiError extends Error` (subclassing `Error` is the
standard way to type errors). State lives in composables and stores; behaviour
in functions.

---

## 4. Vue single-file components

### 4.1 File structure

- Always `<script setup lang="ts">`. No Options API, no `defineComponent`.
- Block order: `<script setup>`, `<template>`, then `<style>` (rare; styling
  is Tailwind classes and tokens from `main.css`).
- Script order as in `AGENTS.md` §4: imports → props / emits / models →
  state and composables → computed → functions and lifecycle hooks.

### 4.2 Props, emits, models

- **Type-based declarations:** `defineProps<{ … }>()`,
  `defineEmits<{ select: [id: number] }>()` (named tuple syntax),
  `defineModel<T>()`.
- **Defaults with `withDefaults`**, keeping `const props = defineProps…` as
  the code does today. (Vue 3.5's destructured props are fine too, but one
  style: this one.)
- Props are read-only. To edit a value locally, copy it into a `ref`; for
  two-way binding use `defineModel`.
- Booleans default to `false`, so `<Foo disabled />` reads naturally; name
  them for the `true` state (`disabled`, not `enabled = true`).
- Emit names are camelCase verbs or events in the past tense:
  `select`, `rename`, `closed`.

### 4.3 Templates

- **No logic beyond a property access, a single comparison or a single
  call.** Anything else is a `computed` or a function with a name. No
  ternaries nested inside ternaries.
- **`v-for` always has a stable `:key`** (an id, never the index for a list
  that can change).
- Never `v-if` and `v-for` on the same element; filter in a `computed`.
- Component names in templates are PascalCase (`<LoadState />`).
- Icon buttons have `aria-label` and `v-tooltip` (`AGENTS.md` §5).
- No `v-html` (ESLint enforces it).

### 4.4 Reactivity

- `ref` for values, `shallowRef` for large collections replaced as a whole,
  `reactive` for module-level state objects and `Map`s. Don't destructure a
  `reactive` object; that loses reactivity.
- **Derive with `computed`**; use `watch` only for side effects (fetching,
  writing to storage, DOM). A `watch` that only sets another ref is a
  `computed`.
- Prefer `watch` with an explicit source over `watchEffect`, so readers can
  see what triggers it.
- `nextTick` is a last resort; a comment says what it waits for.

### 4.5 Styling

- Tailwind utility classes with design tokens (`AGENTS.md` §1,
  `design-system.md`). No hex codes, no inline `style` except computed
  geometry (positions, widths from a resize handle).
- Class order isn't enforced by a tool (§7.5, decision 3). Group roughly: layout →
  box → typography → colour → state.

---

## 5. Naming

| Thing | Style | Examples |
| :--- | :--- | :--- |
| Variables, functions | `camelCase` | `queryState`, `formatSize` |
| Types, interfaces | `PascalCase`, no `I`/`T` prefix | `Item`, `QueryState`, `UploadOptions` |
| True constants (config numbers, fixed tables) | `SCREAMING_SNAKE` | `DEFAULT_STALE_MS`, `CANDIDATES` |
| Components | `PascalCase.vue`, multi-word unless a base primitive | `FolderTable.vue`, `Button.vue` |
| Composables | `useThing.ts`, exporting `useThing()` | `useRowSelection.ts` |
| Utils, stores, types, endpoints | `camelCase.ts` | `textSearch.ts`, `rootPages.ts` |
| Tests | `__tests__/<module>.test.ts` | `utils/__tests__/table.test.ts` |
| Booleans | `is`/`has`/`can`/`should` or a past participle | `isFetching`, `canUpload`, `measured` |
| Event handlers | `on` + event, or what it does | `onKeydown`, `retrySave` |

- **Acronyms are words:** `Id`, `Url`, `Api`, `Csv` (`ApiError`,
  `parseUrl`, `hexId`), never `ID`, `URL`.
- **Units in the name** when a number has one: `SAVE_DELAY_MS`,
  `backoffMs`, `sizeBytes`.
- **No abbreviations** beyond the universal (`id`, `url`, `err`, `i` in a
  loop). `controller`, not `ctrl`; `folder`, not `fldr`.
- **Names say what, not how:** `visibleRows`, not `filteredSlicedArray`.
- A `use*` function that returns **shared module state** says so in its
  header comment (see the review plan's open question 1 for whether the name
  should change too).

---

## 6. Comments

`AGENTS.md` §4 sets the rule: comments explain *why*, in plain sentences, and
stay accurate.

- **`/** … */` on exports and on module headers**: what it's for, and the
  constraint behind a non-obvious decision.
- **`//` inside functions** for the one line a reader would stop at.
- **No commented-out code.** Git has it.
- **No comments that restate the code** (`// increment i`).
- **`TODO:`** only with enough context to act on without the author; prefer
  writing it down in a `docs/` plan.

---

## 7. Enforcement and rollout

What becomes automatic, and how to get there without mixing formatting
noise into real changes. This is a small piece of work of its own, done
**before** the [test plan](test-plan.md) and the
[code review](code-review-plan.md), so both start from code already in the
final style.

### 7.1 Scripts (`package.json`)

```json
"format": "prettier --write --experimental-cli .",
"format:check": "prettier --check --experimental-cli .",
"lint": "eslint . --fix --cache",
"lint:check": "eslint . --cache --max-warnings=0",
"check": "run-p format:check lint:check type-check"
```

`format` widens from `src/` to the whole repository; `*:check` variants
change nothing and fail on problems (for verification, and CI later).
`check` uses the existing `npm-run-all2`. Once the test plan's setup has
landed, `test` joins `check`.

### 7.2 ESLint rules (`eslint.config.ts`)

Added on top of the current `flat/essential` + `vueTsConfigs.recommended`:

| Rule | Setting | Enforces |
| :--- | :--- | :--- |
| `eqeqeq` | `error` | §3.3 |
| `no-console` | `['error', { allow: ['warn', 'error'] }]` | §3.7 |
| `no-restricted-imports` | patterns `['../*']` | §3.4, no `../` |
| `no-restricted-syntax` | `TSEnumDeclaration`, `TSModuleDeclaration` | §3.2, no `enum` / `namespace` |
| `prefer-const`, `no-var` | `error` (already in recommended; keep) | §3.5 |
| `@typescript-eslint/consistent-type-imports` | `{ prefer: 'type-imports', fixStyle: 'inline-type-imports' }` | §3.4 |
| `@typescript-eslint/no-import-type-side-effects` | `error` | §3.4, all-type imports use `import type` |
| `@typescript-eslint/consistent-type-definitions` | `['error', 'interface']` | §3.2 |
| `@typescript-eslint/explicit-module-boundary-types` | `error` | §3.5 |
| `@typescript-eslint/no-explicit-any` | `error` (in recommended; keep) | §3.2 |
| `@typescript-eslint/ban-ts-comment` | `error`, `ts-expect-error` allowed with description | §3.1 |
| `@typescript-eslint/no-non-null-assertion` | **off for now**, see 7.4 | §3.6 |

Also move `pluginVue.configs['flat/essential']` to `flat/recommended`. It
adds the Vue style guide's priority B and C rules; its formatting rules are
already off via `eslint-config-prettier`. A dry run today reports 148
problems: 145 `vue/attributes-order` (autofixable), 2
`vue/no-template-shadow`, 1 `vue/require-default-prop`.

Not adopted (type-aware linting): `no-floating-promises`,
`no-misused-promises`. They need `parserOptions.project`, which makes lint
several times slower. Revisit after the review (§7.5, decision 2).

### 7.3 Compiler (`tsconfig.app.json`)

Add `"noFallthroughCasesInSwitch": true`.

### 7.4 Rollout, one commit per step

1. **Prettier on the whole repo.** Widen `format`, fill
   `.prettierignore`, run it. This reformats `AGENTS.md` and the docs (tables
   get aligned). Mechanical; add the commit hash to
   `.git-blame-ignore-revs`.
2. **Scripts** from 7.1.
3. **Rules with no violations today**, turned on together: `eqeqeq`,
   `no-console`, `no-restricted-syntax`, `ban-ts-comment`,
   `consistent-type-imports`, `no-import-type-side-effects`, and
   `noFallthroughCasesInSwitch`. They lock in what the code already does.
   (Counts from a dry run at `104b7fa`.)
4. **`consistent-type-definitions`**: 1 site
   (`FolderTable.vue`, `type Column = { … }` → `interface`).
5. **`no-restricted-imports` (`../`)**: 16 imports in the 9 files of
   `src/api/endpoints/` switch to `@/api/…`.
6. **`explicit-module-boundary-types`**: 40 sites in 16 files get return
   types, by hand.
7. **Vue `flat/recommended`**: run `npm run lint` to autofix the 145
   attribute-order issues (one commit, add to `.git-blame-ignore-revs`),
   then fix the 3 others by hand.
8. **Docs:** `AGENTS.md` §6 verification uses `npm run check`; remove the
   "once the rollout lands" notes.

Each step: `npm run format`, `npm run lint`, `npm run build` exit 0, and a
quick look in `npm run dev` (none of these should change behaviour).

**Deliberately left to the review sessions**, not the rollout, because they
need judgement per site rather than a mechanical fix:

- The 158 non-null assertions (§3.6). Each session checks those in its
  area; once the count is low, turn on `no-non-null-assertion` as `error`.
- `as` casts (~57) that aren't at a trust boundary (§3.6).
- Flag bags to discriminated unions (§3.2).
- Template logic and nested ternaries (§4.3).

### 7.5 Decisions

Decided 2026-11-01, as recommended. Items marked *revisit* go on the list
for the testing effort after the review.

1. **Vue `flat/recommended`: adopt in the rollout** (§7.4 step 7). 145 of
   its 148 problems fix themselves.
2. **Type-aware lint rules** (`no-floating-promises`, `no-misused-promises`):
   **not now**, because they make lint several times slower. *Revisit* after the
   review.
3. **Tailwind class sorting** (`prettier-plugin-tailwindcss`): **no for
   now**. It would reorder classes in every template and bury the review
   diffs. Class order stays by hand (§4.5). *Revisit* after the review.
4. **Import sorting by a tool** (`eslint-plugin-import-x`,
   `simple-import-sort`): **no**. Order stays by hand, per §3.4.
