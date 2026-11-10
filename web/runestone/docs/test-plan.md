# Test Plan, Phase 1: A Safety Net for the Review

The first round of automated tests, done **before** the code review in
[`code-review-plan.md`](code-review-plan.md). It is a self-contained piece of
work: pick it up, do the steps in §4 in order, and finish with the checklist in
§6.

Written 2026-11-01 at `104b7fa`.

---

## 1. Why this comes first, and why it is small

The review is mostly refactoring that must not change behaviour. Today the
only proof of "nothing changed" is a manual click-through. The riskiest review
sessions refactor logic whose bugs are hard to see by eye: workflow edits and
undo, the streaming table parser, the Markdown parser, the query cache's
rules, byte/line/mark arithmetic.

Most of that logic is pure (input → output), so it can be tested cheaply: one
dev dependency, no browser, little mocking. That is this phase.

Everything else waits until after the review, when the structure has settled:
component and view tests, the API client, the upload queue, end-to-end tests.
Tests written now against components would pin the very structure the review
is going to change.

**Rule for this phase: test behaviour through public exports, never
internals.** The review will rename, move and inline internals; the tests must
survive that unchanged. If a test needs to reach inside a module, the test is
wrong, not the module.

---

## 2. Scope

| In | Out (later effort) |
| :--- | :--- |
| `src/utils/` pure helpers named in §4 | Components and views (`@vue/test-utils`) |
| `useQueryCache` (module-level, no DOM) | `api/client.ts` (needs a `fetch` mock) |
| `useWorkflow` edits and undo (Pinia + mocked `@/api`) | `useUploadQueue`, `useFolderActions` |
| | Directives, tooltip, DOM behaviour |
| | End-to-end (Playwright or similar) |
| | Coverage targets and CI |

---

## 3. Setup

### Dependency

`vitest` as a **dev dependency only**. Nothing else: no `jsdom` /
`happy-dom` (the code under test needs no DOM; `AbortController`,
`DOMException`, `TextDecoder` are built into Node 22+), no
`@vue/test-utils` (no components in this phase), no coverage plugin.

```sh
npm install --save-dev vitest
```

`AGENTS.md` §1 (Minimal Dependency Discipline) is about the runtime
footprint; it now names Vitest as the one allowed test dependency.

### Configuration

- **Config:** a `test` block in `vite.config.ts` (so the `@/` alias and Vue
  plugin are shared), or a `vitest.config.ts` that merges it. Prefer the
  former; one file is simpler. `environment: 'node'`.
- **Location:** `src/**/__tests__/<module>.test.ts`, next to the code.
  `tsconfig.app.json` already excludes `src/**/__tests__/*`, so test files
  stay out of the app build.
- **Type-checking tests:** add `tsconfig.vitest.json` (extends
  `tsconfig.app.json`, `include` the `__tests__` folders, `exclude: []`,
  `types: ["node"]`) and reference it from `tsconfig.json`, so
  `vue-tsc --build` checks the tests too. This is the standard `create-vue`
  layout.
- **Imports:** import `describe`, `it`, `expect`, `vi` from `vitest`
  explicitly. No globals.
- **Scripts** in `package.json`:
  ```json
  "test": "vitest run",
  "test:watch": "vitest"
  ```
- **Lint / format:** confirm `npm run lint` and `npm run format` cover the
  test files without changes to their configs; adjust only if they don't.

### How tests are written

- **Behaviour, not structure.** Assert on what a caller sees: return values,
  store contents, `queryState()`, how many times a fetcher was called.
- **Table-driven where cases are many.** `it.each([...])` with input and
  expected output side by side; easy to read and to extend when a bug is
  found.
- **No snapshot tests.** They pass by default and say nothing about intent.
- **Mock only the network.** `vi.mock('@/api')` in the workflow tests; real
  Pinia (`setActivePinia(createPinia())` in `beforeEach`). Fake timers
  (`vi.useFakeTimers()`) for anything with debounces or freshness windows.
