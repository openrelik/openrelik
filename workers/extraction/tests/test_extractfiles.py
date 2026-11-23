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
import os
import pytest
from unittest.mock import MagicMock, Mock, patch

from src import extractfiles


@pytest.fixture
def mock_dependencies():
    """Mocks dependencies for extract_full_file_path_task."""
    with (
        patch("src.extractfiles.get_input_files") as mock_get_input_files,
        patch("src.extractfiles.create_output_file") as mock_create_output_file,
        patch("src.extractfiles.create_task_result") as mock_create_task_result,
        patch("src.extractfiles.BlockDevice") as mock_block_device,
        patch("src.extractfiles.shutil.copy") as mock_shutil_copy,
        patch("src.extractfiles.os.path.exists") as mock_exists,
        patch("src.extractfiles.os.path.isfile") as mock_isfile,
        patch("src.extractfiles.telemetry") as mock_telemetry,
    ):
        yield {
            "get_input_files": mock_get_input_files,
            "create_output_file": mock_create_output_file,
            "create_task_result": mock_create_task_result,
            "block_device": mock_block_device,
            "shutil_copy": mock_shutil_copy,
            "exists": mock_exists,
            "isfile": mock_isfile,
            "telemetry": mock_telemetry,
        }


@pytest.fixture
def mock_celery_task():
    """Mock the Celery task instance (self)."""
    task = MagicMock()
    task.send_event = MagicMock()
    return task


def test_extract_full_file_path_task_success(mock_celery_task, mock_dependencies):
    """Test successful extraction of files."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]

    mock_bd_instance = mock_dependencies["block_device"].return_value
    mock_bd_instance.mount.return_value = ["/mnt/partition1"]

    mock_dependencies["exists"].return_value = True
    mock_dependencies["isfile"].return_value = True

    mock_output_file = Mock()
    mock_output_file.path = "/tmp/output/extracted_file"
    mock_output_file.to_dict.return_value = {"id": "out1", "display_name": "file.txt"}
    mock_dependencies["create_output_file"].return_value = mock_output_file

    mock_dependencies["create_task_result"].return_value = "serialized_result"

    result = extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task,
        pipe_result=None,
        input_files=[{"id": "file1"}],
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"file_paths": "/Windows/System32/config/SYSTEM\n/etc/passwd"},
    )

    assert result == "serialized_result"
    mock_dependencies["get_input_files"].assert_called_once()
    mock_bd_instance.setup.assert_called_once()
    mock_bd_instance.mount.assert_called_once()
    mock_bd_instance.umount.assert_called_once()

    # Check if create_output_file was called for each found file
    # In this test, we mocked exists/isfile to return True for everything
    # file_paths has 2 lines, so it should be called at least once per path per mountpoint
    assert mock_dependencies["create_output_file"].call_count == 2
    assert mock_dependencies["shutil_copy"].call_count == 2
    mock_celery_task.send_event.assert_called_with("task-progress")


def test_extract_full_file_path_task_no_file_paths(mock_celery_task, mock_dependencies):
    """Test task with no file paths provided."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]
    mock_dependencies["create_task_result"].return_value = "empty_result"

    result = extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": ""}, workflow_id="wf1"
    )

    assert result == "empty_result"
    mock_dependencies["create_task_result"].assert_called_once_with(
        output_files=[],
        workflow_id="wf1",
    )
    mock_dependencies["block_device"].assert_not_called()


def test_extract_full_file_path_task_no_input_files(
    mock_celery_task, mock_dependencies
):
    """Test task with no input files."""
    mock_dependencies["get_input_files"].return_value = []
    mock_dependencies["create_task_result"].return_value = "empty_result"

    result = extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task,
        input_files=[],
        task_config={"file_paths": "/some/path"},
        workflow_id="wf1",
    )

    assert result == "empty_result"
    # Should still call create_task_result at the end
    assert mock_dependencies["create_task_result"].call_count == 1


def test_extract_full_file_path_task_mount_failure(mock_celery_task, mock_dependencies):
    """Test task when mount returns no mountpoints."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]

    mock_bd_instance = mock_dependencies["block_device"].return_value
    mock_bd_instance.mount.return_value = []

    mock_dependencies["create_task_result"].return_value = "result"

    extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": "/path/to/file"}, workflow_id="wf1"
    )

    mock_bd_instance.mount.assert_called_once()
    mock_dependencies["create_output_file"].assert_not_called()
    mock_bd_instance.umount.assert_called_once()


def test_extract_full_file_path_task_file_not_found(
    mock_celery_task, mock_dependencies
):
    """Test task when requested files are not found."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]

    mock_bd_instance = mock_dependencies["block_device"].return_value
    mock_bd_instance.mount.return_value = ["/mnt/partition1"]

    mock_dependencies["exists"].return_value = False

    mock_dependencies["create_task_result"].return_value = "result"

    extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": "/path/to/file"}, workflow_id="wf1"
    )

    mock_dependencies["create_output_file"].assert_not_called()
    mock_bd_instance.umount.assert_called_once()


