# GitHub development and Lightsail delivery

Phase 3.8 preserves the local application and prepares automatic production updates.
Provisioning, DNS, personal-data transfer and production deployment are separate,
explicitly authorized operations. The default deployment gate is closed.

## Repository audit and publication

The public repository is `Skywalker1910/RolePilot`, with `main` as its default branch
and the MIT License. It starts from a sanitized source snapshot as a root commit, so
older commits are not in this repository's Git history. No local career records or
personal documents belong in this source tree. Runtime SQLite/WAL/SHM, backups,
documents, imports/exports, temporary files, credentials, environment overrides,
keys, dependencies and generated output are excluded. `docs/` source documentation,
migrations, schema definitions and safe environment examples remain included.

Run `python scripts/repository_audit.py` before staging and
`python scripts/repository_audit.py --staged` before committing. The latter reads
the exact index blobs. Review `git diff --cached --stat` and
`git diff --cached` as well: pattern scanners cannot classify arbitrary personal
prose. Two exact credential-shaped `example.com` URLs are reviewed negative
security-test fixtures; arbitrary credential URLs remain rejected. Never use
`git add -f` to bypass the personal-data exclusions.

If a secret is ever committed, stop publication, revoke/rotate it, inventory all
affected refs and artifacts, and agree on a history-remediation plan. `.gitignore`
does not erase history. Do not force-push or rewrite history without authorization.

