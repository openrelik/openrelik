import signal
import subprocess
import sys
import time
from pathlib import Path

RELOAD = Path(__file__).resolve().parents[2] / "reload" / "reload.py"

sys.path.insert(0, str(RELOAD.parent))
import reload  # noqa: E402


def wait_for(predicate, timeout: float = 10) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def test_snapshot_ignores_caches(tmp_path):
    (tmp_path / "pkg" / "__pycache__").mkdir(parents=True)
    (tmp_path / "pkg" / "__pycache__" / "mod.cpython-312.pyc").write_text("x")
    (tmp_path / "pkg" / "mod.py").write_text("x")
    (tmp_path / "pkg" / "mod.py.swp").write_text("x")
    assert list(reload.snapshot([str(tmp_path)])) == [str(tmp_path / "pkg" / "mod.py")]


def test_changed_reports_added_changed_and_removed():
    old = {"a": (1, 1), "b": (1, 1), "c": (1, 1)}
    new = {"a": (1, 1), "b": (2, 1), "d": (1, 1)}
    assert reload.changed(old, new) == ["b", "c", "d"]


def test_restarts_on_change_and_stops_with_the_container(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.py").write_text("v1")
    starts = tmp_path / "starts"
    # Records each start, then runs until stopped.
    command = f"echo started >> {starts}; exec sleep 60"
    proc = subprocess.Popen(
        [sys.executable, str(RELOAD), str(src), "--", "sh", "-c", command],
        stderr=subprocess.PIPE, text=True,
    )
    count = lambda: len(starts.read_text().splitlines()) if starts.exists() else 0
    try:
        assert wait_for(lambda: count() == 1)
        time.sleep(1.2)  # past the first poll, so the change is seen as one
        (src / "app.py").write_text("v2")
        (src / "new.py").write_text("x")
        assert wait_for(lambda: count() == 2)
        time.sleep(1.5)
        assert count() == 2  # one restart for both files
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(10)
    assert "changed, restarting" in proc.stderr.read()


def test_waits_for_a_change_after_the_command_exits(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.py").write_text("broken")
    starts = tmp_path / "starts"
    proc = subprocess.Popen(
        [sys.executable, str(RELOAD), str(src), "--", "sh", "-c", f"echo x >> {starts}; exit 3"],
        stderr=subprocess.PIPE, text=True,
    )
    try:
        assert wait_for(lambda: starts.exists())
        time.sleep(1.5)
        assert proc.poll() is None  # the reloader keeps the container up
        (src / "app.py").write_text("fixed")
        assert wait_for(lambda: len(starts.read_text().splitlines()) == 2)
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(10)
    assert "exited with 3" in proc.stderr.read()


def test_usage_error():
    result = subprocess.run([sys.executable, str(RELOAD), "src"], capture_output=True, text=True)
    assert result.returncode == 2
