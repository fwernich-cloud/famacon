# Famacon Control — Operator Runbook

Everything an operator (or a new developer) needs to run the pilot. Assumes Docker Compose
on the VPS, repo at `/home/famacon-control`.

## Daily life
| Task | Command |
|---|---|
| Status of all services | `docker compose ps` |
| Server logs (follow) | `docker compose logs -f server` |
| Restart the app | `docker compose restart server` |
| Health | `curl https://famaconcontrol.com/health` |
| Rebuild after code change | `docker compose build server && docker compose up -d server` |

## Backups & restore (NFR2)
- **Automatic**: `scripts/backup.sh` runs daily 03:30 (cron) → `infra/backup/dumps/`, 30-day
  retention. Set `BACKUP_REMOTE` (rclone remote) in `.env` for off-box copies.
- **Restore test**: `scripts/restore-test.sh` runs weekly (Sun 04:00) and can be run anytime;
  it restores the latest dump into a throwaway container and checks row counts. Exit 0 = good.
- **Real restore** into the live DB (disaster): stop server, drop/recreate the DB, then
  `timescaledb_pre_restore()` → `pg_restore` → `timescaledb_post_restore()` (see restore-test.sh
  for the exact protocol), then start server.

## TLS
- Auto-renews twice daily (`scripts/renew-tls.sh`, cron). Manual: run that script.

## Add / manage alert recipients (up to 5)
1. Insert the recipient (name + phone in E.164) — via SQL or a future admin screen.
2. Record consent (required — *no consent, no send*):
   ```
   curl -u $DASHBOARD_USER:$DASHBOARD_PASSWORD -X POST https://famaconcontrol.com/admin/consent \
     -H 'Content-Type: application/json' -d '{"tenantId":"<uuid>","recipientId":"<uuid>"}'
   ```
   Revoke with `-X DELETE` (same body) — covers Ley 25.326 rectification/deletion.

## Product data (Item C) — formulas & geometry
Edit in the browser at `/admin.html` (Famacon login): cylinder internal diameters (incl. the
pending 4½"), per-windmill cylinder + **η**, tank geometry. The engine uses new values
immediately. η stays empty until calibrated with a new cuero → the dashboard shows *trend*,
not an absolute rendimiento, on purpose.

## Swap hardware supplier (decoder)
Add a module under `apps/server/src/decoders/`, register it in `registry.js`, set the
gateway's `hardware_profile` to its key. Nothing else changes (storage/engine/alerts untouched).

## Watchdog cadence
Per-sensor `expected_period_s` sets the heartbeat window. Pilot demo values are short (60s /
1800s) so absence is visible; production windows are the real cadence (tank ~1800s, strokes
~10800s). Edit on the `sensor` / `gateway` rows.

## WhatsApp go-live
Fill `WA_*` in `.env` and restart the server — it flips from dry-run to live automatically.
Full steps + HSM templates to approve: `docs/WHATSAPP.md`.

## Secrets
All in `.env` (git-ignored). Rotate DB/MQTT/dashboard passwords and the WhatsApp token on
handoff; `docker compose up -d` to apply.
