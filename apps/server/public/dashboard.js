const $ = (s) => document.querySelector(s);
const fmt = (v, u = '') => v == null ? '—' : `${v}${u}`;
const ago = (ts) => { if (!ts) return 'sin datos'; const m = (Date.now() - new Date(ts)) / 60000;
  return m < 60 ? `hace ${Math.round(m)} min` : `hace ${(m / 60).toFixed(1)} h`; };
const stBadge = (s) => ({ running: '<span class="badge b-ok">Andando</span>',
  stopped: '<span class="badge b-danger">Parado</span>',
  unknown: '<span class="badge b-muted">Sin dato</span>' }[s] || `<span class="badge b-muted">${s}</span>`);

let FIELD = null;

async function get(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }

async function load() {
  const ov = await get('/api/overview' + (FIELD ? `?field=${FIELD}` : ''));
  FIELD = ov.field.id;
  $('#fieldName').textContent = ov.field.name;
  const gw = ov.gateway;
  $('#gwStatus').innerHTML = gw ? `Gateway ${gw.ext_ref} · ${ago(gw.last_seen_at)} · RSSI ${fmt(Math.round(gw.signal_baseline_rssi))} dBm` : '';

  $('#equipment').innerHTML = ov.equipment.map((e) => {
    const detail = e.kind === 'pump'
      ? `<div class="row"><span class="k">Corriente</span><span class="mono">${fmt(e.current, ' A')}</span></div>`
      : `<div class="row"><span class="k">Golpes</span><span class="mono">${fmt(e.strokes)}</span></div>`;
    return `<div class="card">
      <div class="kind">${e.kind === 'pump' ? 'Bomba eléctrica' : 'Molino'} · ${e.tank_ref || ''}</div>
      <h3>${e.name} ${stBadge(e.state)}</h3>
      <div class="row"><span class="k">Nivel tanque</span><span class="mono big" style="font-size:24px">${fmt(e.tank_level, '%')}</span></div>
      ${detail}
      <div class="row"><span class="k">Última lectura</span><span class="mono">${ago(e.tank_ts)}</span></div>
    </div>`; }).join('');

  // tank selector
  const tanks = [...new Set(ov.equipment.map((e) => e.tank_ref).filter(Boolean))];
  $('#tankSel').innerHTML = tanks.map((t) => `<option>${t}</option>`).join('');
  $('#tankSel').onchange = () => drawChart(FIELD, $('#tankSel').value);
  if (tanks.length) drawChart(FIELD, tanks[0]);

  const al = ov.open_alerts;
  $('#alertCount').textContent = al.length ? `${al.length} abiertas` : 'todo en silencio';
  $('#alerts').innerHTML = al.length ? al.map((a) => `<div class="alert ${a.severity}">
      <div class="t">${a.subject} · ${a.type}</div><div class="d">${a.diagnosis}</div></div>`).join('')
    : '<div class="card muted">Sin alertas — el sistema está en silencio (es parte del producto).</div>';

  const perf = (await get('/api/performance?field=' + FIELD)).performance;
  $('#performance').innerHTML = perf.map((p) => {
    const label = p.mode === 'calibrated' ? `<span class="badge b-ok">${(p.rendimiento * 100).toFixed(0)}%</span>`
      : p.mode === 'trend' ? '<span class="badge b-muted">Tendencia</span>'
      : `<span class="pending">${p.reason || p.mode}</span>`;
    return `<div class="card"><div class="kind">Rendimiento</div><h3>${p.name}</h3>
      <div class="row"><span class="k">Estado</span><span>${label}</span></div></div>`; }).join('');

  const msgs = (await get('/api/messages?field=' + FIELD)).messages;
  $('#messages').innerHTML = msgs.length ? `<table><thead><tr><th>Estado</th><th>Destinatario</th><th>Plantilla</th><th>Cuándo</th></tr></thead>
    <tbody>${msgs.map((m) => `<tr><td>${statusBadge(m.status)}</td><td>${m.recipient || '—'}</td>
      <td class="mono">${m.template || '—'}</td><td class="mono">${ago(m.status_at)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="card muted">Sin envíos todavía.</div>';
}

function statusBadge(s) {
  if (s === 'delivered' || s === 'read' || s === 'sent') return `<span class="badge b-ok">${s}</span>`;
  if (s === 'sent_dryrun') return '<span class="badge b-muted">dry-run</span>';
  if (s === 'failed') return '<span class="badge b-danger">failed</span>';
  if (s === 'skipped_no_consent') return '<span class="badge b-warn">sin consentimiento</span>';
  return `<span class="badge b-muted">${s}</span>`;
}

async function drawChart(field, tank) {
  const d = await get(`/api/series?field=${field}&tank=${tank}&hours=48`);
  const W = 1180, H = 300, pad = 40;
  const pts = d.tank; if (!pts.length) { $('#chart').innerHTML = '<p class="muted">Sin datos en la ventana.</p>'; return; }
  const xs = pts.map((p) => new Date(p.ts).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const X = (t) => pad + (W - 2 * pad) * ((t - x0) / (x1 - x0 || 1));
  const Y = (v) => (H - pad) - (H - 2 * pad) * (v / 100);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(new Date(p.ts)).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${X(x1).toFixed(1)},${H - pad} L${X(x0).toFixed(1)},${H - pad} Z`;
  // strokes as light bars
  const sMax = Math.max(1, ...d.strokes.map((s) => s.value));
  const bars = d.strokes.map((s) => { const x = X(new Date(s.ts)); const h = (H - 2 * pad) * (s.value / sMax);
    return `<rect x="${(x - 3).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" fill="var(--line)"/>`; }).join('');
  const yTicks = [0, 20, 50, 80, 100].map((v) => `<line class="axis" x1="${pad}" y1="${Y(v)}" x2="${W - pad}" y2="${Y(v)}"/><text x="8" y="${Y(v) + 3}">${v}%</text>`).join('');
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
    ${yTicks}${bars}
    <path d="${area}" fill="var(--accent)" opacity="0.10"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="${W - pad}" y="${H - 12}" text-anchor="end">tanque (línea) · golpes (barras) · últimas 48 h</text>
  </svg>`;
}

load().catch((e) => { document.querySelector('main').innerHTML = `<section><p class="pending">Error: ${e.message}</p></section>`; });
setInterval(() => load().catch(() => {}), 30000);
