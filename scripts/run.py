"""Start both loopback-only services; stop children together with Ctrl+C."""

import os
import socket
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
VITE = ROOT / "frontend/node_modules/vite/bin/vite.js"


def main():
    if not PYTHON.exists() or not VITE.exists():
        raise SystemExit("Run the installation commands in README.md first.")
    for port in (8000, 5173):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(
                    f"Port {port} is in use. Stop the existing RolePilot service first."
                )
    current = subprocess.run(
        [str(PYTHON), "-m", "alembic", "current"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    heads = subprocess.run(
        [str(PYTHON), "-m", "alembic", "heads"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if current.strip() != heads.strip():
        if current.strip():
            backup_path = subprocess.run(
                [str(PYTHON), str(ROOT / "deploy/scripts/backup.py"), "--backup"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            subprocess.run(
                [str(PYTHON), str(ROOT / "deploy/scripts/backup.py"), "--verify", backup_path],
                cwd=ROOT,
                check=True,
            )
        subprocess.run([str(PYTHON), "-m", "alembic", "upgrade", "head"], cwd=ROOT, check=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    children = []
    try:
        children.append(
            subprocess.Popen(
                [
                    str(PYTHON),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--app-dir",
                    "backend",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                ],
                cwd=ROOT,
                creationflags=flags,
            )
        )
        children.append(
            subprocess.Popen(
                ["node", str(VITE), "--host", "127.0.0.1"],
                cwd=ROOT / "frontend",
                creationflags=flags,
            )
        )
        print("RolePilot: http://127.0.0.1:5173  |  Ctrl+C stops both services.", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        raise SystemExit("A service stopped. Check the messages above (ports 8000 and 5173).")
    except KeyboardInterrupt:
        print("\nStopping RolePilot...", flush=True)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
