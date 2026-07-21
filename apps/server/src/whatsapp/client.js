import { templateForSeverity, renderText } from './templates.js';

// ── WhatsApp Business Cloud API client (direct, no BSP) ─────────────────────
// Sends approved HSM templates via Meta's Graph API. When no token is configured
// (development / before Meta verification), runs in DRY-RUN: it logs the exact
// payload and returns a synthetic id, so the whole pipeline is testable on the
// test number path. Flips to live the moment WA_ACCESS_TOKEN + WA_PHONE_NUMBER_ID
// are set in .env — no code change.

const GRAPH = 'https://graph.facebook.com/v21.0';

function cfg() {
  return {
    token: process.env.WA_ACCESS_TOKEN,
    phoneId: process.env.WA_PHONE_NUMBER_ID,
  };
}

export function isDryRun() {
  const { token, phoneId } = cfg();
  return !token || !phoneId;
}

/**
 * Send an alert as an HSM template to one recipient.
 * @returns {Promise<{ok:boolean, id?:string, dryRun:boolean, error?:string, template:string, text:string}>}
 */
export async function sendAlertTemplate(toE164, alert, { fetchImpl = fetch, log } = {}) {
  const tpl = templateForSeverity(alert.severity);
  const params = tpl.params(alert);
  const text = renderText(alert);
  const to = toE164.replace(/[^\d]/g, ''); // Cloud API wants digits only

  if (isDryRun()) {
    log?.info({ to, template: tpl.name, params }, 'whatsapp DRY-RUN send');
    return { ok: true, id: `dryrun-${Date.now()}-${Math.round(params.length)}`, dryRun: true, template: tpl.name, text };
  }

  const { token, phoneId } = cfg();
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: tpl.language },
      components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }],
    },
  };
  try {
    const res = await fetchImpl(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.error?.message || `HTTP ${res.status}`;
      log?.error({ to, error }, 'whatsapp send failed');
      return { ok: false, dryRun: false, error, template: tpl.name, text };
    }
    return { ok: true, id: data?.messages?.[0]?.id, dryRun: false, template: tpl.name, text };
  } catch (err) {
    return { ok: false, dryRun: false, error: err.message, template: tpl.name, text };
  }
}
