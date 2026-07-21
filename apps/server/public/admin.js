const $ = (s) => document.querySelector(s);
let FIELD = null, PRODUCT = null;
const flash = (t, ok = true) => { const m = $('#msg'); m.style.color = ok ? 'var(--ok)' : 'var(--danger)'; m.textContent = t; };
async function get(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function put(u, b) { const r = await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }

async function load() {
  const f = await get('/api/fields'); FIELD = f.fields[0].field_id;
  PRODUCT = await get('/api/product?field=' + FIELD);
  renderCylinders(); renderWindmills(); renderTanks();
}

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
    <div class="field"><label>Diámetro (mm)</label><input type="number" value="${t.diameter_mm ?? ''}" placeholder="a confirmar" id="tk_d_${t.tank_ref}"></div>
    <div class="field"><label>Alto útil (mm)</label><input type="number" value="${t.height_mm ?? ''}" placeholder="a confirmar" id="tk_h_${t.tank_ref}"></div>
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
  const d = $(`#tk_d_${ref}`).value, h = $(`#tk_h_${ref}`).value;
  await put('/api/product/tank', { field: FIELD, tank_ref: ref, shape,
    diameter_mm: d === '' ? null : parseFloat(d), height_mm: h === '' ? null : parseFloat(h) });
  flash(`Tanque ${ref} guardado.`); await load();
} catch (e) { flash(e.message, false); } };

load().catch((e) => flash(e.message, false));
