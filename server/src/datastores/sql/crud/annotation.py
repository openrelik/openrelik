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
"""Database CRUD helpers for file selection annotations and replies."""

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session, selectinload

from api.v1 import schemas
from datastores.sql.models.file import FileAnnotation, FileAnnotationReply


def get_file_annotations_from_db(db: Session, file_id: int) -> List[FileAnnotation]:
    """Return all active annotations and active replies for a file.

    Args:
        db (Session): SQLAlchemy session.
        file_id (int): Target file ID.

    Returns:
        List[FileAnnotation]: Active annotations ordered by anchor and creation order.
    """
    return (
        db.query(FileAnnotation)
        .options(
            selectinload(FileAnnotation.user),
            selectinload(FileAnnotation.replies).selectinload(FileAnnotationReply.user),
        )
        .filter(
            FileAnnotation.file_id == file_id,
            FileAnnotation.is_deleted == False,  # noqa: E712
        )
        .order_by(
            FileAnnotation.anchor_kind.asc(),
            FileAnnotation.range_start.asc(),
            FileAnnotation.range_end.asc(),
            FileAnnotation.id.asc(),
        )
        .all()
    )


def get_file_annotation_from_db(
    db: Session, file_id: int, annotation_id: int
) -> Optional[FileAnnotation]:
    """Return a single active annotation belonging to a specific file.

    Args:
        db (Session): SQLAlchemy session.
        file_id (int): Expected parent file ID.
        annotation_id (int): Annotation ID.

    Returns:
        Optional[FileAnnotation]: The annotation, or None if missing/deleted/wrong file.
    """
    return (
        db.query(FileAnnotation)
        .options(
            selectinload(FileAnnotation.user),
            selectinload(FileAnnotation.replies).selectinload(FileAnnotationReply.user),
        )
        .filter(
            FileAnnotation.id == annotation_id,
            FileAnnotation.file_id == file_id,
            FileAnnotation.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def create_file_annotation_in_db(
    db: Session,
    file_id: int,
    user_id: int,
    payload: schemas.FileAnnotationCreateRequest,
) -> FileAnnotation:
    """Create and return a new FileAnnotation.

    Args:
        db (Session): SQLAlchemy session.
        file_id (int): Annotated file ID.
        user_id (int): Author user ID.
        payload (schemas.FileAnnotationCreateRequest): Validated annotation fields.

    Returns:
        FileAnnotation: Persisted annotation with author loaded.
    """
    annotation = FileAnnotation(
        file_id=file_id,
        user_id=user_id,
        anchor_kind=payload.anchor_kind,
        range_start=payload.range_start,
        range_end=payload.range_end,
        range_start_col=payload.range_start_col,
        range_end_col=payload.range_end_col,
        body=payload.body,
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return get_file_annotation_from_db(db, file_id, annotation.id) or annotation


def update_file_annotation_in_db(
    db: Session, annotation: FileAnnotation, body: str
) -> FileAnnotation:
    """Update an annotation's body and record edited_at.

    Args:
        db (Session): SQLAlchemy session.
        annotation (FileAnnotation): Existing annotation row.
        body (str): Updated comment text.

    Returns:
        FileAnnotation: Updated annotation row.
    """
    annotation.body = body
    annotation.edited_at = datetime.now(timezone.utc)
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return annotation


def delete_file_annotation_in_db(db: Session, annotation: FileAnnotation) -> None:
    """Soft-delete an annotation and its active replies.

    Args:
        db (Session): SQLAlchemy session.
        annotation (FileAnnotation): Annotation to soft-delete.
    """
    for reply in annotation.replies:
        if not reply.is_deleted:
            reply.soft_delete()
    annotation.soft_delete()
    db.commit()


def get_file_annotation_reply_from_db(
    db: Session, annotation_id: int, reply_id: int
) -> Optional[FileAnnotationReply]:
    """Return a single active reply belonging to a specific annotation.

    Args:
        db (Session): SQLAlchemy session.
        annotation_id (int): Expected parent annotation ID.
        reply_id (int): Reply ID.

    Returns:
        Optional[FileAnnotationReply]: The reply, or None if missing/deleted/wrong thread.
    """
    return (
        db.query(FileAnnotationReply)
        .options(selectinload(FileAnnotationReply.user))
        .filter(
            FileAnnotationReply.id == reply_id,
            FileAnnotationReply.annotation_id == annotation_id,
            FileAnnotationReply.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def create_file_annotation_reply_in_db(
    db: Session, annotation_id: int, user_id: int, body: str
) -> FileAnnotationReply:
    """Create and return a reply on a FileAnnotation.

    Args:
        db (Session): SQLAlchemy session.
        annotation_id (int): Parent annotation ID.
        user_id (int): Author user ID.
        body (str): Validated reply body.

    Returns:
        FileAnnotationReply: Persisted reply with author loaded.
    """
    reply = FileAnnotationReply(
        annotation_id=annotation_id,
        user_id=user_id,
        body=body,
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return get_file_annotation_reply_from_db(db, annotation_id, reply.id) or reply


def update_file_annotation_reply_in_db(
    db: Session, reply: FileAnnotationReply, body: str
) -> FileAnnotationReply:
    """Update a reply's body and record edited_at.

    Args:
        db (Session): SQLAlchemy session.
        reply (FileAnnotationReply): Existing reply row.
        body (str): Updated reply text.

    Returns:
        FileAnnotationReply: Updated reply row.
    """
    reply.body = body
    reply.edited_at = datetime.now(timezone.utc)
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def delete_file_annotation_reply_in_db(db: Session, reply: FileAnnotationReply) -> None:
    """Soft-delete a single annotation reply.

    Args:
        db (Session): SQLAlchemy session.
        reply (FileAnnotationReply): Reply to soft-delete.
    """
    reply.soft_delete()
    db.commit()
