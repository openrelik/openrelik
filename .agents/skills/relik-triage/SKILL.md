---
name: relik-triage
description: >-
  Triage, clean up, and maintain OpenRelik GitHub issues and labels: verify issues
  against the codebase, standardize titles, assign type/area/effort/state labels,
  post actionable triage comments, flag resolved or stale issues, and keep the label
  taxonomy and UX color palette consistent. Use for "triage issues", "triage #123",
  "clean up the issue list", "assess effort", "audit labels", or /relik-triage
  [issue|bugs|ideas|refresh|labels].
---

# Triage

Keep the OpenRelik GitHub issue list clean, scannable, and grounded in the current
codebase. Every assessment checks real code and repository artifacts before proposing
changes, and every GitHub edit waits for the user's explicit go-ahead.

## Rules

- **Verify against the codebase first**: never assess effort, root cause, or status
  from an issue title alone. Read the relevant source files, check
  `dev/artifacts/features/` for existing designs or specs, and check open PRs
  (`gh pr list --state open`).
- **Always pause for go-ahead**: present proposed title rewrites, label changes,
  triage comments, or issue closures in a scannable table and wait for explicit
  approval before modifying anything on GitHub.
- **Never approve or merge**: never add the `accepted` label. Only a core developer
  approves ideas.
- **Follow the humanize standard** (`.agents/skills/relik-humanize/SKILL.md`): write plain,
  direct engineering prose with repo-relative file paths. No AI filler words, staged
  contrasts, bold-label spam, chat wrappers, or model/tool mentions.
- **Preserve history when cleaning labels**: before deleting or consolidating any
  label, migrate all matching open and closed issues and PRs (`--state all`) first.

## Modes

### 1. Triage issues (`/relik-triage`, `/relik-triage bugs`, `/relik-triage ideas`, `/relik-triage <number>`, `/relik-triage refresh`)

1. **Fetch current state**:

   ```bash
   gh issue list --state open --limit 200 --json number,title,labels,body,assignees,createdAt,updatedAt,comments,url
   gh pr list --state open --limit 100 --json number,title,headRefName,body,url
   ```

2. **Skip already-triaged issues** (unless targeting a specific `<number>` or running `refresh`, e.g., `/relik-triage refresh` or `/relik-triage bugs refresh`):
   - Treat an issue as already triaged when it has a comment containing `**Triage:`,
     has at least one `area:*` label plus either an `effort:*` label or `needs-info`,
     and has no comments posted after the latest `**Triage:` comment.
   - Skip those issues and report the count (for example, `Skipped 11 already-triaged issues`).
   - Re-include any issue with newer comments since its latest `**Triage:` comment
     (such as a reply on a `needs-info` issue).
3. **Verify each remaining issue against the codebase**:
   - Locate the affected files in `server/`, `web/runestone/`, `web/sunstone/`,
     `workers/`, `libs/`, `mcp/`, or `deploy/`.
   - Check `dev/artifacts/features/` for an existing `idea.md`, `design.md`, or
     `spec.md`, and check open PRs for work already in flight.
   - Determine whether the issue is still valid, partially fixed, already resolved on
     `main`, duplicate, or missing reproduction/clarification details.
4. **Propose updates** in a table grouped by effort (`effort: small`, `effort: medium`,
   `effort: large`, plus `needs-info` or close candidates):
   - Standardized title (if the current title does not match the convention below).
   - Labels to add or remove (Type, Area, Effort, and State where applicable).
   - Concise triage comment with codebase findings and concrete next steps.
   - Any issues recommended to close as resolved, obsolete, or duplicate (citing the
     commit, file, or PR).
5. **Apply after go-ahead**: update titles, labels, comments, and closures via `gh`.
   For bulk updates across many issues, run a temporary script rather than dozens of
   manual calls.

### 2. Audit labels (`/relik-triage labels`)

1. Run `gh label list --limit 100 --json name,color,description`.
2. Compare against the **Label Taxonomy & Palette** below and report drift:
   - Missing or blank descriptions.
   - Off-palette colors or color collisions between groups.
   - Sprawl or duplicate labels (for example `enhancement`, `feature request`,
     `worker: *`, or `area: libs/*`).
3. After go-ahead, migrate all open and closed issues/PRs off redundant labels, delete
   redundant labels, and sync colors and descriptions.

---

## Title Conventions

Keep every open issue title sentence-case, plain, and immediately scannable:

- No `bug:`, `Feat:`, `Feature request:`, or `Consider` prefixes.
- No trailing periods and no stray migrated issue numbers (such as `#12`).
- Name the affected component explicitly (`Server`, `Web UI`, `Worker-common`,
  `Python client`, `MCP server`, `Yara worker`, `Extraction worker`, etc.).
