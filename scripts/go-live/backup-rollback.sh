#!/usr/bin/env bash
set -euo pipefail

# Backup + rollback helper for pilot launch.
#
# Required env:
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname
#
# Optional env:
#   BACKUP_DIR=./backups

DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/movieshaker-${STAMP}.dump"

echo "Creating backup: ${BACKUP_FILE}"
pg_dump --format=custom --no-owner --no-privileges --dbname="${DATABASE_URL}" --file="${BACKUP_FILE}"

cat <<EOF

Backup created.

Restore command (run only when required):
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${DATABASE_URL}" "${BACKUP_FILE}"

Rollback checklist:
1) Pause onboarding/new signups.
2) Announce maintenance window internally.
3) Restore database from known good backup.
4) Re-deploy last known good app image(s).
5) Run smoke checks:
   - /health
   - signup/signin/reset/verify
   - /admin/email preview/send
6) Resume onboarding only after checks pass.
EOF
