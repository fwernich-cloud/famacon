import { pool } from '../db/pool.js';
import { withTenant } from '../db/withTenant.js';
import { latestReadings, equipmentForField, fieldMeta } from '../db/queries.js';
import { computePerformanceForWindmill } from '../engine/performance.js';
import { requireApi } from '../lib/auth.js';

// Resolve a field's tenant (via the SECURITY DEFINER list). Returns null if unknown.
async function tenantOfField(fieldId) {
  const { rows } = await pool.query('SELECT tenant_id FROM list_fields() WHERE field_id = $1', [fieldId]);
  return rows[0]?.tenant_id || null;
}

function equipmentState(eq, readings) {
  if (eq.kind === 'windmill') {
    const s = readings.find((r) => r.equipment_id === eq.id && r.kind === 'windmill_strokes');
    if (!s || s.value == null) return { state: 'unknown', strokes: null };
    return { state: s.value > 0 ? 'running' : 'stopped', strokes: s.value };
  }
  if (eq.kind === 'pump') {
    const c = readings.find((r) => r.equipment_id === eq.id && r.kind === 'pump_current');
    if (!c || c.value == null) return { state: 'unknown', current: null };
    return { state: c.value > 0.2 ? 'running' : 'stopped', current: c.value };
  }
  return { state: 'weather-estimated' };
}

