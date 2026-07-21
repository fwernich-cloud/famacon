// ── Sensor simulator (proposal §8.5) ───────────────────────────────────────
// Emits synthetic gateway payloads so the whole pipeline — ingestion, engine,
// watchdog, alerts — can be validated before real hardware arrives. Covers the
// three cross-diagnosis situations plus sensor-down and gateway-down.
//
// Env:
//   SERVER_URL   default http://server:3000  (HTTP transport)
//   MQTT_URL     if set with SIM_TRANSPORT=mqtt, publishes to famacon/<gw>/up
//   SIM_TRANSPORT  http | mqtt   (default http)
//   SIM_GW       default gw_esp_test
//   SIM_MODE     cycle | scenario  (default cycle)
//   SIM_PERIOD_MS default 15000   (cadence between emissions in cycle mode)

import { randomUUID } from 'node:crypto';

const SERVER_URL = process.env.SERVER_URL || 'http://server:3000';
const GW = process.env.SIM_GW || 'gw_esp_test';
const TRANSPORT = process.env.SIM_TRANSPORT || 'http';
const MODE = process.env.SIM_MODE || 'cycle';
const PERIOD = parseInt(process.env.SIM_PERIOD_MS || '15000', 10);

let mqttClient = null;
if (TRANSPORT === 'mqtt') {
  const mqtt = (await import('mqtt')).default;
  mqttClient = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD,
  });
  await new Promise((res) => mqttClient.on('connect', res));
  console.log('[sim] MQTT connected');
}

function msg(readings) {
  return { gw: GW, uuid: randomUUID(), ts: new Date().toISOString(), readings };
}

async function send(payload, { forceUuid } = {}) {
  if (forceUuid) payload.uuid = forceUuid;
  if (TRANSPORT === 'mqtt') {
    mqttClient.publish(`famacon/${GW}/up`, JSON.stringify(payload), { qos: 1 });
    return { via: 'mqtt' };
  }
  const r = await fetch(`${SERVER_URL}/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { via: 'http', status: r.status, body: await r.json().catch(() => ({})) };
}

// Reading builders — vocab matches the generic-json@1 decoder.
const molino = (v, batt = 90, rssi = -72) => ({ sensor: 's_test_molino', tipo: 'molino_golpes', v, batt, rssi });
const tanque = (v, batt = 90, rssi = -72) => ({ sensor: 's_test_tanque', tipo: 'tanque_nivel', v, batt, rssi });

async function scenario() {
  console.log('[sim] scenario run');
  // 1) baseline — tank OK, windmill running → SILENCE
  console.log(' 1. baseline (tank 70, molino 45):', await send(msg([molino(45), tanque(70)])));
  // 2) drinking — tank dropping, windmill running → SILENCE (normal)
  console.log(' 2. drinking (tank 58, molino 43):', await send(msg([molino(43), tanque(58)])));
  // 3) failure — tank dropping, windmill STOPPED → URGENT
  console.log(' 3. failure  (tank 12, molino 0): ', await send(msg([molino(0), tanque(12)])));
  // 4) idempotency — resend the SAME uuid → must be dropped
  const dup = msg([molino(0), tanque(12)]);
  console.log(' 4. idempotency first  :', await send({ ...dup }));
  console.log(' 4. idempotency resend :', await send({ ...dup }, { forceUuid: dup.uuid }));
  // 5) sensor-down — gateway still reports tank, molino sensor goes silent
  console.log(' 5. sensor-down (only tanque):', await send(msg([tanque(40)])));
  // 6) gateway-down — nothing sent at all (simulated by stopping). Watchdog (M2) reacts.
  console.log(' 6. gateway-down: (emitting nothing — watchdog territory)');
}

async function cycle() {
  // A living field: tank slowly drops while animals drink, windmill refills it,
  // with an occasional stoppage. Gives the dashboard something real to show.
  let tank = 70, running = true, tick = 0;
  for (;;) {
    tick++;
    if (tick % 12 === 0) running = !running; // toggle a stoppage every ~12 ticks
    const strokes = running ? 40 + Math.round(Math.random() * 10) : 0;
    tank += running ? +Math.random() * 3 : -(1 + Math.random() * 2); // drink/refill
    tank = Math.max(5, Math.min(95, tank));
    const rssi = -70 - Math.round(Math.random() * 8);
    const out = await send(msg([molino(strokes, 88, rssi), tanque(Math.round(tank), 88, rssi)]));
    console.log(`[sim] tick ${tick} tank=${tank.toFixed(0)} strokes=${strokes} running=${running}`, out.status || out.via);
    await new Promise((r) => setTimeout(r, PERIOD));
  }
}

if (MODE === 'scenario') { await scenario(); if (mqttClient) mqttClient.end(); }
else await cycle();
