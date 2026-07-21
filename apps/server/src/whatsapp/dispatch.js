import { withTenant } from '../db/withTenant.js';
import { fieldMeta } from '../db/queries.js';
import { sendAlertTemplate, isDryRun } from './client.js';

const MAX_RECIPIENTS = 5; // §6.5: up to 5 recipients per alert

/**
 * Dispatch newly-opened alerts to consented recipients and log every attempt.
 * The consent gate is absolute: no consent on file → no send (but we DO log a
 * skipped row for the audit trail). Called by the engine and the watchdog.
 */
export async function dispatchAlerts({ tenantId, fieldId, opened, log }) {
  if (!opened?.length) return { sent: 0, skipped: 0, failed: 0 };
  return withTenant(tenantId, async (client) => {
    const field = fieldId ? await fieldMeta(client, fieldId) : null;

    // All recipients + their current consent status (≤5), so skips are auditable.
    const { rows: recips } = await client.query(
      `SELECT r.id, r.name, r.phone_e164,
              EXISTS (SELECT 1 FROM consent c WHERE c.recipient_id=r.id AND c.channel='whatsapp'
                        AND c.granted=true AND c.revoked_at IS NULL) AS consented
         FROM recipient r WHERE r.tenant_id=$1 ORDER BY r.created_at LIMIT $2`,
      [tenantId, MAX_RECIPIENTS]);

    // Consolidate: ONE message per subject (tank/equipment), using the most-severe
    // alert — so two alerts on the same tank (e.g. stoppage + suspected leak) don't
    // become two WhatsApps. Anti-saturation is part of the product.
    const rank = { urgent: 3, warning: 2, info: 1 };
    const groups = new Map();
    for (const a of opened) {
      const k = a.subject || a.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(a);
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const [, alerts] of groups) {
      alerts.sort((x, y) => (rank[y.severity] || 0) - (rank[x.severity] || 0));
      const alert = alerts[0];
      const diagnosis = [...new Set(alerts.map((x) => x.diagnosis))].join(' · ');
      const ctx = {
        field: field?.name || 'Campo',
        severity: alert.severity,
        diagnosis,
        action: actionFor(alert),
      };
      for (const r of recips) {
        if (!r.consented) {
          await logMessage(client, tenantId, alert.id, r.id, null, null, 'skipped_no_consent',
            'Sin consentimiento en archivo — no se envía (Ley 25.326).');
          skipped++;
          continue;
        }
        const res = await sendAlertTemplate(r.phone_e164, ctx, { log });
        if (res.ok) {
          await logMessage(client, tenantId, alert.id, r.id, res.template, res.id,
            res.dryRun ? 'sent_dryrun' : 'sent', null);
          sent++;
        } else {
          await logMessage(client, tenantId, alert.id, r.id, res.template, null, 'failed', res.error);
          failed++;
        }
      }
    }
    log?.info({ tenantId, fieldId, sent, skipped, failed, dryRun: isDryRun() }, 'whatsapp dispatch');
    return { sent, skipped, failed };
  });
}

function actionFor(alert) {
  switch (alert.type) {
    case 'cross_situation_3': return 'Ir al equipo: no está reponiendo agua.';
    case 'leak_suspected':    return 'Posible fuga: revisar tanque y cañería.';
    case 'tank_low': case 'tank_critical': return 'Nivel bajo: verificar el equipo que llena el tanque.';
    case 'equipment_down':    return 'El sensor dejó de reportar: revisar el equipo.';
    case 'zone_outage':       return 'Corte de señal de zona (no es falla de equipo).';
    case 'signal_degraded':   return 'Señal debilitándose: posible corte próximo.';
    default: return 'Revisar el equipo en el campo.';
  }
}

async function logMessage(client, tenantId, alertId, recipientId, template, waId, status, error) {
  await client.query(
    `INSERT INTO wa_message (tenant_id, alert_id, recipient_id, template, wa_message_id, status, status_at, error)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)`,
    [tenantId, alertId, recipientId, template, waId, status, error]);
}
