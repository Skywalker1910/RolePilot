"""Personal application pipeline routes and transaction-safe service operations."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from .application_models import (
    APPLICATION_STATUSES,
    Application,
    ApplicationStatusHistory,
    ApplicationTask,
)
from .db import get_session, utcnow
from .jobs import serialize
from .models import ActivityEvent, Company, Job
from .schemas import (
    ApplicationArchive,
    ApplicationConfirmation,
    ApplicationStart,
    ApplicationStatusChange,
    ApplicationTaskInput,
    ApplicationUpdate,
    ManualApplication,
)

router = APIRouter(prefix="/api", tags=["applications"])
INTERVIEW_STAGES = (
    "Recruiter Screening",
    "Hiring Manager Screening",
    "Technical Interview",
    "System Design Interview",
    "Behavioral Interview",
    "Final Interview",
)
RESPONSE_STAGES = tuple(
    s
    for s in APPLICATION_STATUSES
    if s
    not in {
        "Discovered",
        "Shortlisted",
        "Not Interested",
        "Pending Application",
        "Applied",
        "No Response",
    }
)
SUBMITTED_STAGES = tuple(
    s
    for s in APPLICATION_STATUSES
    if s not in {"Discovered", "Shortlisted", "Not Interested", "Pending Application"}
)


def get_session_dep(request: Request):
    yield from get_session(request)


def require_application(session: Session, application_id: int) -> Application:
    application = session.scalar(
        select(Application)
        .options(
            joinedload(Application.job).joinedload(Job.company),
            selectinload(Application.history),
            selectinload(Application.tasks),
        )
        .where(Application.id == application_id)
    )
    if not application:
        raise HTTPException(404, "Application not found")
    return application


def append_status(
    session: Session, application: Application, new_status: str, *, source: str, notes=None
):
    previous = application.current_status
    if previous == new_status:
        return False
    application.current_status = new_status
    application.custom_stage_label = None
    if new_status == "Applied" and application.applied_at is None:
        application.applied_at = utcnow()
    application.pending_confirmation = False
    application.confirmation_remind_at = None
    if new_status == "Rejected":
        application.archived_at = utcnow()
    application.revision += 1
    application.history.append(
        ApplicationStatusHistory(
            application_id=application.id,
            previous_status=previous,
            new_status=new_status,
            changed_at=utcnow(),
            source=source,
            notes=notes,
        )
    )
    return True


def application_data(application: Application):
    return {
        "id": application.id,
        "job_id": application.job_id,
        "job": serialize(application.job),
        "current_status": application.current_status,
        "custom_stage_label": application.custom_stage_label,
        "priority": application.priority,
        "applied_at": application.applied_at,
        "next_follow_up_at": application.next_follow_up_at,
        "desired_salary": application.desired_salary,
        "desired_salary_currency": application.desired_salary_currency,
        "referral_status": application.referral_status,
        "notes": application.notes,
        "archived_at": application.archived_at,
        "pending_confirmation": application.pending_confirmation,
        "confirmation_remind_at": application.confirmation_remind_at,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
        "revision": application.revision,
        "history": [
            {
                "id": h.id,
                "previous_status": h.previous_status,
                "new_status": h.new_status,
                "changed_at": h.changed_at,
                "source": h.source,
                "notes": h.notes,
            }
            for h in application.history
        ],
        "tasks": [
            {
                "id": t.id,
                "task_type": t.task_type,
                "title": t.title,
                "description": t.description,
                "due_at": t.due_at,
                "completed_at": t.completed_at,
                "created_at": t.created_at,
            }
            for t in application.tasks
        ],
    }


@router.get("/applications")
def list_applications(
    session: Session = Depends(get_session_dep),
    q: str = "",
    status: str = "",
    job_id: int | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    statement = (
        select(Application)
        .join(Job)
        .join(Company, Company.id == Job.company_id)
        .where(
            Application.archived_at.is_not(None) if archived else Application.archived_at.is_(None)
        )
    )
    if status:
        statement = statement.where(Application.current_status == status)
    if job_id is not None:
        statement = statement.where(Application.job_id == job_id)
    if q:
        statement = statement.join(Job.company).where(
            or_(
                Job.job_title.contains(q, autoescape=True),
                Job.company_job_id.contains(q, autoescape=True),
                Company.name.contains(q, autoescape=True),
            )
        )
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(
        statement.options(
            joinedload(Application.job).joinedload(Job.company),
            selectinload(Application.history),
            selectinload(Application.tasks),
        )
        .order_by(Application.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique()
    return {
        "items": [application_data(a) for a in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/applications/pending-confirmations")
def pending_confirmations(session: Session = Depends(get_session_dep)):
    now = utcnow()
    rows = session.scalars(
        select(Application)
        .join(Job)
        .options(joinedload(Application.job).joinedload(Job.company))
        .where(
            Application.pending_confirmation.is_(True),
            Application.archived_at.is_(None),
            or_(
                Application.confirmation_remind_at.is_(None),
                Application.confirmation_remind_at <= now,
            ),
        )
        .order_by(Application.created_at)
    ).unique()
    return [application_data(a) for a in rows]


@router.get("/applications/{application_id}")
def application_detail(application_id: int, session: Session = Depends(get_session_dep)):
    return application_data(require_application(session, application_id))


@router.post("/jobs/{job_id}/apply", status_code=201)
def start_application(
    job_id: int, body: ApplicationStart, session: Session = Depends(get_session_dep)
):
    session.execute(text("BEGIN IMMEDIATE"))
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.archived_at is not None:
        raise HTTPException(409, "Restore this archived job before starting an application")
    existing = session.scalar(select(Application).where(Application.job_id == job_id))
    if existing:
        if existing.current_status == "Pending Application" and existing.archived_at is None:
            existing.pending_confirmation = True
            existing.confirmation_remind_at = utcnow()
            existing.updated_at = utcnow()
            existing.revision += 1
            session.commit()
            return {
                "application": application_data(require_application(session, existing.id)),
                "created": False,
            }
        raise HTTPException(409, "An application already exists for this job")
    application = Application(
        job_id=job_id,
        current_status="Pending Application",
        priority=body.priority,
        notes=body.notes,
        pending_confirmation=True,
        confirmation_remind_at=utcnow(),
    )
    session.add(application)
    session.flush()
    application.history.append(
        ApplicationStatusHistory(
            application_id=application.id,
            previous_status=None,
            new_status="Pending Application",
            changed_at=utcnow(),
            source="apply_workflow",
            notes="Application portal opened from RolePilot",
        )
    )
    session.add(
        ActivityEvent(
            event_type="application.started", message=f"{job.company.name} · {job.job_title}"
        )
    )
    session.commit()
    return {
        "application": application_data(require_application(session, application.id)),
        "created": True,
    }


@router.post("/applications/manual", status_code=201)
def create_manual_application(body: ManualApplication, session: Session = Depends(get_session_dep)):
    session.execute(text("BEGIN IMMEDIATE"))
    job = session.get(Job, body.job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if session.scalar(select(Application.id).where(Application.job_id == body.job_id)):
        raise HTTPException(409, "An application already exists for this job")
    values = body.model_dump()
    application = Application(**values, pending_confirmation=False)
    session.add(application)
    session.flush()
    application.history.append(
        ApplicationStatusHistory(
            application_id=application.id,
            previous_status=None,
            new_status=application.current_status,
            changed_at=utcnow(),
            source="manual",
            notes="Previously recorded application",
        )
    )
    session.add(
        ActivityEvent(
            event_type="application.created", message=f"{job.company.name} · {job.job_title}"
        )
    )
    session.commit()
    return application_data(require_application(session, application.id))


@router.post("/applications/{application_id}/confirm")
def confirm_application(
    application_id: int, body: ApplicationConfirmation, session: Session = Depends(get_session_dep)
):
    session.execute(text("BEGIN IMMEDIATE"))
    application = require_application(session, application_id)
    if not application.pending_confirmation:
        raise HTTPException(409, "This application no longer needs confirmation")
    if body.action == "applied":
        application.applied_at = application.applied_at or utcnow()
        append_status(
            session, application, "Applied", source="apply_confirmation", notes=body.notes
        )
    elif body.action == "not_yet":
        application.pending_confirmation = False
        application.confirmation_remind_at = None
    elif body.action == "remind_later":
        application.confirmation_remind_at = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    else:
        application.pending_confirmation = False
        application.confirmation_remind_at = None
        application.archived_at = utcnow()
        if application.job.archived_at is None:
            application.job.archived_at = utcnow()
    if body.action != "applied":
        application.revision += 1
    session.add(
        ActivityEvent(
            event_type=f"application.confirmation.{body.action}",
            message=f"{application.job.company.name} · {application.job.job_title}",
        )
    )
    session.commit()
    return application_data(require_application(session, application.id))


@router.post("/applications/{application_id}/status")
def change_status(
    application_id: int, body: ApplicationStatusChange, session: Session = Depends(get_session_dep)
):
    session.execute(text("BEGIN IMMEDIATE"))
    application = require_application(session, application_id)
    if (
        body.new_status == application.current_status
        and body.custom_stage_label == application.custom_stage_label
    ):
        raise HTTPException(409, "Application is already at this stage")
    old = application.current_status
    if body.new_status == old and body.custom_stage_label != application.custom_stage_label:
        application.custom_stage_label = body.custom_stage_label
        application.revision += 1
    else:
        append_status(session, application, body.new_status, source="manual", notes=body.notes)
        application.custom_stage_label = body.custom_stage_label
    session.add(
        ActivityEvent(
            event_type="application.status.changed",
            message=f"{application.job.company.name} · {old} → {application.current_status}",
        )
    )
    session.commit()
    return application_data(require_application(session, application.id))


@router.patch("/applications/{application_id}")
def update_application(
    application_id: int, body: ApplicationUpdate, session: Session = Depends(get_session_dep)
):
    session.execute(text("BEGIN IMMEDIATE"))
    application = require_application(session, application_id)
    if application.revision != body.expected_revision:
        raise HTTPException(409, "Application changed; reload before saving")
    for field, value in body.model_dump(exclude={"expected_revision"}, exclude_unset=True).items():
        setattr(application, field, value)
    application.updated_at = utcnow()
    application.revision += 1
    session.commit()
    return application_data(require_application(session, application.id))


@router.post("/applications/{application_id}/archive")
def archive_application(
    application_id: int, body: ApplicationArchive, session: Session = Depends(get_session_dep)
):
    session.execute(text("BEGIN IMMEDIATE"))
    application = require_application(session, application_id)
    if application.revision != body.expected_revision:
        raise HTTPException(409, "Application changed; refresh before archiving")
    application.archived_at = utcnow() if body.archived else None
    application.revision += 1
    session.add(
        ActivityEvent(
            event_type="application.archived" if body.archived else "application.restored",
            message=f"{application.job.company.name} · {application.job.job_title}",
        )
    )
    session.commit()
    return application_data(require_application(session, application.id))


@router.post("/applications/{application_id}/tasks", status_code=201)
def create_task(
    application_id: int, body: ApplicationTaskInput, session: Session = Depends(get_session_dep)
):
    application = require_application(session, application_id)
    task = ApplicationTask(
        application_id=application.id,
        task_type=body.task_type,
        title=body.title,
        description=body.description,
        due_at=body.due_at,
        completed_at=utcnow() if body.completed else None,
    )
    session.add(task)
    session.commit()
    return {
        "id": task.id,
        "application_id": task.application_id,
        "task_type": task.task_type,
        "title": task.title,
        "description": task.description,
        "due_at": task.due_at,
        "completed_at": task.completed_at,
        "created_at": task.created_at,
    }


@router.patch("/applications/{application_id}/tasks/{task_id}")
def complete_task(
    application_id: int, task_id: int, completed: bool, session: Session = Depends(get_session_dep)
):
    task = session.scalar(
        select(ApplicationTask).where(
            ApplicationTask.id == task_id, ApplicationTask.application_id == application_id
        )
    )
    if not task:
        raise HTTPException(404, "Task not found")
    task.completed_at = utcnow() if completed else None
    session.commit()
    return {"id": task.id, "completed_at": task.completed_at}


@router.get("/application-metrics")
def application_metrics(session: Session = Depends(get_session_dep)):
    total = session.scalar(select(func.count(Application.id))) or 0
    ever_submitted = (
        select(ApplicationStatusHistory.id)
        .where(
            ApplicationStatusHistory.application_id == Application.id,
            ApplicationStatusHistory.new_status.in_(SUBMITTED_STAGES),
        )
        .exists()
    )
    submitted_filter = or_(
        Application.applied_at.is_not(None),
        Application.current_status.in_(SUBMITTED_STAGES),
        ever_submitted,
    )
    submitted = session.scalar(select(func.count(Application.id)).where(submitted_filter)) or 0
    submitted_ids = select(Application.id).where(submitted_filter)
    responded = (
        session.scalar(
            select(func.count(func.distinct(ApplicationStatusHistory.application_id))).where(
                ApplicationStatusHistory.application_id.in_(submitted_ids),
                ApplicationStatusHistory.new_status.in_(RESPONSE_STAGES),
            )
        )
        or 0
    )
    interviewed = (
        session.scalar(
            select(func.count(func.distinct(ApplicationStatusHistory.application_id))).where(
                ApplicationStatusHistory.application_id.in_(submitted_ids),
                ApplicationStatusHistory.new_status.in_(INTERVIEW_STAGES),
            )
        )
        or 0
    )
    today = utcnow()
    due_apps = (
        session.scalar(
            select(func.count(Application.id)).where(
                Application.archived_at.is_(None),
                Application.next_follow_up_at.is_not(None),
                Application.next_follow_up_at <= today,
            )
        )
        or 0
    )
    due_tasks = (
        session.scalar(
            select(func.count(ApplicationTask.id)).where(
                ApplicationTask.completed_at.is_(None), ApplicationTask.due_at <= today
            )
        )
        or 0
    )
    stages = session.execute(
        select(Application.current_status, func.count(Application.id))
        .where(Application.archived_at.is_(None))
        .group_by(Application.current_status)
    )
    monthly = session.execute(
        select(func.substr(Application.applied_at, 1, 7), func.count(Application.id))
        .where(Application.applied_at.is_not(None))
        .group_by(func.substr(Application.applied_at, 1, 7))
        .order_by(func.substr(Application.applied_at, 1, 7))
    )
    return {
        "applications_total": total,
        "applications_active": session.scalar(
            select(func.count(Application.id)).where(Application.archived_at.is_(None))
        )
        or 0,
        "pending_confirmations": session.scalar(
            select(func.count(Application.id)).where(Application.pending_confirmation.is_(True))
        )
        or 0,
        "submitted": submitted,
        "under_review": session.scalar(
            select(func.count(Application.id)).where(
                Application.current_status.in_(
                    (
                        "Under Review",
                        "Recruiter Screening",
                        "Hiring Manager Screening",
                        "Assessment",
                        *INTERVIEW_STAGES,
                        "On Hold",
                    )
                )
            )
        )
        or 0,
        "interview_opportunities": interviewed,
        "offers": session.scalar(
            select(func.count(Application.id)).where(
                Application.current_status.in_(
                    ("Offer Received", "Offer Accepted", "Offer Declined")
                )
            )
        )
        or 0,
        "rejections": session.scalar(
            select(func.count(Application.id)).where(Application.current_status == "Rejected")
        )
        or 0,
        "follow_ups_due": due_apps + due_tasks,
        "response_rate": round(100 * responded / submitted, 1) if submitted else None,
        "interview_conversion_rate": round(100 * interviewed / submitted, 1) if submitted else None,
        "stage_distribution": [{"status": status, "count": count} for status, count in stages],
        "applications_over_time": [
            {"month": month, "count": count} for month, count in monthly if month
        ],
        "rate_denominator": (
            "Submitted applications identified by an Applied or later stage, including archived "
            "outcomes; unknown submission dates remain unknown."
        ),
        "response_rule": (
            "Response means the history reached a stage beyond Applied, excluding No Response."
        ),
    }
