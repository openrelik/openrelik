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

import subprocess

import pytest
from conftest import git

from devctl import release


@pytest.fixture
def release_env(repo, monkeypatch, tmp_path):
    bin_dir = tmp_path / "extra_bin"
    bin_dir.mkdir()
    uv_stub = bin_dir / "uv"
    uv_stub.write_text("#!/bin/sh\ntouch uv.lock\nexit 0\n")
    uv_stub.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{subprocess.os.environ['PATH']}")

    scripts_dir = repo / ".github" / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    check_script = scripts_dir / "check-versions.py"
    check_script.write_text("#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n")
    check_script.chmod(0o755)
    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup release env stubs")
    return repo


def test_parse_version():
    assert release.parse_version("0.19.0") == (0, 19, 0)
    assert release.parse_version("1.2.3") == (1, 2, 3)
    with pytest.raises(Exception):
        release.parse_version("0.19")
    with pytest.raises(Exception):
        release.parse_version("v0.19.0")


def test_dev_release_py_does_not_exist(repo):
    assert not (repo / "dev" / "release.py").exists()


def test_worktree_must_be_clean(repo, dev):
    (repo / "untracked.txt").write_text("hello")
    res = dev("release", "ui", "0.18.1", exit_code=1)
    assert "the worktree isn't clean" in res.output


def test_version_check_gate_failure_reverts(release_env, dev):
    repo = release_env
    (repo / "web" / "sunstone").mkdir(parents=True, exist_ok=True)
    pkg = repo / "web" / "sunstone" / "package.json"
    pkg.write_text('{\n  "name": "sunstone",\n  "version": "0.18.0"\n}\n')
    git(repo, "add", ".")
    git(repo, "commit", "-m", "add sunstone")

    check_script = repo / ".github" / "scripts" / "check-versions.py"
    check_script.write_text("#!/usr/bin/env python3\nimport sys\nsys.exit(1)\n")
    git(repo, "commit", "-am", "make check script fail")

    res = dev("release", "ui", "0.18.1", exit_code=1)
    assert ".github/scripts/check-versions.py failed; the changes are reverted" in res.output
    assert '"version": "0.18.0"' in pkg.read_text()


def test_release_ui_success(release_env, dev):
    repo = release_env
    (repo / "web" / "sunstone").mkdir(parents=True, exist_ok=True)
    pkg = repo / "web" / "sunstone" / "package.json"
    pkg.write_text('{\n  "name": "sunstone",\n  "version": "0.18.0"\n}\n')
    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup for ui release")

    res = dev("release", "ui", "0.18.1")
    assert "committed: Release the UI 0.18.1" in res.output
    assert "not tagged: on a branch for a pull request (ui-v0.18.1)" in res.output
    assert '"version": "0.18.1"' in pkg.read_text()

    tag_res = dev("release", "tag", "HEAD")
    assert "tagged" in tag_res.output
    assert "ui-v0.18.1" in tag_res.output
    assert git(repo, "tag", "--list", "ui-v0.18.1") == "ui-v0.18.1"


def test_release_server(release_env, dev):
    repo = release_env
    pyproject = repo / "server" / "pyproject.toml"
    pyproject.write_text('[project]\nname = "openrelik-server"\nversion = "0.18.0"\n')
    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup server")

    git(repo, "checkout", "-b", "release/0.18")
    dev("release", "server", "0.18.1")
    assert 'version = "0.18.1"' in pyproject.read_text()
    assert git(repo, "tag", "--list", "server-v0.18.1") == "server-v0.18.1"


def test_release_mcp(release_env, dev):
    repo = release_env
    mcp_dir = repo / "mcp"
    mcp_dir.mkdir(parents=True, exist_ok=True)
    pyproject = mcp_dir / "pyproject.toml"
    pyproject.write_text('[project]\nname = "openrelik-mcp"\nversion = "0.18.0"\n')
    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup mcp")

    git(repo, "checkout", "-b", "release/0.18")
    dev("release", "mcp", "0.18.1")
    assert 'version = "0.18.1"' in pyproject.read_text()
    assert git(repo, "tag", "--list", "mcp-v0.18.1") == "mcp-v0.18.1"


