#!/usr/bin/env bash
# ── E2E: real Milesight/ChirpStack path through the live stack ──────────────
# Seeds a Milesight gateway + sensors + tank geometry, publishes ChirpStack
# uplinks through Mosquitto, asserts the two conversions (cumulative counter →
# stroke delta, ultrasonic distance → level %) plus raw-meta preservation and
# idempotency, then tears everything down. Tenant is BYPASSRLS-inserted as admin.
set -uo pipefail
cd "$(dirname "$0")/../.."

PSQL() { docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
U=$(grep -E '^MQTT_USER=' .env | cut -d= -f2- | tr -d '"')
P=$(grep -E '^MQTT_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PUB() { docker compose exec -T mosquitto mosquitto_pub -u "$U" -P "$P" -t "$1" -m "$2"; }

T=00000000-0000-0000-0000-0000000e2e00   # tenant
F=00000000-0000-0000-0000-0000000e2e01   # field
G=00000000-0000-0000-0000-0000000e2e02   # gateway
EW=00000000-0000-0000-0000-0000000e2e03  # windmill
EP=00000000-0000-0000-0000-0000000e2e04  # pump
DI=24e124710c000001; UDL=24e124710c000002; CT=24e124710c000003; SWL=24e124710c000004
APP=app-e2e
FAIL=0
ok(){ echo "  ✓ $1"; }
bad(){ echo "  ✗ $1"; FAIL=1; }

echo "── setup ──"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','E2E Milesight');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo E2E',-35.30,-57.32);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s)
  VALUES ('$G','$T','$F','$APP','milesight-chirpstack@1',10800);
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES
  ('$EW','$T','$F','windmill','MOL-E2E','TQ-E2E'),
  ('$EP','$T','$F','pump','BE-E2E','TQ-E2E');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref) VALUES
  ('$T','$F','$G','$EW','$DI','windmill_strokes',NULL),
  ('$T','$F','$G',NULL,'$UDL','tank_level','TQ-E2E'),
  ('$T','$F','$G','$EP','$CT','pump_current',NULL),
  ('$T','$F','$G',NULL,'$SWL','tank_level','TQ-E2E');
INSERT INTO tank_geometry(tenant_id,field_id,tank_ref,shape,diameter_mm,height_mm,sensor_offset_mm)
  VALUES ('$T','$F','TQ-E2E','cylinder',3000,2000,300);
SQL
echo "  seeded tenant/field/gateway/4 sensors/geometry(útil=2000mm, offset=300mm)"

rx='"rxInfo":[{"gatewayId":"gwA","rssi":-95,"snr":7},{"gatewayId":"gwB","rssi":-72,"snr":9}]'

echo "── publish ChirpStack uplinks via Mosquitto ──"
# EM300-DI: cumulative counter 1000 (baseline) then 1170 (Δ=170 strokes)
PUB "application/$APP/device/$DI/event/up" \
 "{\"deduplicationId\":\"e2e-di-1\",\"time\":\"2026-07-24T10:00:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM300-DI\",\"devEui\":\"$DI\"},\"fCnt\":1,\"object\":{\"battery\":88,\"temperature\":21,\"humidity\":60,\"gpio_1\":\"on\",\"pulse\":1000},$rx}"
PUB "application/$APP/device/$DI/event/up" \
 "{\"deduplicationId\":\"e2e-di-2\",\"time\":\"2026-07-24T13:00:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM300-DI\",\"devEui\":\"$DI\"},\"fCnt\":2,\"object\":{\"battery\":87,\"temperature\":22,\"humidity\":61,\"gpio_1\":\"on\",\"pulse\":1170},$rx}"
# EM500-UDL: distance 1300mm → (2000-(1300-300))/2000 = 50%
PUB "application/$APP/device/$UDL/event/up" \
 "{\"deduplicationId\":\"e2e-udl-1\",\"time\":\"2026-07-24T13:05:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-UDL\",\"devEui\":\"$UDL\"},\"fCnt\":1,\"object\":{\"battery\":90,\"distance\":1300},$rx}"
# CT101: current 3.4 A (direct)
PUB "application/$APP/device/$CT/event/up" \
 "{\"deduplicationId\":\"e2e-ct-1\",\"time\":\"2026-07-24T13:05:10+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"CT101\",\"devEui\":\"$CT\"},\"fCnt\":1,\"object\":{\"battery\":95,\"current\":3.4},$rx}"
