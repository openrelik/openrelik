# Development process

This is how an idea turns into merged code. Developers make the decisions, and agents
help with the rest: research, prototypes, documents, code and review. We keep the
process as light as each change allows, so an idea is just an issue, a bugfix is an
issue and a PR, and only big changes get a design.

Filing an idea is cheap, so file what you think of. It's an issue in the backlog and
nothing more. A core developer accepts it when the team agrees it's worth building,
and the process starts when someone decides to build it. From then on every artifact
(the idea, the research, the ADRs, the design, the spec) is a file in
`dev/artifacts/`, kept for good, so the record survives a move away from GitHub.
GitHub holds the backlog, the conversation and the planning, with one issue per idea,
and the PRs. A bugfix leaves no artifact. Its record is its regression test and its
commit message.

You can do every step with an agent or without one, and each step's section below
shows both ways:

- **By hand**: plain `git` and `gh`, `./devctl worktree` for branches and their
  stacks, and the templates in `dev/templates/` (fill in the `$title`, `$slug`, ...
  placeholders and replace the hint text).
- **With the skill**: the step's agent skill, in `.agents/skills/<name>/SKILL.md`, for
  any agent that reads skills. Ask for it by name (`/spec bulk-tags`) or in your own
  words ("write the spec for #123"). It runs the same steps you would by hand. It
  stops at a gate that hasn't been passed, and it asks before it publishes anything,
  whether that's a push, a PR, an issue or a comment.

Three things have no skill. Accepting an idea, approving a PR and merging it are
decisions people make.

This is a working document. We're still figuring the process out.

## Overview

The whole process at a glance. The sections below have the details.

```text
  PRIVATE (your machine, gitignored)
  ┌──────────────────────────────────────────────────────────────────┐
  │  .private/<slug>/idea.md       draft             [idea]          │
  │  .private/<slug>/research.md   research          [research]      │
  │  prototype/<slug> worktree     try it            (unpushed)      │
  └────────────────────────────────┬─────────────────────────────────┘
                                   │ file it  [idea]
                                   │ (local idea.md deleted; research stays local)
                                   ▼
  BACKLOG (GitHub)
  ┌──────────────────────────────────────────────────────────────────┐
  │  issue, label: idea            the issue is the idea             │
  │         assignee: you?         claim it, for now or for later    │
  │                                                                  │
  │  optional: prototype draft PR, label: prototype, Refs #issue     │
  │            never merged; it can help make the case               │
  └────────────────┬─────────────────────────────────┬───────────────┘
                   │                                 │ not wanted
   ╔═══════════════▼════════════════╗                ▼
   ║ GATE: a core developer adds    ║       closed as not planned
   ║ the accepted label             ║       (no record in the repo)
   ╚═══════════════╤════════════════╝
                   │ START: claim it, say so on the issue; the first PR
                   │ commits idea.md and research.md; the issue body
                   │ becomes the plan (summary, link, checklist)
                   ▼
  THE WORK, in dev/artifacts/features/<slug>/, a PR per artifact

   Small feature       Clear scope              Big, user-facing, data model, API
   ─────────────       ───────────              ─────────────────────────────────
                                                design/<slug>  [design] [adr]
                                                idea, design.md, its ADRs
                                                ╔══════════════════════════════╗
                                                ║ GATE: a core developer       ║
                                                ║ approves                     ║
                                                ╚══════════════╤═══════════════╝
                                                               │ merged
                                                               ▼
                       spec/<slug>  [spec]      spec/<slug>  [spec]
                       idea, spec.md            spec.md
                       ╔════════════════╗       ╔════════════════╗
                       ║ GATE: approved ║       ║ GATE: approved ║
                       ╚═══════╤════════╝       ╚═══════╤════════╝
                               └───────────┬────────────┘
                                           │ approved (stack on it) or merged
                                           ▼
   code/<slug>                 code/<slug>  [implement]
   [implement]                 task by task, ticking T1, T2, ... in spec.md;
   idea and spec in            the spec changes in the PR where the code differs;
   the first commit,           a change users see goes back to the team first;
   then the code               a lasting decision needs its ADR first
         │                                 │
         └─────────────────┬───────────────┘
                           ▼
              [review]        private, in .private/<slug>/, in rounds
                              until no Must fix and no Should fix findings
                           │
                           ▼
              code PR, "Closes #issue", with the review's summary
                           │
   ╔═══════════════════════▼════════════════════════╗
   ║ GATE: a human approves the PR: a teammate, or  ║
   ║ the author, if the team has agreed to that     ║
   ╚═══════════════════════╤════════════════════════╝
                           ▼
              MERGE, by you, the implementer (never an agent);
              it closes the issue, and the ticked spec on main is built


  SIDE PATHS

  Bugfix, refactor   issue → code/<slug> [implement]: a failing regression test
                     first, the smallest fix, a commit message with the symptom,
                     the cause, and the fix → [review] → PR "Closes #issue"
                     → GATE: a human approves → merge. No spec and no artifact:
                     the record is the test and the commit. Needs a design, or
                     users would notice it? It's an idea.

  Standalone ADR     a plain issue (no idea label, no acceptance)
                     → adr/<slug> [adr] → dev/artifacts/decisions/NNNN-<slug>.md
                     ╔══════════════════════════════╗
                     ║ GATE: a core developer       ║
                     ║ approves                     ║
                     ╚══════════════════════════════╝  → merged, closes the issue

  Dropped, started   an ## Outcome section in idea.md (on the open PR, or on
                     idea/<slug>) → the issue is closed as not planned


  [name]  the agent skill for the step
  ╔═══╗   a human decision, which agents never make
```

