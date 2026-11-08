#!/usr/bin/env python3
"""Reads .github/images.toml: checks it, and selects the images a CI run builds.

  images.py check
      Fails if a Dockerfile in the repository is neither an image in
      .github/images.toml nor listed under [not-published], or if an entry is broken.

  images.py matrix --registry ghcr.io/openrelik --sha <short-id>
                   (--all | --changed <file> | --only <name> ...)
      Prints the GitHub Actions matrix (JSON) of the images to build: all of
      them, those whose context contains a path listed in <file> (one per
      line, as from git diff --name-only), or the ones named.

  images.py matrix --registry ghcr.io/openrelik --tag <git tag>
      The release build of a git tag: server-v0.18.1 builds the images from
      server/ (server, mediator, metrics, gcp-importer), ui-v0.18.1 the web UI
      (web/sunstone), mcp-v0.18.1 the MCP server, worker-<name>-v0.18.1 that
      worker (not its variants). The platform tag v0.18.0 and the library tags
      (common-v*, worker-common-v*, ...) build nothing. Each image is tagged
      0.18.1, and also 0.18 if 0.18.1 is the highest released 0.18.x of that
      component, so rebuilding an older release doesn't move the minor tag
      back. Fails if the tag's version isn't the version in the component's
      manifest.

Run by .github/workflows/images.yml. Needs Python 3.11 or newer (tomllib).
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tomllib

# This file is .github/scripts/images.py; the repository root is three levels up.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIST = os.path.join(ROOT, ".github", "images.toml")


def load():
    with open(LIST, "rb") as f:
        return tomllib.load(f)


def images(config):
    """Every build: one per image, plus one per worker variant."""
    builds = []
    for group in ("platform", "mcp"):
        for entry in config.get(group, []):
            builds.append(dict(group=group, name=entry["name"], dockerfile=entry["dockerfile"],
                               context=entry["context"], tags=["latest", *entry.get("extra-tags", [])],
                               build_args={}, suffix=""))
    workers = config.get("workers", {})
    found = {}
    for dockerfile in sorted(glob.glob(workers.get("discover", ""), root_dir=ROOT)):
        worker = dockerfile.split("/")[-2]
        found[worker] = dockerfile
        builds.append(dict(group="workers", name=f"openrelik-worker-{worker}", dockerfile=dockerfile,
                           context=os.path.dirname(dockerfile), tags=["latest"], build_args={},
                           suffix=""))
    for variant in workers.get("variants", []):
        worker = variant["worker"]
        if worker not in found:
            sys.exit(f".github/images.toml: variant for unknown worker {worker!r}")
        builds.append(dict(group="workers", name=f"openrelik-worker-{worker}",
                           dockerfile=found[worker], context=os.path.dirname(found[worker]),
                           tags=[variant["tag"]], build_args=variant.get("build-args", {}),
                           suffix="-" + variant["tag"].removeprefix("latest-")))
    return builds


def tracked_dockerfiles():
    out = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True,
                         check=True).stdout.split()
    return sorted(p for p in out
                  if (base := os.path.basename(p)) == "Dockerfile"
                  or base.startswith("Dockerfile.") or base.endswith(".Dockerfile"))


def check():
    config = load()
    builds = images(config)
    problems = []
    for b in builds:
        for key in ("dockerfile", "context"):
            if not os.path.exists(os.path.join(ROOT, b[key])):
                problems.append(f"{b['name']}: {key} {b[key]} doesn't exist")
        if not b["dockerfile"].startswith(b["context"] + "/"):
            problems.append(f"{b['name']}: dockerfile {b['dockerfile']} is outside its context")
    seen = set()
    for b in builds:
        key = (b["name"], tuple(b["tags"]))
        if key in seen:
            problems.append(f"{b['name']}: listed twice with tags {', '.join(b['tags'])}")
        seen.add(key)
    listed = {b["dockerfile"] for b in builds} | set(config.get("not-published", {}))
    for path in tracked_dockerfiles():
        if path not in listed:
            problems.append(f"{path} is not in .github/images.toml: add it as an image, or under "
                            "[not-published] with the reason")
    for path in config.get("not-published", {}):
        if not os.path.exists(os.path.join(ROOT, path)):
            problems.append(f"[not-published]: {path} doesn't exist")
    if problems:
        sys.exit(".github/images.toml:\n" + "\n".join(f"  - {p}" for p in problems))
    names = {b["name"] for b in builds}
    print(f".github/images.toml: {len(names)} images ({len(builds)} builds), every Dockerfile listed")


# Tags that build no image: libraries (published to PyPI) and the platform
# release v0.18.0, which marks a minor; its images come from the server-v and
# ui-v tags made with it.
NO_IMAGES = re.compile(r"^((common|ai-common|worker-common|python-client)-v|v\d)")
RELEASE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

# Platform components released on their own: tag prefix -> (manifest, context
# of its images in .github/images.toml).
PLATFORM = {
    "server": ("server/pyproject.toml", "server"),
    "ui": ("web/sunstone/package.json", "web/sunstone"),
}


def manifest_version(path):
    with open(os.path.join(ROOT, path), "rb") as f:
        if path.endswith(".json"):
            return json.load(f)["version"]
        return tomllib.load(f)["project"]["version"]


def released(prefix):
    """The X.Y.Z versions of the git tags <prefix>X.Y.Z, as tuples."""
    out = subprocess.run(["git", "-C", ROOT, "tag", "--list", f"{prefix}*"], capture_output=True,
                         text=True, check=True).stdout.split()
    return [tuple(map(int, m.groups())) for t in out if (m := RELEASE.match(t[len(prefix):]))]


def release(builds, tag):
    """The builds of a release tag, and the image tags to push."""
    if NO_IMAGES.match(tag):
        return [], []
    if (m := re.match(r"^(server|ui)-v(.+)$", tag)):
        prefix, version = f"{m.group(1)}-v", m.group(2)
        manifest, context = PLATFORM[m.group(1)]
        selected = [b for b in builds if b["group"] == "platform" and b["context"] == context]
    elif m := re.match(r"^mcp-v(.+)$", tag):
        prefix, version = "mcp-v", m.group(1)
        manifest = "mcp/pyproject.toml"
        selected = [b for b in builds if b["group"] == "mcp"]
    elif m := re.match(r"^worker-([a-z0-9-]+)-v(.+)$", tag):
        prefix, version = f"worker-{m.group(1)}-v", m.group(2)
        manifest = f"workers/{m.group(1)}/pyproject.toml"
        if not os.path.exists(os.path.join(ROOT, manifest)):
            sys.exit(f"{tag}: there's no worker {m.group(1)!r}")
        selected = [b for b in builds if b["name"] == f"openrelik-worker-{m.group(1)}" and not b["suffix"]]
    else:
        sys.exit(f"{tag} isn't a release tag (server-v*, ui-v*, mcp-v*, worker-<name>-v*)")
    parsed = RELEASE.match(version)
    if not parsed:
        sys.exit(f"{tag}: {version!r} isn't a release version X.Y.Z")
    expected = manifest_version(manifest)
    if version != expected:
        sys.exit(f"{tag}: the version is {version}, but {manifest} says {expected}")
    current = tuple(map(int, parsed.groups()))
    same_minor = [r for r in released(prefix) if r[:2] == current[:2]]
    tags = [version]
    if current >= max(same_minor, default=current):
        tags.append(f"{current[0]}.{current[1]}")
    else:
        newest = ".".join(map(str, max(same_minor)))
        print(f"{prefix}{newest} is newer; {current[0]}.{current[1]} isn't moved", file=sys.stderr)
    return selected, tags


def matrix(args):
    builds = images(load())
    if args.tag:
        selected, tags = release(builds, args.tag)
        rows = [dict(name=b["name"], image=f"{args.registry}/{b['name']}", dockerfile=b["dockerfile"],
                     context=b["context"],
                     tags="\n".join(f"{args.registry}/{b['name']}:{t}" for t in tags),
                     build_args="", label=f"{b['name']} ({', '.join(tags)})")
                for b in selected]
        print(json.dumps(rows))
        return
    if args.all:
        selected = builds
    elif args.only:
        unknown = set(args.only) - {b["name"] for b in builds}
        if unknown:
            sys.exit(f"unknown images: {', '.join(sorted(unknown))}")
        selected = [b for b in builds if b["name"] in args.only]
    else:
        changed = [line.strip() for line in open(args.changed) if line.strip()]
        selected = [b for b in builds if any(p.startswith(b["context"] + "/") for p in changed)]
    rows = []
    for b in selected:
        ref = f"{args.registry}/{b['name']}"
        tags = [f"{ref}:{t}" for t in b["tags"]] + [f"{ref}:{args.sha}{b['suffix']}"]
        rows.append(dict(
            name=b["name"], image=ref, dockerfile=b["dockerfile"], context=b["context"],
            tags="\n".join(tags),
            build_args="\n".join(f"{k}={v}" for k, v in b["build_args"].items()),
            label=b["name"] + (f" ({', '.join(b['tags'])})" if b["suffix"] else ""),
        ))
    print(json.dumps(rows))


parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
sub = parser.add_subparsers(dest="command", required=True)
sub.add_parser("check")
m = sub.add_parser("matrix")
m.add_argument("--registry", required=True)
m.add_argument("--sha")
which = m.add_mutually_exclusive_group(required=True)
which.add_argument("--tag", metavar="TAG")
which.add_argument("--all", action="store_true")
which.add_argument("--changed", metavar="FILE")
which.add_argument("--only", action="append", metavar="NAME")
args = parser.parse_args()
if args.command == "matrix" and not args.tag and not args.sha:
    parser.error("--sha is needed unless --tag is given")
check() if args.command == "check" else matrix(args)
