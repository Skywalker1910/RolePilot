#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/rolepilot/current"
# Serialize scheduled/manual backups with deployments and restores.
exec 9</opt/rolepilot/deploy.lock
flock -x 9
if [[ $# -eq 0 ]]; then
  set -- --backup
fi
if [[ ${EUID} -eq 0 ]]; then
  set -a
  source /etc/rolepilot/rolepilot.env
  set +a
  exec runuser -u rolepilot -- env \
    ROLEPILOT_DATA_DIR="${ROLEPILOT_DATA_DIR}" \
    ROLEPILOT_BACKUP_DIR="${ROLEPILOT_BACKUP_DIR}" \
    ROLEPILOT_DOCUMENT_STORAGE="${ROLEPILOT_DOCUMENT_STORAGE}" \
    ROLEPILOT_LIBRARY_ROOT="${ROLEPILOT_LIBRARY_ROOT}" \
    PYTHONPATH="${APP_DIR}/backend" \
    /opt/rolepilot/current/.venv/bin/python "${APP_DIR}/deploy/scripts/backup.py" "$@"
fi
exec env PYTHONPATH="${APP_DIR}/backend" /opt/rolepilot/current/.venv/bin/python "${APP_DIR}/deploy/scripts/backup.py" "$@"