## How much process

Filing an idea is an issue and nothing else. Once the work starts, each artifact gets
a PR of its own, reviewed and merged before the next one starts, and the first of them
also commits the idea (see "Starting").

| Change                                               | PRs                                   |
| ---------------------------------------------------- | ------------------------------------- |
| Bugfix, refactor, small tweak                        | code (from an issue)                  |
| Small feature                                        | spec and code in one PR               |
| Feature with a clear scope                           | spec, code                            |
| Big or user-facing feature, data model or API change | design (with its ADRs), spec, code    |
| A decision on its own                                | ADR                                   |

A bugfix makes wrong behaviour right. A refactor changes no behaviour, so the tests
pass before and after. A small tweak is a change no user would notice, like a typo, a
log message or a dependency bump. Anything users would notice is an idea, however
small. None of the three needs a spec or an accepted idea. The issue says what's
wrong, and the code PR is the gate, approved like every code PR (see "Final review and
merge").

Unsure? Write the spec. A reviewer who thinks it needs a design will say so. Research
and a prototype are optional in every row.

## Workflow

1. **Draft** (optional). Write the idea down privately in `.private/<slug>/idea.md`,
   from the `idea.md` template, and refine it with agents. It's gitignored, so nobody
   sees it until you file it.
2. **Research and prototype** (optional, before filing or after). Explore it with
   agents in `.private/<slug>/research.md`, and try it in throwaway code in a worktree
   of its own (see "Research" and "Prototypes").
3. **File it**. Open an issue labeled `idea` whose body is the idea. There's no
   branch, no PR and no review, and it's in the backlog. Assign yourself to claim it,
   for now or for later.
4. **Accept**. A core developer labels it `accepted` when the team agrees it's worth
   building. Ask on the issue (see "Accepting an idea").
5. **Start**. Whoever decides to build an accepted idea claims it, says so on the
   issue, and commits the idea as `idea.md` in the first PR of the work (see
   "Starting").
6. **Design** (big changes). Write `design.md`, with an ADR for each decision that
   outlasts the feature, in a design PR a core developer approves.
7. **Spec**. Write `spec.md`, the requirements and the tasks that implement them, in a
   spec PR that's reviewed, approved and merged.
8. **Implement**. Agents implement the spec task by task, with you, on `code/<slug>`.
9. **Review**. Before the PR, you and a fresh agent review the change locally and
   fix what it finds, until it's ready. The PR description summarizes the review.
10. **Approval and merge**. A human approves the PR (a teammate, or the author if agreed).
    You, the implementer, merge it once it's approved, and that closes the issue.

## The issue

Each idea gets one issue, labeled `idea`, from filing to merge. Until the work starts
the issue is the idea. Its body is the idea's text (the sections of the `idea.md`
template, without its frontmatter). You edit it on the issue as the idea changes, and
discuss it in the comments.

