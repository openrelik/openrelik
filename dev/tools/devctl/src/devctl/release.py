# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Prepare a release: set versions, commit, and tag.

Integrates release preparation workflows directly into devctl.
Runs .github/scripts/check-versions.py as a gate before committing.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

from devctl import ui

RELEASE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
LIBRARIES = ["common", "ai-common", "worker-common", "python-client"]
IMAGE_VERSION_RE = re.compile(
    r"^(OPENRELIK_(?:VERSION|WORKER_[A-Z0-9_]+_VERSION))=.*$",
    re.MULTILINE,
)


def git(root: Path, *args: str, capture: bool = False, check: bool = True) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), *args], check=check, text=True, capture_output=capture
    )
    if not check and result.returncode != 0:
        return None
    return result.stdout.strip() if capture else None


def parse_version(version: str) -> tuple[int, int, int]:
    match = RELEASE_RE.match(version)
    if not match:
        ui.die(f"{version!r} isn't a release version X.Y.Z")
    return tuple(int(part) for part in match.groups())


def project_version(root: Path, path: Path) -> str:
    match = re.search(r'(?m)^version = "([^"]*)"', path.read_text())
    if not match:
        ui.die(f"no version in {path.relative_to(root)}")
    return match.group(1)


def set_pyproject_version(path: Path, version: str) -> list[Path]:
    text = path.read_text()
    path.write_text(re.sub(r'(?m)^version = "[^"]*"', f'version = "{version}"', text, count=1))
    subprocess.run(["uv", "lock", "--quiet"], cwd=path.parent, check=True)
    return [path, path.parent / "uv.lock"]


def set_package_version(path: Path, version: str) -> list[Path]:
    text = path.read_text()
    path.write_text(re.sub(r'"version": "[^"]*"', f'"version": "{version}"', text, count=1))
    return [path]


def tag_exists(root: Path, tag: str) -> bool:
    return bool(git(root, "tag", "--list", tag, capture=True))


def check_new(root: Path, prefix: str, version: str) -> str:
    """Fail if the tag exists or the version isn't above every released one."""
    tag = f"{prefix}{version}"
    if tag_exists(root, tag):
        ui.die(f"tag {tag} exists already")
    released: list[tuple[int, int, int]] = []
    output = git(root, "tag", "--list", f"{prefix}*", capture=True) or ""
    for existing in output.splitlines():
        match = RELEASE_RE.match(existing[len(prefix):])
        if match:
            released.append(tuple(int(part) for part in match.groups()))
    if released and parse_version(version) <= max(released):
        ui.die(f"{tag} isn't above the newest release {prefix}{'.'.join(map(str, max(released)))}")
    return tag


def platform_files(root: Path, version: str, npm_version: str) -> list[Path]:
    files = [root / "VERSION"]
    (root / "VERSION").write_text(version + "\n")
    files += set_pyproject_version(root / "server" / "pyproject.toml", version)
    for package in sorted(root.glob("web/*/package.json")):
        files += set_package_version(package, npm_version)
    return files


def add_release(root: Path, minor: str) -> list[Path]:
    """Add a minor to the front of RELEASES in install.sh."""
    path = root / "deploy" / "docker" / "install.sh"
    text = path.read_text()
    match = re.search(r"(?m)^RELEASES=\((.*)\)$", text)
    if not match:
        ui.die("no RELEASES=(...) in deploy/docker/install.sh")
    releases = re.findall(r'"([^"]+)"', match.group(1))
    if minor not in releases:
        releases.insert(0, minor)
    line = "RELEASES=(" + " ".join(f'"{r}"' for r in releases) + ")"
    path.write_text(text[: match.start()] + line + text[match.end():])
    return [path]


def check_clean_worktree(root: Path) -> None:
    if git(root, "status", "--porcelain", capture=True):
        ui.die("the worktree isn't clean")


def run_version_check_gate(root: Path, files: list[Path]) -> None:
    """Run .github/scripts/check-versions.py; revert files on failure."""
    check_script = root / ".github" / "scripts" / "check-versions.py"
    check = subprocess.run([sys.executable, str(check_script)], cwd=root)
    if check.returncode != 0:
        subprocess.run(["git", "-C", str(root), "checkout", "--", *[str(f) for f in files]], check=True)
        ui.die(".github/scripts/check-versions.py failed; the changes are reverted")


