"""Additive fields and normalized requirement tags, retaining legacy skills."""

import sqlalchemy as sa
from alembic import op

revision = "209f35544671"
down_revision = "d8e1d744e754"
branch_labels = None
depends_on = None

ALIASES = {
    "pytorch": "PyTorch",
    "scikit learn": "scikit-learn",
    "sklearn": "scikit-learn",
    "scikit-learn": "scikit-learn",
    "aws": "AWS",
    "amazon web services": "AWS",
    "llm": "LLM",
    "llms": "LLMs",
    "mlops": "MLOps",
    "nlp": "NLP",
    "sql": "SQL",
    "fastapi": "FastAPI",
    "mlflow": "MLflow",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
}


def _norm(value):
    return " ".join(value.casefold().split())


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    # A failed prior attempt may leave only Alembic's empty temporary copy behind.
    if inspector.has_table("_alembic_tmp_jobs"):
        count = connection.scalar(sa.text("SELECT COUNT(*) FROM _alembic_tmp_jobs"))
        if count:
            raise RuntimeError("Refusing to discard non-empty SQLite migration temporary table")
        op.drop_table("_alembic_tmp_jobs")
    if not inspector.has_table("job_skill_tags"):
        op.create_table(
            "job_skill_tags",
            sa.Column("job_id", sa.Integer(), nullable=False),
            sa.Column("skill_id", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.CheckConstraint("kind IN ('Required', 'Preferred', 'Keyword')"),
            sa.ForeignKeyConstraint(["job_id"], ["jobs.id"]),
            sa.ForeignKeyConstraint(["skill_id"], ["skills.id"]),
            sa.PrimaryKeyConstraint("job_id", "skill_id", "kind"),
        )
    job_columns = [
        sa.Column("citizenship_requirement", sa.String(), nullable=True),
        sa.Column("remote_eligibility", sa.String(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("date_discovered", sa.String(), nullable=True),
        sa.Column("qualifications", sa.Text(), nullable=True),
        sa.Column("job_summary", sa.Text(), nullable=True),
        sa.Column("application_questions", sa.JSON(), nullable=True),
        sa.Column("data_confidence", sa.String(), server_default="Unknown", nullable=False),
        sa.Column("verification_status", sa.String(), server_default="Unverified", nullable=False),
        sa.Column("research_notes", sa.Text(), nullable=True),
        sa.Column("is_shortlisted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    ]
    existing_job_columns = {item["name"] for item in sa.inspect(connection).get_columns("jobs")}
    for column in job_columns:
        if column.name not in existing_job_columns:
            op.add_column("jobs", column)
    for name, column in (
        ("ix_jobs_data_confidence", "data_confidence"),
        ("ix_jobs_is_shortlisted", "is_shortlisted"),
        ("ix_jobs_location", "location"),
        ("ix_jobs_security_clearance_requirement", "security_clearance_requirement"),
        ("ix_jobs_verification_status", "verification_status"),
    ):
        if name not in {item["name"] for item in sa.inspect(connection).get_indexes("jobs")}:
            op.create_index(name, "jobs", [column])

    # Direct ALTER ADD avoids rebuilding skills while legacy join tables reference it.
    existing_skill_columns = {item["name"] for item in sa.inspect(connection).get_columns("skills")}
    for column in (
        sa.Column("canonical_name", sa.String(200), nullable=True),
        sa.Column("normalized_name", sa.String(200), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
    ):
        if column.name not in existing_skill_columns:
            op.add_column("skills", column)

    rows = connection.execute(sa.text("SELECT id, name FROM skills ORDER BY id")).mappings()
    names = {}
    for row in rows:
        normalized = _norm(row["name"])
        canonical = ALIASES.get(normalized, " ".join(row["name"].split()))
        key = _norm(canonical)
        names[row["id"]] = (canonical, key)
        connection.execute(
            sa.text(
                "UPDATE skills SET canonical_name=:canonical, "
                "normalized_name=:normalized WHERE id=:id"
            ),
            {"canonical": canonical, "normalized": key, "id": row["id"]},
        )
    legacy = connection.execute(sa.text("SELECT job_id, skill_id, kind FROM job_skills")).mappings()
    for row in legacy:
        canonical_kind = {"required": "Required", "preferred": "Preferred"}.get(
            row["kind"].casefold()
        )
        if canonical_kind:
            connection.execute(
                sa.text(
                    "INSERT OR IGNORE INTO job_skill_tags "
                    "(job_id,skill_id,kind) VALUES (:job,:skill,:kind)"
                ),
                {"job": row["job_id"], "skill": row["skill_id"], "kind": canonical_kind},
            )
    if "ix_skills_normalized_name" not in {
        item["name"] for item in sa.inspect(connection).get_indexes("skills")
    }:
        op.create_index("ix_skills_normalized_name", "skills", ["normalized_name"])


def downgrade():
    # Additive columns stay in place on downgrade: rebuilding either table on SQLite
    # would invalidate the pre-existing job_skills foreign keys. The new relation is
    # safe to remove; upgrading again repopulates it from the untouched legacy table.
    op.drop_table("job_skill_tags")
