"""Add opt-in single-user authentication tables."""

import sqlalchemy as sa
from alembic import op

revision = "6e3d3b7b9a12"
down_revision = "f347a18c2c10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auth_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(120), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(300), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("password_changed_at", sa.String(40), nullable=False),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("auth_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])


def downgrade():
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("auth_users")
