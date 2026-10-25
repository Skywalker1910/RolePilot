#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error http://127.0.0.1:8000/api/health
echo
if [[ "${1:-}" == "--public" ]]; then
  curl --fail --silent --show-error --head https://career.adityamore.dev/
fi
