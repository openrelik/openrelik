---
name: adr
description: Write an OpenRelik architecture decision record in dev/artifacts/decisions/<number>-<slug>.md, for a decision that outlasts a feature and constrains other work, either in the design PR it comes from or in a PR of its own on adr/<slug>; or supersede an earlier one. Use for "write an ADR", "record this decision", "supersede ADR 3", or /adr <title>.
---

# ADR

"Designs and ADRs" in `dev/process.md`. An ADR records a decision that outlasts the
feature and constrains other work (how the API is versioned, how workers are
packaged): its context, the decision, and its consequences. A core developer
approves it. It isn't rewritten: a later ADR supersedes it.

1. **Is it one**: a decision that only affects one feature belongs in its design or
   spec, not an ADR: say so.
2. **Which case**:
   - From a design: on the design's branch, in the design PR; the design links to
     it, and the issue is the idea's.
   - On its own: it needs an issue for its discussion, a plain one without the `idea`
     label, and no acceptance. Find it, or open it after the user's go-ahead
     (`gh issue create --title "Decision: <title>" --body-file ...`). From the main
     checkout, `./devctl worktree create adr/<slug> --no-stack`, and work there.
   - Found while writing a spec or the code: on its own, as above. Tell the user the
     spec or the code that depends on it waits until it's merged.
3. **Number**: the next after the highest on main (`git fetch`, then
   `git ls-tree --name-only origin/main dev/artifacts/decisions/`), four digits, and
   not one an open design or ADR PR has taken (`gh pr list --search "head:adr/"` and
   `"head:design/"`). If two PRs end up with the same number, the one merged second
   renumbers.
4. **Write** `dev/artifacts/decisions/<number>-<slug>.md` from `dev/templates/adr.md`,
   filling in `$number`, `$title` and `$created` (today, `YYYY-MM-DD`), and replacing
   the hint text:
   - Context: the forces, the constraints, and the options considered; link the
     design or the issue it came from.
   - Decision: what we decided, in a few sentences, as "We will ...".
   - Consequences: what becomes easier and what becomes harder, and what other work
     now has to follow it.
5. **Supersede**: if it changes an earlier decision, set the earlier one's `status:`
   to `superseded by <number>` in the same PR, and say so in the new one's Context.
   Change nothing else in the earlier one.
6. **Commit** with `Refs #<issue>` in the message, and show the ADR to the user.
7. **Publish**, for one on its own, only after the user's go-ahead:

   ```bash
   git push -u origin adr/<slug>
   gh pr create --head adr/<slug> --title "ADR: <title>" --body "Closes #<issue>"
   ```

   A core developer approves it. One from a design goes in the design PR, and is
   approved with it.

After it's merged, `./devctl worktree remove adr/<slug>`.

## Rules

- An ADR on main isn't edited, except to mark it superseded.
- Don't approve or merge.
