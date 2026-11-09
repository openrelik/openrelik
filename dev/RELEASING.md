# Platform releases

How to release a new minor of OpenRelik, using 0.19.0 as the example. A minor releases
everything at once: the server, the web UI, the four libraries, the MCP server and every
worker all get 0.19.0. For a fix to one component in between, see
[PATCHING.md](PATCHING.md).

You can run this workflow with an agent using `/release platform <version>`
(`.agents/skills/release/SKILL.md`), which automates these stages and stops for
approval before pushing, or follow the steps below by hand.

## Order matters

The libraries go out first. The server, the MCP server and the workers install them from
PyPI, so their `~=0.19.0` dependencies can't be locked until 0.19.0 is on PyPI. After
that come the consumers, then the platform itself, and last `main` moves on to 0.20.

`./devctl release` sets versions, runs `uv lock` and `.github/scripts/check-versions.py`, commits and
tags. It never pushes. `main` only takes pull requests, and those are squash-merged, so
the release commit you make on a branch isn't the one that lands. That's why every step
on `main` ends with `./devctl release tag` on the merged commit.

When pushing tags, push three at most at a time. With more, GitHub starts no workflows
for them. `./devctl release` prints the pushes already grouped.

## Steps

1. **Release the libraries.** On a branch from `main`:

   ```sh
   ./devctl release lib common 0.19.0
   ./devctl release lib ai-common 0.19.0
   ./devctl release lib worker-common 0.19.0
   ./devctl release lib python-client 0.19.0
   ```

   Release all four, even the ones with no changes since 0.18. Open a pull request and
   merge it. Then tag the merged commit and push the four tags:

   ```sh
   git switch main && git pull
   ./devctl release tag
   ```

   "Publish Python Packages" uploads them to PyPI. Check that all four are there before
   going on.

2. **Move the consumers to 0.19.** In one pull request on `main`, change the library
   dependencies of the server, the MCP server and every worker to `~=0.19.0`, set every
   worker's version to `0.19.0`, and run `uv lock` in each. There's no command for this
   yet, so it's edits by hand. Don't tag anything after the merge, because the workers get
   tagged with the platform in the next step.

3. **Cut the release branch and release the platform.**

   ```sh
   git switch main && git pull
   git switch -c release/0.19
   ./devctl release platform 0.19.0
   ```

   This sets `VERSION`, the server, the web UIs and the MCP server to 0.19.0, points the
   images in `deploy/docker/config.env` at `0.19`, and adds `"0.19"` to `RELEASES` in
   `install.sh`. It commits "Release 0.19.0" and tags `v0.19.0`, `server-v0.19.0`,
   `ui-v0.19.0`, `mcp-v0.19.0` and every worker at 0.19.0.

4. **Push the branch, then the tags.**

   ```sh
   git push origin release/0.19
   ```

   Wait for "Python Unit Tests" and "Frontend Unit Tests [sunstone]" to pass on
   `release/0.19`. Then push the tags in the groups `./devctl release` printed. CI builds
   every image as `0.19.0` and `0.19`.

   The installer downloads 0.19's deployment files from `release/0.19`, so this branch
   stays on the remote for good.

5. **Start 0.20 on `main`.** On a branch from `main`:

   ```sh
   ./devctl release dev 0.20.0
   ```

   This moves `VERSION`, the server, the web UIs, the libraries and the MCP server to
   `0.20.0.dev0` and adds 0.19 to the installer on `main`. Open a pull request and merge
   it. Nothing gets tagged.

6. **Write the release notes.** Create a GitHub release for `v0.19.0`. Include a "For
   worker authors" section with what changed in `openrelik-worker-common` and what
   external workers need to do to move to 0.19.

## Checks before you call it done

- All four libraries are on PyPI at 0.19.0.
- Every image exists as `0.19.0` and `0.19` on GHCR.
- A fresh install with `deploy/docker/install.sh` offers 0.19 and comes up.
- If the server has a migration, the release notes say how to run it when upgrading.

## Not covered yet

- Step 2 has no standalone CLI command; the `/release platform` skill automates it.
- Releases update root `CHANGELOG.md` in addition to GitHub release notes.
- The worker compatibility check (`compat.py`, the server-side check and the bump pull
  requests) isn't built, so external workers find out about a new minor from the release
  notes.
