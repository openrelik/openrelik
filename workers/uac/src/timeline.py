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
"""Turning UAC output into events, written for Timesketch or Elasticsearch."""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import IO, Callable, Iterable, Iterator

from . import uac

# Sources of events, in the order they're offered in the task form.
SOURCES = {
    "bodyfile": "File system timestamps from bodyfile/bodyfile.txt (MACB)",
    "shell_history": "Timestamped shell history entries (bash, zsh, fish)",
    "uac_log": "The collection log, uac.log",
    "live_response": "Every line of the live response command output (ps, ss, lsof, ...)",
    "system": "Every line of the system/ file listings (suid, hidden files, ...)",
    "hash_executables": "Hashes of executable files",
}

FORMAT_TIMESKETCH = "Timesketch JSONL"
FORMAT_ELASTICSEARCH = "Elasticsearch bulk NDJSON"
FORMATS = [FORMAT_TIMESKETCH, FORMAT_ELASTICSEARCH]

COLLECTION_TIME = "UAC Collection Time"
MACB = (
    ("m", "mtime", "Content Modification Time"),
    ("a", "atime", "Last Access Time"),
    ("c", "ctime", "Metadata Modification Time"),
    ("b", "crtime", "Creation Time"),
)
SHELL_HISTORY = re.compile(
    r"(^|/)(\.[A-Za-z0-9_]*history[^/]*|\.zhistory|fish_history)$"
)
ZSH_ENTRY = re.compile(r"^: (\d+):\d+;(.*)$")
BASH_TIMESTAMP = re.compile(r"^#(\d{9,11})$")
FISH_WHEN = re.compile(r"^\s+when: (\d+)$")
HASH_LINE = re.compile(r"^([0-9a-fA-F]{32,128})\s+(.+)$")


@dataclass
class Event:
    datetime: datetime
    timestamp_desc: str
    message: str
    data_type: str
    fields: dict = field(default_factory=dict)


def source_of(name: str) -> str | None:
    """The timeline source an archive member belongs to, if any."""
    if name == "uac.log":
        return "uac_log"
    if name == "bodyfile/bodyfile.txt":
        return "bodyfile"
    if name.startswith("hash_executables/"):
        return "hash_executables"
    # Command output is .txt; other files there are binaries (recovered_file of
    # deleted processes) or compressed process memory strings.
    if name.startswith("live_response/") and name.endswith(".txt"):
        return "live_response"
    if name.startswith("system/") and name.endswith(".txt"):
        return "system"
    if uac.is_collected_file(name) and SHELL_HISTORY.search(name):
        return "shell_history"
    return None


def _from_epoch(value: str | int) -> datetime | None:
    try:
        seconds = int(value)
    except ValueError:
        return None
    if seconds <= 0:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def text_lines(stream: IO[bytes]) -> Iterator[str]:
    # Tar stream members aren't seekable, which io.TextIOWrapper requires.
    for line in stream:
        yield line.decode("utf-8", errors="replace").rstrip("\r\n")


def parse_bodyfile(lines: Iterable[str]) -> Iterator[Event]:
    """Bodyfile 3.x: MD5|name|inode|mode|UID|GID|size|atime|mtime|ctime|crtime.

    One event per distinct timestamp of a file, with its MACB letters.
    """
    for line in lines:
        parts = line.split("|")
        if len(parts) < 11:
            continue
        md5, name = parts[0], "|".join(parts[1:-9])
        inode, mode, uid, gid, size = parts[-9:-4]
        times = dict(zip(("atime", "mtime", "ctime", "crtime"), parts[-4:]))
        by_time: dict[datetime, list] = {}
        for letter, key, desc in MACB:
            moment = _from_epoch(times[key])
            if moment:
                by_time.setdefault(moment, []).append((letter, desc))
        for moment, kinds in by_time.items():
            letters = {letter for letter, _ in kinds}
            macb = "".join(l if l in letters else "." for l, _, _ in MACB)
            yield Event(
                datetime=moment,
                timestamp_desc="; ".join(desc for _, desc in kinds),
                message=f"[{macb}] {name} ({mode}, uid {uid}, gid {gid}, {size} bytes)",
                data_type="uac:bodyfile:entry",
                fields={
                    "path": name,
                    "macb": macb,
                    "inode": inode,
                    "mode": mode,
                    "uid": uid,
                    "gid": gid,
                    "size": int(size) if size.isdigit() else size,
                    "md5": md5 if md5 not in ("", "0") else None,
                },
            )


def parse_shell_history(path: str, lines: Iterable[str]) -> Iterator[Event]:
    """Entries with a timestamp: bash "#<epoch>" lines, zsh extended, fish."""
    pending = None
    fish_command = None

    def event(moment, command):
        return Event(
            datetime=moment,
            timestamp_desc="Command Execution Time",
            message=command,
            data_type="uac:shell:history",
            fields={"path": path, "command": command},
        )

    for line in lines:
        zsh = ZSH_ENTRY.match(line)
        if zsh:
            moment = _from_epoch(zsh.group(1))
            if moment:
                yield event(moment, zsh.group(2))
            continue
        bash = BASH_TIMESTAMP.match(line)
        if bash:
            pending = _from_epoch(bash.group(1))
            continue
        if line.startswith("- cmd: "):
            fish_command = line[len("- cmd: ") :]
            continue
        fish = FISH_WHEN.match(line)
        if fish and fish_command is not None:
            moment = _from_epoch(fish.group(1))
            if moment:
                yield event(moment, fish_command)
            fish_command = None
            continue
        if pending and line:
            yield event(pending, line)
            pending = None


