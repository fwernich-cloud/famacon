-- Hito 4 #5 — hide the demo tenant from the internal dashboard.
-- The demo field ("Campo Modelo") was sorting first in list_fields(), so the dashboard
-- loaded it by default without ?field=. A `hidden` flag keeps demo out of the field list
-- and the default pick in one place; per-field endpoints (pinned by id) still work, so the
-- standalone m2-demo page is unaffected.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
UPDATE tenant SET hidden = true WHERE id = '00000000-0000-0000-0000-00000000da00';

CREATE OR REPLACE FUNCTION list_fields()
RETURNS TABLE (field_id uuid, tenant_id uuid, field_name text, tenant_name text,
               lat double precision, lon double precision)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.tenant_id, f.name, t.name, f.lat, f.lon
  FROM field f JOIN tenant t ON t.id = f.tenant_id
  WHERE NOT t.hidden
  ORDER BY t.name, f.name;
$$;
GRANT EXECUTE ON FUNCTION list_fields() TO famacon_app;
