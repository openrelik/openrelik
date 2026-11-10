# Code Review Plan: Simplicity Over Cleverness

A plan for a full review of the codebase, split into sessions. Each session is
one agent and one human working together. The plan is written to be read
offline; everything needed to start a session is in this file.

Snapshot taken 2026-11-01 at `104b7fa`: ~25,500 lines in ~170 files under
`src/`, no automated tests.

> [!IMPORTANT]
> **Prerequisites, in order:**
> 1. **[Style guide](style-guide.md) rollout (§7.4 there).** Prettier on the
>    whole repo and the mechanical lint rules, so formatting noise never
>    mixes into review diffs. Small: mostly autofixes.
> 2. **[Test Plan, Phase 1](test-plan.md).** Before session 1,
>    add the first round of unit tests (Vitest, dev-only) for the pure logic
>    the riskiest sessions will refactor: the table and Markdown parsers, the
>    byte/line/mark helpers, workflow edits and undo, the query cache.
>    Session 0 can run before or alongside it. Broader testing (components,
>    API client, end-to-end) waits until after the review, when the structure
>    has settled.
>
> The review judges code against the [style guide](style-guide.md) as well
> as against simplicity: where the guide has a rule, the rule is the answer,
> and there's no need to debate it per file.

---

## 1. What the review is for

One question, asked of every file: **would a competent developer new to this
codebase understand this code on first read, and change it without fear?**

The review optimises for:

- **Simplicity.** The most direct solution that meets the requirement. No
  layers, options or generality that nothing uses yet.
- **Readability.** Names say what things are. Control flow can be followed top
  to bottom. A function does one thing.
- **Conventional structure.** Vue 3 / TypeScript / Pinia used the way their
  docs and most teams use them, so knowledge transfers in and out.

It is **not** a bug hunt, a performance audit or a redesign. Bugs found along
the way get logged (§6), not fixed inside a simplification commit.

### What "clever" means here

Treat these as smells to question, not automatic failures:

| Smell | Simpler alternative to consider |
| :--- | :--- |
| A trick that needs a comment to decode (bit ops, `reduce` building objects, regex doing parsing) | A plain loop or named helper |
| Nested ternaries, especially in templates | `if`/early return, or a `computed` with a name |
| An object with many optional boolean flags meaning "which kind am I" | A discriminated union (`kind: 'mkdir' \| 'rm' \| …`) |
| Indirection with one caller (a factory, registry, callback map, option nobody passes) | Inline it |
| Generic helper used once | Inline it, or keep it local to its caller |
| Hidden module-level state behind a `use*` name | Make the singleton obvious (name, header, or a store) |
| Timers coordinating state (`setTimeout` chains, debounce + in-flight + "dirty" sets) | One explicit state machine, or one small helper used everywhere |
| `WeakMap`/`Set`/`Map` side tables keyed on objects to track lifecycle | A field on the object it describes |
| Watchers that react to watchers; `nextTick` to fix ordering | Derive with `computed`; call the thing directly |
| Component > ~300 lines, or a script mixing several concerns | Extract a child component or a composable |
| Two files solving the same problem slightly differently | One shared implementation |
| Type gymnastics (`as unknown as`, conditional/mapped types for one use) | A plain interface |

### What is *not* a smell

Some complexity is essential and must survive the review. The test is whether
it is **essential, in one place, and explained**, not whether it is short.
Examples the project already depends on (see `AGENTS.md`):

- Upload chunks of one file going strictly one at a time (`useUploadQueue`).
- The query cache's freshness and request-joining rules (`useQueryCache`).
- Byte-range reading and windowed rendering for multi-gigabyte files.
- Untrusted content rendered as text only; no `v-html`; links via the link menu.
- Stale-while-revalidate, per-datum load states, `AbortSignal` cancellation.

A simplification that breaks one of these is a regression, however much
shorter it is.

---

## 2. How a session runs

Each session is 2–3 hours of focused work, one area, one local branch
(`review/NN-area`; the repo has no remote, so no PRs).

