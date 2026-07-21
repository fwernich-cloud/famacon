# Famacon Control

Remote monitoring of windmills and solar/electric pumps for cattle fields. The product's
core is a **cross-diagnosis**: tank level × equipment state → it only speaks when there's
something to do (situation 3: tank dropping while the equipment is stopped). Silence is a
feature.

Live (pilot): **https://famaconcontrol.com** (internal dashboard + admin, basic-auth).

## Stack
Fastify (Node 22) · PostgreSQL 16 + **TimescaleDB** · Redis + BullMQ · Mosquitto (MQTT) ·
React-free static UI (New York Editorial / Ice-steel) · Meta WhatsApp Cloud API (direct) ·
nginx + Let's Encrypt. Everything runs under **Docker Compose** — reproducible on a clean
box (this is what makes handoff and restore-tested backups real).

## Quickstart (a fresh box)
```bash
cp .env.example .env      # fill secrets (or keep the generated .env)
docker compose up -d      # postgres, redis, mosquitto, server, nginx
# TLS (first time): scripts issue the cert via the webroot challenge
docker compose --profile sim up simulator   # optional: synthetic field, no hardware
```
Health: `curl https://famaconcontrol.com/health`

## What's built (pilot milestones)
- **M1** — ingestion (MQTT + HTTP), pluggable decoder, per-tenant **RLS** isolation,
  idempotency, TimescaleDB hypertables. *History is never deleted.*
- **M2** — cross-diagnosis engine (3 situations), N1 threshold + N2 window rules, BullMQ
  pipeline, 3-layer **watchdog** (equipment-down / zone-outage / degrading-signal), solar
  pump via weather API (available; pilot uses an electric pump's CT).
- **M3** — WhatsApp Cloud API + HSM templates + **auditable consent** (Ley 25.326,
  *no consent → no send*) + delivery-status webhook.
- **M4** — Item B read-only dashboard + Item C product-data admin (formulas/geometry are
  **data, not code** — edited in the browser, used by the engine live).
- **M5** — nginx/TLS, **restore-tested** daily backups, docs, handoff.

Requirement-by-requirement mapping: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Operations: [docs/RUNBOOK.md](docs/RUNBOOK.md). WhatsApp/Meta: [docs/WHATSAPP.md](docs/WHATSAPP.md).

## Ownership & handoff (NFR4)
Server, domain, and this repository are Famacon's. The developer is a **revocable
collaborator**. Because the whole stack is infra-as-code + a restore-tested backup, a new
developer can stand it up on a clean box and keep running within a month. Secrets live in
`.env` (git-ignored); rotate on handoff. Written IP assignment + confidentiality at close.

## Tests
```bash
cd apps/server && npm test          # 16 engine/performance unit tests
./scripts/restore-test.sh           # proves the latest backup restores into a clean DB
```
