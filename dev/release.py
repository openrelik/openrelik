#!/usr/bin/env python3
"""Prepare a release: set the versions, commit and tag. It never pushes.

Usage (Python 3.11+, uv on PATH, a clean worktree):

  dev/release.py platform 0.18.0       a minor release, on release/0.18
  dev/release.py server 0.18.1         server/ (server, mediator, metrics, gcp-importer)
  dev/release.py ui 0.18.1             web/sunstone (the image openrelik-ui)
  dev/release.py lib common 0.18.1     libs/<name>: common, ai-common, worker-common, python-client
  dev/release.py mcp 0.18.1
  dev/release.py worker yara 0.18.3    workers/<name>
  dev/release.py dev 0.19.0            on main, after the release of 0.18.0
  dev/release.py tag [<commit>]        after merging a release pull request

Every component has its own patch releases; a minor is released for all of
them together. Installs follow the minor (0.18), so they get the newest patch
of every component.

platform X.Y.0 sets VERSION, server/pyproject.toml, web/*/package.json and mcp
to X.Y.0, the image versions in deploy/docker/config.env to the minor X.Y, and
adds X.Y to RELEASES in deploy/docker/install.sh. Commit "Release X.Y.0", tag
vX.Y.0 (the platform release; it builds nothing itself), server-vX.Y.0,
ui-vX.Y.0, mcp-vX.Y.0, and <lib>-vX.Y.0 / worker-<name>-vX.Y.0 for every
library and worker at X.Y.0 that isn't tagged yet.

server, ui, lib, mcp and worker set that component's version, commit and tag
server-v<version>, ui-v<version>, <lib>-v<version>, mcp-v<version> or
worker-<name>-v<version>.

dev X.Y.0 moves main to the next minor: VERSION, server, web UIs, libraries and
mcp to X.Y.0.dev0 (X.Y.0-dev in package.json), and adds the minor just
released to RELEASES in install.sh. It commits, without a tag.

Every change of a version runs uv lock in that project, and every release runs
dev/check-versions.py before committing.

Tags: on a release branch (release/*, pushed directly) a release is tagged
right away. On any other branch it goes through a pull request, which may be
squash-merged into a new commit, so it isn't tagged: after the merge, run
dev/release.py tag on the merged commit (default HEAD; git pull first). It tags
every component whose version that commit changed to a release version X.Y.Z
and that isn't tagged yet, reading the versions from the commit itself.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
LIBRARIES = ["common", "ai-common", "worker-common", "python-client"]
IMAGE_VERSION_RE = re.compile(
    r"^(OPENRELIK_(?:VERSION|WORKER_[A-Z0-9_]+_VERSION))=.*$",
    re.MULTILINE,
)


def fail(message):
    sys.exit(f"release: {message}")


def git(*args, capture=False):
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else None


def parse(version):
    match = RELEASE_RE.match(version)
    if not match:
        fail(f"{version!r} isn't a release version X.Y.Z")
    return tuple(int(part) for part in match.groups())


def project_version(path):
    match = re.search(r'(?m)^version = "([^"]*)"', path.read_text())
    if not match:
        fail(f"no version in {path.relative_to(ROOT)}")
    return match.group(1)


def set_pyproject_version(path, version):
    text = path.read_text()
    path.write_text(re.sub(r'(?m)^version = "[^"]*"', f'version = "{version}"', text, count=1))
    subprocess.run(["uv", "lock", "--quiet"], cwd=path.parent, check=True)
    return [path, path.parent / "uv.lock"]


def set_package_version(path, version):
    text = path.read_text()
    path.write_text(re.sub(r'"version": "[^"]*"', f'"version": "{version}"', text, count=1))
    return [path]


def tag_exists(tag):
    return bool(git("tag", "--list", tag, capture=True))


def check_new(prefix, version):
    """Fail if the tag exists or the version isn't above every released one."""
    tag = f"{prefix}{version}"
    if tag_exists(tag):
        fail(f"tag {tag} exists already")
    released = []
    for existing in git("tag", "--list", f"{prefix}*", capture=True).splitlines():
        match = RELEASE_RE.match(existing[len(prefix):])
        if match:
            released.append(tuple(int(part) for part in match.groups()))
    if released and parse(version) <= max(released):
        fail(f"{tag} isn't above the newest release {prefix}{'.'.join(map(str, max(released)))}")
    return tag


def platform_files(version, npm_version):
    files = [ROOT / "VERSION"]
    (ROOT / "VERSION").write_text(version + "\n")
    files += set_pyproject_version(ROOT / "server" / "pyproject.toml", version)
    for package in sorted(ROOT.glob("web/*/package.json")):
        files += set_package_version(package, npm_version)
    return files


