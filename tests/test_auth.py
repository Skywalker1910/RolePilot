from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from app import auth
from app.auth_models import AuthInvitation, AuthSession, AuthUser
from app.db import make_engine, utcnow
from app.main import app
from app.production_config import validate_production_environment
from sqlalchemy import select, text

ROOT = Path(__file__).resolve().parents[1]


def provision(client, username="pilot", password="correct horse battery staple 42"):
    with client.factory() as session:
        user = AuthUser(
            username=username,
            password_hash=auth.hash_password(password),
            created_at=utcnow(),
            password_changed_at=utcnow(),
        )
        session.add(user)
        session.commit()
    return username, password


def auth_headers(csrf=None):
    return {
        "origin": "https://career.adityamore.dev",
        **({"x-csrf-token": csrf} if csrf else {}),
    }


def test_auth_required_login_csrf_logout_and_cookie_policy(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    username, password = provision(client)

    assert client.get("/api/jobs").status_code == 401
    assert client.get("/api/health").status_code == 200
    denied = client.post(
        "/api/auth/login", json={"username": username, "password": "wrong"}, headers=auth_headers()
    )
    assert denied.status_code == 401

    result = client.post(
        "/api/auth/login", json={"username": username, "password": password}, headers=auth_headers()
    )
    assert result.status_code == 200
    csrf = result.json()["csrf_token"]
    cookie = client.cookies.get(auth.SESSION_COOKIE)
    assert cookie and "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert client.get("/api/jobs").status_code == 200
    assert client.post("/api/jobs/999/apply", json={}, headers=auth_headers()).status_code == 403
    assert (
        client.post("/api/jobs/999/apply", json={}, headers=auth_headers(csrf)).status_code == 404
    )

    logged_out = client.post("/api/auth/logout", json={}, headers=auth_headers(csrf))
    assert logged_out.status_code == 200
    assert client.get("/api/jobs").status_code == 401


def test_auth_session_expiration(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    username, password = provision(client)
    login = client.post(
        "/api/auth/login", json={"username": username, "password": password}, headers=auth_headers()
    )
    token_hash = auth.token_digest(client.cookies[auth.SESSION_COOKIE])
    with client.factory() as session:
        record = session.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash))
        record.expires_at = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        session.commit()
    assert client.get("/api/jobs").status_code == 401
    assert login.json()["authenticated"] is True


