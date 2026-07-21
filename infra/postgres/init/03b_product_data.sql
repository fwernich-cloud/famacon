-- ═══════════════════════════════════════════════════════════════════════════
-- Product data (Famacon's IP) — §3.1: lives in the DB, editable via Item C,
-- never in code. Reference catalogs + per-windmill configuration.
-- Idempotent; applied on fresh init and to the running DB.
-- ═══════════════════════════════════════════════════════════════════════════

-- Measured internal cylinder diameters (nominal → mm). 4½" stays NULL until measured.
CREATE TABLE IF NOT EXISTS cylinder_catalog (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  nominal              text NOT NULL,               -- e.g. '3"', '4 1/2"'
  internal_diameter_mm double precision,            -- measured; NULL = pending
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nominal)
);

-- Carrera (rod stroke) by wheel size.
CREATE TABLE IF NOT EXISTS wheel_spec (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  wheel_ft   int NOT NULL,
  carrera_cm double precision NOT NULL,
  UNIQUE (tenant_id, wheel_ft)
);

-- Pumping/flow reference (catálogo pág.21): wheel → elevation → recommended
-- cylinder/pipe → expected flow. Drives the selection wizard and expected caudal.
CREATE TABLE IF NOT EXISTS pump_flow_reference (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  wheel_ft         int NOT NULL,
  elevation_m      double precision NOT NULL,
  cylinder_nominal text,               -- RECOMMENDED cylinder (≠ necessarily installed)
  pipe_nominal     text,
  flow_lph         double precision NOT NULL,
  UNIQUE (tenant_id, wheel_ft, elevation_m)
);

-- Per-windmill configuration (one row per windmill equipment). Diameter is derived
-- from cylinder_nominal via cylinder_catalog; carrera from wheel_ft via wheel_spec.
-- eta_base is the volumetric efficiency measured in the pilot with a new cuero —
-- NULL until calibrated (until then the engine shows TREND, not absolute value).
CREATE TABLE IF NOT EXISTS windmill_config (
  equipment_id      uuid PRIMARY KEY REFERENCES equipment(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  wheel_ft          int,
  cylinder_nominal  text,              -- installed cylinder (a confirmar en piloto)
  eta_base          double precision,  -- NULL = not yet calibrated
  eta_calibrated_at timestamptz,
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- RLS + grants for the new tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cylinder_catalog','wheel_spec','pump_flow_reference','windmill_config'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO famacon_app;', t);
  END LOOP;
END $$;
