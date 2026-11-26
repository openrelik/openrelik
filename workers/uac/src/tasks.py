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

import fnmatch
import os
import shutil
from collections import Counter

from openrelik_common import telemetry
from openrelik_worker_common.file_utils import create_output_file
from openrelik_worker_common.reporting import MarkdownTable, Priority, Report
from openrelik_worker_common.task_utils import create_task_result, get_input_files

from . import timeline, uac
from .app import celery

COMPATIBLE_INPUTS = {
    "data_types": [],
    "mime_types": [],
    "filenames": ["*.tar.gz", "*.tgz", "*.tar", "*.zip"],
}
PROFILE_AUTO = "auto (as collected)"
PROFILE_CHOICES = [PROFILE_AUTO] + sorted(uac.PROFILES)
PASSWORD_FIELD = {
    "name": "archive_password",
    "label": "Archive password",
    "description": "Password of a UAC zip archive created with --output-password.",
    "type": "text",
    "required": False,
}
PROGRESS_EVERY = 5000

REPORT_TASK_NAME = "openrelik-worker-uac.tasks.report"
REPORT_TASK_METADATA = {
    "display_name": "UAC: Collection report",
    "description": (
        "Summarize a UAC collection: host, UAC version and profile, which artifacts"
        " ran and what they collected, and collection errors."
    ),
    "task_config": [PASSWORD_FIELD],
}

EXTRACT_TASK_NAME = "openrelik-worker-uac.tasks.extract"
EXTRACT_TASK_METADATA = {
    "display_name": "UAC: Extract artifacts",
    "description": (
        "Extract files of selected UAC artifacts (or all artifacts of a UAC profile)"
        " from a UAC collection, as separate files for other workers."
    ),
    "task_config": [
        {
            "name": "artifacts",
            "label": "Artifacts",
            "description": (
                "UAC artifacts to extract, as in uac -a: an artifact"
                " (files/logs/var_log) or a category (live_response/network/*)."
            ),
            "type": "autocomplete",
            "items": uac.artifact_choices(),
            "required": False,
        },
        {
            "name": "profile",
            "label": "Profile",
            "description": (
                "Also extract every artifact of a UAC profile. 'auto' uses the"
                " artifacts the collection ran."
            ),
            "type": "select",
            "items": PROFILE_CHOICES,
            "required": False,
        },
        {
            "name": "file_filter",
            "label": "File filter",
            "description": (
                "Comma separated glob patterns, matched against the original path"
                " (/var/log/auth.log*) or the path in the archive"
                " (live_response/process/*)."
            ),
            "type": "text",
            "required": False,
        },
        {
            "name": "register_in_db",
            "label": "Register extracted files in the database",
            "description": "When enabled (default), each extracted file appears in the UI.",
            "type": "switch",
            "value": True,
            "required": False,
        },
        PASSWORD_FIELD,
    ],
}

TIMELINE_TASK_NAME = "openrelik-worker-uac.tasks.timeline"
TIMELINE_TASK_METADATA = {
    "display_name": "UAC: Timeline (Timesketch / Elasticsearch)",
    "description": (
        "Turn a UAC collection into events: bodyfile MACB times, shell history,"
        " uac.log, and live response output. Writes Timesketch JSONL or"
        " Elasticsearch bulk NDJSON, one file per source."
    ),
    "task_config": [
        {
            "name": "sources",
            "label": "Sources",
            "description": "Event sources; all when empty. "
            + "; ".join(f"{k}: {v}" for k, v in timeline.SOURCES.items()),
            "type": "autocomplete",
            "items": list(timeline.SOURCES),
            "required": False,
        },
        {
            "name": "output_format",
            "label": "Output format",
            "description": (
                "Timesketch JSONL (default) can go to the Timesketch worker."
                " Elasticsearch bulk NDJSON is sent with: curl -H 'Content-Type:"
                " application/x-ndjson' --data-binary @<file> <es>/_bulk"
            ),
            "type": "select",
            "items": timeline.FORMATS,
            "required": False,
        },
        PASSWORD_FIELD,
    ],
}


def _split(value) -> list[str]:
    """A list from an autocomplete (list) or text (comma separated) field."""
    if not value:
        return []
    if isinstance(value, str):
        value = value.split(",")
    return [v.strip() for v in value if v and v.strip()]