```bash
gh label create idea 2>/dev/null    # once, if the repository lacks the label
gh issue create --label idea --assignee @me --title "Bulk tags" --body-file body.md
#   body.md: the idea's sections, without the frontmatter and the title
```

`gh issue list --label idea` is the backlog. An idea's issue without the `accepted`
label hasn't been agreed on. One without a checklist hasn't started. One with a
checklist has, and the checklist says where it stands.

When the work starts, the idea moves into the repository (see "Starting") and the
issue becomes the plan. Its body is replaced by a few lines of summary, a link to
`dev/artifacts/features/<slug>/idea.md`, and a checklist of the steps (the `issue.md`
template), ticked and given its PR numbers as the work moves on. The original text
stays in `idea.md` and in the issue's history. Only one of them is the idea at a time.
It's the issue before the start, and `idea.md` after, changed in PRs like any other
document.

Every branch, commit and PR refers to the issue with `Refs #123`, and the code PR with
`Closes #123`.

### Accepting an idea

Work on an idea starts only once a core developer has added the `accepted` label,
which says the team agrees it's worth building. The label approves the reason for the
change. How it's built gets reviewed in the design and the spec. Every idea needs it,
small ones too. To get an idea accepted, ask on its issue. A prototype can help make
the case, so link its draft PR on the issue (see "Prototypes"). An idea the team
doesn't want is closed as not planned, with a comment saying why.

```bash
gh label create accepted 2>/dev/null                   # once
gh issue edit 123 --add-label accepted                 # a core developer
gh issue list --label idea --label accepted            # ready to start
gh issue list --label idea --search "-label:accepted"  # not decided yet
```

It's a soft gate. Nothing blocks a PR without it, but reviewers ask for it and agents
won't start the work without it. Agents never add the label, because adding it is an
approval.

### Owning an idea

Assign yourself to claim an idea, to work on now or later, accepted or not. You start
on it once it's accepted. An unassigned idea is anyone's to pick up. If you want one
that's assigned, ask its assignee on the issue first. They can hand it over or share
it, since an issue can have several assignees. Interest without a claim is a reaction
or a subscription.

Claims go stale. If an assigned idea hasn't moved in six months (not started, or its
checklist unchanged), anyone can ask on the issue, and unassign it if nobody answers.
Before you give up a claim, publish what only you have, such as research in
`.private/`, in a comment on the issue.

## Ideas

An idea says what and why in a few sentences, for a teammate without context. File it
straight away, or draft it privately first if you want to research it or try it.

`.private/` lives in the main checkout and is gitignored, so every worktree you start
from there can read it and nobody else can. Filing publishes the idea. The issue's
title is its title, and its body is the idea's sections without the frontmatter. Then
delete the local `idea.md`. The issue is the idea now, and two copies would drift
apart. Research stays in `.private/<slug>/` until the work starts. Say on the issue
that it exists ("Research and a prototype exist locally. Ask @you.") so whoever picks
up the idea knows to ask. Once a prototype has answered its question, put what it
taught in the research and remove it. One worth showing gets pushed (see
"Prototypes").

**By hand**, from the main checkout:

```bash
mkdir -p .private/bulk-tags                    # the draft, if you want one
cp dev/templates/idea.md .private/bulk-tags/
#   fill in $slug, $title and $created; write Problem, Proposal, Users, Open questions
gh issue list --label idea --search "tags"     # filed already?
gh issue create --label idea --assignee @me --title "Bulk tags" --body-file body.md
#   body.md: the idea's sections, without the frontmatter and the title
rm .private/bulk-tags/idea.md                  # the issue is the idea now
```

**With the skill** (`idea`): `/idea Bulk tags`, or "write down an idea: ...". It asks
whether to file now or draft first, then writes the idea with you. Before filing, it
reads the idea the way a teammate without context would and checks the backlog for
duplicates. It files only after your go-ahead, and never adds the `accepted` label.

An idea that isn't worth doing is closed as not planned, with a comment saying why. If
the work has already started, you drop it in the repository instead. An `## Outcome`
section at the end of `idea.md` says it was dropped and why, either in the open PR or
in a PR of its own on `idea/<slug>`. That way the record keeps what we chose not to
do, and the reason.

