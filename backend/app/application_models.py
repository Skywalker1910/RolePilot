"""Application pipeline tables. Jobs remain independent discovery records."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, TenantOwned, utcnow
from .models import Job

APPLICATION_STATUSES = (
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


class Application(TenantOwned, Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("job_id", name="uq_applications_job_id"),
        CheckConstraint(
            "current_status IN (" + ",".join(repr(s) for s in APPLICATION_STATUSES) + ")",
            name="ck_applications_status",
        ),
        CheckConstraint("priority BETWEEN 1 AND 5", name="ck_applications_priority"),
        CheckConstraint(
            "desired_salary IS NULL OR desired_salary >= 0", name="ck_applications_salary"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), nullable=False, index=True)
    current_status: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    custom_stage_label: Mapped[str | None] = mapped_column(String(120))
    priority: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    applied_at: Mapped[str | None] = mapped_column(index=True)
    next_follow_up_at: Mapped[str | None] = mapped_column(index=True)
    desired_salary: Mapped[float | None] = mapped_column(Float)
    desired_salary_currency: Mapped[str | None] = mapped_column(String(10))
    referral_status: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[str | None] = mapped_column(index=True)
    pending_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", index=True
    )
    confirmation_remind_at: Mapped[str | None] = mapped_column(index=True)
    created_at: Mapped[str] = mapped_column(default=utcnow)
    updated_at: Mapped[str] = mapped_column(default=utcnow, onupdate=utcnow)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    job: Mapped["Job"] = relationship()
    history: Mapped[list["ApplicationStatusHistory"]] = relationship(
        order_by="ApplicationStatusHistory.id"
    )
    tasks: Mapped[list["ApplicationTask"]] = relationship(order_by="ApplicationTask.due_at")


class ApplicationStatusHistory(TenantOwned, Base):
    __tablename__ = "application_status_history"
    __table_args__ = (
        CheckConstraint(
            "new_status IN (" + ",".join(repr(s) for s in APPLICATION_STATUSES) + ")",
            name="ck_application_history_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id"), nullable=False, index=True
    )
    previous_status: Mapped[str | None] = mapped_column(String(100))
    new_status: Mapped[str] = mapped_column(String(100), nullable=False)
    changed_at: Mapped[str] = mapped_column(default=utcnow, index=True)
    source: Mapped[str] = mapped_column(String(50), default="manual")
    notes: Mapped[str | None] = mapped_column(Text)


class ApplicationTask(TenantOwned, Base):
    __tablename__ = "application_tasks"
    __table_args__ = (
        CheckConstraint(
            "completed_at IS NULL OR due_at IS NOT NULL", name="ck_task_due_before_complete"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id"), nullable=False, index=True
    )
    task_type: Mapped[str] = mapped_column(String(80), default="Follow up")
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[str] = mapped_column(nullable=False, index=True)
    completed_at: Mapped[str | None]
    created_at: Mapped[str] = mapped_column(default=utcnow)
