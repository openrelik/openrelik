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

from datetime import datetime, timedelta, timezone
import json
import uuid
from unittest import mock

import pytest
from celery import signature

from lib.workflow_utils import (
    TemplateNotFoundError,
    create_workflow,
    replace_uuids,
    run_workflow,
    summarize_workflow_tasks,
    update_task_config_values,
)


def test_update_task_config_values():
    """Test update_task_config_values updates values correctly."""
    data = {
        "task_config": [
            {"param_name": "param_1", "value": "old_value_1"},
            {"param_name": "param_2", "value": "old_value_2"},
        ],
        "sub_item": {
            "task_config": [
                {
                    "param_name": "param_1",
                    "value": "old_value_3",
                },  # Same param_name, updates too
            ]
        },
    }

    parameters = {
        "param_1": "new_value_1",
        "param_2": "new_value_2",
    }

    update_task_config_values(data, parameters)

    assert data["task_config"][0]["value"] == "new_value_1"
    assert data["task_config"][1]["value"] == "new_value_2"
    assert data["sub_item"]["task_config"][0]["value"] == "new_value_1"


def test_update_task_config_values_list():
    """Test update_task_config_values with a list of items."""
    data = [
        {"task_config": [{"param_name": "param_1", "value": "old"}]},
        {"task_config": [{"param_name": "param_1", "value": "old"}]},
    ]

    parameters = {"param_1": "new"}

    update_task_config_values(data, parameters)

    assert data[0]["task_config"][0]["value"] == "new"
    assert data[1]["task_config"][0]["value"] == "new"


def test_replace_uuids_generates_fresh_uuids():
    data = {"uuid": "OLD", "inner": {"uuid": "OLD"}, "list": [{"uuid": "OLD"}]}
    replace_uuids(data)
    assert data["uuid"] != "OLD"
    assert data["inner"]["uuid"] != "OLD"
    assert data["list"][0]["uuid"] != "OLD"


def test_replace_uuids_with_explicit_value():
    data = {"uuid": "OLD", "inner": {"uuid": "OLD"}}
    replace_uuids(data, replace_with="PLACEHOLDER")
    assert data["uuid"] == "PLACEHOLDER"


def _make_user(user_id=42):
    user = mock.Mock()
    user.id = user_id
    return user


def test_create_workflow_with_template(mocker):
    mock_template = mock.Mock()
    mock_template.id = 7
    mock_template.display_name = "My Template"
    mock_template.spec_json = json.dumps(
        {
            "uuid": "SEED",
            "workflow": {"task_config": [{"param_name": "p", "value": None}]},
        }
    )
    mock_folder = mock.Mock(id=99)
    mock_workflow = mock.Mock()

    mocker.patch(
        "lib.workflow_utils.get_workflow_template_from_db", return_value=mock_template
    )
    mock_create_folder = mocker.patch(
        "lib.workflow_utils.create_subfolder_in_db", return_value=mock_folder
    )
    mock_create_workflow = mocker.patch(
        "lib.workflow_utils.create_workflow_in_db", return_value=mock_workflow
    )

    result = create_workflow(
        db=mock.Mock(),
        folder_id=3,
        file_ids=[1, 2],
        template_id=7,
        template_params={"p": "applied"},
        user=_make_user(),
    )

    assert result is mock_workflow
    mock_create_folder.assert_called_once()
    created_schema = mock_create_workflow.call_args.args[1]
    # The spec was deserialized, uuids replaced, params applied, and re-serialized.
    rendered = json.loads(created_schema.spec_json)
    assert rendered["uuid"] != "SEED"
    assert rendered["workflow"]["task_config"][0]["value"] == "applied"
    assert created_schema.template_id == 7
    assert created_schema.display_name == "My Template"


def test_create_workflow_without_template(mocker):
    mock_folder = mock.Mock(id=99)
    mock_workflow = mock.Mock()
    mocker.patch("lib.workflow_utils.create_subfolder_in_db", return_value=mock_folder)
    mock_create_workflow = mocker.patch(
        "lib.workflow_utils.create_workflow_in_db", return_value=mock_workflow
    )

    result = create_workflow(
        db=mock.Mock(),
        folder_id=3,
        file_ids=[],
        template_id=None,
        template_params=None,
        user=_make_user(),
    )
    assert result is mock_workflow
    created_schema = mock_create_workflow.call_args.args[1]
    assert created_schema.display_name == "Untitled workflow"
    assert created_schema.spec_json is None
    assert created_schema.template_id is None


def test_create_workflow_raises_when_template_missing(mocker):
    mocker.patch("lib.workflow_utils.get_workflow_template_from_db", return_value=None)
    with pytest.raises(TemplateNotFoundError):
        create_workflow(
            db=mock.Mock(),
            folder_id=3,
            file_ids=[],
            template_id=999,
            template_params=None,
            user=_make_user(),
        )


