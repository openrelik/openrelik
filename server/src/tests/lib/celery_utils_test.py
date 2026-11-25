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

import json
import ast
import pytest
import redis.exceptions

from lib import celery_utils
from lib.celery_utils import (
    BrokerUnavailableError,
    REDIS_PRIORITY_SEP,
    get_cluster_status,
    get_live_task_snapshot,
    get_registered_tasks,
    update_task_queues,
    get_worker_stats,
    get_worker_configurations,
    get_worker_reports,
    ping_workers,
    get_active_tasks,
    get_scheduled_tasks,
    get_reserved_tasks,
    get_revoked_tasks,
    get_active_queues,
)


@pytest.fixture(autouse=True)
def reset_cluster_status_cache():
    """Reset module-level status caches between tests."""
    celery_utils._last_collected_monotonic = 0.0
    celery_utils._last_payload_cache = None
    celery_utils._last_live_snapshot = None
    celery_utils._status_redis_client = None
    yield
    celery_utils._last_collected_monotonic = 0.0
    celery_utils._last_payload_cache = None
    celery_utils._last_live_snapshot = None
    celery_utils._status_redis_client = None


@pytest.fixture
def mock_celery(mocker):
    """Fixture to provide a mock Celery app."""
    return mocker.MagicMock()


def test_get_registered_tasks(mock_celery):
    """Test get_registered_tasks with valid tasks."""
    mock_inspect = mock_celery.control.inspect.return_value

    # Simulate return value from celery
    mock_inspect.registered.return_value = {
        "worker1": [
            "task.name.1 {'display_name': 'Task 1', 'description': 'Test Task'}",
            "task.name.2 {'display_name': 'Task 2'}",
        ],
        "worker2": [
            "task.name.1 {'display_name': 'Task 1', 'description': 'Test Task'}"  # Duplicate task
        ],
    }

    tasks = get_registered_tasks(mock_celery)

    assert len(tasks) == 2
    assert tasks[0]["task_name"] == "task.name.1"
    assert tasks[0]["queue_name"] == "task"
    assert tasks[0]["display_name"] == "Task 1"
    assert tasks[1]["task_name"] == "task.name.2"
    assert tasks[1]["display_name"] == "Task 2"


def test_get_registered_tasks_skips_tasks_without_metadata(mock_celery):
    """Tasks without embedded metadata (e.g. the internal hashing task) are skipped.

    The hashing worker shares the broker and replies to inspect().registered(), but it
    registers its task without a metadata dict. Such tasks must be excluded rather than
    crashing the endpoint.
    """
    mock_inspect = mock_celery.control.inspect.return_value

    mock_inspect.registered.return_value = {
        "worker1": [
            "task.name.1 {'display_name': 'Task 1'}",
        ],
        "openrelik-hashing-worker": [
            # No metadata dict — internal mediator-dispatched task.
            "openrelik-hashing.tasks.generate_hashes",
        ],
    }

    tasks = get_registered_tasks(mock_celery)

    # Only the metadata-carrying worker task is returned; no exception raised.
    assert len(tasks) == 1
    assert tasks[0]["task_name"] == "task.name.1"


def test_get_registered_tasks_empty(mock_celery):
    """Test get_registered_tasks when no tasks are registered."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.registered.return_value = None

    tasks = get_registered_tasks(mock_celery)
    assert tasks == []


def test_update_task_queues(mock_celery):
    """Test update_task_queues."""
    mock_inspect = mock_celery.control.inspect.return_value

    mock_inspect.registered.return_value = {
        "worker1": [
            "task.name.1 {'display_name': 'Task 1'}",
            "other.task.2 {'display_name': 'Task 2'}",
        ]
    }

    update_task_queues(mock_celery)

    assert mock_celery.conf.task_routes == {
        "task.name.1": {"queue": "task"},
        "other.task.2": {"queue": "other"},
    }


def test_get_worker_stats(mock_celery):
    """Test get_worker_stats."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.stats.return_value = {"worker1": {"cpu": 10}}

    stats = get_worker_stats(mock_celery)
    assert stats == {"worker1": {"cpu": 10}}


