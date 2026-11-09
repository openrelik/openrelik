# Contributing to OpenRelik

OpenRelik welcomes contributions. We follow a lightweight development process where
developers make the decisions, and coding agents help with research, prototypes,
documents, code, and review.

## Development process

The complete development lifecycle, guidelines, and conventions are documented in
[dev/README.md](dev/README.md):

- **Ideas**: Start by filing an issue labeled `idea` (or private drafting in `.private/<slug>/`).
- **Development stack**: Run the local stack from source with `./devctl stack up`.
- **Worktrees**: Prototype and build features in isolated git worktrees with `./devctl worktree create`.
- **Code reviews**: Changes undergo clean-context review rounds before opening a pull request.
- **Approval gates**: Every PR requires human approval before merge.

For component-specific development guides and conventions, see:
- `server/AGENTS.md` (API, mediator, metrics, migrations)
- `web/sunstone/AGENTS.md` (web UI, codename sunstone)
- `workers/AGENTS.md` (task workers)
- `AGENTS.md` (monorepo overview and agent instructions)
