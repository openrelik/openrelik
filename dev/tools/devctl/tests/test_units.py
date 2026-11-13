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

from devctl import envfile, ui
from devctl.checkout import Repo, worktree_slug
from devctl.docker import summarize
from devctl.worktrees import TreeRow, tree


def test_read_env_last_value_wins(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# comment\nUI_PORT=3001\nEMPTY=\nUI_PORT=3002\nURL=http://x?a=b\n")
    assert envfile.read_env(env) == {"UI_PORT": "3002", "EMPTY": "", "URL": "http://x?a=b"}
    assert envfile.read_env(tmp_path / "missing") == {}


def test_render_env_replaces_only_given_keys():
    template = "A=1\nB=2\n# A=3\n"
    assert envfile.render_env(template, {"A": "x|&/"}) == "A=x|&/\nB=2\n# A=3\n"


def test_render_settings():
    template = (
        'ui_server_url = "old"\nallowed_origins = []\npassword = "<REPLACE_WITH_POSTGRES_PASSWORD>"\n'
        'allowlist = ["<REPLACE_WITH_USERNAME>@gmail.com"]\n'
    )
    rendered = envfile.render_settings(template, "3001", "pw&|\\1", "s", "j", runestone_port="3051")
    assert rendered == (
        'ui_server_url = "http://localhost:3001"\n'
        'allowed_origins = ["http://localhost:3001", "http://127.0.0.1:3001", '
        '"http://localhost:3051", "http://127.0.0.1:3051"]\n'
        'password = "pw&|\\1"\nallowlist = []\n'
    )


def test_worktree_slug():
    assert worktree_slug("code/case-tags") == "case-tags"
    assert worktree_slug("design/Case Tags") == "design-case-tags"


def test_next_port_slot_fills_gaps(tmp_path):
    repo = Repo(tmp_path)
    for name, port in (("a", "3001"), ("b", "3003"), ("c", "junk")):
        (repo.worktrees_dir / name).mkdir(parents=True)
        (repo.worktrees_dir / name / ".env").write_text(f"UI_PORT={port}\n")
    assert repo.next_port_slot() == 2


def test_label(tmp_path):
    repo = Repo(tmp_path)
    assert repo.label(tmp_path) == "main checkout"
    assert repo.label(tmp_path / ".worktrees" / "x") == ".worktrees/x"


def test_summarize_health():
    health = summarize([
        ("server", "running", "Up 2 minutes (healthy)"),
        ("migrate", "exited", "Exited (0) 1 minute ago"),
        ("redis", "running", "Up 1 minute (health: starting)"),
        ("postgres", "running", "Up 1 minute (unhealthy)"),
        ("worker", "exited", "Exited (1) 1 minute ago"),
    ])
    assert (health.up, health.total) == (2, 4)
    assert health.problems == ["postgres: running", "redis: starting", "worker: exited"]


def test_tree():
    rows = [
        TreeRow("main checkout", "main", "", ["-"]),
        TreeRow(".worktrees/a", "a", "", ["1"]),
        TreeRow(".worktrees/b", "b", "a", ["2"]),
        TreeRow(".worktrees/c", "c", "a", ["3"]),
        TreeRow(".worktrees/d", "d", "gone", ["4"]),
    ]
    assert [row[0] for row in tree(rows)] == [
        "main checkout",
        "├─> .worktrees/a",
        "│   ├─> .worktrees/b",
        "│   └─> .worktrees/c",
        "└─> .worktrees/d",
    ]


def test_tree_survives_duplicate_branches():
    rows = [TreeRow("main checkout", "(detached)", "", []), TreeRow("x", "(detached)", "", [])]
    assert len(tree(rows)) == 2


def test_table_counts_tree_characters_as_one_column():
    assert ui.table([["A", "B"], ["└─> x", "y"]]) == "A      B\n└─> x  y"
