-- Delivery-status webhook updates a wa_message by Meta's message id, but arrives
-- without a tenant context. This SECURITY DEFINER function performs that single
-- narrow status update (system task), like resolve_gateway/wd_gateways.
CREATE OR REPLACE FUNCTION wa_update_status(p_wa_id text, p_status text, p_error text DEFAULT NULL)
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH upd AS (
    UPDATE wa_message SET status = p_status, status_at = now(),
           error = COALESCE(p_error, error)
    WHERE wa_message_id = p_wa_id RETURNING 1)
  SELECT count(*)::int FROM upd;
$$;
GRANT EXECUTE ON FUNCTION wa_update_status(text, text, text) TO famacon_app;
