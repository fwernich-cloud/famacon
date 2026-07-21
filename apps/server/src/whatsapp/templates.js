// ── HSM template registry (§6.5) ───────────────────────────────────────────
// Company-initiated alerts outside the 24h window REQUIRE Meta-approved HSM
// templates — free text fails out of session. Each entry maps to a template that
// must be submitted & approved in Meta (see docs/WHATSAPP.md). params() builds the
// ordered body variables. We keep a plain-text rendering too, for the log and for
// the (rare) in-session case.

export const TEMPLATES = {
  urgent: {
    name: 'famacon_alerta_urgente',
    language: 'es',
    // Body: "🚨 FAMACON CONTROL — {{1}}\n{{2}}\nQué revisar: {{3}}"
    params: (a) => [a.field, a.diagnosis, a.action || 'Revisar el equipo en el campo.'],
  },
  warning: {
    name: 'famacon_alerta_aviso',
    language: 'es',
    params: (a) => [a.field, a.diagnosis, a.action || 'Revisar cuando puedas.'],
  },
  info: {
    name: 'famacon_alerta_aviso',
    language: 'es',
    params: (a) => [a.field, a.diagnosis, a.action || 'Aviso preventivo.'],
  },
};

export function templateForSeverity(severity) {
  return TEMPLATES[severity] || TEMPLATES.warning;
}

/** Human-readable rendering (stored in the log; used by dry-run). */
export function renderText(a) {
  const head = a.severity === 'urgent' ? '🚨 FAMACON CONTROL' : 'FAMACON CONTROL';
  return `${head} — ${a.field}\n${a.diagnosis}\nQué revisar: ${a.action || 'Revisar el equipo.'}`;
}
