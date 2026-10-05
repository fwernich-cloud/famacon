// ── HSM template registry (§6.5) ───────────────────────────────────────────
// Company-initiated alerts outside the 24h window REQUIRE Meta-approved HSM
// templates — free text fails out of session. Each entry maps to a template that
// must be submitted & approved in Meta (see docs/WHATSAPP.md). params() builds the
// ordered body variables. We keep a plain-text rendering too, for the log and for
// the (rare) in-session case.

// The NAME is resolved from config (app_setting) at dispatch time, so a text change ships
// as a new template + a one-row switch, never a deploy. Here we only map severity →
// language + the ordered body params of the approved 5-variable layout:
//   "Alerta en {{1}}. Estado del tanque: {{2}}. Nivel medido: {{3}}. Detectado el {{4}}.
//    Acción recomendada: {{5}}. Aviso automático de Famacon Control, no responda a este mensaje."
// {{2}} (estado) and {{5}} (acción) come from fixed finite sets, never free-composed text.
const params5 = (a) => [a.equipo, a.estado, a.nivel, a.detectado, a.accion];
export const TEMPLATES = {
  urgent:  { language: 'es', params: params5 },
  warning: { language: 'es', params: params5 },
  info:    { language: 'es', params: params5 },
};

export function templateForSeverity(severity) {
  return TEMPLATES[severity] || TEMPLATES.warning;
}

// Business-initiated lead notification (new contact-form message → Famacon).
// Needs a Meta-approved template "famacon_nuevo_lead" for LIVE send; dry-run logs
// the text until the token is set. Body suggested:
//   "Nueva consulta en la web — {{1}}\nTel: {{2}}\n{{3}}"
export const LEAD_TEMPLATE = {
  name: 'famacon_nuevo_lead',
  language: 'es',
  params: (l) => [l.name || 'sin nombre', l.phone || 'sin teléfono', (l.message || '').slice(0, 600)],
};

export function renderLeadText(l) {
  return `Nueva consulta en la web\nNombre: ${l.name || '—'}\nTel: ${l.phone || '—'}` +
    `${l.email ? `\nEmail: ${l.email}` : ''}\nTipo: ${l.audience || '—'}\n\n${l.message || ''}`;
}

/** Human-readable rendering (stored in the log; used by dry-run). */
export function renderText(a) {
  return `Alerta en ${a.equipo}. Estado: ${a.estado}. Nivel: ${a.nivel}. ` +
    `Detectado ${a.detectado}. Acción: ${a.accion}.`;
}
