# Architecture and schema decisions

Document indexing was added after the original checkpoint: see [document library schema and API](document-library.md). The planned document tables below describe later capabilities; document_libraries, documents and document_revisions now exist.

## Current implementation

Phase 3.8 adds GitHub CI and gated release delivery; see [CI/CD trust boundaries](cicd.md). Four separate jobs validate the same commit before a production job can access environment-scoped SSH secrets. PR jobs have read-only repository permissions and no production credentials. Deployment remains opt-in through a repository variable and a root-owned server readiness flag.

Hosted source lives at `/opt/rolepilot/releases/<sha>` with a per-release Python virtual environment and an atomic `current` symlink. Nginx serves that release's built frontend; systemd runs one API worker as `rolepilot`. SQLite, documents and snapshots remain under `/var/lib/rolepilot`, with backups under `/var/backups/rolepilot/database`. A separate build user installs dependencies without runtime-data access. The SSH deployment user invokes a root-owned broker that validates the artifact, serializes updates, backs up the stopped writer and runs only explicitly approved migrations as the application user. Release cleanup only handles successful SHA directories and never persistent storage. Migration failure stops the service for review; code rollback is automatic only when no migration was attempted.

The repository root is the application root; no extra nested checkout is needed. A single FastAPI process owns the SQLite database. The React application communicates through a same-origin `/api` path. Local development remains loopback-only. Hosted deployment preparation adds one Uvicorn worker behind Nginx and server-side account authentication. Hosted domain records have an `owner_id`; SQLAlchemy session criteria scope each authenticated request to that account. Local mode keeps unowned records visible on the trusted local workstation. Hosted signup requires an administrator-issued one-time invitation, and invitation use is linked to the new account. Administrators can manage accounts and invitations without reading user career records. No external queue or cloud integration is required.

Dates are stored as UTC ISO 8601 strings including an offset, avoiding SQLite's loss of timezone information in native datetime conversions. Imported date-only values mean midnight UTC. The UI uses the browser locale/timezone. Missing numbers and restrictions are NULL.

| Table | Purpose and integrity |
| --- | --- |
| companies | Account-scoped normalized company name, display name and optional company metadata; jobs reference a stable integer ID. Case/whitespace normalization is conservative, not corporate-entity inference. |
| jobs | Account-scoped typed listing fields, canonical URL, normalized title/requisition, nullable facts, revision and separate archive timestamp. Canonical URL is unique inside an account; company + requisition also prevents duplicates. Null requisitions permit multiple jobs. Salary and experience ranges have SQL constraints. |
| skills | Stable skill IDs retain legacy names and add canonical/normalized names plus optional category. Known aliases (such as sklearn and scikit learn) map to one canonical concept; unknown skills are only case/whitespace normalized. |
| job_skill_tags | New composite job/skill/requirement relation for Required, Preferred or Keyword. The original `job_skills` table remains intact for compatibility and traceability; its records are copied into this table by the additive migration. |
| import_previews | Persisted original rows, mapping, reviewed results and committed batch ID. Preview does not create jobs. |
| import_batches | Filename, UTC time, processed/inserted/updated/skipped/rejected counts, validation errors and mapping metadata. Rejected is a subset of skipped, so processed = inserted + updated + skipped. |
| job_provenance | Every source row and normalized snapshot, optional batch/row references; manual updates also append snapshots. Source text is not executed. |
| activity_events | Append-only through current services: job creation/update, archive/restore and import completion. |
| applications | Separate user pursuit records; one per job until reapplication is designed. Stores pipeline stage, priority, follow-up, desired compensation, notes, independent archive state, and durable pending-confirmation state. Jobs remain application-free until the user starts or manually records an application. |
| application_status_history | Timestamped append-only stage transitions. SQLite triggers reject updates and deletes. Rejection archives the application; accepted offers are not auto-archived. |
| application_tasks | Application follow-up tasks with due and completion timestamps. Dashboard due counts include incomplete due tasks and overdue application follow-up dates. |
| auth_users, auth_sessions | Hosted accounts with a salted scrypt password hash, role, enabled state, opaque hashed session token, CSRF token, and server-side expiry/revocation. The first administrator is provisioned on the server. Later accounts require a one-time invitation. |
| auth_invitations | Hashed invitation code, issuing administrator, optional consuming user, and creation/use/revocation timestamps. A code can be consumed once and remains associated with that account. The raw value is shown only on creation. |

