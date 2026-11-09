---
name: review
description: >
  Quality review of an OpenRelik change or pull request: is the logic right, is
  it safe, does it preserve forensic evidence, does it hold under load, is risky
  code tested, is it fast enough, and is every line needed. Reads the connected
  code, not only the diff. Each finding is explained in plain English. Use for
  "review this", "review my change", "code review", "review PR 123", or /review.
---

Review an OpenRelik change like the senior developer who will be paged when it breaks.
Order of importance: correct, safe, forensic integrity, holds under load, tested, fast, lean.
Lean still matters: every extra line must be read, tested, and maintained.
This is a report the user asked for, so give it in full. Lists findings, changes no code.

## Clean Context Requirement (MANDATORY)

The agent that wrote or discussed the code reviews what it meant to write, not what was
actually written. **Reviews must always run in a subagent with a completely clean context.**

- **Never review in the current conversation**: The orchestrating agent manages the workflow
  (runs checks, records rounds, coordinates fixes with the user), but it **must not** perform
  the code review pass itself within the implementation conversation.
- **Always launch a subagent**: Use `invoke_subagent` (or the harness equivalent) to launch an
  independent reviewer agent. Pass the subagent **ONLY**:
  1. The review rubric and instructions from this skill;
  2. The basis (spec or issue) and the diff (`git diff main` or `gh pr diff <number>`);
  3. Previously dismissed findings from earlier rounds with their one-line reasons;
  4. Paths to touched files and repository root.
  **Never pass** the implementation chat history, prior agent thinking, or developer rationale.
- **No subagent capability?** If the environment cannot spawn a subagent, stop immediately and
  tell the user to run `/review` in a fresh, clean session. Never bypass this requirement by
  reviewing inline.

---

## 1. Understand first

- **What to review**:
  - A PR number or URL (`/review 123`):
    ```bash
    gh pr view <number> --comments    # description, branches, "Closes #...", discussion
    gh pr diff <number>
    ```
  - A local branch (`code/<slug>`), uncommitted changes, or files named by the user.
    If nothing is named, review uncommitted changes or the current branch against `main`.
- **The basis**: the spec (`dev/artifacts/features/<slug>/spec.md`, on main or in the
  PR), or for a bugfix or a refactor the issue it closes (`gh issue view <issue>`).
  A bugfix's record is its failing regression test and commit message (symptom, cause,
  and fix): verify both exist.
- **Run checks**: run the tests and formatters of each touched component as their
  `AGENTS.md` says (`server/`, `web/sunstone/`, `workers/`, `libs/*`, `mcp/`). Where tests
  don't reach, run on the stack (`./devctl stack up -w <slug>`). A failing check is a
  Must fix.
- **Read connected code**: read the diff, then the code it touches in full: callers of
  every changed function, functions it calls, tests, README, and the component's `AGENTS.md`.
  Check out remote branches if needed (`gh pr checkout <number>` or `git show origin/<branch>:<path>`).
- **Trace the flow**: where data enters (API routes, Celery tasks, web UI events), what is
  stored (PostgreSQL, Celery backend, disk), and what goes out.
- Grep every caller when a signature, return value, or behavior changes.
- **Expected load**: concurrent Celery workers processing large digital forensic evidence
  (disk images, memory dumps, files), API mediator under concurrent requests. Judge scale
  against that, and say which load you assumed.

## 2. Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item, rounding,
   time zones), a caller broken by the change, a fix applied in one caller while the
   shared function stays broken.
2. **Risk & Forensic Integrity:** security holes (command injection, path traversal,
   SQL injection, unsafe deserialization, missing auth or input validation, secrets in
   code or logs), data loss (swallowed errors, writes in wrong order, no transaction).
   **Forensic evidence must never be modified.**
3. **Spec conformance:** every requirement in the spec is implemented and tested;
   nothing added beyond what was asked; spec matches the code and its tasks are ticked.
   Without a spec (bugfix or refactor): solves the issue and only that.
