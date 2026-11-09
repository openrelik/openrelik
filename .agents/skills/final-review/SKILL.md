---
name: final-review
description: >
  Final review of an OpenRelik change or pull request: is the logic right, is it
  safe, does it preserve forensic evidence, does it hold under load, is risky
  code tested, is it fast enough, and is every line needed. Reads the connected
  code, not only the diff. Each finding is explained in plain English. Use for
  "final review", "review PR 123", "review this", "code review", "review my PR",
  or /final-review <PR number>.
---

Review an OpenRelik change like the senior developer who will be paged when it breaks.
The developer's self-review came first; this is the safety net before merge, so don't
take its word for anything.

Order of importance: correct, safe, forensic integrity, holds under load, tested, fast, lean.
Lean still matters: every extra line must be read, tested, and fixed later.
This is a report the user asked for, so give it in full. Lists findings, changes no code.

## 1. Understand first

- Review what the user names: a PR number or URL (`/final-review 123`), a branch, or
  uncommitted/staged changes if reviewing locally before a PR.
- For a PR:
  ```bash
  gh pr view <number> --comments    # description, branches, "Closes #...", discussion
  gh pr diff <number>
  ```
- Find the basis: the spec (`dev/artifacts/features/<slug>/spec.md`, on main or in the
  PR), or for a bugfix or a refactor the issue it closes (`gh issue view <issue>`).
  A bugfix's record is its failing regression test and its commit message (the symptom,
  the cause, and the fix): check that both are there.
- The description's "Self-review" section says where the change was weak: check that
  each fix holds, and that each finding left unfixed has a good reason.
- Read the diff, then the code it touches in full: callers of every changed function,
  the functions it calls, the tests, the README, and the `AGENTS.md` of each component
  touched (`server/`, `web/sunstone/`, `workers/`, `libs/*`, `mcp/`). Check out the
  branch if it isn't local (`gh pr checkout <number>` in a worktree, or read with
  `git show origin/<branch>:<path>`).
- Trace the real flow: where data comes in (API routes, Celery tasks, web UI events),
  what is stored (PostgreSQL, Celery backend, disk), what goes out.
- A change can break code it does not touch. When a signature, return value, or behavior
  changes, grep every caller.
- Find the expected load in the repo (README, deploy config): concurrent Celery workers
  processing large forensic images, API mediator under concurrent requests. Judge scale
  against that, and say which load you assumed.

## 2. Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item, rounding,
   time zones), a caller broken by the change, a fix applied in one caller while the
   shared function stays broken.
2. **Risk & Forensic Integrity:** security holes (command injection, path traversal,
   SQL injection, unsafe deserialization, missing auth or user input validation,
   secrets in code or logs), data loss (errors swallowed, writes in the wrong order,
   no transaction). **Forensic evidence must never be modified.**
3. **Spec conformance:** every requirement in the spec is implemented and tested;
   nothing is added beyond what was asked; the spec matches the code and its tasks
   are ticked. Without a spec (bugfix or refactor): the change solves the issue, and
   only that.
4. **Scale:** fine for one user or small test file, wrong for many or large evidence:
   Celery concurrency races, memory leaks or loading large disk images into memory
   instead of streaming/chunking, database query per item (N+1), per-process state
   that must be shared.
5. **Missing test:** risky new logic (API routes, Celery tasks, parsers, permissions,
   data writes, bug fixes) with no test that fails when it breaks. One good test checking
   behavior, not coverage for coverage's sake.
6. **Speed:** big slowdowns are problems (evidence processing pipelines, slow database
   queries). Small wins (work repeated in a hot loop) are suggestions.
7. **Lean:** code that should not exist or should be smaller:
   - delete: dead code, unused options, leftover debug logs, speculative features
   - reuse: the repo already has this helper (name the path in `libs/common`,
     `libs/worker-common`, etc.)
   - stdlib / native: the standard library or platform already does it; a new dependency
     for a few lines
   - yagni: abstraction with one implementation, config nobody sets
   - merge: near-copies that must change together
   - split: one function doing several unrelated jobs, hard to read or test.
8. **Conventions:** component's `AGENTS.md` conventions, Apache 2.0
   `Copyright <year> Google LLC` header on every new source file.

## 3. Check before you report

- Every finding needs a concrete case: "this input or situation leads to this wrong result".
  No case, no finding.
- Re-read the lines and confirm: the caller exists, the value can really be empty, the code
  really is unused.
- A shortcut marked with a `shortcut:` comment that names its limit is a decision, not a
  finding, unless the expected load already crosses it.
- Propose the smallest fix that works. Prefer fixes that delete code. Never add layers,
  frameworks, or config the problem does not need.
- No style taste, no "consider", no vague worries. Don't name the model or tool.

## 4. Output

Very simple English: short sentences, everyday words. Explain a technical term the first
time you use it. The reader may never have seen this code.

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
  requirement, breaks at the expected load.
- **Should fix:** risky code without a test, real slowness, duplication, a function
  that mixes jobs, code that should not exist.
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
- `Verdict: Ship.` or `Verdict: fix 1 and 3 first.`
- `Lean: -<N> lines possible.` when lean findings exist.
- `Not checked:` one line, if something mattered and you could not check it.

Nothing found: `What this change does:`, then `Looks good. Ship.` and one line on what
you checked.

## 5. Record and post

1. **Write** the review to `.private/<slug>/final-review-<number>.md` in the main
   checkout (from a worktree, the first path in `git worktree list`), gitignored, in
   the output form above; `<slug>` is from the PR's branch (`code/<slug>`). Show it to
   the user.
2. **Post** it only after the user's explicit go-ahead:
   ```bash
   gh pr comment <number> --body-file .private/<slug>/final-review-<number>.md
   ```
   and tick "Final review" on the issue the PR closes.

Don't mark the PR ready, approve, or merge it: that's for the developer. It's merged
only once a human has approved it: a teammate's review, or, if the team has agreed to
it, the author's comment saying they approve after reading the final review. Say so if
neither is there.

To have a model without access to the repository review, pass the instructions
from this skill along with the spec or issue and the diff (`gh pr diff <number>`).
