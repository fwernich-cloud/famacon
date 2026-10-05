#!/usr/bin/env bash
# ── E2E: M4 Item B dashboard (read-only) ───────────────────────────────────
# Seeds a field with a dual-level tank (UDL primary + SWL comparison) + battery,
# logs in, and asserts /api/overview exposes per-sensor detail with roles, the
# UDL-vs-SWL head-to-head, /api/series returns tank+strokes, and assets serve.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
JAR=$(mktemp)
U=$(grep -E '^DASHBOARD_USER=' .env | cut -d= -f2- | tr -d '"'); P=$(grep -E '^DASHBOARD_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
T=00000000-0000-0000-0000-0000000e2e40; F=00000000-0000-0000-0000-0000000e2e41
G=00000000-0000-0000-0000-0000000e2e42; EW=00000000-0000-0000-0000-0000000e2e43; EP=00000000-0000-0000-0000-0000000e2e44

echo "── setup: campo con tanque de doble sensor (UDL primario + SWL comparación) ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E Dashboard');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo Tablero',-35.3,-57.3);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s,last_seen_at,signal_baseline_rssi)
  VALUES ('$G','$T','$F','gw-dash','generic-json@1',1800,now(),-70);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES
  ('$EW','$T','$F','windmill','MOL-D','tank-D'),('$EP','$T','$F','pump','BE-D','tank-D');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref,for_engine) VALUES
  ('$T','$F','$G','$EW','MOL-D-golpes','windmill_strokes',NULL,true),
  ('$T','$F','$G','$EP','BE-D-corr','pump_current',NULL,true),
  ('$T','$F','$G',NULL,'UDL-D','tank_level','tank-D',true),
  ('$T','$F','$G',NULL,'SWL-D','tank_level','tank-D',false);
SQL
ING(){ curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/ingest -H 'content-type: application/json' -d "$1"; }
ING "{\"gw\":\"gw-dash\",\"uuid\":\"dsh1\",\"ts\":\"2026-07-25T09:00:00Z\",\"readings\":[{\"sensor\":\"UDL-D\",\"tipo\":\"tanque_nivel\",\"v\":64,\"batt\":91,\"rssi\":-68},{\"sensor\":\"SWL-D\",\"tipo\":\"tanque_nivel\",\"v\":61,\"batt\":80,\"rssi\":-77},{\"sensor\":\"MOL-D-golpes\",\"tipo\":\"molino_golpes\",\"v\":420,\"batt\":88},{\"sensor\":\"BE-D-corr\",\"tipo\":\"corriente_bomba\",\"v\":0}]}" >/dev/null
sleep 2
echo "  seeded + ingested."

echo "── login (sesión) ──"
LC=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/login -H 'content-type: application/json' -d "{\"user\":\"$U\",\"password\":\"$P\"}")
[ "$LC" = "200" ] && ok "login 200 (cookie de sesión)" || bad "login falló: $LC"

echo "── /api/overview ──"
OV=$(curl -s -b "$JAR" "localhost:3000/api/overview?field=$F")
echo "$OV" | grep -q '"name":"Campo Tablero"' && ok "overview trae el campo" || bad "overview sin campo"
echo "$OV" | grep -q '"role":"primary"' && ok "UDL expuesto como primario" || bad "falta role primary"
echo "$OV" | grep -q '"role":"comparison"' && ok "SWL expuesto como comparación (head-to-head UDL vs SWL)" || bad "falta role comparison"
echo "$OV" | grep -q '"battery":91' && ok "batería por sensor expuesta (91%)" || bad "falta batería"
echo "$OV" | grep -q '"tank_ref":"tank-D"' && ok "tank_ref por sensor expuesto" || bad "falta tank_ref"
echo "$OV" | grep -q '"signal_baseline_rssi":-70' && ok "estado de gateway (RSSI) presente" || bad "falta rssi gateway"

echo "── /api/series (tanque vs golpes) ──"
SER=$(curl -s -b "$JAR" "localhost:3000/api/series?field=$F&tank=tank-D&hours=48")
echo "$SER" | grep -q '"strokes"' && echo "$SER" | grep -q '"tank"' && ok "series trae tanque + golpes" || bad "series incompleta"

echo "── assets servidos ──"
DJ=$(curl -s -b "$JAR" localhost:3000/dashboard.js); echo "$DJ" | grep -q "Sensores\|#sensors\|roleBadge" && ok "dashboard.js nuevo servido (sección Sensores)" || bad "dashboard.js viejo"
HC=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" localhost:3000/dashboard.html); [ "$HC" = "200" ] && ok "dashboard.html 200" || bad "dashboard.html $HC"
# auth still enforced
UC=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/overview); [ "$UC" = "401" ] && ok "sin sesión → 401 (solo Famacon)" || bad "guard roto: $UC"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T';
DELETE FROM alert WHERE tenant_id='$T'; DELETE FROM sensor WHERE tenant_id='$T';
DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM gateway WHERE tenant_id='$T';
DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
rm -f "$JAR"; echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ DASHBOARD (Item B) PASSED" || echo "RESULT: ❌ DASHBOARD FAILED"
exit $FAIL