def test_get_worker_configurations(mock_celery):
    """Test get_worker_configurations."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.conf.return_value = {"worker1": {"broker_url": "redis://"}}

    conf = get_worker_configurations(mock_celery)
    assert conf == {"worker1": {"broker_url": "redis://"}}


def test_get_worker_reports(mock_celery):
    """Test get_worker_reports."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.report.return_value = {"worker1": "ok"}

    report = get_worker_reports(mock_celery)
    assert report == {"worker1": "ok"}


def test_ping_workers(mock_celery):
    """Test ping_workers."""
    mock_celery.control.ping.return_value = [{"worker1": "pong"}]

    ping = ping_workers(mock_celery)
    assert ping == [{"worker1": "pong"}]


def test_get_active_tasks(mock_celery):
    """Test get_active_tasks."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.active.return_value = {"worker1": []}

    active = get_active_tasks(mock_celery)
    assert active == {"worker1": []}


def test_get_scheduled_tasks(mock_celery):
    """Test get_scheduled_tasks."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.scheduled.return_value = {"worker1": []}

    scheduled = get_scheduled_tasks(mock_celery)
    assert scheduled == {"worker1": []}


def test_get_reserved_tasks(mock_celery):
    """Test get_reserved_tasks."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.reserved.return_value = {"worker1": []}

    reserved = get_reserved_tasks(mock_celery)
    assert reserved == {"worker1": []}


def test_get_revoked_tasks(mock_celery):
    """Test get_revoked_tasks."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.revoked.return_value = {"worker1": []}

    revoked = get_revoked_tasks(mock_celery)
    assert revoked == {"worker1": []}


def test_get_active_queues(mock_celery):
    """Test get_active_queues."""
    mock_inspect = mock_celery.control.inspect.return_value
    mock_inspect.active_queues.return_value = {"worker1": []}

    queues = get_active_queues(mock_celery)
    assert queues == {"worker1": []}


class _FakePipeline:
    def __init__(self, lists: dict[str, object]):
        self._lists = lists
        self._ops: list[tuple] = []

    def llen(self, key: str):
        self._ops.append(("llen", key))
        return self

    def lrange(self, key: str, start: int, end: int):
        self._ops.append(("lrange", key, start, end))
        return self

    def execute(self, raise_on_error: bool = True):
        out = []
        for op in self._ops:
            val = self._lists.get(op[1], [])
            if isinstance(val, Exception):
                if raise_on_error:
                    raise val
                out.append(val)
            elif op[0] == "llen":
                out.append(len(val))
            elif op[0] == "lrange":
                _, key, start, end = op
                out.append(val[start : end + 1])
        self._ops.clear()
        return out


class _FakeRedis:
    def __init__(self, lists: dict[str, object] | None = None):
        self.lists = lists or {}
        self.kv: dict[str, str] = {}
        self.setex_calls: list[tuple] = []

    def get(self, key: str):
        return self.kv.get(key)

    def ping(self):
        return True

    def setex(self, key: str, ttl: int, value: str):
        self.kv[key] = value
        self.setex_calls.append((key, ttl, value))

    def scan_iter(self, match: str = "*", count: int = 200, _type: str | None = None):
        prefix = match.rstrip("*")
        for key in list(self.lists.keys()):
            if key.startswith(prefix):
                yield key.encode("utf-8")

    def pipeline(self, transaction: bool = False):
        return _FakePipeline(self.lists)


def _msg(task_name: str, task_id: str) -> bytes:
    return json.dumps(
        {
            "headers": {"task": task_name, "id": task_id},
            "body": "secret-input-files-and-kwargs",
        }
    ).encode("utf-8")