4. **Scale:** fine for one user or small test file, wrong for many or large evidence:
   Celery concurrency races, memory leaks or loading large disk images into memory
   instead of streaming/chunking, database queries in loops (N+1), per-process state
   that must be shared across workers.
5. **Missing test:** risky new logic (API routes, Celery tasks, parsers, permissions,
   data writes, bug fix) with no test that fails when it breaks. Tests must check
   behavior, not implementation details.
6. **Speed:** big slowdowns in evidence processing or database queries. Small wins in
   hot loops.
7. **Lean:** code that should not exist or should be smaller:
   - delete: dead code, unused options, leftover debug logs, speculative features
   - reuse: the repo already has this helper (name the path in `libs/common`, `libs/worker-common`, etc.)
   - stdlib / native: standard library or platform already does it; avoid new dependencies for a few lines
   - yagni: abstraction with one implementation, config nobody sets
   - merge: near-copies that must change together
   - split: one function doing several unrelated jobs, hard to read or test
8. **Conventions:** component's `AGENTS.md` rules, Apache 2.0 `Copyright <year> Google LLC`
   header on every new source file.

## 3. Check before you report

- Every finding needs a concrete case: "this input or situation leads to this wrong result".
  No case, no finding.
- Re-read the lines and confirm: the caller exists, the edge case is real, the code really is unused.
- A shortcut marked with a `shortcut:` comment that names its limit is a decision, not a
  finding, unless the expected load already crosses it.
- Propose the smallest fix that works. Prefer fixes that delete code. Never add layers or
  frameworks the problem does not need.
- No style taste, no "consider", no vague worries. Don't name the model or tool.

## 4. Output

Very simple English: short sentences, everyday words. Explain a technical term the first
time you use it. The reader may never have seen this code. Follow the `humanize` standard
(`.agents/skills/humanize/SKILL.md`): direct engineering prose, no AI stock filler, no
staged contrasts, no conversational pleasantries, and no wrap-up summaries.

Start with `What this change does:` in two or three sentences.

With a spec:
```markdown
## Requirements
- R1: done
- R2: missing: <what is missing>
- R3: untested
```
(Without a spec: leave out the Requirements section.)

Then the findings in three groups, skip empty groups:
- **Must fix:** bug, security, data loss, forensic evidence modification, broken spec
  requirement, breaks at expected load, failing test/check.
- **Should fix:** risky code without a test, real slowness, duplication, function
  mixing jobs, code that should not exist.
- **Nice to have:** small speed-ups, shorter forms.

Number findings across all groups, so the user can say "fix 2 and 5".
Every finding has all four parts, each one or two short sentences:

2. **Orders land on the wrong day** (`billing/close_day.py:L40-52`)
   - **What this is:** At midnight this job closes the day and bills all orders of that day.
   - **Problem:** It takes "today" from the server clock, which runs in UTC. An order placed
     at 00:30 in Berlin is billed on the day before.
   - **Fix:** Compute the day once in the shop's time zone:
     `datetime.now(ZoneInfo("Europe/Berlin")).date()`. One line, nothing else changes.
   - **If we skip it:** Late orders show the wrong date, and accounting fixes them by hand.

End with:
- `Verdict: LGTM` or `Verdict: fix 1 and 3 first.`
- `Lean: -<N> lines possible.` when lean findings exist.
- `Not checked:` one line, if something mattered and you could not check it.

Nothing found: `What this change does:`, then `LGTM` and one line on what
you checked.

## 5. Workflow

### When reviewing locally before opening a PR
1. **Checks**: Run tests and formatters of touched components. A failing check is a Must fix.
2. **Subagent review**: Launch a fresh subagent with clean context, giving it only this skill's
   rubric, the spec or issue, the diff (`git diff main`), and dismissed findings from earlier
   rounds.
