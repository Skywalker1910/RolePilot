#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run restore with sudo." >&2
  exit 1
fi
exec 9</opt/rolepilot/deploy.lock
flock -n -x 9
if systemctl is-active --quiet rolepilot; then
  echo "Stop RolePilot first: sudo systemctl stop rolepilot" >&2
  exit 1
fi
if [[ $# -lt 1 ]]; then
  echo "Usage: sudo bash deploy/scripts/restore.sh /path/to/rolepilot-backup.tar.gz [--include-files] [--restore-library]" >&2
  exit 2
fi
set -a
source /etc/rolepilot/rolepilot.env
set +a
PYTHONPATH="/opt/rolepilot/current/backend" /opt/rolepilot/current/.venv/bin/python /opt/rolepilot/current/deploy/scripts/backup.py \
  --restore "$1" --service-stopped "${@:2}"
chown -R rolepilot:rolepilot "${ROLEPILOT_DATA_DIR}"
if [[ -d "${ROLEPILOT_DOCUMENT_STORAGE}" ]]; then
  chown -R rolepilot:rolepilot "${ROLEPILOT_DOCUMENT_STORAGE}"
fi
systemctl start rolepilot
