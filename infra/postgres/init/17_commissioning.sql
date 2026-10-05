-- Hito 4 #9 — explicit sensor commissioning.
-- A sensor enters service by an EXPLICIT act (someone declaring "this one is installed
-- in such-and-such molino"), never by inferring it from the first packet. A sensor whose
-- commissioned_at IS NULL generates NO alerts even while transmitting — this is what stops
-- the false "equipo caído" when a distributor carries spare sensors that auto-join the
-- gateway. NULL = "sin comisionar"; a timestamp = in service since then.
ALTER TABLE sensor ADD COLUMN IF NOT EXISTS commissioned_at timestamptz;
