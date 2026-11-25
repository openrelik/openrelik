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

"""Workflow helpers to create, manipulate or run workflows."""

from datetime import datetime, timezone
import json
import os
from typing import Optional
from uuid import uuid4

from celery import chain as celery_chain
from celery import chord as celery_chord
from celery import group as celery_group
from celery import signature
from celery.app import Celery
from celery.canvas import Signature
import kombu.exceptions
from openrelik_common.celery_utils import configure_celery_app
from sqlalchemy.orm import Session

from api.v1 import schemas
from datastores.sql.crud.folder import create_subfolder_in_db
from datastores.sql.crud.workflow import (
    create_task_in_db,
    create_workflow_in_db,
    get_workflow_template_from_db,
)
from datastores.sql.models.workflow import Task, Workflow
from lib.celery_utils import get_registered_tasks

# Redis URL and Celery app initialization.
_redis_url = os.getenv("REDIS_URL")
celery_app = configure_celery_app(Celery(broker=_redis_url, backend=_redis_url))


def update_task_config_values(data: dict | list, parameters: dict) -> None:
    """
    Recursively traverses a dictionary or list to find 'task_config' lists
    and updates the 'value' of each item based on the unique 'param_name'.

    Args:
        data (dict | list): The dictionary or list to traverse.
        parameters (dict): A dictionary where keys are the unique 'param_name'.
    """
    if isinstance(data, dict):
        task_config = data.get("task_config", [])
        for item in task_config:
            param_name = item.get("param_name")
            if not param_name:
                continue

            if param_name in parameters:
                item["value"] = parameters[param_name]
                continue

        for _, value in data.items():
            update_task_config_values(value, parameters)

    elif isinstance(data, list):
        for item in data:
            update_task_config_values(item, parameters)


def get_task_signature(
    db: Session,
    current_user: schemas.User,
    task_data: dict,
    input_files: list,
    output_path: str,
    workflow: schemas.Workflow,
) -> Signature:
    """Returns a Celery task signature for a given task.

    Args:
        db (Session): The database session.
        current_user (schemas.User): The current user.
        task_data (dict): The task data.
        input_files (list): A list of input files.
        output_path (str): The output path.
        workflow (schemas.Workflow): The workflow.

    Returns:
        Signature: The Celery task signature.
    """

    try:
        valid_tasks = get_registered_tasks(celery_app)
    except kombu.exceptions.OperationalError:
        valid_tasks = []

    task_name = task_data.get("task_name")

    task_info = None
    for task in valid_tasks:
        if task.get("task_name") == task_name:
            task_info = task
            break

    if not task_info:
        raise ValueError(f"Task name {task_name} is not allowed or not registered.")

    task_uuid = uuid4().hex
    task_data["uuid"] = task_uuid
    queue_name = task_info.get("queue_name")

    task_config = {
        option["name"]: option.get("value")
        for option in task_data.get("task_config", {})
    }

    # Create a new DB task
    new_task_db = Task(
        display_name=task_data.get("display_name"),
        description=task_data.get("description"),
        config=json.dumps(task_config),
        uuid=task_uuid,
        user=current_user,
        workflow=workflow,
        status_short="PENDING",
    )
    create_task_in_db(db, new_task_db)

    task_signature = signature(
        task_name,
        kwargs={
            "input_files": input_files,
            "output_path": output_path,
            "workflow_id": workflow.id,
            "task_config": task_config,
        },
        queue=queue_name,
        task_id=task_uuid,
        app=celery_app,
    )
    return task_signature