3. **Record round**: Write the subagent's review in `.private/<slug>/review.md` in the main checkout
   from `dev/templates/review.md` with its YAML frontmatter (`slug`, `issue` as full GitHub URL,
   `created` as `YYYY-MM-DD`, and `by` as `<github username> (<github fullname>)` from
   `gh api user --jq '"\(.login) (\(.name))"'`), recording the date, checks run, and findings.
4. **Brief and pause**: Present a concise briefing of the findings, checks run, and verdict to the user.
   Pause and ask how the user wants to proceed before making any code changes, dismissing findings, or
   running further passes. Do not start fixing findings autonomously.
5. **Fix or dismiss**: Address findings as guided by the user. Each dismissed finding gets a one-line reason
   recorded so future rounds don't re-raise it.
6. **Repeat**: Re-run the subagent in clean context until there are **no Must fix and no Should fix**
   findings. Brief the user and pause after each round.
7. **Ready**:
   - Spec tasks are ticked and spec matches code;
   - Regression test exists for bugfix with commit message (symptom, cause, fix);
   - Branch is rebased on main (`./devctl worktree sync`) and checks pass;
   - Clean tree: no debug output, no commented-out code, no untracked files.
8. **Save review artifact**:
   - For a feature, copy `.private/<slug>/review.md` into `dev/artifacts/features/<slug>/review.md`
     on the implementation branch (`code/<slug>`), and commit it (`Refs #<issue>`) so the review
     record lands in the repository alongside `idea.md` and `spec.md`.
9. **Draft PR and review comment**:
   - Write a clean PR description from `dev/templates/pr.md` into `.private/<slug>/pr.md`
     (what the change does and why, `Closes #<issue>`). Keep the PR description clean.
   - Format the final review report into `.private/<slug>/review-comment.md` to be posted as
     the first comment on the PR so the PR description stays uncluttered. It must state in a
     short and concise way what was found across the review rounds and how each was fixed:
     - **Summary**: what the change does.
     - **Findings and fixes**: short, numbered summary of what was found and how it was fixed
       across review rounds (or noting that none were found).
     - **Requirements**: status of each requirement if reviewing against a spec.
     - **Final verification**: checks and tests run on the final tree.
     - **Verdict**: `LGTM`
   - Run both `pr.md` and `review-comment.md` through the `humanize` standard
     (`.agents/skills/humanize/SKILL.md`) to remove any AI boilerplate, buzzwords, or throat-clearing.
10. **Open PR and post review**: Push and open the PR with the `reviewed` label, then post the
   review comment, only after the user's explicit go-ahead:
   ```bash
   gh label create reviewed --description "Passed clean-context review; critical findings addressed" --color "0e8a16" 2>/dev/null
   gh pr create --title "$title" --body-file .private/<slug>/pr.md --label reviewed
   gh pr comment <number> --body-file .private/<slug>/review-comment.md
   ```

### When reviewing an open PR
1. **Subagent review**: Gather PR info (`gh pr view <number> --comments`, `gh pr diff <number>`).
   Launch a subagent with clean context containing only the review rubric, spec/issue, and PR diff.
2. **Record review and brief**: Write the review to `.private/<slug>/review-<number>.md` in the main
   checkout. Brief the user with a concise summary of the findings and verdict, then pause and ask
   how to proceed before posting comments or making changes.
3. **Post comment to GitHub**: Only after the user's explicit go-ahead:
   ```bash
   gh pr comment <number> --body-file .private/<slug>/review-<number>.md
   ```
   - If `Verdict: LGTM`: add the `reviewed` label with `gh pr edit <number> --add-label reviewed`.
   - If `Must fix` or `Should fix` findings remain: ensure the `reviewed` label is absent
     (`gh pr edit <number> --remove-label reviewed 2>/dev/null`).
4. **Human approval**: Agents never approve or merge PRs. Every PR requires human approval.
