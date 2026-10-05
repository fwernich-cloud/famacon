-- Hito 4 — app settings (account-level key/value), so the ACTIVE WhatsApp template
-- name lives in config, not in code. Switching v1→v2 (after a text change is approved as
-- a new template) is then a one-row UPDATE, never a deploy. Never put secrets here.
CREATE TABLE IF NOT EXISTS app_setting (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_setting (key, value) VALUES
  ('wa_template_urgent', 'famacon_estado_urgente'),
  ('wa_template_aviso',  'famacon_estado_aviso')
ON CONFLICT (key) DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON app_setting TO famacon_app;