**By hand**: `gh issue close 123 --reason "not planned" --comment "<why>"`. Once the
work has started, write the `## Outcome` section first ("Dropped: <why>", with a link
to the discussion), and close the issue after its PR is merged.

**With the skill** (`idea`): "drop the idea #123". It also asks what to do with the
research in `.private/<slug>/`, whether to post it on the issue, keep it, or delete
it.

## Research

`research.md` is everything you found along the way, in whatever shape, starting from
the `research.md` template. It sits in `.private/<slug>/` while you work, before
filing or after. The first PR of the work commits it beside `idea.md` so that PR's
reviewers can read it (see "Starting"), and later PRs add to it. Nobody reviews it. It
isn't a step on the issue's checklist either.

Because it's raw notes, read it before it goes public and take out what shouldn't be
there, such as case details, customer names and internal links. Describe evidence.
Don't include it or point to it.

**By hand**, from the main checkout:

```bash
cp dev/templates/research.md .private/bulk-tags/
#   fill in $slug, $title and $created; write what you wanted to know, what you
#   found (files, links, versions), how sure you are, and the open questions
```

**With the skill** (`research`): `/research bulk-tags`, or "research this idea". It
asks what you most want to know, then works the way a developer who has done forensic
casework would. It looks at how OpenRelik handles the problem today, down to files and
functions, and at how other tools do it, from their docs and code. Then it goes
through the forensic questions that apply, from evidence integrity and provenance to
timestamps, scale and sensitive data. Findings go into `.private/<slug>/research.md`
as it works, and it reports back the few that change the idea. It won't edit the idea
unless you ask, and it writes no code and publishes nothing.

## Prototypes

A prototype answers a question ("does a tag column in the file list work?") with
throwaway code. It's never merged and needs no document. What it teaches goes into the
research, and from there into the design or the spec. A prototype isn't the work
itself. It needs no acceptance, and it can help an idea get accepted.

It's a stacked worktree with its own stack. Create it `--from` the branch it explores,
so it starts from that branch's documents and code. When that branch is merged and
removed, the prototype moves onto main. With no such branch, create it from main.

```bash
./devctl worktree create prototype/bulk-tags --from design/bulk-tags   # or --from code/bulk-tags
./devctl worktree create prototype/bulk-tags                           # from main
```

To show it to the team, push it and open a draft PR labeled `prototype`, with a few
lines on what it's for and how to try it. File the idea first so the PR can refer to
its issue. The issue holds the idea and the decision, and the PR only shows it.

```bash
git -C .worktrees/prototype-bulk-tags push -u origin prototype/bulk-tags
gh pr create --draft --label prototype --head prototype/bulk-tags \
  --title "Prototype: Bulk tags (not for merging)" --body "Refs #123. To try it: ..."
```

Teammates run `./devctl worktree create prototype/bulk-tags`, which checks out the
author's branch in a worktree of its own and starts its stack, with its own database.
To update it, run `git fetch && git reset --hard origin/prototype/bulk-tags` in the
worktree. Feedback goes on the PR. When it has answered its question, `./devctl
worktree remove -f -r prototype/bulk-tags` removes it and closes its PR too.

Prototypes have no skill. Do it by hand as above, and ask an agent in plain words to
write the throwaway code in the worktree. The `research` skill suggests a prototype
when it hits a question only trying can answer.

## Starting

The process starts when someone decides to build an idea. Filing it doesn't count. The
idea has to be accepted (see "Accepting an idea"). Claim it (see "Owning an idea") and
say on the issue that you're starting, so others know.

The first PR of the work commits the idea, whether that PR is the design, the spec or
a small feature's code. It adds `dev/artifacts/features/<slug>/idea.md`, from the
`idea.md` template with the issue's current text, and the research beside it if there
is any. Its reviewers approve the why along with the what. Once it's open, replace the
issue's body with the `issue.md` template.

**By hand**:

