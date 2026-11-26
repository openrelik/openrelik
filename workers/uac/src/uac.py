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
"""Reading UAC collections: the artifact catalog, archive members, and uac.log."""

import fnmatch
import json
import re
import shlex
import tarfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Callable, Iterator

CATALOG = json.loads((Path(__file__).parent / "catalog.json").read_text())
ARTIFACTS: dict = CATALOG["artifacts"]
PROFILES: dict = CATALOG["profiles"]

# Files the file collector copies keep their original path under this directory.
ROOT_DIR = "[root]"


def artifact_choices() -> list[str]:
    """Artifact ids and their category wildcards, for the task forms."""
    categories = set()
    for artifact_id in ARTIFACTS:
        parts = artifact_id.split("/")
        for depth in range(1, len(parts)):
            categories.add("/".join(parts[:depth]) + "/*")
    return sorted(categories) + sorted(ARTIFACTS)


def resolve_artifacts(entries: list[str]) -> list[str]:
    """Resolve profile-style entries to artifact ids, in catalog order.

    Entries work like in a UAC profile or the -a option: "files/logs/*" or
    "files/logs/var_log.yaml" add artifacts, "!files/logs/journal.yaml" removes
    them, applied in order.
    """
    selected: dict[str, None] = {}
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        exclude = entry.startswith("!")
        pattern = entry.lstrip("!").strip()
        pattern = pattern.removeprefix("./").removeprefix("artifacts/")
        pattern = pattern.removesuffix(".yaml")
        for artifact_id in ARTIFACTS:
            if artifact_id == pattern or fnmatch.fnmatchcase(artifact_id, pattern):
                if exclude:
                    selected.pop(artifact_id, None)
                else:
                    selected[artifact_id] = None
    return list(selected)


def profile_artifacts(profile: str) -> list[str]:
    return resolve_artifacts(PROFILES[profile]["artifacts"])


def glob_to_regex(glob: str) -> str:
    """Translate a catalog glob; "*" matches across "/"."""
    # "*" already crosses "/", so "*/*" only adds backtracking.
    while "*/*" in glob:
        glob = glob.replace("*/*", "*")
    out = []
    i = 0
    while i < len(glob):
        char = glob[i]
        if char == "*":
            out.append(".*")
        elif char == "?":
            out.append("[^/]")
        elif char == "[" and "]" in glob[i + 1 :]:
            end = glob.index("]", i + 1)
            out.append("[" + glob[i + 1 : end].replace("\\", "\\\\") + "]")
            i = end
        else:
            out.append(re.escape(char))
        i += 1
    return "".join(out)


def _specificity(glob: str) -> int:
    """Characters of a glob that aren't wildcards."""
    return len(re.sub(r"\[[^\]]*\]|[*?]", "", glob))


class Classifier:
    """Attributes archive members to the UAC artifact that collected them.

    Each glob is indexed by its last path segment without wildcards (".bash_history",
    "log", "network"); a member is only tested against the globs indexed by one of
    its own path segments, plus the few globs without a literal segment. A member
    that matches several artifacts goes to the most specific glob (most literal
    characters).
    """

    def __init__(self, artifact_ids: list[str] | None = None):
        artifact_ids = list(ARTIFACTS) if artifact_ids is None else artifact_ids
        self._index = {"fs": {}, "archive": {}}
        self._unindexed = {"fs": [], "archive": []}
        for artifact_id in artifact_ids:
            for kind in ("fs", "archive"):
                for glob in ARTIFACTS[artifact_id][kind]:
                    entry = (
                        _specificity(glob),
                        re.compile(glob_to_regex(glob) + r"\Z", re.DOTALL),
                        artifact_id,
                    )
                    literal = [p for p in glob.split("/") if p and not re.search(r"[*?\[]", p)]
                    if literal:
                        self._index[kind].setdefault(literal[-1], []).append(entry)
                    else:
                        self._unindexed[kind].append(entry)

    def classify(self, name: str) -> str | None:
        """Return the artifact id for an archive member name, or None."""
        if is_collected_file(name):
            kind, path = "fs", original_path(name)
        else:
            kind, path = "archive", name
        index = self._index[kind]
        candidates = list(self._unindexed[kind])
        for segment in set(path.split("/")):
            candidates.extend(index.get(segment, ()))
        best = None
        for entry in candidates:
            if (best is None or entry[0] > best[0]) and entry[1].match(path):
                best = entry
        return best[2] if best else None


def is_collected_file(name: str) -> bool:
    return name.startswith(ROOT_DIR + "/")


def original_path(name: str) -> str:
    """The path a member had on the collected system, or its archive path."""
    if is_collected_file(name):
        return name[len(ROOT_DIR) :]
    return name


@dataclass
class Member:
    name: str
    size: int
    mtime: datetime
    kind: str  # "file", "dir", "symlink" or "hardlink"
    linkname: str = ""


def _safe_name(name: str) -> str | None:
    name = name.replace("\\", "/").removeprefix("./")
    parts = [part for part in name.split("/") if part not in ("", ".")]
    if not parts or ".." in parts or name.startswith("/"):
        return None
    return "/".join(parts)