def create_workflow_signature(
    db: Session,
    current_user: schemas.User,
    task_data: dict,
    input_files: list,
    output_path: str,
    workflow: schemas.Workflow,
) -> Signature:
    """Creates a Celery workflow signature for a given task definition

    This function recursively constructs a Celery workflow signature based on the
    provided `task_data`, which represents a structured description of tasks and their
    dependencies. It supports two primary task types: 'chain' and 'task'.

    chain: Represents a sequence of tasks executed in order.
        -   If the chain contains multiple tasks, a Celery `celery_group` is created to
            execute them concurrently. celery_group allows multiple tasks to be run
            in parallel.
        -   If only one task is present, a Celery `celery_chain` is created to execute
            it *serially*. `celery_chain` ensures tasks are executed one after another,
            ith the output of one task becoming the input of the next.

    task: Represents a single, executable task.
        - It retrieves the corresponding Celery task signature using get_task_signature.
        - If the task has sub-tasks, they are incorporated into the workflow using
          Celery `celery_chain` and `celery_group` constructs, depending on the number
          of sub-tasks. The primary task is chained with the subtasks.

    The function effectively translates a hierarchical task description into a Celery
    workflow that can be executed asynchronously. This allows for complex workflows to
    be defined and executed in a distributed manner.

    Args:
        db (Session): The database session.
        current_user (schemas.User): The current user.
        task_data (dict): The task data.
        input_files (list): A list of input files.
        output_path (str): The output path.
        workflow (schemas.Workflow): The workflow.

    Returns:
        Signature: The Celery workflow signature.

    Raises:
        ValueError: If the task type is not supported.
    """
    if task_data["type"] == "chain":
        if len(task_data["tasks"]) > 1:
            # A list, not a generator: celery_group wraps generators lazily,
            # which would defer DB task creation (and the uuid rewrite in
            # workflow_spec) until apply_async(), after spec_json is saved.
            return celery_group(
                [
                    create_workflow_signature(
                        db, current_user, task, input_files, output_path, workflow
                    )
                    for task in task_data["tasks"]
                ],
                app=celery_app,
            )
        else:
            return celery_chain(
                create_workflow_signature(
                    db,
                    current_user,
                    task_data["tasks"][0],
                    input_files,
                    output_path,
                    workflow,
                ),
                app=celery_app,
            )

    elif task_data["type"] == "chord":
        header_tasks = [
            create_workflow_signature(
                db, current_user, t, input_files, output_path, workflow
            )
            for t in task_data.get("tasks", [])
        ]

        callback_task_data = task_data.get("callback")
        if not callback_task_data:
            raise ValueError("Chord definition requires a 'callback' task.")

        callback_signature = create_workflow_signature(
            db, current_user, callback_task_data, input_files, output_path, workflow
        )

        return celery_chord(header_tasks, callback_signature, app=celery_app)

    elif task_data["type"] == "task":
        task_signature = get_task_signature(
            db, current_user, task_data, input_files, output_path, workflow
        )
        if task_data["tasks"]:
            if len(task_data["tasks"]) > 1:
                return celery_chain(
                    task_signature,
                    celery_group(
                        [
                            create_workflow_signature(
                                db, current_user, t, input_files, output_path, workflow
                            )
                            for t in task_data["tasks"]
                        ],
                        app=celery_app,
                    ),
                    app=celery_app,
                )
            else:
                return celery_chain(
                    task_signature,
                    create_workflow_signature(
                        db,
                        current_user,
                        task_data["tasks"][0],
                        input_files,
                        output_path,
                        workflow,
                    ),
                    app=celery_app,
                )
        else:
            return task_signature
    else:
        raise ValueError(f"Unsupported task type: {task_data['type']}")


def replace_uuids(data: dict | list, replace_with: str = None) -> dict | list:
    """Recursively replaces UUID keys within a dictionary or list structure.

    This function traverses the provided `data` structure (which can be a dictionary or
    list) and replaces any dictionary keys named "uuid" with a new value.

    If `replace_with` is not provided (or is None), a newly generated UUID is used as
    the replacement. If `replace_with` is provided, that value is used as the
    replacement for all "uuid" keys.

    This is needed when modifying workflow specifications that contain UUIDs, ensuring
    that each instance has unique identifiers.

    Args:
        data (dict | list): The dictionary or list to traverse and modify.
        replace_with (str, optional): The value to replace UUIDs with. Defaults to None.

    Returns:
        dict | list: The modified dictionary or list with UUIDs replaced.
    """
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "uuid":
                if not replace_with:
                    data[key] = uuid4().hex
                else:
                    data[key] = replace_with
            else:
                replace_uuids(value)
    elif isinstance(data, list):
        for item in data:
            replace_uuids(item)


