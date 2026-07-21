# Famacon Control — Architecture & Requirement Traceability

**Purpose of this doc:** every architectural decision below traces back to a line in the
pliego / requirements. Nothing here is decoration; each choice answers a specific,
non-negotiable requirement so the pilot is *acotado* (bounded) but sound toward 1,000+ fields.

> Product in one line: **cross-diagnose tank level × equipment state**, and stay *silent*
> unless the tank is dropping while the equipment that fills it is stopped. Silence is a feature.

---

## 1. System topology

```
   Field gateway (4G, every ~3h)                Weather API (Open-Meteo)
        │  MQTT / Semtech-UDP  │  HTTP                     │ irradiation by lat/lon
        ▼                      ▼                           ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  INGESTION (Fastify + MQTT client)                                   │
 │   • raw payload stored verbatim (audit/replay)                       │
 │   • DECODER REGISTRY  → normalized readings   (§2 decoupling)        │
 │   • idempotency guard (uuid unique index)     (§6.1)                 │
 └───────────────┬─────────────────────────────────────────────────────┘
                 ▼   readings (tagged tenant/field/sensor/ts)
 ┌─────────────────────────────────────────────────────────────────────┐
 │  PostgreSQL 16 + TimescaleDB   (hypertables, RLS, continuous aggs)   │
 │   history never deleted · time-series-ready · per-tenant RLS         │
 └───────────────┬─────────────────────────────────────────────────────┘
                 ▼  enqueue evaluation job (BullMQ / Redis)
 ┌─────────────────────────────────────────────────────────────────────┐
 │  ENGINE            WATCHDOG            SOLAR                          │
 │  cross-diagnosis   heartbeat/absence   irradiation→expected pumping  │
 │  N1 threshold      3 cases:            cross w/ tank (no current      │
 │  N2 time-window     equip-down /        sensor on solar pump)        │
 │                     zone-outage /                                    │
 │                     degrading-signal                                 │
 └───────────────┬─────────────────────────────────────────────────────┘
                 ▼  alert decision (+ cooldown/dedup)
 ┌─────────────────────────────────────────────────────────────────────┐
 │  WHATSAPP (Meta Cloud API direct)                                    │
 │   HSM templates · per-recipient consent (auditable) · delivery log   │
 │   NO CONSENT → NO SEND                                                │
 └─────────────────────────────────────────────────────────────────────┘

 ┌──────────────── React/Vite (New York Editorial) ────────────────────┐
 │  Item B: internal read-only dashboard  ·  Item C: product-data admin │
 └─────────────────────────────────────────────────────────────────────┘
```

Everything runs under **Docker Compose** so the whole system is reproducible on a clean
box — this is what makes NFR4 ("developer disappears → another continues in a month") and
NFR2 ("restore-tested backups on a clean server") literally true, not aspirational.

---

## 2. Requirement traceability matrix

| # | Requirement (pliego) | Where it lives | Milestone |
|---|---|---|---|
| §6.1 | Ingest MQTT **and** HTTP, tagged, idempotent | `ingestion/`, unique index on `(gateway, msg_uuid)` | M1 |
| §6.2 / §2 | Decoupled, pluggable decoder | `decoders/registry.js` + versioned decoder modules | M1 |
| §3.2 / NFR1 | Per-producer isolation from day 1 | Postgres **RLS** + `tenant_id` on every row | M1 |
| §4b.2 / NFR3 | Time-series-ready storage | TimescaleDB hypertable `readings` + continuous aggregates | M1 |
| §3.3 / NFR2 | History never deleted + tested backups | no deletes; nightly `pg_dump` + **restore test** job | M1/M5 |
| §2 (three situations) | Cross-diagnosis tank × equipment | `engine/crossDiagnosis.js` | M2 |
| §6.3 N1 | Threshold alerts | `engine/rules/threshold.js` | M2 |
| §6.3 N2 | Time-window trend alerts | `engine/rules/window.js` | M2 |
| §6.3 N3 | Historical pattern (wear/herd) | **DB ready only** — not built (Phase 2) | — |
| §6.4 | Absence-of-data watchdog, 3 cases | `watchdog/` | M2 |
| §6.7 | Solar pump via weather API | `solar/` (Open-Meteo) | M2 |
| §6.5 / NFR5 | WhatsApp Cloud API + HSM + consent | `whatsapp/` + `consent` table | M3 |
| §6.9 / Item B | Read-only internal dashboard | `apps/web` (dashboard) | M4 |
| §6.6 / Item C | Product-data admin (data not code) | `apps/web` (admin) + `product_*` tables | M4 |
| §6.8 | Windmill performance foundation | formula + `readings`, computed but wear=Phase 2 | M2/M4 |
| NFR4 | Famacon owns infra; dev revocable | Docker Compose repro + GitHub/DO in Famacon name | M5 |

---

## 3. Data model (per-tenant, time-series)

