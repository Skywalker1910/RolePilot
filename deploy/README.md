# Lightsail server preparation

RolePilot uses Ubuntu, Nginx, one systemd-managed FastAPI worker, a React static
build, SQLite and invitation-only hosted accounts. Phase 3.8 creates no AWS resources,
changes no DNS, copies no personal data and does not run a production deployment.
See [GitHub CI/CD](../docs/cicd.md) for repository settings and workflow details.

## Readiness checklist — complete before enabling deployment

- [ ] Owner explicitly authorizes provisioning and confirms server readiness.
- [ ] Ubuntu host has Python **3.12** and venv support at `/usr/bin/python3.12`,
  compatible binary wheels, systemd, Nginx, sudo, curl, and at least 2 GiB free disk
  space plus room for five releases and retained backups. Node is not needed on
  the server: CI builds the frontend. Size memory/storage for Python dependencies
  and backups; verify current Lightsail pricing and account credits before purchase.
- [ ] Static IP assigned; only intended DNS `career.adityamore.dev` points to it.
- [ ] SSH ingress strategy selected for Actions runners, administration restricted,
  80/443 reachable, API port 8000 never exposed.
- [ ] TLS issued, renewal tested, HTTPS Nginx config installed and `nginx -t` passes.
- [ ] Persistent directories, service accounts, first administrator and login tested.
- [ ] Dedicated `rolepilot-deploy` key and verified server host key configured.
- [ ] Encrypted off-instance backups and restore drill completed; snapshots alone
  do not replace a consistent SQLite backup.
- [ ] GitHub production environment is eligible, main-only, and contains four SSH
  environment secrets. Main protection enforcement is verified where supported.
- [ ] Owner explicitly enables repository `DEPLOYMENT_ENABLED=true` and root-owned
  `/etc/rolepilot/deployment-enabled` containing `enabled` after the checks above.

No runtime login password, database, original Windows document library, or SSH
private key belongs in a release archive or frontend build. Initial bootstrap uses
an **empty** database and an interactively provisioned account. Data migration
requires a separate authorized plan and verified online backup.

## Filesystem and ownership

```text
/opt/rolepilot/                         root:root
  releases/<commit-sha>/                root-owned immutable source + .venv
  current -> releases/<commit-sha>
  deploy.lock                          server deployment lock
  last-success.json                    successful SHA, run, digest and schema
/var/lib/rolepilot/                     rolepilot:rolepilot 0700
  rolepilot.db                         SQLite, WAL and SHM
  documents/                           uploaded/generated files
  snapshots/                           reserved persistent submitted snapshots
  library/user-<id>/Resumes/ and library/user-<id>/cover_letters/
/var/backups/rolepilot/database/        rolepilot:rolepilot 0700
/var/lib/rolepilot-deploy/incoming/     rolepilot-deploy:rolepilot-deploy 0700
/var/lib/rolepilot-build/               isolated build account home
/etc/rolepilot/rolepilot.env            root:rolepilot 0640
/etc/rolepilot/deployment-enabled      root-owned, disabled by default
/etc/rolepilot/approved-migrations     root-owned optional approved head list
/usr/local/lib/rolepilot-deploy/        root-owned trusted broker and validator
/usr/local/sbin/rolepilot-deploy        root-owned narrow sudo entry point
/var/log/rolepilot-deploy/              root-only deployment logs
```

The application account cannot change releases, system units or the broker. The
build account cannot read private runtime data. The SSH account is not in the app
or sudo group and can invoke only the audited deployment broker through a narrow
sudoers rule. It cannot read application passwords or backups. Deploy access still
allows replacing application code, so protect/rotate its key accordingly.

## Manual first-host bootstrap (not run by CI)

1. Provision the host with Ubuntu's Python 3.12 and venv package (`sudo apt update`
   then `sudo apt install -y python3.12 python3.12-venv`). Review the scripts and
   environment example. An existing legacy `/opt/rolepilot/app` installation
   needs a manual layout migration; the installer refuses to overwrite it.
2. Download `release-<sha>` from a successful **main CI run**. Verify the run's SHA,
   all four checks, and archive SHA-256. Transfer that source/static archive plus
   the reviewed deployment scripts; no personal database or document-library transfer.
3. Run `sudo bash deploy/scripts/install.sh /path/release.tar.gz <sha> <sha256>`.
   This explicitly manual step creates accounts/directories, installs the trusted
   broker, stages the SHA release, installs locked wheels into its own venv,
   validates configuration, migrates a new empty database, prompts for the first
   administrator, and installs systemd/Nginx bootstrap services. It refuses existing
   databases and leaves automatic deployment **disabled**. Review partial setup
   after a failed bootstrap before retrying; never delete a database to rerun it.
