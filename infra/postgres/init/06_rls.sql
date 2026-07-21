-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security — per-producer isolation from day 1 (§3.2 / NFR1)
-- Producer A can never see producer B's data "ni por error ni a propósito".
-- Policy: a row is visible only when its tenant_id equals the connection's
-- app.tenant_id. FORCE guarantees it applies even to the table owner.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'field','gateway','equipment','sensor','raw_message','reading',
    'product_windmill','product_pump_table','tank_geometry',
    'recipient','consent','alert','wa_message'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $p$, t);
  END LOOP;
END $$;

-- `tenant` itself: readable/writable only for the active tenant.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- Note: current_setting(..., true) returns NULL when unset → the ::uuid compare
-- yields NULL → row hidden. Default-deny: no tenant context means no rows.
