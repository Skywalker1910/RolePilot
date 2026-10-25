# Document library integration — Phase 1

## Delivered

RolePilot now indexes an ordinary local folder without changing its contents or directory structure. There is no Git integration, repository initialization, submodule or commit tracking.

The default root is `~/RolePilot/library`. The active setting lives in SQLite's `document_libraries` table. On a new database, `ROLEPILOT_LIBRARY_ROOT` can override the initial default; after initialization, use Settings. The value is independent of `ROLEPILOT_DATA_DIR`.

Use **Settings → Document library**:
1. Paste the absolute local root path.
2. Select **Validate folder & references**.
3. Review matching, changed, missing and unreadable paths.
4. Explicitly approve discrepancies if any, then **Save root & index**.

Reconnecting preserves the library ID and document IDs for existing relative paths. It does not copy, move, delete or overwrite either folder. Select the parent of Resumes/ and cover_letters/, not an individual version folder. At least one expected scan directory must exist. UNC/network roots, relative roots, symlinks and junctions are rejected.

The browser does not expose a trustworthy desktop absolute path via an upload picker; this phase uses an editable path field. A native folder chooser is deferred.

## Source discovery

Only Resumes/ and cover_letters/ are scanned, recursively. Supported extensions: pdf, docx, doc, txt, md, markdown, tex. Unsupported files are counted as ignored. Hidden resources, .claude and src are excluded even when nested beneath a scan directory. Root-level documents remain outside the index. No LaTeX build scripts, macros or document instructions are executed.

The library may contain final documents, editable source files, notes and build resources. The index only includes supported file types inside `Resumes/` and `cover_letters/`; other resources are ignored. Root-level files are intentionally excluded.

Files start **Unreviewed**. PDF/DOCX/DOC files receive a suggested Resume or Cover Letter category from their scan tree. Text, Markdown and LaTeX files start as Supporting Document so source fragments and notes are not represented as final application documents. Version labels preserve matching resume_<day><month>_v<number>[_suffix] folder names without guessing a year. Company/role folders are stored verbatim as folder hints; no company record or role is inferred from folder names.

Manual metadata edits can correct category, status, version, company association, role label and notes. Company choices refer to existing RolePilot companies. The API also supports a validated job association. This is a metadata association, **not an application submission**. Master is explicitly selected by the user and is never inferred. Submitted cannot be set by this phase's metadata endpoint.

## Working UI

**Document Studio** currently provides a metadata inventory with:
- Filename/path/company/role search.
- Recursive folder, category and extension filters.
- Modified-date sorting and pagination.
- Version labels, source-folder hints, file size and stable document IDs.
- Manual metadata editing and checksum/timestamp inspection.
- Missing/unverified warnings and manual refresh.
- Potential move candidates for review, with no automatic identity merging.

This is the Phase 1 inventory, not the complete Phase 2 explorer. No content preview, desktop open/reveal, text comparison or submitted usage count is claimed yet.

## Index integrity and synchronization

Startup and manual refresh scan source files read-only. Hashing uses SHA-256 in chunks; source size/mtime/inode checks reject files changing during a read. Times are UTC. File creation time is populated only where the OS exposes birth time; metadata-change time is never substituted.

Stable identity is (library_id, case-folded relative path), not the checksum. Duplicate bytes in different paths remain distinct documents. Repeated scans do not duplicate records or checksum observations. Content changes append DocumentRevisions metadata. User-corrected labels and associations survive rescans.

Missing files remain indexed; they are never deleted automatically. A missing/inaccessible root preserves previously known per-file state and exposes a library warning. A subtree that cannot be inspected is marked unverified instead of assuming all its files were deleted. The last_verified_at timestamp is the last successful file read.

A renamed file currently appears as a new path plus a retained missing record. Matching hashes produce review candidates, including ambiguous multiple matches. Automatic or manual identity reconciliation is deferred to synchronization work; no potentially wrong identity is silently reused.

Limits: 64 MB per file, 20,000 visited directory entries per scan. Oversized, inaccessible and unsafe paths produce warnings. Scans serialize with other SQLite writes and run off the async event loop during startup. A background watcher and asynchronous progress UI are deferred.