4. Issue TLS after approved DNS setup:
   `sudo certbot certonly --webroot -w /var/www/letsencrypt -d career.adityamore.dev`.
   Test `sudo certbot renew --dry-run`. Install `deploy/nginx/rolepilot.conf` as
   `/etc/nginx/sites-available/rolepilot`, run `sudo nginx -t`, reload Nginx. Arrange
   a Certbot deploy hook to reload Nginx after renewal. HTTP bootstrap does not
   permit hosted login; use HTTPS for actual account verification.
5. Check `sudo systemctl status rolepilot rolepilot-backup.timer nginx` and
   `sudo bash /opt/rolepilot/current/deploy/scripts/healthcheck.sh --public`.
   Sign in manually, confirm secure HttpOnly cookies, sign out, and verify protected
   API calls reject anonymous requests. Automated updates check the authentication
   gate without storing your password in Actions.
6. Generate a dedicated Ed25519 deployment key on an administrator workstation.
   Install only its public half in `rolepilot-deploy`'s `authorized_keys` with
   `restrict` (no forwarding, agent forwarding, X11 or PTY). Protect `.ssh` as 0700
   and `authorized_keys` as 0600. Do not reuse a personal/admin key or use root SSH.
7. Obtain `/etc/ssh/ssh_host_ed25519_key.pub` and its fingerprint via the Lightsail
   console or a trusted admin connection. Compare out of band. Store the verified
   public key with alias `rolepilot-production` in `LIGHTSAIL_SSH_HOST_KEY`.
   Do not silently trust `ssh-keyscan`; unknown/changed hosts must fail.
8. Complete the readiness checklist and enable only after explicit owner approval.

Bootstrap and privileged broker updates are manual administrator operations.
Uploading a newer release does not replace the trusted broker or systemd/Nginx
configuration. Review those changes separately before installing them as root.

## Configuration and persistent data

Copy the safe `rolepilot.env.example` template to `/etc/rolepilot/rolepilot.env`.
Use literal `KEY=value`, no shell expressions or quotes. Hosted auth and secure
cookies must be enabled; the origin and allowed host are explicit; all data,
document, library and backup paths are absolute and outside releases. Do not set
`ROLEPILOT_DATABASE_URL` to a release path. Runtime credentials, if added later,
stay in protected server configuration and are never supplied to builds.

The first administrator is provisioned with `python -m app.auth_cli init-user`.
That account creates one-time invitations from **Administration** after signing
in. New hosted accounts receive separate workspace records and a document library
root under `ROLEPILOT_LIBRARY_ROOT/user-<id>`. The operator must keep that complete
library directory inside persistent storage and include it in encrypted off-instance
backups when it contains user documents.

No `create_all`, schema reset, demo seed or document transfer runs in deployment.
Migrations only upgrade after the writer stops and a consistent backup verifies.
Pending migration heads require explicit approval in `approved-migrations`.
Code-only rollback is automatic only when no schema migration was attempted.

## Backups, rollback and disaster recovery

The systemd timer runs the existing online SQLite backup utility and retains 30
local archives. It verifies SQLite integrity, foreign keys and checksums and
includes configured document storage. The original document library is excluded
unless explicitly requested. `snapshots/` is reserved: separately back it up when
that feature is used; the present utility does not include that directory.
Protect backups as private data and configure/test encrypted off-instance storage
before using hosted records. This phase configures no external storage account.

Create a backup with:

```bash
sudo bash /opt/rolepilot/current/deploy/scripts/backup.sh
sudo bash /opt/rolepilot/current/deploy/scripts/backup.sh --verify /var/backups/rolepilot/database/<archive>.tar.gz
```

On failure, inspect `journalctl -u rolepilot` and protected broker logs. With no
migration attempted the broker switches back to the prior release and venv and
verifies it. Once a migration starts, it stops the service on failure and retains
the database and logs for manual recovery. Never downgrade automatically. Prefer
forward repair; evaluate old-code/schema compatibility before manually changing
`current`. Never copy an older database over a live WAL database.

For a deliberate restore, stop the service, preserve the current DB/WAL/SHM,
verify the selected archive, and run the restore helper:

```bash
sudo systemctl stop rolepilot
sudo bash /opt/rolepilot/current/deploy/scripts/restore.sh /var/backups/rolepilot/database/<archive>.tar.gz
```

The helper refuses a running service, validates the archive, creates a pre-restore
copy and restarts after restoration. It invalidates restored sessions while
preserving accounts. Optional document restoration requires empty destinations
and explicit `--include-files`; source-library restoration also requires
`--restore-library`. Test into a separate host/path first. Restore may lose later
writes; an operator must authorize that recovery decision.

For legacy installations, preserve existing `/etc/rolepilot/rolepilot.env` and
persistent paths. Stop/backup first; stage a SHA release with its own venv, update
unit/Nginx paths to `current`, verify compatibility and permissions, and keep the
old release and backup until tested. Do not run the fresh installer over them.

See [CI/CD procedures](../docs/cicd.md) for automatic/manual updates, cancellation,
release retention, stale-run protection, environment secrets and troubleshooting.
