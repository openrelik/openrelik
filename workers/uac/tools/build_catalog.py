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
"""Build src/catalog.json from a UAC release.

Usage (from workers/uac):
    python3 tools/build_catalog.py /path/to/uac-3.4.0

For every artifact file (artifacts/<id>.yaml) the catalog stores where its output
lands in a UAC archive, as glob patterns:

- "fs" patterns match files the file collector copied into "[root]/", against
  their original file system path.
- "archive" patterns match the output files of the command, find, hash and stat
  collectors, against their path inside the archive.

Glob syntax: "*" matches across "/", "?" one character, "[...]" a set.
"""

import json
import shlex
import sys
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "src" / "catalog.json"

# Placeholders that UAC expands at collection time.
PLACEHOLDERS = {
    "%user_home%": "*",
    "%user%": "*",
    "%line%": "*",
    "%mount_point%": "",
}


def expand(value: str) -> str:
    for placeholder, replacement in PLACEHOLDERS.items():
        value = value.replace(placeholder, replacement)
    while "//" in value:
        value = value.replace("//", "/")
    return value


def as_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def file_patterns(entry: dict) -> list[str]:
    """Patterns, on the original path, for files a file collector copied."""
    if entry.get("is_file_list"):
        # The paths come from a list built at collection time.
        return []
    patterns = []
    names = as_list(entry.get("name_pattern"))
    path_patterns = as_list(entry.get("path_pattern"))
    for path in shlex.split(str(entry.get("path", ""))):
        path = expand(path).rstrip("/") or ""
        if path.startswith("%temp_directory%"):
            continue
        if path_patterns:
            # find -path matches the whole path; UAC's patterns start with "*/".
            for path_pattern in path_patterns:
                patterns.append(f"{path}/{expand(path_pattern).lstrip('/')}")
        elif names:
            for name in names:
                name = expand(name)
                # A matching directory is collected with its contents.
                for glob in (f"{path}/{name}", f"{path}/*/{name}"):
                    patterns.extend((glob, f"{glob}/*"))
        else:
            patterns.append(path or "/")
            patterns.append(f"{path}/*")
    return patterns


def output_patterns(entry: dict, output_directory: str | None) -> list[str]:
    """Patterns, on the archive path, for collector output files."""
    directory = entry.get("output_directory", output_directory)
    if not directory or directory.startswith("%temp_directory%"):
        return []
    directory = expand(directory).strip("/")
    output_file = entry.get("output_file")
    if not output_file:
        return [f"{directory}/*"]
    name = expand(output_file)
    if entry.get("collector") == "hash":
        # One file per algorithm: <output_file>.md5, <output_file>.sha1, ...
        name += ".*"
    if entry.get("compress_output_file"):
        name += ".gz"
    return [f"{directory}/{name}"]


def load_artifacts(uac_dir: Path) -> dict:
    artifacts = {}
    root = uac_dir / "artifacts"
    for yaml_file in sorted(root.rglob("*.yaml")):
        artifact_id = str(yaml_file.relative_to(root).with_suffix(""))
        data = parse_artifact_file(yaml_file.read_text())
        fs, archive, descriptions = [], [], []
        for entry in data.get("artifacts") or []:
            descriptions.append(entry.get("description", "").strip())
            if entry.get("collector") == "file":
                fs.extend(file_patterns(entry))
            else:
                archive.extend(output_patterns(entry, data.get("output_directory")))
        artifacts[artifact_id] = {
            "description": descriptions[0] if descriptions else "",
            "fs": sorted(set(fs)),
            "archive": sorted(set(archive)),
        }
    return artifacts


def parse_value(value: str):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        return [v.strip().strip("\"'") for v in value[1:-1].split(",") if v.strip()]
    if value in ("true", "false"):
        return value == "true"
    return value


def parse_artifact_file(text: str) -> dict:
    """Parse an artifact file by line, as UAC does.

    UAC's files look like YAML but aren't (unquoted "%user_home%", "!" in
    conditions), so they're read as "key: value" lines: top-level keys, then one
    mapping per "-" under "artifacts:".
    """
    data = {"artifacts": []}
    current = None
    for line in text.splitlines():
        if line.lstrip().startswith("#") or not line.strip():
            continue
        stripped = line.strip()
        if stripped == "-":
            current = {}
            data["artifacts"].append(current)
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        if " " in key:
            continue
        target = current if current is not None and line.startswith((" ", "\t")) else data
        if key == "artifacts":
            current = None
            continue
        target[key] = parse_value(value.split(" #", 1)[0])
    return data


def load_profiles(uac_dir: Path) -> dict:
    profiles = {}
    for yaml_file in sorted((uac_dir / "profiles").glob("*.yaml")):
        profile = parse_profile(yaml_file.read_text())
        profiles[profile["name"]] = profile
    return profiles


def parse_profile(text: str) -> dict:
    """Parse a profile by line, as UAC does: "!path" excludes are not YAML tags."""
    profile = {"name": "", "description": "", "artifacts": []}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line.startswith("- "):
            profile["artifacts"].append(line[2:].strip())
        elif line.startswith(("name:", "description:")):
            key, value = line.split(":", 1)
            profile[key] = value.strip()
    return profile


def main(uac_dir: str) -> None:
    uac_dir = Path(uac_dir)
    version = "unknown"
    for line in (uac_dir / "uac").read_text().splitlines():
        if line.startswith("__UAC_VERSION="):
            version = line.split("=", 1)[1].strip("\"'")
    catalog = {
        "uac_version": version,
        "profiles": load_profiles(uac_dir),
        "artifacts": load_artifacts(uac_dir),
    }
    OUTPUT.write_text(json.dumps(catalog, indent=1, sort_keys=True) + "\n")
    print(f"Wrote {len(catalog['artifacts'])} artifacts, "
          f"{len(catalog['profiles'])} profiles (UAC {version}) to {OUTPUT}")


if __name__ == "__main__":
    main(sys.argv[1])
