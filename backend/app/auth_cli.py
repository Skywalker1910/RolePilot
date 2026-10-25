"""One-time first-account provisioning. Invoke with `python -m app.auth_cli`."""

import getpass
import os
import sys

from sqlalchemy import select, text

from .auth import hash_password
from .auth_models import AuthUser
from .db import DATA, SessionLocal, utcnow

OWNED_TABLES = (
    "companies",
    "jobs",
    "job_provenance",
    "import_batches",
    "import_previews",
    "activity_events",
    "applications",
    "application_status_history",
    "application_tasks",
    "document_libraries",
    "documents",
    "document_revisions",
)


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] != "init-user":
        print("Usage: python -m app.auth_cli init-user", file=sys.stderr)
        return 2
    with SessionLocal() as session:
        if session.scalar(select(AuthUser.id).limit(1)) is not None:
            print("An account already exists. Public account setup is disabled.", file=sys.stderr)
            return 1
        username = input("RolePilot username: ").strip()
        if not username or len(username) > 120:
            print("Username must contain 1–120 characters.", file=sys.stderr)
            return 2
        password = getpass.getpass("Password (minimum 14 characters): ")
        confirmation = getpass.getpass("Confirm password: ")
        if len(password) < 14 or password != confirmation:
            print("Passwords must match and contain at least 14 characters.", file=sys.stderr)
            return 2
        session.add(
            user := AuthUser(
                username=username,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
                created_at=utcnow(),
                password_changed_at=utcnow(),
            )
        )
        session.flush()
        # If hosted authentication is enabled for an existing single-user database,
        # keep its records with the first administrator instead of hiding or sharing them.
        for table in OWNED_TABLES:
            session.execute(
                text(f"UPDATE {table} SET owner_id = :owner WHERE owner_id IS NULL"),
                {"owner": user.id},
            )
        session.commit()
    if os.name == "posix":
        os.chmod(DATA, 0o700)
        os.chmod(DATA / "rolepilot.db", 0o600)
    print("First RolePilot account created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
