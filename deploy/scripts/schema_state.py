"""Read current schema and candidate head; refuses a missing/empty database."""

import json
import sqlite3
from contextlib import closing

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.db import DATABASE_URL


def main():
    prefix = "sqlite:///"
    if not DATABASE_URL.startswith(prefix):
        raise ValueError("SQLite is required")
    with closing(sqlite3.connect(f"file:{DATABASE_URL[len(prefix) :]}?mode=ro", uri=True)) as db:
        current = [row[0] for row in db.execute("SELECT version_num FROM alembic_version")]
        if len(current) != 1:
            raise ValueError("Expected one existing schema revision")
        if not db.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone():
            raise ValueError("Initial hosted account must already exist")
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    head = script.get_current_head()
    # Reject unknown/divergent versions before touching data.
    list(script.iterate_revisions(head, current[0]))
    print(json.dumps({"current": current[0], "head": head}))


if __name__ == "__main__":
    main()
