"""Add partial indexes for active folder item counts

Revision ID: 9f4e2b8c1a73
Revises: 3c1e5a7d9b20
Create Date: 2026-11-20 21:36:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9f4e2b8c1a73"
down_revision: Union[str, None] = "3c1e5a7d9b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_file_folder_id_active",
        "file",
        ["folder_id"],
        unique=False,
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "ix_folder_parent_id_active",
        "folder",
        ["parent_id"],
        unique=False,
        postgresql_where=sa.text("NOT is_deleted"),
    )


def downgrade() -> None:
    op.drop_index("ix_folder_parent_id_active", table_name="folder")
    op.drop_index("ix_file_folder_id_active", table_name="file")
