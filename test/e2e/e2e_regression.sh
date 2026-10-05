#!/usr/bin/env bash
# ── Regression E2E: legacy generic-json path + cross-diagnosis still intact ──
# Proves my shared ingestService change (finalizeReading) is a pure passthrough
# for no-transform readings (value unchanged, meta NULL), and the engine still
# produces situation-3 URGENT and resolves it. Throwaway tenant, cleaned up.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL() { docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
ING() { curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/ingest -H 'content-type: application/json' -d "$1"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }

T=00000000-0000-0000-0000-0000000e2e10
F=00000000-0000-0000-0000-0000000e2e11
G=00000000-0000-0000-0000-0000000e2e12
EW=00000000-0000-0000-0000-0000000e2e13
EP=00000000-0000-0000-0000-0000000e2e14

echo "── setup (generic-json gateway, shared tank tank-R = MOL-R + BE-R) ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E Regression');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo Regr',-35.3,-57.3);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','gw-regr','generic-json@1',1800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES
  ('$EW','$T','$F','windmill','MOL-R','tank-R'),
  ('$EP','$T','$F','pump','BE-R','tank-R');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref) VALUES
  ('$T','$F','$G','$EW','MOL-R-golpes','windmill_strokes',NULL),
  ('$T','$F','$G','$EP','BE-R-corr','pump_current',NULL),
  ('$T','$F','$G',NULL,'TQ-R-nivel','tank_level','tank-R');
SQL
echo "  seeded."

post(){ # uuid ts tank strokes current
  echo "$(ING "{\"gw\":\"gw-regr\",\"uuid\":\"$1\",\"ts\":\"$2\",\"readings\":[{\"sensor\":\"TQ-R-nivel\",\"tipo\":\"tanque_nivel\",\"v\":$3},{\"sensor\":\"MOL-R-golpes\",\"tipo\":\"molino_golpes\",\"v\":$4},{\"sensor\":\"BE-R-corr\",\"tipo\":\"corriente_bomba\",\"v\":$5}]}")"
}
wait_cross(){ # want_open(1/0)
  for i in $(seq 1 20); do
    C=$(PSQL -c "SELECT count(*) FROM alert WHERE tenant_id='$T' AND dedup_key='rule:R4:tank-R' AND status='open';")
    [ "$C" = "$1" ] && return 0; sleep 0.5
  done; return 1
}

echo "── situación 1: tanque alto + molino andando → SILENCIO ──"
R=$(post s1a 2026-07-24T09:00:00Z 80 500 0); echo "  ingest#1 -> $R"
R=$(post s1b 2026-07-24T09:30:00Z 82 520 0); echo "  ingest#2 -> $R"
sleep 2
COPEN=$(PSQL -c "SELECT count(*) FROM alert WHERE tenant_id='$T' AND subject='tank-R' AND level='rule' AND status='open';")
[ "$COPEN" = "0" ] && ok "sin alerta de regla mientras el molino entrega (silencio)" || bad "falsa alerta durante el silencio"

echo "── passthrough assertion: generic-json reading stored unchanged, meta NULL ──"
VAL=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='MOL-R-golpes' ORDER BY r.ts DESC LIMIT 1;")
MET=$(PSQL -c "SELECT coalesce(meta::text,'NULL') FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='MOL-R-golpes' ORDER BY r.ts DESC LIMIT 1;")
[ "$VAL" = "520" ] && ok "strokes value stored unchanged (520)" || bad "strokes value altered: $VAL"
[ "$MET" = "NULL" ] && ok "meta is NULL for no-transform reading (pure passthrough)" || bad "meta not NULL: $MET"

echo "── situación 3 (R4): tanque crítico + TODO parado → URGENTE ──"
R=$(post s3 2026-07-24T10:00:00Z 15 0 0); echo "  ingest#3 (tanque 82→15, golpes 0, corriente 0) -> $R"
if wait_cross 1; then
  SEV=$(PSQL -c "SELECT severity FROM alert WHERE tenant_id='$T' AND dedup_key='rule:R4:tank-R' AND status='open';")
  ok "R4 ABIERTA, severidad=$SEV"; [ "$SEV" = "urgent" ] && ok "severidad urgente" || bad "esperaba urgent, got $SEV"
else bad "R4 NO abrió en situación 3"; fi

echo "── resolución: molino andando de nuevo + tanque subiendo → R4 se cierra ──"
R=$(post r1 2026-07-24T10:30:00Z 45 400 0); echo "  ingest#4 (tanque sube, golpes>0) -> $R"
if wait_cross 0; then ok "R4 RESUELTA cuando el molino vuelve a entregar"; else bad "R4 no se resolvió"; fi

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T';
DELETE FROM alert WHERE tenant_id='$T'; DELETE FROM sensor WHERE tenant_id='$T';
DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM gateway WHERE tenant_id='$T';
DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ REGRESSION PASSED (legacy path + engine intact)" || echo "RESULT: ❌ REGRESSION FAILED"
exit $FAIL
