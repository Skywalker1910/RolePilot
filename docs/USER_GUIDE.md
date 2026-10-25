# RolePilot user guide

I use RolePilot to keep the job-search process in one place. This guide covers the features that work in the current build and explains which ideas are still planned.

## Sign-in and accounts

### Local copy

A local copy starts without a login. It stores data in a SQLite database on the same computer and listens only on the loopback network interface. Do not expose the development server to the internet.

### Hosted account

Hosted mode shows a sign-in page. A new user can choose **Create an account** and enter a username, a password, and an invitation code. The code is created by a RolePilot administrator, works once, and is linked to the account that uses it. Passwords must be at least 14 characters.

The hosted app uses an expiring server-side session and a secure browser cookie. Signing out revokes the session. Disabled accounts cannot sign in. Each hosted account has its own jobs, companies, imports, applications, activity, and document index.

### Administrator access

The first administrator is provisioned by the server operator with the one-time command `python -m app.auth_cli init-user`. After signing in, an administrator sees **Administration** in the navigation.

In **Administration**, an administrator can:

- Create an invitation and copy its code. The full code is displayed only once; the database stores only its hash.
- View whether each code is unused, used, or revoked, along with the account that used it.
- Revoke an unused code. A used code remains connected to its account and cannot be reused or revoked.
- View usernames, roles, account status, creation dates, password-change dates, and invitation associations.
- Change an account between user and administrator, or turn account access on or off.

At least one active administrator must remain. Turning off an account retains its records. The admin API manages account access and invitations; it does not expose another user's private job-search records. Passwords and invitation-code hashes are never displayed.

## Overview

The Overview page gives me a summary of the opportunities and applications in my workspace. It includes current counts, application stages, items that need follow-up, recent changes, and application metrics. A fresh account has no sample records, so its dashboard starts empty.

## Opportunities

### Add opportunities

I can create a job directly or import a group of listings from Excel or CSV.

For an import:

1. Open **Import jobs** from the Opportunities area.
2. Download the blank workbook template or choose the clearly labelled fictional sample.
3. Select an `.xlsx` workbook or UTF-8 `.csv` file. The importer uses a worksheet named `jobs`; if the workbook has no such sheet, I choose the sheet to preview.
4. Map columns and correct missing or invalid values in the review screen.
5. Review exact and possible duplicates. RolePilot does not silently merge similar jobs.
6. Choose insert, update, or skip for each row and confirm the import.

The importer accepts up to 10 MB, 2,000 data rows, and 100 columns. Source rows and import decisions are retained in the local database for traceability. Spreadsheet formulas are read as text and are not evaluated.

### Search and review

Opportunities supports search and filters for employer, location, skills, work mode, employment type, seniority, experience, salary, sponsorship, citizenship, clearance, verification state, dates, and shortlist status. I can sort results, move between pages, and switch between card and table views. Company records are available from the Opportunities area.

Opening a job shows its listing details, known requirements, source URL, import provenance, and edit history. An employer link opens in a separate browser tab. RolePilot validates the URL format, but I still need to confirm that the employer and listing are genuine.

### Archive

Archiving hides a job from the active list while preserving its details. I can find it under **Archive** and restore it later. The normal delete action is reversible; it does not erase provenance.

## Applications

Applications are separate from discovered opportunities. Finding or importing a job does not create an application.

When I choose **Apply**, RolePilot first creates a **Pending Application** record and opens the employer's official link in another tab. When I return, the app asks whether I submitted the application. Only my confirmation changes its status; switching back to the tab does not mark it as submitted.

I can also add an application manually if I applied before using RolePilot. If I do not know the submission date, I leave it blank rather than guessing.

The Applications area includes:

- Card/table layouts and a Kanban view of the current page of applications.
- Hiring stages, priority, notes, referral status, desired compensation, and next follow-up date.
- A timestamped stage history. History entries are append-only.
- Follow-up tasks with due dates and completion status.
- Archive and restore controls. A rejection archives the application but preserves its history.
- Summary metrics. Response and interview rates use submitted applications as the denominator. Date charts include only applications with a known submission date.

An application accepted as an offer stays active until I archive it. RolePilot currently permits one application per job; reapplication is not supported yet.

## Documents

The Documents page indexes filenames and metadata in a folder that I choose. It does not upload, move, or edit the source files. It can show missing or changed files and keeps metadata observations for review; those observations are not saved file versions.

I can filter by category, folder, format, and availability, and switch between card and table layouts. Settings can validate a new library root before reconnecting it. A root should contain a `Resumes` folder and/or a `cover_letters` folder.

The current document feature does not preview files, open files from the browser, preserve submitted binary snapshots, or transfer my local library to a hosted server.

## Settings and keyboard shortcut

Settings lets me choose the light or dark theme and review the database schema and API status. Theme preference is saved in this browser. The shortcut **Ctrl+K** (or **Cmd+K** on macOS) opens quick actions and search.

## AI and job scouting

I want to explore modern AI and LLM tools for finding relevant opportunities and preparing applications. Those features are not implemented in the current build. RolePilot does not send my records to an AI provider, scrape job boards, or apply to jobs automatically.

The planned approach is to keep AI output reviewable: job suggestions and extracted facts should show their source, remain separate from verified records, and require my approval before they change my workspace. Any cloud provider should be optional and require explicit configuration.

## Backups and personal records

Local records are stored in the SQLite database under `data/` unless I configure another `ROLEPILOT_DATA_DIR`. Local backups use SQLite's online backup support. On a hosted server, the operator should verify scheduled backups and complete an encrypted off-server restore test before using personal records.

I should not commit a database, resume, cover letter, export, backup, or real job-search record to a public repository. See the [local setup guide](LOCAL_SETUP.md) to run the project and [architecture notes](architecture.md) for the data model.
