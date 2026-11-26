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

"""Datastore tests for FileAnnotation and FileAnnotationReply models and CRUD."""

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.v1 import schemas
from datastores.sql.crud.annotation import (
    create_file_annotation_in_db,
    create_file_annotation_reply_in_db,
    delete_file_annotation_in_db,
    delete_file_annotation_reply_in_db,
    get_file_annotation_from_db,
    get_file_annotation_reply_from_db,
    get_file_annotations_from_db,
    update_file_annotation_in_db,
    update_file_annotation_reply_in_db,
)
from datastores.sql.database import BaseModel
from datastores.sql.models.file import File, FileAnnotation, FileAnnotationReply
from datastores.sql.models.folder import Folder
from datastores.sql.models.user import User


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


def _seed_files(db):
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

    folder = Folder(
        display_name="Case",
        uuid=uuid.uuid4(),
        user_id=user.id,
        is_deleted=False,
    )
    db.add(folder)
    db.flush()

    file_a = File(
        display_name="a.log",
        filename="a.log",
        extension="log",
        uuid=uuid.uuid4(),
        data_type="file:generic",
        filesize=1024,
        user_id=user.id,
        folder_id=folder.id,
        is_deleted=False,
    )
    file_b = File(
        display_name="b.log",
        filename="b.log",
        extension="log",
        uuid=uuid.uuid4(),
        data_type="file:generic",
        filesize=1024,
        user_id=user.id,
        folder_id=folder.id,
        is_deleted=False,
    )
    db.add_all([file_a, file_b])
    db.commit()
    return user, file_a, file_b


def test_annotation_and_reply_crud_lifecycle_and_idor(sqlite_db):
    """Covers create, ordering, edit timestamps, IDOR isolation, and soft-delete cascade."""
    user, file_a, file_b = _seed_files(sqlite_db)

    a2 = create_file_annotation_in_db(
        sqlite_db,
        file_a.id,
        user.id,
        schemas.FileAnnotationCreateRequest(
            anchor_kind="line", range_start=20, range_end=25, body="Later line"
        ),
    )
    a1 = create_file_annotation_in_db(
        sqlite_db,
        file_a.id,
        user.id,
        schemas.FileAnnotationCreateRequest(
            anchor_kind="line",
            range_start=5,
            range_end=5,
            range_start_col=2,
            range_end_col=10,
            body="Earlier line",
        ),
    )
    a_offset = create_file_annotation_in_db(
        sqlite_db,
        file_a.id,
        user.id,
        schemas.FileAnnotationCreateRequest(
            anchor_kind="offset", range_start=0, range_end=15, body="Header bytes"
        ),
    )

    listed = get_file_annotations_from_db(sqlite_db, file_a.id)
    assert [a.id for a in listed] == [a1.id, a2.id, a_offset.id]

    # Cross-file IDOR lookup returns None
    assert get_file_annotation_from_db(sqlite_db, file_b.id, a1.id) is None
    assert get_file_annotation_from_db(sqlite_db, file_a.id, a1.id).id == a1.id

    # Edit sets edited_at
    assert a1.edited_at is None
    updated = update_file_annotation_in_db(sqlite_db, a1, "Updated body")
    assert updated.body == "Updated body"
    assert updated.edited_at is not None

    # Replies: creation, ordering, edit, wrong-annotation IDOR, and single soft-delete
    r1 = create_file_annotation_reply_in_db(sqlite_db, a1.id, user.id, "First reply")
    r2 = create_file_annotation_reply_in_db(sqlite_db, a1.id, user.id, "Second reply")
    assert get_file_annotation_reply_from_db(sqlite_db, a2.id, r1.id) is None
    assert get_file_annotation_reply_from_db(sqlite_db, a1.id, r1.id).id == r1.id

    r1_updated = update_file_annotation_reply_in_db(sqlite_db, r1, "First reply edited")
    assert r1_updated.body == "First reply edited"
    assert r1_updated.edited_at is not None

    delete_file_annotation_reply_in_db(sqlite_db, r1_updated)
    assert get_file_annotation_reply_from_db(sqlite_db, a1.id, r1.id) is None

    sqlite_db.expire_all()
    reloaded = get_file_annotation_from_db(sqlite_db, file_a.id, a1.id)
    assert [r.id for r in reloaded.replies] == [r2.id]

    # Soft-deleting root annotation cascades to remaining active replies
    delete_file_annotation_in_db(sqlite_db, reloaded)
    assert get_file_annotation_from_db(sqlite_db, file_a.id, a1.id) is None
    assert get_file_annotation_reply_from_db(sqlite_db, a1.id, r2.id) is None
    raw_reply = sqlite_db.get(FileAnnotationReply, r2.id)
    assert raw_reply is not None and raw_reply.is_deleted is True

    remaining = get_file_annotations_from_db(sqlite_db, file_a.id)
    assert [a.id for a in remaining] == [a2.id, a_offset.id]


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(anchor_kind="bogus", range_start=1, range_end=1),
        dict(anchor_kind="line", range_start=10, range_end=5),
        dict(anchor_kind="line", range_start=0, range_end=1),
        dict(anchor_kind="row", range_start=0, range_end=1),
        dict(anchor_kind="offset", range_start=-1, range_end=5),
        dict(
            anchor_kind="line",
            range_start=1,
            range_end=1,
            range_start_col=2,
            range_end_col=None,
        ),
        dict(
            anchor_kind="row",
            range_start=1,
            range_end=1,
            range_start_col=1,
            range_end_col=4,
        ),
        dict(
            anchor_kind="line",
            range_start=1,
            range_end=1,
            range_start_col=0,
            range_end_col=4,
        ),
    ],
)
def test_file_annotation_db_check_constraints(sqlite_db, kwargs):
    """Database check constraints reject invalid anchor kinds, bounds, and columns."""
    user, file_a, _ = _seed_files(sqlite_db)
    sqlite_db.add(
        FileAnnotation(
            file_id=file_a.id,
            user_id=user.id,
            body="Invalid row",
            **kwargs,
        )
    )
    with pytest.raises(IntegrityError):
        sqlite_db.commit()
    sqlite_db.rollback()
