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
"""FastAPI endpoints for file selection annotations and threaded replies."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from openrelik_common import telemetry
from sqlalchemy.orm import Session

from auth.common import get_current_active_user
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
from datastores.sql.crud.authz import require_access
from datastores.sql.crud.file import get_file_from_db
from datastores.sql.database import get_db_connection
from datastores.sql.models.role import Role

from . import schemas

router = APIRouter()

READER_ROLES = [Role.VIEWER, Role.EDITOR, Role.OWNER]


@router.get("/{file_id}/annotations")
@require_access(allowed_roles=READER_ROLES)
def list_file_annotations(
    file_id: int,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> List[schemas.FileAnnotationResponse]:
    """List all active selection annotations and replies for a file."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    return get_file_annotations_from_db(db, file_id)


@router.post("/{file_id}/annotations", status_code=status.HTTP_201_CREATED)
@require_access(allowed_roles=READER_ROLES)
def create_file_annotation(
    file_id: int,
    request_body: schemas.FileAnnotationCreateRequest,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> schemas.FileAnnotationResponse:
    """Create a comment annotation anchored to a selection in a file."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    if request_body.anchor_kind == "offset":
        file_record = get_file_from_db(db, file_id)
        if file_record and file_record.filesize is not None:
            if (
                file_record.filesize == 0
                or request_body.range_end >= file_record.filesize
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Offset range exceeds file size.",
                )
    return create_file_annotation_in_db(db, file_id, current_user.id, request_body)


@router.patch("/{file_id}/annotations/{annotation_id}")
@require_access(allowed_roles=READER_ROLES)
def update_file_annotation(
    file_id: int,
    annotation_id: int,
    request_body: schemas.FileAnnotationUpdateRequest,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> schemas.FileAnnotationResponse:
    """Update an annotation's comment body (author only)."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    telemetry.add_attribute_to_current_span("annotation_id", annotation_id)
    annotation = get_file_annotation_from_db(db, file_id, annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found."
        )
    if annotation.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can edit this annotation.",
        )
    return update_file_annotation_in_db(db, annotation, request_body.body)


@router.delete(
    "/{file_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@require_access(allowed_roles=READER_ROLES)
def delete_file_annotation(
    file_id: int,
    annotation_id: int,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> None:
    """Soft-delete an annotation and its replies (author or admin only)."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    telemetry.add_attribute_to_current_span("annotation_id", annotation_id)
    annotation = get_file_annotation_from_db(db, file_id, annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found."
        )
    if annotation.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or an admin can delete this annotation.",
        )
    delete_file_annotation_in_db(db, annotation)


@router.post(
    "/{file_id}/annotations/{annotation_id}/replies",
    status_code=status.HTTP_201_CREATED,
)
@require_access(allowed_roles=READER_ROLES)
def create_file_annotation_reply(
    file_id: int,
    annotation_id: int,
    request_body: schemas.FileAnnotationReplyCreateRequest,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> schemas.FileAnnotationReplyResponse:
    """Add a threaded reply to an existing file annotation."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    telemetry.add_attribute_to_current_span("annotation_id", annotation_id)
    annotation = get_file_annotation_from_db(db, file_id, annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found."
        )
    return create_file_annotation_reply_in_db(
        db, annotation.id, current_user.id, request_body.body
    )


@router.patch("/{file_id}/annotations/{annotation_id}/replies/{reply_id}")
@require_access(allowed_roles=READER_ROLES)
def update_file_annotation_reply(
    file_id: int,
    annotation_id: int,
    reply_id: int,
    request_body: schemas.FileAnnotationReplyUpdateRequest,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> schemas.FileAnnotationReplyResponse:
    """Update a reply's comment body (author only)."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    telemetry.add_attribute_to_current_span("annotation_id", annotation_id)
    telemetry.add_attribute_to_current_span("reply_id", reply_id)
    annotation = get_file_annotation_from_db(db, file_id, annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found."
        )
    reply = get_file_annotation_reply_from_db(db, annotation.id, reply_id)
    if not reply:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Reply not found."
        )
    if reply.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can edit this reply.",
        )
    return update_file_annotation_reply_in_db(db, reply, request_body.body)


@router.delete(
    "/{file_id}/annotations/{annotation_id}/replies/{reply_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@require_access(allowed_roles=READER_ROLES)
def delete_file_annotation_reply(
    file_id: int,
    annotation_id: int,
    reply_id: int,
    db: Session = Depends(get_db_connection),
    current_user: schemas.User = Depends(get_current_active_user),
) -> None:
    """Soft-delete a reply (author or admin only)."""
    telemetry.add_attribute_to_current_span("file_id", file_id)
    telemetry.add_attribute_to_current_span("annotation_id", annotation_id)
    telemetry.add_attribute_to_current_span("reply_id", reply_id)
    annotation = get_file_annotation_from_db(db, file_id, annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found."
        )
    reply = get_file_annotation_reply_from_db(db, annotation.id, reply_id)
    if not reply:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Reply not found."
        )
    if reply.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or an admin can delete this reply.",
        )
    delete_file_annotation_reply_in_db(db, reply)
