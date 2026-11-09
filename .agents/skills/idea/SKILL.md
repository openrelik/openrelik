---
name: idea
description: Write down a new OpenRelik idea, privately in .private/<slug>/ or straight into the backlog as an issue; start the work on a filed idea (its idea.md in the first PR); or drop it. Use for "new idea", "write down an idea", "file the idea", "start on the idea", "drop the idea", or /idea <title>.
---

# Idea

"Ideas", "The issue" and "Starting" in `dev/process.md`. An idea is short and says
what and why. Filed, it's an issue labeled `idea`, and the issue is the idea. When
the work starts, it moves into the repository as
`dev/artifacts/features/<slug>/idea.md`, and the issue becomes the plan. Only one of
them is the idea at a time.

Filing is cheap and meant to be: encourage it.

## Write it down

1. **Where**: ask the user whether to file it straight away, or draft it privately
   first, to research it or try it in a prototype.
2. **Draft** (if private): pick the slug from the title, lowercase `a-z`, `0-9` and
   `-`, at most 50 characters; check that neither `.private/<slug>/` nor
   `dev/artifacts/features/<slug>/` exists on main, and confirm it with the user.
   Then, in the main checkout, not a worktree (from a worktree, it's the first path
   in `git worktree list`):

   ```bash
   mkdir -p .private/<slug>
   cp dev/templates/idea.md .private/<slug>/
   ```

   Fill in `$slug`, `$title`, and `$created` (today, `YYYY-MM-DD`); `$issue` stays
   until the work starts.
3. **Write it** with the user, from the conversation: Problem, Proposal, Users, Open
   questions, replacing the hint text. A few sentences each, no implementation
   details. Refine it with them for as long as they like.

## File it

Only when the user asks. Filing publishes the idea, so first read it as a teammate
without context would, and suggest what to fix. Check that no open idea is the same
(`gh issue list --label idea --search "<words>"`). Then, showing the user the title
and body before it's published, and after their go-ahead:

1. **Body**: the idea's sections (Problem, Proposal, Users, Open questions), from the
   draft or the `dev/templates/idea.md` sections, without the frontmatter and the
   title. If `.private/<slug>/research.md` or a prototype exists, end with a line
   saying so: "Research (and a prototype) exist locally. Ask @<user>."
2. **Issue**: ask whether the user claims it, for now or for later
   (`--assignee @me`):

   ```bash
   gh label create idea 2>/dev/null    # once, if the repository lacks the label
   gh issue create --label idea --assignee @me --title "<title>" --body-file <body>
   ```

3. **Acceptance**: filing doesn't need it. Tell the user a core developer accepts the
   idea (the `accepted` label) when the team agrees to build it, and that they ask
   on the issue when they want that. Never add the label.
4. **Local copy**: once the issue exists, delete `.private/<slug>/idea.md`; the issue
   is the idea now. Research stays in `.private/<slug>/` until the work starts. For a
   prototype that has answered its question, suggest putting what it taught in the
   research and removing it (`./devctl worktree remove -f prototype/<slug>`).

Changes to a filed idea are edits to the issue's body (`gh issue edit <issue>
--body-file ...`), after the user's go-ahead; discussion goes in its comments.

## Start it

When the user decides to build an accepted idea. The first PR of the work commits the
idea, on that PR's branch: the `design`, `spec` or `implement` skill does this when
its PR is the first.

1. **Accepted**: the issue must have the `accepted` label. If it doesn't, stop, and
   tell the user to ask a core developer on the issue. Never add the label.
2. **Claim**: if the issue is assigned to someone else, stop: the user asks them on
   the issue first. If it's unassigned, assign the user (`gh issue edit <issue>
   --add-assignee @me`). Suggest they say on the issue that they're starting.
3. **Slug**: the draft's, if there was one; otherwise pick it as in "Write it down".
4. **idea.md**: on the first PR's branch, write
   `dev/artifacts/features/<slug>/idea.md` from `dev/templates/idea.md`, with the
   issue's title and current text (`gh issue view <issue>`), `$issue`, and
   `$created` (the day it was filed). Leave out the "exist locally" line.
5. **Research**: if `.private/<slug>/research.md` exists, read it for what shouldn't
   be public (case details, customer names, internal links, evidence) and suggest
   fixes; then move it beside `idea.md`.
6. **Commit** with `Refs #<issue>`, with the rest of the first PR.
7. **Issue**: when the first PR is open, replace the issue's body with
   `dev/templates/issue.md` (the summary, the link, and the checklist with the PR's
   number on its step), after the user's go-ahead.

From then on, `idea.md` is the idea, changed in PRs like any document; discussion on
a PR is folded into it before it's merged.

## Drop it

Not started: close the issue as not planned, saying why, after the user's go-ahead
(`gh issue close <issue> --reason "not planned" --comment "<why>"`). Ask what to do
with research in `.private/<slug>/`: post it on the issue, keep it, or delete it.

Started: the record says what we didn't do and why. Add an `## Outcome` section at
the end of `idea.md`: "Dropped: <why>", with a link to the discussion. On the open
PR, commit it there; for an idea already on main, in a PR of its own on
`idea/<slug>`. After it's merged, close the issue as not planned, after the user's
go-ahead.
