---
name: idea
description: >-
  Write down a new OpenRelik idea, privately in .private/<slug>/; start the work on a
  filed idea (its idea.md in the first PR); or drop it. Use for "new idea", "write
  down an idea", "file the idea", "start on the idea", "drop the idea", or /idea
  <title, slug, or issue number>.
---

# Idea

"Ideas", "The issue" and "Starting" in `dev/README.md`. An idea is short and says
what and why. Filed, it's an issue labeled `idea`, and the issue is the idea. When
the work starts, it moves into the repository as
`dev/artifacts/features/<slug>/idea.md`, and the issue becomes the plan. Only one of
them is the idea at a time.

Filing is cheap and meant to be: encourage it.

## Check where it stands

When given a title, slug, or issue number, check where the idea currently is in the
main checkout (from a worktree, the first path in `git worktree list`) and on GitHub:

1. **Started** (`dev/artifacts/features/<slug>/idea.md` exists on main or an open PR):
   tell the user where it stands (`gh issue view <issue>`) and which skill comes next
   (`design`, `spec`, `implement`), or help edit `idea.md` / drop the idea if asked.
2. **Filed in the backlog** (an open issue labeled `idea` matches):
   - If it has the `accepted` label and the user wants to start, go to **Start it**.
   - If it lacks `accepted`, tell the user a core developer adds `accepted` when the
     team agrees to build it, and help refine the issue or research/prototype it in the
     meantime.
3. **Local draft** (`.private/<slug>/idea.md` exists): refine it with the user, or go
   to **File it** when they're ready to publish it to the backlog.
4. **New**: go to **Write it down**.

## Write it down

When filing a new idea, always draft it first in `.private/<slug>/idea.md`. Never ask
the user whether to file it straight away or draft it privately.

1. **Draft in .private**: pick the slug from the title, lowercase `a-z`, `0-9` and
   `-`, at most 50 characters; check that neither `.private/<slug>/` nor
   `dev/artifacts/features/<slug>/` exists on main, and confirm the slug with the user.
   Then, in the main checkout, not a worktree (from a worktree, it's the first path
   in `git worktree list`):

   ```bash
   mkdir -p .private/<slug>
   cp dev/templates/idea.md .private/<slug>/
   ```

   Fill in the YAML frontmatter: `$slug`, `$title`, `$created` (today, `YYYY-MM-DD`),
   and `$by` (`<github username> (<github fullname>)` from `gh api user --jq '"\(.login) (\(.name))"'`);
   `$issue` stays empty until filed.
2. **Write it** with the user, from the conversation: `## Problem`, `## Proposal`,
   `## Users`, `## Open questions`, replacing the hint text. A few sentences each, no
   implementation details. Refine it with them for as long as they like.

## File it

Only when the user asks. Filing publishes the idea, so first read it as a teammate
without context would, and suggest what to fix. Check that no open idea is the same
(`gh issue list --label idea --search "<words>"`). Then, showing the user the title
and body before it's published, and after their go-ahead:

1. **Body**: the four sections from `dev/templates/idea.md` (`## Problem`,
   `## Proposal`, `## Users`, `## Open questions`), without the YAML frontmatter and
   without the `# <title>` heading. Follow the `humanize` standard
   (`.agents/skills/humanize/SKILL.md`): plain, direct prose without promotional fluff or
   AI buzzwords. If `.private/<slug>/research.md` or a prototype
   exists, end with a line saying so: "Research (and a prototype) exist locally. Ask
   @<user>."
2. **Issue**: ask whether the user claims it, for now or for later
   (`--assignee @me`):

   ```bash
   gh label create idea 2>/dev/null    # once, if the repository lacks the label
   gh issue create --label idea --assignee @me --title "<title>" --body-file <body>
   ```

3. **Acceptance**: filing doesn't need it. Tell the user a core developer accepts the
   idea (the `accepted` label) when the team agrees to build it, and that they ask
   on the issue when they want that. Never add the label.
4. **Local copy**: once the issue exists, update `$issue` in `.private/<slug>/idea.md`
   with the full GitHub issue URL (`https://github.com/openrelik/openrelik/issues/<number>`).
   Keep `.private/<slug>/idea.md` and `.private/<slug>/research.md` locally until the
   first PR (design or spec) commits them into `dev/artifacts/features/<slug>/`. For a prototype that has
   answered its question, suggest putting what it taught in the research and removing
   it (`./devctl worktree remove -f prototype/<slug>`).

Changes to a filed idea are edits to the issue's body (`gh issue edit <issue>
--body-file ...`), after the user's go-ahead; discussion goes in its comments.

## Start it

When the user decides to build an accepted idea. The first PR of the work commits the
idea, on that PR's branch: the `design` or `spec` skill does this when
its PR is the first.

1. **Inspect the issue**:

   ```bash
   gh issue view <issue> --json number,title,body,createdAt,labels,assignees
   ```

2. **Accepted**: the issue must have the `accepted` label. If it doesn't, stop, and
   tell the user to ask a core developer on the issue. Never add the label.
3. **Claim**: if the issue is assigned to someone else, stop: the user asks them on
   the issue first. If it's unassigned, assign the user (`gh issue edit <issue>
   --add-assignee @me`) after their go-ahead. Suggest they say on the issue that
   they're starting.
4. **Slug**: if a matching `.private/<slug>/` folder exists in the main checkout, use
   that `<slug>`; otherwise pick it as in "Write it down" and confirm with the user.
5. **idea.md**: on the first PR's branch, include
   `dev/artifacts/features/<slug>/idea.md` from `.private/<slug>/idea.md` (or write it
   from `dev/templates/idea.md` with the issue's body if the local draft was removed),
   with `$slug`, `$issue` (full GitHub URL, e.g. `https://github.com/openrelik/openrelik/issues/<number>`),
   `$created` (`createdAt` as `YYYY-MM-DD`), `$by` (`<github username> (<github fullname>)`),
   `$title`, and the issue's current body. Leave out the "exist locally" line if present.
   Delete `.private/<slug>/idea.md` once committed on the branch.
6. **Research**: if `.private/<slug>/research.md` exists in the main checkout, read it
   for what shouldn't be public (case details, customer names, internal links,
   evidence) and suggest fixes; then move it beside `idea.md`.
7. **Commit** with `Refs #<issue>`, with the rest of the first PR.
8. **Issue**: when the first PR is open, replace the issue's body with
   `dev/templates/issue.md` (the two-to-three sentence summary, the link to
   `dev/artifacts/features/<slug>/idea.md`, and the checklist with the PR's number on
   its step), after the user's go-ahead.

From then on, `idea.md` is the idea, changed in PRs like any document; discussion on
a PR is folded into it before it's merged.

## Drop it

Not started: close the issue as not planned, saying why, after the user's go-ahead
(`gh issue close <issue> --reason "not planned" --comment "<why>"`). Ask what to do
with research in `.private/<slug>/`: post it on the issue, keep it, or delete it.

Started: the record says what we didn't do and why. Add an `## Outcome` section at
the end of `idea.md`: "Dropped: <why>", with a link to the discussion. On the open
PR, commit it there; for an idea already on main, in a PR of its own on
`idea/<slug>` (`./devctl worktree create idea/<slug> --no-stack`). After it's merged,
close the issue as not planned, after the user's go-ahead.
