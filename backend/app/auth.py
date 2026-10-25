"""Local single-user login and server-side, revocable sessions."""

from __future__ import annotations

import base64
import hashlib
import hashlib as _hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .auth_models import AuthInvitation, AuthSession, AuthUser
from .db import get_session, utcnow

router = APIRouter(prefix="/api/auth", tags=["authentication"])
SESSION_COOKIE = "rolepilot_session"
SESSION_HOURS = 12
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LIMIT = 5
attempts: dict[str, deque[float]] = defaultdict(deque)


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=1024)


class Signup(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=14, max_length=1024)
    invitation_code: str = Field(min_length=20, max_length=100)


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    current_password: str | None = Field(default=None, max_length=1024)
    new_password: str | None = Field(default=None, min_length=14, max_length=1024)

    @field_validator("display_name", "email", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        if value is not None and (
            value.count("@") != 1
            or value.startswith("@")
            or value.endswith("@")
            or "." not in value.rsplit("@", 1)[-1]
            or any(character.isspace() for character in value)
        ):
            raise ValueError("Enter a valid email address")
        return value.casefold() if value else None

    @model_validator(mode="after")
    def password_pair(self):
        if self.new_password and not self.current_password:
            raise ValueError("Enter your current password to change it")
        if self.current_password and not self.new_password:
            raise ValueError("Enter a new password")
        return self


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    cost, block_size, parallelism = 2**14, 8, 1
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=cost, r=block_size, p=parallelism, dklen=32
    )
    return "scrypt${}${}${}${}${}".format(
        cost,
        block_size,
        parallelism,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, cost, block_size, parallelism, salt_text, hash_text = encoded.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(hash_text.encode("ascii"))
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(cost),
            r=int(block_size),
            p=int(parallelism),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, MemoryError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def invitation_digest(code: str) -> str:
    return _hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def session_from_request(request: Request, session: Session) -> AuthSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 128:
        return None
    now = datetime.now(UTC).isoformat()
    return session.scalar(
        select(AuthSession)
        .join(AuthUser, AuthUser.id == AuthSession.user_id)
        .where(
            AuthSession.token_hash == token_digest(token),
            AuthSession.expires_at > now,
            AuthUser.is_active.is_(True),
        )
    )


def session_user(record: AuthSession | None, session: Session) -> AuthUser | None:
    return session.get(AuthUser, record.user_id) if record else None


def issue_session(user: AuthUser, request: Request, response: Response, session: Session):
    previous = session_from_request(request, session)
    if previous is not None:
        session.delete(previous)
    raw_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    record = AuthSession(
        user_id=user.id,
        token_hash=token_digest(raw_token),
        csrf_token=csrf_token,
        created_at=utcnow(),
        expires_at=(datetime.now(UTC) + timedelta(hours=SESSION_HOURS)).isoformat(),
    )
    session.add(record)
    session.commit()
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=SESSION_HOURS * 60 * 60,
        httponly=True,
        secure=bool(request.app.state.secure_cookies),
        samesite="strict",
        path="/",
    )
    return {"authenticated": True, "csrf_token": csrf_token, "user": user_data(user)}


def user_data(user: AuthUser):
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "role": user.role,
    }


def profile_data(user: AuthUser):
    return user_data(user) | {
        "created_at": user.created_at,
        "password_changed_at": user.password_changed_at,
    }


def require_current_user(request: Request) -> AuthUser:
    user = getattr(request.state, "auth_user", None)
    if user is None or not user.is_active:
        raise HTTPException(401, "Authentication required")
    return user


@router.get("/session")
def auth_session(request: Request):
    required = bool(request.app.state.auth_required)
    record = getattr(request.state, "auth_session", None)
    return {
        "auth_required": required,
        "authenticated": not required or record is not None,
        "csrf_token": record.csrf_token if record else None,
        "user": user_data(request.state.auth_user) if record else None,
    }


@router.get("/profile")
def get_profile(user: AuthUser = Depends(require_current_user)):
    return profile_data(user)


