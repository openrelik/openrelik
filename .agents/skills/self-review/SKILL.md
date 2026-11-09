---
name: self-review
description: Review an OpenRelik change locally before its PR is opened, in rounds, until it has no blockers or majors; private, nothing is posted. Use for "self-review", "review my change before the PR", "is this ready for a PR", or /self-review.
---

# Self-review

"Self-review" in `dev/process.md`: the developer's own review of the change, before
anyone else reads it, so the PR review finds little. It's private and doesn't
replace the final review on the PR, the `final-review` skill, which is the safety
net.

Be the strict reviewer the team would be: the goal is a PR that's right the first
time, not a review that passes.

## A fresh reviewer

The agent that wrote the code reviews what it meant to write, not what it wrote. So
the review itself is done by an agent without this conversation:

- If you can start a separate agent, give it only the brief, the spec (or the
  issue), the diff and the repository, and none of the reasoning from writing the
  code. Ideally a different model.
- If you can't, say so, and suggest the user runs this skill in a fresh session.

You run the checks, fix, and keep the record.

## How

1. **Where**: in the change's worktree (`.worktrees/<slug>/`, on `code/<slug>`), with
   the implementation done. The basis is `dev/artifacts/features/<slug>/spec.md`, or
   for a bugfix or a refactor the issue (`gh issue view <issue>`). The record is
   `.private/<slug>/self-review.md` in the main checkout (from a worktree, the first
   path in `git worktree list`), so it outlives the worktree; read it first if it
   exists, for earlier rounds.
2. **Checks**: run the tests and formatters of each component the change touches, as
   their `AGENTS.md` says (`server/`, `web/sunstone/`, `workers/`, and `uv run pytest` in
   a library). Where the tests don't reach, try it on the stack (`./devctl stack up -w
   <slug>`). A failing check is a blocker.
3. **Review**: by the brief, `dev/templates/review.md` (fill in `$branch` as
   `code/<slug>`, `$base` as `main`, `$basis`, and `$context` with
   `git diff main`, which includes uncommitted changes). The reviewer reads the
   changed files in full and their callers, and keeps only findings it has checked.
   Give it the dismissed findings from earlier rounds, with their reasons.
4. **Record** the round in `.private/<slug>/self-review.md`: the date, the checks
   and their results, and the review. Then, for each finding, with the user: fix it,
   or dismiss it with a one-line reason. Write down which.
5. **Again**: review the change as it is now, in a new round, until one finds no
   blockers and no majors. Minors and nits are the developer's call.
6. **Ready**, before the PR:
   - the spec's tasks are ticked, and the spec matches the code (update it where the
     code had to differ);
   - each requirement has its test, and the tests fail without the change;
   - the branch is rebased on main (`./devctl worktree sync`), and the checks pass after;
   - commits say what and why, with `Refs #<issue>`;
   - for a bugfix, a regression test that fails without the fix, and a commit message
     that says the symptom, the cause, and the fix;
   - nothing left over: debug output, commented-out code, stray files, TODOs without
     an issue.
7. **Report** to the user: the rounds, what was fixed, what was dismissed and why,
   and whether it's ready.
8. **PR description**: draft it from `dev/templates/pr.md`: what the change does and
   why, and under "Self-review", the blockers and majors in plain English, one line
   each: what was wrong and how it was fixed, or why it was left. No minors or nits,
   no file-by-file detail, no round numbers, and no model or tool names. Write it to
   `.private/<slug>/pr.md` and show it to the user. Opening the PR is theirs to
   decide; push and `gh pr create --body-file <main checkout>/.private/<slug>/pr.md`
   only after their go-ahead. When the PR is open for a feature: if the work started
   with this PR (small feature), replace the issue's body now (step 8 of "Start it" in
   the `idea` skill). Then add the PR number to the issue's "Implementation" step (and
   "Spec" if the spec is in this PR). After the final review, a human approves it
   before it's merged (see "Final review and merge" in `dev/process.md`).

## Rules

- Nothing is published: no comments, no PR, no push, until the user says so. The
  record stays in `.private/<slug>/`, uncommitted; only the PR description's summary
  of it is published.
- Don't lower the bar to finish: a finding is fixed or dismissed with a reason, never
  dropped.