class TemplateNotFoundError(ValueError):
    """Raised when ``create_workflow`` cannot resolve a template id."""


def create_workflow(
    db: Session,
    *,
    display_name: Optional[str] = None,
    folder_id: int,
    file_ids: list[int],
    template_id: Optional[int],
    template_params: Optional[dict],
    user: schemas.User,
) -> Workflow:
    """Create a Workflow (optionally from a template) and return it.

    Args:
        db (Session): The database session.
        display_name (Optional[str]): Optional override for the workflow's
            (and results subfolder's) display name. When None, falls back to
            the template's display name, or "Untitled workflow" if no
            template.
        folder_id (int): The ID of the parent folder that will hold the
            workflow's results subfolder.
        file_ids (list[int]): IDs of the files to associate with the workflow.
        template_id (Optional[int]): Optional ID of a workflow template to
            create the workflow from.
        template_params (Optional[dict]): Optional dict of parameter values
            to apply to the template's task configs. Keys should correspond
            to the template's task config parameters.
        user (schemas.User): The user creating the workflow.

    Returns:
        Workflow: The newly created workflow.

    Raises:
        TemplateNotFoundError: When ``template_id`` is provided but the
            template does not exist.
    """
    default_workflow_display_name = "Untitled workflow"
    default_spec_json = None
    from_template = None

    if template_id:
        from_template = get_workflow_template_from_db(db, template_id)
        if not from_template:
            raise TemplateNotFoundError(f"Workflow template {template_id} not found")
        default_workflow_display_name = from_template.display_name
        spec_json = json.loads(from_template.spec_json)
        # Replace the placeholder UUIDs seeded in the template with fresh ones
        # so each workflow instance has unique identifiers.
        replace_uuids(spec_json)
        if template_params:
            update_task_config_values(spec_json, template_params)
        default_spec_json = json.dumps(spec_json)

    workflow_display_name = display_name or default_workflow_display_name

    # Create a new folder to hold workflow results.
    new_folder = schemas.FolderCreateRequest(
        display_name=workflow_display_name, parent_id=folder_id
    )
    new_workflow_folder = create_subfolder_in_db(db, folder_id, new_folder, user)

    new_workflow_db = schemas.Workflow(
        display_name=workflow_display_name,
        user_id=user.id,
        spec_json=default_spec_json,
        file_ids=file_ids,
        folder_id=new_workflow_folder.id,
        template_id=from_template.id if from_template else None,
    )
    return create_workflow_in_db(db, new_workflow_db)


def run_workflow(
    db: Session,
    *,
    workflow: Workflow,
    workflow_spec: dict,
    user: schemas.User,
) -> Workflow:
    """Runs a workflow via Celery.

    Builds input-file dicts from ``workflow.files``, ensures the output
    directory exists, constructs the Celery canvas, and calls
    ``apply_async()``.

    Returns:
        A Workflow instance representing the workflow that was run.
    """
    input_files = [
        {
            "id": file.id,
            "uuid": file.uuid.hex,
            "display_name": file.display_name,
            "extension": file.extension,
            "data_type": file.data_type,
            "mime_type": file.magic_mime,
            "path": file.path,
        }
        for file in workflow.files
    ]

    output_path = workflow.folder.path
    os.makedirs(output_path, exist_ok=True)

    celery_workflow = create_workflow_signature(
        db,
        user,
        workflow_spec.get("workflow"),
        input_files,
        output_path,
        workflow,
    )
    # create_workflow_signature() (via get_task_signature()) mutates each
    # node's "uuid" in workflow_spec in place, assigning the server-generated
    # task_id actually dispatched to Celery. Persist spec_json only after
    # that walk, so the DB task rows' uuids match the spec tree the frontend
    # matches them against -- serializing before this point would persist
    # the pre-dispatch (client-supplied) uuids instead.
    workflow.spec_json = json.dumps(workflow_spec)
    celery_workflow.apply_async()

    db.add(workflow)
    db.commit()
    db.refresh(workflow)

    return workflow


