-- ── Gateway routing (runs BEFORE a tenant context exists) ──────────────────
-- Ingestion must resolve which tenant/field a gateway belongs to *before* it can
-- set the tenant context. This SECURITY DEFINER function (owned by the superuser
-- init role) performs that one narrow lookup, returning only routing info — it is
-- the single sanctioned way to cross the tenant boundary, and only for routing.
CREATE OR REPLACE FUNCTION resolve_gateway(p_ext_ref text)
RETURNS TABLE (gateway_id uuid, tenant_id uuid, field_id uuid, hardware_profile text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, field_id, hardware_profile
  FROM gateway WHERE ext_ref = p_ext_ref;
$$;

-- Set the per-connection tenant context (used by RLS). Called by the app with a
-- resolved tenant id right after routing, so every subsequent query is scoped.
CREATE OR REPLACE FUNCTION set_tenant(p_tenant uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.tenant_id', p_tenant::text, false);
$$;
