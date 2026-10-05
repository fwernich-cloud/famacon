#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp go-live smoke test.
# Drives a REAL alert through the full pipeline (ingest → engine → dispatch →
# WhatsApp) to SMOKE_TO and reports the result + delivery webhook status.
# Runs in DRY-RUN until the Meta credentials are in .env; on activation day it
# actually sends. Uses a throwaway tenant and cleans up after itself.
#
#   SMOKE_TO='+5491131796848' bash scripts/go-live-smoketest.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
SMOKE_TO="${SMOKE_TO:?set SMOKE_TO to the E.164 number to test, e.g. +5491131796848}"
BASE="${BASE:-http://localhost:3000}"
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
ING(){ curl -s -o /dev/null -X POST "$BASE/ingest" -H 'content-type: application/json' -d "$1"; }
ago(){ date -u -d "-$1 min" +%Y-%m-%dT%H:%M:%SZ; }
T=00000000-0000-0000-0000-00000000517e; F=00000000-0000-0000-0000-00000000517f
G=00000000-0000-0000-0000-000000005180; EW=00000000-0000-0000-0000-000000005181; EP=00000000-0000-0000-0000-000000005182; R=00000000-0000-0000-0000-000000005183

cleanup(){ PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM consent WHERE tenant_id='$T'; DELETE FROM recipient WHERE tenant_id='$T';
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T'; DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM gateway WHERE tenant_id='$T';
DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
}
trap cleanup EXIT
cleanup

echo "→ Seeding a throwaway field with $SMOKE_TO as a consented recipient…"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','SMOKE TEST');
INSERT INTO field(id,tenant_id,name) VALUES ('$F','$T','Smoke Test');
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','gw-smoke','generic-json@1',1800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES ('$EW','$T','$F','windmill','MOL-TEST','tank-test'),('$EP','$T','$F','pump','BE-TEST','tank-test');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref) VALUES
  ('$T','$F','$G','$EW','MOL-TEST-g','windmill_strokes',NULL),('$T','$F','$G','$EP','BE-TEST-c','pump_current',NULL),('$T','$F','$G',NULL,'TQ-TEST-n','tank_level','tank-test');
INSERT INTO recipient(id,tenant_id,name,phone_e164) VALUES ('$R','$T','Smoke Test','$SMOKE_TO');
INSERT INTO consent(tenant_id,recipient_id,channel,granted,granted_at,granted_ip) VALUES ('$T','$R','whatsapp',true,now(),'127.0.0.1');
SQL

echo "→ Driving a situation-3 alert (tanque cayendo + todo parado)…"
ING "{\"gw\":\"gw-smoke\",\"uuid\":\"smoke-1\",\"ts\":\"$(ago 40)\",\"readings\":[{\"sensor\":\"TQ-TEST-n\",\"tipo\":\"tanque_nivel\",\"v\":70},{\"sensor\":\"MOL-TEST-g\",\"tipo\":\"molino_golpes\",\"v\":500},{\"sensor\":\"BE-TEST-c\",\"tipo\":\"corriente_bomba\",\"v\":0}]}"
sleep 2
ING "{\"gw\":\"gw-smoke\",\"uuid\":\"smoke-2\",\"ts\":\"$(ago 2)\",\"readings\":[{\"sensor\":\"TQ-TEST-n\",\"tipo\":\"tanque_nivel\",\"v\":12},{\"sensor\":\"MOL-TEST-g\",\"tipo\":\"molino_golpes\",\"v\":0},{\"sensor\":\"BE-TEST-c\",\"tipo\":\"corriente_bomba\",\"v\":0}]}"

echo "→ Waiting for dispatch…"
for i in $(seq 1 40); do ST=$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R' ORDER BY status_at DESC LIMIT 1;"); [ -n "$ST" ] && break; sleep 0.5; done

echo ""
case "${ST:-}" in
  sent_dryrun)
    echo "◑ DRY-RUN — the pipeline works end to end, but WhatsApp creds are NOT set."
    echo "  The alert to $SMOKE_TO was logged, not sent. Set WA_ACCESS_TOKEN + WA_PHONE_NUMBER_ID"
    echo "  in .env, restart the server, and run this again to send for real." ;;
  sent)
    WAID=$(PSQL -c "SELECT wa_message_id FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R';")
    echo "● LIVE — sent to $SMOKE_TO (wa_message_id=$WAID). Waiting for the delivery webhook…"
    for i in $(seq 1 40); do DS=$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R';"); [ "$DS" != "sent" ] && break; sleep 1; done
    echo "  Delivery status: ${DS:-sent}  (delivered/read = webhook confirmed)" ;;
  failed)
    echo "✗ FAILED — Meta rejected the send:"
    PSQL -c "SELECT error FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R';" ;;
  *)
    echo "✗ No wa_message produced. Check: recipient consent, engine worker running, server logs." ;;
esac
echo ""