def add_release(minor):
    """Add a minor to the front of RELEASES in install.sh."""
    path = ROOT / "deploy" / "docker" / "install.sh"
    text = path.read_text()
    match = re.search(r"(?m)^RELEASES=\((.*)\)$", text)
    if not match:
        fail("no RELEASES=(...) in deploy/docker/install.sh")
    releases = re.findall(r'"([^"]+)"', match.group(1))
    if minor not in releases:
        releases.insert(0, minor)
    line = "RELEASES=(" + " ".join(f'"{r}"' for r in releases) + ")"
    path.write_text(text[: match.start()] + line + text[match.end():])
    return [path]


def release_platform(version):
    major, minor, patch = parse(version)
    if patch != 0:
        fail("platform releases a minor (X.Y.0); release a patch with server, ui, mcp, lib or worker")
    minor_name = f"{major}.{minor}"
    tags = [check_new(prefix, version) for prefix in ("v", "server-v", "ui-v", "mcp-v")]
    files = platform_files(version, version)
    files += set_pyproject_version(ROOT / "mcp" / "pyproject.toml", version)

    config = ROOT / "deploy" / "docker" / "config.env"
    config.write_text(IMAGE_VERSION_RE.sub(lambda m: f"{m.group(1)}={minor_name}", config.read_text()))
    files.append(config)
    files += add_release(minor_name)

    for name in LIBRARIES:
        pyproject = ROOT / "libs" / name / "pyproject.toml"
        if project_version(pyproject) == version and not tag_exists(f"{name}-v{version}"):
            tags.append(f"{name}-v{version}")
    for pyproject in sorted(ROOT.glob("workers/*/pyproject.toml")):
        name = pyproject.parent.name
        if project_version(pyproject) == version and not tag_exists(f"worker-{name}-v{version}"):
            tags.append(f"worker-{name}-v{version}")

    branch = git("branch", "--show-current", capture=True)
    if branch != f"release/{minor_name}":
        print(f"note: on {branch}, not release/{minor_name}")
    return files, f"Release {version}", tags


def release_ui(version):
    tag = check_new("ui-v", version)
    files = set_package_version(ROOT / "web" / "sunstone" / "package.json", version)
    return files, f"Release the UI {version}", [tag]


def release_project(directory, prefix, version, label):
    pyproject = directory / "pyproject.toml"
    if not pyproject.exists():
        fail(f"no {pyproject.relative_to(ROOT)}")
    tag = check_new(prefix, version)
    return set_pyproject_version(pyproject, version), f"Release {label} {version}", [tag]


def start_development(version):
    major, minor, patch = parse(version)
    if patch != 0:
        fail("dev takes the next minor, X.Y.0")
    current = (ROOT / "VERSION").read_text().strip()
    current_match = re.match(r"^(\d+)\.(\d+)\.\d+", current)
    if not current_match or (major, minor) <= tuple(map(int, current_match.groups())):
        fail(f"{version} isn't a minor above VERSION {current}")
    files = platform_files(f"{version}.dev0", f"{version}-dev")
    for pyproject in [*sorted(ROOT.glob("libs/*/pyproject.toml")), ROOT / "mcp" / "pyproject.toml"]:
        files += set_pyproject_version(pyproject, f"{version}.dev0")
    released = f"{current_match.group(1)}.{current_match.group(2)}"
    if tag_exists(f"v{released}.0"):
        files += add_release(released)
    else:
        print(f"note: v{released}.0 isn't tagged, so {released} isn't added to RELEASES")
    return files, f"Start {major}.{minor} development", []


def show(commit, path):
    """A file's content at a commit, or None if it doesn't exist there."""
    result = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, text=True, capture_output=True)
    return result.stdout if result.returncode == 0 else None


def version_at(commit, path):
    text = show(commit, path)
    if text is None:
        return None
    if path == "VERSION":
        return text.strip()
    if path.endswith(".json"):
        return json.loads(text).get("version")
    match = re.search(r'(?m)^version = "([^"]*)"', text)
    return match.group(1) if match else None


