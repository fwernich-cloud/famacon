-- Internal dashboard is Famacon-wide (sees every field). This SECURITY DEFINER
-- function lists fields + their tenant so the UI can pick one; per-field data is
-- then read under that tenant's RLS context (withTenant).
CREATE OR REPLACE FUNCTION list_fields()
RETURNS TABLE (field_id uuid, tenant_id uuid, field_name text, tenant_name text,
               lat double precision, lon double precision)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.tenant_id, f.name, t.name, f.lat, f.lon
  FROM field f JOIN tenant t ON t.id = f.tenant_id
  ORDER BY t.name, f.name;
$$;
GRANT EXECUTE ON FUNCTION list_fields() TO famacon_app;
