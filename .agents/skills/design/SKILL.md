---
name: design
description: Write the design for a big or user-facing OpenRelik change, or a data model or API change, in dev/artifacts/features/<slug>/design.md (or dev/artifacts/designs/<slug>/ when several features build on it), with its ADRs and screenshots, in a design PR a core developer approves. Use for "write the design", "design this idea", or /design <slug or issue number>.
---

# Design

"Designs and ADRs" in `dev/process.md`: for a change that's expensive to get wrong.
It says what changes for users and roughly how, and what else was considered. A core
developer approves it, and it's merged before the spec is written.

1. **Inputs**: the idea, the issue (`gh issue view <issue>`), or
   `dev/artifacts/features/<slug>/idea.md` on main if the work has started;
   `.private/<slug>/research.md` in the main checkout if it's there; the prototype's
   draft PR, if there is one (`gh pr list --label prototype --search "<issue>"`); and
   the ADRs in `dev/artifacts/decisions/` that it touches.
2. **Gate**: the idea must be accepted, labeled `accepted` (if it isn't, the user asks
   a core developer on the issue; never add the label), and not assigned to someone
   else (then the user asks the assignee first). If the change isn't big,
   user-facing, or a data model or API change, say so: it may need only a spec.
3. **Where**: in the feature's folder, `dev/artifacts/features/<slug>/design.md`. Only
   when several features build on it, in `dev/artifacts/designs/<slug>/design.md`,
   and each feature links to it; ask the user.
4. **Branch**: from the main checkout, `./devctl worktree create design/<slug>
   --no-stack` (unless `.worktrees/design-<slug>/` already exists), and work there.
5. **The idea**: if `idea.md` isn't on main, the work starts with this design: do
   "Start it" from the `idea` skill on this branch, which commits `idea.md`, moves
   the research, and turns the issue into the plan.
6. **Write** `design.md` from `dev/templates/design.md`, filling in `$slug`, `$title`
   and `$issue`, and replacing the hint text:
   - Summary: what changes for users, and roughly how, in a few sentences.
   - Background: the problem, from `idea.md`, and what the research and the prototype
     taught; link the prototype's PR.
   - Proposal: what users see, the UI and the API. Screenshots go in `screenshots/`
     beside `design.md`, referenced by relative path.
   - Technical design: the components it touches (`server/`, `web/sunstone/`,
     `workers/`, `libs/`), the data model and its migrations, the API changes. Read
     the `AGENTS.md` of each, and the code it changes, so it's real. Roughly how, not
     the tasks: those are the spec's.
   - Alternatives considered: at least the ones the research found, and why not.
   - Risks and open questions: what could go wrong at forensic scale (multi-terabyte
     images, millions of files), and what the reviewers should decide.
7. **ADRs**: for each decision that outlasts the feature and constrains other work,
   write an ADR with the `adr` skill, on this branch; the design links to it. Most
   designs have none: a decision only this feature cares about stays in the design.
8. **Commit** with `Refs #<issue>` in the message, and show the design to the user.
9. **Publish** only after the user's go-ahead:

   ```bash
   git push -u origin design/<slug>
   gh pr create --head design/<slug> --title "Design: <title>" --body "Refs #<issue>"
   ```

   If the work started with this design, replace the issue's body now (step 8 of
   "Start it" in the `idea` skill); then add the PR number to the issue's "Design"
   step, and "ADR" if it has any. A core developer approves it.

After it's merged, `./devctl worktree remove design/<slug>`, and the spec follows
(the `spec` skill).

## Rules

- No code changes. A question best answered by trying it goes in a prototype, after
  the user agrees to one.
- Screenshots show synthetic data, never case data or real evidence.
- Don't approve or merge.
