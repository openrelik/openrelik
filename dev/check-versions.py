#!/usr/bin/env python3
"""Check that the versions in the repository follow the versioning rules.

Usage: dev/check-versions.py   (from anywhere in the repository; Python 3.11+)

VERSION at the root is the platform version; on main it carries a dev suffix
(0.18.0.dev0, written 0.18.0-dev in package.json); on a release branch it's
the minor's X.Y.0 release. The rules:

- on main (VERSION with a dev suffix), server/pyproject.toml and every
  web/*/package.json equal VERSION; on a release branch they're on its minor
  (each has its own patch releases).
- every libs/*/pyproject.toml and mcp/pyproject.toml have VERSION's MAJOR.MINOR.
- mcp depends on openrelik-python-client, and its and the server's library
  dependencies are ~=X.Y.N of VERSION's minor; on main during a minor's
  development a previous minor is a warning, as that minor's libraries are
  published at its release.
- the server's and every worker's dependencies on the libraries in libs/ use
  ~=X.Y.N; a worker's MAJOR.MINOR equals that of its libraries.
- a worker not on VERSION's minor yet is a warning.
- every libs/*/LICENSE is identical to the root LICENSE.
"""

import json
import os
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(\.dev\d+)?$")
REQUIREMENT_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;]*)")

errors = 0
warnings = 0


def report(level, path, message):
    global errors, warnings
    if level == "error":
        errors += 1
    else:
        warnings += 1
    relative = path.relative_to(ROOT) if path else ""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        location = f" file={relative}" if path else ""
        print(f"::{level}{location}::{message}")
    else:
        print(f"{level}: {relative}{': ' if path else ''}{message}")



def normalize(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def minor(version):
    match = VERSION_RE.match(version)
    return (match.group(1), match.group(2)) if match else None


def pyproject(path):
    with path.open("rb") as f:
        return tomllib.load(f)["project"]


def library_dependencies(project, libraries):
    """Yield (name, specifier) for each dependency on a library in libs/."""
    requirements = list(project.get("dependencies", []))
    for extra in project.get("optional-dependencies", {}).values():
        requirements += extra
    for requirement in requirements:
        match = REQUIREMENT_RE.match(requirement)
        if match and normalize(match.group(1)) in libraries:
            yield normalize(match.group(1)), match.group(3).replace(" ", "")


def compatible_minor(specifier):
    """Return the (MAJOR, MINOR) of a ~=X.Y.N specifier, or None."""
    match = re.fullmatch(r"~=(\d+)\.(\d+)\.(\d+)", specifier)
    return (match.group(1), match.group(2)) if match else None


def main():
    version_file = ROOT / "VERSION"
    version = version_file.read_text().strip()
    platform = minor(version)
    if not platform:
        report("error", version_file, f"{version!r} isn't X.Y.Z or X.Y.Z.devN")
        return
    platform_name = ".".join(platform)
    npm_version = re.sub(r"\.dev\d+$", "-dev", version)

    # On main (VERSION with a dev suffix) the server and web UIs equal VERSION;
    # on a release branch each has its own patch releases of VERSION's minor.
    development = version != re.sub(r"\.dev\d+$", "", version)
    server_file = ROOT / "server" / "pyproject.toml"
    server = pyproject(server_file)
    if development and server["version"] != version:
        report("error", server_file, f"version {server['version']} isn't VERSION {version}")
    elif not development and minor(server["version"]) != platform:
        report("error", server_file, f"version {server['version']} isn't on VERSION's minor {platform_name}")

    for package_file in sorted(ROOT.glob("web/*/package.json")):
        package_version = json.loads(package_file.read_text()).get("version")
        if development and package_version != npm_version:
            report("error", package_file, f"version {package_version} isn't {npm_version} (VERSION {version})")
        elif not development and minor(package_version or "") != platform:
            report("error", package_file, f"version {package_version} isn't on VERSION's minor {platform_name}")

    libraries = {}
    for library_file in sorted(ROOT.glob("libs/*/pyproject.toml")):
        library = pyproject(library_file)
        libraries[normalize(library["name"])] = library_file
        if minor(library["version"]) != platform:
            report("error", library_file, f"version {library['version']} isn't on VERSION's minor {platform_name}")
        license_file = library_file.parent / "LICENSE"
        if not license_file.exists() or license_file.read_bytes() != (ROOT / "LICENSE").read_bytes():
            report("error", license_file, "isn't identical to the root LICENSE")

    mcp_file = ROOT / "mcp" / "pyproject.toml"
    mcp = pyproject(mcp_file)
    if minor(mcp["version"]) != platform:
        report("error", mcp_file, f"version {mcp['version']} isn't on VERSION's minor {platform_name}")
    # The libraries of a new minor are published at its release, so during its
    # development on main the server and mcp still use the previous minor's.
    def platform_dependency(path, name, specifier):
        dependency = compatible_minor(specifier)
        if not dependency:
            report("error", path, f"{name}{specifier} isn't ~=X.Y.N")
        elif tuple(map(int, dependency)) > tuple(map(int, platform)):
            report("error", path, f"{name}{specifier} is newer than VERSION's minor {platform_name}")
        elif dependency != platform:
            level = "warning" if development else "error"
            report(level, path, f"{name}{specifier} isn't on VERSION's minor {platform_name} yet")

    client = dict(library_dependencies(mcp, libraries)).get("openrelik-python-client")
    if client is None:
        report("error", mcp_file, "doesn't depend on openrelik-python-client")
    else:
        platform_dependency(mcp_file, "openrelik-python-client", client)

    for name, specifier in library_dependencies(server, libraries):
        platform_dependency(server_file, name, specifier)

    for worker_file in sorted(ROOT.glob("workers/*/pyproject.toml")):
        worker = pyproject(worker_file)
        worker_minor = minor(worker["version"])
        dependencies = dict(library_dependencies(worker, libraries))
        if "openrelik-worker-common" not in dependencies:
            report("error", worker_file, "doesn't depend on openrelik-worker-common")
        for name, specifier in dependencies.items():
            if not compatible_minor(specifier):
                report("error", worker_file, f"{name}{specifier} isn't ~=X.Y.N")
            elif compatible_minor(specifier) != worker_minor:
                report("error", worker_file, f"{name}{specifier} isn't on the worker's minor ({worker['version']})")
        if worker_minor != platform:
            report("warning", worker_file, f"version {worker['version']} isn't on the platform minor {platform_name} yet")


if __name__ == "__main__":
    main()
    print(f"{errors} errors, {warnings} warnings")
    sys.exit(1 if errors else 0)