def components(commit):
    """(tag prefix, manifest, label) of every released component at a commit."""
    found = [("v", "VERSION", "the platform"), ("server-v", "server/pyproject.toml", "the server"),
             ("ui-v", "web/sunstone/package.json", "the UI"), ("mcp-v", "mcp/pyproject.toml", "the MCP server")]
    found += [(f"{name}-v", f"libs/{name}/pyproject.toml", f"library {name}") for name in LIBRARIES]
    paths = git("ls-tree", "--name-only", f"{commit}:workers", capture=True).splitlines()
    found += [(f"worker-{name}-v", f"workers/{name}/pyproject.toml", f"worker {name}")
              for name in paths if show(commit, f"workers/{name}/pyproject.toml") is not None]
    return found


def tag_commit(commit):
    sha = git("rev-parse", "--verify", f"{commit}^{{commit}}", capture=True)
    parent = git("rev-parse", "--verify", f"{sha}^1", capture=True)
    tags = []
    for prefix, manifest, label in components(sha):
        version = version_at(sha, manifest)
        if not version or not RELEASE_RE.match(version) or version == version_at(parent, manifest):
            continue
        tag = f"{prefix}{version}"
        if tag_exists(tag):
            print(f"note: {tag} exists already")
            continue
        git("tag", "-a", tag, "-m", f"Release {label} {version} ({tag})", sha)
        tags.append(tag)
    if not tags:
        fail(f"{sha[:7]} changes no version to an untagged release X.Y.Z; nothing to tag")
    print(f"tagged {sha[:7]}: " + " ".join(tags))
    print("\nNothing is pushed. Push the tags (at most three at a time; GitHub starts no")
    print("workflow for tags pushed more than three at once):")
    for start in range(0, len(tags), 3):
        print("  git push origin " + " ".join(tags[start:start + 3]))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("platform").add_argument("version")
    commands.add_parser("server").add_argument("version")
    commands.add_parser("ui").add_argument("version")
    lib = commands.add_parser("lib")
    lib.add_argument("name", choices=LIBRARIES)
    lib.add_argument("version")
    commands.add_parser("mcp").add_argument("version")
    worker = commands.add_parser("worker")
    worker.add_argument("name")
    worker.add_argument("version")
    commands.add_parser("dev").add_argument("version")
    commands.add_parser("tag").add_argument("commit", nargs="?", default="HEAD")
    args = parser.parse_args()

    if args.command == "tag":
        tag_commit(args.commit)
        return

    if git("status", "--porcelain", capture=True):
        fail("the worktree isn't clean")
    parse(args.version)

    if args.command == "platform":
        files, message, tags = release_platform(args.version)
    elif args.command == "server":
        files, message, tags = release_project(ROOT / "server", "server-v", args.version, "the server")
    elif args.command == "ui":
        files, message, tags = release_ui(args.version)
    elif args.command == "lib":
        package = re.search(r'(?m)^name = "([^"]*)"', (ROOT / "libs" / args.name / "pyproject.toml").read_text())
        files, message, tags = release_project(ROOT / "libs" / args.name, f"{args.name}-v", args.version, package.group(1))
    elif args.command == "mcp":
        files, message, tags = release_project(ROOT / "mcp", "mcp-v", args.version, "the MCP server")
    elif args.command == "worker":
        files, message, tags = release_project(ROOT / "workers" / args.name, f"worker-{args.name}-v", args.version, f"worker {args.name}")
    else:
        files, message, tags = start_development(args.version)

    check = subprocess.run([sys.executable, str(ROOT / "dev" / "check-versions.py")], cwd=ROOT)
    if check.returncode != 0:
        git("checkout", "--", *[str(f) for f in files])
        fail("dev/check-versions.py failed; the changes are reverted")

    git("add", "--", *[str(f) for f in files])
    git("commit", "--quiet", "-m", message)
    branch = git("branch", "--show-current", capture=True)
    print(f"\ncommitted: {message}")
    if tags and not branch.startswith("release/"):
        # A pull request may be squash-merged into a new commit: tag after the merge.
        print("not tagged: on a branch for a pull request (" + " ".join(tags) + ")")
        print("\nNothing is pushed. Check the commit (git show), push the branch and open a")
        print("pull request. After it's merged, tag the merged commit and push the tags:")
        print(f"  git push origin {branch}")
        print("  git switch main && git pull && dev/release.py tag")
        return
    for tag in tags:
        git("tag", "-a", tag, "-m", f"{message} ({tag})")
    if tags:
        print("tagged:    " + " ".join(tags))
    print("\nNothing is pushed. Check the commit (git show), then push:")
    print(f"  git push origin {branch}")
    # GitHub starts no workflow for tags pushed more than three at a time.
    for start in range(0, len(tags), 3):
        print("  git push origin " + " ".join(tags[start:start + 3]))


if __name__ == "__main__":
    main()
