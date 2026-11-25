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

"""Concurrency and handler-signature regression tests for FastAPI routes."""

import asyncio
import inspect
import threading

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from api.v1 import files as files_v1
from api.v1 import folders as folders_v1
from api.v1 import users as users_v1
from api.v1 import workflows as workflows_v1
from auth import common as common_auth
from auth import google as google_auth
from auth import local as local_auth
from config import config
from datastores.sql.database import get_db_connection
from healthz import router as healthz_router

auth_config = config.setdefault("auth", {})
oidc_config = auth_config.setdefault("oidc", {})
oidc_config.setdefault("client_id", "test_id")
oidc_config.setdefault("client_secret", "test_secret")
oidc_config.setdefault("discovery_url", "https://test.discovery.url")
oidc_config.setdefault("allowlist", [])
oidc_config.setdefault("public_access", False)
oidc_config.setdefault("redirect_uri", None)

iap_config = auth_config.setdefault("iap", {})
iap_config.setdefault("audience", "/projects/123/global/backendServices/456")
iap_config.setdefault("allowlist", [])
iap_config.setdefault("public_access", False)

from auth import iap as iap_auth  # noqa: E402
from auth import oidc as oidc_auth  # noqa: E402


def test_converted_handlers_are_synchronous():
    """Converted routes and auth dependencies must be sync def, not async."""
    converted = [
        common_auth.verify_csrf,
        common_auth.get_current_user,
        common_auth.get_current_active_user,
        common_auth.refresh,
        common_auth.csrf,
        common_auth.logout,
        local_auth.auth_local,
        iap_auth.login,
        google_auth.auth_header_token,
        users_v1.get_api_key_for_current_user,
        users_v1.create_api_key_for_current_user,
        users_v1.delete_api_key,
        folders_v1.update_folder,
        folders_v1.create_adk_session,
        files_v1.upload_files,
        *(route.endpoint for route in workflows_v1.router.routes),
        *(route.endpoint for route in workflows_v1.router_root.routes),
    ]

    for handler in converted:
        assert not inspect.iscoroutinefunction(
            handler
        ), f"{handler.__module__}.{handler.__qualname__} must be def, not async def"
        assert not inspect.isasyncgenfunction(
            handler
        ), f"{handler.__module__}.{handler.__qualname__} must not be an async generator"


def test_genuinely_async_handlers_remain_async():
    """Streaming, OAuth callback, and SSE endpoints remain async def."""
    async_handlers = [
        files_v1.download_file_stream,
        google_auth.login,
        google_auth.auth,
        oidc_auth.login,
        oidc_auth.oidc_auth,
        folders_v1.start_investigation,
        folders_v1.get_adk_sse_session,
    ]

    for handler in async_handlers:
        assert inspect.iscoroutinefunction(
            handler
        ), f"{handler.__module__}.{handler.__qualname__} must remain async def"


@pytest.mark.asyncio
async def test_blocking_run_workflow_does_not_block_concurrent_request(
    fastapi_async_test_client, mocker, workflow_db_model
):
    """A blocking call inside run_workflow must not stall concurrent requests."""
    started = threading.Event()
    release = threading.Event()
    released = False

    def blocking_run_workflow(*args, **kwargs):
        nonlocal released
        started.set()
        released = release.wait(timeout=2.0)
        return workflow_db_model

    mocker.patch(
        "api.v1.workflows.get_workflow_with_access", return_value=workflow_db_model
    )
    mocker.patch("api.v1.workflows._check_files_accessible")
    mocker.patch(
        "api.v1.workflows.workflow_utils.run_workflow",
        side_effect=blocking_run_workflow,
    )
    mocker.patch("healthz._check_postgresql_connection", return_value="Ok")
    mocker.patch("healthz._check_redis_connection", return_value="Ok")

    slow_task = asyncio.create_task(
        fastapi_async_test_client.post(
            "/folders/1/workflows/1/run/",
            json={"workflow_spec": {"workflow": {"type": "chain", "tasks": []}}},
        )
    )

    try:
        entered = await asyncio.to_thread(started.wait, 2.0)
        assert entered, "run_workflow never started executing"

        health_response = await fastapi_async_test_client.get("/healthz")
        assert health_response.status_code == 200
    finally:
        release.set()

    run_response = await slow_task
    assert run_response.status_code == 200
    assert released, "concurrent request was blocked by run_workflow"


@pytest.mark.asyncio
async def test_blocking_get_current_user_does_not_block_concurrent_request(mocker, db):
    """A blocking DB lookup inside get_current_user must not stall other requests."""
    started = threading.Event()
    release = threading.Event()
    released = False

    mock_user = mocker.MagicMock()
    mock_user.is_active = True

    def blocking_user_lookup(*args, **kwargs):
        nonlocal released
        started.set()
        released = release.wait(timeout=2.0)
        return mock_user

    mocker.patch("auth.common.validate_jwt_token", return_value={"sub": "user-uuid"})
    mocker.patch(
        "auth.common.get_user_by_uuid_from_db", side_effect=blocking_user_lookup
    )
    mocker.patch("healthz._check_postgresql_connection", return_value="Ok")
    mocker.patch("healthz._check_redis_connection", return_value="Ok")

    app = FastAPI()
    app.include_router(healthz_router)

    @app.get("/protected")
    def protected(user=Depends(common_auth.get_current_active_user)):
        return {"ok": True}

    app.dependency_overrides[get_db_connection] = lambda: db

    async with AsyncClient(
        transport=ASGITransport(app),
        base_url="http://test",
        cookies={"access_token": "valid-token"},
    ) as client:
        slow_task = asyncio.create_task(client.get("/protected"))

        try:
            entered = await asyncio.to_thread(started.wait, 2.0)
            assert entered, "get_current_user never started executing"

            health_response = await client.get("/healthz")
            assert health_response.status_code == 200
        finally:
            release.set()

        protected_response = await slow_task

    assert protected_response.status_code == 200
    assert released, "concurrent request was blocked by get_current_user"