def test_get_cluster_status_full_aggregation_offline_internal_and_privacy(mocker):
    """Aggregates workers, multi-task queues, priority subkeys, offline backlog, and internal workers."""
    fake_redis = _FakeRedis(
        lists={
            "openrelik-worker-strings": [
                _msg(
                    "openrelik-worker-strings.tasks.strings",
                    "aaaaaaaa-1111-1111-1111-111111111111",
                ),
            ],
            f"openrelik-worker-strings{REDIS_PRIORITY_SEP}6": [
                _msg(
                    "openrelik-worker-strings.tasks.regex",
                    "bbbbbbbb-2222-2222-2222-222222222222",
                ),
            ],
            "openrelik-worker-offline": [
                _msg(
                    "openrelik-worker-offline.tasks.scan",
                    "cccccccc-3333-3333-3333-333333333333",
                ),
            ],
            "openrelik-worker-offline-empty": [],
            "openrelik:taskqueue:status:v1": [b"ignored-colon-key"],
        }
    )
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=fake_redis)
    mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {
                "celery@strings-1": {
                    "pool": {"max-concurrency": 4},
                    "total": {"openrelik-worker-strings.tasks.strings": 12},
                    "uptime": 3600,
                    "prefetch_count": 4,
                },
                "celery@hashing-1": {
                    "pool": {"max-concurrency": 2},
                    "total": {"openrelik-hashing.tasks.generate_hashes": 5},
                    "uptime": 1200,
                    "prefetch_count": 2,
                },
            },
            "active": {
                "celery@strings-1": [
                    {
                        "id": "dddddddd-4444-4444-4444-444444444444",
                        "name": "openrelik-worker-strings.tasks.strings",
                        "delivery_info": {"routing_key": "openrelik-worker-strings"},
                        "args": ["secret-arg"],
                        "kwargs": {
                            "input_files": [{"path": "/secret/evidence.dd"}],
                            "output_path": "/secret/out",
                            "workflow_id": 999,
                            "task_config": {"api_key": "topsecret"},
                        },
                    }
                ],
                "celery@hashing-1": [],
            },
            "reserved": {
                "celery@strings-1": [
                    {
                        "id": "eeeeeeee-5555-5555-5555-555555555555",
                        "name": "openrelik-worker-strings.tasks.regex",
                        "delivery_info": {"routing_key": "openrelik-worker-strings"},
                        "kwargs": {"input_files": [{"path": "/secret/reserved.bin"}]},
                    }
                ],
                "celery@hashing-1": [],
            },
            "active_queues": {
                "celery@strings-1": [{"name": "openrelik-worker-strings"}],
                "celery@hashing-1": [{"name": "openrelik-hashing"}],
            },
            "registered": {
                "celery@strings-1": [
                    "openrelik-worker-strings.tasks.strings {'display_name': 'Strings'}",
                    "openrelik-worker-strings.tasks.regex {'display_name': 'Regex Search'}",
                    "celery.chord_unlock",
                ],
                "celery@hashing-1": [
                    "openrelik-hashing.tasks.generate_hashes",
                ],
            },
        },
    )

    payload = get_cluster_status(mocker.MagicMock())
    serialized = json.dumps(payload)

    # Privacy guarantee (R4): no raw args/kwargs/paths/workflow_id/task_config leak.
    for forbidden in (
        "secret-arg",
        "evidence.dd",
        "reserved.bin",
        "/secret/out",
        "topsecret",
        "input_files",
        "task_config",
    ):
        assert forbidden not in serialized

    assert payload["summary"] == {
        "workers_online": 2,
        "workers_busy": 1,
        "workers_idle": 1,
        "slots_busy": 1,
        "slots_total": 6,
        "tasks_running": 1,
        "tasks_reserved": 1,
        "tasks_queued": 3,
        "tasks_waiting": 4,
    }

    queues_by_name = {q["name"]: q for q in payload["queues"]}
    assert set(queues_by_name.keys()) == {
        "openrelik-hashing",
        "openrelik-worker-offline",
        "openrelik-worker-strings",
    }

    # Internal worker queue tagged is_internal=True.
    assert queues_by_name["openrelik-hashing"]["is_internal"] is True
    assert queues_by_name["openrelik-hashing"]["workers_online"] == 1

    # Offline queue with backlog surfaced with workers_online=0 and is_internal=False.
    offline_q = queues_by_name["openrelik-worker-offline"]
    assert offline_q["workers_online"] == 0
    assert offline_q["is_internal"] is False
    assert offline_q["queued"] == 1
    assert offline_q["waiting"] == 1

    # Multi-task queue merges running, reserved, and priority sub-key queued counts.
    strings_q = queues_by_name["openrelik-worker-strings"]
    assert strings_q["is_internal"] is False
    assert strings_q["running"] == 1
    assert strings_q["reserved"] == 1
    assert strings_q["queued"] == 2
    assert strings_q["waiting"] == 3
    tasks_by_name = {t["task_name"]: t for t in strings_q["tasks"]}
    assert tasks_by_name["openrelik-worker-strings.tasks.strings"] == {
        "task_name": "openrelik-worker-strings.tasks.strings",
        "display_name": "Strings",
        "running": 1,
        "reserved": 0,
        "queued": 1,
        "waiting": 1,
    }
    assert tasks_by_name["openrelik-worker-strings.tasks.regex"] == {
        "task_name": "openrelik-worker-strings.tasks.regex",
        "display_name": "Regex Search",
        "running": 0,
        "reserved": 1,
        "queued": 1,
        "waiting": 2,
    }

    workers_by_name = {w["hostname"]: w for w in payload["workers"]}
    assert workers_by_name["celery@hashing-1"]["is_internal"] is True
    assert workers_by_name["celery@strings-1"]["is_internal"] is False
    assert workers_by_name["celery@strings-1"]["processed"] == 12
    assert workers_by_name["celery@strings-1"]["slots_busy"] == 1
    assert workers_by_name["celery@strings-1"]["slots_total"] == 4

    # Live task snapshot tracks active, reserved, and queued hex UUIDs.
    snap = get_live_task_snapshot(mocker.MagicMock())
    assert "dddddddd444444444444444444444444" in snap["live_task_ids"]
    assert "eeeeeeee555555555555555555555555" in snap["live_task_ids"]
    assert "aaaaaaaa111111111111111111111111" in snap["live_task_ids"]
    assert "cccccccc333333333333333333333333" in snap["live_task_ids"]
    assert "openrelik-worker-strings" in snap["online_queues"]
    assert "openrelik-worker-offline" not in snap["online_queues"]


