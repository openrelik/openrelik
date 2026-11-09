---
name: final-review
description: The final review of an OpenRelik pull request, the safety net after the self-review: review it against its spec or issue by the brief in dev/templates/review.md, and post the review on the PR when asked. Use for "review PR 123", "final review", or /final-review <PR number>.
---

# Final review

"Final review and merge" in `dev/process.md`: an agent reviews the PR before it's
merged, and the review is posted on it. The developer's self-review came first; this
is the safety net, so don't take its word for anything.

1. **Gather**:

   ```bash
   gh pr view <number> --comments    # description, branches, "Closes #...", discussion
   gh pr diff <number>
   ```

   And the basis: the spec (`dev/artifacts/features/<slug>/spec.md`, on main or in
   the PR), or for a bugfix or a refactor, the issue it closes (`gh issue view
   <issue>`). A bugfix's record is its regression test and its commit message (the
   symptom, the cause, and the fix): check that both are there.
   The description's "Self-review" section says where the change was weak: check
   that each fix holds, and that each finding left unfixed has a good reason.
2. **Review** by the brief, `dev/templates/review.md`: it says what to check
   and the exact form of the answer. Read the changed files in full and their
   callers, not only the diff (check out the branch if it isn't local:
   `gh pr checkout <number>` in a worktree of its own, or read with
   `git show origin/<branch>:<path>`). Read the `AGENTS.md` of each component it
   touches. Keep only findings you've checked, pointing at the code that's wrong.
3. **Write** the review to `.private/<slug>/final-review-<number>.md` in the main
   checkout (from a worktree, the first path in `git worktree list`), gitignored, in
   the brief's form; `<slug>` is from the PR's branch (`code/<slug>`). Show it to the
   user.
4. **Post** it only after the user's go-ahead:

   ```bash
   gh pr comment <number> --body-file .private/<slug>/final-review-<number>.md
   ```

   and tick "Final review" on the issue the PR closes.

Don't mark the PR ready, approve, or merge it: that's for the developer. It's
merged only once a human has approved it: a teammate's review, or, if the team has
agreed to it, the author's comment saying they approve after reading the final
review. Say so if neither is there.

To have a model without access to the repository review, fill in the brief instead
(`$branch`, `$base`, `$basis` with the spec or the issue, `$context` with the diff)
and give it the result.
