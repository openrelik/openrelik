---
slug: release-skill
issue: https://github.com/openrelik/openrelik/issues/88
created: 2026-11-09
by: berggren (Johan Berggren)
---
# Review Round 1

Date: 2026-11-09
Checks run:
- uv run --python 3.12 .github/scripts/check-versions.py (passed, 0 errors)
- uv run pytest in dev/tools/devctl (passed, 41 passed)

What this change does: Introduces the `/release` agent skill (`.agents/skills/release/SKILL.md`) for coordinating platform minor releases, component patch releases, post-merge tagging, and next-cycle dev bumps using `./devctl release`. Establishes the initial root `CHANGELOG.md` with Keep a Changelog formatting for version 0.18.0. Updates release documentation across `AGENTS.md`, `dev/RELEASING.md`, and `dev/PATCHING.md` to reference the release skill and its human approval gate.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: missing

## Must fix

1. **Branch naming for PR branches (`release/libs-<version>`) causes `devctl release` to prematurely tag unmerged commits** (`.agents/skills/release/SKILL.md`)
   - **What this is:** In `.agents/skills/release/SKILL.md` Stage 1, the branch for releasing libraries to PyPI is named `release/libs-<version>`.
   - **Problem:** `commit_release` in `dev/tools/devctl/src/devctl/release.py` suppresses tagging on branches unless `branch.startswith("release/")`. Because `release/libs-<version>` starts with `release/`, `./devctl release lib` treats it as a release branch and tags locally before PR merge. Squash-merging into `main` then breaks post-merge tagging with `./devctl release tag`.
   - **Fix:** Use branch names that do not start with `release/` for PRs targeting `main` (e.g. `bump/libs-<version>`, `bump/consumers-<version>`, and `bump/dev-<next-minor>`). Reserve `release/` exclusively for long-lived release branches (`release/<major>.<minor>`).
   - **If we skip it:** `./devctl release lib` will tag prematurely on the local branch, attaching release tags to squashed-away branch commits instead of the merged commit on `main`.

2. **Release tags created before `CHANGELOG.md` is committed** (`.agents/skills/release/SKILL.md`)
   - **What this is:** In Stage 3 of `/release platform` and in `/release patch`, `./devctl release` runs before `CHANGELOG.md` is updated and committed.
   - **Problem:** `./devctl release` on `release/<major>.<minor>` commits and creates annotated git tags immediately. Because `CHANGELOG.md` is updated and committed afterwards, the tagged release commit lacks its own release notes in `CHANGELOG.md`.
   - **Fix:** Update and commit `CHANGELOG.md` on the release branch before executing `./devctl release platform` or `./devctl release <component>`, ensuring the changelog changes are included in the tagged release commit.
   - **If we skip it:** Release tags and source tarballs will contain an outdated `CHANGELOG.md` missing the release's notes.

3. **Missing update to `dev/README.md`** (`dev/README.md`)
   - **What this is:** `dev/README.md` was not updated to document the `release` skill.
   - **Problem:** Spec requirement R8 and task T6 require updating `dev/README.md` to reference the release skill.
   - **Fix:** Update `dev/README.md` to reference `.agents/skills/release/SKILL.md` in the development process and skills documentation.
   - **If we skip it:** Documentation remains incomplete and fails spec requirement R8.

## Should fix

4. **Changelog updates on `release/<major>.<minor>` not synced back to `main`** (`.agents/skills/release/SKILL.md`)
   - **What this is:** Missing sync step for `CHANGELOG.md` entries created on release branches.
   - **Problem:** Platform release and patch release changelog entries are committed to `release/<major>.<minor>`, but `main` is never updated with these entries, leading to divergence where `main` misses historical release notes.
   - **Fix:** Include a step in Stage 5 (and patch workflow) to bring the changelog updates back into `main` (via cherry-pick or in the `bump/dev-<next-minor>` PR).
   - **If we skip it:** `CHANGELOG.md` on `main` will permanently diverge and omit historical release notes.

## Nice to have

5. **Draft release notes path and GitHub UI caution** (`.agents/skills/release/SKILL.md`)
   - **What this is:** `gh release create v<version> --draft` creates a draft release without specifying notes file placement or cautioning against early publishing.
   - **Problem:** Maintainers might write notes files into the tracked repo tree or inadvertently publish via GitHub UI before tags are pushed.
   - **Fix:** Note that `<notes-file>` should be placed in `/tmp` or `.private/` to avoid dirtying the tree, and note not to publish the release in GitHub UI before the approval gate pushes the tags.
   - **If we skip it:** Unclean worktrees or tag target discrepancies if published prematurely through GitHub UI.

Verdict: fix 1, 2, and 3 first.
Lean: -0 lines possible.
Not checked: Live execution of `gh release create` and tag pushes against remote GitHub repository.


# Review Round 2