def iter_archive(
    path: str, password: str | None = None
) -> Iterator[tuple[Member, Callable[[], IO[bytes]]]]:
    """Yield (member, open) for each member of a UAC tar, tar.gz or zip archive.

    Tar archives are read as a stream, in one pass: call open() before moving to
    the next member. Members with absolute paths or ".." are skipped.
    """
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            pwd = password.encode() if password else None
            for info in archive.infolist():
                name = _safe_name(info.filename)
                if name is None:
                    continue
                member = Member(
                    name=name,
                    size=info.file_size,
                    mtime=datetime(*info.date_time, tzinfo=timezone.utc),
                    kind="dir" if info.is_dir() else "file",
                )
                yield member, (lambda info=info: archive.open(info, pwd=pwd))
        return

    with tarfile.open(path, mode="r|*") as archive:
        for info in archive:
            name = _safe_name(info.name)
            if name is None:
                continue
            if info.isfile():
                kind = "file"
            elif info.isdir():
                kind = "dir"
            elif info.issym():
                kind = "symlink"
            elif info.islnk():
                kind = "hardlink"
            else:
                continue
            member = Member(
                name=name,
                size=info.size,
                mtime=datetime.fromtimestamp(info.mtime, tz=timezone.utc),
                kind=kind,
                linkname=_safe_name(info.linkname) or "" if info.linkname else "",
            )
            yield member, (lambda info=info: archive.extractfile(info))


LOG_LINE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}) (INF|CMD|WRN|ERR|DBG) (.*)$"
)
LOG_FIELDS = {
    "Unix-like Artifacts Collector": "uac_version",
    "Command line": "command_line",
    "Operating system": "os",
    "System architecture": "architecture",
    "Hostname": "hostname",
    "Time zone": "timezone",
    "Mount point": "mount_point",
    "Output format": "output_format",
    "Running as": "running_as",
}


def parse_log_time(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")


@dataclass
class CollectionInfo:
    """What uac.log says about a collection."""

    uac_version: str = ""
    command_line: str = ""
    os: str = ""
    architecture: str = ""
    hostname: str = ""
    timezone: str = ""
    mount_point: str = ""
    output_format: str = ""
    running_as: str = ""
    profile: str = ""
    artifacts_option: list[str] = field(default_factory=list)
    started: datetime | None = None
    finished: datetime | None = None
    artifacts_selected: int = 0
    parsed_artifacts: list[str] = field(default_factory=list)
    skipped_conditions: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def profile_name(self) -> str:
        """The profile, without the path and extension of a custom profile file."""
        return Path(self.profile).stem if self.profile else ""

    def artifacts(self) -> list[str]:
        """The artifacts this collection ran, as best known.

        The "Parsing" lines in uac.log are what actually ran; without them the
        profile or -a option from the command line is used.
        """
        if self.parsed_artifacts:
            return [a for a in self.parsed_artifacts if a in ARTIFACTS]
        entries = []
        if self.profile_name in PROFILES:
            entries.extend(PROFILES[self.profile_name]["artifacts"])
        entries.extend(self.artifacts_option)
        return resolve_artifacts(entries)


def parse_command_line(info: CollectionInfo) -> None:
    try:
        args = shlex.split(info.command_line)
    except ValueError:
        args = info.command_line.split()
    for i, arg in enumerate(args):
        value = args[i + 1] if i + 1 < len(args) else ""
        if arg in ("-p", "--profile"):
            info.profile = value
        elif arg.startswith("--profile="):
            info.profile = arg.split("=", 1)[1]
        elif arg in ("-a", "--artifacts"):
            info.artifacts_option.extend(value.split(","))
        elif arg.startswith("--artifacts="):
            info.artifacts_option.extend(arg.split("=", 1)[1].split(","))


def parse_log(text: str) -> CollectionInfo:
    info = CollectionInfo()
    parsed = {}
    for line in text.splitlines():
        match = LOG_LINE.match(line)
        if not match:
            continue
        timestamp, level, message = match.groups()
        if info.started is None:
            info.started = parse_log_time(timestamp)
        info.finished = parse_log_time(timestamp)
        if level == "ERR":
            info.errors.append(message)
        elif level == "WRN":
            info.warnings.append(message)
        elif level != "INF":
            continue
        if message.startswith("Parsing ") and message.endswith(".yaml"):
            parsed[message[len("Parsing ") : -len(".yaml")]] = None
        elif message.endswith(" not satisfied. Skipping..."):
            info.skipped_conditions += 1
        elif message.endswith("artifact(s) selected"):
            info.artifacts_selected = int(message.split()[0])
        elif message.startswith("Unix-like Artifacts Collector "):
            info.uac_version = message.rsplit(" ", 1)[1]
        elif ": " in message:
            key, value = message.split(": ", 1)
            if key in LOG_FIELDS and not getattr(info, LOG_FIELDS[key]):
                setattr(info, LOG_FIELDS[key], value.strip())
    info.parsed_artifacts = list(parsed)
    parse_command_line(info)
    return info


def read_log(path: str, password: str | None = None) -> str:
    """Return the text of uac.log; UAC writes it first, so this reads little."""
    for member, open_member in iter_archive(path, password):
        if member.name == "uac.log":
            with open_member() as stream:
                return stream.read().decode("utf-8", errors="replace")
    return ""


def hostname_from_filename(filename: str) -> str:
    """uac-<hostname>-<os>-<timestamp>.tar.gz -> hostname."""
    match = re.match(r"^uac-(.+)-[a-z]+-\d{14}\.", filename or "")
    return match.group(1) if match else ""