def test_release_lib_and_worker(release_env, dev):
    repo = release_env
    lib_dir = repo / "libs" / "common"
    lib_dir.mkdir(parents=True)
    (lib_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-common"\nversion = "0.18.0"\n')

    worker_dir = repo / "workers" / "yara"
    worker_dir.mkdir(parents=True)
    (worker_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-worker-yara"\nversion = "0.18.0"\n')

    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup lib and worker")

    git(repo, "checkout", "-b", "release/0.18")
    dev("release", "lib", "common", "0.18.1")
    assert 'version = "0.18.1"' in (lib_dir / "pyproject.toml").read_text()
    assert git(repo, "tag", "--list", "common-v0.18.1") == "common-v0.18.1"

    dev("release", "worker", "yara", "0.18.2")
    assert 'version = "0.18.2"' in (worker_dir / "pyproject.toml").read_text()
    assert git(repo, "tag", "--list", "worker-yara-v0.18.2") == "worker-yara-v0.18.2"


def test_release_platform(release_env, dev):
    repo = release_env
    (repo / "VERSION").write_text("0.18.0\n")
    (repo / "server" / "pyproject.toml").write_text('[project]\nname = "openrelik-server"\nversion = "0.18.0"\n')

    mcp_dir = repo / "mcp"
    mcp_dir.mkdir(parents=True, exist_ok=True)
    (mcp_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-mcp"\nversion = "0.18.0"\n')

    ui_dir = repo / "web" / "sunstone"
    ui_dir.mkdir(parents=True, exist_ok=True)
    (ui_dir / "package.json").write_text('{"name": "sunstone", "version": "0.18.0"}')

    deploy_dir = repo / "deploy" / "docker"
    deploy_dir.mkdir(parents=True, exist_ok=True)
    (deploy_dir / "config.env").write_text("OPENRELIK_VERSION=latest\n")
    (deploy_dir / "install.sh").write_text('RELEASES=("0.18")\n')

    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup for platform release")

    git(repo, "checkout", "-b", "release/0.19")
    dev("release", "platform", "0.19.0")
    assert (repo / "VERSION").read_text().strip() == "0.19.0"
    assert 'version = "0.19.0"' in (repo / "server" / "pyproject.toml").read_text()
    assert "OPENRELIK_VERSION=0.19" in (deploy_dir / "config.env").read_text()
    assert 'RELEASES=("0.19" "0.18")' in (deploy_dir / "install.sh").read_text()
    assert git(repo, "tag", "--list", "v0.19.0") == "v0.19.0"
    assert git(repo, "tag", "--list", "server-v0.19.0") == "server-v0.19.0"


def test_start_development(release_env, dev):
    repo = release_env
    (repo / "VERSION").write_text("0.18.0\n")
    server_dir = repo / "server"
    (server_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-server"\nversion = "0.18.0"\n')

    mcp_dir = repo / "mcp"
    mcp_dir.mkdir(parents=True, exist_ok=True)
    (mcp_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-mcp"\nversion = "0.18.0"\n')

    install_sh = repo / "deploy" / "docker" / "install.sh"
    install_sh.parent.mkdir(parents=True, exist_ok=True)
    install_sh.write_text('RELEASES=("0.17")\n')

    git(repo, "add", ".")
    git(repo, "commit", "-m", "setup for dev")
    git(repo, "tag", "v0.18.0")

    dev("release", "dev", "0.19.0")
    assert (repo / "VERSION").read_text().strip() == "0.19.0.dev0"
    assert 'version = "0.19.0.dev0"' in (server_dir / "pyproject.toml").read_text()
    assert 'RELEASES=("0.18" "0.17")' in install_sh.read_text()


def test_release_in_worktree(release_env, dev, monkeypatch):
    repo = release_env
    dev("worktree", "create", "patch-worker", "--no-stack")
    wt_dir = repo / ".worktrees" / "patch-worker"

    worker_dir = wt_dir / "workers" / "yara"
    worker_dir.mkdir(parents=True, exist_ok=True)
    (worker_dir / "pyproject.toml").write_text('[project]\nname = "openrelik-worker-yara"\nversion = "0.18.0"\n')
    git(wt_dir, "add", ".")
    git(wt_dir, "commit", "-m", "setup worker in worktree")

    monkeypatch.chdir(wt_dir)
    dev("release", "worker", "yara", "0.18.1")

    assert 'version = "0.18.1"' in (worker_dir / "pyproject.toml").read_text()
    assert not (repo / "workers" / "yara").exists()
