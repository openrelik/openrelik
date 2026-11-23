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

from src import archives


@pytest.fixture
def mock_dependencies():
    """Mocks dependencies for extract_archive_task."""
    with (
        patch("src.archives.get_input_files") as mock_get_input_files,
        patch("src.archives.create_output_file") as mock_create_output_file,
        patch("src.archives.extract_archive") as mock_extract_archive,
        patch("src.archives.create_task_result") as mock_create_task_result,
        patch("src.archives.shutil.rmtree") as mock_rmtree,
        patch("src.archives.os.rename") as mock_rename,
        patch("src.archives.Path") as mock_path,
        patch("src.archives.telemetry") as mock_telemetry,
    ):
        yield {
            "get_input_files": mock_get_input_files,
            "create_output_file": mock_create_output_file,
            "extract_archive": mock_extract_archive,
            "create_task_result": mock_create_task_result,
            "rmtree": mock_rmtree,
            "rename": mock_rename,
            "path": mock_path,
            "telemetry": mock_telemetry,
        }


@pytest.fixture
def mock_celery_task():
    """Mock the Celery task instance (self)."""
    task = MagicMock()
    task.send_event = MagicMock()
    return task


def test_extract_archive_task_success(mock_celery_task, mock_dependencies):
    """Test successful execution of extract_archive_task."""
    # Setup mocks
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip", "path": "/path/to/archive.zip"}
    ]

    mock_log_file = Mock()
    mock_log_file.path = "/tmp/output/extract.log"
    mock_log_file.to_dict.return_value = {"id": "log1", "display_name": "extract.log"}

    # create_output_file is called twice: once for log file, once for extracted file
    output_file_side_effect = [
        mock_log_file,  # Log file
        Mock(
            path="/tmp/output/extracted_file.txt",
            to_dict=lambda: {"id": "file2", "display_name": "extracted.txt"},
        ),  # Extracted file
    ]
    mock_dependencies["create_output_file"].side_effect = output_file_side_effect

    mock_dependencies["extract_archive"].return_value = (
        "extract_cmd",
        "/tmp/export_dir",
    )

    # Mock Path and glob
    mock_export_path_obj = Mock()
    mock_extracted_file = Mock()
    mock_extracted_file.is_symlink.return_value = False
    mock_extracted_file.is_file.return_value = True
    mock_extracted_file.name = "extracted.txt"
    mock_extracted_file.relative_to.return_value = "extracted.txt"
    # Ensure absolute() returns a mock that can be stringified if needed
    mock_extracted_file.absolute.return_value = "/tmp/export_dir/extracted.txt"

    mock_export_path_obj.glob.return_value = [mock_extracted_file]
    mock_dependencies["path"].return_value = mock_export_path_obj

    mock_dependencies["create_task_result"].return_value = "serialized_result"

    # Call the task using __class__.run mock_celery_task as self
    result = archives.extract_archive_task.__class__.run(
        mock_celery_task,
        pipe_result="pipe_res",
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"file_filter": "*.txt", "archive_password": "pass"},
    )

    # Assertions
    assert result == "serialized_result"
    mock_dependencies["get_input_files"].assert_called_once_with("pipe_res", [])
    mock_dependencies["create_output_file"].assert_any_call(
        "/tmp/output", display_name="extract_archives_archive.zip.log"
    )
    mock_dependencies["extract_archive"].assert_called_once_with(
        {"id": "file1", "display_name": "archive.zip", "path": "/path/to/archive.zip"},
        "/tmp/output",
        "/tmp/output/extract.log",
        ["*.txt"],
        "pass",
        True,
        [],
    )
    mock_dependencies["rename"].assert_called_once()
    mock_dependencies["rmtree"].assert_called_once_with("/tmp/export_dir")
    mock_dependencies["create_task_result"].assert_called_once()

    # Check that task_progress event was sent
    mock_celery_task.send_event.assert_called_with("task-progress")


def test_extract_archive_task_no_input_files(mock_celery_task, mock_dependencies):
    """Test extract_archive_task with no input files."""
    mock_dependencies["get_input_files"].return_value = []
    mock_dependencies["create_task_result"].return_value = "empty_result"

    result = archives.extract_archive_task.__class__.run(
        mock_celery_task,
        pipe_result=None,
        input_files=[],
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={},
    )

    assert result == "empty_result"
    mock_dependencies["create_task_result"].assert_called_once_with(
        output_files=[],
        task_files=[],
        workflow_id="wf1",
        command="",
        task_report=None,
    )