```bash
gh issue edit 123 --add-assignee @me                  # claim it, if it's unassigned
./devctl worktree create spec/bulk-tags --no-stack    # or design/..., or code/...
mkdir -p .worktrees/spec-bulk-tags/dev/artifacts/features/bulk-tags
#   write idea.md there from the issue's text (gh issue view 123)
#   and move .private/bulk-tags/research.md beside it, if it exists
#   commit with "Refs #123", push, gh pr create
gh issue edit 123 --body-file issue.md
```

**With the skill** (`idea`): "start on #123". You'll rarely need it on its own, since
the `design`, `spec` and `implement` skills do this when their PR comes first. It
checks that the idea is accepted and not someone else's, and screens the research for
anything that shouldn't be public before moving it into the repository.

## Designs and ADRs

A design is for a change that's expensive to get wrong because it's big, user-facing,
or touches the data model or the API. It says what changes for users, roughly how, and
what else was considered. A core developer approves it, and it's merged before anyone
writes the spec. When it's the first PR of the work, it also commits the idea (see
"Starting").

A design belongs to its feature, in the feature's folder. If several features build on
it, it goes in `dev/artifacts/designs/<slug>/` and the features link to it.

**By hand**:

```bash
./devctl worktree create design/bulk-tags --no-stack
#   cp dev/templates/design.md to dev/artifacts/features/bulk-tags/design.md
#   fill in $slug, $title and $issue; screenshots/ beside it, synthetic data only
#   commit with "Refs #123", push, gh pr create; a core developer approves it
./devctl worktree remove design/bulk-tags          # after the PR is merged
```

**With the skill** (`design`): `/design bulk-tags`, or `/design 123`. It tells you if
the change doesn't need a design at all. Before writing, it reads the research, the
prototype and the code of each component the change touches, and it hands each
decision that outlasts the feature to the `adr` skill. Once you've read the design and
given the go-ahead, it opens the PR and adds the number to the issue's checklist.

Some decisions outlast the feature and constrain other work, like how the API is
versioned or how workers are packaged. Those also get written down on their own, as an
architecture decision record (ADR) from the `adr.md` template, in
`dev/artifacts/decisions/<number>-<slug>.md`. ADRs are numbered in order (`0001-...`)
and give the context, the decision and its consequences. An ADR that comes out of a
design goes in the design PR. A decision with no design gets a PR of its own, on
`adr/<slug>`. Both are approved the same way a design is. Nobody rewrites an ADR. A
later one that changes the decision marks the old one `superseded by <number>`. Most
features have none.

A decision on its own gets an issue for the discussion, a plain one without the `idea`
label. It needs no acceptance, because a core developer approving its PR is the
decision. Sometimes, while writing a spec or the code, you hit a decision that other
work will depend on. Its ADR goes on `adr/<slug>` first, and the spec or the code that
depends on it waits until it's merged. A decision that only affects this feature
belongs in its design or spec instead.

**By hand**:

```bash
git fetch && git ls-tree --name-only origin/main dev/artifacts/decisions/  # the next
gh pr list --search "head:adr/"; gh pr list --search "head:design/"   # number taken?
./devctl worktree create adr/api-versioning --no-stack   # or on design/<slug>
#   cp dev/templates/adr.md to dev/artifacts/decisions/0004-api-versioning.md
#   fill in $number, $title and $created
#   write Context, Decision ("We will ..."), and Consequences
#   superseding one: set its status: to "superseded by 0004", nothing else
#   commit with "Refs #123", push
gh pr create --head adr/api-versioning --title "ADR: API versioning" \
  --body "Closes #123"
```

If two open PRs take the same number, the one merged second renumbers.

**With the skill** (`adr`): `/adr API versioning`, or "record this decision". If the
decision belongs in a design or a spec, it says so. For one on its own, it finds the
decision's issue (or opens one, with your go-ahead) and picks the next free number.

## Specs

The spec says what will be built. Its requirements are numbered (`R1`, `R2`, ...) and
testable, and its tasks are a checklist (`T1`, `T2`, ...). It's reviewed and approved
in a PR of its own, and merged before the code. As the first PR of the work, it also
commits the idea (see "Starting").

On main, a spec with unticked tasks hasn't been built yet.

**By hand**:

