"""Add persistent applications, append-only stage history and follow-up tasks."""

import sqlalchemy as sa
from alembic import op

revision = "f347a18c2c10"
down_revision = "209f35544671"
branch_labels = None
depends_on = None

STATUSES = (
    "Discovered",
    "Shortlisted",
    "Not Interested",
    "Pending Application",
    "Applied",
    "Under Review",
    "Recruiter Screening",
    "Hiring Manager Screening",
    "Assessment",
    "Technical Interview",
    "System Design Interview",
    "Behavioral Interview",
    "Final Interview",
    "On Hold",
    "Offer Received",
    "Offer Accepted",
    "Offer Declined",
    "Rejected",
    "Withdrawn",
    "Position Closed",
    "No Response",
)
STATUS_SQL = ",".join("'" + s.replace("'", "''") + "'" for s in STATUSES)


def upgrade():
    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("current_status", sa.String(100), nullable=False),
        sa.Column("custom_stage_label", sa.String(120)),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("applied_at", sa.String()),
        sa.Column("next_follow_up_at", sa.String()),
        sa.Column("desired_salary", sa.Float()),
        sa.Column("desired_salary_currency", sa.String(10)),
        sa.Column("referral_status", sa.String(100)),
        sa.Column("notes", sa.Text()),
        sa.Column("archived_at", sa.String()),
        sa.Column(
            "pending_confirmation", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("confirmation_remind_at", sa.String()),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint(f"current_status IN ({STATUS_SQL})", name="ck_applications_status"),
        sa.CheckConstraint("priority BETWEEN 1 AND 5", name="ck_applications_priority"),
        sa.CheckConstraint(
            "desired_salary IS NULL OR desired_salary >= 0", name="ck_applications_salary"
        ),
        sa.UniqueConstraint("job_id", name="uq_applications_job_id"),
    )
    for col in (
        "job_id",
        "current_status",
        "applied_at",
        "next_follow_up_at",
        "archived_at",
        "pending_confirmation",
        "confirmation_remind_at",
    ):
        op.create_index(f"ix_applications_{col}", "applications", [col])

    op.create_table(
        "application_status_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("previous_status", sa.String(100)),
        sa.Column("new_status", sa.String(100), nullable=False),
        sa.Column("changed_at", sa.String(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.CheckConstraint(f"new_status IN ({STATUS_SQL})", name="ck_application_history_status"),
    )
    op.create_index(
        "ix_application_status_history_application_id",
        "application_status_history",
        ["application_id"],
    )
    op.create_index(
        "ix_application_status_history_changed_at", "application_status_history", ["changed_at"]
    )
    op.execute("""
        CREATE TRIGGER application_history_no_update
        BEFORE UPDATE ON application_status_history
        BEGIN SELECT RAISE(ABORT, 'application status history is append-only'); END
    """)
    op.execute("""
        CREATE TRIGGER application_history_no_delete
        BEFORE DELETE ON application_status_history
        BEGIN SELECT RAISE(ABORT, 'application status history is append-only'); END
    """)

    op.create_table(
        "application_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("task_type", sa.String(80), nullable=False),
        sa.Column("title", sa.String(250), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("due_at", sa.String(), nullable=False),
        sa.Column("completed_at", sa.String()),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_application_tasks_application_id", "application_tasks", ["application_id"])
    op.create_index("ix_application_tasks_due_at", "application_tasks", ["due_at"])


def downgrade():
    op.drop_index("ix_application_tasks_due_at", table_name="application_tasks")
    op.drop_index("ix_application_tasks_application_id", table_name="application_tasks")
    op.drop_table("application_tasks")
    op.execute("DROP TRIGGER application_history_no_delete")
    op.execute("DROP TRIGGER application_history_no_update")
    op.drop_index(
        "ix_application_status_history_changed_at", table_name="application_status_history"
    )
    op.drop_index(
        "ix_application_status_history_application_id", table_name="application_status_history"
    )
    op.drop_table("application_status_history")
    for col in (
        "confirmation_remind_at",
        "pending_confirmation",
        "archived_at",
        "next_follow_up_at",
        "applied_at",
        "current_status",
        "job_id",
    ):
        op.drop_index(f"ix_applications_{col}", table_name="applications")
    op.drop_table("applications")
