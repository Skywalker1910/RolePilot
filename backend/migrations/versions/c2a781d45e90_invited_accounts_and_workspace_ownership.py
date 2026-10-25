"""Add invitation based accounts and per-user workspace ownership."""

import sqlalchemy as sa
from alembic import op

revision = "c2a781d45e90"
down_revision = "6e3d3b7b9a12"
branch_labels = None
depends_on = None

OWNED_TABLES = (
    "companies",
    "jobs",
    "job_provenance",
    "import_batches",
    "import_previews",
    "activity_events",
    "applications",
    "application_status_history",
    "application_tasks",
    "document_libraries",
    "documents",
    "document_revisions",
)


def upgrade():
    op.add_column(
        "auth_users",
        sa.Column("role", sa.String(20), nullable=False, server_default="user"),
    )
    op.add_column(
        "auth_users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE auth_users SET role = 'admin'"))

    op.create_table(
        "auth_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("used_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("used_at", sa.String(40), nullable=True),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["used_by_user_id"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("used_by_user_id", name="uq_auth_invitations_used_by_user"),
    )
    op.create_index(
        "ix_auth_invitations_created_by_user_id", "auth_invitations", ["created_by_user_id"]
    )
    op.create_index("ix_auth_invitations_created_at", "auth_invitations", ["created_at"])
    for table in OWNED_TABLES:
        op.add_column(table, sa.Column("owner_id", sa.Integer(), nullable=True))
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])

    # Preserve any pre-existing hosted single-user records under the existing account.
    first_user = connection.scalar(sa.text("SELECT id FROM auth_users ORDER BY id LIMIT 1"))
    if first_user is not None:
        for table in OWNED_TABLES:
            connection.execute(
                sa.text(f"UPDATE {table} SET owner_id = :owner WHERE owner_id IS NULL"),
                {"owner": first_user},
            )

    # Identities are unique inside a person's workspace, not across all users.
    naming = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table("companies", recreate="always", naming_convention=naming) as batch:
        batch.drop_constraint("uq_companies_normalized_name", type_="unique")
        batch.create_unique_constraint(
            "uq_companies_owner_normalized_name", ["owner_id", "normalized_name"]
        )
    job_checks = (
        sa.CheckConstraint("salary_min IS NULL OR salary_min >= 0"),
        sa.CheckConstraint("salary_max IS NULL OR salary_max >= 0"),
        sa.CheckConstraint("salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max"),
        sa.CheckConstraint("minimum_experience IS NULL OR minimum_experience >= 0"),
        sa.CheckConstraint("maximum_experience IS NULL OR maximum_experience >= 0"),
        sa.CheckConstraint(
            "minimum_experience IS NULL OR maximum_experience IS NULL "
            "OR minimum_experience <= maximum_experience"
        ),
    )
    with op.batch_alter_table(
        "jobs", recreate="always", naming_convention=naming, table_args=job_checks
    ) as batch:
        batch.drop_constraint("uq_jobs_canonical_job_url", type_="unique")
        batch.create_unique_constraint(
            "uq_jobs_owner_canonical_job_url", ["owner_id", "canonical_job_url"]
        )
    with op.batch_alter_table("document_libraries", recreate="always") as batch:
        batch.drop_constraint("single_document_library", type_="check")
        batch.create_unique_constraint("uq_document_libraries_owner_id", ["owner_id"])


def downgrade():
    raise RuntimeError(
        "This migration adds account and tenant ownership data and cannot be downgraded safely"
    )
