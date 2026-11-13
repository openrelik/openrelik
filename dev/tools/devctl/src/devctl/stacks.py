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

"""Commands for a checkout's Docker Compose stack: init, status, and stack *."""

from pathlib import Path

import click

from devctl import docker, git, ui
from devctl.checkout import Repo, init_checkout, move_old_layout
from devctl.proc import attempt, capture, replace_process, run

STATUS_LABEL_WIDTH = 11


def init(repo: Repo, worktree: str | None) -> None:
    checkout = repo.resolve_checkout(worktree)
    ui.info(f"Initializing {repo.label(checkout)}")
    init_checkout(repo, checkout)


def stack_urls(repo: Repo, checkout: Path, indent: str = "  ") -> str:
    env = repo.env(checkout)
    ui_port, api_port, _ = repo.ports(checkout)
    runestone_port = repo.runestone_port(checkout)
    user = env.get("OPENRELIK_DEV_USER") or "dev"
    password = env.get("OPENRELIK_DEV_PASSWORD") or "dev"
    return (
        f"{indent}UI:        http://localhost:{ui_port}  (log in as {user} / {password})\n"
        f"{indent}Runestone: http://localhost:{runestone_port}\n"
        f"{indent}API:       http://localhost:{api_port}/api/v1/docs"
    )


def up(
    repo: Repo,
    worktree: str | None,
    attach: bool = False,
    build: bool = False,
    profiles: tuple[str, ...] = (),
    compose_args: list[str] | None = None,
) -> None:
    checkout = repo.resolve_checkout(worktree)
    label = repo.label(checkout)
    if not docker.ready():
        ui.die("docker is not running")

    if not (checkout / ".env").is_file():
        ui.info(f"Initializing {label}")
        init_checkout(repo, checkout)
    else:
        move_old_layout(checkout)
    project = repo.project(checkout)

    env = repo.env(checkout)
    for port in (env.get("UI_PORT"), env.get("RUNESTONE_PORT"), env.get("API_PORT"), env.get("MCP_PORT")):
        holder = docker.port_holder(port) if port else None
        if holder and holder[1] != project:
            name, holder_project = holder
            ui.die(
                f"port {port} is already in use by container '{name}' "
                f"(project '{holder_project or 'unknown'}'); "
                f"stop it with: docker compose -p {holder_project or 'openrelik'} down"
            )

    compose = ["docker", "compose"]
    for profile in profiles:
        compose += ["--profile", profile]
    up_args = ["--remove-orphans", *(["--build"] if build else []), *(compose_args or [])]

    if attach:
        ui.info(f"Starting {project} ({label}) in the foreground")
        replace_process(*compose, "up", "--watch", *up_args, cwd=checkout)

    ui.info(f"Starting {project} ({label})")
    run(*compose, "up", "--detach", "--wait", *up_args, cwd=checkout)
    ui.ok("running in the background")
    click.echo(stack_urls(repo, checkout))
    wt_flag = f" -w {worktree}" if worktree else ""
    click.echo(f"  Logs:    ./devctl stack logs{wt_flag} -f")
    click.echo(f"  Stop:    ./devctl stack down{wt_flag}")


def restart(repo: Repo, worktree: str | None, services: tuple[str, ...]) -> None:
    checkout = repo.resolve_checkout(worktree)
    label = repo.label(checkout)
    if not docker.ready():
        ui.die("docker is not running")
    if not (checkout / ".env").is_file():
        ui.die(f"{label} is not initialized; start it with: ./devctl stack up")
    project = repo.project(checkout)
    target = f"{', '.join(services)} in {project}" if services else project
    ui.info(f"Restarting {target} ({label})")
    run("docker", "compose", "--profile", "*", "restart", *services, cwd=checkout)
    ui.ok(f"restarted {target}")


def down(repo: Repo, worktree: str | None, volumes: bool, assume_yes: bool) -> None:
    checkout = repo.resolve_checkout(worktree)
    label = repo.label(checkout)
    if not (checkout / ".env").is_file():
        ui.die(f"{label} is not initialized; nothing to stop")
    project = repo.project(checkout)

    compose_down = ["docker", "compose", "--profile", "*", "--project-name", project, "down"]
    if volumes:
        if not ui.confirm(f"Delete the database volume of {project} ({label})?", assume_yes):
            ui.die("aborted, nothing changed")
        run(*compose_down, "--volumes", "--remove-orphans", cwd=checkout)
        ui.ok(f"stopped {project} and deleted its database")
    else:
        run(*compose_down, "--remove-orphans", cwd=checkout)
        ui.ok(f"stopped {project} ({label}); its database is kept")


def logs(repo: Repo, worktree: str | None, compose_args: list[str]) -> None:
    checkout = repo.resolve_checkout(worktree)
    if not (checkout / ".env").is_file():
        ui.die(f"{repo.label(checkout)} is not initialized; start it with: ./devctl stack up")
    replace_process("docker", "compose", "--profile", "*", "logs", *compose_args, cwd=checkout)


def list_stacks(repo: Repo) -> None:
    has_docker = docker.ready()
    rows = [["STACK", "CHECKOUT", "STATUS", "SERVICES", "UI", "API", "MCP"]]
    for path, _ in repo.checkouts():
        project = repo.project(path)
        status, services = "stopped", "-"
        if not (path / ".env").is_file():
            status = "uninitialized"
        elif not has_docker:
            status = "docker down"
        else:
            health = docker.stack_health(project)
            if health.total:
                services = f"{health.up}/{health.total} up"
                if health.up == health.total:
                    status = "running"
                elif health.up:
                    status = "degraded"
        rows.append([project, repo.label(path), status, services, *repo.ports(path)])
    click.echo(ui.table(rows))


def status(repo: Repo, worktree: str | None) -> None:
    def row(label: str, text: str) -> None:
        click.echo(f"{label:<{STATUS_LABEL_WIDTH}}{text}")

    checkout = repo.resolve_checkout(worktree)
    branch = git.current_branch(checkout) or "detached"
    changes = git.changed_files(checkout)
    line = f"{repo.label(checkout)} ({branch})"
    line += f", {changes} uncommitted change(s)" if changes else ", clean"
    base = git.base_ref(repo.root)
    if branch != base and attempt(
        "git", "-C", checkout, "rev-parse", "--quiet", "--verify", base, quiet=True
    ):
        counts = capture("git", "-C", checkout, "rev-list", "--left-right", "--count", f"HEAD...{base}")
        ahead, behind = (int(n) for n in counts.split())
        if not ahead and not behind:
            line += f", up to date with {base}"
        else:
            line += f", {ahead} ahead" if ahead else ""
            line += f", {behind} behind" if behind else ""
            line += f" {base}"
    row("Checkout", line)

    if not (checkout / ".env").is_file():
        row("Stack", "not initialized (./devctl stack up initializes and starts it)")
        return
    if not docker.ready():
        row("Docker", "not running; start Docker to see stack status")
        return

    project = repo.project(checkout)
    ui_port = repo.ports(checkout)[0]
    health = docker.stack_health(project)
    if not health.total:
        row("Stack", f"{project}: not running (UI port {ui_port})")
    elif not health.up:
        row("Stack", f"{project}: stopped (./devctl stack up starts it on port {ui_port})")
    else:
        row("Stack", f"{project}: running ({health.up}/{health.total} services up)")
        if health.problems:
            row("", f"problems: {', '.join(health.problems)}")
        click.echo(stack_urls(repo, checkout, indent=" " * STATUS_LABEL_WIDTH))
