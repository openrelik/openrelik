"""Commands for worktrees: worktree create, sync, list, and remove.

Stacked worktrees record their parent branch in git config as
branch.<name>.devparent. When a parent is removed and a child could not be
rebased right away, branch.<name>.devbase holds the parent's old tip so that
`worktree sync` can rebase only the child's own commits.
"""

import os
import shutil
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import click

from devctl import docker, gh, git, stacks, ui
from devctl.checkout import LOCAL, Repo, init_checkout
from devctl.proc import attempt, capture, query, run


def devparent(branch: str) -> str:
    return f"branch.{branch}.devparent"


def devbase(branch: str) -> str:
    return f"branch.{branch}.devbase"


def children_of(repo: Repo, branch: str) -> list[str]:
    """The existing branches whose recorded parent is branch."""
    output = query("git", "-C", repo.root, "config", "--get-regexp", r"^branch\..*\.devparent$")
    children = []
    for line in (output or "").splitlines():
        key, _, parent = line.partition(" ")
        child = key.removeprefix("branch.").removesuffix(".devparent")
        if parent == branch and git.has_branch(repo.root, child):
            children.append(child)
    return children


def create(repo: Repo, name: str, from_branch: str | None, no_stack: bool) -> None:
    root = repo.root
    branch = name
    checkout = repo.worktree_dir(branch)
    label = repo.label(checkout)
    if not attempt("git", "check-ref-format", "--branch", branch, cwd=root, quiet=True):
        ui.die(f"invalid branch name: {branch}")
    if checkout.exists():
        ui.die(f"{label} already exists")
    if not from_branch:
        here = repo.resolve_checkout()
        if here != root:
            from_branch = git.current_branch(here)
    parent = None
    if from_branch:
        parent = from_branch if git.has_branch(root, from_branch) else f"code/{from_branch}"
        if not git.has_branch(root, parent):
            ui.die(f"parent branch '{from_branch}' does not exist")
        if git.has_branch(root, branch):
            ui.die(f"branch '{branch}' already exists; --from only works for a new branch")

    ui.info(f"Creating worktree for {branch}")
    add = ["git", "-C", root, "worktree", "add", "--quiet"]
    if parent:
        run(*add, "--no-track", "-b", branch, checkout, parent)
        git.config_set(root, devparent(branch), parent)
        ui.ok(f"{label} (new branch from {parent})")
    elif git.has_branch(root, branch):
        run(*add, checkout, branch)
        ui.ok(f"{label} (existing branch)")
    else:
        git.fetch_origin(root)
        if attempt("git", "-C", root, "show-ref", "--verify", "--quiet", f"refs/remotes/origin/{branch}"):
            run(*add, "--track", "-b", branch, checkout, f"origin/{branch}")
            ui.ok(f"{label} (tracking origin/{branch})")
        else:
            base = git.base_ref(root)
            run(*add, "--no-track", "-b", branch, checkout, base)
            ui.ok(f"{label} (new branch from {base})")
    init_checkout(repo, checkout)

    if no_stack:
        click.echo(f"\n  Work in {label}/. Start its stack with:")
        click.echo(f"    ./devctl stack up -w {checkout.name}")
        return

    stacks.up(repo, checkout.name)
    click.echo(f"  Dir:     cd {label}")


def sync(repo: Repo, name: str | None) -> None:
    root = repo.root
    checkout = repo.resolve_checkout(name)
    if checkout == root:
        branch = git.current_branch(root) or "main"
        ui.info(f"Pulling latest changes for main checkout ({branch})")
        run("git", "-C", root, "pull", "--rebase")
        ui.ok(f"main checkout ({branch}) is up to date")
        return

    label = repo.label(checkout)
    branch = git.current_branch(checkout)
    if not branch:
        ui.die(f"{label} is in detached HEAD state")
    if capture("git", "-C", checkout, "status", "--porcelain", "--untracked-files=no"):
        ui.die(f"{label} has uncommitted changes; commit or stash them first")

    git.fetch_origin(root)
    parent = git.config_get(root, devparent(branch))
    if parent and git.has_branch(root, parent):
        target = parent
    else:
        if parent:
            git.config_unset(root, devparent(branch))
        target = git.base_ref(root)

    old_base = git.config_get(root, devbase(branch))
    conflicts = f"rebase stopped on conflicts; resolve them in {label} and run: git rebase --continue"
    ui.info(f"Rebasing {branch} onto {target}")
    if old_base:
        if not attempt("git", "-C", checkout, "rebase", "--quiet", "--onto", target, old_base, branch):
            ui.die(conflicts)
        git.config_unset(root, devbase(branch))
    elif not attempt("git", "-C", checkout, "rebase", "--quiet", target):
        ui.die(conflicts)

    ui.ok(f"{branch}: {git.count_commits(root, target, branch)} commit(s) ahead of {target}")
    if attempt(
        "git", "-C", checkout, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}",
        quiet=True,
    ):
        click.echo("  Update its remote branch with: git push --force-with-lease")


