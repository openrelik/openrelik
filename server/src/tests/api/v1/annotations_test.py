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
"""Unit tests for file selection annotations endpoints."""

from datetime import datetime, timezone

import pytest

from datastores.sql.models.file import FileAnnotation, FileAnnotationReply


def _make_annotation(
    user_db_model,
    *,
    annotation_id: int = 10,
    file_id: int = 1,
    user_id: int = 100,
    anchor_kind: str = "line",
    range_start: int = 12,
    range_end: int = 14,
    range_start_col: int | None = None,
    range_end_col: int | None = None,
    body: str = "Suspicious command line",
    replies: list | None = None,
) -> FileAnnotation:
    now = datetime(2026, 11, 25, 19, 0, tzinfo=timezone.utc)
    return FileAnnotation(
        id=annotation_id,
        file_id=file_id,
        user_id=user_id,
        user=user_db_model,
        anchor_kind=anchor_kind,
        range_start=range_start,
        range_end=range_end,
        range_start_col=range_start_col,
        range_end_col=range_end_col,
        body=body,
        created_at=now,
        updated_at=now,
        is_deleted=False,
        replies=replies or [],
    )


def _make_reply(
    user_db_model,
    *,
    reply_id: int = 20,
    annotation_id: int = 10,
    user_id: int = 100,
    body: str = "Confirmed persistence mechanism",
) -> FileAnnotationReply:
    now = datetime(2026, 11, 25, 19, 5, tzinfo=timezone.utc)
    return FileAnnotationReply(
        id=reply_id,
        annotation_id=annotation_id,
        user_id=user_id,
        user=user_db_model,
        body=body,
        created_at=now,
        updated_at=now,
        is_deleted=False,
    )


def test_list_annotations(fastapi_test_client, mocker, user_db_model):
    reply = _make_reply(user_db_model)
    annotation = _make_annotation(user_db_model, replies=[reply])
    mocker.patch(
        "api.v1.annotations.get_file_annotations_from_db", return_value=[annotation]
    )

    response = fastapi_test_client.get("/files/1/annotations")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == 10
    assert data[0]["anchor_kind"] == "line"
    assert data[0]["range_start"] == 12
    assert data[0]["range_end"] == 14
    assert len(data[0]["replies"]) == 1
    assert data[0]["replies"][0]["body"] == "Confirmed persistence mechanism"


def test_create_annotation_valid_text_span(fastapi_test_client, mocker, user_db_model):
    created = _make_annotation(
        user_db_model, range_start=12, range_end=12, range_start_col=5, range_end_col=18
    )
    mock_create = mocker.patch(
        "api.v1.annotations.create_file_annotation_in_db", return_value=created
    )

    response = fastapi_test_client.post(
        "/files/1/annotations",
        json={
            "anchor_kind": "line",
            "range_start": 12,
            "range_end": 12,
            "range_start_col": 5,
            "range_end_col": 18,
            "body": "  Suspicious command line  ",
        },
    )

    assert response.status_code == 201
    assert response.json()["range_start_col"] == 5
    mock_create.assert_called_once()
    assert mock_create.call_args.args[3].body == "Suspicious command line"


@pytest.mark.parametrize(
    "payload",
    [
        {"anchor_kind": "unknown", "range_start": 1, "range_end": 1, "body": "x"},
        {"anchor_kind": "line", "range_start": 0, "range_end": 1, "body": "x"},
        {"anchor_kind": "line", "range_start": 5, "range_end": 3, "body": "x"},
        {
            "anchor_kind": "line",
            "range_start": 5,
            "range_end": 5,
            "range_start_col": 2,
            "body": "x",
        },
        {
            "anchor_kind": "row",
            "range_start": 1,
            "range_end": 2,
            "range_start_col": 1,
            "range_end_col": 4,
            "body": "x",
        },
        {
            "anchor_kind": "line",
            "range_start": 5,
            "range_end": 5,
            "range_start_col": 4,
            "range_end_col": 4,
            "body": "x",
        },
        {"anchor_kind": "offset", "range_start": -1, "range_end": 2, "body": "x"},
        {"anchor_kind": "line", "range_start": 1, "range_end": 1, "body": "   "},
    ],
)
def test_create_annotation_validation_errors(fastapi_test_client, payload):
    response = fastapi_test_client.post("/files/1/annotations", json=payload)
    assert response.status_code == 422


