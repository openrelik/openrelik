# Copyright 2024 Google LLC
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

"""Tests the configs endpoints."""


def test_get_system_config(fastapi_test_client, mocker):
    """Test the get_system_config endpoint."""
    mock_get_active_llms = mocker.patch("api.v1.configs.get_active_llms")

    mock_active_llms = [{"name": "test_llm"}]
    mock_get_active_llms.return_value = mock_active_llms

    response = fastapi_test_client.get("/configs/system/")
    assert response.status_code == 200
    assert response.json()["active_llms"] == mock_active_llms
    assert response.json()["allowed_data_types_preview"] == [
        "openrelik:hayabusa:html_report"
    ]
    assert response.json()["artifacts_bucket"] == "EXAMPLE_BUCKET"


def test_get_system_storage_status(fastapi_test_client, mocker):
    """Test GET /configs/status delegates to status CRUD and returns schema payload."""
    sample = {
        "collected_at": "2026-11-25T12:00:00+00:00",
        "files_count": 42,
        "files_total_bytes": 102400,
        "deleted_unpurged_files_count": 3,
        "deleted_unpurged_bytes": 2048,
        "folders_count": 10,
        "root_folders_count": 4,
        "workflows_count": 7,
        "storage_providers": [
            {
                "name": "server_default",
                "display_name": "Default Storage",
                "mode": "rw",
                "is_default": True,
                "available": True,
                "total_bytes": 1000000,
                "used_bytes": 250000,
                "free_bytes": 750000,
                "used_percent": 25.0,
                "file_count": 42,
                "file_bytes": 102400,
            }
        ],
    }
    mock_fn = mocker.patch(
        "api.v1.configs.get_system_storage_status_from_db", return_value=sample
    )

    response = fastapi_test_client.get("/configs/status?refresh=true")
    assert response.status_code == 200
    assert response.json() == sample
    assert mock_fn.call_args.kwargs == {"refresh": True}