def test_get_cluster_status_scan_limit_truncation(mocker):
    """Exact LLEN is preserved while LRANGE scanning stops at QUEUE_SCAN_LIMIT."""
    mocker.patch("lib.celery_utils.QUEUE_SCAN_LIMIT", 2)
    fake_redis = _FakeRedis(
        lists={
            "openrelik-worker-big": [
                _msg(
                    "openrelik-worker-big.tasks.work",
                    f"00000000-0000-0000-0000-00000000000{i}",
                )
                for i in range(5)
            ]
        }
    )
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=fake_redis)
    mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {},
            "active": {},
            "reserved": {},
            "active_queues": {},
            "registered": {},
        },
    )

    payload = get_cluster_status(mocker.MagicMock())
    assert len(payload["queues"]) == 1
    q = payload["queues"][0]
    assert q["queued"] == 5
    assert q["scan_truncated"] is True
    assert q["scan_limit"] == 2
    assert q["tasks"][0]["queued"] == 2
    assert (
        "openrelik-worker-big" in celery_utils._last_live_snapshot["truncated_queues"]
    )


def test_get_cluster_status_empty_workers_and_caching_and_cooldown(mocker):
    """Zero online workers returns zeroed payload; cache & 1s refresh cooldown work."""
    fake_redis = _FakeRedis()
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=fake_redis)
    mock_collect = mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {},
            "active": {},
            "reserved": {},
            "active_queues": {},
            "registered": {},
        },
    )

    fake_now = [100.0]
    mocker.patch("lib.celery_utils.time.monotonic", side_effect=lambda: fake_now[0])
    mocker.patch("lib.celery_utils.time.time", side_effect=lambda: fake_now[0])

    first = get_cluster_status(mocker.MagicMock())
    assert first["summary"]["workers_online"] == 0
    assert first["queues"] == []
    assert first["workers"] == []
    assert mock_collect.call_count == 1
    assert len(fake_redis.setex_calls) == 1

    # Within TTL and within 1s cooldown: even refresh=True returns cached payload.
    fake_now[0] = 100.5
    second = get_cluster_status(mocker.MagicMock(), refresh=True)
    assert second is first
    assert mock_collect.call_count == 1

    # Past 1s cooldown: refresh=True bypasses cache and re-collects.
    fake_now[0] = 101.2
    get_cluster_status(mocker.MagicMock(), refresh=True)
    assert mock_collect.call_count == 2

    # When in-memory cache is cleared, Redis cache is used when refresh=False.
    celery_utils._last_payload_cache = None
    from_redis = get_cluster_status(mocker.MagicMock(), refresh=False)
    assert from_redis["summary"]["workers_online"] == 0
    assert mock_collect.call_count == 2