def _base_name(input_file: dict) -> str:
    name = input_file.get("display_name") or "uac"
    for suffix in (".tar.gz", ".tgz", ".tar", ".zip"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def _collection_info(input_file: dict, password: str | None) -> uac.CollectionInfo:
    info = uac.parse_log(uac.read_log(input_file.get("path"), password))
    if not info.hostname:
        info.hostname = uac.hostname_from_filename(input_file.get("display_name"))
    return info


def _size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024:
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} TB"


def _start(input_files: list, task_config: dict, workflow_id: str):
    telemetry.add_attribute_to_current_span("input_files", input_files)
    telemetry.add_attribute_to_current_span("task_config", task_config)
    telemetry.add_attribute_to_current_span("workflow_id", workflow_id)
    if not input_files:
        raise RuntimeError(
            "No UAC archive (.tar.gz, .tar or .zip) in the input files. UAC tasks read"
            " the collection itself: connect them directly to the UAC archive, not"
            " after another task."
        )


def build_report(input_file: dict, password: str | None) -> Report:
    info = _collection_info(input_file, password)
    classifier = uac.Classifier()
    categories = Counter()
    category_bytes = Counter()
    artifact_files = Counter()
    artifact_bytes = Counter()
    total_files = total_bytes = 0
    for member, _ in uac.iter_archive(input_file.get("path"), password):
        if member.kind not in ("file", "hardlink"):
            continue
        total_files += 1
        total_bytes += member.size
        if uac.is_collected_file(member.name):
            parts = uac.original_path(member.name).split("/")
            category = f"[root]/{parts[1]}" if len(parts) > 2 else "[root]"
        else:
            category = member.name.split("/", 1)[0] if "/" in member.name else member.name
        categories[category] += 1
        category_bytes[category] += member.size
        artifact_id = classifier.classify(member.name) or "(not attributed)"
        artifact_files[artifact_id] += 1
        artifact_bytes[artifact_id] += member.size

    title = f"UAC collection: {info.hostname or input_file.get('display_name')}"
    report = Report(title)
    profile = info.profile_name or ("custom (-a)" if info.artifacts_option else "unknown")
    report.summary = (
        f"{info.hostname or 'unknown host'} ({info.os or 'unknown OS'}), UAC"
        f" {info.uac_version or '?'}, profile {profile}: {total_files} files,"
        f" {_size(total_bytes)}"
    )
    if info.errors:
        report.priority = Priority.MEDIUM

    section = report.add_section()
    section.add_header("Collection")
    table = MarkdownTable(["Field", "Value"])
    duration = (
        str(info.finished - info.started) if info.started and info.finished else ""
    )
    for key, value in (
        ("File", input_file.get("display_name", "")),
        ("Hostname", info.hostname),
        ("Operating system", info.os),
        ("Architecture", info.architecture),
        ("Time zone", info.timezone),
        ("UAC version", info.uac_version),
        ("Command line", f"`{info.command_line}`" if info.command_line else ""),
        ("Profile", profile),
        (
            "Profile description",
            uac.PROFILES.get(info.profile_name, {}).get("description", ""),
        ),
        ("Mount point", info.mount_point),
        ("Running as", info.running_as),
        ("Started", info.started.isoformat() if info.started else ""),
        ("Finished", info.finished.isoformat() if info.finished else ""),
        ("Duration", duration),
        ("Artifacts selected", str(info.artifacts_selected)),
        ("Conditions not satisfied (skipped)", str(info.skipped_conditions)),
        ("Files", str(total_files)),
        ("Size (uncompressed)", _size(total_bytes)),
    ):
        if value:
            table.add_row([key, value])
    section.add_table(table)

    section = report.add_section()
    section.add_header("Contents")
    table = MarkdownTable(["Directory", "Files", "Size"])
    for category, count in sorted(categories.items()):
        table.add_row([category, str(count), _size(category_bytes[category])])
    section.add_table(table)

    ran = info.artifacts()
    section = report.add_section()
    section.add_header("Artifacts")
    section.add_paragraph(
        f"{len(ran)} artifact files ran. Files are attributed to the UAC artifact"
        " whose paths match them; use these names in 'UAC: Extract artifacts'."
    )
    table = MarkdownTable(["Artifact", "Files", "Size", "Description"])
    for artifact_id, count in artifact_files.most_common():
        description = uac.ARTIFACTS.get(artifact_id, {}).get("description", "")
        table.add_row(
            [f"`{artifact_id}`", str(count), _size(artifact_bytes[artifact_id]), description]
        )
    section.add_table(table)
    without_output = [a for a in ran if a not in artifact_files]
    if without_output:
        section.add_paragraph(
            "Ran without output (condition not met, not on this OS, or nothing to"
            " collect): " + ", ".join(f"`{a}`" for a in without_output)
        )

    if info.errors or info.warnings:
        section = report.add_section()
        section.add_header(f"Errors and warnings ({len(info.errors) + len(info.warnings)})")
        lines = [f"ERR {e}" for e in info.errors] + [f"WRN {w}" for w in info.warnings]
        section.add_code_block("\n".join(lines[:100]))
    return report


