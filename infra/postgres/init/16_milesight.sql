-- ═══════════════════════════════════════════════════════════════════════════
-- Famacon Control — Milesight / ChirpStack integration (§13)
-- Real pilot hardware. The ultrasonic tank sensor (EM500-UDL) reports DISTANCE
-- to the water surface; turning that into a level % needs the sensor's mount
-- height above the tank rim, alongside the tank's useful height. That mount
-- height is product/geometry data (Item C), so it lives in the DB, not in code.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tank_geometry
  ADD COLUMN IF NOT EXISTS sensor_offset_mm double precision;

COMMENT ON COLUMN tank_geometry.sensor_offset_mm IS
  'Altura del sensor ultrasónico sobre el borde del tanque (mm). Distancia→nivel: nivel% = (útil − (distancia − offset)) / útil × 100.';

-- ── Prueba cabeza a cabeza UDL vs SWL (§13) ────────────────────────────────
-- En el piloto un mismo tanque lleva DOS sensores de nivel (ultrasónico EM500-UDL
-- y sumergible EM500-SWL) para comparar cuál instala/lee mejor. El motor necesita
-- UN solo nivel por tanque, si no el diagnóstico/rendimiento se contamina. Este
-- flag marca cuál usa el motor; el otro se sigue ingiriendo y guardando (el tablero
-- los compara), pero el motor lo ignora. Por defecto TRUE (un sensor = primario).
ALTER TABLE sensor
  ADD COLUMN IF NOT EXISTS for_engine boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN sensor.for_engine IS
  'El motor consume este sensor. FALSE = sensor de comparación (p. ej. el SWL en el tanque de prueba): se guarda pero el motor no lo usa. Cambiar cuál es primario es actualizar esta fila.';
