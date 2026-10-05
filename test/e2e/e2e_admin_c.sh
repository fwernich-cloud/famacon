#!/usr/bin/env bash
# ── E2E: M4 Item C admin → engine loop ─────────────────────────────────────
# Federico enters the tank geometry + ultrasonic sensor offset via the admin API;
# then a real Milesight UDL uplink must convert distance→level % using that offset.
# Proves the data-entry-to-engine loop. Throwaway tenant, cleaned up.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
JAR=$(mktemp)
DU=$(grep -E '^DASHBOARD_USER=' .env | cut -d= -f2- | tr -d '"'); DP=$(grep -E '^DASHBOARD_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
MU=$(grep -E '^MQTT_USER=' .env | cut -d= -f2- | tr -d '"'); MP=$(grep -E '^MQTT_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PUB(){ docker compose exec -T mosquitto mosquitto_pub -u "$MU" -P "$MP" -t "$1" -m "$2"; }
T=00000000-0000-0000-0000-0000000e2e50; F=00000000-0000-0000-0000-0000000e2e51; G=00000000-0000-0000-0000-0000000e2e52
UDL=24e124710c0000c1; APP=app-c

echo "── setup: gateway Milesight + sensor UDL + tanque SIN geometría (a confirmar) ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E AdminC');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo AdminC',-35.3,-57.3);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s) VALUES ('$G','$T','$F','$APP','milesight-chirpstack@1',10800);
INSERT INTO sensor(tenant_id,field_id,gateway_id,ext_ref,kind,tank_ref) VALUES ('$T','$F','$G','$UDL','tank_level','TQ-C');
INSERT INTO tank_geometry(tenant_id,field_id,tank_ref,shape) VALUES ('$T','$F','TQ-C','cylinder');
SQL
echo "  seeded (TQ-C sin alto ni offset todavía)."

echo "── login ──"
LC=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/login -H 'content-type: application/json' -d "{\"user\":\"$DU\",\"password\":\"$DP\"}")
[ "$LC" = "200" ] && ok "login 200" || bad "login $LC"

echo "── caso A: sin geometría → distancia se guarda cruda, nivel NULL (degrada) ──"
PUB "application/$APP/device/$UDL/event/up" "{\"deduplicationId\":\"c-1\",\"time\":\"2026-07-27T10:00:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-UDL\",\"devEui\":\"$UDL\"},\"object\":{\"battery\":90,\"distance\":1300}}"
for i in $(seq 1 16); do N=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';"); [ "$N" -ge 1 ] && break; sleep 0.5; done
VA=$(PSQL -c "SELECT coalesce(value::text,'NULL') FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL' ORDER BY r.ts DESC LIMIT 1;")
DA=$(PSQL -c "SELECT meta->>'distance_mm' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL' ORDER BY r.ts DESC LIMIT 1;")
[ "$VA" = "NULL" ] && ok "sin geometría: nivel NULL (no inventa)" || bad "nivel debería ser NULL, fue $VA"
[ "$DA" = "1300" ] && ok "distancia cruda 1300mm guardada en meta" || bad "meta.distance_mm=$DA"

echo "── Federico carga la geometría por el admin (PUT /api/product/tank) ──"
PC=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X PUT localhost:3000/api/product/tank -H 'content-type: application/json' \
  -d "{\"field\":\"$F\",\"tank_ref\":\"TQ-C\",\"shape\":\"cylinder\",\"diameter_mm\":3000,\"height_mm\":2000,\"sensor_offset_mm\":300}")
[ "$PC" = "200" ] && ok "PUT tank 200 (alto 2000mm, offset 300mm)" || bad "PUT tank $PC"
GOT=$(curl -s -b "$JAR" "localhost:3000/api/product?field=$F")
echo "$GOT" | grep -q '"sensor_offset_mm":300' && ok "/api/product devuelve sensor_offset_mm=300" || bad "no vuelve el offset"
echo "$GOT" | grep -q '"height_mm":2000' && ok "/api/product devuelve height_mm=2000" || bad "no vuelve el alto"

echo "── caso B: con geometría cargada → nueva lectura convierte distancia→nivel % ──"
PUB "application/$APP/device/$UDL/event/up" "{\"deduplicationId\":\"c-2\",\"time\":\"2026-07-27T11:00:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-UDL\",\"devEui\":\"$UDL\"},\"object\":{\"battery\":90,\"distance\":1300}}"
for i in $(seq 1 16); do N=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';"); [ "$N" -ge 2 ] && break; sleep 0.5; done
VB=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL' ORDER BY r.ts DESC LIMIT 1;")
# (2000 - (1300-300))/2000*100 = 50
[ "$VB" = "50" ] && ok "distancia 1300mm → nivel 50% usando el offset del admin" || bad "nivel esperado 50, fue $VB"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T'; DELETE FROM tank_geometry WHERE tenant_id='$T';
DELETE FROM gateway WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
rm -f "$JAR"; echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ ADMIN→ENGINE (Item C) PASSED" || echo "RESULT: ❌ ADMIN→ENGINE FAILED"
exit $FAIL