def commit_release(root: Path, files: list[Path], message: str, tags: list[str]) -> None:
    run_version_check_gate(root, files)
    git(root, "add", "--", *[str(f) for f in files])
    git(root, "commit", "--quiet", "-m", message)
    branch = git(root, "branch", "--show-current", capture=True)
    print(f"\ncommitted: {message}")
    if tags and (not branch or not branch.startswith("release/")):
        # A pull request may be squash-merged into a new commit: tag after the merge.
        print("not tagged: on a branch for a pull request (" + " ".join(tags) + ")")
        print("\nNothing is pushed. Check the commit (git show), push the branch and open a")
        print("pull request. After it's merged, tag the merged commit and push the tags:")
        print(f"  git push origin {branch}")
        print("  git switch main && git pull && ./devctl release tag")
        return
    for tag in tags:
        git(root, "tag", "-a", tag, "-m", f"{message} ({tag})")
    if tags:
        print("tagged:    " + " ".join(tags))
    print("\nNothing is pushed. Check the commit (git show), then push:")
    print(f"  git push origin {branch}")
    # GitHub starts no workflow for tags pushed more than three at a time.
    for start in range(0, len(tags), 3):
        print("  git push origin " + " ".join(tags[start:start + 3]))


def release_platform(root: Path, version: str) -> None:
    check_clean_worktree(root)
    major, minor, patch = parse_version(version)
    if patch != 0:
        ui.die("platform releases a minor (X.Y.0); release a patch with server, ui, mcp, lib or worker")
    minor_name = f"{major}.{minor}"
    tags = [check_new(root, prefix, version) for prefix in ("v", "server-v", "ui-v", "mcp-v")]
    files = platform_files(root, version, version)
    files += set_pyproject_version(root / "mcp" / "pyproject.toml", version)

    config = root / "deploy" / "docker" / "config.env"
    config.write_text(IMAGE_VERSION_RE.sub(lambda m: f"{m.group(1)}={minor_name}", config.read_text()))
    files.append(config)
    files += add_release(root, minor_name)

    for name in LIBRARIES:
        pyproject = root / "libs" / name / "pyproject.toml"
        if pyproject.exists() and project_version(root, pyproject) == version and not tag_exists(root, f"{name}-v{version}"):
            tags.append(f"{name}-v{version}")
    for pyproject in sorted(root.glob("workers/*/pyproject.toml")):
        name = pyproject.parent.name
        if pyproject.exists() and project_version(root, pyproject) == version and not tag_exists(root, f"worker-{name}-v{version}"):
            tags.append(f"worker-{name}-v{version}")

    branch = git(root, "branch", "--show-current", capture=True)
    if branch != f"release/{minor_name}":
        print(f"note: on {branch}, not release/{minor_name}")
    commit_release(root, files, f"Release {version}", tags)


def _release_project(root: Path, directory: Path, prefix: str, version: str, label: str) -> None:
    check_clean_worktree(root)
    parse_version(version)
    pyproject = directory / "pyproject.toml"
    if not pyproject.exists():
        ui.die(f"no {pyproject.relative_to(root)}")
    tag = check_new(root, prefix, version)
    files = set_pyproject_version(pyproject, version)
    commit_release(root, files, f"Release {label} {version}", [tag])


def release_ui(root: Path, version: str) -> None:
    check_clean_worktree(root)
    parse_version(version)
    tag = check_new(root, "ui-v", version)
    files = set_package_version(root / "web" / "sunstone" / "package.json", version)
    commit_release(root, files, f"Release the UI {version}", [tag])


def release_server(root: Path, version: str) -> None:
    _release_project(root, root / "server", "server-v", version, "the server")


def release_lib(root: Path, name: str, version: str) -> None:
    pyproject = root / "libs" / name / "pyproject.toml"
    package = re.search(r'(?m)^name = "([^"]*)"', pyproject.read_text()) if pyproject.exists() else None
    label = package.group(1) if package else name
    _release_project(root, root / "libs" / name, f"{name}-v", version, label)


