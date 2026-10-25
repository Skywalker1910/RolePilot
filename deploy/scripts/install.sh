#!/usr/bin/env bash
set -euo pipefail
# Manual first-host bootstrap only. Review this script before running with sudo.
# Requires an already provisioned Ubuntu host with Python 3.12 + venv support.
[[ $EUID -eq 0 && $# -eq 3 ]] || { echo 'Usage: sudo bash install.sh ARCHIVE COMMIT_SHA ARCHIVE_SHA256' >&2; exit 2; }
archive=$(realpath "$1")
commit=$2
checksum=$3
[[ $commit =~ ^[0-9a-f]{40}$ && $checksum =~ ^[0-9a-f]{64}$ ]] || exit 2
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
root=/opt/rolepilot
release="$root/releases/$commit"
# Do not overwrite an existing install or automatically adopt a personal DB.
[[ ! -e "$root/current" && ! -L "$root/current" && ! -e "$root/app" && ! -L "$root/app" ]] || { echo 'Existing installation: use the documented migration/update procedure.' >&2; exit 1; }
[[ ! -e /var/lib/rolepilot/rolepilot.db && ! -e /var/lib/rolepilot/data/rolepilot.db ]] || { echo 'Existing database: stop and plan migration manually.' >&2; exit 1; }
/usr/bin/python3.12 -c 'import venv'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot curl sudo util-linux
for account in rolepilot rolepilot-build; do
  id -u "$account" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/var/lib/$account" --shell /usr/sbin/nologin "$account"
done
id -u rolepilot-deploy >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/rolepilot-deploy --shell /bin/bash rolepilot-deploy
install -d -o root -g root -m 0755 "$root" "$root/releases" /etc/rolepilot /usr/local/lib/rolepilot-deploy
touch "$root/deploy.lock"
chmod 0644 "$root/deploy.lock"
install -d -o rolepilot -g rolepilot -m 0700 /var/lib/rolepilot /var/lib/rolepilot/documents /var/lib/rolepilot/snapshots /var/lib/rolepilot/library/Resumes /var/lib/rolepilot/library/cover_letters /var/backups/rolepilot /var/backups/rolepilot/database
install -d -o root -g root -m 0700 /var/log/rolepilot-deploy
install -d -o rolepilot-deploy -g rolepilot-deploy -m 0700 /var/lib/rolepilot-deploy/incoming
install -d -o root -g www-data -m 0755 /var/www/letsencrypt
install -m 0644 "$source_dir/deploy/scripts/release.py" "$source_dir/deploy/scripts/deploy_host.py" /usr/local/lib/rolepilot-deploy/
install -m 0755 "$source_dir/deploy/scripts/rolepilot-deploy" /usr/local/sbin/rolepilot-deploy
# Narrow sudo command; broker validates arguments and never executes candidate code as root.
printf '%s\n' 'rolepilot-deploy ALL=(root) NOPASSWD: /usr/local/sbin/rolepilot-deploy' > /etc/sudoers.d/rolepilot-deploy
chmod 0440 /etc/sudoers.d/rolepilot-deploy
visudo -cf /etc/sudoers.d/rolepilot-deploy
[[ -e /etc/rolepilot/deployment-enabled ]] || printf '%s\n' disabled > /etc/rolepilot/deployment-enabled
if [[ ! -f /etc/rolepilot/rolepilot.env ]]; then
  install -o root -g rolepilot -m 0640 "$source_dir/deploy/rolepilot.env.example" /etc/rolepilot/rolepilot.env
fi
/usr/bin/python3 -I -c 'import sys; sys.path.insert(0, "/usr/local/lib/rolepilot-deploy"); from release import unpack; unpack(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])' "$archive" "$release" "$commit" "$checksum"
chown -R rolepilot-build:rolepilot-build "$release"
runuser -u rolepilot-build -- /usr/bin/python3.12 -m venv "$release/.venv"
runuser -u rolepilot-build -- "$release/.venv/bin/pip" install --only-binary=:all: -r "$release/requirements.lock"
chown -R root:root "$release"
chmod -R u=rwX,go=rX "$release"
# Validate trusted literal config before sourcing it for the interactive bootstrap.
/usr/bin/python3 -I -c 'import sys; sys.path.insert(0, "/usr/local/lib/rolepilot-deploy"); from deploy_host import read_env; read_env("/etc/rolepilot/rolepilot.env")'
set -a
source /etc/rolepilot/rolepilot.env
set +a
cd "$release"
run_app() {
  runuser -u rolepilot -- env PYTHONPATH="$release/backend" \
    ROLEPILOT_AUTH_REQUIRED="$ROLEPILOT_AUTH_REQUIRED" ROLEPILOT_COOKIE_SECURE="$ROLEPILOT_COOKIE_SECURE" \
    ROLEPILOT_PUBLIC_ORIGIN="$ROLEPILOT_PUBLIC_ORIGIN" ROLEPILOT_ALLOWED_HOSTS="$ROLEPILOT_ALLOWED_HOSTS" \
    ROLEPILOT_DATA_DIR="$ROLEPILOT_DATA_DIR" ROLEPILOT_LIBRARY_ROOT="$ROLEPILOT_LIBRARY_ROOT" \
    ROLEPILOT_DOCUMENT_STORAGE="$ROLEPILOT_DOCUMENT_STORAGE" ROLEPILOT_BACKUP_DIR="$ROLEPILOT_BACKUP_DIR" \
    "$release/.venv/bin/python" "$@"
}
[[ ! -e "$ROLEPILOT_DATA_DIR/rolepilot.db" ]] || { echo 'Configured database exists: refusing bootstrap.' >&2; exit 1; }
run_app -c 'from app.production_config import validate_production_environment; validate_production_environment()'
run_app -m alembic upgrade head
run_app -m app.auth_cli init-user
ln -s "$release" "$root/current"
install -m 0644 "$source_dir/deploy/systemd/rolepilot.service" "$source_dir/deploy/systemd/rolepilot-backup.service" "$source_dir/deploy/systemd/rolepilot-backup.timer" /etc/systemd/system/
install -m 0644 "$source_dir/deploy/nginx/rolepilot-http.conf" /etc/nginx/sites-available/rolepilot
ln -sfn /etc/nginx/sites-available/rolepilot /etc/nginx/sites-enabled/rolepilot
nginx -t
systemctl daemon-reload
systemctl enable --now rolepilot rolepilot-backup.timer
systemctl reload nginx
echo 'Bootstrap complete. CD remains disabled. Configure HTTPS, SSH, off-instance backup, and verify login before enabling.'