export default async function apiRoutes(fastify) {
  fastify.addHook('onRequest', requireApi); // Famacon-only for the whole /api surface

  // ── Item B: read-only ────────────────────────────────────────────────────
  fastify.get('/api/fields', async () => {
    const { rows } = await pool.query('SELECT * FROM list_fields()');
    return { fields: rows };
  });

  fastify.get('/api/overview', async (req, reply) => {
    const fieldId = req.query.field || (await pool.query('SELECT field_id FROM list_fields() LIMIT 1')).rows[0]?.field_id;
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });

    return withTenant(tenantId, async (client) => {
      const field = await fieldMeta(client, fieldId);
      const readings = await latestReadings(client, fieldId);
      const equipment = await equipmentForField(client, fieldId);
      const gw = (await client.query(
        `SELECT ext_ref, last_seen_at, signal_baseline_rssi FROM gateway WHERE field_id=$1`, [fieldId])).rows[0];

      const tanks = readings.filter((r) => r.kind === 'tank_level');
      const equip = equipment.map((eq) => {
        const st = equipmentState(eq, readings);
        const tank = tanks.find((t) => (t.tank_ref || '') === (eq.fills_tank || ''));
        return { id: eq.id, name: eq.name, kind: eq.kind, tank_ref: eq.fills_tank,
          ...st, tank_level: tank?.value ?? null, tank_ts: tank?.ts ?? null };
      });
      const batteries = readings.filter((r) => r.battery != null)
        .map((r) => ({ sensor: r.ext_ref, battery: r.battery }));
      const alerts = (await client.query(
        `SELECT id, level, type, severity, subject, diagnosis, opened_at
           FROM alert WHERE field_id=$1 AND status='open' ORDER BY opened_at DESC`, [fieldId])).rows;

      return { field, gateway: gw, equipment: equip, batteries, open_alerts: alerts,
        sensors: readings.map((r) => ({ ext_ref: r.ext_ref, kind: r.kind, value: r.value,
          battery: r.battery, rssi: r.rssi, ts: r.ts })) };
    });
  });

  fastify.get('/api/series', async (req, reply) => {
    const fieldId = req.query.field;
    const tankRef = req.query.tank;
    const hours = Math.min(parseInt(req.query.hours || '48', 10), 720);
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    return withTenant(tenantId, async (client) => {
      const tank = (await client.query(
        `SELECT r.ts, r.value FROM reading r JOIN sensor s ON s.id=r.sensor_id
          WHERE s.tank_ref=$1 AND s.kind='tank_level' AND r.ts>=$2 ORDER BY r.ts`, [tankRef, since])).rows;
      // strokes for the equipment that fills this tank
      const strokes = (await client.query(
        `SELECT r.ts, r.value FROM reading r JOIN sensor s ON s.id=r.sensor_id
          JOIN equipment e ON e.id=s.equipment_id
          WHERE e.fills_tank=$1 AND s.kind='windmill_strokes' AND r.ts>=$2 ORDER BY r.ts`, [tankRef, since])).rows;
      return { tank_ref: tankRef, hours, tank, strokes };
    });
  });

  fastify.get('/api/alerts', async (req, reply) => {
    const fieldId = req.query.field || (await pool.query('SELECT field_id FROM list_fields() LIMIT 1')).rows[0]?.field_id;
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    return withTenant(tenantId, async (client) => ({
      alerts: (await client.query(
        `SELECT level, type, severity, subject, diagnosis, status, opened_at, resolved_at
           FROM alert WHERE field_id=$1 ORDER BY opened_at DESC LIMIT 50`, [fieldId])).rows,
    }));
  });

  fastify.get('/api/messages', async (req, reply) => {
    const fieldId = req.query.field || (await pool.query('SELECT field_id FROM list_fields() LIMIT 1')).rows[0]?.field_id;
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    return withTenant(tenantId, async (client) => ({
      messages: (await client.query(
        `SELECT w.status, w.template, w.wa_message_id, w.error, w.status_at, r.name AS recipient
           FROM wa_message w LEFT JOIN recipient r ON r.id=w.recipient_id
          WHERE w.tenant_id=$1 ORDER BY w.status_at DESC LIMIT 50`, [tenantId])).rows,
    }));
  });

  // ── Item C: product-data admin (data, not code) ──────────────────────────
  fastify.get('/api/product', async (req, reply) => {
    const fieldId = req.query.field || (await pool.query('SELECT field_id FROM list_fields() LIMIT 1')).rows[0]?.field_id;
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    return withTenant(tenantId, async (client) => {
      const q = (sql) => client.query(sql, [fieldId, tenantId]);
      const cylinders = (await client.query('SELECT nominal, internal_diameter_mm FROM cylinder_catalog WHERE tenant_id=$1 ORDER BY internal_diameter_mm NULLS LAST', [tenantId])).rows;
      const wheels = (await client.query('SELECT wheel_ft, carrera_cm FROM wheel_spec WHERE tenant_id=$1 ORDER BY wheel_ft', [tenantId])).rows;
      const windmills = (await client.query(
        `SELECT e.id AS equipment_id, e.name, wc.wheel_ft, wc.cylinder_nominal, wc.eta_base, wc.eta_calibrated_at
           FROM equipment e JOIN windmill_config wc ON wc.equipment_id=e.id WHERE e.field_id=$1 ORDER BY e.name`, [fieldId])).rows;
      const tanks = (await client.query('SELECT tank_ref, shape, diameter_mm, width_mm, length_mm, height_mm FROM tank_geometry WHERE tenant_id=$1 ORDER BY tank_ref', [tenantId])).rows;
      return { cylinders, wheels, windmills, tanks };
    });
  });

  fastify.put('/api/product/windmill', {
    schema: { body: { type: 'object', required: ['field', 'equipmentId'], properties: {
      field: { type: 'string' }, equipmentId: { type: 'string' },
      cylinder_nominal: { type: ['string', 'null'] }, eta_base: { type: ['number', 'null'] } } } },
  }, async (req, reply) => {
    const tenantId = await tenantOfField(req.body.field);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    return withTenant(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE windmill_config SET cylinder_nominal=$2::text, eta_base=$3::double precision,
           eta_calibrated_at = CASE WHEN $3::double precision IS NOT NULL THEN now() ELSE eta_calibrated_at END,
           updated_at=now() WHERE equipment_id=$1`,
        [req.body.equipmentId, req.body.cylinder_nominal ?? null, req.body.eta_base ?? null]);
      return reply.code(rowCount ? 200 : 404).send({ ok: !!rowCount });
    });
  });

  fastify.put('/api/product/tank', {
    schema: { body: { type: 'object', required: ['field', 'tank_ref'], properties: {
      field: { type: 'string' }, tank_ref: { type: 'string' }, shape: { type: 'string' },
      diameter_mm: { type: ['number', 'null'] }, width_mm: { type: ['number', 'null'] },
      length_mm: { type: ['number', 'null'] }, height_mm: { type: ['number', 'null'] } } } },
  }, async (req, reply) => {
    const tenantId = await tenantOfField(req.body.field);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    const b = req.body;
    return withTenant(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE tank_geometry SET shape=coalesce($2,shape), diameter_mm=$3, width_mm=$4,
           length_mm=$5, height_mm=$6, updated_at=now() WHERE tank_ref=$1`,
        [b.tank_ref, b.shape ?? null, b.diameter_mm ?? null, b.width_mm ?? null, b.length_mm ?? null, b.height_mm ?? null]);
      return reply.code(rowCount ? 200 : 404).send({ ok: !!rowCount });
    });
  });

  fastify.put('/api/product/cylinder', {
    schema: { body: { type: 'object', required: ['field', 'nominal', 'internal_diameter_mm'], properties: {
      field: { type: 'string' }, nominal: { type: 'string' }, internal_diameter_mm: { type: 'number' } } } },
  }, async (req, reply) => {
    const tenantId = await tenantOfField(req.body.field);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    return withTenant(tenantId, async (client) => {
      await client.query(
        `INSERT INTO cylinder_catalog (tenant_id, nominal, internal_diameter_mm) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, nominal) DO UPDATE SET internal_diameter_mm=EXCLUDED.internal_diameter_mm, updated_at=now()`,
        [tenantId, req.body.nominal, req.body.internal_diameter_mm]);
      return { ok: true };
    });
  });

  // Live performance snapshot per windmill (honest status while values pending).
  fastify.get('/api/performance', async (req, reply) => {
    const fieldId = req.query.field || (await pool.query('SELECT field_id FROM list_fields() LIMIT 1')).rows[0]?.field_id;
    const tenantId = fieldId && await tenantOfField(fieldId);
    if (!tenantId) return reply.code(404).send({ error: 'field not found' });
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    return withTenant(tenantId, async (client) => {
      const eq = await equipmentForField(client, fieldId);
      const out = [];
      for (const e of eq.filter((x) => x.kind === 'windmill')) {
        out.push({ name: e.name, ...(await computePerformanceForWindmill(client, e.id, since)) });
      }
      return { performance: out };
    });
  });
}