@celery.task(bind=True, name=REPORT_TASK_NAME, metadata=REPORT_TASK_METADATA)
def report(
    self,
    pipe_result: str = None,
    input_files: list = None,
    output_path: str = None,
    workflow_id: str = None,
    task_config: dict = None,
) -> str:
    """Write a markdown report of each UAC collection."""
    task_config = task_config or {}
    input_files = get_input_files(pipe_result, input_files or [], filter=COMPATIBLE_INPUTS)
    _start(input_files, task_config, workflow_id)
    password = task_config.get("archive_password") or None
    output_files = []
    reports = []
    for input_file in input_files:
        self.send_event("task-progress", data={"file": input_file.get("display_name")})
        file_report = build_report(input_file, password)
        output_file = create_output_file(
            output_path,
            display_name=f"{_base_name(input_file)}_report.md",
            data_type="uac:report",
            source_file_id=input_file.get("id"),
        )
        with open(output_file.path, "w", encoding="utf-8") as fh:
            fh.write(file_report.to_markdown())
        output_files.append(output_file.to_dict())
        reports.append(file_report)

    task_report = reports[0]
    if len(reports) > 1:
        task_report = Report(f"UAC collections ({len(reports)})")
        task_report.summary = "; ".join(r.summary for r in reports)
        for file_report in reports:
            section = task_report.add_section()
            section.add_header(file_report.title)
            section.add_paragraph(file_report.summary)
    return create_task_result(
        output_files=output_files,
        workflow_id=workflow_id,
        task_report=task_report.to_dict(),
    )


def _matches_filter(name: str, patterns: list[str]) -> bool:
    path = uac.original_path(name)
    return any(
        fnmatch.fnmatchcase(path, p) or fnmatch.fnmatchcase(name, p) for p in patterns
    )