# EM500-SWL: depth 1000mm → 1000/2000 = 50%
PUB "application/$APP/device/$SWL/event/up" \
 "{\"deduplicationId\":\"e2e-swl-1\",\"time\":\"2026-07-24T13:05:20+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-SWL\",\"devEui\":\"$SWL\"},\"fCnt\":1,\"object\":{\"battery\":77,\"water_level\":1000},$rx}"

echo "── poll until 5 readings land (timeout ~12s) ──"
for i in $(seq 1 24); do
  N=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")
  [ "$N" = "5" ] && break
  sleep 0.5
done
echo "  readings stored: $N"

echo "── assert ──"
# counter_delta: baseline reading has NULL value + counter=1000
V1=$(PSQL -c "SELECT coalesce(value::text,'NULL') FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$DI' ORDER BY r.ts ASC LIMIT 1;")
C1=$(PSQL -c "SELECT meta->>'counter' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$DI' ORDER BY r.ts ASC LIMIT 1;")
[ "$V1" = "NULL" ] && ok "EM300-DI first report: strokes=NULL (no baseline yet)" || bad "first strokes should be NULL, got $V1"
[ "$C1" = "1000" ] && ok "EM300-DI first report: raw counter 1000 kept in meta" || bad "meta.counter should be 1000, got $C1"
# second reading: value=170 delta, meta counter=1170 prev=1000
V2=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$DI' ORDER BY r.ts DESC LIMIT 1;")
C2=$(PSQL -c "SELECT meta->>'counter' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$DI' ORDER BY r.ts DESC LIMIT 1;")
CP=$(PSQL -c "SELECT meta->>'counter_prev' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$DI' ORDER BY r.ts DESC LIMIT 1;")
[ "$V2" = "170" ] && ok "EM300-DI Δ strokes = 170 (1170-1000)" || bad "delta should be 170, got $V2"
[ "$C2" = "1170" ] && [ "$CP" = "1000" ] && ok "raw counter 1170 (prev 1000) kept in meta" || bad "meta counter/prev wrong: $C2/$CP"
# distance_top → level %
VU=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL';")
DU=$(PSQL -c "SELECT meta->>'distance_mm' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL';")
[ "$VU" = "50" ] && ok "EM500-UDL distance 1300mm → level 50%" || bad "UDL level should be 50, got $VU"
[ "$DU" = "1300" ] && ok "EM500-UDL raw distance 1300mm kept in meta" || bad "meta.distance_mm should be 1300, got $DU"
# CT101 direct + depth_bottom
VC=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$CT';")
[ "$VC" = "3.4" ] && ok "CT101 current 3.4A (direct)" || bad "CT current should be 3.4, got $VC"
VS=$(PSQL -c "SELECT value FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$SWL';")
[ "$VS" = "50" ] && ok "EM500-SWL depth 1000mm → level 50%" || bad "SWL level should be 50, got $VS"
# rssi (best gateway) + battery landed
RS=$(PSQL -c "SELECT rssi FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL';")
BT=$(PSQL -c "SELECT battery FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$UDL';")
[ "$RS" = "-72" ] && ok "RSSI = best of the 2 gateways (-72)" || bad "rssi should be -72, got $RS"
[ "$BT" = "90" ] && ok "battery 90% stored alongside" || bad "battery should be 90, got $BT"

echo "── idempotency: re-publish e2e-di-1 (same dedup) ──"
PUB "application/$APP/device/$DI/event/up" \
 "{\"deduplicationId\":\"e2e-di-1\",\"time\":\"2026-07-24T10:00:00+00:00\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM300-DI\",\"devEui\":\"$DI\"},\"fCnt\":1,\"object\":{\"battery\":88,\"pulse\":1000},$rx}"
for i in $(seq 1 8); do sleep 0.5; done
NDUP=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")
[ "$NDUP" = "5" ] && ok "duplicate uplink dropped (still 5 readings)" || bad "idempotency broke: $NDUP readings"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM reading WHERE tenant_id='$T';
DELETE FROM raw_message WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T';
DELETE FROM equipment WHERE tenant_id='$T';
DELETE FROM tank_geometry WHERE tenant_id='$T';
DELETE FROM gateway WHERE tenant_id='$T';
DELETE FROM field WHERE tenant_id='$T';
DELETE FROM tenant WHERE id='$T';
SQL
LEFT=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")
echo "  cleaned up (residual readings: $LEFT)"

echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ ALL E2E ASSERTIONS PASSED" || echo "RESULT: ❌ SOME ASSERTIONS FAILED"
exit $FAIL
