"""Admin-only account and invitation management."""

import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import invitation_digest
from .auth_models import AuthInvitation, AuthSession, AuthUser
from .db import get_session, utcnow

router = APIRouter(prefix="/api/admin", tags=["administration"])
DB = Annotated[Session, Depends(get_session)]


def require_admin(request: Request) -> AuthUser:
    user = getattr(request.state, "auth_user", None)
    if user is None or user.role != "admin" or not user.is_active:
        raise HTTPException(403, "Administrator access is required")
    return user


Admin = Annotated[AuthUser, Depends(require_admin)]


class UserUpdate(BaseModel):
    role: str = Field(pattern="^(admin|user)$")
    is_active: bool


def invitation_data(invitation: AuthInvitation, creator: AuthUser | None, used: AuthUser | None):
    return {
        "id": invitation.id,
        "status": "revoked"
        if invitation.revoked_at
        else "used"
        if invitation.used_by_user_id
        else "unused",
        "created_by": creator.username if creator else "Unknown",
        "created_at": invitation.created_at,
        "used_at": invitation.used_at,
        "used_by": used.username if used else None,
        "revoked_at": invitation.revoked_at,
    }


@router.get("/users")
def list_users(_admin: Admin, session: DB):
    users = session.scalars(select(AuthUser).order_by(AuthUser.created_at, AuthUser.id))
    invitation_ids = {
        invitation.used_by_user_id: invitation.id
        for invitation in session.scalars(
            select(AuthInvitation).where(AuthInvitation.used_by_user_id.is_not(None))
        )
    }
    return [
        {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "is_active": user.is_active,
            "created_at": user.created_at,
            "password_changed_at": user.password_changed_at,
            "invitation_id": invitation_ids.get(user.id),
        }
        for user in users
    ]


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: Admin, session: DB):
    user = session.get(AuthUser, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    would_remove_admin = (
        user.role == "admin" and user.is_active and (body.role != "admin" or not body.is_active)
    )
    if would_remove_admin:
        remaining = session.scalar(
            select(func.count(AuthUser.id)).where(
                AuthUser.role == "admin",
                AuthUser.is_active.is_(True),
                AuthUser.id != user.id,
            )
        )
        if not remaining:
            raise HTTPException(409, "RolePilot must keep at least one active administrator")
    user.role = body.role
    user.is_active = body.is_active
    if not user.is_active:
        for auth_session in session.scalars(
            select(AuthSession).where(AuthSession.user_id == user.id)
        ):
            session.delete(auth_session)
    session.commit()
    return {"id": user.id, "role": user.role, "is_active": user.is_active, "updated_by": admin.id}


@router.get("/invitations")
def list_invitations(_admin: Admin, session: DB):
    invitations = session.scalars(
        select(AuthInvitation).order_by(AuthInvitation.created_at.desc(), AuthInvitation.id.desc())
    )
    result = []
    for invitation in invitations:
        creator = session.get(AuthUser, invitation.created_by_user_id)
        used = (
            session.get(AuthUser, invitation.used_by_user_id)
            if invitation.used_by_user_id
            else None
        )
        result.append(invitation_data(invitation, creator, used))
    return result


@router.post("/invitations", status_code=201)
def create_invitation(admin: Admin, session: DB):
    code = "RP-" + secrets.token_urlsafe(32)
    invitation = AuthInvitation(
        code_hash=invitation_digest(code),
        created_by_user_id=admin.id,
        created_at=utcnow(),
    )
    session.add(invitation)
    session.commit()
    return {"id": invitation.id, "code": code, "created_at": invitation.created_at}


@router.delete("/invitations/{invitation_id}")
def revoke_invitation(invitation_id: int, _admin: Admin, session: DB):
    invitation = session.get(AuthInvitation, invitation_id)
    if invitation is None:
        raise HTTPException(404, "Invitation not found")
    if invitation.used_by_user_id is not None:
        raise HTTPException(409, "A used invitation stays linked to its account")
    if invitation.revoked_at is None:
        invitation.revoked_at = datetime.now(UTC).isoformat()
        session.commit()
    return {"id": invitation.id, "status": "revoked"}