def test_extract_archive_task_unsupported_file(mock_celery_task, mock_dependencies):
    """Test extract_archive_task when extract_archive raises ValueError for unsupported file."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "notes.txt", "path": "/path/to/notes.txt"}
    ]
    mock_log_file = Mock(path="/tmp/log", to_dict=lambda: {"id": "log1"})
    mock_dependencies["create_output_file"].return_value = mock_log_file
    mock_dependencies["extract_archive"].side_effect = ValueError(
        "Unsupported archive format: notes.txt"
    )
    mock_dependencies["create_task_result"].return_value = "result_with_report"

    result = archives.extract_archive_task.__class__.run(
        mock_celery_task,
        pipe_result=None,
        input_files=[{"id": "file1", "display_name": "notes.txt"}],
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={},
    )

    assert result == "result_with_report"
    _, kwargs = mock_dependencies["create_task_result"].call_args
    assert kwargs["output_files"] == []
    assert kwargs["task_report"] is not None
    assert "Extraction Errors" in kwargs["task_report"]["content"]
    assert "Unsupported archive format: notes.txt" in kwargs["task_report"]["content"]


def test_extract_archive_task_exception(mock_celery_task, mock_dependencies):
    """Test extract_archive_task when extract_archive raises an exception."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "broken.zip"}
    ]
    mock_log_file = Mock()
    mock_log_file.path = "/tmp/log"
    mock_dependencies["create_output_file"].return_value = mock_log_file

    mock_dependencies["extract_archive"].side_effect = Exception("Extraction failed")

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        pipe_result=None,
        input_files=[{"id": "file1", "display_name": "broken.zip"}],
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={},
    )

    # Failure is caught: nothing extracted, files not renamed.
    mock_dependencies["rename"].assert_not_called()

    # Task still returns a result, with the error and filename in the report.
    mock_dependencies["create_task_result"].assert_called_once()
    kwargs = mock_dependencies["create_task_result"].call_args.kwargs
    assert kwargs["output_files"] == []
    assert kwargs["task_report"] is not None
    assert "Extraction Errors" in str(kwargs["task_report"])
    assert "broken.zip: Extraction failed" in str(kwargs["task_report"])


def test_extract_archive_task_file_filter_list(mock_celery_task, mock_dependencies):
    """Test that file filters are correctly parsed."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip"}
    ]
    mock_dependencies["create_output_file"].return_value = Mock(
        path="/tmp/log", to_dict=lambda: {}
    )
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")
    mock_dependencies["path"].return_value.glob.return_value = []
    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"file_filter": "*.txt,*.log"},
    )

    # Access the call args to verify file_filter list
    args, _ = mock_dependencies["extract_archive"].call_args
    assert args[3] == ["*.txt", "*.log"]


def test_extract_archive_task_ignore_prompts_default(
    mock_celery_task, mock_dependencies
):
    """Test that ignore_prompts defaults to True when not in task_config."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip"}
    ]
    mock_dependencies["create_output_file"].return_value = Mock(
        path="/tmp/log", to_dict=lambda: {}
    )
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")
    mock_dependencies["path"].return_value.glob.return_value = []
    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={},
    )

    args, _ = mock_dependencies["extract_archive"].call_args
    assert args[5] is True


def test_extract_archive_task_ignore_prompts_true(mock_celery_task, mock_dependencies):
    """Test that ignore_prompts is forwarded when explicitly set to True."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip"}
    ]
    mock_dependencies["create_output_file"].return_value = Mock(
        path="/tmp/log", to_dict=lambda: {}
    )
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")
    mock_dependencies["path"].return_value.glob.return_value = []
    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"ignore_prompts": True},
    )

    args, _ = mock_dependencies["extract_archive"].call_args
    assert args[5] is True


def test_extract_archive_task_ignore_prompts_false(mock_celery_task, mock_dependencies):
    """Test that ignore_prompts is forwarded when explicitly set to False."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip"}
    ]
    mock_dependencies["create_output_file"].return_value = Mock(
        path="/tmp/log", to_dict=lambda: {}
    )
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")
    mock_dependencies["path"].return_value.glob.return_value = []
    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"ignore_prompts": False},
    )

    args, _ = mock_dependencies["extract_archive"].call_args
    assert args[5] is False