def test_secure_login_rotates_session_and_logout_revokes_it(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", True)
    client.base_url = "https://testserver"
    username, password = provision(client)
    first = client.post(
        "/api/auth/login", json={"username": username, "password": password}, headers=auth_headers()
    )
    first_token = client.cookies[auth.SESSION_COOKIE]
    assert "Secure" in first.headers["set-cookie"]
    assert len(first_token) >= 40

    second = client.post(
        "/api/auth/login", json={"username": username, "password": password}, headers=auth_headers()
    )
    second_token = client.cookies[auth.SESSION_COOKIE]
    assert second_token != first_token
    with client.factory() as session:
        assert (
            session.scalar(
                select(AuthSession).where(AuthSession.token_hash == auth.token_digest(first_token))
            )
            is None
        )
        assert (
            session.scalar(
                select(AuthSession).where(AuthSession.token_hash == auth.token_digest(second_token))
            )
            is not None
        )

    logged_out = client.post(
        "/api/auth/logout", json={}, headers=auth_headers(second.json()["csrf_token"])
    )
    assert "Secure" in logged_out.headers["set-cookie"]
    assert client.get("/api/jobs").status_code == 401


def test_login_rate_limit(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    auth.attempts.clear()
    for _ in range(auth.LOGIN_LIMIT):
        response = client.post(
            "/api/auth/login",
            json={"username": "missing", "password": "wrong"},
            headers=auth_headers(),
        )
        assert response.status_code == 401
    limited = client.post(
        "/api/auth/login",
        json={"username": "missing", "password": "wrong"},
        headers=auth_headers(),
    )
    assert limited.status_code == 429


def test_invitation_is_one_time_linked_to_new_user(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    auth.attempts.clear()
    with client.factory() as session:
        session.add(
            AuthUser(
                username="administrator",
                password_hash=auth.hash_password("a sufficiently long admin password"),
                role="admin",
                is_active=True,
                created_at=utcnow(),
                password_changed_at=utcnow(),
            )
        )
        session.commit()
    admin_login = client.post(
        "/api/auth/login",
        json={"username": "administrator", "password": "a sufficiently long admin password"},
        headers=auth_headers(),
    ).json()
    headers = auth_headers(admin_login["csrf_token"])
    created = client.post("/api/admin/invitations", json={}, headers=headers)
    assert created.status_code == 201
    code = created.json()["code"]

    signed_up = client.post(
        "/api/auth/signup",
        json={
            "username": "invited-user",
            "password": "a sufficiently long user password",
            "invitation_code": code,
        },
        headers=auth_headers(),
    )
    assert signed_up.status_code == 201
    assert signed_up.json()["user"]["role"] == "user"
    assert signed_up.json()["authenticated"] is True
    with client.factory() as session:
        invitation = session.get(AuthInvitation, created.json()["id"])
        user = session.scalar(select(AuthUser).where(AuthUser.username == "invited-user"))
        assert invitation.code_hash == auth.invitation_digest(code)
        assert invitation.code_hash != code
        assert invitation.used_by_user_id == user.id

    reused = client.post(
        "/api/auth/signup",
        json={
            "username": "second-user",
            "password": "another sufficiently long password",
            "invitation_code": code,
        },
        headers=auth_headers(),
    )
    assert reused.status_code == 400


def test_workspace_records_are_scoped_to_signed_in_user(client, monkeypatch, job):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    auth.attempts.clear()
    credentials = []
    with client.factory() as session:
        for username in ("pilot-one", "pilot-two"):
            user = AuthUser(
                username=username,
                password_hash=auth.hash_password(f"a sufficiently long password for {username}"),
                role="user",
                is_active=True,
                created_at=utcnow(),
                password_changed_at=utcnow(),
            )
            session.add(user)
            credentials.append((username, f"a sufficiently long password for {username}"))
        session.commit()

    def sign_in(credentials):
        result = client.post(
            "/api/auth/login",
            json={"username": credentials[0], "password": credentials[1]},
            headers=auth_headers(),
        )
        assert result.status_code == 200
        return auth_headers(result.json()["csrf_token"])

    first_headers = sign_in(credentials[0])
    assert client.post("/api/jobs", json=job, headers=first_headers).status_code == 201
    second_headers = sign_in(credentials[1])
    second_job = job | {
        "job_title": "Different Backend Engineer",
    }
    assert client.post("/api/jobs", json=second_job, headers=second_headers).status_code == 201
    assert [item["job_title"] for item in client.get("/api/jobs").json()["items"]] == [
        "Different Backend Engineer"
    ]
    first_headers = sign_in(credentials[0])
    assert [item["job_title"] for item in client.get("/api/jobs").json()["items"]] == [
        "Backend Engineer"
    ]


def test_admin_routes_reject_regular_user(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    auth.attempts.clear()
    username, password = provision(client)
    login = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers=auth_headers(),
    ).json()
    assert client.get("/api/admin/users").status_code == 403
    assert (
        client.post(
            "/api/admin/invitations", json={}, headers=auth_headers(login["csrf_token"])
        ).status_code
        == 403
    )


def test_disabled_account_cannot_login(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    auth.attempts.clear()
    username, password = provision(client)
    with client.factory() as session:
        user = session.scalar(select(AuthUser).where(AuthUser.username == username))
        user.is_active = False
        session.commit()
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers=auth_headers(),
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Username or password is incorrect"


def test_admin_can_manage_accounts_but_cannot_disable_last_admin(client, monkeypatch):
    monkeypatch.setattr(app.state, "auth_required", True)
    monkeypatch.setattr(app.state, "secure_cookies", False)
    auth.attempts.clear()
    with client.factory() as session:
        admin = AuthUser(
            username="owner-admin",
            password_hash=auth.hash_password("a sufficiently long admin password"),
            role="admin",
            is_active=True,
            created_at=utcnow(),
            password_changed_at=utcnow(),
        )
        user = AuthUser(
            username="managed-user",
            password_hash=auth.hash_password("a sufficiently long user password"),
            role="user",
            is_active=True,
            created_at=utcnow(),
            password_changed_at=utcnow(),
        )
        session.add_all([admin, user])
        session.commit()
        admin_id, user_id = admin.id, user.id
    login = client.post(
        "/api/auth/login",
        json={"username": "owner-admin", "password": "a sufficiently long admin password"},
        headers=auth_headers(),
    ).json()
    headers = auth_headers(login["csrf_token"])
    assert client.get("/api/admin/users").status_code == 200
    assert (
        client.patch(
            f"/api/admin/users/{user_id}",
            json={"role": "user", "is_active": False},
            headers=headers,
        ).status_code
        == 200
    )
    denied = client.patch(
        f"/api/admin/users/{admin_id}",
        json={"role": "user", "is_active": False},
        headers=headers,
    )
    assert denied.status_code == 409
    assert "at least one active administrator" in denied.json()["detail"]


def test_tenant_migration_assigns_existing_hosted_rows_to_existing_user(tmp_path, monkeypatch):
    engine = make_engine(f"sqlite:///{tmp_path / 'prior-hosted.db'}")
    monkeypatch.setattr("app.db.engine", engine)
    config = Config(str(ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "6e3d3b7b9a12")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO auth_users (id, username, password_hash, created_at, "
                    "password_changed_at) VALUES (7, 'existing-admin', 'hash', 'now', 'now')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO companies (name, normalized_name, created_at, updated_at) "
                    "VALUES ('Fictional Orbit', 'fictional orbit', 'now', 'now')"
                )
            )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            owner_id = connection.scalar(text("SELECT owner_id FROM companies"))
            role = connection.scalar(text("SELECT role FROM auth_users WHERE id = 7"))
        assert owner_id == 7
        assert role == "admin"
    finally:
        engine.dispose()


def test_password_hash_uses_scrypt_and_verifies_without_plaintext():
    encoded = auth.hash_password("a sufficiently long fictional password")
    assert encoded.startswith("scrypt$")
    assert auth.verify_password("a sufficiently long fictional password", encoded)
    assert not auth.verify_password("different password", encoded)


def test_production_configuration_requires_auth_https_and_external_storage(tmp_path):
    configured = {
        "ROLEPILOT_AUTH_REQUIRED": "1",
        "ROLEPILOT_COOKIE_SECURE": "1",
        "ROLEPILOT_PUBLIC_ORIGIN": "https://career.adityamore.dev",
        "ROLEPILOT_ALLOWED_HOSTS": "career.adityamore.dev",
        "ROLEPILOT_DATA_DIR": str(tmp_path / "data"),
        "ROLEPILOT_LIBRARY_ROOT": str(tmp_path / "library"),
        "ROLEPILOT_DOCUMENT_STORAGE": str(tmp_path / "documents"),
        "ROLEPILOT_BACKUP_DIR": str(tmp_path / "backups"),
    }
    checkout = tmp_path / "checkout"
    validate_production_environment(configured, checkout_root=checkout)
    with pytest.raises(ValueError, match="HTTPS"):
        validate_production_environment(
            configured | {"ROLEPILOT_PUBLIC_ORIGIN": "http://example.org"}
        )
    with pytest.raises(ValueError, match="outside the source checkout"):
        validate_production_environment(
            configured | {"ROLEPILOT_DATA_DIR": str(checkout / "data")},
            checkout_root=checkout,
        )
    with pytest.raises(ValueError, match="ROLEPILOT_PUBLIC_ORIGIN"):
        validate_production_environment(configured | {"ROLEPILOT_PUBLIC_ORIGIN": ""})
    with pytest.raises(ValueError, match="ROLEPILOT_ALLOWED_HOSTS"):
        validate_production_environment(configured | {"ROLEPILOT_ALLOWED_HOSTS": ""})
    with pytest.raises(ValueError, match="ROLEPILOT_BACKUP_DIR"):
        validate_production_environment(
            configured | {"ROLEPILOT_BACKUP_DIR": ""}, checkout_root=checkout
        )
