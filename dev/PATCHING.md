# Patch releases

How to ship a fix as a patch release, for example `openrelik-worker-common` 0.18.1.
The same steps work for the server, the UI, the other libraries and the MCP server.
Workers are different, see [Workers](#workers) at the end. For a new minor, see
[RELEASING.md](RELEASING.md).

You can run this workflow with an agent using `/release patch <component> <version>`
(`.agents/skills/release/SKILL.md`), which coordinates cherry-picking, release
commits, and tagging, or follow the steps below by hand.

## How the branches work

`main` is where the next minor gets built, so right now it holds 0.19 work. Every minor
also has its own branch, `release/0.18` for 0.18, cut from `main` on the day 0.18.0 came
out. Patches for 0.18 are released from that branch.

A patch only contains what you cherry-pick onto `release/0.18`. Whatever else went into
`main` for 0.19 stays out, so 0.18.1 is 0.18.0 plus your fix and nothing more.

Don't delete release branches. The ruleset blocks it anyway, and
`deploy/docker/install.sh` downloads each minor's deployment files from its branch.

## Steps

1. **Fix it on `main` first.** Open a pull request with the fix and merge it. Fixing
   `main` first means the bug can't come back in 0.19.

   A patch must not break anything, and it can only use what the server already had in
   0.18.0. A fix that needs anything newer has to wait for 0.19.0.

2. **Cherry-pick the fix onto the release branch.**

   ```sh
   git switch release/0.18 && git pull
   git cherry-pick -x <commit on main>
   ```

   Pull requests are squash-merged, so there's one commit to pick. If it's a merge
   commit, add `-m 1`. When the pick conflicts because the code changed for 0.19, resolve
   it by hand and keep only the fix.

3. **Make the release commit.**

   ```sh
   ./devctl release lib worker-common 0.18.1
   ```

   This sets the version, runs `uv lock` and `.github/scripts/check-versions.py`, commits, and tags
   `worker-common-v0.18.1`. Nothing gets pushed. For other components use `server`, `ui`
   or `mcp` instead of `lib <name>`.

4. **Push the branch and wait for the tests.**

   ```sh
   git push origin release/0.18
   ```

   Wait for "Python Unit Tests" and "Frontend Unit Tests [sunstone]" to pass on
   `release/0.18`.

5. **Push the tag.**

   ```sh
   git push origin worker-common-v0.18.1
   ```

   A library tag makes "Publish Python Packages" upload it to PyPI. A server, UI or MCP
   tag builds the image as `0.18.1` and moves its `0.18` tag, and existing installs pick
   it up with `docker compose pull && docker compose up -d`.

   Tags can't be moved or deleted. If a build fails, re-run it instead of tagging again.

## Workers

External workers depend on `openrelik-worker-common~=0.18.0`, so they get 0.18.1 the
next time they install or re-lock. Our own worker images install from their lockfiles,
which means a worker only gets the fix when you release it again.

Workers are released from `main` through a pull request:

```sh
cd workers/<name> && uv lock --upgrade-package openrelik-worker-common && cd -
./devctl release worker <name> 0.18.2
```

Open the pull request and merge it. Then tag the merged commit and push the tags, three
at most per push (with more, GitHub starts no workflows):

```sh
git switch main && git pull
./devctl release tag
```

## Not covered yet

- Patches are supposed to be tested against the `0.18.0` images. There's no automated
  test for that yet, so check by hand.
- Releases update root `CHANGELOG.md` in addition to GitHub release notes.
- A worker patch for an older minor, once `main` has moved its workers on, needs a branch
  from that worker's last tag. The tooling doesn't handle that.
