// ZIMOVA front end (vanilla JS + Leaflet). All money/fare logic lives on the server; this file only displays it.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (c / 100).toFixed(2), main = $('#main');
const ACTIVE = ['searching', 'accepted', 'arrived', 'in_progress'];
const LABEL = { searching: 'Searching for a driver…', accepted: 'Driver arriving', arrived: 'Driver has arrived', in_progress: 'Trip in progress', completed: 'Completed', cancelled: 'Cancelled' };
let token = localStorage.getItem('zt'), me = null, timer = null, map = null, layers = {}, P = {}, shownRoute = null;

function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3800); }
async function api(p, method = 'GET', body) {
  const r = await fetch('/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
}
const form = f => Object.fromEntries(new FormData(f));
const go = async v => { clearInterval(timer); timer = null; if (map) { map.remove(); map = null; } layers = {}; P = {}; shownRoute = null; main.onclick = null; main.innerHTML = ''; nav();
  try { await views[v](); } catch (e) { toast(e.message); } };
const home = () => go(!me ? 'welcome' : { passenger: 'passenger', driver: 'driver', admin: 'admin' }[me.role]);
function nav() {
  const n = $('#nav'); if (!me) { n.innerHTML = ''; return; }
  const l = { passenger: [['passenger', 'Book a ride'], ['history', 'My trips']], driver: [['driver', 'Dashboard']], admin: [['admin', 'Admin']] }[me.role];
  n.innerHTML = l.map(([v, t]) => `<button class="btn sm ghost" data-v="${v}">${t}</button>`).join('') + `<button class="btn sm" id="out">Sign out (${esc(me.name.split(' ')[0])})</button>`;
  $$('[data-v]', n).forEach(b => b.onclick = () => go(b.dataset.v));
  $('#out').onclick = () => { token = null; me = null; localStorage.removeItem('zt'); go('welcome'); };
}
const authed = r => { token = r.token; me = r.user; localStorage.setItem('zt', token); home(); };
$('#logo').onclick = e => { e.preventDefault(); home(); };
const initMap = (id = 'map') => {
  map = L.map(id, { maxBounds: [[-24, 24], [-14.5, 34]], minZoom: 5 }).setView([-19.0, 29.8], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
};
const pin = k => L.divIcon({ className: '', html: `<div class="pin ${k}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
function drawBooking(g) {   // route + pins for a booking with geometry
  ['from', 'to', 'route'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k]));
  layers.from = L.marker(g.from, { icon: pin('from') }).addTo(map).bindTooltip('Pickup'); layers.to = L.marker(g.to, { icon: pin('to') }).addTo(map).bindTooltip('Destination');
  layers.route = L.polyline(g.geometry.map(([x, y]) => [y, x]), { color: '#d4af37', weight: 5 }).addTo(map); map.fitBounds(layers.route.getBounds(), { padding: [30, 30] });
}
function breakdown(b) {
  const r = b.rates || {};
  return `<table><tr><td>Original fare (${b.km} km, ${esc(b.vehicle)})</td><td class="r">${money(b.fareC)}</td></tr>
  <tr><td>Passenger service fee (${r.serviceFeePct}%)</td><td class="r">${money(b.feeC)}</td></tr>
  <tr class="tot"><td>Total passenger payment</td><td class="r">${money(b.totalC)}</td></tr>
  <tr><td>Driver earnings (${100 - r.commissionPct}% of fare)</td><td class="r">${money(b.driverC)}</td></tr>
  <tr><td>Platform commission (${r.commissionPct}% of fare)</td><td class="r">${money(b.commissionC)}</td></tr></table>`;
}
const views = {};

views.welcome = async () => {
  main.innerHTML = `<section class="hero"><h1>ZIMOVA</h1><p class="tag">MOVE YOUR WAY</p><p>Ride-hailing across Zimbabwe — real roads, real distances, clear fares.</p></section>
  <div class="grid2"><form class="card" id="login"><h2>Sign in</h2><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button class="btn">Sign in</button>
  <p class="hint">Demo logins: driver@zimova.test / driver123 · admin@zimova.test / admin123</p></form>
  <form class="card" id="reg"><h2>New passenger</h2><label>Full name</label><input name="name" required><label>Phone</label><input name="phone" required><label>Email</label><input name="email" type="email" required><label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required><button class="btn">Create account</button></form></div>
  <p class="center"><button class="btn ghost" id="drv">Drive with ZIMOVA — apply as a driver</button></p>`;
  $('#login').onsubmit = async e => { e.preventDefault(); try { authed(await api('/auth/login', 'POST', form(e.target))); } catch (x) { toast(x.message); } };
  $('#reg').onsubmit = async e => { e.preventDefault(); try { authed(await api('/auth/register', 'POST', form(e.target))); } catch (x) { toast(x.message); } };
  $('#drv').onclick = () => go('driverReg');
};

views.driverReg = async () => {
  main.innerHTML = `<form class="card" id="dr" style="max-width:640px;margin:auto"><h2>Driver registration</h2>
  <p class="sim">Demo: use FICTIONAL details only. Do not enter real ID numbers. No card details are ever collected here.</p>
  <h3>1. Personal</h3><input name="name" placeholder="Full name" required><input name="phone" placeholder="Phone" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" required>
  <h3>2. Identity &amp; licence</h3><input name="idNumber" placeholder="National ID number (fictional)" required><label>ID expiry</label><input name="idExpiry" type="date" required>
  <input name="licenceNumber" placeholder="Driver's licence number (fictional)" required><label>Licence expiry</label><input name="licenceExpiry" type="date" required>
  <h3>3. Vehicle</h3><div class="row"><input name="make" placeholder="Make" required><input name="model" placeholder="Model" required></div><div class="row"><input name="year" type="number" placeholder="Year" required><input name="reg" placeholder="Registration no." required><input name="capacity" type="number" placeholder="Seats" required></div>
  <h3>4. Settlement</h3><select name="settlement"><option value="ecocash">EcoCash wallet</option><option value="bank">Bank account</option><option value="card">Card (via provider-hosted setup later)</option></select>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="docs" style="width:auto;margin:0"> I have attached sample (fictional) ID, licence, vehicle and insurance documents</label><br>
  <button class="btn">Submit for verification</button></form>`;
  $('#dr').onsubmit = async e => { e.preventDefault(); const f = form(e.target);
    try { authed(await api('/auth/driver-register', 'POST', { name: f.name, phone: f.phone, email: f.email, password: f.password,
      driver: { idNumber: f.idNumber, idExpiry: f.idExpiry, licenceNumber: f.licenceNumber, licenceExpiry: f.licenceExpiry, settlement: f.settlement, docsConfirmed: !!f.docs,
        vehicle: { make: f.make, model: f.model, year: +f.year, reg: f.reg, capacity: +f.capacity } } })); toast('Submitted. Status: pending verification'); } catch (x) { toast(x.message); } };
};

// ---------- passenger
views.passenger = async () => {
  main.innerHTML = `<div class="split"><aside class="card" id="panel"></aside><div id="map"></div></div>`; initMap();
  map.on('click', e => { if (P.mode === 'plan') setPt(!P.from ? 'from' : 'to', e.latlng); });
  await tickP(); timer = setInterval(tickP, 3000);
};
async function tickP() {
  const l = await api('/bookings'), act = l.find(b => ACTIVE.includes(b.status)), pay = l.find(b => b.status === 'completed' && b.payment.status !== 'paid');
  const key = act ? 'a' + JSON.stringify(act) : pay ? 'p' + pay.id + pay.payment.status : P.receipt ? 'r' + P.receipt.id : 'plan';
  if (key === P.key) return; const was = P.key; P.key = key;
  if (act) { P.mode = 'active'; renderActive(act); } else if (pay) { P.mode = 'pay'; renderPay(pay); } else if (P.receipt) renderReceipt(P.receipt); else if (!was || was[0] !== 'p' || true) { P.mode = 'plan'; renderPlan(); }
}
function renderPlan() {
  ['from', 'to', 'route'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k]));
  Object.assign(P, { from: null, to: null, quote: null, veh: 'economy', names: {} });
  $('#panel').innerHTML = `<h2>Book a ride</h2><p class="hint">Tap the map to drop a <b>pickup</b> pin, then a <b>destination</b> pin (tap again to move the destination). Drag pins to adjust, or search a town.</p>
  <label>Pickup</label><div class="row"><input id="fromIn" placeholder="e.g. Harare"><button class="btn sm" data-s="from">Search</button></div>
  <label>Destination</label><div class="row"><input id="toIn" placeholder="e.g. Bulawayo"><button class="btn sm" data-s="to">Search</button></div>
  <div id="quoteBox" class="hint">Set both pins to see the road distance and fare.</div>
  <label>Payment method (simulated)</label><select id="payM"><option value="ecocash">EcoCash</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select>
  <button class="btn" id="book" disabled>Book ride</button>`;
  $$('[data-s]').forEach(b => b.onclick = async () => {
    const q = $('#' + b.dataset.s + 'In').value.trim(); if (!q) return;
    try { const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=zw&q=' + encodeURIComponent(q))).json();
      if (!r[0]) return toast('Nothing found in Zimbabwe for "' + q + '"'); const ll = L.latLng(+r[0].lat, +r[0].lon); setPt(b.dataset.s, ll, q); map.setView(ll, 12);
    } catch { toast('Search service unavailable. Tap the map instead.'); } });
  $('#book').onclick = async () => {
    try { $('#book').disabled = true; await api('/bookings', 'POST', { from: P.from, to: P.to, fromName: $('#fromIn').value, toName: $('#toIn').value, vehicle: P.veh, pay: $('#payM').value }); P.key = null; tickP(); toast('Ride requested'); }
    catch (x) { toast(x.message); $('#book').disabled = false; } };
}
function setPt(k, ll, label) {
  P[k] = { lat: ll.lat, lng: ll.lng };
  if (layers[k]) layers[k].setLatLng(ll); else { layers[k] = L.marker(ll, { draggable: true, icon: pin(k) }).addTo(map).bindTooltip(k === 'from' ? 'Pickup' : 'Destination'); layers[k].on('dragend', e => setPt(k, e.target.getLatLng())); }
  const inp = $('#' + k + 'In'); inp.value = label || `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
  if (!label) fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${ll.lat}&lon=${ll.lng}`).then(r => r.json()).then(j => { if (j.display_name && P[k] && P[k].lat === ll.lat) inp.value = j.display_name.split(',').slice(0, 3).join(','); }).catch(() => {});
  quote();
}
async function quote() {
  if (!P.from || !P.to) return; const id = P.qid = (P.qid || 0) + 1, box = $('#quoteBox'); $('#book').disabled = true; box.textContent = 'Finding the road route…';
  try { const q = await api('/quote', 'POST', { from: P.from, to: P.to }); if (id !== P.qid) return; P.quote = q;
    if (layers.route) map.removeLayer(layers.route); layers.route = L.polyline(q.geometry.map(([x, y]) => [y, x]), { color: '#d4af37', weight: 5 }).addTo(map); map.fitBounds(layers.route.getBounds(), { padding: [30, 30] });
    box.innerHTML = `<p><b>${q.km} km</b> by road · about ${q.min} min <span class="sim">estimate</span></p><div id="vehs">` + Object.entries(q.fares).map(([v, f]) => `<div class="veh ${v === P.veh ? 'sel' : ''}" data-v="${v}"><span>${v[0].toUpperCase() + v.slice(1)}</span><b>${money(f.totalC)}</b></div>`).join('') + `</div><div id="fb"></div>`;
    const show = () => { $$('.veh').forEach(e => e.classList.toggle('sel', e.dataset.v === P.veh)); $('#fb').innerHTML = breakdown(q.fares[P.veh]); }; show();
    $$('.veh').forEach(e => e.onclick = () => { P.veh = e.dataset.v; show(); }); $('#book').disabled = false;
  } catch (x) { if (id === P.qid) { box.innerHTML = `<span style="color:var(--bad)">${esc(x.message)}</span>`; } }
}
async function renderActive(b) {
  const d = b.driver;
  $('#panel').innerHTML = `<h2>${LABEL[b.status]}</h2><p><span class="badge">${b.status}</span> <span class="sim">simulated payment</span></p>
  <p class="hint">${esc(b.fromName)} → ${esc(b.toName)}<br>${b.km} km · ~${b.etaMin} min</p>
  ${d ? `<div class="req"><b>${esc(d.name)}</b> · ${esc(d.phone)}<br>${esc(d.vehicle.make)} ${esc(d.vehicle.model)} · ${esc(d.vehicle.reg)}</div>` : '<p class="hint">Waiting for an approved, online driver to accept. (Open a driver account in another browser window to test.)</p>'}
  ${breakdown(b)}<br><button class="btn red" id="cx">Cancel ride</button>`;
  $('#cx').onclick = async () => { try { const f = await api(`/bookings/${b.id}/cancel-fee`);
    if (!confirm(f.feeC ? `Cancelling now carries a fee of ${money(f.feeC)} (free within ${f.graceSeconds}s of driver acceptance). Cancel anyway?` : 'Cancel this ride? No fee applies.')) return;
    const r = prompt('Reason (optional)') || ''; await api(`/bookings/${b.id}/cancel`, 'POST', { reason: r }); toast(f.feeC ? 'Cancelled. Fee of ' + money(f.feeC) + ' recorded (simulated, not charged)' : 'Cancelled'); P.key = null; tickP(); } catch (x) { toast(x.message); } };
  if (shownRoute !== b.id) { shownRoute = b.id; const g = await api('/bookings/' + b.id); if (map) drawBooking(g); }
}
function renderPay(b) {
  $('#panel').innerHTML = `<h2>Payment summary</h2><p class="hint">Trip complete — ${b.km} km</p>${breakdown(b)}<span class="sim">SIMULATED — no real money moves</span>
  <label>Pay with</label><select id="pm"><option value="ecocash">EcoCash</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="fail" style="width:auto;margin:0"> Simulate a failed payment</label><br>
  ${b.payment.status === 'failed' ? '<p style="color:var(--bad)">Last attempt failed. Try again.</p>' : ''}<button class="btn" id="pay">Pay ${money(b.totalC)}</button>`;
  $('#pm').value = b.payment.method || 'ecocash';
  $('#pay').onclick = async () => { try { const r = await api(`/bookings/${b.id}/pay`, 'POST', { method: $('#pm').value, outcome: $('#fail').checked ? 'fail' : 'ok' });
    if (r.payment.status === 'paid') { P.receipt = r; } else toast('Payment failed (simulated)'); P.key = null; tickP(); } catch (x) { toast(x.message); } };
}
function renderReceipt(b) {
  $('#panel').innerHTML = `<h2>Receipt</h2><p><span class="badge ok">PAID (SIMULATED)</span></p><p class="hint">Ref ${esc(b.payment.ref)} · ${esc(b.payment.method)} · ${new Date(b.payment.at).toLocaleString()}</p>${breakdown(b)}<br><button class="btn" id="nr">Book another ride</button>`;
  $('#nr').onclick = () => { P.receipt = null; P.key = null; tickP(); };
}
views.history = async () => {
  const l = (await api('/bookings')).filter(b => !ACTIVE.includes(b.status));
  main.innerHTML = `<div class="card"><h2>My trips</h2><div class="wrap"><table><tr><th>Date</th><th>Route</th><th>Status</th><th class="r">Fare</th><th class="r">Fee</th><th class="r">Total</th><th class="r">Driver</th><th class="r">Commission</th></tr>` +
    (l.map(b => `<tr><td>${new Date(b.createdAt).toLocaleDateString()}</td><td>${esc(b.fromName)} → ${esc(b.toName)}</td><td>${b.status}${b.status === 'completed' ? ' · ' + b.payment.status : ''}${b.cancel?.feeC ? ' · fee ' + money(b.cancel.feeC) + (b.cancel.waived ? ' (waived)' : '') : ''}</td><td class="r">${money(b.fareC)}</td><td class="r">${money(b.feeC)}</td><td class="r">${money(b.totalC)}</td><td class="r">${money(b.driverC)}</td><td class="r">${money(b.commissionC)}</td></tr>`).join('') || '<tr><td colspan="8">No trips yet.</td></tr>') + `</table></div><p class="sim">Demo rides — simulated payments</p></div>`;
};

// ---------- driver
views.driver = async () => {
  main.innerHTML = `<div class="grid2"><section class="card" id="dStat"></section><section class="card"><h2>Active trip</h2><div id="dTrip"></div><div id="map" class="mini"></div></section><section class="card" id="dReq"></section><section class="card" id="dEarn"></section></div>`; initMap();
  const hidden = new Set();
  main.onclick = async e => { const b = e.target.closest('[data-act]'); if (!b) return; const { act, id } = b.dataset;
    try { if (act === 'reject') hidden.add(id); else if (act === 'dcancel') await api(`/bookings/${id}/cancel`, 'POST', { reason: prompt('Reason') || '' }); else await api(`/bookings/${id}/${act}`, 'POST'); await tickD(hidden); } catch (x) { toast(x.message); } };
  await tickD(hidden); timer = setInterval(() => tickD(hidden), 3000);
};
async function tickD(hidden) {
  me = (await api('/me')).user; const l = await api('/bookings'), er = await api('/driver/earnings');
  const act = l.find(b => b.driverId && ['accepted', 'arrived', 'in_progress'].includes(b.status)), v = me.driver.vehicle;
  $('#dStat').innerHTML = `<h2>Driver dashboard</h2><p>${esc(me.name)} <span class="badge ${me.status === 'approved' ? 'ok' : me.status === 'pending' ? '' : 'bad'}">${me.status.replace('pending', 'pending verification')}</span></p>
  <p class="hint">${esc(v.make)} ${esc(v.model)} · ${esc(v.reg)} · ${v.capacity} seats</p>
  <button class="btn ${me.online ? 'green' : ''}" id="on" ${me.status !== 'approved' ? 'disabled' : ''}>${me.online ? 'ONLINE — tap to go offline' : 'OFFLINE — tap to go online'}</button>
  ${me.status !== 'approved' ? '<p class="hint">Only approved drivers can go online and accept rides. An admin must approve your documents.</p>' : ''}`;
  $('#on').onclick = async () => { try { await api('/driver/online', 'POST', { online: !me.online }); tickD(hidden); } catch (x) { toast(x.message); } };
  const nextA = { accepted: ['arrive', "I've arrived"], arrived: ['start', 'Start trip'], in_progress: ['complete', 'Complete trip'] };
  $('#dTrip').innerHTML = act ? `<p><span class="badge">${LABEL[act.status]}</span></p><p>${esc(act.fromName)} → ${esc(act.toName)}<br><span class="hint">${esc(act.passenger?.name)} · ${act.km} km</span></p>
    <a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${act.from.lat},${act.from.lng};${act.to.lat},${act.to.lng}">Open navigation</a>
    <button class="btn sm" data-act="${nextA[act.status][0]}" data-id="${act.id}">${nextA[act.status][1]}</button>
    ${act.status !== 'in_progress' ? `<button class="btn sm red" data-act="dcancel" data-id="${act.id}">Cancel</button>` : ''}` : '<p class="hint">No active trip.</p>';
  if (act && shownRoute !== act.id) { shownRoute = act.id; drawBooking(await api('/bookings/' + act.id)); } else if (!act && shownRoute) { shownRoute = null; ['from', 'to', 'route'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k])); }
  const reqs = me.status === 'approved' && me.online && !act ? l.filter(b => b.status === 'searching' && !hidden.has(b.id)) : [];
  $('#dReq').innerHTML = `<h2>Ride requests</h2>` + (reqs.map(b => `<div class="req"><b>${esc(b.fromName)} → ${esc(b.toName)}</b><br><span class="hint">${b.km} km · ${esc(b.vehicle)} · you earn ${money(b.driverC)} (commission ${money(b.commissionC)})</span><br>
    <button class="btn sm green" data-act="accept" data-id="${b.id}">Accept</button> <button class="btn sm ghost" data-act="reject" data-id="${b.id}">Reject</button></div>`).join('') || `<p class="hint">${me.online ? 'Waiting for requests…' : 'Go online to receive requests.'}</p>`);
  const s = x => `<div><span class="hint">${x[0]}</span><b>${money(x[1].netC)}</b><span class="hint">${x[1].trips} trips · fare ${money(x[1].fareC)} · commission −${money(x[1].commissionC)}</span></div>`;
  $('#dEarn').innerHTML = `<h2>Earnings</h2><div class="stat">${s(['Today', er.today])}${s(['This month', er.month])}${s(['All time', er.all])}</div><br><div class="wrap"><table><tr><th>Trip</th><th class="r">Fare</th><th class="r">Commission</th><th class="r">You earn</th><th>Payment</th></tr>` +
    (er.trips.map(b => `<tr><td>${esc(b.toName).slice(0, 24)}</td><td class="r">${money(b.fareC)}</td><td class="r">−${money(b.commissionC)}</td><td class="r">${money(b.driverC)}</td><td>${b.payment.status}${b.payment.simulated ? ' (sim)' : ''}</td></tr>`).join('') || '<tr><td colspan="5">No completed trips yet.</td></tr>') + `</table></div>`;
}

// ---------- admin
views.admin = async () => {
  const tabs = ['Drivers', 'Bookings', 'Pricing', 'Transactions', 'Revenue', 'Audit'];
  main.innerHTML = `<div class="tabs">${tabs.map(t => `<button class="btn sm" data-t="${t}">${t}</button>`).join('')}</div><div class="card" id="ab"></div>`;
  const show = async t => { $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); try { await adminTabs[t]($('#ab')); } catch (x) { toast(x.message); } };
  $$('[data-t]').forEach(b => b.onclick = () => show(b.dataset.t)); main.onclick = async e => {
    const s = e.target.closest('[data-st]'), w = e.target.closest('[data-w]');
    try { if (s) { await api(`/admin/drivers/${s.dataset.id}/status`, 'POST', { status: s.dataset.st }); show('Drivers'); } if (w) { await api(`/admin/bookings/${w.dataset.w}/waive`, 'POST'); show('Bookings'); } } catch (x) { toast(x.message); } };
  show('Drivers');
};
const adminTabs = {
  async Drivers(el) { const l = await api('/admin/drivers');
    el.innerHTML = `<h2>Driver verification</h2><div class="wrap"><table><tr><th>Driver</th><th>ID / Licence (expiry)</th><th>Vehicle</th><th>Status</th><th></th></tr>` + (l.map(d => `<tr><td>${esc(d.name)}<br><span class="hint">${esc(d.phone)}</span></td><td>${esc(d.driver.idNumber)} (${d.driver.idExpiry})<br>${esc(d.driver.licenceNumber)} (${d.driver.licenceExpiry})</td>
      <td>${esc(d.driver.vehicle.make)} ${esc(d.driver.vehicle.model)} ${d.driver.vehicle.year}<br>${esc(d.driver.vehicle.reg)}</td><td><span class="badge">${d.status}</span></td>
      <td>${['approved', 'rejected', 'suspended'].filter(s => s !== d.status).map(s => `<button class="btn sm ${s === 'approved' ? 'green' : 'red'}" data-st="${s}" data-id="${d.id}">${s === 'approved' ? (d.status === 'suspended' ? 'Reinstate' : 'Approve') : s[0].toUpperCase() + s.slice(1, -2)}</button>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="5">No drivers.</td></tr>') + `</table></div>`; },
  async Bookings(el) { const l = await api('/bookings');
    el.innerHTML = `<h2>Bookings</h2><div class="wrap"><table><tr><th>ID</th><th>Passenger</th><th>Driver</th><th>Route</th><th>Status</th><th class="r">Total</th><th>Cancellation</th></tr>` + (l.map(b => `<tr><td>${b.id}</td><td>${esc(b.passenger?.name)}</td><td>${esc(b.driver?.name || '—')}</td><td>${esc(b.fromName)} → ${esc(b.toName)}</td><td>${b.status}</td><td class="r">${money(b.totalC)}</td>
      <td>${b.cancel ? `by ${b.cancel.by}, ${esc(b.cancel.reason || 'no reason')}, fee ${money(b.cancel.feeC)}${b.cancel.waived ? ' (waived)' : b.cancel.feeC ? ` <button class="btn sm ghost" data-w="${b.id}">Waive</button>` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No bookings yet.</td></tr>') + `</table></div>`; },
  async Pricing(el) { const c = await api('/config'), f = (n, l, v, st = 'any') => `<label>${l}</label><input name="${n}" type="number" step="${st}" min="0" value="${v}" required>`;
    el.innerHTML = `<h2>Pricing, commission &amp; cancellation</h2><form id="cfg" style="max-width:420px">${f('base', 'Base fare ($)', c.base)}${f('perKm', 'Per km ($)', c.perKm)}${f('min', 'Minimum fare ($)', c.min)}
      ${f('m_economy', 'Economy multiplier', c.mult.economy)}${f('m_comfort', 'Comfort multiplier', c.mult.comfort)}${f('m_suv', 'SUV multiplier', c.mult.suv)}
      ${f('serviceFeePct', 'Passenger service fee (%)', c.serviceFeePct)}${f('commissionPct', 'Driver commission (%)', c.commissionPct)}${f('cancelFee', 'Cancellation fee ($)', c.cancelFee)}${f('graceSeconds', 'Free-cancel grace period after acceptance (seconds)', c.graceSeconds)}
      <button class="btn">Save settings</button><p class="hint">Applies to new bookings only. Existing bookings keep the rates they were priced with.</p></form>`;
    $('#cfg').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(Object.entries(form(e.target)).map(([k, x]) => [k, +x]));
      try { await api('/admin/config', 'PUT', { base: v.base, perKm: v.perKm, min: v.min, mult: { economy: v.m_economy, comfort: v.m_comfort, suv: v.m_suv }, serviceFeePct: v.serviceFeePct, commissionPct: v.commissionPct, cancelFee: v.cancelFee, graceSeconds: v.graceSeconds }); toast('Settings saved'); } catch (x) { toast(x.message); } }; },
  async Transactions(el) { const l = await api('/admin/transactions');
    el.innerHTML = `<h2>Transactions <span class="sim">SIMULATED</span></h2><div class="wrap"><table><tr><th>Ref</th><th>Booking</th><th>Method</th><th class="r">Amount</th><th>Status</th><th>Time</th></tr>` + (l.map(t => `<tr><td>${t.ref}</td><td>${t.bookingId}</td><td>${t.method}</td><td class="r">${money(t.amountC)}</td><td>${t.status}</td><td>${new Date(t.at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="6">None yet.</td></tr>') + `</table></div>`; },
  async Revenue(el) { const s = await api('/admin/summary'), k = (l, v) => `<div><span class="hint">${l}</span><b>${v}</b></div>`;
    el.innerHTML = `<h2>Revenue <span class="sim">simulated, paid trips only</span></h2><div class="stat">${k('Paid trips', s.paidTrips)}${k('Gross fares', money(s.grossFareC))}${k('Commission (5%)', money(s.commissionC))}${k('Service fees', money(s.feeC))}${k('Platform revenue', money(s.platformRevenueC))}${k('Driver earnings', money(s.driverC))}${k('Passengers paid', money(s.passengerPaidC))}${k('Drivers pending', s.pendingDrivers)}</div>
      <p class="hint">Bookings by status: ${Object.entries(s.byStatus).map(([a, b]) => a + ' ' + b).join(' · ') || 'none'}. Platform revenue is before payment-processing costs, tax and expenses.</p>`; },
  async Audit(el) { const l = await api('/admin/audit');
    el.innerHTML = `<h2>Audit log</h2><div class="wrap"><table>` + (l.map(a => `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${esc(a.by)}</td><td>${a.action}</td><td>${esc(a.detail).slice(0, 160)}</td></tr>`).join('') || '<tr><td>No admin actions yet.</td></tr>') + `</table></div>`; }
};
(async () => { if (token) { try { me = (await api('/me')).user; } catch { token = null; localStorage.removeItem('zt'); } } home(); })();
