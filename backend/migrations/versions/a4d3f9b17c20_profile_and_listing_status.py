"""Add account profile fields and listing availability state."""

import sqlalchemy as sa
from alembic import op

revision = "a4d3f9b17c20"
down_revision = "c2a781d45e90"
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
            sa.CheckConstraint(
                "listing_status IN ('Available', 'Unavailable', 'Removed')",
                name="ck_jobs_listing_status",
            ),
            nullable=False,
            server_default="Available",
        ),
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM jobs")):
        raise RuntimeError(
            "The account and listing migration cannot be downgraded safely while jobs exist"
        )
    op.execute("ALTER TABLE jobs DROP COLUMN listing_status")
    op.drop_index("uq_auth_users_email", table_name="auth_users")
    op.drop_column("auth_users", "email")
    op.drop_column("auth_users", "display_name")
