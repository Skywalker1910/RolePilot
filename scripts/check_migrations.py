"""Upgrade a fresh temporary SQLite DB and compare Alembic with ORM metadata."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="rolepilot-migrations-") as folder:
        env = os.environ | {
            "ROLEPILOT_DATA_DIR": folder,
            "ROLEPILOT_LIBRARY_ROOT": str(Path(folder) / "library"),
            "ROLEPILOT_AUTH_REQUIRED": "0",
            "PYTHONPATH": str(ROOT / "backend"),
        }
        env.pop("ROLEPILOT_DATABASE_URL", None)
        for args in (["upgrade", "head"], ["check"]):
            subprocess.run([sys.executable, "-m", "alembic", *args], cwd=ROOT, env=env, check=True)
    print("Fresh migration and ORM consistency passed; normal database was not opened.")


if __name__ == "__main__":
    main()
