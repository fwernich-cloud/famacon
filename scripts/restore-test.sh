#!/bin/bash
# Restore test (NFR2) — "un respaldo que nunca se probó no es un respaldo".
# Restores the latest dump into a CLEAN throwaway Postgres and verifies key table
# counts match the live DB, then tears it down. Exit 0 = backup is genuinely restorable.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DUMP=$(ls -t infra/backup/dumps/famacon_*.dump 2>/dev/null | head -1)
[ -z "$DUMP" ] && { echo "FAIL: no dump found (run backup.sh first)"; exit 1; }
echo "Restore-testing: $DUMP"

NET=famacon-control_default
C=famacon-restore-test
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --network "$NET" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=restore_test \
  timescale/timescaledb-ha:pg16 >/dev/null

echo -n "waiting for clean server"
# The HA image bootstraps then restarts; require several CONSECUTIVE good checks
# so we don't latch onto the transient init server that then shuts down.
ready=0
for _ in $(seq 1 90); do
  if docker exec "$C" psql -U postgres -d restore_test -tAqc "SELECT 1" >/dev/null 2>&1; then
    ready=$((ready + 1)); else ready=0; fi
  [ "$ready" -ge 3 ] && break
  echo -n "."; sleep 2
done
echo

P() { docker exec "$C" psql -U postgres -d restore_test -tAqc "$1" 2>/dev/null; }
# TimescaleDB restore protocol.
P "CREATE EXTENSION IF NOT EXISTS timescaledb;" >/dev/null
P "SELECT timescaledb_pre_restore();" >/dev/null
docker exec -i "$C" pg_restore -U postgres -d restore_test --no-owner --no-privileges >/dev/null 2>&1 < "$DUMP"
P "SELECT timescaledb_post_restore();" >/dev/null

# Compare counts on key tables (live vs restored).
LIVE() { docker exec famacon-control-postgres-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAqc "$1"; }
FAIL=0
printf "%-22s %10s %10s   %s\n" "table" "live" "restored" "result"
for t in tenant field gateway equipment sensor reading pump_flow_reference cylinder_catalog alert; do
  L=$(LIVE "SELECT count(*) FROM $t" | tr -d '[:space:]')
  R=$(P "SELECT count(*) FROM $t" | tr -d '[:space:]')
  if [ "$L" = "$R" ] && [ -n "$R" ]; then RES="OK"; else RES="MISMATCH"; FAIL=1; fi
  printf "%-22s %10s %10s   %s\n" "$t" "$L" "${R:-ERR}" "$RES"
done

docker rm -f "$C" >/dev/null 2>&1 || true
if [ "$FAIL" = 0 ]; then echo "RESTORE TEST PASSED — backup is restorable."; exit 0
else echo "RESTORE TEST FAILED — investigate before go-live."; exit 1; fi
