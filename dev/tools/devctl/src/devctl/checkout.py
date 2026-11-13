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

"""Checkouts: the main checkout and the worktrees in .worktrees/, and their config.

A checkout is identified by its directory: the main checkout at the repository
root or a worktree at .worktrees/<slug>. Its branch, project, and ports are read
from it.
"""

import os
import re
import secrets
import shutil
from dataclasses import dataclass
from pathlib import Path

from devctl import envfile, git, ui
from devctl.proc import attempt, query

WORKTREES = ".worktrees"
# A checkout's generated config and data, mounted into its stack.
LOCAL = ".dev-local"
PROJECT_PREFIX = "openrelik"
MAIN_PROJECT = f"{PROJECT_PREFIX}-main"

BASE_UI_PORT = 3000
BASE_RUNESTONE_PORT = 3050
BASE_API_PORT = 8710
BASE_MCP_PORT = 7070


def worktree_slug(branch: str) -> str:
    """Branch code/<slug> lives in .worktrees/<slug>; other branches have / replaced."""
    return re.sub(r"[^a-z0-9_-]", "-", branch.removeprefix("code/").lower())


@dataclass(frozen=True)
class Repo:
    root: Path

    @classmethod
    def discover(cls) -> "Repo":
        """The repository around ./devctl; the main checkout even when run from a worktree."""
        script_dir = Path(os.environ.get("DEV_SCRIPT_DIR") or Path(__file__).resolve().parents[4])
        common_dir = query(
            "git", "-C", script_dir, "rev-parse", "--path-format=absolute", "--git-common-dir"
        )
        return cls(Path(common_dir).parent.resolve() if common_dir else script_dir)

    @property
    def worktrees_dir(self) -> Path:
        return self.root / WORKTREES

    def worktree_dir(self, branch: str) -> Path:
        return self.worktrees_dir / worktree_slug(branch)

    def label(self, checkout: Path) -> str:
        if checkout == self.root:
            return "main checkout"
        if checkout.is_relative_to(self.root):
            return str(checkout.relative_to(self.root))
        return str(checkout)

    def resolve_checkout(self, name: str | None = None) -> Path:
        """The worktree named on the command line, or else the checkout around the
        current directory, or else the main checkout."""
        if name:
            checkout = self.worktree_dir(name)
            if not checkout.is_dir():
                ui.die(
                    f"worktree '{self.label(checkout)}' does not exist; "
                    f"create it with: ./devctl worktree create {name}"
                )
            return checkout
        top = query("git", "rev-parse", "--show-toplevel")
        if top:
            top_dir = Path(top).resolve()
            if top_dir == self.root or (
                top_dir.is_relative_to(self.worktrees_dir) and top_dir != self.worktrees_dir
            ):
                return top_dir
        return self.root

    def checkouts(self) -> list[tuple[Path, str]]:
        return git.worktrees(self.root)

    def checkout_of_branch(self, branch: str) -> Path | None:
        return next((path for path, b in self.checkouts() if b == branch), None)

    def env(self, checkout: Path) -> dict[str, str]:
        return envfile.read_env(checkout / ".env")

    def project(self, checkout: Path) -> str:
        default = MAIN_PROJECT if checkout == self.root else f"{PROJECT_PREFIX}-{checkout.name}"
        return self.env(checkout).get("COMPOSE_PROJECT_NAME") or default

    def ports(self, checkout: Path) -> tuple[str, str, str]:
        """The checkout's (UI, API, MCP) host ports."""
        env = self.env(checkout)
        return (
            env.get("UI_PORT") or str(BASE_UI_PORT),
            env.get("API_PORT") or str(BASE_API_PORT),
            env.get("MCP_PORT") or str(BASE_MCP_PORT),
        )

    def runestone_port(self, checkout: Path) -> str:
        """The checkout's Runestone UI host port."""
        return self.env(checkout).get("RUNESTONE_PORT") or str(BASE_RUNESTONE_PORT)

    def next_port_slot(self) -> int:
        """The lowest slot (1, 2, 3, ...) whose ports no worktree's .env uses."""
        used = set()
        for env_file in self.worktrees_dir.glob("*/.env"):
            port = envfile.read_env(env_file).get("UI_PORT", "")
            if port.isdigit() and int(port) > BASE_UI_PORT:
                used.add(int(port) - BASE_UI_PORT)
        slot = 1
        while slot in used:
            slot += 1
        return slot


def check_prerequisites() -> None:
    for cmd in ("git", "docker"):
        if not shutil.which(cmd):
            ui.die(f"'{cmd}' is required but not installed")
    if not attempt("docker", "compose", "version", quiet=True):
        ui.die("'docker compose' (v2+) is required")


def write_private(path: Path, content: str) -> None:
    """Writes a file that holds secrets, readable only by the user."""
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write(content)


def move_old_layout(checkout: Path) -> None:
    """Moves config/ and data/ from where they were before .dev-local/."""
    for name in ("config", "data"):
        old, new = checkout / name, checkout / LOCAL / name
        if not old.is_dir():
            continue
        if new.exists():
            ui.warn(f"both {name}/ and {LOCAL}/{name}/ exist; using {LOCAL}/{name}/, remove {name}/")
            continue
        new.parent.mkdir(exist_ok=True)
        old.rename(new)
        ui.ok(f"moved {name}/ to {LOCAL}/{name}/")
    # Now inline in compose.yml.
    shutil.rmtree(checkout / LOCAL / "config" / "prometheus", ignore_errors=True)


def init_checkout(repo: Repo, checkout: Path) -> None:
    """Writes .env and .dev-local/config/settings.toml unless they exist, and
    creates .dev-local/data/storage/."""
    env_file = checkout / ".env"
    settings = checkout / LOCAL / "config" / "settings.toml"

    check_prerequisites()
    move_old_layout(checkout)
    (checkout / LOCAL / "data" / "storage").mkdir(parents=True, exist_ok=True)
    settings.parent.mkdir(parents=True, exist_ok=True)
    project = repo.project(checkout)

    if env_file.is_file():
        ui_port, api_port, _ = repo.ports(checkout)
        ui.ok(f".env exists (UI:{ui_port}, API:{api_port})")
    else:
        slot = 0 if checkout == repo.root else repo.next_port_slot()
        template = (checkout / ".env.example").read_text()
        values = {
            "POSTGRES_PASSWORD": secrets.token_hex(32),
            "COMPOSE_PROJECT_NAME": project,
            "UI_PORT": str(BASE_UI_PORT + slot),
            "RUNESTONE_PORT": str(BASE_RUNESTONE_PORT + slot),
            "API_PORT": str(BASE_API_PORT + slot),
            "MCP_PORT": str(BASE_MCP_PORT + slot),
        }
        write_private(env_file, envfile.render_env(template, values))
        ui.ok(
            f".env (project {project}, UI:{values['UI_PORT']}, "
            f"Runestone:{values['RUNESTONE_PORT']}, API:{values['API_PORT']})"
        )

    if settings.is_file():
        ui.ok(f"{LOCAL}/config/settings.toml exists, leaving as is")
    else:
        template = (checkout / "server" / "settings_example.toml").read_text()
        rendered = envfile.render_settings(
            template,
            ui_port=repo.ports(checkout)[0],
            postgres_password=repo.env(checkout).get("POSTGRES_PASSWORD", ""),
            session_secret=secrets.token_hex(32),
            jwt_secret=secrets.token_hex(32),
            runestone_port=repo.runestone_port(checkout),
        )
        write_private(settings, rendered)
        ui.ok(f"{LOCAL}/config/settings.toml")