def test_create_offset_annotation_out_of_bounds(
    fastapi_test_client, mocker, file_db_model
):
    file_db_model.filesize = 16
    mocker.patch("api.v1.annotations.get_file_from_db", return_value=file_db_model)

    response = fastapi_test_client.post(
        "/files/1/annotations",
        json={
            "anchor_kind": "offset",
            "range_start": 0,
            "range_end": 16,
            "body": "Past EOF",
        },
    )
    assert response.status_code == 400


def test_update_annotation_author_only(fastapi_test_client, mocker, user_db_model):
    other_users_annotation = _make_annotation(user_db_model, user_id=999)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db",
        return_value=other_users_annotation,
    )

    response = fastapi_test_client.patch(
        "/files/1/annotations/10", json={"body": "Attempted overwrite"}
    )
    assert response.status_code == 403


def test_update_annotation_success(fastapi_test_client, mocker, user_db_model):
    own_annotation = _make_annotation(user_db_model, user_id=100)
    updated = _make_annotation(user_db_model, user_id=100, body="Edited note")
    updated.edited_at = datetime(2026, 11, 25, 19, 10, tzinfo=timezone.utc)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db", return_value=own_annotation
    )
    mocker.patch(
        "api.v1.annotations.update_file_annotation_in_db", return_value=updated
    )

    response = fastapi_test_client.patch(
        "/files/1/annotations/10", json={"body": "Edited note"}
    )
    assert response.status_code == 200
    assert response.json()["body"] == "Edited note"
    assert response.json()["edited_at"] is not None


def test_delete_annotation_non_author_non_admin_forbidden(
    fastapi_test_client, mocker, user_db_model
):
    other_users_annotation = _make_annotation(user_db_model, user_id=999)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db",
        return_value=other_users_annotation,
    )

    response = fastapi_test_client.delete("/files/1/annotations/10")
    assert response.status_code == 403


def test_delete_annotation_admin_allowed(
    fastapi_test_client, mocker, user_db_model, user_response
):
    user_response.is_admin = True
    other_users_annotation = _make_annotation(user_db_model, user_id=999)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db",
        return_value=other_users_annotation,
    )
    mock_delete = mocker.patch("api.v1.annotations.delete_file_annotation_in_db")

    response = fastapi_test_client.delete("/files/1/annotations/10")
    assert response.status_code == 204
    mock_delete.assert_called_once_with(mocker.ANY, other_users_annotation)


