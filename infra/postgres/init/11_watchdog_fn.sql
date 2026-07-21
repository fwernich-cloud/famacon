-- Cross-tenant gateway heartbeat scan for the watchdog. The watchdog is a system
-- task that must see ALL gateways to detect silence; this SECURITY DEFINER function
-- is the single sanctioned system-level read. Alert WRITES still happen per-tenant.
CREATE OR REPLACE FUNCTION wd_gateways()
RETURNS TABLE (gateway_id uuid, tenant_id uuid, field_id uuid, ext_ref text,
               expected_period_s int, last_seen_at timestamptz, signal_baseline_rssi double precision)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, field_id, ext_ref, expected_period_s, last_seen_at, signal_baseline_rssi
  FROM gateway;
$$;
GRANT EXECUTE ON FUNCTION wd_gateways() TO famacon_app;
