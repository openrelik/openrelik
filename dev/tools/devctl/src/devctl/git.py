"""Git queries and operations on the repository and its checkouts."""

from pathlib import Path

from devctl import ui
from devctl.proc import attempt, capture, query, run


def current_branch(checkout: Path) -> str | None:
    return query("git", "-C", checkout, "symbolic-ref", "--quiet", "--short", "HEAD") or None


def changed_files(checkout: Path) -> int:
    return len(capture("git", "-C", checkout, "status", "--porcelain").splitlines())


def has_branch(root: Path, branch: str) -> bool:
    return bool(branch) and attempt(
        "git", "-C", root, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}", quiet=True
    )


def is_ancestor(root: Path, commit: str, of: str) -> bool:
    return attempt("git", "-C", root, "merge-base", "--is-ancestor", commit, of, quiet=True)


def count_commits(root: Path, base: str, branch: str) -> str | None:
    """The number of commits on branch that are not on base."""
    return query("git", "-C", root, "rev-list", "--count", f"{base}..{branch}")


def config_get(root: Path, key: str) -> str | None:
    return query("git", "-C", root, "config", "--get", key) or None


def config_set(root: Path, key: str, value: str) -> None:
    run("git", "-C", root, "config", key, value)


def config_unset(root: Path, key: str) -> None:
    attempt("git", "-C", root, "config", "--unset", key, quiet=True)


def worktrees(root: Path) -> list[tuple[Path, str]]:
    """Returns (path, branch) for every checkout, the main checkout first."""
    checkouts = []
    for block in capture("git", "-C", root, "worktree", "list", "--porcelain").split("\n\n"):
        path, branch = "", ""
        for line in block.splitlines():
            if line.startswith("worktree "):
                path = line.removeprefix("worktree ")
            elif line.startswith("branch "):
                branch = line.removeprefix("branch ").removeprefix("refs/heads/")
            elif line == "detached":
                branch = "(detached)"
        if path:
            checkouts.append((Path(path), branch))
    return checkouts


def has_origin(root: Path) -> bool:
    return attempt("git", "-C", root, "remote", "get-url", "origin", quiet=True)


def fetch_origin(root: Path) -> None:
    if not has_origin(root):
        return
    if not attempt("git", "-C", root, "fetch", "--quiet", "origin"):
        ui.warn("fetch failed, using last fetched state")
    attempt("git", "-C", root, "remote", "set-head", "origin", "--auto", quiet=True)


def remote_branch_exists(root: Path, branch: str) -> bool:
    return has_origin(root) and attempt(
        "git", "-C", root, "ls-remote", "--exit-code", "--heads", "origin", branch, quiet=True
    )


def base_ref(root: Path) -> str:
    """The branch new work starts from: origin's default branch, or local main when
    there is no origin or local main has commits not yet pushed."""
    remote_head = query(
        "git", "-C", root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"
    )
    if not remote_head or (has_branch(root, "main") and not is_ancestor(root, "main", remote_head)):
        return "main"
    return remote_head