def test_reply_crud_and_idor(fastapi_test_client, mocker, user_db_model):
    annotation = _make_annotation(user_db_model, user_id=100)
    reply = _make_reply(user_db_model, user_id=100)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db", return_value=annotation
    )
    mocker.patch(
        "api.v1.annotations.create_file_annotation_reply_in_db", return_value=reply
    )

    create_resp = fastapi_test_client.post(
        "/files/1/annotations/10/replies",
        json={"body": "Confirmed persistence mechanism"},
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["id"] == 20

    # Wrong file_id -> get_file_annotation_from_db returns None -> 404
    mocker.patch("api.v1.annotations.get_file_annotation_from_db", return_value=None)
    missing_resp = fastapi_test_client.post(
        "/files/2/annotations/10/replies", json={"body": "Cross-file IDOR attempt"}
    )
    assert missing_resp.status_code == 404


def test_update_and_delete_reply_permissions(
    fastapi_test_client, mocker, user_db_model, user_response
):
    """Reply PATCH is author-only (even admins get 403); DELETE allows author or admin."""
    annotation = _make_annotation(
        user_db_model, annotation_id=10, file_id=1, user_id=100
    )
    own_reply = _make_reply(user_db_model, reply_id=20, annotation_id=10, user_id=100)
    updated_reply = _make_reply(
        user_db_model,
        reply_id=20,
        annotation_id=10,
        user_id=100,
        body="Edited reply",
    )
    updated_reply.edited_at = datetime(2026, 11, 25, 19, 10, tzinfo=timezone.utc)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db", return_value=annotation
    )
    mocker.patch(
        "api.v1.annotations.get_file_annotation_reply_from_db", return_value=own_reply
    )
    mocker.patch(
        "api.v1.annotations.update_file_annotation_reply_in_db",
        return_value=updated_reply,
    )
    delete_reply_mock = mocker.patch(
        "api.v1.annotations.delete_file_annotation_reply_in_db"
    )

    # Author edits own reply -> 200
    resp_ok = fastapi_test_client.patch(
        "/files/1/annotations/10/replies/20", json={"body": "Edited reply"}
    )
    assert resp_ok.status_code == 200
    assert resp_ok.json()["body"] == "Edited reply"

    # Non-author cannot edit or delete -> 403
    other_annotation = _make_annotation(
        user_db_model, annotation_id=10, file_id=1, user_id=999
    )
    other_reply = _make_reply(user_db_model, reply_id=20, annotation_id=10, user_id=999)
    mocker.patch(
        "api.v1.annotations.get_file_annotation_from_db", return_value=other_annotation
    )
    mocker.patch(
        "api.v1.annotations.get_file_annotation_reply_from_db", return_value=other_reply
    )
    user_response.is_admin = False
    assert (
        fastapi_test_client.patch(
            "/files/1/annotations/10/replies/20", json={"body": "Hijack"}
        ).status_code
        == 403
    )
    assert (
        fastapi_test_client.delete("/files/1/annotations/10/replies/20").status_code
        == 403
    )

    # Admin cannot edit another user's annotation or reply -> 403, but can delete reply -> 204
    user_response.is_admin = True
    assert (
        fastapi_test_client.patch(
            "/files/1/annotations/10", json={"body": "Admin edit"}
        ).status_code
        == 403
    )
    assert (
        fastapi_test_client.patch(
            "/files/1/annotations/10/replies/20", json={"body": "Admin edit"}
        ).status_code
        == 403
    )
    assert (
        fastapi_test_client.delete("/files/1/annotations/10/replies/20").status_code
        == 204
    )
    delete_reply_mock.assert_called_once_with(mocker.ANY, other_reply)

    # Missing reply -> 404
    mocker.patch(
        "api.v1.annotations.get_file_annotation_reply_from_db", return_value=None
    )
    assert (
        fastapi_test_client.patch(
            "/files/1/annotations/10/replies/999", json={"body": "Missing"}
        ).status_code
        == 404
    )
    assert (
        fastapi_test_client.delete("/files/1/annotations/10/replies/999").status_code
        == 404
    )


def test_create_annotation_rejects_empty_file_offset_and_oversized_body(
    fastapi_test_client, mocker
):
    """Offset annotations on 0-byte files return 400; bodies > 10,000 chars return 422."""
    mocker.patch(
        "api.v1.annotations.get_file_from_db",
        return_value=mocker.MagicMock(id=1, filesize=0),
    )
    zero_resp = fastapi_test_client.post(
        "/files/1/annotations",
        json={
            "anchor_kind": "offset",
            "range_start": 0,
            "range_end": 0,
            "body": "Byte on empty file",
        },
    )
    assert zero_resp.status_code == 400

    oversized_resp = fastapi_test_client.post(
        "/files/1/annotations",
        json={
            "anchor_kind": "line",
            "range_start": 1,
            "range_end": 1,
            "body": "x" * 10001,
        },
    )
    assert oversized_resp.status_code == 422
