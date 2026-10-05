import { withTenant } from '../db/withTenant.js';
import { fieldMeta } from '../db/queries.js';
import { sendAlertTemplate, isDryRun } from './client.js';
import { config } from '../config/index.js';

const MAX_RECIPIENTS = 5; // §6.5: up to 5 recipients per alert
const RANK = { urgent: 3, warning: 2, info: 1 };

// Dedup + cooldown (Hito 4 #3). An open alert is NOT re-notified until it changes state
// (escalates) or its cooldown expires. Urgent repeats every 6 h while open; an aviso
// (warning/info) notifies ONCE, then only on a state change. The field/day cap is a
// safety net for AVISOS only — an urgent is never suppressed by it. Every suppression is
// logged with its alert, recipient and template (never a bare "—").
const COOLDOWN_MIN = { urgent: 360 };          // 6 h; warning/info → once (null)
function cooldownMin(sev) { return COOLDOWN_MIN[sev] ?? null; }

/**
 * Sweep a field's OPEN alerts and notify the ones that are due, honoring the spec's
 * anti-saturation (§7): one message per subject (the most-severe alert wins), at most
 * one per node every `notify_node_min` minutes, at most `notify_field_daily_max`
 * DISTINCT subjects per field per day (prioritized by severity). Retries are driven
 * by each rule's cadence. The consent gate is absolute — no consent → no send, but a
 * skipped row is logged for the audit trail.
 */
