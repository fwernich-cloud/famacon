-- ── Time-series storage (§4b.2 / NFR3) ─────────────────────────────────────
-- Turn `reading` into a hypertable partitioned by time. Trend queries stay flat
-- as data grows to many fields and years.
SELECT create_hypertable('reading', 'ts', chunk_time_interval => INTERVAL '7 days', migrate_data => true);

CREATE INDEX idx_reading_sensor_ts ON reading (sensor_id, ts DESC);
CREATE INDEX idx_reading_tenant_ts ON reading (tenant_id, ts DESC);
CREATE INDEX idx_reading_field_kind_ts ON reading (field_id, kind, ts DESC);

-- Continuous aggregate: pre-rolled daily min/max/avg/last per sensor. This is what
-- makes "windmill performance over the last 12 months" read ~365 rows, not millions —
-- and gives Phase 2 (Level-3 wear/herd prediction) ready-made trend inputs, no ETL.
CREATE MATERIALIZED VIEW reading_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts) AS day,
  tenant_id, field_id, sensor_id, kind,
  avg(value)  AS avg_value,
  min(value)  AS min_value,
  max(value)  AS max_value,
  last(value, ts) AS last_value,
  count(*)    AS n
FROM reading
GROUP BY day, tenant_id, field_id, sensor_id, kind
WITH NO DATA;

SELECT add_continuous_aggregate_policy('reading_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- Compression is enabled LAST (09_compression.sql), AFTER RLS — TimescaleDB does
-- not allow toggling RLS on a hypertable once columnstore/compression is on.