def _run_task_with_one_extracted_file(mock_celery_task, mock_dependencies, task_config):
    """Helper: run extract_archive_task with one input + one extracted file."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip", "path": "/p/archive.zip"}
    ]
    mock_log_file = Mock(path="/tmp/log", to_dict=lambda: {"id": "log1"})
    mock_output_file = Mock(path="/tmp/extracted", to_dict=lambda: {"id": "f2"})
    mock_dependencies["create_output_file"].side_effect = [
        mock_log_file,
        mock_output_file,
    ]
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")

    mock_extracted = Mock()
    mock_extracted.is_symlink.return_value = False
    mock_extracted.is_file.return_value = True
    mock_extracted.name = "extracted.txt"
    mock_extracted.relative_to.return_value = "extracted.txt"
    mock_extracted.absolute.return_value = "/tmp/export/extracted.txt"
    mock_dependencies["path"].return_value.glob.return_value = [mock_extracted]

    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config=task_config,
    )


def test_extracted_files_register_in_db_by_default(mock_celery_task, mock_dependencies):
    """Without the skip switch, extracted files opt in to DB registration."""
    _run_task_with_one_extracted_file(
        mock_celery_task, mock_dependencies, task_config={}
    )

    # call_args_list: [0] is the log file, [1] is the extracted file.
    extracted_call = mock_dependencies["create_output_file"].call_args_list[1]
    assert extracted_call.kwargs.get("register_in_db") is True


def test_extracted_files_register_in_db_when_value_is_null(
    mock_celery_task, mock_dependencies
):
    """A null value (sent by clients that don't know the option) keeps the default."""
    _run_task_with_one_extracted_file(
        mock_celery_task, mock_dependencies, task_config={"register_in_db": None}
    )

    extracted_call = mock_dependencies["create_output_file"].call_args_list[1]
    assert extracted_call.kwargs.get("register_in_db") is True


def test_extracted_files_register_in_db_when_task_config_is_none(
    mock_celery_task, mock_dependencies
):
    """When task_config is None, default values are preserved and no error is raised."""
    _run_task_with_one_extracted_file(
        mock_celery_task, mock_dependencies, task_config=None
    )

    extracted_call = mock_dependencies["create_output_file"].call_args_list[1]
    assert extracted_call.kwargs.get("register_in_db") is True


def test_extracted_files_skip_db_when_register_in_db_false(
    mock_celery_task, mock_dependencies
):
    """register_in_db=False in task_config propagates to each extracted file."""
    _run_task_with_one_extracted_file(
        mock_celery_task, mock_dependencies, task_config={"register_in_db": False}
    )

    extracted_call = mock_dependencies["create_output_file"].call_args_list[1]
    assert extracted_call.kwargs.get("register_in_db") is False


def test_extract_archive_task_exclusion_pattern(mock_celery_task, mock_dependencies):
    """Test that exclusion patterns are correctly parsed."""
    mock_dependencies["get_input_files"].return_value = [
        {"id": "file1", "display_name": "archive.zip"}
    ]
    mock_dependencies["create_output_file"].return_value = Mock(
        path="/tmp/log", to_dict=lambda: {}
    )
    mock_dependencies["extract_archive"].return_value = ("cmd", "/tmp/export")
    mock_dependencies["path"].return_value.glob.return_value = []
    mock_dependencies["create_task_result"].return_value = "res"

    archives.extract_archive_task.__class__.run(
        mock_celery_task,
        input_files=None,
        output_path="/tmp/output",
        workflow_id="wf1",
        task_config={"file_exclusion": "$MFT,*.tmp"},
    )

    # Access the call args to verify exclusion patterns
    args, _ = mock_dependencies["extract_archive"].call_args
    assert args[6] == ["$MFT", "*.tmp"]


def test_extract_archive_task_skips_symlinks(tmp_path, mock_celery_task):
    """Symlinks in extracted archives must be skipped so neither dangling symlinks
    nor host-pointing absolute symlinks enter OpenRelik storage."""
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    secret_file = outside_dir / "secret.txt"
    secret_file.write_text("host secret")

    export_dir = tmp_path / "export"
    subdir = export_dir / "subdir"
    subdir.mkdir(parents=True)

    real_file = subdir / "real.txt"
    real_file.write_text("real evidence")
    os.symlink("real.txt", subdir / "rel_link.txt")
    os.symlink(str(secret_file), export_dir / "abs_link.txt")
    os.symlink("nonexistent_target", export_dir / "dangling_link.txt")
    os.symlink(str(outside_dir), export_dir / "dir_link")

    output_dir = tmp_path / "output"
    output_dir.mkdir()

    captured = {}

    def fake_create_task_result(**kwargs):
        captured.update(kwargs)
        return "serialized_result"

    with (
        patch(
            "src.archives.get_input_files",
            return_value=[
                {"id": 1, "display_name": "evidence.tar.gz", "path": "/in/evidence.tar.gz"}
            ],
        ),
        patch(
            "src.archives.extract_archive",
            return_value=("tar -vxzf ...", str(export_dir)),
        ),
        patch("src.archives.create_task_result", side_effect=fake_create_task_result),
        patch("src.archives.telemetry"),
    ):
        result = archives.extract_archive_task.__class__.run(
            mock_celery_task,
            pipe_result=None,
            input_files=None,
            output_path=str(output_dir),
            workflow_id="wf-symlinks",
            task_config={},
        )

    assert result == "serialized_result"
    assert not export_dir.exists()
    assert secret_file.exists()

    output_files = captured["output_files"]
    assert len(output_files) == 1
    assert output_files[0]["display_name"] == "real.txt"
    assert output_files[0]["original_path"] == "subdir/real.txt"

    stored_path = output_files[0]["path"]
    assert not os.path.islink(stored_path)
    with open(stored_path, encoding="utf-8") as fh:
        assert fh.read() == "real evidence"
    assert not any(p.is_symlink() for p in output_dir.rglob("*"))