- **Reset module state between tests.** Several modules keep module-level
  state; reset it in `beforeEach` through their public API
  (`clearQueryCache()`, a fresh Pinia). If a module has no public way to
  reset, note it as a review finding rather than adding a test-only export.
- **One test file per module.** Name tests as sentences:
  `it('keeps a quoted newline inside the cell')`.
- **Same style as the app code** ([`style-guide.md`](style-guide.md)):
  Prettier-formatted, linted, type-checked. The style guide's rollout comes
  before this phase, so tests are written in the final style from the
  start.

---

## 4. Work items, in order

Ordered by risk to the review, cheapest first within equal risk. Each item is
one commit (`Tests: <module>, <what is covered>`). Cases listed are the
minimum; add what reading the code suggests.

### 4.1 Setup

Everything in §3, plus one trivial test (e.g. `utils/format.ts`) to prove the
pipeline: `npm test`, `npm run build` (type-checks the test),
`npm run lint`, `npm run format` all exit 0.

### 4.2 `utils/table.ts`: CSV, TSV, JSONL (review sessions 10–11)

The parsers stream: `push(text)` takes text in any split, `end()` flushes.

- **Split-independence (the most important test):** for each fixture, the
  rows from one `push(whole)` equal the rows from pushing one character at a
  time, and from splitting at every position. Write this once as a helper and
  run every fixture through it.
- CSV: quoted fields, `""` escapes, delimiter inside quotes, newline inside
  quotes, CRLF and LF, trailing newline vs none, empty fields, ragged rows,
  header on/off, empty input.
- `sniffDelimiter`: `,` `;` `\t` `|`; quoted delimiters ignored; ambiguous
  sample.
- JSONL: valid lines, an invalid line (row carries `error` and `raw`),
  blank lines, columns growing as new keys appear, nested values via
  `cellText` / `jsonlCells`.
- `inferType`, `sortKey`, `compareKeys`: numbers vs text, empty cells, where
  nulls sort.

### 4.3 `utils/markdown.ts` and `utils/links.ts` (review session 12)

Safety first, then structure.

- **Safety:** raw HTML (`<script>`, `<img onerror>`, `<a href>`) comes out
  as text nodes, never as a node type that could carry markup. No node in any
  output carries unescaped HTML; assert this with a walker over the tree for
  a set of hostile inputs.
- `linkTarget`: `javascript:`, `data:`, relative, protocol-relative,
  look-alike hosts / userinfo (`https://good.com@evil.com`), what it reports
  for each.
- Blocks: headings, paragraphs, fenced and indented code, lists (nested,
  ordered), block quotes, tables, horizontal rules.
- Inline: emphasis, code spans (content not parsed further), links, images,
  escapes.
- Limits: `INLINE_MAX`, `TABLE_COLUMNS_MAX`, `LIST_DEPTH_MAX` hold, and
  pathological input (10k `*`, deep nesting) finishes quickly. Use a time
  bound, e.g. `< 200 ms`.

### 4.4 Byte, line, mark and search helpers (review session 10)

- `marks.ts`: `parseMark` ↔ `formatMark` round-trip for every mark shape
  (`#L12`, `#L12-L40`, with columns); invalid hashes return `null`;
  `spanOf` and `sameSpan` with reversed ranges.
- `lines.ts`: `createLineIndex` gives the same rows for any split of the
  input (same helper as 4.2), CRLF, a final line without `\n`, lines longer
  than `ROW_CHARS` wrapping into rows; `lineOf` / `firstRow` / `startOf`
  agree. `parseLineRange`, `sourceOffset` ↔ `shownOffset`,
  `showControls`.
- `bytes.ts`: `parseOffset` and `parseOffsetRange` (hex, decimal, bad
  input), `escapeControls`, `printable`, `readings` with both endiannesses
  on known bytes (pass `now` for dates), `decodings`.
- `textSearch.ts`: `lineMatcher` (case, special characters taken
  literally), `rowSegments` for matches across a row boundary.