Date: 2026-11-09
Checks run:
- uv run --python 3.12 .github/scripts/check-versions.py (passed, 0 errors)
- uv run pytest in dev/tools/devctl (passed, 41 passed)

What this change does: Introduces the `/release` skill (`.agents/skills/release/SKILL.md`) to coordinate OpenRelik platform releases, component patch releases, post-merge tagging, and dev cycle transitions. Establishes the root `CHANGELOG.md` starting with version 0.18.0, and integrates release skill references across `AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, and `dev/PATCHING.md`. Enforces mandatory human approval gates before remote pushes or release publications.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done

## Must fix

6. **Worker patch dirty worktree aborts `devctl release worker`** (`.agents/skills/release/SKILL.md:192`)
   - **What this is:** Running `cd workers/<name> && uv lock --upgrade-package openrelik-worker-common && cd -` modifies `workers/<name>/uv.lock`. The subsequent command `./devctl release worker <name> <version>` calls `check_clean_worktree(root)`, which dies with `the worktree isn't clean`.
   - **Problem:** Updating `uv.lock` leaves the worktree dirty, causing the release command to fail immediately. In addition, step 1 says `On a branch from main:` without specifying the branch naming convention (`bump/worker-<name>-<version>`).
   - **Fix:** Specify switching to branch `bump/worker-<name>-<version>`, updating `CHANGELOG.md`, committing the lockfile and changelog first, and then running `./devctl release worker`.
   - **If we skip it:** Running the worker patch workflow aborts with `the worktree isn't clean`.

## Should fix

7. **Explicit branch creation in `/release dev <version>`** (`.agents/skills/release/SKILL.md:223-228`)
   - **What this is:** Subcommand 4 instructs running `./devctl release dev <version>` directly without switching to a branch.
   - **Problem:** Running it directly on `main` creates a local commit directly on `main`, violating Rule 4 (no direct pushes to protected branches).
   - **Fix:** Specify switching to branch `bump/dev-<version>` first (`git switch -c bump/dev-<version>`), consistent with Stage 5.
   - **If we skip it:** Maintainers may inadvertently commit to local `main` instead of opening a PR.

8. **Specify `--target` on draft release creation** (`.agents/skills/release/SKILL.md:115,173`)
   - **What this is:** When running `gh release create <tag> --draft` before `<tag>` is pushed to origin, `gh` defaults `--target` to the repo default branch (`main`).
   - **Problem:** Draft releases created on `release/<major>.<minor>` might target `main` instead of the release branch.
   - **Fix:** Add `--target release/<major>.<minor>` to the draft release command.
   - **If we skip it:** Draft releases on GitHub UI will display the target commit on `main`.

Verdict: fix 6, 7, and 8.
Lean: clean
Not checked: actual network publishing to PyPI and GitHub (`git push`, `gh release`, PyPI trusted publishing), which are simulated and gated by human approval.


# Review Round 3

Date: 2026-11-10
Checks run:
- uv run --python 3.12 .github/scripts/check-versions.py (passed, 0 errors)
- uv run pytest in dev/tools/devctl (passed, 41 passed)

What this change does: This change implements the `/release` agent skill in `.agents/skills/release/SKILL.md` to coordinate platform minor releases, component and worker patch releases, tagging, and dev version bumps. It establishes a root `CHANGELOG.md` adhering to Keep a Changelog starting from 0.18.0 and updates monorepo documentation across `AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, and `dev/PATCHING.md`. It enforces local preparation with version verification gates and requires explicit human approval before remote branch pushes, tag publications, or release finalizing.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done

## Must fix

9. **Draft release created against unpushed branch fails API validation** (`.agents/skills/release/SKILL.md`)
   - **What this is:** Stage 3 and core patch workflows run `gh release create ... --draft --target release/<major>.<minor>` before `release/<major>.<minor>` is pushed to origin.
   - **Problem:** Because `release/<major>.<minor>` exists only locally at that point, GitHub API rejects the request with HTTP 422 (`target_commitish does not exist`).
   - **Fix:** Prepare `/tmp/release-notes-*.md` locally and include its preview in the approval gate report. Create the GitHub release against the pushed tag in Stage 4 after user approval and tag push.
   - **If we skip it:** Stage 3 and core patch workflows fail with GitHub API errors before reaching the approval gate.

## Should fix

10. **Phrasing states agents merge pull requests** (`.agents/skills/release/SKILL.md`)
   - **What this is:** Four steps state "Open a pull request against main and merge it".
   - **Problem:** In OpenRelik, agents are strictly forbidden from approving or merging PRs (`AGENTS.md` and `dev/README.md`).
   - **Fix:** Rephrase to: "Open a pull request against `main` (`Refs #<issue>`). After maintainer review and merge, proceed to the next step."
   - **If we skip it:** Violates OpenRelik agent constraints and could cause automated harnesses to attempt unauthorized merges.

