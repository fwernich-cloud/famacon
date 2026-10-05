#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# FULL-PILOT E2E — the whole journey through the REAL stack, as the live pilot runs:
# real Milesight ChirpStack uplinks over MQTT → decode → conversions (counter→strokes,
# distance→level via admin geometry) → engine (cross-diagnosis + N1 + N2 + watchdog)
# → WhatsApp dispatch (consent-gated) → verified in the DB at every stage.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
MU=$(grep -E '^MQTT_USER=' .env|cut -d= -f2-|tr -d '"'); MP=$(grep -E '^MQTT_PASSWORD=' .env|cut -d= -f2-|tr -d '"')
PUB(){ docker compose exec -T mosquitto mosquitto_pub -u "$MU" -P "$MP" -t "$1" -m "$2"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
ago(){ date -u -d "-$1 min" +%Y-%m-%dT%H:%M:%SZ; }
val(){ PSQL -c "SELECT coalesce(value::text,'NULL') FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$1' ORDER BY r.ts DESC LIMIT 1;"; }
meta(){ PSQL -c "SELECT meta->>'$2' FROM reading r JOIN sensor s ON s.id=r.sensor_id WHERE s.ext_ref='$1' ORDER BY r.ts DESC LIMIT 1;"; }
alerts(){ PSQL -c "SELECT count(*) FROM alert WHERE tenant_id='$T' AND status='open' ${1:-};"; }
wait_readings(){ for i in $(seq 1 30); do [ "$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")" -ge "$1" ] && return; sleep 0.5; done; }
wait_alert(){ for i in $(seq 1 40); do [ "$(alerts "$1")" -ge "$2" ] && return; sleep 0.5; done; }

T=00000000-0000-0000-0000-00000000fa00; F=00000000-0000-0000-0000-00000000fa01; G=00000000-0000-0000-0000-00000000fa02
M1=00000000-0000-0000-0000-00000000fa10; M2=00000000-0000-0000-0000-00000000fa11; BE=00000000-0000-0000-0000-00000000fa13
R1=00000000-0000-0000-0000-00000000fa20; R2=00000000-0000-0000-0000-00000000fa21
APP=app-lafe
DI1=24e124710c00fa01; UDL1=24e124710c00fa02; SWL1=24e124710c00fa03; CT1=24e124710c00fa04; DI2=24e124710c00fa05; UDL2=24e124710c00fa06
di(){  PUB "application/$APP/device/$1/event/up" "{\"deduplicationId\":\"$2\",\"time\":\"$3\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM300-DI\",\"devEui\":\"$1\"},\"object\":{\"battery\":88,\"pulse\":$4},\"rxInfo\":[{\"rssi\":-70}]}"; }
udl(){ PUB "application/$APP/device/$1/event/up" "{\"deduplicationId\":\"$2\",\"time\":\"$3\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-UDL\",\"devEui\":\"$1\"},\"object\":{\"battery\":90,\"distance\":$4},\"rxInfo\":[{\"rssi\":-72}]}"; }
swl(){ PUB "application/$APP/device/$1/event/up" "{\"deduplicationId\":\"$2\",\"time\":\"$3\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"EM500-SWL\",\"devEui\":\"$1\"},\"object\":{\"battery\":77,\"water_level\":$4},\"rxInfo\":[{\"rssi\":-80}]}"; }
ct(){  PUB "application/$APP/device/$1/event/up" "{\"deduplicationId\":\"$2\",\"time\":\"$3\",\"deviceInfo\":{\"applicationId\":\"$APP\",\"deviceProfileName\":\"CT101\",\"devEui\":\"$1\"},\"object\":{\"battery\":95,\"current\":$4},\"rxInfo\":[{\"rssi\":-68}]}"; }

echo "════ SETUP — Famacon instala un productor (Estancia La Fe) ════"
PSQL >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$T','Estancia La Fe');
INSERT INTO field(id,tenant_id,name,lat,lon) VALUES ('$F','$T','Campo Norte',-35.30,-57.32);
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile,expected_period_s,last_seen_at) VALUES ('$G','$T','$F','$APP','milesight-chirpstack@1',10800,now());
INSERT INTO equipment(id,tenant_id,field_id,kind,name,fills_tank) VALUES
  ('$M1','$T','$F','windmill','MOL-01','tank_01'),('$BE','$T','$F','pump','BE-01','tank_01'),('$M2','$T','$F','windmill','MOL-02','tank_02');
INSERT INTO sensor(tenant_id,field_id,gateway_id,equipment_id,ext_ref,kind,tank_ref,for_engine,expected_period_s) VALUES
  ('$T','$F','$G','$M1','$DI1','windmill_strokes',NULL,true,10800),
  ('$T','$F','$G',NULL,'$UDL1','tank_level','tank_01',true,1800),
  ('$T','$F','$G',NULL,'$SWL1','tank_level','tank_01',false,1800),
  ('$T','$F','$G','$BE','$CT1','pump_current',NULL,true,1800),
  ('$T','$F','$G','$M2','$DI2','windmill_strokes',NULL,true,10800),
  ('$T','$F','$G',NULL,'$UDL2','tank_level','tank_02',true,1800);
INSERT INTO tank_geometry(tenant_id,field_id,tank_ref,shape,diameter_mm,height_mm,sensor_offset_mm) VALUES
  ('$T','$F','tank_01','cylinder',3000,2000,300),('$T','$F','tank_02','cylinder',3000,2000,300);
INSERT INTO cylinder_catalog(tenant_id,nominal,internal_diameter_mm) VALUES ('$T','3"',76.2);
INSERT INTO wheel_spec(tenant_id,wheel_ft,carrera_cm) VALUES ('$T',8,17);
INSERT INTO windmill_config(equipment_id,tenant_id,wheel_ft,cylinder_nominal,eta_base,eta_calibrated_at) VALUES
  ('$M1','$T',8,'3"',0.85,now()),('$M2','$T',8,'3"',0.85,now());
INSERT INTO recipient(id,tenant_id,name,phone_e164) VALUES ('$R1','$T','Puestero','+5491131796848'),('$R2','$T','Sin Consent','+5491100000000');
INSERT INTO consent(tenant_id,recipient_id,channel,granted,granted_at,granted_ip,policy_version) VALUES ('$T','$R1','whatsapp',true,now(),'201.1.1.1','v1');
SQL
echo "  gateway Milesight + 2 molinos + bomba (tanque compartido) + tanque 2, geometría, η, 2 destinatarios."

echo ""; echo "════ ETAPA 1 — operación normal (molino andando, tanque lleno) ════"
di  $DI1 f1a $(ago 58) 1000
di  $DI1 f1b $(ago 55) 1200      # +200 golpes → andando
udl $UDL1 u1  $(ago 54) 900       # 900mm → 70%
swl $SWL1 s1  $(ago 53) 1400      # sumergible → 70% (comparación)
ct  $CT1  c1  $(ago 52) 0
di  $DI2 f1c $(ago 58) 500
di  $DI2 f1d $(ago 55) 640
udl $UDL2 u2  $(ago 54) 900
wait_readings 6
G1=$(val $DI1); [ "$G1" = "200" ] && ok "EM300-DI: golpes por delta acumulado = 200 (1200-1000)" || bad "golpes=$G1 (esperaba 200)"
[ "$(meta $DI1 counter)" = "1200" ] && ok "counter crudo 1200 guardado en meta" || bad "meta counter=$(meta $DI1 counter)"
[ "$(val $UDL1)" = "70" ] && ok "EM500-UDL: distancia 900mm → nivel 70% (geometría del admin)" || bad "nivel UDL=$(val $UDL1)"
[ "$(meta $UDL1 distance_mm)" = "900" ] && ok "distancia cruda 900mm guardada en meta" || bad "meta distance=$(meta $UDL1 distance_mm)"
[ "$(val $SWL1)" = "70" ] && ok "EM500-SWL: sumergible → nivel 70% (comparación UDL vs SWL)" || bad "nivel SWL=$(val $SWL1)"
[ "$(alerts)" = "0" ] && ok "sin alertas — todo en silencio" || bad "no debería haber alertas: $(alerts)"

echo ""; echo "════ ETAPA 2 — los animales toman (tanque baja, molino andando) → silencio ════"
di  $DI1 f2a $(ago 35) 1350       # +150 → sigue andando
udl $UDL1 u3  $(ago 34) 940       # 940mm → 68% (baja suave, molino andando)
sleep 3
[ "$(alerts "AND dedup_key='rule:R4:tank_01'")" = "0" ] && ok "situación 2: molino andando → NO abre crítica (R4)" || bad "falsa R4 en situación 2"

echo ""; echo "════ ETAPA 3 — falla (molino parado, bomba parada, tanque cayendo) → URGENTE ════"
di  $DI1 f3a $(ago 6) 1350        # mismo counter → delta 0 → PARADO
ct  $CT1  c3  $(ago 5) 0
udl $UDL1 u4  $(ago 4) 1980       # 1980mm → 16% (cayó fuerte)
wait_alert "AND dedup_key='rule:R4:tank_01'" 1
[ "$(val $DI1)" = "0" ] && ok "molino parado: golpes por delta = 0 (counter no subió)" || bad "golpes=$(val $DI1) (esperaba 0)"
[ "$(val $UDL1)" = "16" ] && ok "nivel cayó a 16%" || bad "nivel=$(val $UDL1) (esperaba 16)"
[ "$(alerts "AND type='R4' AND severity='urgent'")" -ge 1 ] && ok "R4 URGENTE: crítico (16<20) + todo parado" || bad "no abrió R4 urgente"
[ "$(alerts "AND type='R6'")" -ge 1 ] && ok "R6: caída rápida / posible fuga (70→16, supera 8%/h)" || bad "no abrió R6"
for i in $(seq 1 40); do [ "$(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T';")" -ge 2 ] && break; sleep 0.5; done
[ "$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';")" = "sent_dryrun" ] && ok "WhatsApp → destinatario CON consentimiento (dry-run)" || bad "no se envió al consentido (status='$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';")')"
[ "$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R2';")" = "skipped_no_consent" ] && ok "SIN consentimiento → NO se envía (Ley 25.326)" || bad "sin-consent status='$(PSQL -c "SELECT status FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R2';")'"
[ "$(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';")" = "1" ] && ok "anti-saturación: varias alertas del tanque → 1 solo WhatsApp" || bad "no consolidó a 1 ($(PSQL -c "SELECT count(*) FROM wa_message WHERE tenant_id='$T' AND recipient_id='$R1';"))"

echo ""; echo "════ ETAPA 4 — watchdog (un equipo deja de reportar) ════"
PSQL >/dev/null -c "DELETE FROM reading WHERE sensor_id=(SELECT id FROM sensor WHERE ext_ref='$DI2'); INSERT INTO reading(ts,tenant_id,field_id,sensor_id,kind,value) SELECT now()-interval '2 days',tenant_id,field_id,id,'windmill_strokes',140 FROM sensor WHERE ext_ref='$DI2'; UPDATE gateway SET last_seen_at=now() WHERE id='$G';"
docker compose exec -T server node --input-type=module -e "import('/app/src/engine/queue.js').then(m=>m.watchdogQueue.add('once',{}).then(()=>process.exit(0)))" >/dev/null 2>&1
for i in $(seq 1 40); do [ "$(alerts "AND level='watchdog'")" -ge 1 ] && break; sleep 0.5; done
[ "$(alerts "AND type='equipment_down'")" -ge 1 ] && ok "watchdog: 'equipo caído' (MOL-02 mudo, gateway vivo)" || bad "no abrió equipment_down"

echo ""; echo "════ ETAPA 5 — idempotencia (reintento del gateway 4G) ════"
NR=$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")
di $DI1 f1b $(ago 55) 1200        # MISMO deduplicationId f1b → duplicado
sleep 2
[ "$(PSQL -c "SELECT count(*) FROM reading WHERE tenant_id='$T';")" = "$NR" ] && ok "reintento con mismo msg → NO duplica lecturas" || bad "idempotencia rota"

echo ""; echo "════ teardown ════"
PSQL >/dev/null <<SQL
DELETE FROM wa_message WHERE tenant_id='$T'; DELETE FROM consent WHERE tenant_id='$T'; DELETE FROM recipient WHERE tenant_id='$T';
DELETE FROM reading WHERE tenant_id='$T'; DELETE FROM raw_message WHERE tenant_id='$T'; DELETE FROM alert WHERE tenant_id='$T';
DELETE FROM windmill_config WHERE tenant_id='$T'; DELETE FROM cylinder_catalog WHERE tenant_id='$T'; DELETE FROM wheel_spec WHERE tenant_id='$T';
DELETE FROM sensor WHERE tenant_id='$T'; DELETE FROM equipment WHERE tenant_id='$T'; DELETE FROM tank_geometry WHERE tenant_id='$T';
DELETE FROM gateway WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
echo "  limpio."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ FULL-PILOT E2E PASSED (Milesight→MQTT→motor→WhatsApp, punta a punta)" || echo "RESULT: ❌ FULL-PILOT E2E FAILED"
exit $FAIL
