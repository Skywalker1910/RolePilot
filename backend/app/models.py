from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, TenantOwned, utcnow

# Keep the previous skill association visible to Alembic and preserve it intact.
legacy_job_skills = Table(
    "job_skills",
    Base.metadata,
    Column("job_id", ForeignKey("jobs.id"), primary_key=True),
    Column("skill_id", ForeignKey("skills.id"), primary_key=True),
    Column("kind", String(), primary_key=True),
    CheckConstraint("kind IN ('required', 'preferred')"),
)


class Company(TenantOwned, Base):
    __tablename__ = "companies"
    __table_args__ = (
        UniqueConstraint("owner_id", "normalized_name", name="uq_companies_owner_normalized_name"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    normalized_name: Mapped[str] = mapped_column(String(300))
    industry: Mapped[str | None]
    website: Mapped[str | None]
    careers_page_url: Mapped[str | None]
    headquarters: Mapped[str | None]
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(default=utcnow)
    updated_at: Mapped[str] = mapped_column(default=utcnow, onupdate=utcnow)
    jobs: Mapped[list["Job"]] = relationship(back_populates="company")


class Job(TenantOwned, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("owner_id", "canonical_job_url", name="uq_jobs_owner_canonical_job_url"),
        UniqueConstraint("company_id", "normalized_requisition"),
        CheckConstraint("salary_min IS NULL OR salary_min >= 0"),
        CheckConstraint("salary_max IS NULL OR salary_max >= 0"),
        CheckConstraint("salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max"),
        CheckConstraint("minimum_experience IS NULL OR minimum_experience >= 0"),
        CheckConstraint("maximum_experience IS NULL OR maximum_experience >= 0"),
        CheckConstraint(
            "minimum_experience IS NULL OR maximum_experience IS NULL "
            "OR minimum_experience <= maximum_experience"
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    job_title: Mapped[str] = mapped_column(String(500), index=True)
    normalized_title: Mapped[str] = mapped_column(index=True)
    company_job_id: Mapped[str | None]
    normalized_requisition: Mapped[str | None]
    external_job_id: Mapped[str | None]
    source_platform: Mapped[str | None]
    source_url: Mapped[str | None]
    canonical_job_url: Mapped[str]
    city: Mapped[str | None] = mapped_column(index=True)
    state: Mapped[str | None]
    country: Mapped[str | None]
    remote_type: Mapped[str | None]
    employment_type: Mapped[str | None]
    seniority: Mapped[str | None]
    minimum_experience: Mapped[float | None] = mapped_column(Float)
    maximum_experience: Mapped[float | None] = mapped_column(Float)
    salary_min: Mapped[float | None] = mapped_column(Float)
    salary_max: Mapped[float | None] = mapped_column(Float)
    salary_currency: Mapped[str | None]
    salary_period: Mapped[str | None]
    education_requirement: Mapped[str | None]
    work_authorization_notes: Mapped[str | None]
    sponsorship_policy: Mapped[str | None]
    security_clearance_requirement: Mapped[str | None] = mapped_column(index=True)
    citizenship_requirement: Mapped[str | None]
    remote_eligibility: Mapped[str | None]
    location: Mapped[str | None] = mapped_column(Text, index=True)
    date_discovered: Mapped[str | None]
    qualifications: Mapped[str | None] = mapped_column(Text)
    job_summary: Mapped[str | None] = mapped_column(Text)
    application_questions: Mapped[list | None] = mapped_column(JSON)
    data_confidence: Mapped[str] = mapped_column(
        default="Unknown", server_default="Unknown", index=True
    )
    verification_status: Mapped[str] = mapped_column(
        default="Unverified", server_default="Unverified", index=True
    )
    research_notes: Mapped[str | None] = mapped_column(Text)
    is_shortlisted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", index=True
    )
    responsibilities: Mapped[str | None] = mapped_column(Text)
    full_description: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[str | None]
    application_deadline: Mapped[str | None]
    source_checked_at: Mapped[str | None]
    imported_at: Mapped[str] = mapped_column(default=utcnow, index=True)
    updated_at: Mapped[str] = mapped_column(default=utcnow, onupdate=utcnow)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    locally_edited_fields: Mapped[list] = mapped_column(JSON, default=list)
    archived_at: Mapped[str | None] = mapped_column(index=True)
    company: Mapped[Company] = relationship(back_populates="jobs")
    skills: Mapped[list["JobSkill"]] = relationship(cascade="all, delete-orphan")
    provenance: Mapped[list["JobProvenance"]] = relationship(cascade="all, delete-orphan")


class Skill(Base):
    __tablename__ = "skills"
    id: Mapped[int] = mapped_column(primary_key=True)
    # name is retained for compatibility with pre-Phase-2 records and relationships.
    name: Mapped[str] = mapped_column(unique=True)
    canonical_name: Mapped[str | None] = mapped_column(String(200))
    normalized_name: Mapped[str | None] = mapped_column(String(200), index=True)
    category: Mapped[str | None]


class JobSkill(Base):
    # New requirement types live separately so the original job_skills table and
    # its existing data survive as an untouched legacy relation.
    __tablename__ = "job_skill_tags"
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), primary_key=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(primary_key=True)
    __table_args__ = (CheckConstraint("kind IN ('Required', 'Preferred', 'Keyword')"),)
    skill: Mapped[Skill] = relationship()


class ImportBatch(TenantOwned, Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)
    rows_processed: Mapped[int]
    inserted: Mapped[int]
    updated: Mapped[int]
    skipped: Mapped[int]
    rejected: Mapped[int]
    validation_errors: Mapped[list] = mapped_column(JSON, default=list)
    source_metadata: Mapped[dict] = mapped_column(JSON, default=dict)


class ImportPreview(TenantOwned, Base):
    __tablename__ = "import_previews"
    id: Mapped[str] = mapped_column(primary_key=True)
    filename: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)
    rows: Mapped[list] = mapped_column(JSON)
    row_numbers: Mapped[list] = mapped_column(JSON, default=list)
    mapping: Mapped[dict] = mapped_column(JSON, default=dict)
    reviewed_rows: Mapped[list] = mapped_column(JSON, default=list)
    committed_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"))


class JobProvenance(TenantOwned, Base):
    __tablename__ = "job_provenance"
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"))
    row_number: Mapped[int | None]
    original_fields: Mapped[dict] = mapped_column(JSON)
    imported_fields: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(default=utcnow)


class ActivityEvent(TenantOwned, Base):
    __tablename__ = "activity_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str]
    message: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)
