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

"""Docker and Docker Compose queries."""

import functools
from dataclasses import dataclass, field

from devctl.proc import attempt, query

PROJECT_LABEL = "com.docker.compose.project"
SERVICE_LABEL = "com.docker.compose.service"


@functools.cache
def ready() -> bool:
    return attempt("docker", "info", quiet=True)


def running_projects() -> set[str]:
    return set((query("docker", "compose", "ls", "--quiet") or "").split())


def stack_exists(project: str) -> bool:
    """Whether the project has containers (running or not) or volumes."""
    if not ready():
        return False
    if project in (query("docker", "compose", "ls", "--all", "--quiet") or "").split():
        return True
    return bool(
        query("docker", "volume", "ls", "--quiet", "--filter", f"label={PROJECT_LABEL}={project}")
    )


def port_holder(port: str) -> tuple[str, str] | None:
    """The (container, compose project) that publishes a host port, if any."""
    output = query(
        "docker", "ps", "--filter", f"publish={port}",
        "--format", f'{{{{.Names}}}}\t{{{{.Label "{PROJECT_LABEL}"}}}}',
    )
    if not output:
        return None
    name, _, project = output.splitlines()[0].partition("\t")
    return name, project


@dataclass
class Health:
    up: int = 0
    total: int = 0
    problems: list[str] = field(default_factory=list)


def summarize(containers: list[tuple[str, str, str]]) -> Health:
    """Rolls (service, state, status) rows up into a stack's health. A migrate
    container that exited cleanly has done its job and is not counted."""
    health = Health()
    for service, state, status in sorted(containers):
        if not service or (service == "migrate" and status.startswith("Exited (0)")):
            continue
        health.total += 1
        if state == "running" and "unhealthy" not in status:
            health.up += 1
            if "health: starting" in status:
                health.problems.append(f"{service}: starting")
        else:
            health.problems.append(f"{service}: {state}")
    return health


def stack_health(project: str) -> Health:
    output = query(
        "docker", "ps", "-a", "--filter", f"label={PROJECT_LABEL}={project}",
        "--format", f'{{{{.Label "{SERVICE_LABEL}"}}}}\t{{{{.State}}}}\t{{{{.Status}}}}',
    )
    rows = [line.split("\t") for line in (output or "").splitlines()]
    return summarize([(row + ["", ""])[:3] for row in rows])
