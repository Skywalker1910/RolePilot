#!/usr/bin/env bash
set -euo pipefail
# Invoke the audited root-owned broker, never uploaded code with sudo.
if [[ $# -ne 3 || ! $1 =~ ^[0-9a-f]{40}$ || ! $2 =~ ^[1-9][0-9]*$ || ! $3 =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Usage: deploy.sh COMMIT_SHA CI_RUN_NUMBER ARCHIVE_SHA256' >&2
  exit 2
fi
exec sudo -n /usr/local/sbin/rolepilot-deploy "$1" "$2" "$3"
