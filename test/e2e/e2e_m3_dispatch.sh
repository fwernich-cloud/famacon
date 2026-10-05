#!/usr/bin/env bash
# ── E2E: M3 WhatsApp dispatch pipeline (dry-run) ───────────────────────────
# Drives a situation-3 alert; asserts the wired engine→dispatch path logs a
# wa_message per recipient: consented → sent_dryrun, NO consent → skipped
# (Ley 25.326), and cross+n1 on one tank consolidate to ONE message. Cleaned up.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
ING(){ curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/ingest -H 'content-type: application/json' -d "$1"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
T=00000000-0000-0000-0000-0000000e2e30; F=00000000-0000-0000-0000-0000000e2e31
G=00000000-0000-0000-0000-0000000e2e32; EW=00000000-0000-0000-0000-0000000e2e33; EP=00000000-0000-0000-0000-0000000e2e34
R1=00000000-0000-0000-0000-0000000e2e35; R2=00000000-0000-0000-0000-0000000e2e36

echo "── setup: campo + 2 destinatarios (R1 con consentimiento, R2 sin) ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E M3');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo M3',-35.3,-57.3);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','gw-m3','generic-json@1',1800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES
  ('$EW','$T','$F','windmill','MOL-M','tank-M'),('$EP','$T','$F','pump','BE-M','tank-M');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref) VALUES
  ('$T','$F','$G','$EW','MOL-M-golpes','windmill_strokes',NULL),
  ('$T','$F','$G','$EP','BE-M-corr','pump_current',NULL),
  ('$T','$F','$G',NULL,'TQ-M-nivel','tank_level','tank-M');
INSERT INTO recipient(id,tenant_id,name,phone_e164) VALUES
  ('$R1','$T','Federico','+5491131796848'),('$R2','$T','Sin Consent','+5491100000000');
INSERT INTO consent(tenant_id,recipient_id,channel,granted,granted_at,granted_ip,policy_version)
  VALUES ('$T','$R1','whatsapp',true,now(),'201.1.1.1','famacon-privacy-v1');
SQL
echo "  seeded (R1 consentido, R2 sin consentimiento)."

post(){ echo "$(ING "{\"gw\":\"gw-m3\",\"uuid\":\"$1\",\"ts\":\"$2\",\"readings\":[{\"sensor\":\"TQ-M-nivel\",\"tipo\":\"tanque_nivel\",\"v\":$3},{\"sensor\":\"MOL-M-golpes\",\"tipo\":\"molino_golpes\",\"v\":$4},{\"sensor\":\"BE-M-corr\",\"tipo\":\"corriente_bomba\",\"v\":$5}]}")"; }

echo "── silencio (tanque 80, molino andando) → no debe avisar ──"
post m1 2026-07-24T09:00:00Z 80 500 0 >/dev/null; sleep 1.5
NW0=$(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T';")
[ "$NW0" = "0" ] && ok "sin alerta → 0 mensajes WhatsApp" || bad "esperaba 0 mensajes en silencio, hubo $NW0"

echo "── R4 crítica (tanque a 15 <20, molino y bomba parados) → alerta + dispatch ──"
R=$(post m2 2026-07-24T10:00:00Z 15 0 0); echo "  ingest -> $R"
for i in $(seq 1 40); do N=$(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T';"); [ "$N" -ge "2" ] && break; sleep 0.5; done
echo "  mensajes wa_message: $N"

echo "── asserts ──"
S1=$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';")
S2=$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R2';")
C1=$(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';")
[ "$S1" = "sent_dryrun" ] && ok "R1 (consentido) → enviado (dry-run)" || bad "R1 status: esperaba sent_dryrun, got '$S1'"
[ "$S2" = "skipped_no_consent" ] && ok "R2 (sin consentimiento) → NO se envía, se loguea skip (Ley 25.326)" || bad "R2 status: esperaba skipped_no_consent, got '$S2'"
[ "$C1" = "1" ] && ok "consolidación: varias alertas del mismo tanque = 1 solo WhatsApp a R1" || bad "R1 debería tener 1 mensaje (consolidado), tuvo $C1"
# el mensaje se logueó contra una alerta urgente (la más severa)
SEV=$(PSQL -c "SELECT a.severity FROM wa_message w JOIN alert a ON a.id=w.alert_id WHERE w.tenant_id='$T' AND w.recipient_id='$R1';")
[ "$SEV" = "urgent" ] && ok "el aviso salió por la alerta más severa (urgent)" || bad "esperaba urgent, got '$SEV'"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM consent WHERE tenant_id='$T';
DELETE FROM recipient WHERE tenant_id='$T'; DELETE FROM reading WHERE tenant_id='$T';
DELETE FROM raw_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T'; DELETE FROM equipment WHERE tenant_id='$T';
DELETE FROM gateway WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ M3 DISPATCH PASSED (consent gate + consolidation + dry-run)" || echo "RESULT: ❌ M3 DISPATCH FAILED"
exit $FAIL
