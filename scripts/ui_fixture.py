"""Isolated UI fixture server. Never opens the normal RolePilot database."""

import os
import socket
import subprocess
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
for port in (8021, 5178):
    with socket.socket() as connection:
        if connection.connect_ex(("127.0.0.1", port)) == 0:
            raise SystemExit(f"Fixture port {port} is occupied; no changes were made.")
DATA = ROOT / "tmp" / "ui-37"
DATA.mkdir(parents=True, exist_ok=True)
library = DATA / "library"
for relative in [
    "Resumes/resume_22Oct_v1/Resume.txt",
    "cover_letters/Fictional_Orbit/CoverLetter.txt",
]:
    source = library / relative
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("Fictional UI test document. No personal data.")
env = os.environ | {
    "ROLEPILOT_DATA_DIR": str(DATA),
    "ROLEPILOT_LIBRARY_ROOT": str(library),
    "ROLEPILOT_DOCUMENT_STORAGE": str(DATA / "documents"),
    "ROLEPILOT_BACKUP_DIR": str(DATA / "backups"),
    "ROLEPILOT_AUTH_REQUIRED": "0",
    "ROLEPILOT_API_TARGET": "http://127.0.0.1:8021",
}
env.pop("ROLEPILOT_DATABASE_URL", None)
python = str(ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
subprocess.run([python, "-m", "alembic", "upgrade", "head"], env=env, cwd=ROOT, check=True)
children = []
try:
    children.append(
        subprocess.Popen(
            [
                python,
                "-m",
                "uvicorn",
                "app.main:app",
                "--app-dir",
                "backend",
                "--host",
                "127.0.0.1",
                "--port",
                "8021",
            ],
            cwd=ROOT,
            env=env,
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
                "5178",
            ],
            cwd=ROOT / "frontend",
            env=env,
        )
    )
    client = httpx.Client(base_url="http://127.0.0.1:8021/api", headers={"X-RolePilot": "local"})
    for _ in range(60):
        try:
            if client.get("/health").status_code == 200:
                break
        except httpx.TransportError:
            pass
        time.sleep(0.5)
    if client.get("/jobs").json()["total"] == 0:
        for i, title in enumerate(
            [
                "Machine Learning Engineer",
                "Backend Engineer",
                "Product Engineer",
                "Data Scientist",
                "Platform Engineer",
                "AI Research Engineer",
            ]
        ):
            response = client.post(
                "/jobs",
                json={
                    "company_name": [
                        "Fictional Orbit",
                        "Fictional Northstar",
                        "Fictional Meridian",
                    ][i % 3],
                    "job_title": title,
                    "company_job_id": f"ENG-00{i}",
                    "canonical_job_url": f"https://example.com/jobs/{i}",
                    "location": "New York, NY" if i % 2 else "Boston, MA",
                    "remote_type": "Hybrid" if i % 2 else "Remote",
                    "minimum_experience": 2 if i % 2 else None,
                    "maximum_experience": 4 if i % 2 else None,
                    "salary_min": 110000 if i % 2 else None,
                    "salary_max": 160000 if i % 2 else None,
                    "salary_currency": "USD",
                    "salary_period": "Year",
                    "required_skills": [
                        "Python",
                        "SQL",
                        "PyTorch",
                        "Docker",
                        "AWS",
                        "Machine Learning",
                    ],
                    "preferred_skills": ["Kubernetes", "TypeScript"],
                    "full_description": (
                        "Build thoughtful software with a collaborative team.\n"
                        "Own reliable services and help improve the developer experience."
                    ),
                    "job_summary": "Help a small engineering team build reliable tools.",
                    "employment_type": "Full-time",
                },
            )
            response.raise_for_status()
            job = response.json()
            if i < 3:
                a = client.post(
                    "/applications/manual",
                    json={
                        "job_id": job["id"],
                        "current_status": ["Applied", "Technical Interview", "Under Review"][i],
                        "applied_at": "2026-10-20T12:00:00Z",
                    },
                )
                a.raise_for_status()
            else:
                client.patch(
                    f"/jobs/{job['id']}/shortlist",
                    json={"shortlisted": True, "expected_revision": job["revision"]},
                ).raise_for_status()
    print("UI fixture ready: http://127.0.0.1:5178", flush=True)
    while all(child.poll() is None for child in children):
        time.sleep(1)
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
