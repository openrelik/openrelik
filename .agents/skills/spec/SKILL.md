---
name: spec
description: Write the spec for an OpenRelik feature in dev/artifacts/features/<slug>/spec.md, in a spec PR of its own, from the idea, the research and the design. Use for "write the spec", "spec this idea", or /spec <slug or issue number>.
---

# Spec

"Specs" in `dev/README.md`: the requirements, testable, and the tasks that
implement them, reviewed, approved and merged before the code is written.

1. **Inputs**: the idea, `.private/<slug>/idea.md` or `dev/artifacts/features/<slug>/idea.md` on main,
   or the issue (`gh issue view <issue>`); `design.md` if there is one (or the design
   in `dev/artifacts/designs/` it links to), and the ADRs it refers to;
   `.private/<slug>/research.md` in the main checkout if it's there; the issue for where
   the work stands.
2. **Gate**: the idea must be accepted, an issue labeled `idea` and `accepted` (if
   it isn't, the user asks a core developer on the issue; never add the label), and
   not assigned to someone else (then the user asks the assignee first). A big or
   user-facing feature, or a data model or API change, also needs its design merged,
   and the spec needs the ADRs it depends on merged. If any is missing, stop and tell
   the user. A bugfix or a refactor needs no spec: say so. Every feature requires its
   own spec PR that is approved and merged before code implementation begins.
3. **Draft privately in `.private/` and let the human review**: the spec skill must always
   create and draft `spec.md` in `.private/<slug>/spec.md` first and pause for human review.
   In the main checkout (from a worktree, the first path in `git worktree list`), create
   `.private/<slug>/` and draft the spec in `.private/<slug>/spec.md` from `dev/templates/spec.md`,
   filling in `$title` and the YAML frontmatter: `$slug`, `$issue` (full GitHub URL),
   `$created` (today, `YYYY-MM-DD`), and `$by` (`<github username> (<github fullname>)`
   from `gh api user --jq '"\(.login) (\(.name))"'`), and replacing the hint text:
   - Requirements `R1`, `R2`, ...: each one testable, saying what must be true when
     it's done. Nothing the idea or the design didn't ask for.
   - Tasks `- [ ] T1: ...`: small and ordered, each verifiable on its own, naming its
     files and the requirements it implements.
   - Tests: how each requirement is verified, by number.
   - Rollout: migrations, configuration, documentation; "None" if nothing.

   Read the `AGENTS.md` of each component the tasks touch (`server/`, `web/sunstone/`,
   `workers/`), and the code they change, so the tasks are real.
   Always review and refine the spec locally in `.private/<slug>/spec.md` with the user
   and pause for their explicit approval. Never create a branch, commit, or open a PR
   before this local review is done and approved by the human.
4. **Branch**: only after the human approves the draft spec, create the worktree and branch
   from the main checkout: `./devctl worktree create spec/<slug> --no-stack`
   (unless `.worktrees/spec-<slug>/` already exists), and work there.
5. **Include idea.md and research.md in the PR**: when creating the spec PR, always include
   `idea.md` and `research.md` (if research exists) along with `spec.md` in
   `dev/artifacts/features/<slug>/` on this branch, retrieving the drafts from `.private/<slug>/` in
   the main checkout (from a worktree, the first path in `git worktree list`, e.g. `../../.private/<slug>/`):
   - `idea.md`: if `dev/artifacts/features/<slug>/idea.md` is not already on main,
     commit it on this branch from `.private/<slug>/idea.md` in the main checkout (or write it from the issue
     using `dev/templates/idea.md` if the local draft is absent), ensuring YAML frontmatter
     contains `$slug`, `$issue`, `$created`, `$by`, and `$title`. Delete
     `.private/<slug>/idea.md` once copied.
   - `research.md`: if `.private/<slug>/research.md` exists in the main checkout and is not already on main,
     screen it for sensitive details (customer names, case details, internal links),
     move it into `dev/artifacts/features/<slug>/research.md` on this branch, and delete
     `.private/<slug>/research.md`.
   - `spec.md`: copy `.private/<slug>/spec.md` from the main checkout into `dev/artifacts/features/<slug>/spec.md`
     on this branch, and delete `.private/<slug>/spec.md` (and remove `.private/<slug>/`
     if now empty).
   Commit all artifacts with `Refs #<issue>` in the message (e.g. `Add spec, idea, and research for <title>`).
6. **Publish** only after the user's go-ahead:

   ```bash
   git push -u origin spec/<slug>
   gh pr create --head spec/<slug> --title "Spec: <title>" --body "Refs #<issue>"
   ```

   If the work started with this spec, replace the issue's body now (step 8 of "Start
   it" in the `idea` skill); then add the PR number to the issue's "Spec" step.

Once the spec PR is merged into main, implementation can start on `code/<slug>` (the
`implement` skill). The implementation skill requires the spec PR to be merged into
`main` and refuses to implement if it is not.