```bash
./devctl worktree create spec/bulk-tags --no-stack
#   cp dev/templates/spec.md to dev/artifacts/features/bulk-tags/spec.md
#   fill in $slug, $title and $issue; Requirements, Tasks, Tests, Rollout
#   commit with "Refs #123", push
gh pr create --title "Spec: Bulk tags" --body "Refs #123"
./devctl worktree remove spec/bulk-tags            # after the PR is merged
```

**With the skill** (`spec`): `/spec bulk-tags`, or `/spec 123`. Before writing, it
checks that the idea is accepted and not someone else's, and that the design and the
ADRs the spec depends on are merged. For a small feature, it asks whether the spec
should go with the code on `code/<slug>` instead. It reads the code each task will
change, so the tasks are real, and opens the PR after your go-ahead.

## Code

```bash
./devctl worktree create code/bulk-tags
#   implement the spec task by task, ticking its tasks in spec.md
#   then review (see "Review"), and open the PR
```

To start before the spec PR is merged but after it's approved, stack the code on it
with `./devctl worktree create code/bulk-tags --from spec/bulk-tags`. Implementing
sometimes teaches you something the spec didn't know. When it does, change the spec in
the code PR, so main's spec matches main's code. If the change is to what users see,
take it back to the team on the PR first.

A small feature puts the spec and the code in one PR on `code/<slug>`, with the idea
and the spec in its first commit. A bugfix or a refactor has no spec. Run `./devctl
worktree create code/<slug>`, fix it, review it, and open the PR with `Closes
#<issue>`.

A bugfix leaves nothing in `dev/artifacts/`. Its record lives in the code and in git,
as a regression test that fails before the fix and passes after, plus a commit message
giving the symptom, the cause and the fix. If a bug turns out to need a design or a
spec, it becomes an idea and goes through the steps like a feature.

**By hand**: as above. For a bugfix:

```bash
./devctl worktree create code/fix-tag-filter
#   a regression test that fails, then the smallest fix that makes it pass
#   the checks of each component it touches (their AGENTS.md)
git commit    # the symptom, the cause, and the fix, and "Refs #123"
```

**With the skill** (`implement`): `/implement bulk-tags` for a feature, or `/implement
123` ("fix issue 123") for a bugfix or a refactor. A feature it builds task by task,
ticking and committing each one. It stops to ask if the spec turns out wrong in a way
users would see, or in a way that needs an ADR. A bug it reproduces with a failing
test before it touches the fix. It pushes nothing, and the review comes next.

## Review

Review the change yourself, with an agent, before opening the PR, so it is ready
for human review. It's private. Nothing gets posted, and nothing of it is committed.

1. **Checks**. Run the tests and formatters of each component the change touches (see
   their `AGENTS.md`), and run the stack with the change for what the tests don't
   cover.
2. **Review in clean context**. The review pass must always run in a subagent with a
   completely clean context (or a fresh session), without the conversation history of the
   implementation. The agent that wrote the code would check its intentions instead of
   the diff. The subagent receives only the review rubric from
   `.agents/skills/review/SKILL.md`, the spec or issue, and the diff.
3. **Fix or dismiss** each finding. A dismissed finding gets its reason written down,
   so the next round doesn't raise it again. Then review again, and keep going until a
   round finds no Must fix and no Should fix findings.
4. **Ready**. The spec's tasks are ticked and the spec matches the code. The branch is
   rebased on main (`./devctl worktree sync`). The commits say what and why with `Refs
   #<issue>`, and a bugfix has its regression test and its commit message. Nothing is
   left over, such as debug output, commented-out code, or TODOs without an issue.

The rounds go in `.private/<slug>/review.md` in the main checkout, which is gitignored
and outlives the worktree. Then open the PR, ready for review, with its description from
the `pr.md` template. It says what the change does and why, and sums up the review in
plain English, covering the critical findings (Must fix and Should fix) and how each was
fixed, or why it was left.

**By hand**, in the change's worktree:

```bash
#   run the checks of each component the change touches
git diff main > ../../.private/bulk-tags/diff.patch
#   run the review following .agents/skills/review/SKILL.md against the spec or issue;
#   give it to a fresh agent session, ideally another model, with dismissed findings
#   record the round in .private/bulk-tags/review.md; fix or dismiss each finding
#   again, until a round has no Must fix and no Should fix findings
./devctl worktree sync                         # rebase on main, then the checks again
#   write .private/bulk-tags/pr.md from dev/templates/pr.md
git push -u origin code/bulk-tags
gh pr create --title "Bulk tags" --body-file ../../.private/bulk-tags/pr.md
```

