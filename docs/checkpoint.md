# RolePilot project checkpoint

## Phase 3.9 — Invite-only hosted workspaces and clean repository release

RolePilot is a local-first job-search application that I built for managing opportunities and applications during my master's studies. The current stack is React and TypeScript, FastAPI, SQLAlchemy, Alembic, and SQLite.

### Current features

- Import and review job opportunities from Excel or CSV, including source-row and duplicate review.
- Search and filter opportunities, manage companies, and archive or restore listings.
- Track applications, status changes, follow-ups, tasks, and dashboard summaries.
- Index resume and cover-letter folders locally without copying or editing source files.
- Use hosted login with administrator-issued, single-use invitation codes.
- Manage user roles, account access, and invitation status in the admin dashboard.
- Keep hosted career records isolated by account. Admin account controls do not expose other users' job-search data.

The first hosted administrator is provisioned by an operator. Invitation values are shown once, stored as hashes, and associated with the account that uses them. A migration adds the invitation and account ownership schema while preserving existing application data. Local mode remains available without hosted authentication.

### Documentation

- [Local installation and replication](LOCAL_SETUP.md)
- [Feature and usage guide](USER_GUIDE.md)
- [Architecture and schema](architecture.md)
- [CI/CD and Lightsail preparation](cicd.md)
- [Document library behavior](document-library.md)
- [Lightsail host setup and recovery](../deploy/README.md)

### Verification

On 2026-10-24, local verification passed: 99 backend tests (one platform-specific skip), 29 frontend tests, Ruff, ESLint, TypeScript, Vite production build, Python and npm dependency audits, Alembic consistency, deployment validation, repository safety audit, and the HTTP integration smoke test. Synthetic records were used. The real local database and personal documents were not used by the tests or copied to Git.

### Repository and deployment state

I deleted the old private GitHub repository and created [the new public repository](https://github.com/Skywalker1910/RolePilot) from clean root commit `f11561021b6cb212dd28886249065145ab225fc2`. That commit has no parent, so the new `main` history contains none of the prior commits. Its first [CI run](https://github.com/Skywalker1910/RolePilot/actions/runs/40154212823) passed Backend Tests, Frontend Tests, Integration Tests, and Deployment Validation; the deployment job was skipped as intended.

I verified main branch protection through the GitHub API: PRs required, four named checks required and up to date, zero approvals for a solo maintainer, conversations resolved, linear history, force-push and deletion blocked, administrators included. Squash merging is enabled and merged branches are deleted. The `production` environment only allows `main`; it has no secrets. Repository Actions allow GitHub-owned actions only, require full SHA pins, use read-only default tokens, and cannot approve PRs. `DEPLOYMENT_ENABLED=false` remains set. The Lightsail host and all production prerequisites are still outstanding; no AWS resource, DNS record, production secret, local database, or personal document has been transferred.