def test_run_workflow_persists_spec_and_dispatches(mocker, tmp_path):
    fake_file = mock.Mock()
    fake_file.id = 1
    fake_file.uuid.hex = "abc"
    fake_file.display_name = "x"
    fake_file.extension = ".txt"
    fake_file.data_type = "dt"
    fake_file.magic_mime = "text/plain"
    fake_file.path = "/tmp/x"

    workflow = mock.Mock()
    workflow.files = [fake_file]
    workflow.folder.path = str(tmp_path / "output")  # will need to be created

    mock_signature = mock.Mock()
    mocker.patch(
        "lib.workflow_utils.create_workflow_signature", return_value=mock_signature
    )

    spec = {"workflow": {"type": "chain", "tasks": []}}
    db = mock.Mock()

    result = run_workflow(db, workflow=workflow, workflow_spec=spec, user=_make_user())

    # spec was persisted to the workflow before dispatch
    assert workflow.spec_json == json.dumps(spec)
    mock_signature.apply_async.assert_called_once()
    # output directory was created on demand
    assert (tmp_path / "output").is_dir()
    # DB round-trip completed
    db.add.assert_called_once_with(workflow)
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(workflow)
    assert result is workflow


def test_run_workflow_persists_spec_after_uuid_assignment(mocker, tmp_path):
    """spec_json must reflect the uuids actually dispatched to Celery.

    create_workflow_signature() (via get_task_signature()) mutates each
    task node's "uuid" in place, assigning the server-generated task_id.
    spec_json must be serialized AFTER that mutation -- serializing before
    would persist the pre-dispatch uuids, permanently diverging from the
    DB task rows' uuids and breaking the frontend's uuid-based task lookup.
    """
    fake_file = mock.Mock()
    fake_file.id = 1
    fake_file.uuid.hex = "abc"
    fake_file.display_name = "x"
    fake_file.extension = ".txt"
    fake_file.data_type = "dt"
    fake_file.magic_mime = "text/plain"
    fake_file.path = "/tmp/x"

    workflow = mock.Mock()
    workflow.files = [fake_file]
    workflow.folder.path = str(tmp_path / "output")

    task_node = {"type": "task", "uuid": "pre-dispatch-uuid", "tasks": []}
    spec = {"workflow": task_node}

    def fake_create_workflow_signature(db, user, task_data, *args, **kwargs):
        # Simulate get_task_signature()'s real mutation: overwrite whatever
        # uuid was there with a freshly generated one.
        task_data["uuid"] = "server-generated-uuid"
        return mock.Mock()

    mocker.patch(
        "lib.workflow_utils.create_workflow_signature",
        side_effect=fake_create_workflow_signature,
    )

    db = mock.Mock()
    run_workflow(db, workflow=workflow, workflow_spec=spec, user=_make_user())

    persisted = json.loads(workflow.spec_json)
    assert persisted["workflow"]["uuid"] == "server-generated-uuid"


def test_run_workflow_persists_uuids_of_parallel_tasks(mocker, tmp_path):
    """Tasks inside a parallel group must get their uuids before spec_json.

    celery_group() wraps a generator lazily, so building a group from a
    generator deferred get_task_signature() (DB row + uuid rewrite) until
    apply_async(), after spec_json had been serialized. Uses the real
    create_workflow_signature() so the group construction is exercised.
    """
    workflow = mock.Mock()
    workflow.files = []
    workflow.folder.path = str(tmp_path / "output")

    dispatched = []

    def fake_get_task_signature(db, user, task_data, *args, **kwargs):
        task_data["uuid"] = f"server-{len(dispatched)}"
        dispatched.append(task_data["uuid"])
        return signature("dummy.task")

    mocker.patch(
        "lib.workflow_utils.get_task_signature", side_effect=fake_get_task_signature
    )
    mocker.patch("celery.canvas.group.apply_async")
    mocker.patch("celery.canvas._chain.apply_async")

    def task(uuid, children=()):
        return {"type": "task", "uuid": uuid, "tasks": list(children)}

    # Root fan-out (chain with >1 tasks), a task with >1 children (both code
    # paths that build a celery_group) and a chord inside the root group.
    spec = {
        "workflow": {
            "type": "chain",
            "isRoot": True,
            "tasks": [
                task("client-a", [task("client-a1"), task("client-a2")]),
                task("client-b"),
                {
                    "type": "chord",
                    "tasks": [task("client-c1"), task("client-c2")],
                    "callback": task("client-c3"),
                },
            ],
        }
    }

    run_workflow(mock.Mock(), workflow=workflow, workflow_spec=spec, user=_make_user())

    persisted = json.loads(workflow.spec_json)
    uuids = []

    def walk(node):
        if node.get("uuid"):
            uuids.append(node["uuid"])
        for child in node.get("tasks", []):
            walk(child)
        if node.get("callback"):
            walk(node["callback"])

    walk(persisted["workflow"])
    assert sorted(uuids) == sorted(dispatched)
    assert len(dispatched) == 7
    assert not any(u.startswith("client-") for u in uuids)