export async function dispatchAlerts({ tenantId, fieldId, log }) {
  if (!fieldId) return { sent: 0, skipped: 0, failed: 0, suppressed: 0 };
  // Notification-disabled tenants (e.g. Demo) never reach WhatsApp and never log a skip.
  if (config.notify.disabledTenants.includes(tenantId)) {
    return { sent: 0, skipped: 0, failed: 0, suppressed: 0 };
  }
  return withTenant(tenantId, async (client) => {
    const field = await fieldMeta(client, fieldId);
    const policy = field?.alert_policy || {};
    const dailyMax = policy.notify_field_daily_max ?? 6;
    const now = Date.now();

    // Open alerts for the field + when each was last notified.
    const { rows: open } = await client.query(
      `SELECT a.id, a.subject, a.type, a.severity, a.diagnosis, a.detail,
              (SELECT max(w.status_at) FROM wa_message w
                 WHERE w.alert_id=a.id
                   AND w.status IN ('sent','sent_dryrun','delivered','read','skipped_no_consent')) AS last_notify
         FROM alert a WHERE a.field_id=$1 AND a.status='open'`, [fieldId]);
    if (!open.length) return { sent: 0, skipped: 0, failed: 0, suppressed: 0 };

    // Distinct AVISO subjects already notified today — the field/day cap counts aviso
    // breadth only; urgents are exempt from the cap (see the send loop).
    const { rows: todayRows } = await client.query(
      `SELECT DISTINCT a.subject FROM wa_message w JOIN alert a ON a.id=w.alert_id
        WHERE w.tenant_id=$1 AND a.field_id=$2 AND a.severity <> 'urgent'
          AND w.status IN ('sent','sent_dryrun','delivered','read')
          AND w.status_at >= date_trunc('day', now())`, [tenantId, fieldId]);
    const avisosNotifiedToday = new Set(todayRows.map((r) => r.subject));

    // Last severity actually sent per subject — so an escalation (e.g. warning→urgent)
    // always goes out even inside the node cadence window (§7 "priorizando por severidad").
    const { rows: lastSevRows } = await client.query(
      `SELECT DISTINCT ON (a.subject) a.subject, a.severity AS last_sev
         FROM wa_message w JOIN alert a ON a.id=w.alert_id
        WHERE w.tenant_id=$1 AND a.field_id=$2
          AND w.status IN ('sent','sent_dryrun','delivered','read')
        ORDER BY a.subject, w.status_at DESC`, [tenantId, fieldId]);
    const lastSev = new Map(lastSevRows.map((r) => [r.subject, r.last_sev]));

    // Group open alerts by subject; one message per subject, most-severe wins.
    const bySubject = new Map();
    for (const a of open) {
      const g = bySubject.get(a.subject) || { alerts: [], lastNotify: null };
      g.alerts.push(a);
      if (a.last_notify) {
        const t = new Date(a.last_notify).getTime();
        g.lastNotify = g.lastNotify == null ? t : Math.max(g.lastNotify, t);
      }
      bySubject.set(a.subject, g);
    }

    // Which subjects are DUE (never notified, or past their retry cadence + node floor).
    const dueList = [];
    for (const [subject, g] of bySubject) {
      g.alerts.sort((x, y) => (RANK[y.severity] || 0) - (RANK[x.severity] || 0));
      const top = g.alerts[0];
      const escalated = g.lastNotify != null &&
        (RANK[top.severity] || 0) > (RANK[lastSev.get(subject)] || 0);
      let due;
      if (g.lastNotify == null) due = true;               // never notified
      else if (escalated) due = true;                     // state change (more severe) → always
      else {
        const cd = cooldownMin(top.severity);             // urgent: 6 h; aviso: once (null)
        due = cd != null && (now - g.lastNotify) >= cd * 60_000;
      }
      if (due) dueList.push({ subject, top, alerts: g.alerts, isNew: !avisosNotifiedToday.has(subject) });
    }
    // Priority by severity; the field/day cap applies to NEW subjects only.
    dueList.sort((a, b) => (RANK[b.top.severity] || 0) - (RANK[a.top.severity] || 0));

    // Recipients + current consent (≤5), so skips stay auditable.
    const { rows: recips } = await client.query(
      `SELECT r.id, r.name, r.phone_e164,
              EXISTS (SELECT 1 FROM consent c WHERE c.recipient_id=r.id AND c.channel='whatsapp'
                        AND c.granted=true AND c.revoked_at IS NULL) AS consented
         FROM recipient r WHERE r.tenant_id=$1 ORDER BY r.created_at LIMIT $2`,
      [tenantId, MAX_RECIPIENTS]);

    // Active template name per severity — config-driven (app_setting), so a v1→v2 switch
    // is a one-row change, not a deploy. Falls back to the approved utility names.
    const { rows: settingRows } = await client.query(
      `SELECT key, value FROM app_setting WHERE key IN ('wa_template_urgent','wa_template_aviso')`);
    const setting = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
    const nameFor = (sev) => sev === 'urgent'
      ? (setting.wa_template_urgent || 'famacon_estado_urgente')
      : (setting.wa_template_aviso || 'famacon_estado_aviso');

    // Friendly name per subject (the equipment/molino/tank name, never the bare DevEUI).
    const { rows: nameRows } = await client.query(
      `SELECT key, name FROM (
         SELECT e.fills_tank AS key, e.name AS name FROM equipment e
           WHERE e.field_id=$1 AND e.fills_tank IS NOT NULL
         UNION
         SELECT s.ext_ref AS key, coalesce(e.name, s.tank_ref) AS name
           FROM sensor s LEFT JOIN equipment e ON e.id=s.equipment_id WHERE s.field_id=$1
       ) m WHERE key IS NOT NULL AND name IS NOT NULL`, [fieldId]);
    const subjectName = new Map(nameRows.map((r) => [r.key, r.name]));

    let sent = 0, skipped = 0, failed = 0, suppressed = 0;
    let avisoBudget = Math.max(0, dailyMax - avisosNotifiedToday.size);
    for (const d of dueList) {
      const isUrgent = d.top.severity === 'urgent';
      const tplName = nameFor(d.top.severity);
      // Field/day cap applies to AVISOS only; an urgent is never suppressed by it. A
      // suppression is logged per recipient, with its alert + template (never "—").
      if (!isUrgent && d.isNew) {
        if (avisoBudget <= 0) {
          const note = `Tope de ${dailyMax} avisos por campo por día alcanzado (solo avisos; las urgentes nunca se suprimen).`;
          for (const r of recips) {
            await logMessage(client, tenantId, d.top.id, r.id, tplName, null, 'suppressed_field_cap', note);
          }
          suppressed++;
          continue;
        }
        avisoBudget--;
      }
      // Build the 5 fixed template fields: equipo (field — friendly name), estado (fixed
      // set), nivel (% or "sin calibrar"/"s/d"), detectado (local date+time), acción (fixed set).
      const ctx = {
        severity: d.top.severity,
        equipo: `${field?.name || 'Campo'} — ${subjectName.get(d.top.subject) || d.top.subject}`,
        estado: estadoFor(d.top),
        nivel: levelLabel(d.top.detail),
        detectado: localStamp(now),
        accion: actionFor(d.top).replace(/\.\s*$/, ''),   // template supplies the period
      };
      for (const r of recips) {
        if (!r.consented) {
          await logMessage(client, tenantId, d.top.id, r.id, tplName, null, 'skipped_no_consent',
            'Sin consentimiento en archivo — no se envía (Ley 25.326).');
          skipped++;
          continue;
        }
        const res = await sendAlertTemplate(r.phone_e164, ctx, { log, templateName: tplName });
        if (res.ok) {
          await logMessage(client, tenantId, d.top.id, r.id, res.template, res.id,
            res.dryRun ? 'sent_dryrun' : 'sent', null);
          sent++;
        } else {
          await logMessage(client, tenantId, d.top.id, r.id, res.template, null, 'failed', res.error);
          failed++;
        }
      }
      if (!isUrgent) avisosNotifiedToday.add(d.subject);
    }

    // ── Auto-retry failed deliveries (Hito 4 #1) ──────────────────────────────
    // A failed send is retried up to RETRY_MAX more times, RETRY_SPACING_MIN apart, while the
    // alert is still open and the recipient still consented. Once the attempts are exhausted the
    // last failure becomes 'failed_final' — a terminal, dashboard-visible state, so an urgent
    // that could never be delivered is never silent. Retries reuse the 5-field template context.
    const RETRY_MAX = 3, RETRY_SPACING_MIN = 10;
    const { rows: latest } = await client.query(
      `SELECT DISTINCT ON (w.alert_id, w.recipient_id)
              w.alert_id, w.recipient_id, w.status, w.status_at,
              a.subject, a.type, a.severity, a.detail, r.phone_e164,
              (SELECT count(*) FROM wa_message w2
                 WHERE w2.alert_id=w.alert_id AND w2.recipient_id=w.recipient_id AND w2.status='failed') AS fail_count,
              EXISTS (SELECT 1 FROM consent c WHERE c.recipient_id=r.id AND c.channel='whatsapp'
                        AND c.granted=true AND c.revoked_at IS NULL) AS consented
         FROM wa_message w JOIN alert a ON a.id=w.alert_id JOIN recipient r ON r.id=w.recipient_id
        WHERE w.tenant_id=$1 AND a.field_id=$2 AND a.status='open' AND w.recipient_id IS NOT NULL
        ORDER BY w.alert_id, w.recipient_id, w.status_at DESC`, [tenantId, fieldId]);
    for (const f of latest) {
      if (f.status !== 'failed') continue;                         // latest attempt must be a failure
      if (f.fail_count > RETRY_MAX) {                              // 1 initial + RETRY_MAX retries → terminal
        await client.query(`UPDATE wa_message SET status='failed_final'
             WHERE alert_id=$1 AND recipient_id=$2 AND status='failed'`, [f.alert_id, f.recipient_id]);
        continue;
      }
      if (Date.now() - new Date(f.status_at).getTime() < RETRY_SPACING_MIN * 60_000) continue; // spacing
      if (!f.consented) continue;                                  // no consent → cannot retry
      const top = { id: f.alert_id, type: f.type, severity: f.severity, subject: f.subject, detail: f.detail };
      const ctx = {
        severity: f.severity,
        equipo: `${field?.name || 'Campo'} — ${subjectName.get(f.subject) || f.subject}`,
        estado: estadoFor(top), nivel: levelLabel(f.detail),
        detectado: localStamp(Date.now()), accion: actionFor(top).replace(/\.\s*$/, ''),
      };
      const res = await sendAlertTemplate(f.phone_e164, ctx, { log, templateName: nameFor(f.severity) });
      if (res.ok) {
        await logMessage(client, tenantId, f.alert_id, f.recipient_id, res.template, res.id,
          res.dryRun ? 'sent_dryrun' : 'sent', null);
        sent++;
      } else {
        await logMessage(client, tenantId, f.alert_id, f.recipient_id, res.template, null, 'failed', res.error);
        failed++;
      }
    }

    log?.info({ tenantId, fieldId, sent, skipped, failed, suppressed, dryRun: isDryRun() }, 'whatsapp dispatch');
    return { sent, skipped, failed, suppressed };
  });
}