@celery.task(bind=True, name=EXTRACT_TASK_NAME, metadata=EXTRACT_TASK_METADATA)
def extract(
    self,
    pipe_result: str = None,
    input_files: list = None,
    output_path: str = None,
    workflow_id: str = None,
    task_config: dict = None,
) -> str:
    """Extract the files of selected UAC artifacts."""
    task_config = task_config or {}
    input_files = get_input_files(pipe_result, input_files or [], filter=COMPATIBLE_INPUTS)
    _start(input_files, task_config, workflow_id)
    password = task_config.get("archive_password") or None
    requested = _split(task_config.get("artifacts"))
    profile = task_config.get("profile") or ""
    file_filter = _split(task_config.get("file_filter"))
    # Only an explicit False opts out; a null from a client must not drop files.
    register_in_db = task_config.get("register_in_db") is not False
    if not (requested or profile or file_filter):
        raise RuntimeError("Select artifacts, a profile, or a file filter to extract.")

    output_files = []
    summary = []
    for input_file in input_files:
        selected = uac.resolve_artifacts(requested)
        if profile == PROFILE_AUTO:
            selected += _collection_info(input_file, password).artifacts()
        elif profile:
            selected += uac.profile_artifacts(profile)
        classifier = uac.Classifier(list(dict.fromkeys(selected)))
        extracted = {}
        per_artifact = Counter()
        skipped_links = 0
        for member, open_member in uac.iter_archive(input_file.get("path"), password):
            if member.kind not in ("file", "hardlink"):
                continue
            artifact_id = classifier.classify(member.name)
            if artifact_id is None and not _matches_filter(member.name, file_filter):
                continue
            if member.kind == "hardlink" and member.linkname not in extracted:
                # In a tar stream a hard link's data is only at its target.
                skipped_links += 1
                continue
            output_file = create_output_file(
                output_path,
                display_name=os.path.basename(member.name),
                original_path=uac.original_path(member.name),
                data_type=f"uac:artifact:{artifact_id}" if artifact_id else "uac:file",
                source_file_id=input_file.get("id"),
                register_in_db=register_in_db,
            )
            if member.kind == "hardlink":
                shutil.copyfile(extracted[member.linkname], output_file.path)
            else:
                with open_member() as src, open(output_file.path, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
            extracted[member.name] = output_file.path
            per_artifact[artifact_id or "(file filter)"] += 1
            output_files.append(output_file.to_dict())
            if len(output_files) % PROGRESS_EVERY == 0:
                self.send_event("task-progress", data={"extracted": len(output_files)})
        summary.append((input_file, per_artifact, skipped_links))

    if not output_files:
        raise RuntimeError("No files in the UAC collection matched the selection.")

    task_report = Report("UAC artifact extraction")
    task_report.summary = f"Extracted {len(output_files)} files."
    for input_file, per_artifact, skipped_links in summary:
        section = task_report.add_section()
        section.add_header(input_file.get("display_name", ""))
        table = MarkdownTable(["Artifact", "Files"])
        for artifact_id, count in per_artifact.most_common():
            table.add_row([f"`{artifact_id}`", str(count)])
        section.add_table(table)
        if skipped_links:
            section.add_paragraph(
                f"{skipped_links} hard links skipped: their target wasn't selected."
            )
    return create_task_result(
        output_files=output_files,
        workflow_id=workflow_id,
        task_report=task_report.to_dict(),
    )


@celery.task(bind=True, name=TIMELINE_TASK_NAME, metadata=TIMELINE_TASK_METADATA)
def timeline_task(
    self,
    pipe_result: str = None,
    input_files: list = None,
    output_path: str = None,
    workflow_id: str = None,
    task_config: dict = None,
) -> str:
    """Write the events of a UAC collection as Timesketch or Elasticsearch files."""
    task_config = task_config or {}
    input_files = get_input_files(pipe_result, input_files or [], filter=COMPATIBLE_INPUTS)
    _start(input_files, task_config, workflow_id)
    password = task_config.get("archive_password") or None
    sources = _split(task_config.get("sources")) or list(timeline.SOURCES)
    unknown = set(sources) - set(timeline.SOURCES)
    if unknown:
        raise RuntimeError(f"Unknown sources: {', '.join(sorted(unknown))}")
    output_format = task_config.get("output_format") or timeline.FORMAT_TIMESKETCH
    if output_format not in timeline.FORMATS:
        raise RuntimeError(f"Unknown output format: {output_format}")
    is_es = output_format == timeline.FORMAT_ELASTICSEARCH

    output_files = []
    task_report = Report("UAC timeline")
    total_events = 0
    for input_file in input_files:
        info = _collection_info(input_file, password)
        hostname = info.hostname or "unknown"
        index = timeline.index_name(hostname)
        base = _base_name(input_file)
        classifier = uac.Classifier()
        writers = {}

        def new_file(source, part):
            if is_es:
                name = f"{base}_{source}_part{part:03d}.ndjson"
            else:
                name = f"{base}_{source}.jsonl"
            output_file = create_output_file(
                output_path,
                display_name=name,
                data_type=f"uac:timeline:{source}",
                source_file_id=input_file.get("id"),
            )
            output_files.append(output_file.to_dict())
            return output_file.path

        for member, open_member in uac.iter_archive(input_file.get("path"), password):
            if member.kind != "file":
                continue
            source = timeline.source_of(member.name)
            if source not in sources:
                continue
            if source not in writers:
                writers[source] = timeline.Writer(
                    output_format,
                    hostname,
                    index,
                    lambda part, source=source: new_file(source, part),
                )
            writer = writers[source]
            with open_member() as stream:
                for event in timeline.events_for(
                    member.name,
                    source,
                    classifier.classify(member.name),
                    member.mtime,
                    stream,
                ):
                    writer.write(event)
                    if writer.events % 500_000 == 0:
                        self.send_event(
                            "task-progress", data={"source": source, "events": writer.events}
                        )
        for writer in writers.values():
            writer.close()

        section = task_report.add_section()
        section.add_header(input_file.get("display_name", ""))
        table = MarkdownTable(["Source", "Events", "Files"])
        for source, writer in writers.items():
            table.add_row([source, str(writer.events), str(writer.part)])
            total_events += writer.events
        section.add_table(table)
        if is_es:
            section.add_paragraph(
                f"Index `{index}`. Send each file with: curl -H 'Content-Type:"
                " application/x-ndjson' --data-binary @<file> <es>/_bulk"
            )

    if not output_files:
        raise RuntimeError("The UAC collection has none of the selected sources.")
    task_report.summary = f"{total_events} events in {len(output_files)} files ({output_format})."
    return create_task_result(
        output_files=output_files,
        workflow_id=workflow_id,
        task_report=task_report.to_dict(),
    )
