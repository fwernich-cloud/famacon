# End-to-end test suite

End-to-end checks that drive the **real stack** (Postgres+TimescaleDB, Redis, Mosquitto,
the Fastify server) exactly as the field does: real MQTT/HTTP ingestion → decode →
conversions → engine → alerts → WhatsApp dispatch (dry-run) → DB assertions.

## Run

```bash
docker compose up -d          # stack must be running
bash test/e2e/run-all.sh      # runs every suite, prints PASS/FAIL
```

Each suite is self-contained: seeds a throwaway tenant, drives data, asserts, and cleans
up after itself. They use `docker compose exec` for psql/mosquitto and `curl` for HTTP.

## The suites

| Suite | What it proves |
|-------|----------------|
| `e2e_milesight`   | Real Milesight/ChirpStack uplinks over MQTT: cumulative counter→stroke delta, ultrasonic distance→level %, raw values kept in `meta`, best-RSSI, idempotency. |
| `e2e_regression`  | Legacy `generic-json` path unchanged (pure passthrough) + cross-diagnosis opens the URGENT situation-3 alert and resolves it. |
| `e2e_dual_level`  | Two level sensors on one tank (UDL vs SWL head-to-head): the engine uses the **primary** (`for_engine`); the comparison sensor is stored but ignored. |
| `e2e_m3_dispatch` | WhatsApp dispatch: consent gate (sent vs skipped, Ley 25.326), one message per subject (anti-saturation), most-severe wins. |
| `e2e_dashboard`   | Item B API (`/api/overview`, `/api/series`): sensor detail, UDL/SWL roles, battery/signal, auth gate (401). |
| `e2e_admin_c`     | Item C admin→engine loop: geometry + sensor offset entered via the API → a real UDL uplink converts distance→level with it (and degrades if missing). |
| `e2e_recipients`  | Recipients + auditable consent: add, 5-cap, grant/revoke with IP+timestamp, remove, auth. |
| `e2e_full_pilot`  | The whole pilot journey over MQTT: install → normal → drinking → URGENT (cross+N1+N2) → WhatsApp → watchdog → idempotency. |
| `e2e_antisat`     | Anti-saturation **across evaluations**: a tank draining over several uplinks yields ONE urgent message per tank (with escalation), not one per alert. |
| `e2e_rls`         | Per-producer isolation via Postgres RLS (as the app role): each sees only its own data; default-deny; cross-tenant read+write blocked. |

## Related
- `scripts/go-live-smoketest.sh` — activation-day check: drives a real alert to `SMOKE_TO`
  and reports dry-run vs live + delivery status.
- Unit tests (pure engine/decoder math): `cd apps/server && npm test`.
- A browser UI E2E (Playwright, real operator flow) lives in the dev notes; it needs
  `playwright-core` + a Chromium, so it's not wired into this stack-only suite.
