-- One-time pilot provisioning — real Milesight hardware (25/09/2026).
-- Replaces the placeholder seed topology on the PILOT tenant (a0000000-…0001) with
-- the real field: 3 tank/molino pairs (Casco Silvano, Campo Bozzano, Casco Bozzano),
-- no pump. Points the gateway at the Milesight-NS decoder. Scoped to the pilot tenant
-- only — the demo tenant (00000000-…da00) is untouched.
--
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < scripts/provision-pilot.sql
BEGIN;
DELETE FROM wa_message    WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM alert         WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM reading       WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM raw_message   WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM sensor        WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM equipment     WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
DELETE FROM tank_geometry WHERE tenant_id='a0000000-0000-0000-0000-000000000001';

UPDATE gateway SET ext_ref='C0BA1FFFFE04A90F', hardware_profile='milesight-ns@1', expected_period_s=1800
 WHERE id='a0000000-0000-0000-0000-0000000000e1';

INSERT INTO equipment (tenant_id, field_id, kind, name, fills_tank) VALUES
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','windmill','Molino Casco Silvano','tank_casco_silvano'),
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','windmill','Molino Campo Bozzano','tank_campo_bozzano'),
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','windmill','Molino Casco Bozzano','tank_casco_bozzano');

INSERT INTO tank_geometry (tenant_id, field_id, tank_ref, shape) VALUES
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','tank_casco_silvano','cylinder'),
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','tank_campo_bozzano','cylinder'),
 ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','tank_casco_bozzano','cylinder');

INSERT INTO sensor (tenant_id, field_id, gateway_id, equipment_id, ext_ref, kind, tank_ref, expected_period_s)
SELECT 'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000e1',
       e.id, v.ext_ref, v.kind, v.tank_ref, 900
FROM (VALUES
  ('24e1241260615e30','tank_level','tank_casco_silvano', NULL),
  ('24e124126061a4aa','tank_level','tank_campo_bozzano', NULL),
  ('24e12412606166b2','tank_level','tank_casco_bozzano', NULL),
  ('24e124136060e1b0','windmill_strokes', NULL, 'Molino Casco Silvano'),
  ('24e12413606001b0','windmill_strokes', NULL, 'Molino Campo Bozzano'),
  ('24e124136060246b','windmill_strokes', NULL, 'Molino Casco Bozzano')
) AS v(ext_ref, kind, tank_ref, eq_name)
LEFT JOIN equipment e ON e.name=v.eq_name AND e.tenant_id='a0000000-0000-0000-0000-000000000001';
COMMIT;
