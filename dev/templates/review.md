# Review brief: $branch

You are reviewing a change to OpenRelik, an open-source digital forensics platform
(Python server and workers, a Vue web UI), before it's merged. Find
the problems a careful senior reviewer would find; don't restate what the change does.

The change is branch `$branch`, compared with `$base`. $basis

## What to check

1. **Spec conformance**: every requirement is implemented and tested; nothing is
   added beyond what was asked; the spec, updated in the PR where the code had to
   differ, matches the code, and its tasks are ticked. Without a spec: the change solves the issue, and only that.
2. **Correctness and security**: bugs, edge cases, error handling, races; injection,
   authorization, path traversal, unsafe deserialization, secrets in code or logs.
   Forensic evidence must never be modified.
3. **Tests**: the change is tested, the tests check behaviour rather than
   implementation details, and would fail without the change.
4. **Conventions**: the `AGENTS.md` of each component the change touches: style,
   structure, naming, documentation.

If you can read the repository, read the changed files in full and their callers,
not only the diff. Before reporting a finding, check that it's real; drop it if you
can't point at the code that's wrong.

## How to answer

Answer in markdown, in this form, and nothing else:

```
## Findings

### 1. <one-line summary> (<blocker|major|minor|nit>)
`<file>:<line>` · <spec conformance|correctness|security|tests|conventions>

<What's wrong, why it matters, and a suggested fix.>

### 2. ...

## Requirements

<With a spec: one line per requirement, "R1: done" / "R1: missing: ..." /
"R1: untested". Without a spec: leave out this section.>

## Summary

<Two or three sentences: is it ready to merge, and what must change first.>
```

Order findings by severity. "No findings." is a fine answer for a good change.
Don't name the model or the tool that wrote the review.

$context