def test_get_cluster_status_lock_timeout_and_broker_error(mocker):
    """Bounded lock returns warm cache on timeout, or raises BrokerUnavailableError when cold."""
    fake_lock = mocker.MagicMock()
    fake_lock.acquire.return_value = False
    mocker.patch("lib.celery_utils._status_lock", fake_lock)

    # Cold cache + lock timeout -> BrokerUnavailableError.
    with pytest.raises(BrokerUnavailableError):
        get_cluster_status(mocker.MagicMock())

    # Warm cache (expired TTL) + lock timeout -> returns stale cache.
    stale = {
        "collected_at": "2026-01-01T00:00:00+00:00",
        "summary": {},
        "queues": [],
        "workers": [],
    }
    celery_utils._last_payload_cache = stale
    celery_utils._last_collected_monotonic = 0.0
    assert get_cluster_status(mocker.MagicMock(), refresh=True) is stale


def test_get_cluster_status_raises_on_redis_unreachable(mocker):
    """Unreachable Redis raises BrokerUnavailableError even when inspect returns empty."""
    bad_redis = mocker.MagicMock()
    bad_redis.get.side_effect = redis.exceptions.ConnectionError("down")
    bad_redis.ping.side_effect = redis.exceptions.ConnectionError("down")
    bad_redis.scan_iter.side_effect = redis.exceptions.ConnectionError("down")
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=bad_redis)
    mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {},
            "active": {},
            "reserved": {},
            "active_queues": {},
            "registered": {},
        },
    )

    with pytest.raises(BrokerUnavailableError):
        get_cluster_status(mocker.MagicMock(), refresh=False)

    # Also raises immediately when refresh=True bypasses the cache read.
    celery_utils._last_collected_monotonic = 0.0
    with pytest.raises(BrokerUnavailableError):
        get_cluster_status(mocker.MagicMock(), refresh=True)


