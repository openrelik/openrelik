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
