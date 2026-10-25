"""Real HTTP smoke test through Vite's proxy, using a temporary SQLite database.

No browser automation: verifies servers, routing, uploads, persistence and API integration.
Run with .venv/Scripts/python scripts/smoke.py. Ports 8000/5173 must be free.
"""

import os
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
BACKEND_PORT = int(os.environ.get("ROLEPILOT_SMOKE_BACKEND_PORT", "8000"))
FRONTEND_PORT = int(os.environ.get("ROLEPILOT_SMOKE_FRONTEND_PORT", "5173"))


def wait_ready(url, child):
    for _ in range(100):
        if child.poll() is not None:
            raise RuntimeError(f"Service exited before readiness: {url}")
        try:
            response = httpx.get(url, timeout=1)
            if response.status_code == 200:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise RuntimeError(f"Service did not become ready: {url}")


def main():
    for port in (BACKEND_PORT, FRONTEND_PORT):
        import socket

        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(f"Port {port} is in use. Stop RolePilot before the smoke test.")
    with tempfile.TemporaryDirectory(prefix="rolepilot-smoke-") as temporary:
        env = os.environ | {
            "ROLEPILOT_DATA_DIR": temporary,
            "ROLEPILOT_LIBRARY_ROOT": str(Path(temporary) / "library"),
            "ROLEPILOT_API_TARGET": f"http://127.0.0.1:{BACKEND_PORT}",
        }
        env.pop("ROLEPILOT_DATABASE_URL", None)
        library_root = Path(env["ROLEPILOT_LIBRARY_ROOT"])
        source = library_root / "Resumes" / "resume_03Apr_v1" / "resume.txt"
        source.parent.mkdir(parents=True)
        source.write_text("Synthetic original resume")
        (library_root / "cover_letters").mkdir()
        subprocess.run(
            [str(PYTHON), "-m", "alembic", "upgrade", "head"], cwd=ROOT, env=env, check=True
        )
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
                        str(BACKEND_PORT),
                    ],
                    cwd=ROOT,
                    env=env,
                    creationflags=FLAGS,
                )
            )
            children.append(
                subprocess.Popen(
                    [
                        "node",
                        str(ROOT / "frontend/node_modules/vite/bin/vite.js"),
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(FRONTEND_PORT),
                    ],
                    cwd=ROOT / "frontend",
                    env=env,
                    creationflags=FLAGS,
                )
            )
            wait_ready(f"http://127.0.0.1:{BACKEND_PORT}/api/health", children[0])
            wait_ready(f"http://127.0.0.1:{FRONTEND_PORT}", children[1])
            with httpx.Client(
                base_url=f"http://127.0.0.1:{FRONTEND_PORT}",
                headers={"x-rolepilot": "local"},
                timeout=10,
            ) as client:
                assert 'id="root"' in client.get("/").text
                assert client.get("/src/main.tsx").status_code == 200
                assert client.get("/api/health").json()["status"] == "ok"
                documents = client.get("/api/documents").json()
                assert documents["total"] == 1, documents
                document_id = documents["items"][0]["id"]
                original_hash = documents["items"][0]["file_hash"]
                assert client.get("/api/document-library").json()["available"]
                workbook = client.get("/api/template.xlsx?sample=true").content
                preview = client.post(
                    "/api/imports/preview", files={"file": ("sample.xlsx", workbook)}
                ).json()
                assert not preview["rows"][0]["errors"]
                response = client.post(
                    f"/api/imports/{preview['id']}/commit",
                    json={
                        "decisions": [{"row_number": 2, "action": "insert"}],
                    },
                )
                assert response.status_code == 200, response.text
                assert response.json()["inserted"] == 1
                listing = client.get("/api/jobs?q=Backend&skill=python").json()
                assert listing["total"] == 1
                job = listing["items"][0]
                assert client.get(f"/api/jobs/{job['id']}").json()["provenance"]
                for archived, revision in [(True, 1), (False, 2)]:
                    response = client.post(
                        f"/api/jobs/{job['id']}/archive",
                        json={
                            "archived": archived,
                            "expected_revision": revision,
                        },
                    )
                    assert response.status_code == 200, response.text
                assert client.get("/api/overview").json()["total_jobs"] == 1
                source.write_text("Synthetic external modification before restart")
                children[0].terminate()
                children[0].wait(timeout=10)
                children[0] = subprocess.Popen(
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
                        str(BACKEND_PORT),
                    ],
                    cwd=ROOT,
                    env=env,
                    creationflags=FLAGS,
                )
                wait_ready(f"http://127.0.0.1:{BACKEND_PORT}/api/health", children[0])
                assert client.get("/api/jobs").json()["total"] == 1
                updated_document = client.get(f"/api/documents/{document_id}").json()
                assert updated_document["file_hash"] != original_hash
                assert len(updated_document["revisions"]) == 2
                assert client.get("/api/documents").json()["total"] == 1
            print(
                "PASS: Vite proxy -> FastAPI -> SQLite import, search, archive/restore, "
                "library startup scan and restart."
            )
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
            for child in children:
                child.wait(timeout=10)


if __name__ == "__main__":
    main()
