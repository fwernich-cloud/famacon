# WhatsApp Business Cloud API — setup & templates (M3)

Direct Meta Cloud API (no BSP). Runs in **dry-run** until credentials are set — the
whole pipeline (consent gate, dispatch, delivery log) works on the test-number path
and flips live with **zero code change** once `.env` has the tokens.

## 1. Go-live env (fill in `.env`, then `docker compose up -d server`)
```
WA_PHONE_NUMBER_ID=      # test number first, then Famacon's verified number
WA_ACCESS_TOKEN=         # permanent token (System User) once verified
WA_BUSINESS_ACCOUNT_ID=
WA_APP_SECRET=           # enables webhook signature verification
WA_VERIFY_TOKEN=         # already generated; used in the webhook handshake
```
`isDryRun()` is true while `WA_ACCESS_TOKEN` or `WA_PHONE_NUMBER_ID` is empty.

## 2. Webhook (already live)
- Callback URL: `https://famaconcontrol.com/webhooks/whatsapp`
- Verify token: value of `WA_VERIFY_TOKEN`
- Subscribe to **messages** (delivery statuses + inbound). Statuses update `wa_message`.

## 3. HSM templates to submit for approval (Meta → WhatsApp Manager)
Company-initiated alerts outside the 24h window require these approved templates.
Category: **UTILITY**, language **es**.

**`famacon_alerta_urgente`**
```
🚨 FAMACON CONTROL — {{1}}
{{2}}
Qué revisar: {{3}}
```
**`famacon_alerta_aviso`**
```
FAMACON CONTROL — {{1}}
{{2}}
Qué revisar: {{3}}
```
Params: {{1}} campo · {{2}} diagnóstico · {{3}} qué revisar. Mapping in
`src/whatsapp/templates.js`.

**`famacon_nuevo_lead`** (aviso de consulta web → Famacon; category UTILITY, es)
```
Nueva consulta en la web — {{1}}
Tel: {{2}}
{{3}}
```
Params: {{1}} nombre · {{2}} teléfono · {{3}} mensaje.

### Example values (Meta requires one per placeholder at submission)
Paste these as the sample values when creating each template, or the review bounces:
| Template | {{1}} | {{2}} | {{3}} |
|----------|-------|-------|-------|
| `famacon_alerta_urgente` | Campo La Esperanza | Tanque TQ-01 bajando y sin reposición (molino y bomba parados). | Ir al equipo: no está reponiendo agua. |
| `famacon_alerta_aviso` | Campo La Esperanza | Nivel del tanque TQ-02 bajo: 18%. | Revisar el equipo que llena el tanque. |
| `famacon_nuevo_lead` | Juan Pérez | +54 9 11 5555 5555 | Quiero información para monitorear 3 molinos en Verónica. |

Notes: no URLs/marketing in UTILITY bodies (keep them operational). Language `es`
(or `es_AR`; must match the `language.code` the client sends — currently `es`).

## 4. Compliance (§6.5 / NFR5 Ley 25.326) — enforced
- **No consent on file → no send.** Skips are logged in `wa_message`
  (`skipped_no_consent`) for the audit trail.
- Consent stored with **timestamp + IP** (`consent` table); revocable
  (`DELETE /admin/consent`) → covers rectification/deletion.
- Up to **5 recipients** per alert; one message per subject (anti-saturation).
- Delivery status (`sent/delivered/read/failed`) stored per message.

## 5. Verification timing
Meta business verification takes days — start early (client task). Develop on the
**test number** meanwhile; nothing here blocks on it.