@router.patch("/profile")
def update_profile(
    body: ProfileUpdate,
    request: Request,
    session: Session = Depends(get_session),
    user: AuthUser = Depends(require_current_user),
):
    if "display_name" in body.model_fields_set:
        user.display_name = body.display_name
    if "email" in body.model_fields_set:
        duplicate = (
            session.scalar(
                select(AuthUser.id).where(AuthUser.email == body.email, AuthUser.id != user.id)
            )
            if body.email
            else None
        )
        if duplicate:
            raise HTTPException(409, "That email address is already in use")
        user.email = body.email
    if body.new_password:
        if not verify_password(body.current_password or "", user.password_hash):
            raise HTTPException(400, "Current password is incorrect")
        user.password_hash = hash_password(body.new_password)
        user.password_changed_at = utcnow()
        current_session = getattr(request.state, "auth_session", None)
        for auth_session_record in session.scalars(
            select(AuthSession).where(AuthSession.user_id == user.id)
        ):
            if current_session is None or auth_session_record.id != current_session.id:
                session.delete(auth_session_record)
    session.commit()
    return profile_data(user)


@router.post("/login")
def login(
    body: Credentials,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    if not request.app.state.auth_required:
        raise HTTPException(404, "Authentication is not enabled")
    expected_origin = request.app.state.public_origin
    if request.headers.get("origin") != expected_origin:
        raise HTTPException(403, "Login must originate from the configured RolePilot site")
    now = time.monotonic()
    key = request.client.host if request.client else "unknown"
    recent = attempts[key]
    while recent and recent[0] <= now - LOGIN_WINDOW_SECONDS:
        recent.popleft()
    if len(recent) >= LOGIN_LIMIT:
        raise HTTPException(429, "Too many login attempts. Try again in 15 minutes.")
    recent.append(now)

    user = session.scalar(select(AuthUser).where(AuthUser.username == body.username))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Username or password is incorrect")

    recent.clear()
    return issue_session(user, request, response, session)


@router.post("/signup", status_code=201)
def signup(
    body: Signup,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    if not request.app.state.auth_required:
        raise HTTPException(404, "Account signup is available only in hosted mode")
    if request.headers.get("origin") != request.app.state.public_origin:
        raise HTTPException(403, "Signup must originate from the configured RolePilot site")
    now = time.monotonic()
    key = request.client.host if request.client else "unknown"
    recent = attempts[f"signup:{key}"]
    while recent and recent[0] <= now - LOGIN_WINDOW_SECONDS:
        recent.popleft()
    if len(recent) >= LOGIN_LIMIT:
        raise HTTPException(429, "Too many signup attempts. Try again in 15 minutes.")
    recent.append(now)
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "Username cannot be blank")
    session.execute(text("BEGIN IMMEDIATE"))
    if session.scalar(select(AuthUser.id).where(AuthUser.username == username)):
        raise HTTPException(409, "That username is already in use")
    invitation = session.scalar(
        select(AuthInvitation).where(
            AuthInvitation.code_hash == invitation_digest(body.invitation_code),
            AuthInvitation.used_by_user_id.is_(None),
            AuthInvitation.revoked_at.is_(None),
        )
    )
    if invitation is None:
        raise HTTPException(400, "Invitation code is invalid, used, or revoked")
    user = AuthUser(
        username=username,
        password_hash=hash_password(body.password),
        role="user",
        is_active=True,
        created_at=utcnow(),
        password_changed_at=utcnow(),
    )
    session.add(user)
    session.flush()
    invitation.used_by_user_id = user.id
    invitation.used_at = utcnow()
    user.invitation_id = invitation.id
    session.flush()
    return issue_session(user, request, response, session)


@router.post("/logout")
def logout(request: Request, response: Response, session: Session = Depends(get_session)):
    record = getattr(request.state, "auth_session", None)
    if record is not None:
        stored = session.get(AuthSession, record.id)
        if stored is not None:
            session.delete(stored)
        session.commit()
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=bool(request.app.state.secure_cookies),
        samesite="strict",
    )
    return {"authenticated": False}
