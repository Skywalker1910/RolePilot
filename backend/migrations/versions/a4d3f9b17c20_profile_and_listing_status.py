"""Add account profile fields and listing availability state."""

import sqlalchemy as sa
from alembic import op

revision = "a4d3f9b17c20"
down_revision = "f347a18c2c10"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_users", sa.Column("display_name", sa.String(120), nullable=True))
    op.add_column("auth_users", sa.Column("email", sa.String(254), nullable=True))
    op.create_index("uq_auth_users_email", "auth_users", ["email"], unique=True)
    op.add_column(
        "jobs",
        sa.Column(
            "listing_status",
            sa.String(24),
            nullable=False,
            server_default="Available",
        ),
    )
    with op.batch_alter_table("jobs") as batch:
        batch.create_check_constraint(
            "ck_jobs_listing_status",
            "listing_status IN ('Available', 'Unavailable', 'Removed')",
        )


def downgrade():
    with op.batch_alter_table("jobs") as batch:
        batch.drop_constraint("ck_jobs_listing_status", type_="check")
        batch.drop_column("listing_status")
    op.drop_index("uq_auth_users_email", table_name="auth_users")
    op.drop_column("auth_users", "email")
    op.drop_column("auth_users", "display_name")
