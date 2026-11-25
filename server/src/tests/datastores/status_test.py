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

"""Tests for aggregate storage status and candidate active workflow queries."""

from collections import namedtuple
import json
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from datastores.sql.crud import status as status_crud
from datastores.sql.crud.status import get_system_storage_status_from_db
from datastores.sql.crud.workflow import get_candidate_active_workflows_from_db
from datastores.sql.database import BaseModel
from datastores.sql.models.file import File
from datastores.sql.models.folder import Folder
from datastores.sql.models.user import User
from datastores.sql.models.workflow import Task, Workflow

_DiskUsage = namedtuple("usage", ["total", "used", "free"])


@pytest.fixture(autouse=True)
def reset_storage_cache():
    status_crud._last_collected_monotonic = 0.0
    status_crud._redis_client = None
    yield
    status_crud._last_collected_monotonic = 0.0
    status_crud._redis_client = None


@pytest.fixture
def sqlite_db():
    """In-memory SQLite session with all OpenRelik tables created."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    BaseModel.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _seed_user(db) -> User:
    user = User(
        display_name="Analyst",
        username="analyst",
        email="analyst@example.com",
        uuid=uuid.uuid4(),
        auth_method="local",
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def test_get_system_storage_status_aggregates_files_folders_workflows_and_providers(
    sqlite_db, mocker, tmp_path
):
    """Aggregates active, unpurged trash, and purged files; never leaks host paths."""
    user = _seed_user(sqlite_db)
    root_folder = Folder(
        display_name="Root 1",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=None,
        is_deleted=False,
    )
    sqlite_db.add(root_folder)
    sqlite_db.flush()

    sub_folder = Folder(
        display_name="Sub 1",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=root_folder.id,
        is_deleted=False,
    )
    deleted_folder = Folder(
        display_name="Deleted Folder",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=None,
        is_deleted=True,
    )
    sqlite_db.add_all([sub_folder, deleted_folder])
    sqlite_db.flush()

    # Files: 2 active on default (one with NULL storage_provider), 1 active on archive,
    # 1 soft-deleted unpurged (Trash), 1 soft-deleted purged (excluded from both).
    sqlite_db.add_all(
        [
            File(
                display_name="f1.bin",
                filename="f1.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=1000,
                storage_provider=None,
                is_deleted=False,
                is_purged=False,
                user_id=user.id,
                folder_id=root_folder.id,
            ),
            File(
                display_name="f2.bin",
                filename="f2.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=500,
                storage_provider="fast_nvme",
                is_deleted=False,
                is_purged=False,
                user_id=user.id,
                folder_id=sub_folder.id,
            ),
            File(
                display_name="f3.bin",
                filename="f3.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=4000,
                storage_provider="archive",
                is_deleted=False,
                is_purged=False,
                user_id=user.id,
                folder_id=root_folder.id,
            ),
            File(
                display_name="trash.bin",
                filename="trash.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=700,
                storage_provider="fast_nvme",
                is_deleted=True,
                is_purged=False,
                user_id=user.id,
                folder_id=root_folder.id,
            ),
            File(
                display_name="purged.bin",
                filename="purged.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=9999,
                storage_provider="fast_nvme",
                is_deleted=True,
                is_purged=True,
                user_id=user.id,
                folder_id=root_folder.id,
            ),
        ]
    )

    sqlite_db.add_all(
        [
            Workflow(
                display_name="WF Active",
                uuid=uuid.uuid4(),
                user_id=user.id,
                folder_id=root_folder.id,
                is_deleted=False,
            ),
            Workflow(
                display_name="WF Deleted",
                uuid=uuid.uuid4(),
                user_id=user.id,
                folder_id=root_folder.id,
                is_deleted=True,
            ),
        ]
    )
    sqlite_db.commit()

    nvme_dir = tmp_path / "nvme_secret_mount"
    nvme_dir.mkdir()
    missing_dir = tmp_path / "missing_archive_mount"

    mocker.patch(
        "datastores.sql.crud.status.get_config",
        return_value={
            "server": {
                "storage": {
                    "providers": {
                        "default": "fast_nvme",
                        "fast_nvme": {
                            "display_name": "Fast NVMe",
                            "mode": "rw",
                            "path": str(nvme_dir),
                        },
                        "archive": {
                            "display_name": "Cold Archive",
                            "mode": "ro",
                            "path": str(missing_dir),
                        },
                    }
                }
            }
        },
    )
    mocker.patch("datastores.sql.crud.status._get_redis_client", return_value=None)
    mocker.patch(
        "datastores.sql.crud.status.shutil.disk_usage",
        return_value=_DiskUsage(total=1000, used=850, free=150),
    )

    payload = get_system_storage_status_from_db(sqlite_db)
    serialized = json.dumps(payload)

    # Raw filesystem paths must never appear in API payload.
    assert "nvme_secret_mount" not in serialized
    assert "missing_archive_mount" not in serialized

    assert payload["files_count"] == 3
    assert payload["files_total_bytes"] == 5500
    assert payload["deleted_unpurged_files_count"] == 1
    assert payload["deleted_unpurged_bytes"] == 700
    assert payload["folders_count"] == 2
    assert payload["root_folders_count"] == 1
    assert payload["workflows_count"] == 1

    providers = {p["name"]: p for p in payload["storage_providers"]}
    assert providers["fast_nvme"] == {
        "name": "fast_nvme",
        "display_name": "Fast NVMe",
        "mode": "rw",
        "is_default": True,
        "available": True,
        "total_bytes": 1000,
        "used_bytes": 850,
        "free_bytes": 150,
        "used_percent": 85.0,
        "file_count": 2,
        "file_bytes": 1500,
    }
    assert providers["archive"] == {
        "name": "archive",
        "display_name": "Cold Archive",
        "mode": "ro",
        "is_default": False,
        "available": False,
        "total_bytes": None,
        "used_bytes": None,
        "free_bytes": None,
        "used_percent": None,
        "file_count": 1,
        "file_bytes": 4000,
    }


def test_get_system_storage_status_redis_cache_and_cooldown(
    sqlite_db, mocker, tmp_path
):
    """Caches payload in Redis for 60s and honors 5s refresh cooldown."""
    fake_kv: dict[str, str] = {}
    fake_redis = mocker.MagicMock()
    fake_redis.get.side_effect = lambda k: fake_kv.get(k)
    fake_redis.setex.side_effect = lambda k, ttl, v: fake_kv.__setitem__(k, v)

    mocker.patch(
        "datastores.sql.crud.status._get_redis_client", return_value=fake_redis
    )
    mocker.patch(
        "datastores.sql.crud.status.get_config",
        return_value={"server": {"storage_path": str(tmp_path)}},
    )

    fake_now = [200.0]
    mocker.patch(
        "datastores.sql.crud.status.time.monotonic", side_effect=lambda: fake_now[0]
    )

    first = get_system_storage_status_from_db(sqlite_db)
    assert fake_redis.setex.call_count == 1
    assert fake_redis.setex.call_args.args[1] == 60

    # Within 5s cooldown: refresh=True still serves cached value.
    fake_now[0] = 202.0
    second = get_system_storage_status_from_db(sqlite_db, refresh=True)
    assert second == first
    assert fake_redis.setex.call_count == 1

    # Past 5s cooldown: refresh=True recomputes and writes cache again.
    fake_now[0] = 206.0
    get_system_storage_status_from_db(sqlite_db, refresh=True)
    assert fake_redis.setex.call_count == 2


def test_get_candidate_active_workflows_and_partial_index(sqlite_db):
    """Filters terminal workflows and soft-deleted workflows/folders; declares partial index."""
    index_names = {idx.name for idx in Task.__table__.indexes}
    assert "ix_task_workflow_id_non_terminal" in index_names

    user = _seed_user(sqlite_db)
    live_folder = Folder(
        display_name="Live", uuid=uuid.uuid4(), user_id=user.id, is_deleted=False
    )
    del_folder = Folder(
        display_name="Del", uuid=uuid.uuid4(), user_id=user.id, is_deleted=True
    )
    sqlite_db.add_all([live_folder, del_folder])
    sqlite_db.flush()

    wf_active = Workflow(
        display_name="Active",
        uuid=uuid.uuid4(),
        user_id=user.id,
        folder_id=live_folder.id,
        is_deleted=False,
    )
    wf_done = Workflow(
        display_name="Done",
        uuid=uuid.uuid4(),
        user_id=user.id,
        folder_id=live_folder.id,
        is_deleted=False,
    )
    wf_del = Workflow(
        display_name="Deleted WF",
        uuid=uuid.uuid4(),
        user_id=user.id,
        folder_id=live_folder.id,
        is_deleted=True,
    )
    wf_in_del_folder = Workflow(
        display_name="In Deleted Folder",
        uuid=uuid.uuid4(),
        user_id=user.id,
        folder_id=del_folder.id,
        is_deleted=False,
    )
    sqlite_db.add_all([wf_active, wf_done, wf_del, wf_in_del_folder])
    sqlite_db.flush()

    sqlite_db.add_all(
        [
            Task(
                display_name="t1",
                uuid=uuid.uuid4(),
                status_short="STARTED",
                user_id=user.id,
                workflow_id=wf_active.id,
            ),
            Task(
                display_name="t2",
                uuid=uuid.uuid4(),
                status_short="SUCCESS",
                user_id=user.id,
                workflow_id=wf_done.id,
            ),
            Task(
                display_name="t3",
                uuid=uuid.uuid4(),
                status_short="PENDING",
                user_id=user.id,
                workflow_id=wf_del.id,
            ),
            Task(
                display_name="t4",
                uuid=uuid.uuid4(),
                status_short="PENDING",
                user_id=user.id,
                workflow_id=wf_in_del_folder.id,
            ),
        ]
    )
    sqlite_db.commit()

    candidates = get_candidate_active_workflows_from_db(sqlite_db)
    assert [w.id for w in candidates] == [wf_active.id]


def test_get_system_storage_status_inherits_folder_storage_provider(
    sqlite_db, mocker, tmp_path
):
    """Files with NULL storage_provider inherit their folder ancestor's storage provider."""
    user = _seed_user(sqlite_db)
    legacy_root = Folder(
        display_name="Legacy Root",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=None,
        storage_provider=None,
        is_deleted=False,
    )
    extra_root = Folder(
        display_name="Extra Root",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=None,
        storage_provider="extra_storage",
        is_deleted=False,
    )
    sqlite_db.add_all([legacy_root, extra_root])
    sqlite_db.flush()

    extra_sub = Folder(
        display_name="Extra Subfolder",
        uuid=uuid.uuid4(),
        user_id=user.id,
        parent_id=extra_root.id,
        storage_provider=None,
        is_deleted=False,
    )
    sqlite_db.add(extra_sub)
    sqlite_db.flush()

    sqlite_db.add_all(
        [
            # Legacy file with NULL provider under NULL root -> server_default even though default=extra_storage.
            File(
                display_name="legacy.bin",
                filename="legacy.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=1000,
                storage_provider=None,
                is_deleted=False,
                is_purged=False,
                user_id=user.id,
                folder_id=legacy_root.id,
            ),
            # Uploaded file with NULL provider inside nested subfolder of extra_storage root -> extra_storage.
            File(
                display_name="nested.bin",
                filename="nested.bin",
                extension="bin",
                uuid=uuid.uuid4(),
                data_type="file:generic",
                filesize=2500,
                storage_provider=None,
                is_deleted=False,
                is_purged=False,
                user_id=user.id,
                folder_id=extra_sub.id,
            ),
        ]
    )
    sqlite_db.commit()

    d1 = tmp_path / "default_vol"
    d2 = tmp_path / "extra_vol"
    d1.mkdir()
    d2.mkdir()
    mocker.patch(
        "datastores.sql.crud.status.get_config",
        return_value={
            "server": {
                "storage": {
                    "providers": {
                        "default": "extra_storage",
                        "server_default": {
                            "display_name": "Default Storage",
                            "mode": "rw",
                            "path": str(d1),
                        },
                        "extra_storage": {
                            "display_name": "Extra Storage",
                            "mode": "rw",
                            "path": str(d2),
                        },
                    }
                }
            }
        },
    )
    mocker.patch("datastores.sql.crud.status._get_redis_client", return_value=None)

    payload = get_system_storage_status_from_db(sqlite_db)
    providers = {p["name"]: p for p in payload["storage_providers"]}
    assert providers["server_default"]["file_count"] == 1
    assert providers["server_default"]["file_bytes"] == 1000
    assert providers["extra_storage"]["file_count"] == 1
    assert providers["extra_storage"]["file_bytes"] == 2500
