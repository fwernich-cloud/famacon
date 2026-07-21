// generic-json@1 — the reference decoder used by the demo gateway.
// Payload shape:
//   { gw, uuid, ts, readings: [ { sensor, tipo, v, batt?, rssi? }, ... ] }
// `tipo` uses the field's Spanish vocabulary; we map it to canonical kinds.

const TIPO_TO_KIND = {
  tanque_nivel: 'tank_level',
  molino_golpes: 'windmill_strokes',
  corriente_bomba: 'pump_current',
  bateria: 'battery',
  temperatura: 'temperature',
  // already-canonical kinds pass through
  tank_level: 'tank_level',
  windmill_strokes: 'windmill_strokes',
  pump_current: 'pump_current',
  battery: 'battery',
  temperature: 'temperature',
};

export default {
  profile: 'generic-json@1',
  decode(payload) {
    if (!payload || !Array.isArray(payload.readings)) {
      throw new Error('generic-json: payload.readings[] required');
    }
    const ts = payload.ts ? new Date(payload.ts) : new Date();
    const readings = payload.readings.map((r) => {
      const kind = TIPO_TO_KIND[r.tipo];
      if (!kind) throw new Error(`generic-json: unknown tipo "${r.tipo}"`);
      if (!r.sensor) throw new Error('generic-json: reading.sensor required');
      return {
        sensorRef: String(r.sensor),
        kind,
        value: r.v == null ? null : Number(r.v),
        battery: r.batt == null ? null : Number(r.batt),
        rssi: r.rssi == null ? null : Number(r.rssi),
        ts: r.ts ? new Date(r.ts) : ts,
      };
    });
    return { msgUuid: payload.uuid, gatewayRef: payload.gw, readings };
  },
};
