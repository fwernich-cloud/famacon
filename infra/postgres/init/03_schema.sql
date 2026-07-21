-- ═══════════════════════════════════════════════════════════════════════════
-- Famacon Control — core schema
-- Every tenant-scoped table carries tenant_id and (below, in 06_rls.sql) an RLS
-- policy. Sensor readings are a TimescaleDB hypertable (05). History is NEVER
-- deleted (§3.3). Product data lives here, editable by Famacon — never in code (§3.1).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tenancy & topology ─────────────────────────────────────────────────────
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  lat         double precision,          -- for the solar/weather cross (§6.7)
  lon         double precision,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_field_tenant ON field(tenant_id);

CREATE TABLE gateway (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  field_id       uuid NOT NULL REFERENCES field(id) ON DELETE RESTRICT,
  ext_ref        text NOT NULL,               -- id the hardware sends ("gw_esp_test")
  hardware_profile text NOT NULL DEFAULT 'generic-json@1',  -- which DECODER to use (§2)
  expected_period_s int NOT NULL DEFAULT 10800,  -- ~3h cadence; watchdog window
  last_seen_at   timestamptz,
  signal_baseline_rssi double precision,      -- learned per-site baseline (§6.4)
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ext_ref)                            -- gateway ids are globally unique
);
CREATE INDEX idx_gateway_tenant ON gateway(tenant_id);

CREATE TABLE equipment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  field_id    uuid NOT NULL REFERENCES field(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('windmill','solar_pump','pump')),
  name        text NOT NULL,
  fills_tank  text,                           -- logical tank id it feeds
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_tenant ON equipment(tenant_id);

CREATE TABLE sensor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  field_id       uuid NOT NULL REFERENCES field(id) ON DELETE RESTRICT,
  gateway_id     uuid NOT NULL REFERENCES gateway(id) ON DELETE RESTRICT,
  equipment_id   uuid REFERENCES equipment(id) ON DELETE SET NULL,
  ext_ref        text NOT NULL,               -- id the hardware sends ("s_test_tanque")
  kind           text NOT NULL CHECK (kind IN
                   ('tank_level','windmill_strokes','pump_current','battery','temperature')),
  tank_ref       text,                        -- which tank this level sensor measures
  expected_period_s int NOT NULL DEFAULT 10800,  -- heartbeat window (§6.4)
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway_id, ext_ref)
);
CREATE INDEX idx_sensor_tenant ON sensor(tenant_id);
CREATE INDEX idx_sensor_field ON sensor(field_id);

-- ── Ingestion: raw audit trail + idempotency (§6.1) ────────────────────────
CREATE TABLE raw_message (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid REFERENCES tenant(id),
  gateway_id   uuid REFERENCES gateway(id),
  gateway_ext  text NOT NULL,
  msg_uuid     text NOT NULL,                 -- the gateway's per-message UUID
  transport    text NOT NULL CHECK (transport IN ('mqtt','http')),
  payload      jsonb NOT NULL,                -- verbatim, for replay/audit
  decoded      boolean NOT NULL DEFAULT false,
  received_at  timestamptz NOT NULL DEFAULT now(),
  -- IDEMPOTENCY: a 4G retry that resends the same message is dropped here.
  UNIQUE (gateway_ext, msg_uuid)
);
CREATE INDEX idx_raw_received ON raw_message(received_at DESC);

-- ── Sensor readings: the time-series (hypertable created in 05) ─────────────
CREATE TABLE reading (
  ts          timestamptz NOT NULL,
  tenant_id   uuid NOT NULL,
  field_id    uuid NOT NULL,
  sensor_id   uuid NOT NULL,
  kind        text NOT NULL,
  value       double precision,
  battery     double precision,
  rssi        double precision,
  meta        jsonb,
  raw_msg_id  bigint,
  -- one reading per sensor per timestamp; guards against any double-decode.
  UNIQUE (sensor_id, ts)
);

-- ── Product data — Famacon's IP, in the DB, edited via Item C (§3.1) ───────
CREATE TABLE product_windmill (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name                 text NOT NULL,
  cylinder_diameter_mm double precision NOT NULL,   -- internal Ø
  rod_stroke_mm        double precision NOT NULL,    -- carrera
  volumetric_eff       double precision NOT NULL DEFAULT 0.9,
  notes                text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pwindmill_tenant ON product_windmill(tenant_id);

CREATE TABLE product_pump_table (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  pump_name      text NOT NULL,
  irradiance_wm2 double precision NOT NULL,     -- input: solar irradiance
  expected_lph   double precision NOT NULL,     -- output: expected liters/hour
  UNIQUE (tenant_id, pump_name, irradiance_wm2)
);
CREATE INDEX idx_ppump_tenant ON product_pump_table(tenant_id);

CREATE TABLE tank_geometry (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  field_id     uuid REFERENCES field(id) ON DELETE SET NULL,
  tank_ref     text NOT NULL,
  shape        text NOT NULL DEFAULT 'cylinder' CHECK (shape IN ('cylinder','rectangular')),
  diameter_mm  double precision,
  width_mm     double precision,
  length_mm    double precision,
  height_mm    double precision,        -- útil; NULL = a confirmar en el piloto
  capacity_l   double precision,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tank_ref)
);
CREATE INDEX idx_tank_tenant ON tank_geometry(tenant_id);

-- ── Alerting & recipients (populated in M2/M3; schema ready in M1) ─────────
CREATE TABLE recipient (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  phone_e164  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_e164)
);
CREATE INDEX idx_recipient_tenant ON recipient(tenant_id);

-- Auditable consent (§6.5 / NFR5 Ley 25.326): timestamp + IP, revocable.
CREATE TABLE consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  recipient_id   uuid NOT NULL REFERENCES recipient(id) ON DELETE CASCADE,
  channel        text NOT NULL DEFAULT 'whatsapp',
  granted        boolean NOT NULL DEFAULT false,
  granted_at     timestamptz,
  granted_ip     inet,
  policy_version text,
  revoked_at     timestamptz
);
CREATE INDEX idx_consent_recipient ON consent(recipient_id);

CREATE TABLE alert (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  field_id    uuid REFERENCES field(id) ON DELETE SET NULL,
  level       text NOT NULL,                  -- n1_threshold | n2_window | watchdog | solar
  type        text NOT NULL,
  severity    text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','urgent')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','suppressed')),
  diagnosis   text,
  detail      jsonb,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX idx_alert_tenant ON alert(tenant_id);
CREATE INDEX idx_alert_open ON alert(tenant_id, status) WHERE status = 'open';

CREATE TABLE wa_message (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  alert_id      uuid REFERENCES alert(id) ON DELETE SET NULL,
  recipient_id  uuid REFERENCES recipient(id) ON DELETE SET NULL,
  template      text,
  wa_message_id text,                          -- Meta's message id
  status        text NOT NULL DEFAULT 'queued',-- queued|sent|delivered|read|failed
  status_at     timestamptz NOT NULL DEFAULT now(),
  error         text
);
CREATE INDEX idx_wa_tenant ON wa_message(tenant_id);