@dataclass
class TreeRow:
    label: str
    branch: str
    parent: str
    cells: list[str]


def tree(rows: list[TreeRow]) -> list[list[str]]:
    """Draws rows as a tree of parent branches below the first row. A row whose
    parent is not among the rows hangs below the first row."""
    if not rows:
        return []
    known = {row.branch for row in rows}
    kids: dict[str, list[TreeRow]] = defaultdict(list)
    for row in rows[1:]:
        kids[row.parent if row.parent in known else rows[0].branch].append(row)

    lines: list[list[str]] = []
    seen: set[int] = set()

    def walk(row: TreeRow, prefix: str, arrow: str, child_prefix: str) -> None:
        seen.add(id(row))
        lines.append([prefix + arrow + row.label, row.branch, *row.cells])
        children = [kid for kid in kids[row.branch] if id(kid) not in seen]
        for k, kid in enumerate(children):
            last = k == len(children) - 1
            walk(kid, child_prefix, "└─> " if last else "├─> ", child_prefix + ("    " if last else "│   "))

    walk(rows[0], "", "", "")
    return lines


def list_worktrees(repo: Repo) -> None:
    root = repo.root
    running = docker.running_projects() if docker.ready() else set()
    base = git.base_ref(root)
    rows = []
    for path, branch in repo.checkouts():
        parent, commits = "", "-"
        if path != root:
            parent = git.config_get(root, devparent(branch)) or ""
            if not git.has_branch(root, parent):
                parent = ""
            count_base = git.config_get(root, devbase(branch)) or parent or base
            commits = git.count_commits(root, count_base, branch) or "?"
        changes = git.changed_files(path)
        stack = "running" if repo.project(path) in running else "stopped"
        ui_port, api_port, _ = repo.ports(path)
        cells = [commits, f"{changes} changed" if changes else "clean", stack, ui_port, api_port]
        rows.append(TreeRow(repo.label(path), branch, parent, cells))
    header = ["CHECKOUT", "BRANCH", "COMMITS", "LOCAL", "STACK", "UI", "API"]
    click.echo(ui.table([header, *tree(rows)]))


def remove_stack(project: str, checkout: Path) -> None:
    if not docker.stack_exists(project):
        return
    if not attempt(
        "docker", "compose", "--profile", "*", "--project-name", project,
        "down", "--volumes", "--rmi", "local", "--remove-orphans",
        cwd=checkout, quiet=True,
    ):
        ui.warn(f"could not remove stack {project}: docker compose -p {project} down -v --rmi local")
        return
    ui.ok(f"removed stack {project} and its database")


def remove_checkout(repo: Repo, checkout: Path, force: bool) -> None:
    remove_stack(repo.project(checkout), checkout)
    shutil.rmtree(checkout / LOCAL, ignore_errors=True)
    (checkout / ".env").unlink(missing_ok=True)
    run("git", "-C", repo.root, "worktree", "remove", *(["--force"] if force else []), checkout)
    ui.ok(f"removed worktree {repo.label(checkout)}")


def remove(repo: Repo, name: str | None, force: bool, remote: bool, assume_yes: bool) -> None:
    root = repo.root
    checkout = repo.resolve_checkout(name)
    if checkout == root:
        ui.die("not inside a worktree; pass a worktree name (see: ./devctl worktree list)")
    label = repo.label(checkout)
    branch = git.current_branch(checkout)
    if not branch:
        ui.die(f"{label} is in detached HEAD state")
    # The current directory may be the worktree that is about to be removed.
    os.chdir(root)

    children = children_of(repo, branch)
    if force:
        remove_abandoned(repo, checkout, branch, children, remote, assume_yes)
    else:
        remove_merged(repo, checkout, branch, children, assume_yes)


