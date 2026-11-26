"""Add file annotation and reply models

Revision ID: c8d4f2a91e05
Revises: a7c3e9f1b402
Create Date: 2026-11-25 20:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d4f2a91e05"
down_revision: Union[str, None] = "a7c3e9f1b402"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fileannotation",
        sa.Column("file_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("anchor_kind", sa.Unicode(length=16), nullable=False),
        sa.Column("range_start", sa.BigInteger(), nullable=False),
        sa.Column("range_end", sa.BigInteger(), nullable=False),
        sa.Column("range_start_col", sa.Integer(), nullable=True),
        sa.Column("range_end_col", sa.Integer(), nullable=True),
        sa.Column("body", sa.UnicodeText(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_purged", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.CheckConstraint(
            "anchor_kind IN ('line', 'row', 'offset')",
            name="ck_fileannotation_anchor_kind",
        ),
        sa.CheckConstraint(
            "range_end >= range_start",
            name="ck_fileannotation_range_order",
        ),
        sa.CheckConstraint(
            "(anchor_kind = 'offset' AND range_start >= 0) "
            "OR (anchor_kind IN ('line', 'row') AND range_start >= 1)",
            name="ck_fileannotation_range_lower_bound",
        ),
        sa.CheckConstraint(
            "(range_start_col IS NULL) = (range_end_col IS NULL)",
            name="ck_fileannotation_cols_paired",
        ),
        sa.CheckConstraint(
            "anchor_kind = 'line' OR range_start_col IS NULL",
            name="ck_fileannotation_cols_line_only",
        ),
        sa.CheckConstraint(
            "range_start_col IS NULL OR (range_start_col >= 1 AND range_end_col >= 1)",
            name="ck_fileannotation_cols_positive",
        ),
        sa.ForeignKeyConstraint(["file_id"], ["file.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_fileannotation_file_id", "fileannotation", ["file_id"], unique=False
    )
    op.create_index(
        "ix_fileannotation_user_id", "fileannotation", ["user_id"], unique=False
    )
    op.create_index(
        "ix_fileannotation_anchor_kind", "fileannotation", ["anchor_kind"], unique=False
    )
    op.create_index(
        "ix_fileannotation_file_id_active",
        "fileannotation",
        ["file_id", "anchor_kind", "range_start"],
        unique=False,
        postgresql_where=sa.text("NOT is_deleted"),
        sqlite_where=sa.text("NOT is_deleted"),
    )

    op.create_table(
        "fileannotationreply",
        sa.Column("annotation_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.UnicodeText(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_purged", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.ForeignKeyConstraint(["annotation_id"], ["fileannotation.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_fileannotationreply_annotation_id",
        "fileannotationreply",
        ["annotation_id"],
        unique=False,
    )
    op.create_index(
        "ix_fileannotationreply_user_id",
        "fileannotationreply",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_fileannotationreply_annotation_id_active",
        "fileannotationreply",
        ["annotation_id", "created_at"],
        unique=False,
        postgresql_where=sa.text("NOT is_deleted"),
        sqlite_where=sa.text("NOT is_deleted"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fileannotationreply_annotation_id_active", table_name="fileannotationreply"
    )
    op.drop_index("ix_fileannotationreply_user_id", table_name="fileannotationreply")
    op.drop_index(
        "ix_fileannotationreply_annotation_id", table_name="fileannotationreply"
    )
    op.drop_table("fileannotationreply")

    op.drop_index("ix_fileannotation_file_id_active", table_name="fileannotation")
    op.drop_index("ix_fileannotation_anchor_kind", table_name="fileannotation")
    op.drop_index("ix_fileannotation_user_id", table_name="fileannotation")
    op.drop_index("ix_fileannotation_file_id", table_name="fileannotation")
    op.drop_table("fileannotation")
