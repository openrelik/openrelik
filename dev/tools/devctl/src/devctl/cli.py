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

"""The ./devctl command line."""

import click

from devctl import stacks, worktrees
from devctl.checkout import Repo

CONTEXT_SETTINGS = {"help_option_names": ["-h", "--help"], "max_content_width": 100}

pass_repo = click.make_pass_decorator(Repo)

worktree_option = click.option(
    "-w", "--worktree", metavar="<name>",
    help="Target worktree <name> instead of the checkout around the current directory.",
)


class AliasedGroup(click.Group):
    """A group whose commands can also be called by a short alias."""

    aliases = {"ls": "list", "rm": "remove"}

    def get_command(self, ctx: click.Context, cmd_name: str) -> click.Command | None:
        return super().get_command(ctx, self.aliases.get(cmd_name, cmd_name))

    def resolve_command(self, ctx: click.Context, args: list[str]):
        _, cmd, args = super().resolve_command(ctx, args)
        return cmd.name if cmd else None, cmd, args


class PassthroughCommand(click.Command):
    """A command whose arguments after -- are passed on to docker compose."""

    def parse_args(self, ctx: click.Context, args: list[str]) -> list[str]:
        if "--" in args:
            split = args.index("--")
            args, ctx.meta["passthrough"] = args[:split], args[split + 1 :]
        return super().parse_args(ctx, args)


@click.group(
    cls=AliasedGroup,
    context_settings=CONTEXT_SETTINGS,
    epilog="""\b
Examples:
  ./devctl stack up                    Start the main checkout's stack
  ./devctl stack restart server        Restart a service container
  ./devctl stack logs -f server        Follow logs for the server service
  ./devctl worktree create my-feature  Create worktree + start its isolated stack
  ./devctl worktree list               List all checkouts, ports, and stack states
  ./devctl worktree remove my-feature  Remove a merged worktree, its stack, and branch""",
)
@click.pass_context
def cli(ctx: click.Context) -> None:
    """Developer CLI for the OpenRelik monorepo."""
    ctx.obj = Repo.discover()


@cli.command()
@worktree_option
@pass_repo
def init(repo: Repo, worktree: str | None) -> None:
    """Initialize local config (.env, .dev-local/).

    Generate .env, .dev-local/config/settings.toml, and .dev-local/data/storage/
    for the current checkout or the specified worktree. Existing files are never
    overwritten; config/ and data/ from before .dev-local/ are moved there.
    """
    stacks.init(repo, worktree)


@cli.command()
@worktree_option
@pass_repo
def status(repo: Repo, worktree: str | None) -> None:
    """Show checkout and stack status.

    Show the git branch, uncommitted changes, and Docker Compose stack status for
    the current checkout or the specified worktree.
    """
    stacks.status(repo, worktree)


@cli.group(cls=AliasedGroup, short_help="Manage a checkout's Docker Compose stack.")
def stack() -> None:
    """Manage a checkout's Docker Compose stack (up, restart, down, logs, list).

    Each worktree has its own ports and database volume, so multiple stacks can
    run simultaneously.
    """


@stack.command(cls=PassthroughCommand, options_metavar="[options] [-- <compose up options>...]")
@worktree_option
@click.option("-a", "--attach", is_flag=True, help="Run in the foreground with logs, rebuilding on dependency changes.")
@click.option("-b", "--build", is_flag=True, help="Rebuild container images before starting.")
@click.option(
    "-p", "--profile", "profiles", multiple=True, metavar="<name>",
    help="Enable a Compose profile (repeatable, e.g. -p plaso).",
)
@click.pass_context
def up(
    ctx: click.Context, worktree: str | None, attach: bool, build: bool, profiles: tuple[str, ...]
) -> None:
    """Start the development stack.

    Start it in the background, or in the foreground with --attach. Initializes
    config on first run. Missing images are built.
    """
    passthrough = ctx.meta.get("passthrough", [])
    stacks.up(ctx.find_object(Repo), worktree, attach, build, profiles, passthrough)


@stack.command()
@worktree_option
@click.argument("services", nargs=-1, metavar="[<service>...]")
@pass_repo
def restart(repo: Repo, worktree: str | None, services: tuple[str, ...]) -> None:
    """Restart running containers without recreating them.

    Restarts all services in the stack, or only the specified services.
    """
    stacks.restart(repo, worktree, services)


