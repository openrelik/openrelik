import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner

from devctl import docker
from devctl.cli import cli

ENV_EXAMPLE = """\
COMPOSE_PROJECT_NAME=openrelik
POSTGRES_PASSWORD=
UI_PORT=3000
API_PORT=8710
MCP_PORT=7070
"""

SETTINGS_EXAMPLE = """\
[server]
ui_server_url = "<REPLACE_WITH_UI_URL>"
allowed_origins = ["<REPLACE_WITH_UI_URL>"]
storage_path = "<REPLACE_WITH_STORAGE_PATH>"
password = "<REPLACE_WITH_POSTGRES_PASSWORD>"
allowlist = ["<REPLACE_WITH_USERNAME>@gmail.com"]
"""

# docker is installed but not running; gh is not logged in.
STUBS = {
    "docker": '#!/bin/sh\n[ "$1 $2" = "compose version" ] && exit 0\nexit 1\n',
    "gh": "#!/bin/sh\nexit 1\n",
}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def commit(cwd: Path, name: str) -> None:
    (cwd / name).write_text(name)
    git(cwd, "add", name)
    git(cwd, "commit", "--quiet", "-m", name)


@pytest.fixture
def repo(tmp_path, monkeypatch) -> Path:
    """A repository with one commit on main, no origin, and stubbed docker and gh."""
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for name, script in STUBS.items():
        (stubs / name).write_text(script)
        (stubs / name).chmod(0o755)
    monkeypatch.setenv("PATH", f"{stubs}:{subprocess.os.environ['PATH']}")
    for var in ("GIT_AUTHOR", "GIT_COMMITTER"):
        monkeypatch.setenv(f"{var}_NAME", "Test")
        monkeypatch.setenv(f"{var}_EMAIL", "test@example.com")
    docker.ready.cache_clear()

    root = (tmp_path / "repo").resolve()
    root.mkdir()
    git(root, "init", "--quiet", "-b", "main")
    (root / ".env.example").write_text(ENV_EXAMPLE)
    (root / "server").mkdir()
    (root / "server" / "settings_example.toml").write_text(SETTINGS_EXAMPLE)
    (root / ".gitignore").write_text("/.env\n/.dev-local/\n/.worktrees/\n")
    git(root, "add", ".")
    git(root, "commit", "--quiet", "-m", "initial")

    monkeypatch.setenv("DEV_SCRIPT_DIR", str(root))
    monkeypatch.chdir(root)
    return root


@pytest.fixture
def dev():
    """Runs ./devctl with arguments and returns the result; fails on an unexpected exit code."""

    def invoke(*args: str, exit_code: int = 0):
        result = CliRunner().invoke(cli, args, prog_name="devctl")
        assert result.exit_code == exit_code, result.output
        return result

    return invoke
