# Run RolePilot locally

This guide is for people who want to inspect the project or run their own local copy. I use Windows, but the same source also runs on macOS and Linux. Local setup does not need an AWS account or application credentials.

## Requirements

- Git
- Python 3.12 or newer
- Node.js 24 LTS and npm
- A terminal with permission to create files in the project folder

The repository is available at <https://github.com/Skywalker1910/RolePilot>. The project uses the MIT License. A clone is a separate workspace; it does not connect to my local database or personal documents.

## Windows PowerShell

```powershell
git clone https://github.com/Skywalker1910/RolePilot.git
Set-Location RolePilot
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install --no-deps -e .
npm --prefix frontend ci
.\.venv\Scripts\python.exe scripts\run.py
```

Open <http://127.0.0.1:5173>. The launcher starts the frontend and API on loopback. Press Ctrl+C in that terminal to stop both services. The default ports are 5173 for Vite and 8000 for FastAPI; make sure they are free first.

If Node reports a certificate-chain error on a managed Windows computer, try the Windows certificate store:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm --prefix frontend ci
```

Do not turn off TLS certificate validation.

## macOS and Linux

```bash
git clone https://github.com/Skywalker1910/RolePilot.git
cd RolePilot
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
npm --prefix frontend ci
.venv/bin/python scripts/run.py
```

Open <http://127.0.0.1:5173>. Press Ctrl+C to stop the launcher. If the launcher is not suitable for your shell, start each service in a separate terminal:

```bash
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
npm --prefix frontend run dev
```

The API documentation is available at <http://127.0.0.1:8000/docs> while the backend is running.

## Local data and documents

The first launch creates a local SQLite database under `data/`. Git ignores the database and its WAL/SHM files. Alembic migrations create the schema. RolePilot does not seed demo jobs; you can import the explicitly fictional sample from the Import page.

The local document index reads metadata from a selected folder. It does not copy or change those source files. Choose a directory that contains a `Resumes` folder and/or a `cover_letters` folder, then set it in **Settings → Document library**. Do not point the library setting at this repository.

The local app is meant to stay on your computer. The API binds to `127.0.0.1`, and local write requests require the frontend's local request header. Do not expose the development server to the internet. Hosted login is enabled only when a server operator configures the hosted environment.

## Validate your copy

```powershell
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check backend tests scripts deploy/scripts
.venv\Scripts\python.exe -m ruff format --check backend tests scripts deploy/scripts
.venv\Scripts\python.exe scripts\check_migrations.py
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

The migration check uses a fresh temporary database. The test and integration suites use synthetic records; they do not use your main local database. For the HTTP smoke check, stop other RolePilot instances first, then run `.venv\Scripts\python.exe scripts\smoke.py` (or `.venv/bin/python scripts/smoke.py` on macOS/Linux). It starts test-only backend and frontend processes on temporary ports.

## Common problems

- **A port is busy:** stop the process using port 5173 or 8000 before launching RolePilot.
- **Import says the database is behind:** close the app and run the Alembic upgrade command shown above. The launcher normally makes a consistent backup before upgrading an existing database.
- **The document index reports a missing folder:** choose a valid directory in Settings. A missing root does not delete database records.
- **The local API returns an authentication error:** make sure the UI is using the Vite proxy and that the API is running on the configured loopback port.
- **You see no jobs:** this is expected in a fresh database. Import your own file or use the clearly marked fictional sample.

For feature behavior, see the [user guide](USER_GUIDE.md). For code structure and data relationships, see the [architecture notes](architecture.md).
