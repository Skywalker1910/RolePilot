from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .db import get_session
from .library import ensure_library, root_report, scan_library, validate_root
from .library_models import Document, DocumentLibrary, DocumentRevision
from .models import Company, Job

router = APIRouter(prefix="/api", tags=["Document library"])
DB = Annotated[Session, Depends(get_session)]


def library_data(library):
    result = {c.name: getattr(library, c.name) for c in DocumentLibrary.__table__.columns}
    try:
        validate_root(library.root_path)
        result["available"] = True
        result["availability_error"] = None
    except (OSError, ValueError) as exc:
        result["available"] = False
        result["availability_error"] = str(exc)
    return result


def document_data(document):
    return {c.name: getattr(document, c.name) for c in Document.__table__.columns}


class RootRequest(BaseModel):
    root_path: str = Field(min_length=1, max_length=2048)


class RootUpdate(RootRequest):
    expected_revision: int
    accept_unverified: bool = False


class MetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int
    document_type: Literal["Resume", "Cover Letter", "Template", "Supporting Document", "Other"]
    status: Literal["Unreviewed", "Master", "Draft", "General", "Tailored", "Final", "Archived"]
    version_label: str | None = Field(default=None, max_length=200)
    company_id: int | None = None
    job_id: int | None = None
    role_label: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=10000)


@router.get("/document-library")
def get_library(session: DB):
    library = ensure_library(session)
    session.commit()
    return library_data(library)


@router.post("/document-library/validate")
def validate_library(body: RootRequest, session: DB):
    try:
        return root_report(session, body.root_path)
    except (OSError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.put("/document-library")
def update_library(body: RootUpdate, session: DB):
    session.execute(text("BEGIN IMMEDIATE"))
    library = ensure_library(session)
    if library.revision != body.expected_revision:
        raise HTTPException(409, "Library setting changed; refresh before reconnecting")
    try:
        report = root_report(session, body.root_path)
    except (OSError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    if report["requires_approval"] and not body.accept_unverified:
        raise HTTPException(
            409, "Existing files differ or are unavailable. Review and approve first."
        )
    library.root_path = report["root_path"]
    library.revision += 1
    scan_library(session, library)
    session.commit()
    return library_data(library)


@router.post("/document-library/scan")
def refresh_library(session: DB):
    session.execute(text("BEGIN IMMEDIATE"))
    library = ensure_library(session)
    scan_library(session, library)
    session.commit()
    return library_data(library)


@router.get("/documents")
def list_documents(
    session: DB,
    q: str = "",
    category: str = "",
    folder: str = "",
    format: str = "",
    missing: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    stmt = select(Document).outerjoin(Company, Document.company_id == Company.id)
    if q:
        stmt = stmt.where(
            or_(
                Document.filename.contains(q, autoescape=True),
                Document.relative_path.contains(q, autoescape=True),
                Document.role_label.contains(q, autoescape=True),
                Company.name.contains(q, autoescape=True),
            )
        )
    if category:
        stmt = stmt.where(Document.document_type == category)
    if folder:
        stmt = stmt.where(
            or_(
                Document.parent_folder == folder,
                Document.parent_folder.startswith(folder + "/", autoescape=True),
            )
        )
    if format:
        stmt = stmt.where(Document.format == format.lower().lstrip("."))
    if missing is not None:
        stmt = stmt.where(Document.is_missing == missing)
    total = session.scalar(select(func.count()).select_from(stmt.subquery()))
    documents = session.scalars(
        stmt.order_by(Document.modified_at.desc(), Document.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {"items": [document_data(d) for d in documents], "total": total}


@router.get("/documents/{document_id}")
def get_document(document_id: int, session: DB):
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    result = document_data(document)
    result["revisions"] = [
        {c.name: getattr(r, c.name) for c in DocumentRevision.__table__.columns}
        for r in session.scalars(
            select(DocumentRevision)
            .where(DocumentRevision.document_id == document.id)
            .order_by(DocumentRevision.id.desc())
        )
    ]
    return result


@router.put("/documents/{document_id}/metadata")
def edit_metadata(document_id: int, body: MetadataUpdate, session: DB):
    session.execute(text("BEGIN IMMEDIATE"))
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    if document.revision != body.expected_revision:
        raise HTTPException(409, "Document changed; reopen metadata before saving")
    if body.company_id and not session.get(Company, body.company_id):
        raise HTTPException(422, "Company does not exist")
    job = session.get(Job, body.job_id) if body.job_id else None
    if body.job_id and not job:
        raise HTTPException(422, "Job does not exist")
    if job and body.company_id and job.company_id != body.company_id:
        raise HTTPException(422, "Job and company do not match")
    if body.status == "Master" and body.document_type != "Resume":
        raise HTTPException(422, "Only a resume can be designated Master")
    for field, value in body.model_dump(exclude={"expected_revision"}).items():
        setattr(document, field, value)
    document.revision += 1
    session.commit()
    return document_data(document)