11. **Subcommand 3 tag push batching instruction** (`.agents/skills/release/SKILL.md`)
   - **What this is:** Subcommand 3 (`/release tag [commit]`) shows an example of pushing 3 tags, but does not explicitly instruct batching when more than 3 tags are created.
   - **Problem:** Spec requirement R4 requires enforcing batching of at most three tags per push.
   - **Fix:** Add explicit instruction in Subcommand 3 step 3 to push tags in batches of at most three.
   - **If we skip it:** Pushing more than 3 tags at once causes GitHub Actions workflows to silently fail to start.

## Nice to have

12. **Subshell syntax for worker patch locking** (`.agents/skills/release/SKILL.md`)
   - Use `(cd workers/<name> && uv lock --upgrade-package openrelik-worker-common)` instead of `cd ... && cd -`.

Verdict: fix 9, 10, and 11.
Lean: clean
Not checked: actual network publishing to PyPI and GitHub (`git push`, `gh release`, PyPI trusted publishing), which are simulated and gated by human approval.


# Review Round 4

Date: 2026-11-10
Checks run:
- uv run --python 3.12 .github/scripts/check-versions.py (passed, 0 errors)
- uv run pytest in dev/tools/devctl (passed, 41 passed)

What this change does: Adds the `release` skill to automate OpenRelik platform releases, component patches, tagging, and development cycle setup. Initializes the root `CHANGELOG.md` with version 0.18.0 and updates monorepo documentation to guide maintainers through release coordination with a mandatory human approval gate.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done

## Must fix

13. **Worker patch workflow references uncreated notes file** (`.agents/skills/release/SKILL.md:L211-220`)
   - **What this is:** Step 8 of `/release patch worker <name> <version>` executes `gh release create worker-<name>-v<version> ... --notes-file /tmp/release-notes-worker-<name>-<version>.md`.
   - **Problem:** Unlike the platform release and core patch release, the worker workflow never generates `/tmp/release-notes-worker-<name>-<version>.md` before step 8, nor does the approval gate present a release notes preview.
   - **Fix:** Add a preparation step before the approval gate to generate `/tmp/release-notes-worker-<name>-<version>.md`, and include the release notes preview in the step 8 approval gate.
   - **If we skip it:** Running the worker patch subcommand fails at the GitHub release publication step because the notes file does not exist.

## Should fix

14. **Stale draft publication command in Core Rule 1** (`.agents/skills/release/SKILL.md:L21-25`)
   - **What this is:** Core Rule 1 defines the boundaries of the mandatory human approval gate.
   - **Problem:** Line 24 lists `GitHub release publication (gh release edit --draft=false)`, which is a leftover from earlier review rounds before release creation was deferred to post-approval.
   - **Fix:** Replace `(gh release edit --draft=false)` with `(gh release create)` in line 24.
   - **If we skip it:** The core rules mention a command that is never used in the skill.

15. **Spec out of sync with code on release note drafting** (`dev/artifacts/features/release-skill/spec.md`)
   - **What this is:** `spec.md` specifies the requirements and verification for GitHub release notes drafting and approval.
   - **Problem:** Scope, R6, R7, T5, and Tests in `spec.md` specify `gh release create --draft` and `gh release edit --draft=false`, whereas the implementation was updated to prepare release notes in `/tmp/...` locally and execute `gh release create` post-approval.
   - **Fix:** Update `spec.md` (Scope, R6, R7, T5, Tests) to specify local release note drafting in `/tmp/` and post-approval `gh release create`.
   - **If we skip it:** The spec contradicts the release skill instructions.

## Nice to have

16. **Missing switch to main in platform release Stage 5** (`.agents/skills/release/SKILL.md:L136-138`)
   - Add explicit shell block `git switch main && git pull && git switch -c bump/dev-<next-minor>`.

Verdict: fix 13, 14, and 15 first.
Lean: clean
Not checked: Live remote GitHub tag push and release publication against remote GitHub infrastructure.


# Review Round 5

Date: 2026-11-10
Checks run:
- uv run --python 3.12 .github/scripts/check-versions.py (passed, 0 errors)
- uv run pytest in dev/tools/devctl (passed, 41 passed)

What this change does: Adds the `release` agent skill in `.agents/skills/release/SKILL.md` to coordinate OpenRelik platform releases, component patches, post-merge tagging, and development branch advances. Establishes the root `CHANGELOG.md` following Keep a Changelog standards, and automates multi-stage consumer dependency locking and release note preparation while enforcing a non-bypassable human approval gate before any remote pushes or GitHub release publication. Updates repository documentation across `AGENTS.md`, `dev/README.md`, `dev/RELEASING.md`, and `dev/PATCHING.md` to reference the skill.

## Requirements
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: done
- R7: done
- R8: done

Verdict: LGTM
Not checked: None.