Git authentication uses the OS credential store. If unavailable:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth status
gh auth setup-git
```

Never paste tokens into a command, repository file, workflow, issue or chat. An
agent sandbox may be unable to read the OS credential store even when the user is
already authenticated; check in a normal terminal before replacing credentials.

For a fresh, audited checkout only, the creation sequence is:

```powershell
git init --initial-branch=main  # only when no repository exists
git add .gitattributes .gitignore .github README.md alembic.ini pyproject.toml requirements.lock backend frontend deploy docs scripts tests
python scripts/repository_audit.py --staged
git diff --cached --stat
git commit -m "chore: initialize RolePilot with gated CI and Lightsail delivery"
gh repo create Skywalker1910/RolePilot --public --source . --remote origin
gh variable set DEPLOYMENT_ENABLED --body false --repo Skywalker1910/RolePilot
git push -u origin main
```

Do not run `repo create` if the repository already exists. Inspect its history,
visibility and current remotes before connecting. Never replace an existing remote
or use a force push to reconcile histories.

## Branches and required checks

Start from current `main`, create `feature/*`, `fix/*`, `chore/*`, `docs/*` or
`release/*`, commit locally and push that branch. Open a pull request targeting
`main`. Update the branch from `main` if required, resolve conversations and squash
merge after checks succeed. Delete merged feature branches. Avoid direct pushes.

The requested policy is in `.github/branch-protection.json`: PR required, zero
required approvals for a solo maintainer, administrators included, strict/up-to-date
checks, conversation resolution, linear history, no force pushes and no deletion.
Only squash merging should be enabled in repository settings. Required checks are:

| Check | Validation |
| --- | --- |
| Backend Tests | Python 3.12 locked install, Ruff, pytest, fresh migration/ORM consistency, pip-audit |
| Frontend Tests | Node 24 LTS, npm ci, ESLint, TypeScript, Vitest, Vite build, npm audit high+ |
| Integration Tests | Actual Vite proxy and FastAPI with synthetic SQLite, import/search/archive/restore and restart |
| Deployment Validation | Publication scan, workflow gates, environment template, shell syntax, archive/rollback/auth/backup tests |

All four jobs run on PRs, `main` pushes and manual dispatch. None uses production
credentials. Official Actions are pinned to resolved commit SHAs; Dependabot
proposes monthly Action updates. Python audit tooling is isolated from the app
environment. Audit-service outages fail the check rather than silently passing.
Deployment is part of `ci.yml`; there is no independent push-triggered deployment.

GitHub Free supports protected branches, environments, and environment secrets for
public repositories. This repository's rules have been applied and read back through
the API. A configured policy file is not proof of enforcement; check the live rule
after changing it. See [GitHub's protected-branch plan limits](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
and [environment plan limits](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Apply the policy once main exists and check names are confirmed:

```powershell
gh api --method PUT repos/Skywalker1910/RolePilot/branches/main/protection --input .github/branch-protection.json
gh api repos/Skywalker1910/RolePilot/branches/main/protection
gh repo edit Skywalker1910/RolePilot --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
```

## Production environment and trust boundaries

The `production` environment is restricted to `main` and currently has no secrets.
No reviewer approval is configured so validated `main` pushes can deploy
automatically when the owner later enables delivery. Keep repository variable
`DEPLOYMENT_ENABLED=false` until Lightsail readiness is explicitly confirmed and
the root-owned server file `/etc/rolepilot/deployment-enabled` is set to `enabled`.
Repository Actions are limited to GitHub-owned actions pinned to full commit SHAs;
default workflow tokens are read-only and cannot approve pull requests.

If recreating the environment, PUT
`repos/Skywalker1910/RolePilot/environments/production` with
`deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}`,
then POST its `/deployment-branch-policies` endpoint with `{name: "main", type: "branch"}`.
Read both resources back. Do not add `prevent_self_review` without a reviewer rule;
automatic delivery needs no reviewers. Public repository environments are available
on GitHub Free.

Store these four values **only as production environment secrets**:

| Secret | Value |
| --- | --- |
| LIGHTSAIL_HOST | Static IPv4 or SSH hostname; port 22 |
| LIGHTSAIL_USER | `rolepilot-deploy` |
| LIGHTSAIL_SSH_KEY | Dedicated Ed25519 private deployment key |
| LIGHTSAIL_SSH_HOST_KEY | Verified known-hosts line: `rolepilot-production ssh-ed25519 <server-public-host-key>` |

Upload a key using a local protected file and `gh secret set LIGHTSAIL_SSH_KEY
--env production --repo Skywalker1910/RolePilot < keyfile` in a shell supporting
input redirection, or use GitHub's environment UI. Never commit that file. Do not
place application login passwords or runtime credentials in GitHub. The frontend
uses same-origin `/api`; it needs no production secrets or secret `VITE_*` values.

Only `main` push/manual runs in `Skywalker1910/RolePilot` can reach the deployment
job, and only after all four jobs succeed for the same SHA. PRs (including forks)
cannot reach the environment. There is no `pull_request_target`, arbitrary ref
input, untrusted workflow-run artifact, or interpolated PR title/commit message.
The frontend job packages committed runtime source and its tested static build;
the deployment job downloads the named immutable artifact from **the same run**.
SHA-256, per-file manifest and commit identity are checked again on the host.

## Release sequence and concurrency

The deployment job uses `needs` plus GitHub's production concurrency group with
`cancel-in-progress: false`. It checks that its SHA is still `main` before SSH;
superseded runs skip deployment and wait for newer CI. GitHub may replace a pending
run with a newer pending run. The server's nonblocking `flock` serializes manual
and automatic deploys too. Its last-success run number rejects stale/duplicate
successful runs. Do not rename/recreate the CI workflow and reset its run-number
sequence without an administrator reviewing the server's monotonic counter.

Scheduled and manual backup/restore wrappers use the same server lock, so they
cannot race the deployment backup or migration. The broker calls the backup helper
directly while holding that lock to avoid nested locking.

The host verifies readiness, an existing healthy authenticated application, disk
space and source identity; stages `/opt/rolepilot/releases/<sha>`; creates a fresh
venv as `rolepilot-build`; installs pinned binary wheels; and validates config and
schema. It then stops the writer, creates/verifies an online SQLite backup, applies
only a preapproved migration head, atomically switches `current`, restarts systemd,
and checks HTTPS API health, the exact frontend index, auth-required session state
and rejection of anonymous protected API calls. It records SHA, run, archive digest,
schema and previous release. It keeps five newest successful releases plus the
active/previous releases; failed releases remain for investigation.

Migration approval is separate from deployment approval: ordinary updates with no
schema change need no human action after enablement. For a migration, review and
test it against a restored synthetic/staging backup, then list the exact candidate
Alembic head on its own line in root-owned `/etc/rolepilot/approved-migrations`.
Do not approve every possible future migration. No migrations are edited in place.

Full build/service errors and backup paths remain in root-readable
`/var/log/rolepilot-deploy/<sha>-<run>-*.log`; Actions emits the SHA/run and a generic
failure message. Journal logs remain on the server. Never paste private logs into
public issues. Cleanup never traverses persistent data or symlinked release paths.

## Failure, rollback and manual delivery

SSH failure stops before transfer. Invalid digest/path/link/commit, low disk,
stale run, disabled server gate or unapproved migration stops before database writes.
An existing failed `<sha>` release is not overwritten: inspect its protected log
and archive it outside `releases/` before a deliberate retry. Do not remove `current`.

If no migration was attempted, restart/health failure restores the previous code
and its own venv, verifies it, and fails the deployment. If any migration was
attempted, the service stops and the current DB remains intact: schema compatibility
with old code is not assumed, and there is no automatic downgrade or restore.
Inspect the revision and logs, prefer a forward repair, or assess a prior release
against the current schema before manually activating it. Backups contain sensitive
data and restoring one loses writes made since the backup.

Cancellation/signals enter the same recovery boundary and release the OS lock.
A power loss/SIGKILL cannot run cleanup: check `current`, the service, schema and
`last-success.json` before retrying. A success followed by cleanup failure may need
manual reconciliation; do not reset the monotonic record blindly.

Preferred manual deployment: dispatch **CI** on `main`; it reruns all checks and
uses the same gates. There is no direct workflow that bypasses failed CI. For
emergency operator delivery, download the artifact from the successful CI run for
the exact SHA, verify it, transfer to
`/var/lib/rolepilot-deploy/incoming/<sha>-<run_number>.tar.gz`, and invoke:

```bash
sudo -n /usr/local/sbin/rolepilot-deploy <sha> <ci-run-number> <archive-sha256>
```

The operator must verify CI provenance; the offline broker cannot query GitHub.
A deployment key can deploy arbitrary code as the application user by design and
must be treated as highly privileged, even with narrow sudo rights.

## Troubleshooting and recovery

- Missing checks: verify PR base is main and Actions are enabled; avoid path filters
  that skip required jobs. Do not rename required checks without updating protection.
- Dependency audit/install failures: inspect the advisory or registry error, update
  locks through a reviewed PR, rerun CI. Do not globally ignore vulnerabilities.
- SSH failure: check environment secret scope, host fingerprint, deploy public key,
  firewall and sudo rule. Never disable host-key verification or trust unauthenticated
  `ssh-keyscan` output. GitHub-hosted runners do not have one stable source IP;
  decide on restricted ingress/static egress or a suitable trusted deployment runner
  before enabling. Do not place a production-access runner on untrusted PR jobs.
- Host-key rotation: verify the new fingerprint through the Lightsail console or
  existing trusted administrator session, then update the environment secret.
- Health failure: inspect Nginx/systemd and protected broker logs; verify HTTPS,
  initial account, persistent directory permissions, and Python 3.12 wheel support.
- Lost host: provision a replacement only after authorization, install the approved
  source release, restore a verified encrypted off-instance backup while stopped,
  restore documents/snapshots from their separately tested backup, provision new SSH
  identity/host trust, verify account/login and data integrity, then re-enable CD.

See [the server readiness and bootstrap runbook](../deploy/README.md) and
[the current checkpoint](checkpoint.md) for actual verification and remote status.
