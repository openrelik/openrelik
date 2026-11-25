"""Add partial index for non-terminal workflow tasks

Revision ID: a7c3e9f1b402
Revises: 9f4e2b8c1a73
Create Date: 2026-11-25 13:38:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c3e9f1b402"
down_revision: Union[str, None] = "9f4e2b8c1a73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NON_TERMINAL_PREDICATE = "status_short IS NULL OR status_short NOT IN ('SUCCESS', 'FAILURE', 'REVOKED', 'REJECTED')"


def upgrade() -> None:
    op.create_index(
        "ix_task_workflow_id_non_terminal",
        "task",
        ["workflow_id"],
        unique=False,
        postgresql_where=sa.text(_NON_TERMINAL_PREDICATE),
        sqlite_where=sa.text(_NON_TERMINAL_PREDICATE),
    )


def downgrade() -> None:
    op.drop_index("ix_task_workflow_id_non_terminal", table_name="task")
