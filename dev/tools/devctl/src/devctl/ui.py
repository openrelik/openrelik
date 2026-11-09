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

"""Terminal output: status lines, errors, prompts, and tables."""

import sys
from typing import NoReturn

import click


def info(message: str) -> None:
    click.echo(f"{click.style('==>', fg='blue', bold=True)} {message}")


def ok(message: str) -> None:
    click.echo(f"{click.style('  ✓', fg='green', bold=True)} {message}")


def warn(message: str) -> None:
    click.echo(f"{click.style('  !', fg='yellow', bold=True)} {message}")


class DevError(click.ClickException):
    """An error that ends the command with a one-line message and exit status 1."""

    def show(self, file=None) -> None:
        click.echo(f"{click.style('error:', fg='red', bold=True)} {self.message}", err=True)


def die(message: str) -> NoReturn:
    raise DevError(message)


def confirm(prompt: str, assume_yes: bool = False) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        die("not a terminal; pass -y/--yes to confirm non-interactively")
    answer = click.prompt(f"{prompt} [y/N]", default="", show_default=False)
    return answer.lower() in ("y", "yes")


def table(rows: list[list[str]]) -> str:
    """Aligns rows into columns separated by two spaces."""
    widths = [max(len(row[col]) for row in rows) for col in range(len(rows[0]))]
    lines = []
    for row in rows:
        cells = [cell.ljust(width + 2) for cell, width in zip(row[:-1], widths)]
        lines.append("".join(cells) + row[-1])
    return "\n".join(lines)