def _make_db_task(
    task_uuid: uuid.UUID, status_short: str | None, age_seconds: float = 120.0
):
    now = datetime.now(timezone.utc)
    ts = now - timedelta(seconds=age_seconds)
    t = mock.Mock()
    t.uuid = task_uuid
    t.status_short = status_short
    t.created_at = ts
    t.updated_at = ts
    return t


def test_summarize_workflow_tasks_chain_failed_upstream_skips_downstream():
    """A PENDING task chained after a FAILURE is counted as skipped, not active."""
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    spec = json.dumps(
        {
            "workflow": {
                "type": "chain",
                "tasks": [
                    {
                        "type": "task",
                        "uuid": str(u1),
                        "queue_name": "openrelik-worker-a",
                        "tasks": [
                            {
                                "type": "task",
                                "uuid": str(u2),
                                "queue_name": "openrelik-worker-b",
                                "tasks": [],
                            }
                        ],
                    }
                ],
            }
        }
    )
    tasks = [_make_db_task(u1, "FAILURE"), _make_db_task(u2, "PENDING")]
    summary = summarize_workflow_tasks(spec, tasks)
    assert summary["is_active"] is False
    assert summary["tasks_failed"] == 1
    assert summary["tasks_skipped"] == 1
    assert summary["tasks_queued"] == 0
    assert summary["tasks_waiting"] == 0


def test_summarize_workflow_tasks_parallel_sibling_stays_active_and_splits_queued_waiting():
    """Running upstream marks child as waiting; failed sibling does not hide live sibling."""
    u_fail, u_fail_child, u_run, u_wait = (
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
    )
    spec = json.dumps(
        {
            "workflow": {
                "type": "chain",
                "tasks": [
                    {
                        "type": "task",
                        "uuid": str(u_fail),
                        "queue_name": "q-a",
                        "tasks": [
                            {
                                "type": "task",
                                "uuid": str(u_fail_child),
                                "queue_name": "q-a",
                                "tasks": [],
                            }
                        ],
                    },
                    {
                        "type": "task",
                        "uuid": str(u_run),
                        "queue_name": "q-b",
                        "tasks": [
                            {
                                "type": "task",
                                "uuid": str(u_wait),
                                "queue_name": "q-b",
                                "tasks": [],
                            }
                        ],
                    },
                ],
            }
        }
    )
    tasks = [
        _make_db_task(u_fail, "FAILURE"),
        _make_db_task(u_fail_child, "PENDING"),
        _make_db_task(u_run, "STARTED"),
        _make_db_task(u_wait, "PENDING"),
    ]
    summary = summarize_workflow_tasks(spec, tasks)
    assert summary["is_active"] is True
    assert summary["tasks_total"] == 4
    assert summary["tasks_failed"] == 1
    assert summary["tasks_skipped"] == 1
    assert summary["tasks_running"] == 1
    assert summary["tasks_waiting"] == 1
    assert summary["tasks_queued"] == 0


def test_summarize_workflow_tasks_chord_callback_states():
    """Chord callback is waiting while header runs, queued on success, skipped on failure."""
    h1, h2, cb = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    spec = json.dumps(
        {
            "workflow": {
                "type": "chain",
                "tasks": [
                    {
                        "type": "chord",
                        "tasks": [
                            {
                                "type": "task",
                                "uuid": str(h1),
                                "queue_name": "q1",
                                "tasks": [],
                            },
                            {
                                "type": "task",
                                "uuid": str(h2),
                                "queue_name": "q1",
                                "tasks": [],
                            },
                        ],
                        "callback": {
                            "type": "task",
                            "uuid": str(cb),
                            "queue_name": "q2",
                            "tasks": [],
                        },
                    }
                ],
            }
        }
    )

    # Header partially running -> callback waiting.
    s_wait = summarize_workflow_tasks(
        spec,
        [
            _make_db_task(h1, "SUCCESS"),
            _make_db_task(h2, "STARTED"),
            _make_db_task(cb, "PENDING"),
        ],
    )
    assert s_wait["is_active"] is True
    assert s_wait["tasks_done"] == 1
    assert s_wait["tasks_running"] == 1
    assert s_wait["tasks_waiting"] == 1
    assert s_wait["tasks_queued"] == 0

    # Header succeeded -> callback queued.
    s_ready = summarize_workflow_tasks(
        spec,
        [
            _make_db_task(h1, "SUCCESS"),
            _make_db_task(h2, "SUCCESS"),
            _make_db_task(cb, "PENDING"),
        ],
    )
    assert s_ready["is_active"] is True
    assert s_ready["tasks_done"] == 2
    assert s_ready["tasks_queued"] == 1
    assert s_ready["tasks_waiting"] == 0

    # Header failed -> callback skipped, workflow inactive.
    s_fail = summarize_workflow_tasks(
        spec,
        [
            _make_db_task(h1, "SUCCESS"),
            _make_db_task(h2, "FAILURE"),
            _make_db_task(cb, "PENDING"),
        ],
    )
    assert s_fail["is_active"] is False
    assert s_fail["tasks_skipped"] == 1