**With the skill** (`review`): `/review` in the change's worktree. The skill always
launches a subagent with a clean context to perform the review (or tells you to run in
a fresh session if subagents are unsupported). It records every round, coordinates fixes
with you, and ensures the change isn't called ready while a Must fix or Should fix
finding is open. Last comes a draft of `.private/<slug>/pr.md`. Pushing and opening the
PR wait for your go-ahead.

## Approval and merge

Every code PR needs a human's approval before it's merged, with or without a spec. For
a bugfix, a refactor or a small tweak, that's the only gate. The approval is a teammate's
review on the PR or, if the team has agreed to it, the author's own ("Approved after
review"). Branch rules can require a review only if the team doesn't allow that.

Anyone (teammate or author) can run `/review <PR number>` at any time to have an agent
audit an open PR against its spec or issue.

The implementer merges once the PR is approved. Agents never approve or merge.

## Where things live

- Issues labeled `idea`: the backlog, one per idea, also labeled `accepted` once the
  team agrees to build it. Each is the idea itself until the work starts, then the
  plan and its checklist.
- `.private/<slug>/`: local and private, in the main checkout, kept until you delete
  it. It holds the idea's draft before it's filed (`idea.md`), research before the
  work starts (`research.md`), the review rounds (`review.md`), and the PR
  description's draft (`pr.md`).
- `.dev-local/`: per checkout, `./devctl`'s config and data for its stack. It holds no
  documents, so it's safe to reset.
- Draft PRs labeled `prototype`: prototypes, never merged.
- `dev/artifacts/features/<slug>/`: `idea.md`, `research.md`, `design.md` (if any),
  `spec.md`, and `screenshots/`, each reaching main with its PR.
- `dev/artifacts/designs/<slug>/`: designs that several features build on.
- `dev/artifacts/decisions/`: architecture decision records.

A feature's folder is the record of one piece of work, from the start to the merge.
Once its code is merged, it changes only to fix mistakes. Changing the feature later
is a new idea, and that idea's `idea.md` links to the earlier folder when it starts.

Files track no status beyond what they say for themselves. An idea with an outcome was
dropped, and a spec with ticked tasks is built. Where the work stands lives on the
issue, in its `accepted` label, its assignee and its checklist.

## Branches

| Branch             | Holds                                              | Merged        |
| ------------------ | -------------------------------------------------- | ------------- |
| `idea/<slug>`      | `idea.md` changes after the start, or its outcome  | when approved |
| `prototype/<slug>` | throwaway code                                     | never         |
| `design/<slug>`    | `design.md`, its ADRs, and the research            | when approved |
| `adr/<slug>`       | `dev/artifacts/decisions/<number>-<slug>.md`       | when approved |
| `spec/<slug>`      | `spec.md`, and the research                        | when approved |
| `code/<slug>`      | the code, or the spec and the code, or a fix       | when reviewed |

Each branch is a worktree with its own stack, made from the main checkout with
`./devctl worktree create` and the full branch name. `code/<slug>` lives in
`.worktrees/<slug>/`. Other branches get their `/` replaced, so `spec/<slug>` lives in
`.worktrees/spec-<slug>/`. Branches for documents need no stack, so pass `--no-stack`.

## Conventions

- Issues, PRs, reviews, comments and commits don't name the model, provider or tool
  that helped write them.
- Slug: lowercase `a-z`, `0-9` and `-`, at most 50 characters, from the title, chosen
  when the idea is drafted or started. Each idea has one slug, for its files, its
  folder and its branches.
- Every code PR is approved by a human before it's merged (see "Final review and
  merge").
- Agents don't merge, and don't start a step whose input isn't approved. The design
  and the spec need the idea accepted, and the spec also needs the design merged, if
  there is one. The spec and the code need the ADRs they depend on merged, and the
  code needs the spec. Agents don't start work on an idea that's assigned to someone
  else, and never add the `accepted` label. A prototype needs no acceptance.
- `status.md` in the repository root is a personal "what did I do last night" note.
  It's gitignored.