// {{2}} estado — a fixed, finite label per alert type (never free-composed text).
function estadoFor(alert) {
  switch (alert.type) {
    case 'R1':                 return 'Aviso informativo';
    case 'R2':                 return 'Nivel en descenso';
    case 'R3':                 return 'Nivel bajo';
    case 'R4': case 'R5':      return 'Nivel crítico';
    case 'R6':                 return 'Caída rápida de nivel';
    case 'R7':                 return 'Posible pérdida nocturna';
    case 'equipment_down':     return 'Equipo sin reportar';
    case 'zone_outage':        return 'Corte de señal de zona';
    case 'signal_degraded':    return 'Señal debilitándose';
    default:                   return 'Revisar';
  }
}

// {{3}} nivel — the tank level for a level alert, "s/d" when the alert has no level.
function levelLabel(detail) {
  const lvl = detail && typeof detail.level === 'number' ? detail.level : null;
  return lvl == null ? 's/d' : `${lvl.toFixed(1).replace('.', ',')} %`;
}

// {{4}} detectado — local (Argentina) date + time of the notification.
function localStamp(ms) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms)).replace(',', '');
  } catch { return new Date(ms).toISOString(); }
}

function actionFor(alert) {
  switch (alert.type) {
    case 'R4': case 'R5':      return 'Revisar el equipo en el campo.';
    case 'R3':                 return 'Convendría revisar el molino.';
    case 'R2':                 return 'Quedate atento al tanque.';
    case 'R1':                 return 'Aviso preventivo.';
    case 'R6':                 return 'Confirmá si moviste hacienda o si puede ser una pérdida.';
    case 'R7':                 return 'Posible pérdida nocturna: conviene ir a revisar.';
    case 'equipment_down':     return 'El sensor dejó de reportar: revisar el equipo.';
    case 'zone_outage':        return 'Corte de señal de zona (no es falla de equipo).';
    case 'signal_degraded':    return 'Señal debilitándose: posible corte próximo.';
    default:                   return 'Revisar el equipo en el campo.';
  }
}

async function logMessage(client, tenantId, alertId, recipientId, template, waId, status, error) {
  await client.query(
    `INSERT INTO wa_message (tenant_id, alert_id, recipient_id, template, wa_message_id, status, status_at, error)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)`,
    [tenantId, alertId, recipientId, template, waId, status, error]);
}