## Schema and migration

Migration d8e1d744e754 adds three tables to the existing database:
- **document_libraries:** one configured root, revision, timestamps and last scan summary/error.
- **documents:** stable identity, relative path, filename/parent folder, format/category, version and folder hints, nullable company/job FKs, status, hash/size/OS timestamps, verification state, manual labels and optimistic revision.
- **document_revisions:** append-only observations of source path, version label, hash and observation time.

DocumentRevisions are **not file snapshots**: they retain no historical binary content. Old source contents cannot be recovered from the index. Submitted-document snapshots will be implemented with application associations in Phase 3, before this UI can label a document Submitted.

The migration is additive. Existing job/import data is preserved. A downgrade removes these new index tables and their metadata, so it is a developer operation requiring a backup; it never modifies the source collection. Upgrade/downgrade compatibility is tested on temporary databases.

## API

All write operations retain the existing local-origin/custom-header guard (X-RolePilot: local).

| Endpoint | Behavior |
| --- | --- |
| GET /api/document-library | Saved configuration, availability and last scan |
| POST /api/document-library/validate | Read-only reference/checksum verification at a proposed root |
| PUT /api/document-library | Reconnect with expected_revision and optional accept_unverified after explicit review |
| POST /api/document-library/scan | Read-only source scan, transactional metadata refresh |
| GET /api/documents | Paginated metadata; q/category/folder/format/missing filters |
| GET /api/documents/{id} | Metadata and checksum-observation history |
| PUT /api/documents/{id}/metadata | Validated manual metadata edit with expected_revision |

409 indicates stale state or relocation discrepancies needing approval. 422 indicates an invalid root, metadata or association. Source contents are not exposed by these Phase 1 endpoints.

## Backup and recovery at this checkpoint

Before a local migration, make a consistent SQLite backup using `sqlite3.Connection.backup()` or the provided backup helper. Runtime backups and library audit files are local data and are excluded from Git.

The index and its root setting are included in any SQLite backup. Automated library/snapshot backup and restore remain Phase 5 work; submitted snapshots do not exist yet. A database backup does not include the source document bytes.

For manual recovery: stop both app services; preserve the current database and any WAL/SHM companions together in a separate recovery folder; restore a verified SQLite backup as data/rolepilot.db (or the configured data directory), without stale WAL/SHM files alongside it; start through scripts/run.py to apply migrations; validate the library root in Settings and refresh. Keep the untouched source library separately backed up. Do not overwrite the only surviving copy of any database or source folder.

## Verified results and next phases

Synthetic temporary-directory tests cover supported recursive discovery, ignored resources, version labels, idempotency, duplicate content, external changes, missing/restored documents, relocation approval, root unavailability, preserved manual edits, stale updates, traversal, actual Windows junction rejection, database reopen and migration compatibility.

The two-server HTTP smoke test uses a synthetic library, validates startup indexing, then changes a file and restarts the backend to verify the same document ID and a new checksum observation. Tests do not write to a personal document library.

Verification at the original completion: backend and frontend tests, Ruff, ESLint, TypeScript/Vite, migration consistency, and the job-import smoke workflow passed. Personal library files are not test fixtures and are never part of the repository.

Remaining:
1. **Phase 2:** dedicated Resume/Cover Letter workspaces, previews, desktop opening/reveal and richer navigation.
2. **Phase 3:** application workflow (not present previously), application-document associations, explicit submitted confirmations, immutable file snapshots and integrity verification.
3. **Phase 4:** new version directories, collision-safe saves and reviewed cover-letter creation. Never overwrite existing files.
4. **Phase 5:** verified-profile-driven optional AI, text comparison, move reconciliation and database/snapshot/full-library backup options.

No cloud providers or AI architecture existed before this change. Phase 1 introduces none and transmits no documents.

Visual verification limitation: the in-app browser tool failed before connecting because of missing sandbox metadata. No rendered-browser verification is claimed for this checkpoint; component tests, the production build and actual local HTTP integration were verified.