def parse_uac_log(lines: Iterable[str]) -> Iterator[Event]:
    for line in lines:
        match = uac.LOG_LINE.match(line)
        if not match:
            continue
        timestamp, level, message = match.groups()
        yield Event(
            datetime=uac.parse_log_time(timestamp).astimezone(timezone.utc),
            timestamp_desc="Log Time",
            message=f"{level} {message}",
            data_type="uac:collection:log",
            fields={"level": level},
        )


def parse_output_lines(
    name: str, artifact_id: str | None, collected: datetime, lines: Iterable[str]
) -> Iterator[Event]:
    """One event per non-empty line of command output, at collection time."""
    data_type = f"uac:{name.split('/', 1)[0]}:line"
    for number, line in enumerate(lines, start=1):
        for part in line.split("\x00"):
            if not part.strip():
                continue
            fields = {"source_file": name, "line_number": number, "artifact": artifact_id}
            hashed = HASH_LINE.match(part) if name.startswith("hash_executables/") else None
            if hashed:
                fields.update(
                    {
                        "hash": hashed.group(1).lower(),
                        "algorithm": name.rsplit(".", 1)[-1],
                        "path": hashed.group(2),
                    }
                )
            yield Event(
                datetime=collected,
                timestamp_desc=COLLECTION_TIME,
                message=part,
                data_type=data_type,
                fields=fields,
            )


def events_for(
    name: str,
    source: str,
    artifact_id: str | None,
    collected: datetime,
    stream: IO[bytes],
) -> Iterator[Event]:
    lines = text_lines(stream)
    if source == "bodyfile":
        return parse_bodyfile(lines)
    if source == "shell_history":
        return parse_shell_history(uac.original_path(name), lines)
    if source == "uac_log":
        return parse_uac_log(lines)
    return parse_output_lines(name, artifact_id, collected, lines)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def timesketch_record(event: Event, hostname: str) -> dict:
    """Timesketch JSONL: message, datetime and timestamp_desc are required."""
    record = {
        "message": event.message,
        "datetime": _iso(event.datetime),
        "timestamp": int(event.datetime.timestamp() * 1_000_000),
        "timestamp_desc": event.timestamp_desc,
        "data_type": event.data_type,
        "hostname": hostname,
    }
    for key, value in event.fields.items():
        if value is not None and key not in record:
            record[key] = value
    return record


def elasticsearch_record(event: Event, hostname: str) -> dict:
    """An ECS-style document; UAC specific fields go under "uac"."""
    record = {
        "@timestamp": _iso(event.datetime),
        "message": event.message,
        "event": {
            "action": event.timestamp_desc,
            "dataset": event.data_type,
            "module": "uac",
        },
        "host": {"name": hostname},
        "uac": {k: v for k, v in event.fields.items() if v is not None},
    }
    if "path" in event.fields:
        record["file"] = {"path": event.fields["path"]}
    return record


class Writer:
    """Writes events of one source to output files.

    new_file(part) returns the path of a new output file; it's called for the
    first event, and for Elasticsearch again whenever a file reaches max_bytes so
    each file can be sent in one _bulk request.
    """

    def __init__(
        self,
        output_format: str,
        hostname: str,
        index: str,
        new_file: Callable[[int], str],
        max_bytes: int = 50 * 1024 * 1024,
    ):
        self.output_format = output_format
        self.hostname = hostname
        self.action = json.dumps({"index": {"_index": index}}) + "\n"
        self.new_file = new_file
        self.max_bytes = max_bytes
        self.events = 0
        self.part = 0
        self._handle = None
        self._written = 0

    def write(self, event: Event) -> None:
        if self.output_format == FORMAT_ELASTICSEARCH:
            line = self.action + json.dumps(elasticsearch_record(event, self.hostname)) + "\n"
        else:
            line = json.dumps(timesketch_record(event, self.hostname)) + "\n"
        data = line.encode("utf-8")
        rotate = (
            self.output_format == FORMAT_ELASTICSEARCH
            and self._written
            and self._written + len(data) > self.max_bytes
        )
        if self._handle is None or rotate:
            self.close()
            self.part += 1
            self._handle = open(self.new_file(self.part), "wb")
            self._written = 0
        self._handle.write(data)
        self._written += len(data)
        self.events += 1

    def close(self) -> None:
        if self._handle:
            self._handle.close()
            self._handle = None


def index_name(hostname: str) -> str:
    """An Elasticsearch index name: lowercase, without the characters ES rejects."""
    name = re.sub(r"[^a-z0-9_.-]+", "-", (hostname or "unknown").lower()).strip("-_.")
    return f"uac-{name or 'unknown'}"
