import pytest
from alembic import command
from alembic.config import Config
from app import db
from app.main import app
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(db, "engine", engine)
    command.upgrade(Config("alembic.ini"), "head")
    factory = sessionmaker(engine, class_=db.RolePilotSession, expire_on_commit=False)
    monkeypatch.setattr(db, "SessionLocal", factory)
    monkeypatch.setenv("ROLEPILOT_LIBRARY_ROOT", str(tmp_path / "unconfigured-library"))

    def sessions(request: Request):
        with factory() as session:
            user = getattr(request.state, "auth_user", None)
            if getattr(request.app.state, "auth_required", False) and user is not None:
                session.info["owner_id"] = user.id
            yield session

    app.dependency_overrides[db.get_session] = sessions
    with TestClient(app, headers={"x-rolepilot": "local"}) as client:
        client.engine = engine
        client.factory = factory
        yield client
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def job():
    return {
        "company_name": "Fictional Orbit",
        "job_title": "Backend Engineer",
        "canonical_job_url": "https://orbit.example/jobs/42",
        "required_skills": ["Python", "SQL"],
    }
