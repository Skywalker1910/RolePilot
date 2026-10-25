import os
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    sessionmaker,
    with_loader_criteria,
)

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("ROLEPILOT_DATA_DIR", ROOT / "data")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get("ROLEPILOT_DATABASE_URL", f"sqlite:///{DATA / 'rolepilot.db'}")


def utcnow():
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class TenantOwned:
    """Rows in a hosted job-search workspace belong to one account."""

    owner_id: Mapped[int | None] = mapped_column(nullable=True, index=True)


def make_engine(url):
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def sqlite_pragmas(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")

    return engine


engine = make_engine(DATABASE_URL)


class RolePilotSession(Session):
    pass


@event.listens_for(RolePilotSession, "do_orm_execute")
def scope_tenant_rows(execute_state):
    owner_id = execute_state.session.info.get("owner_id")
    if owner_id is not None and execute_state.is_select:
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                TenantOwned,
                lambda model: model.owner_id == owner_id,
                include_aliases=True,
            )
        )


@event.listens_for(RolePilotSession, "before_flush")
def set_tenant_owner(session, _flush_context, _instances):
    owner_id = session.info.get("owner_id")
    if owner_id is None:
        return
    for row in session.new:
        if isinstance(row, TenantOwned):
            if row.owner_id not in (None, owner_id):
                raise ValueError("A workspace record cannot belong to another account")
            row.owner_id = owner_id
    for row in session.dirty:
        if isinstance(row, TenantOwned) and row.owner_id != owner_id:
            raise ValueError("A workspace record cannot be moved between accounts")


SessionLocal = sessionmaker(engine, class_=RolePilotSession, expire_on_commit=False)


def get_session(request: Request):
    with SessionLocal() as session:
        user = getattr(request.state, "auth_user", None)
        if getattr(request.app.state, "auth_required", False) and user is not None:
            session.info["owner_id"] = user.id
        yield session
