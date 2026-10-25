# RolePilot

I built RolePilot to make my own job search easier to manage. As a master's student, I wanted one place to organize job opportunities, keep track of applications, and learn how modern software tools can support a practical workflow.

RolePilot is a local-first career management application. It uses React and TypeScript for the interface, FastAPI and SQLAlchemy for the API, Alembic for database changes, and SQLite for local data. Hosted accounts use invitation codes and keep each user's workspace separate.

## What I can do with it

- Import job listings from Excel or CSV, review fields and duplicates, and keep the original source rows.
- Search and filter opportunities by employer, location, skills, work mode, experience, salary, and listing status.
- Track applications through a hiring pipeline, record follow-ups and tasks, and review status history and basic metrics.
- Keep company information and a read-only index of local resume and cover-letter files.
- Use invitation-only hosted accounts. Administrators can create or revoke invitations and manage account roles and access.

The current application does **not** call an AI or LLM service, scrape job sites, or submit applications. I plan to explore AI-assisted job scouting and role matching as a later step. Any future AI feature should keep suggested information separate from facts I have checked myself.

## Run it on your computer

The app starts with an empty database. It does not need cloud credentials, and it does not upload the files in your document library. See the [local setup guide](docs/LOCAL_SETUP.md) for Windows, macOS, and Linux instructions. The [user guide](docs/USER_GUIDE.md) explains the current features step by step.

## Project notes

- [Architecture and data model](docs/architecture.md)
- [CI/CD and GitHub workflow](docs/cicd.md)
- [Lightsail deployment preparation](deploy/README.md)
- [Current project checkpoint](docs/checkpoint.md)

GitHub Actions checks backend tests, frontend tests, integration behavior, and deployment files. A production deployment can run only after those checks pass for the same commit. The Lightsail deployment gate stays disabled until the server and its backups are ready.

## Privacy and data

In local mode, job-search records stay in the local SQLite database. Database files, resumes, cover letters, imports, exports, snapshots, backups, environment files, and runtime logs are excluded from Git. Hosted mode requires sign-in and stores records in SQLite on the server. Each hosted account sees only its own workspace data; administrators can manage account access and invitations, but cannot read another user's job records through the admin API.

Please read the [local setup guide](docs/LOCAL_SETUP.md) before sharing or cloning the project. Use fictional test records in development and keep personal career documents out of the repository.

## Checks I run

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
