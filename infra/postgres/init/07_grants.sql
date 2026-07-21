-- Least-privilege grants for the application role. It gets DML on the working
-- tables but is subject to RLS on every one of them. No DDL, no superuser.
GRANT USAGE ON SCHEMA public TO famacon_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO famacon_app;
GRANT SELECT ON reading_daily TO famacon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO famacon_app;

-- Routing + tenant-context helpers.
GRANT EXECUTE ON FUNCTION resolve_gateway(text) TO famacon_app;
GRANT EXECUTE ON FUNCTION set_tenant(uuid) TO famacon_app;

-- Future tables/sequences created by the admin default to these grants too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO famacon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO famacon_app;