- **Bugs**: `<Component> <concrete broken behavior in present tense>`
  - *Example:* `Extraction worker reads wrong config key for full file path extraction`
  - *Example:* `Server ignores read-only mode on configured storage providers`
- **Ideas, docs, and chores**: `<Imperative verb> <what> [in <component>]`
  - *Example:* `Add password input type for task config fields in web UI`
  - *Example:* `Use streaming downloads in Python client`
  - *Example:* `Document NODENAME configuration for worker-common mount_utils`

---

## Triage Comment Format

Keep comments short, factual, and useful to whoever picks up the issue later:

```markdown
**Triage: <Quick fix | Small effort | Medium effort | Large effort | Needs reproduction | Needs clarification>**

<1-3 sentences stating what the current code does, citing exact repo-relative file paths
and any existing spec/PR/related issues.>

Next steps:
- <concrete, actionable step>
- <concrete, actionable step>
```

---

## Label Taxonomy & UX Color Palette

The color hierarchy makes **Type** and **State** pop first, **Effort** read as a soft
sequential ramp, and **Area**, **Resolution**, and **Automation** recede into calm
neutrals in both GitHub light and dark modes.

### Type (pick one — vivid, distinct hues)

| Label | Color | Description | When to use |
| --- | --- | --- | --- |
| `bug` | `#d73a4a` | Something isn't working | Wrong behavior or regression |
| `idea` | `#8250df` | Feature request or proposed idea in the backlog | All feature requests and proposed ideas (single unified backlog; do not re-introduce `enhancement` or `feature request`) |
| `documentation` | `#0e7490` | Improvements or additions to documentation | Docs-only tasks |

### Area (pick all that apply — quiet dark slate)

All area labels use `#57606a`. Do not add per-worker (`worker: *`) or per-library
(`area: libs/*`) labels; put the specific worker or library name in the issue title.

| Label | Color | Description |
| --- | --- | --- |
| `area: server` | `#57606a` | API server, mediator, metrics, and migrations |
| `area: web` | `#57606a` | Web UI (runestone and sunstone) |
| `area: workers` | `#57606a` | Task workers under workers/ |
| `area: libs` | `#57606a` | Shared libraries under libs/ |
| `area: mcp` | `#57606a` | MCP server |
| `area: deploy` | `#57606a` | Production deployment and infrastructure |

### Effort (pick one once clear — soft pastel ramp: green → amber → orange)

Leave effort unset when an issue has `needs-info` and cannot be scoped yet.

| Label | Color | Description | Guidance |
| --- | --- | --- | --- |
| `effort: small` | `#a7f3d0` | Self-contained change, quick to implement and test | Clear root cause or small localized change, typically 1 component, straightforward tests |
| `effort: medium` | `#fde68a` | Moderate scope, cross-component work, or external validation needed | Spans backend + UI, needs a UX/scoping call, or requires external setup to verify |
| `effort: large` | `#fdba74` | Architectural or design-level work | Needs a design or ADR, touches core models/workflows, adds a major new worker, or hits upstream limits |

### State & Action (semantic signals)

| Label | Color | Description | Notes |
| --- | --- | --- | --- |
| `accepted` | `#2da44e` | Idea approved by a core developer to build | Human gate — **never added by agents** |
| `blocked` | `#b60205` | Blocked on a design decision, dependency, or upstream issue | Use for external/architectural blockers, not missing reporter details |
| `needs-info` | `#d4a72c` | Needs clarification or reproduction steps before work can start | Prefer over `blocked` when waiting on reporter details or repro |
| `reviewed` | `#1a7f37` | Passed clean-context review; critical findings addressed | Applied to PRs by the `relik-review` skill |
| `good first issue` | `#7057ff` | Good for newcomers | Kept available; only apply when explicitly requested |
| `help wanted` | `#008672` | Extra attention is needed | Optional contributor signal |
| `question` | `#bf3989` | Further information is requested | General support/questions |

### Resolution & PR Automation (low-salience neutrals)

| Label | Color | Description |
| --- | --- | --- |
| `duplicate` | `#d0d7de` | This issue or pull request already exists |
| `invalid` | `#afb8c1` | This doesn't seem right |
| `wontfix` | `#8b949e` | This will not be worked on |
| `dependencies` | `#4b6b8a` | Pull requests that update a dependency file |
| `python:uv` | `#4b6b8a` | Pull requests that update python:uv code |
| `javascript` | `#4b6b8a` | Pull requests that update javascript code |