def test_summarize_workflow_tasks_stall_detection_and_guards():
    """Tests no_worker, stalled, 60s grace period, and truncated-queue suppression."""
    u1 = uuid.uuid4()
    spec = json.dumps(
        {
            "workflow": {
                "type": "chain",
                "tasks": [
                    {
                        "type": "task",
                        "uuid": str(u1),
                        "queue_name": "openrelik-worker-plaso",
                        "tasks": [],
                    }
                ],
            }
        }
    )

    # Queued in Redis, but queue has no online worker -> no_worker.
    res_no_worker = summarize_workflow_tasks(
        spec,
        [_make_db_task(u1, "PENDING", age_seconds=120)],
        live_task_ids={u1.hex},
        online_queues={"openrelik-worker-strings"},
        truncated_queues=set(),
    )
    assert res_no_worker["stall_reason"] == "no_worker"

    # Missing from Celery/Redis and past 60s grace -> stalled.
    res_stalled = summarize_workflow_tasks(
        spec,
        [_make_db_task(u1, "PENDING", age_seconds=120)],
        live_task_ids=set(),
        online_queues={"openrelik-worker-plaso"},
        truncated_queues=set(),
    )
    assert res_stalled["stall_reason"] == "stalled"

    # Missing from Celery/Redis but within 60s grace -> None.
    res_grace = summarize_workflow_tasks(
        spec,
        [_make_db_task(u1, "PENDING", age_seconds=10)],
        live_task_ids=set(),
        online_queues={"openrelik-worker-plaso"},
        truncated_queues=set(),
    )
    assert res_grace["stall_reason"] is None

    # Missing from scanned UUIDs because queue scan was truncated -> None.
    res_trunc = summarize_workflow_tasks(
        spec,
        [_make_db_task(u1, "PENDING", age_seconds=120)],
        live_task_ids=set(),
        online_queues={"openrelik-worker-plaso"},
        truncated_queues={"openrelik-worker-plaso"},
    )
    assert res_trunc["stall_reason"] is None


def test_summarize_workflow_tasks_chain_handoff_respects_workflow_grace_window():
    """A slow step finishing after >60s resets the grace window for its newly queued successor."""
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    spec = json.dumps(
        {
            "workflow": {
                "type": "chain",
                "tasks": [
                    {
                        "type": "task",
                        "uuid": str(u1),
                        "queue_name": "openrelik-worker-plaso",
                        "tasks": [
                            {
                                "type": "task",
                                "uuid": str(u2),
                                "queue_name": "openrelik-worker-strings",
                                "tasks": [],
                            }
                        ],
                    }
                ],
            }
        }
    )

    # Step 1 finished 5s ago after a 10-minute run; Step 2's row was created at t=0 (600s ago).
    step1_recent = _make_db_task(u1, "SUCCESS", age_seconds=5)
    step2_old = _make_db_task(u2, "PENDING", age_seconds=600)
    res_handoff = summarize_workflow_tasks(
        spec,
        [step1_recent, step2_old],
        live_task_ids=set(),
        online_queues={"openrelik-worker-plaso", "openrelik-worker-strings"},
        truncated_queues=set(),
    )
    assert res_handoff["is_active"] is True
    assert res_handoff["tasks_queued"] == 1
    assert res_handoff["stall_reason"] is None

    # Once >60s pass with no updates anywhere in the workflow, flag stalled.
    step1_stale = _make_db_task(u1, "SUCCESS", age_seconds=120)
    res_stalled = summarize_workflow_tasks(
        spec,
        [step1_stale, step2_old],
        live_task_ids=set(),
        online_queues={"openrelik-worker-plaso", "openrelik-worker-strings"},
        truncated_queues=set(),
    )
    assert res_stalled["stall_reason"] == "stalled"


def test_summarize_workflow_tasks_fallback_without_spec():
    """Invalid or missing spec_json falls back to flat DB task status counts."""
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    summary = summarize_workflow_tasks(
        None,
        [_make_db_task(u1, "SUCCESS"), _make_db_task(u2, "PENDING")],
    )
    assert summary["is_active"] is True
    assert summary["tasks_total"] == 2
    assert summary["tasks_done"] == 1
    assert summary["tasks_queued"] == 1
