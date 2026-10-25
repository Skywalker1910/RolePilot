from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, TenantOwned, utcnow


class DocumentLibrary(TenantOwned, Base):
    __tablename__ = "document_libraries"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_document_libraries_owner_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(default="Personal document library")
    root_path: Mapped[str]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[str] = mapped_column(default=utcnow)
    updated_at: Mapped[str] = mapped_column(default=utcnow, onupdate=utcnow)
    last_scan_at: Mapped[str | None]
    last_error: Mapped[str | None]
    scan_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    documents: Mapped[list["Document"]] = relationship(back_populates="library")


class Document(TenantOwned, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("library_id", "path_key"),
        CheckConstraint("file_size >= 0"),
        CheckConstraint(
            "document_type IN ('Resume','Cover Letter','Template','Supporting Document','Other')"
        ),
        CheckConstraint(
            "status IN ('Unreviewed','Master','Draft','General','Tailored',"
            "'Submitted','Final','Archived')"
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("document_libraries.id"), index=True)
    relative_path: Mapped[str]
    path_key: Mapped[str]
    filename: Mapped[str] = mapped_column(index=True)
    parent_folder: Mapped[str] = mapped_column(index=True)
    document_type: Mapped[str] = mapped_column(index=True)
    format: Mapped[str] = mapped_column(index=True)
    version_label: Mapped[str | None]
    folder_hint: Mapped[str | None]
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"))
    role_label: Mapped[str | None]
    status: Mapped[str] = mapped_column(default="Unreviewed")
    notes: Mapped[str | None]
    file_hash: Mapped[str] = mapped_column(index=True)
    file_size: Mapped[int]
    file_created_at: Mapped[str | None]
    modified_at: Mapped[str]
    indexed_at: Mapped[str] = mapped_column(default=utcnow)
    last_verified_at: Mapped[str]
    is_missing: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    verification_error: Mapped[str | None]
    revision: Mapped[int] = mapped_column(default=1)
    library: Mapped[DocumentLibrary] = relationship(back_populates="documents")
    revisions: Mapped[list["DocumentRevision"]] = relationship(back_populates="document")


class DocumentRevision(TenantOwned, Base):
    """Metadata observations only. These are NOT recoverable binary snapshots."""

    __tablename__ = "document_revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    revision_label: Mapped[str | None]
    source_path: Mapped[str]
    content_hash: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)
    notes: Mapped[str]
    document: Mapped[Document] = relationship(back_populates="revisions")