def test_get_cluster_status_restores_live_snapshot_on_redis_cache_hit(mocker):
    """A cold worker hitting the shared Redis cache restores live_snapshot for /workflows/active."""
    fake_redis = _FakeRedis(
        lists={
            "openrelik-worker-strings": [
                _msg(
                    "openrelik-worker-strings.tasks.strings",
                    "aaaaaaaa-1111-1111-1111-111111111111",
                )
            ]
        }
    )
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=fake_redis)
    mock_collect = mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {
                "w1": {"pool": {"max-concurrency": 2}, "total": {}, "uptime": 60}
            },
            "active": {"w1": []},
            "reserved": {"w1": []},
            "active_queues": {"w1": [{"name": "openrelik-worker-strings"}]},
            "registered": {
                "w1": [
                    "openrelik-worker-strings.tasks.strings {'display_name': 'Strings'}"
                ]
            },
        },
    )

    # Process A populates the shared Redis cache at t=1000.
    fake_wall = [1000.0]
    fake_mono = [500.0]
    mocker.patch("lib.celery_utils.time.time", side_effect=lambda: fake_wall[0])
    mocker.patch("lib.celery_utils.time.monotonic", side_effect=lambda: fake_mono[0])

    get_cluster_status(mocker.MagicMock())
    assert mock_collect.call_count == 1

    # Cold Process B receiving refresh=True within 1s cooldown still serves Redis cache.
    fake_wall[0] = 1000.2
    fake_mono[0] = 800.0
    celery_utils._last_payload_cache = None
    celery_utils._last_live_snapshot = None
    celery_utils._last_collected_monotonic = 0.0

    cached_resp = get_cluster_status(mocker.MagicMock(), refresh=True)
    assert mock_collect.call_count == 1
    assert cached_resp["summary"]["workers_online"] == 1

    # Simulate cold Process B reading the shared Redis cache 3.5s later.
    fake_wall[0] = 1003.5
    fake_mono[0] = 900.0
    celery_utils._last_payload_cache = None
    celery_utils._last_live_snapshot = None
    celery_utils._last_collected_monotonic = 0.0

    snap = get_live_task_snapshot(mocker.MagicMock())
    assert mock_collect.call_count == 1
    assert "aaaaaaaa111111111111111111111111" in snap["live_task_ids"]
    assert "openrelik-worker-strings" in snap["online_queues"]

    # Local cache age reflects the 3.5s Redis age, so manual refresh is not throttled.
    get_cluster_status(mocker.MagicMock(), refresh=True)
    assert mock_collect.call_count == 2


def test_get_cluster_status_ignores_wrongtype_redis_keys(mocker):
    """Non-list Redis keys (e.g. NBD mount locks) matching openrelik-* do not break status."""
    fake_redis = _FakeRedis(
        lists={
            "openrelik-worker-1-/dev/nbd0": redis.exceptions.ResponseError(
                "WRONGTYPE Operation against a key holding the wrong kind of value"
            ),
            "openrelik-worker-offline": [
                _msg(
                    "openrelik-worker-offline.tasks.scan",
                    "bbbbbbbb-2222-2222-2222-222222222222",
                )
            ],
        }
    )
    mocker.patch("lib.celery_utils._get_status_redis_client", return_value=fake_redis)
    mocker.patch(
        "lib.celery_utils._collect_inspect_snapshots",
        return_value={
            "stats": {},
            "active": {},
            "reserved": {},
            "active_queues": {},
            "registered": {},
        },
    )

    payload = get_cluster_status(mocker.MagicMock())
    assert [q["name"] for q in payload["queues"]] == ["openrelik-worker-offline"]
    assert payload["queues"][0]["queued"] == 1


def test_collect_inspect_snapshots_uses_isolated_celery_apps(mocker):
    """Each inspect call creates and closes an isolated Celery app preserving visibility_timeout."""
    from types import SimpleNamespace
    from openrelik_common.celery_utils import DEFAULT_VISIBILITY_TIMEOUT

    created_apps = []

    class _FakeConf(SimpleNamespace):
        def update(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    def _make_app(*, broker):
        app = mocker.MagicMock()
        app.conf = _FakeConf(broker_transport_options={})
        inspector = app.control.inspect.return_value
        inspector.stats.return_value = {"w1": {"uptime": 10}}
        inspector.active.return_value = {"w1": []}
        inspector.reserved.return_value = {"w1": []}
        inspector.active_queues.return_value = {"w1": []}
        inspector.registered.return_value = {"w1": []}
        created_apps.append(app)
        return app

    mocker.patch("lib.celery_utils.Celery", side_effect=_make_app)
    parent = mocker.MagicMock()
    parent.conf.broker_url = "redis://broker:6379/0"

    snapshots = celery_utils._collect_inspect_snapshots(parent, timeout=0.5)
    assert snapshots["stats"] == {"w1": {"uptime": 10}}
    assert len(created_apps) == 5
    for app in created_apps:
        assert app.conf.broker_pool_limit is None
        assert (
            app.conf.broker_transport_options["visibility_timeout"]
            == DEFAULT_VISIBILITY_TIMEOUT
        )
        assert "socket_timeout" in app.conf.broker_transport_options
        assert "socket_connect_timeout" in app.conf.broker_transport_options
        app.close.assert_called_once()
