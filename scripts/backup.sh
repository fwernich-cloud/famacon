#!/bin/bash
# Nightly backup (NFR2). pg_dump custom format + 30-day retention. Optional off-box
# copy when BACKUP_REMOTE is configured. History is the product — losing it is the
# only expensive outcome, so this runs every day and is restore-tested (restore-test.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DUMPDIR=infra/backup/dumps
mkdir -p "$DUMPDIR"
STAMP=$(date -u +%Y%m%d_%H%M%S)
OUT="$DUMPDIR/famacon_${STAMP}.dump"

docker exec famacon-control-postgres-1 pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -Fc --no-owner --no-privileges > "$OUT"
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"

# Retention: keep 30 days.
find "$DUMPDIR" -name 'famacon_*.dump' -mtime +30 -delete

# Off-box copy (recommended). Set BACKUP_REMOTE to an rclone remote:path in .env.
if [ -n "${BACKUP_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$OUT" "$BACKUP_REMOTE" && echo "off-box: $BACKUP_REMOTE"
fi