### 4.5 `utils/workflow.ts` and `utils/workflowSpec.ts` (review session 7)

Build small workflow fixtures with a helper (`task('a')`,
`group([...], join)`), shared with 4.6.

- `specFromTasks` → `tasksFromSpec` round-trip keeps the tree.
- `parseSpec`: `null`, bad JSON, valid JSON of the wrong shape.
- `withFreshUuids`: every uuid changes, structure and everything else don't.
- `runBlocker`: empty workflow, unavailable worker, runnable.
- `canJoin`, `canJoinAll`, `mergeProblem`, `unchainable`,
  `canChainAfter`, `runStats`, `isActive` over a handful of fixtures.

### 4.6 `useWorkflow` edits and undo (review session 7)

The highest-value tests in this phase: the review may rewrite how undo works
(open question 6 in the review plan), and these tests decide whether a
rewrite is safe.

Setup: real Pinia, `vi.mock('@/api')`, fake timers; put a draft workflow
fixture into the workflows store.

- For each edit (`addTask` in all four `AddAt` positions, `removeTask` incl.
  a join and a group's last task, `splitGroup`, `mergeGroups`,
  `setTaskOption`): the tree after the edit is as expected, and
  **edit → `undo()` gives back a tree equal to the original.**
- Undo after a later unrelated edit still restores its own change.
- `undoable()` turns false when a later edit makes the undo moot, and
  `undo()` then leaves the tree alone.
- Edits are refused on a workflow that is not a draft, or is running.
- Saves: several edits within `SAVE_DELAY_MS` produce one save call; an edit
  during an in-flight save produces exactly one more save after it.

### 4.7 `useQueryCache` (review session 2)

`clearQueryCache()` in `beforeEach`; fake timers; fetchers are `vi.fn()`
returning promises the test resolves or rejects by hand.

- Fresh key: second `ensure` within `DEFAULT_STALE_MS` does not call the
  fetcher; after it, it does, and `status` stays `success` while refreshing.
- Concurrent `ensure` calls on one key share one fetcher call.
- Abort: one of two callers aborting does not abort the request; both
  aborting does. An aborted caller resolves, not rejects.
- A caller arriving after the request was aborted starts a new request
  (the `104b7fa` fix).
- `invalidate()` during a request: the next `ensure` starts a new request,
  and only the newer one writes the state; prefix invalidation.
- Failure on first load → `error`; failure on refresh → stays `success`
  with `error` set.
- `markFresh`, `forget`, `queryState` of an unknown key (`idle`).

### 4.8 `utils/upload.ts` (review session 4)

Small and cheap: `chunkCount` and `chunkRange` at exact multiples, one byte
over, and zero; `backoffMs` grows and is capped.

---

## 5. Effort

Roughly two working sessions. 4.1–4.4 in the first, 4.5–4.8 in the second.
Use the same agent-human split as the review: the agent drafts each test file
and the case list, the human checks the cases describe intended behaviour.

**When a test exposes a bug,** don't fix it in this phase. Mark the test
`it.fails(...)` with a comment naming the bug, log it in the review plan's
session log, and fix it in its own `Fix:` commit (which flips the test to
`it`).

**When a test needs an internal,** stop and record it as a finding for the
matching review session.

---

## 6. Done when

- [ ] `vitest` is the only new dependency, in `devDependencies`.
- [ ] `npm test` runs every test and exits 0; `npm run build`, `npm run lint`,
      `npm run format` still exit 0 with the tests type-checked.
- [ ] Items 4.2–4.8 are in, each in its own commit.
- [ ] Any known bugs are `it.fails` with a logged entry.
- [ ] `AGENTS.md` §6: the status note says Phase 1 is done, and the
      "(once Phase 1's setup has landed)" qualifier on `npm test` is removed.
      The test-writing rules there already match §3 of this plan; adjust
      them if implementation changed anything (e.g. config location).
- [ ] `AGENTS.md` §2 (Technology Stack): a Vitest row is added.
- [ ] `code-review-plan.md` §8 Q3 is marked done.
