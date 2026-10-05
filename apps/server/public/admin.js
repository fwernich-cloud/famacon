const $ = (s) => document.querySelector(s);
let FIELD = null, PRODUCT = null;
const flash = (t, ok = true) => { const m = $('#msg'); m.style.color = ok ? 'var(--ok)' : 'var(--danger)'; m.textContent = t; };
async function get(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function put(u, b) { const r = await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }

async function load() {
  const f = await get('/api/fields'); FIELD = new URLSearchParams(location.search).get('field') || f.fields[0].field_id;
  PRODUCT = await get('/api/product?field=' + FIELD);
  renderCylinders(); renderWindmills(); renderTanks(); await renderSensors(); await renderRecipients();
}

async function renderSensors() {
  const d = await get('/api/sensors?field=' + FIELD);
  const kindLabel = { tank_level: 'Tanque', windmill_strokes: 'Molino', pump_current: 'Bomba', battery: 'Batería', temperature: 'Temperatura' };
  $('#sensors').innerHTML = d.sensors.map((s) => {
    const on = s.commissioned_at != null;
    const name = s.equipment_name || s.tank_ref || s.ext_ref;
    const last = s.last_ts ? new Date(s.last_ts).toLocaleString('es-AR') : 'nunca reportó';
    return `<div class="card"><div class="kind">${esc(kindLabel[s.kind] || s.kind)}</div><h3>${esc(name)}</h3>
      <div class="row"><span class="k">DevEUI</span><span class="mono">${esc(s.ext_ref)}</span></div>
      <div class="row"><span class="k">Último dato</span><span>${esc(last)}</span></div>
      <div class="row"><span class="k">Estado</span><span>${on
        ? '<span class="badge b-ok">En servicio</span>' : '<span class="badge b-warn">Sin comisionar</span>'}</span></div>
      <div style="margin-top:10px">${on
        ? `<button class="btn" style="background:#b7791f" onclick="setCommission('${s.id}',false)">Dar de baja</button>`
        : `<button class="btn" onclick="setCommission('${s.id}',true)">Dar de alta (instalado)</button>`}</div></div>`;
  }).join('');
}
window.setCommission = async (id, commissioned) => { try {
  const res = await api('PUT', '/api/product/sensor-commission', { field: FIELD, sensorId: id, commissioned });
  if (res.ok) { flash(commissioned ? 'Sensor dado de alta. Desde ahora monitorea y puede alertar.' : 'Sensor dado de baja. No genera alertas.'); await renderSensors(); }
  else flash(res.error || 'No se pudo actualizar', false);
} catch (e) { flash(e.message, false); } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
async function api(method, u, b) {
  const r = await fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
}
async function renderRecipients() {
  const d = await get('/api/recipients?field=' + FIELD);
  const cards = d.recipients.map((r) => `<div class="card"><div class="kind">Destinatario</div><h3>${esc(r.name)}</h3>
    <div class="row"><span class="k">WhatsApp</span><span class="mono">${esc(r.phone_e164)}</span></div>
    <div class="row"><span class="k">Consentimiento</span><span>${r.consented
      ? '<span class="badge b-ok">Sí</span>' : '<span class="badge b-warn">Falta</span>'}</span></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      ${r.consented
        ? `<button class="btn" style="background:#b7791f" onclick="setConsent('${r.id}',false)">Revocar</button>`
        : `<button class="btn" onclick="setConsent('${r.id}',true)">Dar consentimiento</button>`}
      <button class="btn" style="background:#b23b3b" onclick="removeRecip('${r.id}')">Quitar</button>
    </div></div>`).join('');
  const canAdd = d.recipients.length < d.max;
  const add = `<div class="card"><div class="kind">Nuevo destinatario</div>
    <div class="field"><label>Nombre</label><input id="rc_name" ${canAdd ? '' : 'disabled'}></div>
    <div class="field"><label>WhatsApp (con código país)</label><input id="rc_phone" placeholder="+54 9 11 …" ${canAdd ? '' : 'disabled'}></div>
    <button class="btn" onclick="addRecip()" ${canAdd ? '' : 'disabled'}>Agregar</button>
    ${canAdd ? '' : `<small style="color:#b7791f;display:block;margin-top:6px">Máximo ${d.max} destinatarios.</small>`}</div>`;
  $('#recipients').innerHTML = `<div class="grid cols-3">${cards}${add}</div>`;
}
window.addRecip = async () => { try {
  const name = $('#rc_name').value.trim(), phone = $('#rc_phone').value.trim();
  if (!name || !phone) return flash('Completá nombre y teléfono', false);
  const res = await api('POST', '/api/recipients', { field: FIELD, name, phone_e164: phone });
  if (res.ok) { flash('Destinatario agregado.'); await renderRecipients(); } else flash(res.error || 'No se pudo agregar', false);
} catch (e) { flash(e.message, false); } };
window.setConsent = async (id, granted) => { try {
  await api('POST', '/api/recipients/consent', { field: FIELD, recipientId: id, granted });
  flash(granted ? 'Consentimiento registrado (con fecha y hora).' : 'Consentimiento revocado.'); await renderRecipients();
} catch (e) { flash(e.message, false); } };
window.removeRecip = async (id) => { try {
  await api('DELETE', '/api/recipients', { field: FIELD, recipientId: id });
  flash('Destinatario quitado.'); await renderRecipients();
} catch (e) { flash(e.message, false); } };

function renderCylinders() {
  $('#cylinders').innerHTML = PRODUCT.cylinders.map((c) => {
    const pending = c.internal_diameter_mm == null;
    return `<div class="card"><div class="kind">Cilindro</div><h3>${c.nominal}</h3>
      <div class="field"><label>Diámetro interno (mm)</label>
        <input type="number" step="0.1" value="${c.internal_diameter_mm ?? ''}" ${pending ? 'class="pending" placeholder="a confirmar"' : ''} id="cyl_${cssId(c.nominal)}"></div>
      <button class="btn" onclick="saveCyl('${c.nominal.replace(/'/g, "\\'")}')">Guardar</button></div>`; }).join('');
}
function renderWindmills() {
  const cylOpts = ['<option value="">(a confirmar)</option>']
    .concat(PRODUCT.cylinders.map((c) => `<option value='${c.nominal}'>${c.nominal}${c.internal_diameter_mm == null ? ' (sin medir)' : ''}</option>`));
  $('#windmills').innerHTML = PRODUCT.windmills.map((w) => `<div class="card">
    <div class="kind">Rueda ${w.wheel_ft}'</div><h3>${w.name}</h3>
    <div class="field"><label>Cilindro instalado</label>
      <select id="wc_cyl_${w.equipment_id}">${cylOpts.join('')}</select></div>
    <div class="field"><label>η (eficiencia, cuero nuevo)</label>
      <input type="number" step="0.01" min="0" max="1" value="${w.eta_base ?? ''}" placeholder="a confirmar" id="wc_eta_${w.equipment_id}"></div>
    <button class="btn" onclick="saveWindmill('${w.equipment_id}')">Guardar</button></div>`).join('');
  PRODUCT.windmills.forEach((w) => { if (w.cylinder_nominal) $(`#wc_cyl_${w.equipment_id}`).value = w.cylinder_nominal; });
}
function renderTanks() {
  $('#tanks').innerHTML = PRODUCT.tanks.map((t) => `<div class="card"><div class="kind">Tanque</div><h3>${t.tank_ref}</h3>
    <div class="field"><label>Forma</label><select id="tk_shape_${t.tank_ref}">
      <option value="cylinder" ${t.shape === 'cylinder' ? 'selected' : ''}>Redondo</option>
      <option value="rectangular" ${t.shape === 'rectangular' ? 'selected' : ''}>Rectangular</option></select></div>
    <div class="field"><label>Diámetro (mm) — si es redondo</label><input type="number" value="${t.diameter_mm ?? ''}" placeholder="a confirmar" id="tk_d_${t.tank_ref}"></div>
    <div class="field"><label>Largo (mm) — si es rectangular</label><input type="number" value="${t.length_mm ?? ''}" placeholder="a confirmar" id="tk_l_${t.tank_ref}"></div>
    <div class="field"><label>Ancho (mm) — si es rectangular</label><input type="number" value="${t.width_mm ?? ''}" placeholder="a confirmar" id="tk_w_${t.tank_ref}"></div>
    <div class="field"><label>Alto útil (mm)</label><input type="number" value="${t.height_mm ?? ''}" placeholder="a confirmar" id="tk_h_${t.tank_ref}"></div>
    <div class="field"><label>Altura del sensor sobre el borde (mm)</label><input type="number" value="${t.sensor_offset_mm ?? ''}" placeholder="ultrasónico → nivel" id="tk_o_${t.tank_ref}">
      <small style="color:#b7791f;display:block;margin-top:4px">⚠ Si la altura del sensor está mal, todo el nivel del tanque queda mal.</small></div>
    <button class="btn" onclick="saveTank('${t.tank_ref}')">Guardar</button></div>`).join('');
}
const cssId = (s) => s.replace(/[^a-z0-9]/gi, '_');

window.saveCyl = async (nominal) => { try {
  const v = parseFloat($(`#cyl_${cssId(nominal)}`).value);
  if (isNaN(v)) return flash('Ingresá un número', false);
  await put('/api/product/cylinder', { field: FIELD, nominal, internal_diameter_mm: v });
  flash(`Cilindro ${nominal} guardado (${v} mm).`); await load();
} catch (e) { flash(e.message, false); } };

window.saveWindmill = async (id) => { try {
  const cyl = $(`#wc_cyl_${id}`).value || null;
  const etaRaw = $(`#wc_eta_${id}`).value; const eta = etaRaw === '' ? null : parseFloat(etaRaw);
  await put('/api/product/windmill', { field: FIELD, equipmentId: id, cylinder_nominal: cyl, eta_base: eta });
  flash('Molino guardado. El motor lo toma al instante.'); await load();
} catch (e) { flash(e.message, false); } };

window.saveTank = async (ref) => { try {
  const shape = $(`#tk_shape_${ref}`).value;
  const num = (id) => { const v = $(`#${id}`).value; return v === '' ? null : parseFloat(v); };
  const res = await put('/api/product/tank', { field: FIELD, tank_ref: ref, shape,
    diameter_mm: num(`tk_d_${ref}`), length_mm: num(`tk_l_${ref}`), width_mm: num(`tk_w_${ref}`),
    height_mm: num(`tk_h_${ref}`), sensor_offset_mm: num(`tk_o_${ref}`) });
  if (res && res.warning) { const m = $('#msg'); m.style.color = '#b7791f'; m.textContent = `Tanque ${ref} guardado. ⚠ ${res.warning}`; }
  else flash(`Tanque ${ref} guardado.`);
  await load();
} catch (e) { flash(e.message, false); } };

load().catch((e) => flash(e.message, false));