@stack.command()
@worktree_option
@click.option("-v", "--volumes", is_flag=True, help="Also delete the stack's database volume (asks first).")
@click.option("-y", "--yes", "assume_yes", is_flag=True, help="Skip confirmation when deleting volumes.")
@pass_repo
def down(repo: Repo, worktree: str | None, volumes: bool, assume_yes: bool) -> None:
    """Stop the development stack.

    By default, the database volume is preserved.
    """
    stacks.down(repo, worktree, volumes, assume_yes)


@stack.command(
    context_settings={"ignore_unknown_options": True},
    options_metavar="[-w <worktree>] [<compose logs options>...]",
)
@worktree_option
@click.option("-f", "--follow", is_flag=True, help="Follow log output.")
@click.argument("compose_args", nargs=-1, type=click.UNPROCESSED, metavar="[<service>...]")
@pass_repo
def logs(repo: Repo, worktree: str | None, follow: bool, compose_args: tuple[str, ...]) -> None:
    """View or follow container logs.

    All other flags and service names are passed on to 'docker compose logs'.
    """
    stacks.logs(repo, worktree, ["--follow"] * follow + list(compose_args))


@stack.command(name="list")
@pass_repo
def stack_list(repo: Repo) -> None:
    """List all stacks, their status, services, and ports (alias: ls)."""
    stacks.list_stacks(repo)


@cli.group(cls=AliasedGroup, short_help="Manage git worktrees and their stacks.")
def worktree() -> None:
    """Manage isolated git worktrees and their stacks (create, sync, list, remove).

    Each worktree in .worktrees/<name>/ has its own .env, ports, .dev-local/,
    and Docker Compose stack. Branch code/<name> lives in .worktrees/<name>/;
    other branches use the branch name with / replaced by -.
    """


@worktree.command()
@click.argument("name", metavar="<name>")
@click.option("--from", "from_branch", metavar="<branch>", help="Base the new branch on <branch> instead of main.")
@click.option("--no-stack", is_flag=True, help="Initialize the worktree without starting its Docker stack.")
@pass_repo
def create(repo: Repo, name: str, from_branch: str | None, no_stack: bool) -> None:
    """Create a worktree and start its stack.

    Create or check out branch <name> in .worktrees/<name>/, allocate dedicated
    host ports (3001/8711, 3002/8712, ...), initialize its config, and start its
    stack. Run from inside a worktree, the new branch is based on that worktree's
    branch.
    """
    worktrees.create(repo, name, from_branch, no_stack)


@worktree.command()
@click.argument("name", metavar="[<name>]", required=False)
@pass_repo
def sync(repo: Repo, name: str | None) -> None:
    """Rebase a worktree branch onto its parent branch (or main).

    When run from the main checkout without <name>, pulls the latest changes from
    origin.
    """
    worktrees.sync(repo, name)


@worktree.command(name="list")
@pass_repo
def worktree_list(repo: Repo) -> None:
    """List all checkouts, branches, and stack ports (alias: ls).

    Show the main checkout and all worktrees with their branch, commits ahead of
    their parent branch (or main), local working tree status, stack state, UI
    port, and API port.
    """
    worktrees.list_worktrees(repo)


@worktree.command()
@click.argument("name", metavar="[<name>]", required=False)
@click.option("-f", "--force", is_flag=True, help="Remove even if the branch is unmerged or has uncommitted changes.")
@click.option("-r", "--remote", is_flag=True, help="With --force, also close any open PR and delete the remote branch.")
@click.option("-y", "--yes", "assume_yes", is_flag=True, help="Skip confirmation prompt.")
@pass_repo
def remove(repo: Repo, name: str | None, force: bool, remote: bool, assume_yes: bool) -> None:
    """Remove a worktree, its stack, and its branch (alias: rm).

    Remove a worktree, its Docker Compose stack (including database volume), and
    its git branch. When <name> is omitted, targets the current worktree
    directory.

    By default, refuses if the worktree has uncommitted changes or if the branch
    is not merged into main; a merged branch is also deleted on origin. Pass
    -f/--force to abandon an unmerged worktree.
    """
    worktrees.remove(repo, name, force, remote, assume_yes)


def main() -> None:
    cli(prog_name="devctl")