Core tables (see `infra/postgres/init/` and `apps/server/src/db/`):

- **`tenant`** — one producer's isolated space (RLS anchor).
- **`field`** — a physical field, belongs to a tenant, has `lat`/`lon` (for the weather API).
- **`gateway`** — the 4G antenna of a field; heartbeat + signal baseline live here.
- **`sensor`** — a node on a field: `kind` ∈ {tank_level, windmill_strokes, pump_current,
  battery, temperature}, `expected_period_s` (heartbeat window), `equipment_id`.
- **`equipment`** — a windmill or a (solar/other) pump; ties sensors to the thing that fills the tank.
- **`raw_message`** — verbatim inbound payload + `msg_uuid` (idempotency + replay/audit).
- **`reading`** — **hypertable**, the normalized time-series: `(ts, tenant_id, field_id,
  sensor_id, kind, value, battery, meta)`. Never deleted.
- **product data (Item C):** `product_windmill` (cylinder Ø, rod stroke, constants),
  `product_pump_table`, `tank_geometry` — Famacon's IP, **in the DB, editable, never in code**.
- **alerting:** `alert`, `alert_state` (cooldown/open-incident), `consent`, `wa_message`
  (delivery status), `recipient`.

**Isolation:** every tenant-scoped table carries `tenant_id` and has an RLS policy
`USING (tenant_id = current_setting('app.tenant_id'))`. The app sets `app.tenant_id` per
request/job. Cross-tenant reads are impossible even with a query bug. Aggregates run
**per field**, never across owners.

---

## 4. Decoder decoupling (the explicit selection criterion)

The wire format is isolated behind one seam. A decoder is a pure function:

```
decode(rawPayload, ctx) -> { msgUuid, gatewayRef, readings: [{ sensorRef, kind, value, battery, ts }] }
```

Decoders are registered by `hardware_profile` (supplier + version). Ingestion picks the
decoder from the gateway's declared profile. **Switching supplier = add a module + a row,
no changes to storage, engine, watchdog, or alerts.** Ships with `generic-json@1` and an
example pulse decoder.

## 5. Alert levels & silence contract

- **N1 threshold** and **N2 window** run in the pilot.
- The **cross-diagnosis** gate decides silence vs. alert (the 3 situations). An N1/N2
  breach is *necessary but not sufficient*: tank dropping while equipment **runs** = silence.
- **N3** (month-over-month wear, herd health) is **not built** — but the schema + continuous
  aggregates make it a pure add-on later (history from day 1).
- **Cooldown / open-incident state** prevents alarm spam (a value that stays bad is one
  incident, not one alert per reading).

## 6. Watchdog — three cases (the "most important alert")

1. **Equipment down** — sensor misses N heartbeats **but** its gateway still transmits → alert.
2. **Zone outage** — the whole gateway goes silent → *coverage loss, not equipment failure*
   → suppress equipment alerts, raise a distinct low-severity notice.
3. **Degrading signal** — gateway-reported RSSI/battery trends down before silence → a
   preventive, distinct notice. Per-site signal baseline avoids false alarms in poor-coverage zones.

## 7. Non-functional posture

- **Backups (NFR2):** nightly `pg_dump` → off-box object storage, 30-day retention, plus a
  scheduled **restore-into-a-clean-container** test that fails loudly if it can't reload.
- **Scale (NFR6):** one small VPS; hypertable + continuous aggregates keep trend queries flat.
- **Ownership (NFR4):** all infra as code; secrets in `.env` (never committed); dev is a
  revocable collaborator on Famacon's accounts.
- **Legal (NFR5, Ley 25.326):** consent captured with timestamp + IP in the WhatsApp opt-in;
  supports deletion/rectification on request.

---

## 8. Implementation decisions (log)

- **RLS over columnstore compression on `reading`.** This TimescaleDB build refuses to
  enable compression on a table that has Row-Level Security (`columnstore cannot be used on
  table with row security`). Per-tenant isolation (NFR1) is a hard *developer-selection
  filter*; storage is explicitly "lo más barato que hay" (§3.3). So RLS wins and compression
  is not applied to `reading`. Time-series speed still comes from hypertable partitioning +
  the `reading_daily` continuous aggregate + purpose-built indexes. History is preserved by
  simply having **no retention policy** (nothing is ever deleted).
- **Routing vs. isolation.** The one place we must cross the tenant boundary — mapping an
  inbound gateway id to its tenant *before* a tenant context exists — is confined to a single
  `SECURITY DEFINER` function (`resolve_gateway`). Everything else runs under `app.tenant_id`.
- **Idempotency at two layers.** Primary guard: `raw_message (gateway_ext, msg_uuid)` unique —
  a 4G resend is dropped whole. Secondary: `reading (sensor_id, ts)` unique — a sensor cannot
  hold two values at the same instant. Both verified.
</content>
</invoke>