SQLAlchemy relationships connect companies/jobs, jobs/skills and jobs/provenance. Indexes cover company, title, city, normalized title, imported time, archive and provenance lookups. Foreign keys reject orphan records. There is no hard-delete endpoint.

Write operations use transactions. Import commits lock before rechecking duplicates and revisions. A changed target forces a fresh review. Multi-record imports roll back fully on failure. The UI approves all replacements for an update, including nulls; locally edited fields are separately flagged. Changes are not patched silently.

Search currently performs escaped SQL substring matching across relevant fields and skill relations. It is not an FTS5 relevance index. Server pagination limits returned rows to 100; the UI uses 25. Import limits bound preview size. Future measured performance work can introduce FTS5 without changing job identity.

## API contract

All paths use /api. OpenAPI is served at /openapi.json and the interactive explorer at /docs.

| Method and path | Behavior |
| --- | --- |
| GET /health | Database and Alembic version check |
| GET /fields | Accepted normalized job input field names |
| GET /jobs | Search and combined company/location/skill/work mode/employment/seniority/experience/salary/eligibility/verification/date filters, shortlist/archive, sort and server pagination |
| POST /jobs | Full validated JobInput; duplicate detection before creation |
| GET /jobs/{id} | Full job and source snapshots |
| PUT or PATCH /jobs/{id} | Full JobInput plus expected_revision; optimistic concurrency |
| DELETE /jobs/{id} | Reversible archive operation; preserves source provenance |
| PATCH /jobs/{id}/shortlist | Shortlist flag and expected_revision |
| POST /jobs/{id}/archive | archived boolean and expected_revision; reversible |
| GET, POST /companies | Company lookup/create; normalized exact-name deduplication |
| GET, PATCH /companies/{id} | Company metadata, related jobs and optimistic edit check |
| GET /skills | Canonical skill vocabulary with related-job counts |
| GET /overview | Active-job counts, company distribution, recent jobs/activity and application metrics |
| GET /template.xlsx | Blank official `jobs` schema v1.0 workbook; optional explicit fictional sample |
| POST /imports/preview | XLSX/UTF-8 CSV; reads `jobs` or accepts a selected worksheet; original rows, auto mapping, validation, duplicate candidates, field conflicts |
| POST /imports/{id}/review | mapping and optional row-number-keyed corrections |
| POST /imports/{id}/commit | Exactly one decision per row; insert/update/skip, target ID/revision and explicit approval |
| GET /imports | Most recent 100 committed batches |
| GET /template.xlsx?sample=true | Excel template or explicitly fictional sample |
| GET /applications | Filtered, paginated application list with job, stage, history and tasks |
| GET /applications/pending-confirmations | Due unresolved Apply-flow confirmations; querying it does not change state |
| GET /applications/{id} | Application details and complete status history |
| POST /jobs/{id}/apply | Persist a Pending Application and confirmation reminder before opening the employer portal |
| POST /applications/manual | Manually record an earlier application; unknown applied dates remain NULL |
| POST /applications/{id}/confirm | Confirm applied, not yet, archive, or remind later |
| POST /applications/{id}/status | Append a hiring-stage transition and auto-archive Rejected |
| PATCH /applications/{id} | Update application details with optimistic revision check |
| POST /applications/{id}/archive | Reversible application archive/restore |
| POST/PATCH /applications/{id}/tasks | Add or complete follow-up tasks |
| GET /application-metrics | Application counts, stage distribution, rates and dated submission series |
| GET /auth/session, POST /auth/login, POST /auth/signup, POST /auth/logout | Hosted session discovery and login/logout. Signup needs a valid one-time invitation. All other private `/api` routes require an active hosted session; every mutation also requires the session CSRF token. |
| GET /admin/users, PATCH /admin/users/{id} | Administrator-only account list, role changes, and access enable/disable. At least one active administrator must remain. Disabling an account revokes its sessions but retains its workspace. |
| GET /admin/invitations, POST /admin/invitations, DELETE /admin/invitations/{id} | Administrator-only invitation lifecycle. Full invitation text is returned only when a code is created; used invitations remain associated with their account. |

