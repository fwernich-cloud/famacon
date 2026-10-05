#!/usr/bin/env bash
# ── E2E: anti-saturation (§7) — the new spec model ─────────────────────────
# Proves three guarantees on one tank draining across separate uplinks:
#   1. CONSOLIDATION — several open alerts on one tank (R4 + R6) → ONE WhatsApp.
#   2. ESCALATION    — a warning already sent does NOT block a later urgent.
#   3. NODE CADENCE  — a same-severity re-alert within 2 h is NOT re-sent.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
ING(){ curl -s -o /dev/null -X POST localhost:3000/ingest -H 'content-type: application/json' -d "$1"; }
ago(){ date -u -d "-$1 min" +%Y-%m-%dT%H:%M:%SZ; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
sent(){ PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T' AND status='sent_dryrun';"; }
wait_sent(){ for i in $(seq 1 40); do [ "$(sent)" -ge "$1" ] && return; sleep 0.5; done; }
T=00000000-0000-0000-0000-00000000a501; F=00000000-0000-0000-0000-00000000a502; G=00000000-0000-0000-0000-00000000a503
EW=00000000-0000-0000-0000-00000000a504; EP=00000000-0000-0000-0000-00000000a505; R1=00000000-0000-0000-0000-00000000a506
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E AntiSat');
INSERT INTO field(id,tenant_id,name) VALUES ('$F','$T','Campo');
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','gw-as','generic-json@1',1800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES ('$EW','$T','$F','windmill','MOL','tank-A'),('$EP','$T','$F','pump','BE','tank-A');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref) VALUES
  ('$T','$F','$G','$EW','MOL-g','windmill_strokes',NULL),('$T','$F','$G','$EP','BE-c','pump_current',NULL),('$T','$F','$G',NULL,'TQ-n','tank_level','tank-A');
INSERT INTO recipient(id,tenant_id,name,phone_e164) VALUES ('$R1','$T','R1','+5491131796848');
INSERT INTO consent(tenant_id,recipient_id,channel,granted,granted_at) VALUES ('$T','$R1','whatsapp',true,now());
SQL
p(){ ING "{\"gw\":\"gw-as\",\"uuid\":\"$1\",\"ts\":\"$2\",\"readings\":[$3]}"; }

echo "── tanque lleno, molino andando ──"
p b1 "$(ago 12)" '{"sensor":"TQ-n","tipo":"tanque_nivel","v":70},{"sensor":"MOL-g","tipo":"molino_golpes","v":500},{"sensor":"BE-c","tipo":"corriente_bomba","v":0}'; sleep 2

echo "── caída rápida con molino andando → R6 (consultiva, WARNING) ──"
p b2 "$(ago 8)" '{"sensor":"TQ-n","tipo":"tanque_nivel","v":40},{"sensor":"MOL-g","tipo":"molino_golpes","v":520}'
wait_sent 1; S1=$(sent)
[ "$S1" = "1" ] && ok "primer aviso: 1 WhatsApp (R6 warning)" || bad "esperaba 1 enviado, hubo $S1"
SEV1=$(PSQL -c "SELECT a.severity FROM wa_message w JOIN alert a ON a.id=w.alert_id WHERE w.tenant_id='$T' AND w.status='sent_dryrun' ORDER BY w.status_at DESC LIMIT 1;")
[ "$SEV1" = "warning" ] && ok "ese aviso salió como WARNING (R6)" || bad "esperaba warning, got $SEV1"

echo "── tanque crítico, molino parado → R4 URGENTE (escalación permitida) ──"
p b3 "$(ago 4)" '{"sensor":"TQ-n","tipo":"tanque_nivel","v":12},{"sensor":"MOL-g","tipo":"molino_golpes","v":0}'
wait_sent 2; S2=$(sent)
[ "$S2" = "2" ] && ok "escalación: el URGENTE sí sale aunque ya salió un warning (2 en total)" || bad "esperaba 2 enviados, hubo $S2"
SEV2=$(PSQL -c "SELECT a.severity FROM wa_message w JOIN alert a ON a.id=w.alert_id WHERE w.tenant_id='$T' AND w.status='sent_dryrun' ORDER BY w.status_at DESC LIMIT 1;")
[ "$SEV2" = "urgent" ] && ok "el segundo es URGENTE (R4)" || bad "esperaba urgent, got $SEV2"
OPEN=$(PSQL -c "SELECT string_agg(type,',' ORDER BY type) FROM alert WHERE tenant_id='$T' AND status='open';")
echo "  alertas abiertas en el tanque: $OPEN (R4 + R6) → 1 solo WhatsApp cada vez (consolidación)"

echo "── re-aviso crítico de la MISMA severidad, minutos después → NO se reenvía (cadencia 2h) ──"
p b4 "$(ago 1)" '{"sensor":"TQ-n","tipo":"tanque_nivel","v":11},{"sensor":"MOL-g","tipo":"molino_golpes","v":0}'
sleep 4; S3=$(sent)
[ "$S3" = "2" ] && ok "cadencia por nodo: sigue en 2 (no repite el mismo urgente antes de 2 h)" || bad "reenvió de más: $S3"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM consent WHERE tenant_id='$T'; DELETE FROM recipient WHERE tenant_id='$T';
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T'; DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM gateway WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ ANTI-SAT (consolidación + escalación + cadencia) PASSED" || echo "RESULT: ❌ ANTI-SAT FAILED"
exit $FAIL
