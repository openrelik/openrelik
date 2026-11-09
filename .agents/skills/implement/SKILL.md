---
name: implement
description: >
  Implement an OpenRelik change on code/<slug>: a feature task by task from its spec,
  ticking the tasks and keeping the spec in step with the code; or a bugfix or a
  refactor from its issue, with a regression test and a commit message that says the
  symptom, the cause, and the fix. Use for "implement the spec", "build this", "fix
  issue 123", or /implement <slug or issue number>.
---

# Implement

"Code" in `dev/README.md`: the code, from the spec for a feature, or from the issue
for a bugfix or a refactor, until it's ready for the review skill.

## Before

1. **Basis**:
   - A feature: `dev/artifacts/features/<slug>/spec.md` on main, or on its approved
     spec PR; and the `idea.md`, `design.md` and ADRs it refers to.
   - A small feature, with the spec and the code in one PR: there's no spec yet. Do
     "Start it" from the `idea` skill, and write the spec as the `spec` skill says
     (drafted and reviewed in `.private/<slug>/spec.md` first), both committed on
     `code/<slug>` only after the user approves the draft.
   - A bugfix or a refactor: the issue (`gh issue view <issue>`).
2. **Gate**: for a feature, the spec merged, or approved (then stack the code on it,
   below); the ADRs it depends on merged; and the idea not assigned to someone else.
   For a small feature, the idea accepted. For a bugfix or a refactor, an issue. If
   any is missing, stop and tell the user.
3. **Worktree**: from the main checkout, `./devctl worktree create code/<slug>`
   (`--from spec/<slug>` to stack it on an approved spec; unless
   `.worktrees/<slug>/` already exists), which starts its stack. Work there, and read
   the `AGENTS.md` of each component the change touches.

## A feature

4. **Task by task**, in the spec's order: implement it, with the tests the spec names
   for its requirements; run the checks of the components it touches; tick it in
   `spec.md` (`- [x] T1: ...`); and commit, saying what and why, with
   `Refs #<issue>`. A task per commit, where it fits. Follow the `humanize` standard
   (`.agents/skills/humanize/SKILL.md`): plain, direct commit messages without AI filler.
5. **When the spec is wrong**: if the code has to differ, change the spec in this PR,
   so main's spec matches main's code, and tell the user. Stop and ask the user
   first if it changes what users see: that goes back to the team on the PR. Stop
   too if it needs a decision that other work will depend on: its ADR comes first
   (the `adr` skill).
6. **Try it** on the worktree's stack where the tests don't reach
   (`./devctl status -w <slug>` for its URLs).

## A bugfix or a refactor

4. **Reproduce** a bug first: a regression test that fails with the code as it is.
   If you can't write one, stop and tell the user.
5. **Fix** it with the smallest change that makes the test pass, and run the checks.
   A refactor changes no behaviour: the tests pass before and after.
6. **Commit**, for a bugfix, with a message that says the symptom, the cause, and the
   fix, and `Refs #<issue>`; it's the bug's record. State it plainly without AI fluff
   (`.agents/skills/humanize/SKILL.md`).
7. **Bigger than a fix**: if it turns out to need a design or a spec, stop: it becomes
   an idea (the `idea` skill).

## After

When the tasks are ticked, or the fix is in, the change goes to the `review`
skill, ideally in a fresh session. For a feature, the review record is saved to
`dev/artifacts/features/<slug>/review.md` on `code/<slug>`. The PR is opened after it, not before.

## Rules

- Nothing the spec or the issue didn't ask for. Something worth doing beyond it is a
  new idea or issue: tell the user.
- Nothing is published (no push, no PR, no comments) until the user says so.
- Don't approve or merge.