422 means invalid input requiring correction. 409 means identity/revision/replay conflict requiring review. 404 means the requested job/preview does not exist. 403 means the local-write request guard rejected the origin/header. No external HTTP requests occur during URL validation.

## Planned relational extensions

Each phase adds explicit Alembic migrations and tests; unused future tables are not created early.

- **Applications and history:** implemented in `f347a18c2c10`. See current tables and endpoints above. `job_id` is unique, and archived records retain that slot; reapplication is not supported yet. Browser-focus events only trigger a check for persisted unresolved confirmations. The confirmation action is explicit.
- **Contacts:** optional company_id FK, full_name, title, LinkedIn URL, email, type, connection_status, last_contacted_at, next_follow_up_at, notes, timestamps. **ApplicationContacts** is a many-to-many join so a contact can support multiple applications.
- **ContactInteractions:** contact_id FK, nullable application_id FK, interaction_type, occurred_at, message, response, next_action. Messages are manually recorded; no automatic sending.
- **Documents:** document_type, title, local relative path, original filename, version, timestamps; add content hash and document-family ID for immutable version lineage. **ApplicationDocuments:** application_id/document_id composite key plus usage_type and attached_at; exact submitted versions retained.
- **Verified career profile:** normalized education, employment, skills, projects and accomplishments with verification flags and source references. AI suggestions live separately from approved facts. Never infer unverified credentials or metrics into verified records.
- **Interviews:** application_id FK, interview_type, custom round, scheduled_at UTC, IANA timezone, duration_minutes, validated meeting URL, interviewer, outcome, notes. Preparation tasks reference the relevant application.
- **Tasks:** application-scoped task records exist. Contact-linked tasks and in-app notification scheduling remain future work. Due counts are visible in the dashboard while RolePilot is open; no background alerts run when stopped.
- **Saved filters:** later database-backed named views; current single browser-local saved view is intentionally lightweight.
- **AI operations:** explicit provider/request consent, structured validated outputs and provenance separated from facts. No background cloud transmission.
- **Backup manifests:** schema/app version and file hashes. Online SQLite backup API plus document snapshots; restore into staging, check integrity and foreign keys, then replace with a rollback copy.

Status values will match the product specification, with archival as a distinct attribute. Application metrics will use submitted applications (applied_at present), not discovered jobs, as the response/interview-rate denominator. Interview conversion counts distinct applications with an interview; multiple rounds never inflate the numerator.

## Hosted security and persistence

Hosted mode (`ROLEPILOT_AUTH_REQUIRED=1`) requires HTTPS origin, Secure cookies, explicit host allow-list and absolute persistent storage outside the checkout. Mutating API requests require the configured Origin and per-session CSRF token. A one-time server CLI provisions the first administrator. Later users need an administrator-created invitation; public registration without a code is rejected. SQLAlchemy request sessions filter workspace records by authenticated owner. The additive tenant migration assigns existing hosted single-user records to the existing account and does not reset job/application/document data. New accounts get a separate read-only document-library root under the configured library directory. The API remains bound to loopback behind Nginx. Uvicorn is a single systemd-managed worker to limit SQLite write contention. The exact production procedure, Nginx/systemd files, online SQLite backup, retention and restore are documented in [deploy/README.md](../deploy/README.md).
