"""GitHub CLI queries; all of them are optional and skipped without gh."""

import json
import shutil
from pathlib import Path

from devctl.proc import attempt, capture, query


def ready() -> bool:
    return shutil.which("gh") is not None and attempt("gh", "auth", "status", quiet=True)


def find_pr(root: Path, branch: str) -> tuple[int, str] | None:
    """The (number, state) of the newest PR from branch, if gh can tell."""
    if not ready():
        return None
    output = query(
        "gh", "pr", "list", "--head", branch, "--state", "all", "--json", "number,state", cwd=root
    )
    try:
        prs = json.loads(output or "[]")
    except json.JSONDecodeError:
        return None
    return (prs[0]["number"], prs[0]["state"]) if prs else None


def close_pr(root: Path, number: int, comment: str) -> None:
    capture("gh", "pr", "close", str(number), "--comment", comment, cwd=root)
