"""Single-user authentication records for optional hosted deployments."""

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow


class AuthUser(Base):
    __tablename__ = "auth_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=False)
    role: Mapped[str] = mapped_column(
        String(20), default="user", server_default="user", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    created_at: Mapped[str] = mapped_column(default=utcnow, nullable=False)
    password_changed_at: Mapped[str] = mapped_column(default=utcnow, nullable=False)


class AuthInvitation(Base):
    __tablename__ = "auth_invitations"
    __table_args__ = (
        UniqueConstraint("used_by_user_id", name="uq_auth_invitations_used_by_user"),
        Index("ix_auth_invitations_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("auth_users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    used_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("auth_users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(default=utcnow, nullable=False)
    used_at: Mapped[str | None] = mapped_column(String(40))
    revoked_at: Mapped[str | None] = mapped_column(String(40))


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    # Match the historical migration: a UNIQUE constraint plus a separate index.
    __table_args__ = (Index("ix_auth_sessions_token_hash", "token_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[str] = mapped_column(default=utcnow, nullable=False)
    expires_at: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
