-- Inbound leads from the public contact form (not tenant data).
CREATE TABLE IF NOT EXISTS contact_message (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  email      text,
  phone      text,
  audience   text,
  message    text NOT NULL,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT, SELECT ON contact_message TO famacon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO famacon_app;
