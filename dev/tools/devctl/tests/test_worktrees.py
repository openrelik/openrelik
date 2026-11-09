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

import os
import subprocess

from conftest import commit, git


def test_init_main_checkout(repo, dev):
    dev("init")
    env = (repo / ".env").read_text()
    assert "COMPOSE_PROJECT_NAME=openrelik-main" in env
    assert "UI_PORT=3000" in env
    assert oct((repo / ".env").stat().st_mode & 0o777) == "0o600"
    settings = (repo / ".dev-local" / "config" / "settings.toml").read_text()
    assert 'ui_server_url = "http://localhost:3000"' in settings
    assert "<REPLACE_WITH_POSTGRES_PASSWORD>" not in settings
    assert (repo / ".dev-local" / "data" / "storage").is_dir()
    assert "exists, leaving as is" in dev("init").output


def test_init_moves_config_and_data_from_before_dev_local(repo, dev):
    (repo / "config" / "prometheus").mkdir(parents=True)
    (repo / "config" / "settings.toml").write_text("kept")
    (repo / "data" / "storage").mkdir(parents=True)
    (repo / "data" / "storage" / "file").write_text("kept")
    dev("init")
    assert not (repo / "config").exists() and not (repo / "data").exists()
    assert (repo / ".dev-local" / "config" / "settings.toml").read_text() == "kept"
    assert (repo / ".dev-local" / "data" / "storage" / "file").read_text() == "kept"
    assert not (repo / ".dev-local" / "config" / "prometheus").exists()


def test_create_allocates_ports_and_records_parent(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    dev("worktree", "create", "b", "--from", "a", "--no-stack")
    assert "UI_PORT=3002" in (repo / ".worktrees" / "b" / ".env").read_text()
    assert "COMPOSE_PROJECT_NAME=openrelik-b" in (repo / ".worktrees" / "b" / ".env").read_text()
    assert git(repo, "config", "branch.b.devparent") == "a"

    output = dev("worktree", "list").output
    assert "└─> .worktrees/b" in output
    dev("worktree", "create", "a", "--no-stack", exit_code=1)


def test_create_from_inside_a_worktree_stacks_on_it(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    os.chdir(repo / ".worktrees" / "a")
    dev("worktree", "create", "b", "--no-stack")
    assert git(repo, "config", "branch.b.devparent") == "a"


def test_remove_merged_parent_reparents_child(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    dev("worktree", "create", "b", "--from", "a", "--no-stack")
    commit(repo / ".worktrees" / "a", "a.txt")
    git(repo / ".worktrees" / "b", "rebase", "--quiet", "a")
    commit(repo / ".worktrees" / "b", "b.txt")

    result = dev("worktree", "remove", "a", "-y", exit_code=1)
    assert "a is not merged into main" in result.output

    git(repo, "merge", "--quiet", "--ff-only", "a")
    output = dev("worktree", "remove", "a", "-y").output
    assert "re-parented b onto main" in output
    assert not (repo / ".worktrees" / "a").exists()
    assert not git(repo, "branch", "--list", "a")
    config = subprocess.run(["git", "-C", repo, "config", "--get-regexp", "^branch[.]b[.]dev"])
    assert config.returncode == 1  # neither devparent nor devbase is left
    assert git(repo, "rev-list", "--count", "main..b") == "1"


def test_sync_rebases_onto_parent(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    dev("worktree", "create", "b", "--from", "a", "--no-stack")
    commit(repo / ".worktrees" / "a", "a.txt")
    assert "b: 0 commit(s) ahead of a" in dev("worktree", "sync", "b").output
    assert (repo / ".worktrees" / "b" / "a.txt").is_file()


def test_force_remove_unmerged(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    dev("worktree", "create", "b", "--from", "a", "--no-stack")
    commit(repo / ".worktrees" / "a", "a.txt")

    result = dev("worktree", "remove", "-f", "-y", "a", exit_code=1)
    assert "has child worktree(s): b" in result.output

    output = dev("worktree", "rm", "-f", "-y", "b").output
    assert "recover with: git branch b" in output
    dev("worktree", "rm", "-f", "-y", "a")
    assert dev("worktree", "ls").output.splitlines()[1:] == [
        "main checkout  main    -        clean  stopped  3000  8710"
    ]


def test_status(repo, dev):
    dev("worktree", "create", "a", "--no-stack")
    commit(repo / ".worktrees" / "a", "a.txt")
    os.chdir(repo / ".worktrees" / "a")
    output = dev("status").output
    assert output.splitlines() == [
        "Checkout   .worktrees/a (a), clean, 1 ahead main",
        "Docker     not running; start Docker to see stack status",
    ]


def test_stack_up_needs_docker(repo, dev):
    assert "docker is not running" in dev("stack", "up", exit_code=1).output
    dev("stack", "up", "stray-argument", exit_code=2)


def test_stack_restart_needs_docker(repo, dev):
    assert "docker is not running" in dev("stack", "restart", exit_code=1).output


def test_removing_merged_design_moves_prototype_onto_main(repo, dev):
    """The flow in dev/README.md: the prototype is stacked on the design branch."""
    dev("worktree", "create", "design/x", "--no-stack")
    dev("worktree", "create", "prototype/x", "--from", "design/x", "--no-stack")
    design, prototype = repo / ".worktrees" / "design-x", repo / ".worktrees" / "prototype-x"
    commit(design, "design.md")
    git(prototype, "rebase", "--quiet", "design/x")
    commit(prototype, "prototype.py")

    git(repo, "merge", "--quiet", "--ff-only", "design/x")
    assert "re-parented prototype/x onto main" in dev("worktree", "remove", "design/x", "-y").output
    assert git(repo, "log", "--format=%s", "main..prototype/x") == "prototype.py"

    dev("worktree", "create", "design/x", "--no-stack")
    assert git(repo, "rev-parse", "design/x") == git(repo, "rev-parse", "main")
    dev("worktree", "create", "code/x", "--no-stack")
    assert (repo / ".worktrees" / "x").is_dir()
    dev("worktree", "remove", "-f", "-y", "prototype/x")
    dev("worktree", "remove", "x", "-y")
    assert not git(repo, "branch", "--list", "code/x")
