"""Running external commands (git, docker, gh)."""

import os
import subprocess
import sys
from pathlib import Path
from typing import NoReturn


def run(*cmd: str | Path, cwd: Path | None = None) -> None:
    """Runs a command with inherited stdio and exits with its status if it fails."""
    returncode = subprocess.run(cmd, cwd=cwd).returncode
    if returncode:
        sys.exit(returncode)


def attempt(*cmd: str | Path, cwd: Path | None = None, quiet: bool = False) -> bool:
    """Runs a command and returns whether it succeeded. Quiet discards its output."""
    output = subprocess.DEVNULL if quiet else None
    try:
        return subprocess.run(cmd, cwd=cwd, stdout=output, stderr=output).returncode == 0
    except FileNotFoundError:
        return False


def capture(*cmd: str | Path, cwd: Path | None = None) -> str:
    """Returns a command's stdout and exits with its status if it fails."""
    result = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, text=True)
    if result.returncode:
        sys.exit(result.returncode)
    return result.stdout.rstrip("\n")


def query(*cmd: str | Path, cwd: Path | None = None) -> str | None:
    """Returns a command's stdout, or None if it fails. Its stderr is discarded."""
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    except FileNotFoundError:
        return None
    return result.stdout.rstrip("\n") if result.returncode == 0 else None


def replace_process(*cmd: str, cwd: Path) -> NoReturn:
    """Replaces this process with the command, so that it owns the terminal and signals."""
    sys.stdout.flush()
    sys.stderr.flush()
    os.chdir(cwd)
    os.execvp(cmd[0], cmd)