def release_mcp(root: Path, version: str) -> None:
    _release_project(root, root / "mcp", "mcp-v", version, "the MCP server")


def release_worker(root: Path, name: str, version: str) -> None:
    _release_project(root, root / "workers" / name, f"worker-{name}-v", version, f"worker {name}")


def start_development(root: Path, version: str) -> None:
    check_clean_worktree(root)
    major, minor, patch = parse_version(version)
    if patch != 0:
        ui.die("dev takes the next minor, X.Y.0")
    current = (root / "VERSION").read_text().strip()
    current_match = re.match(r"^(\d+)\.(\d+)\.\d+", current)
    if not current_match or (major, minor) <= tuple(map(int, current_match.groups())):
        ui.die(f"{version} isn't a minor above VERSION {current}")
    files = platform_files(root, f"{version}.dev0", f"{version}-dev")
    for pyproject in [*sorted(root.glob("libs/*/pyproject.toml")), root / "mcp" / "pyproject.toml"]:
        files += set_pyproject_version(pyproject, f"{version}.dev0")
    released = f"{current_match.group(1)}.{current_match.group(2)}"
    if tag_exists(root, f"v{released}.0"):
        files += add_release(root, released)
    else:
        print(f"note: v{released}.0 isn't tagged, so {released} isn't added to RELEASES")
    commit_release(root, files, f"Start {major}.{minor} development", [])


def show(root: Path, commit: str, path: str) -> str | None:
    """A file's content at a commit, or None if it doesn't exist there."""
    result = subprocess.run(
        ["git", "-C", str(root), "show", f"{commit}:{path}"],
        text=True,
        capture_output=True,
    )
    return result.stdout if result.returncode == 0 else None


def version_at(root: Path, commit: str, path: str) -> str | None:
    text = show(root, commit, path)
    if text is None:
        return None
    if path == "VERSION":
        return text.strip()
    if path.endswith(".json"):
        return json.loads(text).get("version")
    match = re.search(r'(?m)^version = "([^"]*)"', text)
    return match.group(1) if match else None


def components(root: Path, commit: str) -> list[tuple[str, str, str]]:
    """(tag prefix, manifest, label) of every released component at a commit."""
    found = [
        ("v", "VERSION", "the platform"),
        ("server-v", "server/pyproject.toml", "the server"),
        ("ui-v", "web/sunstone/package.json", "the UI"),
        ("mcp-v", "mcp/pyproject.toml", "the MCP server"),
    ]
    found += [(f"{name}-v", f"libs/{name}/pyproject.toml", f"library {name}") for name in LIBRARIES]
    workers_tree = git(root, "ls-tree", "--name-only", f"{commit}:workers", capture=True, check=False)
    paths = workers_tree.splitlines() if workers_tree else []
    found += [
        (f"worker-{name}-v", f"workers/{name}/pyproject.toml", f"worker {name}")
        for name in paths
        if show(root, commit, f"workers/{name}/pyproject.toml") is not None
    ]
    return found


def tag_commit(root: Path, commit: str = "HEAD") -> None:
    sha = git(root, "rev-parse", "--verify", f"{commit}^{{commit}}", capture=True)
    parent = git(root, "rev-parse", "--verify", f"{sha}^1", capture=True)
    tags: list[str] = []
    for prefix, manifest, label in components(root, sha):
        version = version_at(root, sha, manifest)
        if not version or not RELEASE_RE.match(version) or version == version_at(root, parent, manifest):
            continue
        tag = f"{prefix}{version}"
        if tag_exists(root, tag):
            print(f"note: {tag} exists already")
            continue
        git(root, "tag", "-a", tag, "-m", f"Release {label} {version} ({tag})", sha)
        tags.append(tag)
    if not tags:
        ui.die(f"{sha[:7]} changes no version to an untagged release X.Y.Z; nothing to tag")
    print(f"tagged {sha[:7]}: " + " ".join(tags))
    print("\nNothing is pushed. Push the tags (at most three at a time; GitHub starts no")
    print("workflow for tags pushed more than three at once):")
    for start in range(0, len(tags), 3):
        print("  git push origin " + " ".join(tags[start:start + 3]))
