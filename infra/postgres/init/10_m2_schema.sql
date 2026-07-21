-- ═══════════════════════════════════════════════════════════════════════════
-- M2 additions — engine, watchdog, alert lifecycle
-- Applied on fresh init here; the same statements are applied to a running DB
-- via scripts/apply-migration.sh (idempotent, IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- Alert lifecycle: a condition that stays true is ONE incident, not one alert per
-- reading. dedup_key + a partial unique index enforce "one open alert per subject".
ALTER TABLE alert ADD COLUMN IF NOT EXISTS dedup_key text;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_open_key
  ON alert (tenant_id, dedup_key) WHERE status = 'open';

-- Per-field alerting policy (tunable without code). Defaults live in engine/policy.js;
-- a row here overrides them. This keeps thresholds as data, editable later via Item C.
ALTER TABLE field ADD COLUMN IF NOT EXISTS alert_policy jsonb;