def remove_merged(
    repo: Repo, checkout: Path, branch: str, children: list[str], assume_yes: bool
) -> None:
    """Removes a merged branch and re-parents its children onto what it was merged into."""
    root = repo.root
    if git.changed_files(checkout):
        ui.die(f"{repo.label(checkout)} has uncommitted changes; commit or discard them, or pass --force")

    git.fetch_origin(root)
    base = git.base_ref(root)
    grandparent = git.config_get(root, devparent(branch)) or ""
    if not git.has_branch(root, grandparent):
        grandparent = ""
    merged_into_base = git.is_ancestor(root, branch, base)
    if not merged_into_base and not (grandparent and git.is_ancestor(root, branch, grandparent)):
        pr = gh.find_pr(root, branch)
        if not pr or pr[1] != "MERGED":
            ui.die(f"{branch} is not merged into {grandparent or base} (pass --force to abandon unmerged work)")

    parent_tip = capture("git", "-C", root, "rev-parse", branch)
    new_parent = grandparent if grandparent and not merged_into_base else ""
    rebase_target = new_parent or base

    ui.info(f"Removing merged worktree {branch} (worktree, stack, database, and branch)")
    if children:
        click.echo(f"  Child worktree(s) ({', '.join(children)}) will be re-parented onto {rebase_target}.")
    if not ui.confirm(f"Remove {branch}?", assume_yes):
        ui.die("aborted, nothing changed")
    remove_checkout(repo, checkout, force=False)
    run("git", "-C", root, "branch", "--quiet", "-D", branch)
    if git.remote_branch_exists(root, branch):
        run("git", "-C", root, "push", "--quiet", "origin", "--delete", branch)
        ui.ok(f"deleted {branch} locally and on origin")
    else:
        ui.ok(f"deleted {branch}")

    for child in children:
        if new_parent:
            git.config_set(root, devparent(child), new_parent)
        else:
            git.config_unset(root, devparent(child))
        git.config_set(root, devbase(child), parent_tip)
        child_dir = repo.checkout_of_branch(child)
        if not child_dir or git.changed_files(child_dir):
            ui.warn(
                f"{child} has uncommitted changes; re-parented to {rebase_target} "
                f"(run './devctl worktree sync {child}' when ready)"
            )
        elif attempt(
            "git", "-C", child_dir, "rebase", "--quiet", "--onto", rebase_target, parent_tip, child,
            quiet=True,
        ):
            git.config_unset(root, devbase(child))
            ui.ok(f"re-parented {child} onto {rebase_target}")
        else:
            attempt("git", "-C", child_dir, "rebase", "--abort", quiet=True)
            ui.warn(f"could not auto-rebase {child} onto {rebase_target}; run: ./devctl worktree sync {child}")


def remove_abandoned(
    repo: Repo, checkout: Path, branch: str, children: list[str], remote: bool, assume_yes: bool
) -> None:
    """Removes an unmerged branch, and with remote also its PR and remote branch."""
    root = repo.root
    if children:
        ui.die(f"worktree '{branch}' has child worktree(s): {', '.join(children)}. Remove them first.")
    if remote and not gh.ready():
        ui.die("--remote requires the GitHub CLI: gh auth login")

    commits = git.count_commits(root, git.base_ref(root), branch)
    changes = git.changed_files(checkout)
    pr = gh.find_pr(root, branch)
    project = repo.project(checkout)
    pr_note = f", PR #{pr[0]} ({pr[1]})" if pr else ""
    ui.info(f"Force-removing {branch}: {commits} commit(s), {changes} uncommitted change(s){pr_note}")
    if docker.stack_exists(project):
        click.echo(f"  Its stack {project} (including database) will also be deleted.")

    if not ui.confirm(f"Remove {branch}? This cannot be undone.", assume_yes):
        ui.die("aborted, nothing changed")

    remove_checkout(repo, checkout, force=True)
    sha = capture("git", "-C", root, "rev-parse", "--short", branch)
    run("git", "-C", root, "branch", "--quiet", "-D", branch)
    ui.ok(f"deleted {branch} (was {sha}); recover with: git branch {branch} {sha}")

    open_pr = pr[0] if pr and pr[1] in ("OPEN", "DRAFT") else None
    if remote:
        if open_pr:
            gh.close_pr(root, open_pr, "Closed: worktree removed.")
            ui.ok(f"closed PR #{open_pr}")
        if git.remote_branch_exists(root, branch):
            run("git", "-C", root, "push", "--quiet", "origin", "--delete", branch)
            ui.ok(f"deleted {branch} on origin")
    else:
        if open_pr:
            ui.warn(f"PR #{open_pr} is still open: gh pr close {open_pr}")
        if git.remote_branch_exists(root, branch):
            ui.warn(f"{branch} still exists on origin: git push origin --delete {branch}")