def _normalize_task_state(status_short: Optional[str]) -> str:
    """Map Celery task status strings into the five workflow summary states."""
    if not status_short:
        return "pending"
    upper = status_short.upper()
    if upper == "SUCCESS":
        return "success"
    if upper in ("FAILURE", "REJECTED", "REVOKED"):
        return "failed"
    if upper in ("STARTED", "PROGRESS"):
        return "running"
    return "pending"


def summarize_workflow_tasks(
    spec_json: Optional[str],
    tasks: list[Task],
    *,
    live_task_ids: Optional[set[str]] = None,
    online_queues: Optional[set[str]] = None,
    truncated_queues: Optional[set[str]] = None,
    grace_seconds: float = 60.0,
) -> dict:
    """Summarize task progress, DAG-aware liveness, and stall status for a workflow.

    Mirrors Runestone's ``isActive`` rule: tasks chained after a failed task, or a
    chord callback whose header had a failure, never execute and are counted as
    ``skipped`` rather than keeping the workflow active forever.

    When ``live_task_ids`` and ``online_queues`` are provided from Celery/Redis,
    active tasks older than ``grace_seconds`` are cross-checked to detect
    ``no_worker`` (queued in Redis for an offline queue) or ``stalled`` (missing
    from Celery and Redis altogether).

    Args:
        spec_json: JSON string describing the workflow tree, or None.
        tasks: Database ``Task`` records belonging to the workflow.
        live_task_ids: Normalized hex UUIDs currently active, reserved, or queued.
        online_queues: Celery queue names that currently have >=1 online worker.
        truncated_queues: Queues whose Redis ``LRANGE`` scan was truncated.
        grace_seconds: Minimum age since last task update before flagging stalled.

    Returns:
        dict: Counts, ``elapsed_seconds``, ``is_active``, and ``stall_reason``.
    """
    counts = {
        "success": 0,
        "running": 0,
        "queued": 0,
        "waiting": 0,
        "failed": 0,
        "skipped": 0,
    }

    if not tasks:
        return {
            "tasks_total": 0,
            "tasks_done": 0,
            "tasks_running": 0,
            "tasks_queued": 0,
            "tasks_waiting": 0,
            "tasks_failed": 0,
            "tasks_skipped": 0,
            "elapsed_seconds": 0.0,
            "is_active": False,
            "stall_reason": None,
        }

    status_by_uuid: dict[str, str] = {}
    for task in tasks:
        if task.uuid is None:
            continue
        state = _normalize_task_state(task.status_short)
        status_by_uuid[task.uuid.hex] = state
        status_by_uuid[str(task.uuid)] = state

    parsed_root = None
    if spec_json:
        try:
            spec = json.loads(spec_json)
            if isinstance(spec, dict) and isinstance(spec.get("workflow"), dict):
                parsed_root = spec["workflow"]
        except (TypeError, ValueError):
            parsed_root = None

    visited_any = False
    dispatched_active: list[tuple[str, str]] = []

    def _walk_nodes(
        nodes: list, upstream_ready: bool, upstream_failed: bool
    ) -> tuple[bool, bool]:
        """Walk spec nodes, returning ``(any_failed, all_succeeded)`` for this subtree."""
        nonlocal visited_any
        subtree_failed = False
        subtree_all_succeeded = True
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_type = node.get("type")
            if node_type == "task":
                visited_any = True
                raw_uuid = str(node.get("uuid") or "")
                hex_uuid = raw_uuid.replace("-", "")
                state = status_by_uuid.get(raw_uuid) or status_by_uuid.get(hex_uuid)
                if upstream_failed:
                    effective = "skipped"
                elif state is None or state == "pending":
                    effective = "queued" if upstream_ready else "waiting"
                else:
                    effective = state
                counts[effective] += 1
                if effective in ("running", "queued"):
                    q_name = str(node.get("queue_name") or "")
                    if not q_name and isinstance(node.get("task_name"), str):
                        q_name = node["task_name"].split(".")[0]
                    dispatched_active.append((hex_uuid, q_name))
                node_failed = effective == "failed"
                node_succeeded = effective == "success"
                child_failed, child_all_succeeded = _walk_nodes(
                    node.get("tasks") or [],
                    upstream_ready=node_succeeded,
                    upstream_failed=upstream_failed or node_failed,
                )
                if node_failed or child_failed:
                    subtree_failed = True
                if not node_succeeded or not child_all_succeeded:
                    subtree_all_succeeded = False
            elif node_type == "chord":
                header_failed, header_all_succeeded = _walk_nodes(
                    node.get("tasks") or [],
                    upstream_ready=upstream_ready,
                    upstream_failed=upstream_failed,
                )
                callback = node.get("callback")
                cb_failed = False
                cb_succeeded = True
                if isinstance(callback, dict):
                    cb_failed, cb_succeeded = _walk_nodes(
                        [callback],
                        upstream_ready=not header_failed and header_all_succeeded,
                        upstream_failed=upstream_failed or header_failed,
                    )
                if header_failed or cb_failed:
                    subtree_failed = True
                if not header_all_succeeded or not cb_succeeded:
                    subtree_all_succeeded = False
            elif node_type == "chain":
                ch_failed, ch_succeeded = _walk_nodes(
                    node.get("tasks") or [],
                    upstream_ready=upstream_ready,
                    upstream_failed=upstream_failed,
                )
                if ch_failed:
                    subtree_failed = True
                if not ch_succeeded:
                    subtree_all_succeeded = False
        return subtree_failed, subtree_all_succeeded

    if parsed_root and isinstance(parsed_root.get("tasks"), list):
        _walk_nodes(parsed_root["tasks"], upstream_ready=True, upstream_failed=False)

    if not visited_any:
        for task in tasks:
            state = _normalize_task_state(task.status_short)
            effective = "queued" if state == "pending" else state
            counts[effective] += 1
            if effective in ("running", "queued") and task.uuid is not None:
                dispatched_active.append((task.uuid.hex, ""))

    total = sum(counts.values())
    is_active = (counts["running"] + counts["queued"] + counts["waiting"]) > 0

    now = datetime.now(timezone.utc)
    created_times = [t.created_at for t in tasks if t.created_at is not None]
    if created_times:
        started_at = min(created_times)
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        elapsed_seconds = max(0.0, (now - started_at).total_seconds())
    else:
        elapsed_seconds = 0.0

    stall_reason: Optional[str] = None
    if is_active and live_task_ids is not None and dispatched_active:
        online_q = online_queues or set()
        trunc_q = truncated_queues or set()

        def _task_ts(db_task: Task) -> Optional[datetime]:
            ts = db_task.updated_at or db_task.created_at
            if ts is None:
                return None
            return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts

        # Measure grace against the most recent task update in the workflow so a slow
        # upstream step finishing after >60s does not falsely flag its newly unlocked
        # successor as stalled while a cached live_task_ids snapshot catches up.
        activity_times = [ts for t in tasks if (ts := _task_ts(t)) is not None]
        workflow_idle_seconds = (
            max(0.0, (now - max(activity_times)).total_seconds())
            if activity_times
            else grace_seconds + 1.0
        )
        past_grace = workflow_idle_seconds >= grace_seconds

        has_healthy_live = False
        has_offline_queued = False

        for hex_uuid, q_name in dispatched_active:
            in_celery_or_truncated = (hex_uuid in live_task_ids) or (q_name in trunc_q)
            if in_celery_or_truncated:
                if q_name and q_name not in online_q:
                    has_offline_queued = True
                else:
                    has_healthy_live = True

        if not has_healthy_live:
            if has_offline_queued:
                stall_reason = "no_worker"
            elif past_grace:
                stall_reason = "stalled"

    return {
        "tasks_total": total,
        "tasks_done": counts["success"],
        "tasks_running": counts["running"],
        "tasks_queued": counts["queued"],
        "tasks_waiting": counts["waiting"],
        "tasks_failed": counts["failed"],
        "tasks_skipped": counts["skipped"],
        "elapsed_seconds": round(elapsed_seconds, 1),
        "is_active": is_active,
        "stall_reason": stall_reason,
    }