**Before (agent, ~20 min, no edits).**
1. Read every file in scope fully, plus the files they import from or are
   imported by, enough to understand the contracts.
2. Read the area's doc comments and the relevant `AGENTS.md` /
   `src/composables/README.md` / `docs/design-system.md` sections.
3. **Check the style-guide leftovers.** The rollout left the judgement
   calls to the review (style guide §7.4): non-null assertions (`!`), `as`
   casts outside trust boundaries, flag bags, template logic. List the ones
   in scope; they are findings like any other.
4. **Check the tests.** Run `npm test` and read the tests covering the area
   (each session's **Tests** line says what exists). If code a finding would
   change has no test, list the missing cases; they get written and committed
   *before* the refactor, against the current behaviour.
5. Produce a findings list in the format in §5, ranked by payoff. Cap it at
   ~15 items; the rest go to a "later" list.

**Together (human + agent).**
6. Walk the list. For each item the human decides: **do** / **skip** /
   **discuss later** / **not a problem (record why)**. The human has the last
   word on taste; the agent argues for its findings once, with code, then
   accepts the call.
7. Ambiguous items get a quick sketch (the agent shows the simpler version in
   the chat) before anyone edits files.

**Change (agent, human watching).**
8. Missing tests from step 4 first, in their own commit, passing against the
   code as it is.
9. One finding per commit. Refactors never change behaviour, and never change
   a test in the same commit; a refactor that needs a test changed is a
   behaviour change. If a fix changes behaviour, it is its own `Fix:` commit.
10. After each commit: `npm test`, `npm run format`, `npm run lint`,
    `npm run build`, all exit 0.
11. Manual check in `npm run dev` against a server, using the session's
    "verify" list (§4). Tests cover the pure logic only; the UI, the network
    and the components are still checked by hand, so do not skip this for
    "obviously safe" refactors.

**After (~15 min).**
12. Update doc comments, `src/composables/README.md` and `AGENTS.md` where
    the change makes them wrong.
13. Append to the session log (§7): what was done, skipped and why, follow-ups,
    and any rule worth adding to `AGENTS.md`.

### Guardrails

- **No new dependencies.** Simplifying never means "install a library".
- **No drive-by redesigns.** If a finding needs a new architecture, write it
  up as a follow-up and stop.
- **Keep diffs small.** If a single finding grows past ~300 changed lines,
  stop and split it.
- **Tests describe behaviour, not structure.** Tests added during the review
  go through public exports only, so the next refactor doesn't break them.
  Component, API-client and end-to-end tests are out of scope; they belong to
  the testing effort after the review.
- **Don't simplify across sessions.** If a fix in session 7 wants to change an
  API reviewed in session 2, note it; don't reopen session 2 mid-flight.

---

## 3. Order and dependencies

Foundations first, so later sessions build on contracts already agreed.
Calibration first, so the rubric is tested on low-risk code.

| # | Session | Lines | Risk |
| :-: | :--- | --: | :-: |
| S | [Style guide](style-guide.md) rollout (prerequisite) | — | low |
| T | [Test Plan, Phase 1](test-plan.md) (prerequisite) | — | — |
| 0 | Calibration: general utils | ~500 | low |
| 1 | API layer | ~1,450 | high |
| 2 | Query cache, stores, app-wide state | ~1,550 | high |
| 3 | Folder loading and navigation | ~1,200 | high |
| 4 | Folder actions, permissions, uploads | ~1,450 | high |
| 5 | Folder UI: `FolderView`, `FolderTable` | ~2,500 | medium |
| 6 | Shell: prompt, path bar, status bar, shortcuts | ~2,000 | medium |
| 7 | Workflow model | ~2,000 | high |
| 8 | Workflow UI I: `WorkflowGraph` | ~1,450 | medium |
| 9 | Workflow UI II: panel, tree, inspector, dialogs | ~2,100 | medium |
| 10 | File reading engine | ~2,000 | high |
| 11 | Viewers I: text and table | ~1,700 | medium |
| 12 | Viewers II: hex, Markdown, file page, untrusted content | ~2,100 | medium |
| 13 | Primitives, directives, tooltip, design-system CSS | ~1,800 | low |
| 14 | Dialogs, account, sharing, login, metrics | ~2,400 | low |
| 15 | Cross-cutting pass and wrap-up | — | — |

S, then T, come before session 1; session 0 can run before or alongside T.
Sessions 8–9 and 11–12 can swap order freely. 13 and 14 can run any time after 2.

---

## 4. The sessions

Each session lists: **scope** (files), **focus** (questions specific to the
area, on top of the general rubric in §1), **leads** (concrete things noticed
while writing this plan; starting points, not verdicts) and **verify** (the
manual checks after changes).

### Session 0 — Calibration: general utils

Short session. The point is to agree on the rubric on code where mistakes are
cheap, and to tune the findings format before the high-risk sessions.

- **Scope:** `src/utils/format.ts`, `keyboard.ts`, `match.ts`, `scroll.ts`,
  `placement.ts`, `breakable.ts`, `id.ts`, `item.ts`, `caseRef.ts`,
  `worker.ts`, `report.ts`, `links.ts`.
- **Focus:** Are these really pure and stateless? Is each helper used more
  than once (otherwise, does it belong next to its caller)? Do names say what
  they return?
- **Leads:** `id.ts` uses bit operations; check it reads plainly.
  `match.ts` (fuzzy matching) is the kind of code where a clever scoring
  algorithm creeps in.
- **Output beyond findings:** adjust §1's smell table and §5's format based
  on what felt useful. Decide the open questions in §8 that block later
  sessions (especially Q1, Q2 and Q4).
- **Tests:** none needed; low risk. Optionally write tests for helpers found to be subtle (e.g. `match.ts` scoring).
- **Verify:** prompt fuzzy matching, file sizes/dates formatting, tooltip and
  menu placement near screen edges.

### Session 1 — API layer

- **Scope:** `src/api/client.ts` (581), `errors.ts`, `session.ts`,
  `config.ts`, `index.ts`, `types.ts`, `endpoints/*.ts`.
- **Focus:** `client.ts` does many jobs (base URL, CSRF, 401 refresh, retry,
  timeout, activity count, reachability, JSON/blob/response handling, XHR
  uploads). Is each one easy to find and follow, or are they interleaved in
  one long `request()` path? Would splitting the file (e.g. `csrf.ts`,
  `upload.ts`, `activity.ts`) help, or just scatter it? Is the
  `responseType: 'response'` escape hatch needed by more than one caller?
  Are endpoint modules uniform (same signature shape, same options)?
- **Leads:** the one `as unknown as` in the codebase is in `client.ts`.
  Listener sets (`activityListeners`, `reachabilityListeners`) are a
  hand-rolled pub/sub; check they stay small and typed.
- **Tests:** **none.** The API client is out of Phase 1 scope (it needs a `fetch` mock). Keep refactors here to moves and renames unless tests are added first; anything deeper in `request()` or the 401/CSRF retry waits for the post-review testing effort, or gets its tests written in this session.
- **Verify:** sign in/out, expired session refresh (wait or clear the token),
  a mutating request after the CSRF token goes stale, upload with progress,
  offline → status bar shows unreachable → reconnect recovers.

### Session 2 — Query cache, stores, app-wide state

- **Scope:** `src/composables/useQueryCache.ts`, `useAutoRefresh.ts`,
  `useDelayedFlag.ts`, `useNetworkActivity.ts`, `useConnection.ts`,
  `useRemembered.ts`, `useSettings.ts`; `src/stores/*.ts`; `src/main.ts`,
  `src/App.vue`.
- **Focus:** this is the backbone; 21 files import `useQueryCache` and 19
  import the items store. Can the cache's rules be stated in five sentences,
  and does the code read like those sentences? Are stores plain setup stores
  with no logic that belongs in a composable (or vice versa)? Is sign-out
  cleanup in one place and complete?
- **Leads:** `useQueryCache` tracks waiters in a `WeakMap<AbortController,
  number>` and was just fixed for a subtle join bug (`104b7fa`). A prime
  candidate for "can a field on the entry replace the side table?". Check the
  `MAX_ENTRIES` eviction is needed. `settings.ts` uses a
  `structuredClone`/JSON copy; check why.
- **Tests:** `useQueryCache` (Phase 1, §4.7). Stores and the other composables in scope have none; add cases for anything a finding changes.
- **Verify:** the slow-connection checklist in `AGENTS.md`: revisit within
  30 s costs zero requests (except the folder listing), Slow 4G, Offline,
  refocus/reconnect refresh, sign out then in as another user shows no stale
  data.

### Session 3 — Folder loading and navigation

- **Scope:** `useFolderLoader.ts`, `useRootPager.ts`, `useFolderPrefetch.ts`,
  `useFolderSearch.ts`, `useCaseRef.ts`, `useFileDetails.ts`,
  `src/router/index.ts`.
- **Focus:** do the loaders share one shape (same return type pattern, same
  key naming)? Is `folderKeys` the only place keys are built? Is prefetch
  logic separate from loading logic? Is the router guard simple?
- **Leads:** `useFolderLoader` exports mapping functions (`mapFolderToItem`,
  `mapFileToItem`) used by uploads and workflows; check whether they belong
  in a mapper module or the store. `connectionIsConstrained` lives in
  `useFolderPrefetch` but is imported by `useUploadQueue`; misplaced?
- **Tests:** **none.** Loaders sit on the query cache (tested) and the API (not). Prefer moves and renames; test any extracted pure helper (e.g. the item mappers) as it is extracted.
- **Verify:** root list paging, entering a folder (cached rows instantly,
  one listing refetch), deep link to a nested folder, `/case/<ref>`, hover
  prefetch on/off when DevTools throttles, search.

### Session 4 — Folder actions, permissions, uploads

- **Scope:** `useFolderActions.ts` (324), `useItemActions.ts`,
  `useFolderPermissions.ts`, `useUploadQueue.ts` (474), `useUploadPanel.ts`,
  `useDropZone.ts`, `useDownload.ts`, `useConfirm.ts`, `src/utils/upload.ts`.
- **Focus:** each mutation should read as "do it, write the answer into the
  cache, show the error". Is optimistic-update logic duplicated per action?
  In the upload queue, is the essential complexity (one chunk at a time,
  in-session resume, backoff) clearly separated from bookkeeping?
- **Leads:** `useUploadQueue` keeps `uploads`, `controllers`, `running` as
  three parallel structures keyed by upload key; could the controller and
  running flag live on the upload? `pump()` is ~150 lines; read it as the
  main suspect. `useFolderActions` is imported by `useWorkflow` and
  `usePrompt`; check the dependency direction makes sense.
- **Tests:** `utils/upload.ts` only (Phase 1, §4.8). `useUploadQueue` and `useFolderActions` have none; if `pump()` is restructured, first extract its decisions into pure functions with tests, then rewire.
- **Verify:** create/rename/delete folder, delete files, move/copy if
  present, role-restricted folder (actions hidden), upload several files
  incl. large and empty, cancel, retry after going offline mid-upload, leave
  the folder mid-upload.

### Session 5 — Folder UI: `FolderView`, `FolderTable`

- **Scope:** `src/views/FolderView.vue` (935, 765 lines of script),
  `src/components/folders/*` (`FolderTable` 836, `FolderToolbar`,
  `FolderPager`, `FolderStatusBar`, `ItemMenu`, `UploadRow`,
  `CaseRefPopover`), `layout/UploadQueuePanel.vue`, `useRowSelection.ts`,
  `useGroupStacks.ts`.
- **Focus:** a view should orchestrate, not implement. List every concern in
  `FolderView`'s script and propose where each goes (composable or child).
  Do the same for `FolderTable`. Agree the extraction plan before editing;
  execute it as a series of small, behaviour-preserving moves.
- **Leads:** `FolderView` has the most nested ternaries (4) and several
  `nextTick` calls; `FolderTable` too. `useRowSelection` uses `reduce`.
- **Tests:** none (components). `useRowSelection` is pure enough to test; add cases before changing it.
- **Verify:** keyboard navigation (j/k, Enter, l, Escape layers), selection
  (shift/ctrl), inline rename, row menu vs selection bar actions agree, drag
  and drop upload, empty/loading/error states, workflow folder shows its
  panel.

### Session 6 — Shell: prompt, path bar, status bar, shortcuts

- **Scope:** `usePrompt.ts` (541), `components/prompt/*`,
  `layout/PathBar.vue` (380), `layout/StatusBar.vue`, `BrandLink.vue`,
  `SettingsTrigger.vue`, `useKeyboardShortcuts.ts`, `useHelp.ts`,
  `dialogs/HelpDialog.vue`, `stores/modals.ts` (prompt registration parts).
- **Focus:** the prompt is a small command interpreter (`cd`, `..`, `-`,
  `mkdir`, `rm`, search, case refs). Is parsing separated from executing,
  and both from the UI? Could the command table be data rather than
  branches?
- **Leads:** `PromptResult` has ~10 optional boolean flags (`up`, `here`,
  `home`, `prev`, `mkdir`, `rm`, `remote`, …): the textbook case for a
  discriminated union. `usePrompt()` is one ~450-line function.
  `PathBar` has the most `nextTick` calls (4).
- **Tests:** **none.** If the prompt's command parsing is separated from execution (a likely finding), the parser becomes pure: test it as it is extracted.
- **Verify:** every prompt command, Tab completion, history, remote search
  results, opening from shortcut and from status bar, Escape, Help dialog
  lists every shortcut.

### Session 7 — Workflow model

- **Scope:** `useWorkflow.ts` (791), `useWorkflowLoader.ts`,
  `useWorkflowTemplates.ts`, `useWorkflowDialog.ts`, `useWorkers.ts`,
  `useRun.ts`, `useTaskReport.ts`, `stores/run.ts`, `stores/workflows.ts`,
  `utils/workflow.ts`, `utils/workflowSpec.ts`, `types/workflow.ts`,
  `types/worker.ts`.
- **Focus:** separate three things and check each is simple on its own:
  (1) pure tree edits on a workflow spec, (2) save scheduling (debounce, one
  save in flight, save-after), (3) undo. Pure tree edits belong in
  `utils/workflow*.ts` and should be trivially readable.
- **Leads:** `useWorkflow` holds five module-level maps/sets (`activity`,
  `unsaved`, `saveTimers`, `saves`, `runs`) plus `followed`; consider one
  per-workflow record. Undo has paired functions (`removeTask`/`restore`,
  `splitGroup`/`unsplit`, `mergeGroups`/`unmerge`); would snapshotting the
  spec before an edit be simpler than inverse operations? 6 `setTimeout`s.
- **Tests:** `utils/workflow*.ts` and `useWorkflow` edits, undo and save coalescing (Phase 1, §4.5–4.6). These decide open question 6: an undo rewrite is safe when they pass unchanged.
- **Verify:** create workflow from files, add/remove/split/merge tasks,
  undo each, edit options, rapid edits while on Slow 4G (saves coalesce),
  run, polling until done, outputs appear, copy, save as template, discard.

### Session 8 — Workflow UI I: `WorkflowGraph`

- **Scope:** `components/workflow/WorkflowGraph.vue` (1429, 836 lines of
  script).
- **Focus:** the largest file in the repo. Separate layout math (pure,
  belongs in `utils/`), interaction (drag, select, keyboard; composable) and
  rendering (template, child components). Agree the split first, then move
  in steps.
- **Leads:** 4 `reduce` calls, 3 `nextTick`. Check whether the layout
  algorithm can be explained in a paragraph; if not, that's the finding.
- **Tests:** none (component). Layout math moved into `utils/` gets tests as it moves.
- **Verify:** graphs of 1, 5, 30+ tasks; groups and joins; selection and
  keyboard; status colours on both themes; resizing.

### Session 9 — Workflow UI II: panel, tree, inspector, dialogs

- **Scope:** `WorkflowPanel.vue` (504), `WorkflowTree.vue` (383),
  `TaskInspector.vue` (378), `WorkflowSummary.vue`, `TaskStatusBadge.vue`,
  `reports/PriorityBadge.vue`, `dialogs/WorkflowDialog.vue`,
  `dialogs/RunDialog.vue`, `dialogs/TaskReportDialog.vue`.
- **Focus:** do the tree and the graph duplicate logic (status, ordering,
  selection) that should be shared? Do the dialogs follow one pattern?
- **Leads:** `WorkflowDialog` has nested ternaries; `WorkflowTree` uses
  `reduce`.
- **Tests:** none (components); relies on session 7's tests for the model underneath.
- **Verify:** as session 7, through the panel and tree; task report dialog
  with a long report.

### Session 10 — File reading engine

- **Scope:** `useByteChunks.ts`, `useRangeText.ts`, `useTextStream.ts`,
  `useTableStream.ts`, `useTextSearch.ts`, `useMarkedRange.ts`,
  `useRowScroller.ts`; `utils/bytes.ts`, `lines.ts`, `table.ts`,
  `textSearch.ts`, `marks.ts`, `preview.ts`.
- **Focus:** this layer is performance-critical; the simplicity bar is
  "every optimisation is named and justified in a comment". Do the stream
  composables share a shape, or does each reinvent chunking, cancellation
  and progress?
- **Leads:** `useTextSearch` has the codebase's only generator (`function*`)
  and 3 timers; check the generator earns its place (it may: incremental
  search without blocking). `table.ts` is a hand-written CSV/TSV/JSONL
  parser; it must be correct on quoted fields more than it must be short.
- **Tests:** `bytes`, `lines`, `marks`, `textSearch`, `table` utils (Phase 1, §4.2, §4.4). The stream composables have none; their chunking is checked by hand with the large-file cases below.
- **Verify:** open a small text file, a >1 GB file (scroll to end, no memory
  blow-up), CSV with quoted newlines, TSV, JSONL, search forward/back in a
  large file, `#L12-L40` marks in the URL.

### Session 11 — Viewers I: text and table

- **Scope:** `viewers/TextViewer.vue` (660), `TableViewer.vue` (611),
  `TextRow.vue`, `TextSearchBar.vue`, `TableDetail.vue`.
- **Focus:** what do these two (and `HexViewer`, next session) have in
  common: scrolling, cursor, marks, search, copy? Is it shared, or copied
  three times with drift? Propose one shared composable only if it is
  simpler than the three copies.
- **Leads:** `TableViewer` has 3 nested ternaries and 4 timers;
  `TextViewer` has a ~490-line script.
- **Tests:** `utils/table.ts` (Phase 1, §4.2); the components themselves by hand.
- **Verify:** keyboard nav, selection/marks and URL hash, copy, search,
  wrapping toggle, column resize/detail in tables.

### Session 12 — Viewers II: hex, Markdown, file page, untrusted content

- **Scope:** `views/FileView.vue`, `viewers/FileContent.vue`,
  `HexViewer.vue` (590), `HexInspector.vue`, `MarkdownViewer.vue` (304),
  `FileSidePanel.vue`, `FileDetails.vue`; `utils/markdown.ts`,
  `components/markdown/*`, `useLinkMenu.ts`.
- **Focus:** two lenses. Simplicity, as everywhere. And safety: the
  untrusted-content rules (§1 of `AGENTS.md`) must be *obviously* upheld by
  reading the code, not by reasoning about edge cases. A simpler Markdown
  renderer that is easier to audit is a security win.
- **Leads:** `utils/markdown.ts` (310) is a hand-written parser; check it is
  a recognisable structure (block pass, then inline pass) rather than a
  regex pile.
- **Tests:** `utils/markdown.ts` and `utils/links.ts`, including the hostile-input safety cases (Phase 1, §4.3). A parser rewrite is acceptable only if those pass unchanged.
- **Verify:** hex view of a binary, inspector values, Markdown with links,
  images, code, tables, raw HTML, control characters; link menu shows real
  targets; file page side panel.

### Session 13 — Primitives, directives, tooltip, design system

- **Scope:** `components/base/*`, `components/icons/index.ts`,
  `src/directives/*`, `useTooltip.ts` (239), `usePanelWidth.ts`,
  `dialogs/ConfirmDialog.vue`, `src/assets/main.css`.
- **Focus:** these are used everywhere, so the bar is "boring". Does each
  directive do one thing? Does `Button.vue` enforce the 5 variants / 2
  heights by type? Does `main.css` contain only tokens and the few global
  classes the design system names?
- **Leads:** `useTooltip` has 9 `setTimeout`s (cold delay, warm window,
  hide grace, flash); check this is one clear timing model, not nine
  special cases. `copyToClipboard.ts` is 160 lines for a copy directive;
  why? `scrollIntoView` has nested ternaries and 3 `nextTick`s.
- **Tests:** none (DOM). Manual checks only; keep changes conservative.
- **Verify:** tooltips on hover, keyboard focus and touch; overflow tooltips
  only when truncated; copy feedback; focus trap in dialogs; SlidePane
  open/close; both themes.

### Session 14 — Dialogs, account, sharing, login, metrics

- **Scope:** `dialogs/ShareDialog.vue` (531) + `useShareDialog.ts` (254),
  `AccountDialog.vue` (365), `SettingsDialog.vue`, `useApiKeys.ts`,
  `views/LoginView.vue`, `MetricsView.vue`, `NotFoundView.vue`,
  `metrics/MetricCard.vue`, `charts/LineChart.vue` (281), `utils/chart.ts`,
  `base/UserAvatar.vue`.
- **Focus:** dialogs should share one skeleton (header, body, footer, modal
  stack, Escape). Is `ShareDialog` doing state management that belongs in
  `useShareDialog` (or the other way)? Is the chart code minimal for the one
  chart type it draws?
- **Tests:** none. `utils/chart.ts` is pure; add cases before changing it.
- **Verify:** share with user/group, change role, remove; create/revoke API
  key; settings persist across reload; login errors; metrics chart with
  0, 1 and many points.

### Session 15 — Cross-cutting pass and wrap-up

- Look for drift between sessions: the same problem solved two ways.
- Revisit the "later" lists and follow-ups; decide do / drop.
- Check the decisions from §8 are applied consistently across the codebase.
- Revisit the style guide's deferred decisions (§7.5 there): type-aware
  lint rules and Tailwind class sorting. Turn on `no-non-null-assertion`
  once the review has brought the count of `!` down.
- Update `AGENTS.md` with any new rules the review established (e.g. the
  singleton naming convention, the discriminated-union rule), so the next
  feature does not reintroduce what the review removed.
- Re-measure: file sizes over 300 lines, module-level state count, nested
  ternaries; compare with the snapshot in §9.

---

## 5. Findings format

The agent prepares findings in this shape, one block per item, ranked by
payoff (readability gained per line of risk):

```
### F3 · usePrompt.ts:18 · PromptResult flags → discriminated union
Kind:     clever | complex | unconventional | duplicated | misplaced | naming | dead | style
Payoff:   high | medium | low
Risk:     high | medium | low   (how much behaviour could change)
Now:      what the code does, 1–3 lines, with the line numbers
Simpler:  what it would look like, as a short code sketch
Why:      why the simpler version is better for a new reader
Keep if:  the reason it might be essential after all (or "none")
Decision: (filled in together) do | skip | later | not a problem: <why>
```

"Keep if" is required: it forces the agent to argue the other side before the
human has to.

---

## 6. Things found that are not simplicity

- **Bugs:** log them in the session log with steps to reproduce. Fix as a
  separate `Fix:` commit if small and the human agrees, else follow-up.
- **Performance / slow-connection regressions:** same.
- **Security (untrusted content):** always fix or escalate in the session;
  never defer silently.
- **Design-system violations:** note; batch them into session 13 or 15.

---

## 7. Session log

Append one entry per session.

```
## Session N — <area> — <date>
Branch:     review/NN-area
Commits:    <count>, <first>..<last>
Done:       F1, F3, F4, …
Skipped:    F2 (reason), …
Follow-ups: …
Bugs found: …
Rules for AGENTS.md: …
Time spent: …
```

---

## 8. Open questions to decide before or during session 0

These are the human's calls. They change what counts as a finding, so
decide them early and record the answers here.

1. **Singletons behind `use*` names.** 21 composables keep module-level
   state, so `useFoo()` returns shared state, not a fresh instance. Vue's
   convention reads `use*` as "per caller". Options: (a) keep, and require
   the header comment to say "module-scoped"; (b) rename shared ones (e.g.
   export plain functions and a `fooState`); (c) move shared state into
   Pinia stores. Recommendation: (a), plus exporting plain functions where
   there is no per-caller state (as `useWorkflow.ts` already does).
2. **The 300-line component limit.** Enforce it during this review (every
   file over it gets an extraction finding), or only for files touched?
   Recommendation: enforce for the five files over 600 lines; others as
   found.
3. **Tests.** *Decided 2026-11-01:* a first round of unit tests for pure
   logic comes before the review, as its own piece of work
   ([`test-plan.md`](test-plan.md)). The rest of the testing effort
   (components, API client, end-to-end) comes after. `AGENTS.md` §6 is
   updated to match.
4. **Discriminated unions over flag bags.** Adopt as a rule for the whole
   codebase? Recommendation: yes.
5. **Splitting `api/client.ts`.** One file per concern, or keep one file
   with clear sections? Decide in session 1 after reading it.
6. **Undo in workflows.** Is inverse-operation undo worth keeping if a
   snapshot approach is simpler? Decide in session 7; may change behaviour
   subtly (e.g. undo after a save).
7. **Doc comment density.** The codebase leans on long header comments. Is
   the bar "explain the why and the non-obvious rules" (current), and should
   comments that only restate the code be removed as part of the review?
   Recommendation: yes, remove restating comments; keep the why.
8. **Session cadence.** One session per day, or batch? High-risk sessions
   (1, 2, 4, 7, 10) benefit from a fresh head; avoid two in a row.

---

## 9. Baseline snapshot (for comparison in session 15)

Taken at `104b7fa`.

- Files over 300 lines: 21 (`.vue` and `.ts`). Over 600:
  `WorkflowGraph.vue` 1429, `FolderView.vue` 935, `FolderTable.vue` 836,
  `useWorkflow.ts` 791, `TextViewer.vue` 660, `TableViewer.vue` 611.
- Largest scripts in components: `WorkflowGraph` 836, `FolderView` 765,
  `TextViewer` 489, `TableViewer` 375, `HexViewer` 367, `FolderTable` 350.
- Composables with module-level mutable state: 21.
- Most-imported modules: `utils/format` (21), `useQueryCache` (21),
  `stores/items` (19), `stores/modals` (16), `useDelayedFlag` (13).
- `as unknown as`: 1 (`api/client.ts`). `eslint-disable`: 0. `v-html`: 0.
- Lines with nested ternaries: `FolderView` 4, `TableViewer` 3, others ≤ 2.

Regenerate with:

```sh
find src -name '*.ts' -o -name '*.vue' | xargs wc -l | sort -nr | head -25
grep -lE "^const [a-zA-Z]+ = (ref|shallowRef|reactive|new Map|new Set)" src/composables/*.ts | wc -l
grep -rEc '\? .* \? .* :' src | grep -v ':0$' | sort -t: -k2 -nr
```
