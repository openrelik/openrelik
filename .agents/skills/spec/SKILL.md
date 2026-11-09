---
name: spec
description: Write the spec for an OpenRelik feature in dev/artifacts/features/<slug>/spec.md, in a spec PR of its own, from the idea, the research and the design. Use for "write the spec", "spec this idea", or /spec <slug or issue number>.
---

# Spec

"Specs" in `dev/README.md`: the requirements, testable, and the tasks that
implement them, reviewed, approved and merged before the code is written.

1. **Inputs**: the idea, `dev/artifacts/features/<slug>/idea.md` on main, or, if the
   work starts with this spec, the issue (`gh issue view <issue>`); `design.md` if
   there is one (or the design in `dev/artifacts/designs/` it links to), and the
   ADRs it refers to; `.private/<slug>/research.md` in the main checkout if it's
   there; the issue for where the work stands.
2. **Gate**: the idea must be accepted, an issue labeled `idea` and `accepted` (if
   it isn't, the user asks a core developer on the issue; never add the label), and
   not assigned to someone else (then the user asks the assignee first). A big or
   user-facing feature, or a data model or API change, also needs its design merged,
   and the spec needs the ADRs it depends on merged. If any is missing, stop and tell
   the user. A bugfix or a refactor needs no spec: say so. For a small feature, ask
   whether the spec and the code go in one PR on `code/<slug>` instead.
3. **Draft privately in `.private/`**: in the main checkout (from a worktree, the first path
   in `git worktree list`), create `.private/<slug>/` and draft the spec in
   `.private/<slug>/spec.md` from `dev/templates/spec.md`, filling in `$slug`, `$title`
   and `$issue`, and replacing the hint text:
   - Requirements `R1`, `R2`, ...: each one testable, saying what must be true when
     it's done. Nothing the idea or the design didn't ask for.
   - Tasks `- [ ] T1: ...`: small and ordered, each verifiable on its own, naming its
     files and the requirements it implements.
   - Tests: how each requirement is verified, by number.
   - Rollout: migrations, configuration, documentation; "None" if nothing.

   Read the `AGENTS.md` of each component the tasks touch (`server/`, `web/sunstone/`,
   `workers/`), and the code they change, so the tasks are real.
   Review and refine the spec locally in `.private/<slug>/spec.md` with the user until
   they approve it. Never commit the spec before this local review is done.
4. **Branch**: from the main checkout, `./devctl worktree create spec/<slug> --no-stack`
   (unless `.worktrees/spec-<slug>/` already exists), and work there.
5. **The idea and the research**: if `idea.md` isn't on main, the work starts with
   this spec: do "Start it" from the `idea` skill on this branch, which commits
   `idea.md`, moves the research, and turns the issue into the plan. Otherwise, if
   `.private/<slug>/research.md` exists and isn't on main yet, move it into
   `dev/artifacts/features/<slug>/` on this branch, so the spec's reviewers see it.
6. **Move the spec and commit**: copy `.private/<slug>/spec.md` into
   `dev/artifacts/features/<slug>/spec.md` on this branch, and delete `.private/<slug>/spec.md`
   (and remove `.private/<slug>/` if it's now empty). Commit with `Refs #<issue>` in the
   message.
7. **Publish** only after the user's go-ahead:

   ```bash
   git push -u origin spec/<slug>
   gh pr create --head spec/<slug> --title "Spec: <title>" --body "Refs #<issue>"
   ```

   If the work started with this spec, replace the issue's body now (step 8 of "Start
   it" in the `idea` skill); then add the PR number to the issue's "Spec" step.

After it's approved, the code can start on `code/<slug>`, stacked on the spec
(`--from spec/<slug>`) until the spec PR is merged.
