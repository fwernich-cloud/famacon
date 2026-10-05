#!/usr/bin/env bash
# ── E2E: UDL + SWL head-to-head on one tank (§13) ──────────────────────────
# The comparison sensor (SWL, for_engine=false) is stored but the engine ignores
# it. Proof: make SWL read "full/stable" while UDL reads "dropping" + windmill
# stopped. Engine must follow the PRIMARY (UDL) → cross alert opens; and both
# sensors' readings are retained. Throwaway tenant, cleaned up.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
ING(){ curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/ingest -H 'content-type: application/json' -d "$1"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
T=00000000-0000-0000-0000-0000000e2e20; F=00000000-0000-0000-0000-0000000e2e21
G=00000000-0000-0000-0000-0000000e2e22; EW=00000000-0000-0000-0000-0000000e2e23

echo "── setup: tank-C con UDL(primario) + SWL(comparación, for_engine=false) ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E DualLevel');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo Dual',-35.3,-57.3);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','gw-dual','generic-json@1',1800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES ('$EW','$T','$F','windmill','MOL-C','tank-C');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref,for_engine) VALUES
  ('$T','$F','$G','$EW','MOL-C-golpes','windmill_strokes',NULL,true),
  ('$T','$F','$G',NULL,'UDL-C','tank_level','tank-C',true),
  ('$T','$F','$G',NULL,'SWL-C','tank_level','tank-C',false);
SQL
echo "  seeded (UDL-C primario, SWL-C comparación)."

post(){ # uuid ts udl swl strokes
  echo "$(ING "{\"gw\":\"gw-dual\",\"uuid\":\"$1\",\"ts\":\"$2\",\"readings\":[{\"sensor\":\"UDL-C\",\"tipo\":\"tanque_nivel\",\"v\":$3},{\"sensor\":\"SWL-C\",\"tipo\":\"tanque_nivel\",\"v\":$4},{\"sensor\":\"MOL-C-golpes\",\"tipo\":\"molino_golpes\",\"v\":$5}]}")"
}
wait_cross(){ for i in $(seq 1 20); do C=$(PSQL -c "SELECT count(*) FROM alert WHERE tenant_id='$T' AND dedup_key='rule:R4:tank-C' AND status='open';"); [ "$C" = "$1" ] && return 0; sleep 0.5; done; return 1; }

echo "── baseline: ambos 80, molino andando → silencio ──"
post d1 2026-07-24T09:00:00Z 80 80 500 >/dev/null; sleep 1.5

echo "── conflicto: UDL cae a 15 (crítico) + molino PARADO, pero SWL dice 85 (lleno) ──"
R=$(post d2 2026-07-24T10:00:00Z 15 85 0); echo "  ingest -> $R"
if wait_cross 1; then ok "R4 ABRIÓ siguiendo al PRIMARIO (UDL 15%), ignorando SWL=85"; else bad "el motor no abrió alerta — ¿usó el SWL de comparación?"; fi

echo "── el motor usó el valor del UDL (15), no el del SWL (85) ──"
R4N=$(PSQL -c "SELECT count(*) FROM alert WHERE tenant_id='$T' AND status='open' AND dedup_key='rule:R4:tank-C';")
[ "$R4N" = "1" ] && ok "R4 crítica una sola vez, sobre el UDL (15%) — si usara el SWL(85) no habría alerta" || bad "R4: esperaba 1, hubo $R4N"

echo "── el SWL de comparación SÍ se guarda (dato para el tablero) ──"
SWLN=$(PSQL -c "SELECT count(*) FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='SWL-C';")
[ "$SWLN" = "2" ] && ok "SWL-C: 2 lecturas guardadas (comparación retenida)" || bad "SWL-C lecturas: esperaba 2, hubo $SWLN"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T';
DELETE FROM alert WHERE tenant_id='$T'; DELETE FROM sensor WHERE tenant_id='$T';
DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM gateway WHERE tenant_id='$T';
DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ DUAL-LEVEL (UDL vs SWL) PASSED" || echo "RESULT: ❌ DUAL-LEVEL FAILED"
exit $FAIL