def test_extract_full_file_path_task_copy_failure(mock_celery_task, mock_dependencies):
    """Test task when shutil.copy fails."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]

    mock_bd_instance = mock_dependencies["block_device"].return_value
    mock_bd_instance.mount.return_value = ["/mnt/partition1"]

    mock_dependencies["exists"].return_value = True
    mock_dependencies["isfile"].return_value = True

    mock_output_file = Mock()
    mock_dependencies["create_output_file"].return_value = mock_output_file

    mock_dependencies["shutil_copy"].side_effect = Exception("Copy failed")

    mock_dependencies["create_task_result"].return_value = "result"

    extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": "/path/to/file"}, workflow_id="wf1"
    )

    mock_dependencies["shutil_copy"].assert_called_once()
    # It should catch the exception and continue (log error)
    mock_bd_instance.umount.assert_called_once()


def test_extract_full_file_path_task_setup_exception(
    mock_celery_task, mock_dependencies
):
    """Test task when BlockDevice.setup raises an exception."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "path": "/path/to/image.raw"}
    ]

    mock_bd_instance = mock_dependencies["block_device"].return_value
    mock_bd_instance.setup.side_effect = Exception("Setup failed")

    mock_dependencies["create_task_result"].return_value = "result"

    extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": "/path/to/file"}, workflow_id="wf1"
    )

    mock_bd_instance.setup.assert_called_once()
    # Should catch exception and call umount in finally block
    mock_bd_instance.umount.assert_called_once()


def test_extract_full_file_path_task_no_path_in_input(
    mock_celery_task, mock_dependencies
):
    """Test task when an input file has no path."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1"}  # No "path" key
    ]

    mock_dependencies["create_task_result"].return_value = "result"

    extractfiles.extract_full_file_path_task.__class__.run(
        mock_celery_task, task_config={"file_paths": "/path/to/file"}, workflow_id="wf1"
    )

    mock_dependencies["block_device"].assert_not_called()


def test_on_task_prerun():
    """Test on_task_prerun signal handler."""
    mock_task = Mock()
    mock_task.name = "test_task"
    with patch("src.extractfiles.log_root") as mock_log_root:
        extractfiles.on_task_prerun(
            sender=None, task_id="task_id", task=mock_task, args=None, kwargs=None
        )
        mock_log_root.bind.assert_called_once_with(
            task_id="task_id",
            task_name="test_task",
            worker_name=extractfiles.TASK_METADATA.get("task_config", {})[0].get(
                "name"
            ),
        )


def test_extract_full_file_path_task_skips_symlinks(tmp_path, mock_celery_task):
    """Direct symlinks inside a mounted disk image must not be copied into storage."""
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    secret_file = outside_dir / "secret.txt"
    secret_file.write_text("host secret")

    mountpoint = tmp_path / "mnt"
    mountpoint.mkdir()
    real_file = mountpoint / "real.txt"
    real_file.write_text("disk evidence")
    os.symlink("real.txt", mountpoint / "rel_link.txt")
    os.symlink(str(secret_file), mountpoint / "abs_link.txt")
    os.symlink("missing_target", mountpoint / "dangling_link.txt")

    output_dir = tmp_path / "output"
    output_dir.mkdir()

    captured = {}

    def fake_create_task_result(**kwargs):
        captured.update(kwargs)
        return "serialized_result"

    mock_bd = MagicMock()
    mock_bd.mount.return_value = [str(mountpoint)]

    with (
        patch(
            "src.extractfiles.get_input_files",
            return_value=[{"id": 1, "path": "/path/to/image.raw"}],
        ),
        patch("src.extractfiles.BlockDevice", return_value=mock_bd),
        patch(
            "src.extractfiles.create_task_result", side_effect=fake_create_task_result
        ),
        patch("src.extractfiles.telemetry"),
    ):
        result = extractfiles.extract_full_file_path_task.__class__.run(
            mock_celery_task,
            pipe_result=None,
            input_files=None,
            output_path=str(output_dir),
            workflow_id="wf-symlinks",
            task_config={
                "file_paths": "/real.txt\n/rel_link.txt\n/abs_link.txt\n/dangling_link.txt"
            },
        )

    assert result == "serialized_result"
    mock_bd.umount.assert_called_once()

    output_files = captured["output_files"]
    assert len(output_files) == 1
    assert output_files[0]["display_name"] == "real.txt"
    assert not os.path.islink(output_files[0]["path"])
    with open(output_files[0]["path"], encoding="utf-8") as fh:
        assert fh.read() == "disk evidence"
    assert not any(p.is_symlink() for p in output_dir.rglob("*"))


def test_extract_full_file_path_task_blocks_symlink_parent_traversal(
    tmp_path, mock_celery_task
):
    """A symlinked parent directory escaping the mountpoint is skipped without aborting remaining paths."""
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    secret_file = outside_dir / "secret.txt"
    secret_file.write_text("host secret")

    mountpoint = tmp_path / "mnt"
    mountpoint.mkdir()
    os.symlink(str(outside_dir), mountpoint / "escape")
    normal_file = mountpoint / "after.txt"
    normal_file.write_text("still extracted")

    output_dir = tmp_path / "output"
    output_dir.mkdir()

    captured = {}

    def fake_create_task_result(**kwargs):
        captured.update(kwargs)
        return "serialized_result"

    mock_bd = MagicMock()
    mock_bd.mount.return_value = [str(mountpoint)]

    with (
        patch(
            "src.extractfiles.get_input_files",
            return_value=[{"id": 1, "path": "/path/to/image.raw"}],
        ),
        patch("src.extractfiles.BlockDevice", return_value=mock_bd),
        patch(
            "src.extractfiles.create_task_result", side_effect=fake_create_task_result
        ),
        patch("src.extractfiles.telemetry"),
    ):
        extractfiles.extract_full_file_path_task.__class__.run(
            mock_celery_task,
            pipe_result=None,
            input_files=None,
            output_path=str(output_dir),
            workflow_id="wf-traversal",
            task_config={"file_paths": "/escape/secret.txt\n/after.txt"},
        )

    mock_bd.umount.assert_called_once()
    output_files = captured["output_files"]
    assert len(output_files) == 1
    assert output_files[0]["display_name"] == "after.txt"
    with open(output_files[0]["path"], encoding="utf-8") as fh:
        assert fh.read() == "still extracted"
