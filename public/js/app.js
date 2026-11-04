// ZIMOVA front end (vanilla JS + Leaflet). All money/fare logic lives on the server; this file only displays it.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (c / 100).toFixed(2), main = $('#main');
const ACTIVE = ['searching', 'accepted', 'arrived', 'in_progress'];
const LABEL = { searching: 'Searching for a driver…', accepted: 'Driver arriving', arrived: 'Driver has arrived', in_progress: 'Trip in progress', completed: 'Completed', cancelled: 'Cancelled' };
let carRaf = 0, carFor = null;
let token = localStorage.getItem('zt'), me = null, timer = null, map = null, layers = {}, P = {}, shownRoute = null;

function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3800); }
async function api(p, method = 'GET', body, hdrs = {}) {
  const r = await fetch((window.ZIMOVA_API || '') + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...hdrs }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
}
const form = f => Object.fromEntries(new FormData(f));
const go = async v => { shareLoc(false); cancelAnimationFrame(carRaf); carFor = null; scrollTo({ top: 0 }); clearInterval(timer); timer = null; if (map) { map.remove(); map = null; } layers = {}; P = {}; shownRoute = null; main.onclick = null; main.onchange = null; main.innerHTML = ''; nav();
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
  if (MAPS.google) { let sat = false; const b = document.createElement('button'); b.className = 'btn sm ghost maptype'; b.textContent = 'Satellite';
    b.onclick = () => { sat = !sat; map.setMapType(sat ? 'sat' : 'road'); b.textContent = sat ? 'Standard' : 'Satellite'; }; document.getElementById(id).appendChild(b); }
};
function locate(auto) {   // passenger's current position, only after the browser permission is granted
  if (!navigator.geolocation) return auto || toast('Location is not available in this browser');
  navigator.geolocation.getCurrentPosition(p => { const la = p.coords.latitude, ln = p.coords.longitude; if (!map) return;
    if (la < -22.6 || la > -15.5 || ln < 25 || ln > 33.3) return toast('Your location is outside Zimbabwe. Tap the map to choose a pickup.');
    const ll = L.latLng(la, ln); map.setView(ll, 14); if (!P.from || !auto) setPt('from', ll); },
    () => { if (!auto) toast('Allow location access to use your current position'); }, { enableHighAccuracy: true, timeout: 10000 });
}
let watchId = null, lastSend = 0;
function shareLoc(on) {
  if (window.ZNative && ZNative.tracking) { if (on) ZNative.startTracking(token); else ZNative.stopTracking(); return; }   // phone app: native background tracking   // driver position is sent only while a trip is active; the server also refuses it otherwise
  if (on && watchId === null && navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => { if (Date.now() - lastSend < 4000) return; lastSend = Date.now();
    api('/driver/location', 'POST', { lat: p.coords.latitude, lng: p.coords.longitude }).catch(x => { if (x.message && /No active trip/.test(x.message)) shareLoc(false); }); },
    () => toast('Turn on location so your passenger can see you'), { enableHighAccuracy: true, maximumAge: 3000 });
  else if (!on && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}
function moveDriver(loc) {   // real driver position from the server, animated smoothly
  const t = $('#drvloc'); if (t) t.textContent = loc ? '📍 Driver location: live' : "Waiting for the driver's location…";
  if (!map) return;
  if (!loc) { if (layers.drv) { map.removeLayer(layers.drv); delete layers.drv; } return; }
  const to = { lat: loc.lat, lng: loc.lng };
  if (!layers.drv) { layers.drv = L.marker(to, { icon: L.divIcon({ className: '', html: '<div class="car"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map).bindTooltip('Your driver'); return; }
  const m = layers.drv, from = m.getLatLng(), t0 = performance.now(); cancelAnimationFrame(carRaf);
  (function f(now) { const k = Math.min((now - t0) / 1500, 1), e = 1 - Math.pow(1 - k, 3); m.setLatLng({ lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e }); if (k < 1) carRaf = requestAnimationFrame(f); })(t0);
}
const pin = k => L.divIcon({ className: '', html: `<div class="pin ${k}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
function drawBooking(g) {   // route + pins for a booking with geometry
  ['from', 'to', 'route', 'drv'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k]));
  layers.from = L.marker(g.from, { icon: pin('from') }).addTo(map).bindTooltip('Pickup'); layers.to = L.marker(g.to, { icon: pin('to') }).addTo(map).bindTooltip('Destination');
  layers.route = L.polyline(g.geometry.map(([x, y]) => [y, x]), { color: '#d4af37', weight: 5 }).addTo(map); drawAnim(layers.route); map.fitBounds(layers.route.getBounds(), { padding: [30, 30] });
}
function breakdown(b) {
  const r = b.rates || {};
  return `<table><tr><td>Original fare (${b.km} km, ${esc(b.vehicle)})</td><td class="r">${money(b.fareC)}</td></tr>
  ${r.serviceFeePct ? `<tr><td>Passenger service fee (${r.serviceFeePct}%)</td><td class="r">${money(b.feeC)}</td></tr>` : ''}
  <tr class="tot"><td>Total passenger payment</td><td class="r">${money(b.totalC)}</td></tr>
  <tr><td>Driver earnings (${100 - r.commissionPct}% of fare)</td><td class="r">${money(b.driverC)}</td></tr>
  <tr><td>Platform commission (${r.commissionPct}% of fare)</td><td class="r">${money(b.commissionC)}</td></tr></table>`;
}
const views = {};
const TYPE = { private: 'Private trip', shared: 'Shared trip', package: 'Package delivery', someone: 'Ride for someone else' };
const typeLabel = b => TYPE[b.type || b.vehicle] || esc(b.vehicle);
const fareKey = () => P.opt === 'someone' ? 'private' : P.opt;
// ---------- motion + trust helpers
function drawAnim(p) { const el = p.getElement && p.getElement(); if (el) { el.setAttribute('pathLength', '1'); el.classList.add('draw'); } }
function count(el) { const to = +el.dataset.count, s = el.dataset.suffix || '', t0 = performance.now(); (function f(t) { const k = Math.min((t - t0) / 1300, 1); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + s; if (k < 1) requestAnimationFrame(f); })(t0); }
function reveal() { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); $$('[data-count]', e.target).forEach(count); } }), { threshold: .15 }); $$('.reveal').forEach(el => io.observe(el)); }
const savedPlaces = () => { try { return JSON.parse(localStorage.getItem('zp') || '[]'); } catch { return []; } };
function savedUI() {
  const box = $('#saved'); if (!box) return;
  box.innerHTML = savedPlaces().map((p, i) => `<button class="btn sm ghost" data-p="${i}">★ ${esc(p.name)}</button>`).join('') + `<button class="btn sm" id="savePt">+ Save last pin</button>`;
  $$('[data-p]', box).forEach(b => b.onclick = () => { const p = savedPlaces()[b.dataset.p]; setPt(!P.from ? 'from' : 'to', L.latLng(p.lat, p.lng), p.name); map.setView([p.lat, p.lng], 12); });
  $('#savePt').onclick = () => { const k = P.last; if (!k || !P[k]) return toast('Drop a pin first, then save it'); const name = (prompt('Name this place', 'Home') || '').trim().slice(0, 20); if (!name) return;
    localStorage.setItem('zp', JSON.stringify([...savedPlaces().slice(-5), { name, lat: P[k].lat, lng: P[k].lng }])); savedUI(); toast('Saved'); };
}
views.share = async code => {   // public read-only live trip page
  main.innerHTML = `<div class="split"><aside class="card" id="panel"><h2>Live trip</h2><p class="hint">Loading…</p></aside><div id="map"></div></div>`; initMap(); let drawn = false;
  const t = async () => { try { const s = await (await fetch((window.ZIMOVA_API || '') + '/api/share/' + code)).json(); if (s.error) throw 0;
    $('#panel').innerHTML = `<h2>${LABEL[s.status] || s.status}</h2><p class="hint">${esc(s.fromName)} → ${esc(s.toName)}</p>${s.driver ? `<div class="req"><b>${esc(s.driver.name)}</b><br>${esc(s.driver.vehicle.make)} ${esc(s.driver.vehicle.model)} · ${esc(s.driver.vehicle.reg)}</div>` : ''}<p class="sim">Shared by a ZIMOVA rider</p>`;
    if (!drawn && s.geometry) { drawn = true; drawBooking(s); } moveDriver(s.driverLoc);
  } catch { clearInterval(timer); $('#panel').innerHTML = '<h2>Link unavailable</h2><p class="hint">This trip link is invalid.</p>'; } };
  await t(); timer = setInterval(t, 5000);
};

views.welcome = async () => {
  const f = [['🛡️', 'Ride PIN check', 'Every trip has a 4-digit PIN. Your driver can only start once you share it.'], ['📍', 'Share your trip', 'Send a private live link so family can follow your journey.'], ['🆘', 'In-trip SOS', 'One tap alerts ZIMOVA support with your trip details.'], ['✅', 'Verified drivers', 'Drivers are reviewed and approved by an admin before they can accept rides.'], ['💵', 'Upfront fares', 'Real road distance, a clear breakdown, no surprises at the end.'], ['⭐', 'Driver ratings', 'Rate every trip so quality stays high.']];
  const faq = [['How is my fare calculated?', 'From the real road distance: the road distance multiplied by the per-km rate. You see the full breakdown before you book.'], ['What is the ride PIN?', 'A 4-digit code shown only to you. Give it to your driver when they arrive so only the right person starts your trip.'], ['Is this using real payments?', 'No. This is a demo: EcoCash, Visa and Mastercard are simulated and no money moves.'], ['How do I become a driver?', 'Apply with your details and vehicle information. An admin reviews your application before you can go online.']];
  main.innerHTML = `<section class="hero center"><div class="glow"></div><p class="tag">MOVE YOUR WAY</p><h1>ZIMOVA</h1><p class="lead">Ride-hailing across Zimbabwe — real roads, real distances, clear fares you see before you go.</p><div class="cta"><button class="btn" id="goIn">Sign in</button><button class="btn ghost" id="goReg">Create account</button></div></section>
  <div class="grid2" id="auth"><form class="card" id="login"><h2>Sign in</h2><label>Email</label><input name="email" type="email" required autocomplete="email"><label>Password</label><input name="password" type="password" required autocomplete="current-password"><button class="btn">Sign in</button>
  <p class="hint">Demo logins: driver@zimova.test / driver123 · admin@zimova.test / admin123</p></form>
  <form class="card" id="reg"><h2>New passenger</h2><label>Full name</label><input name="name" required><label>Phone</label><input name="phone" required><label>Email</label><input name="email" type="email" required><label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required><button class="btn">Create account</button></form></div>
  <p class="center"><button class="btn ghost" id="drv">Drive with ZIMOVA — apply as a driver</button></p>
  <section class="sec reveal"><p class="eyebrow">Safety first</p><h3 class="t">Built so you can trust every ride</h3><div class="feat">${f.map(x => `<div class="card"><span class="ico">${x[0]}</span><b>${x[1]}</b><p>${x[2]}</p></div>`).join('')}</div></section>
  <section class="sec reveal"><p class="eyebrow">How it works</p><h3 class="t">Three steps to your ride</h3><div class="steps"><div class="card"><b>Set your route</b><p class="hint">Drop two pins or search a town anywhere in Zimbabwe.</p></div><div class="card"><b>Choose your ride</b><p class="hint">Private, shared, package delivery or a ride for someone else, with the full fare shown first.</p></div><div class="card"><b>Ride and rate</b><p class="hint">Share the PIN, enjoy the trip, then rate your driver.</p></div></div></section>
  <section class="sec reveal"><div class="nums"><div><b data-count="90" data-suffix="%">0</b><span>of every fare goes to the driver</span></div><div><b data-count="9">0</b><span>towns served</span></div><div><b data-count="4" data-suffix="-digit">0</b><span>PIN on every trip</span></div><div><b data-count="100" data-suffix="%">0</b><span>of fares shown upfront</span></div></div></section>
  <section class="sec reveal"><p class="eyebrow">Questions</p><h3 class="t">Good to know</h3>${faq.map(q => `<details><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join('')}</section>
  <footer class="foot">© ZIMOVA — Move Your Way · Demo build: payments, documents and tracking are simulated.</footer>`;
  $('#login').onsubmit = async e => { e.preventDefault(); try { authed(await api('/auth/login', 'POST', form(e.target))); } catch (x) { toast(x.message); } };
  $('#reg').onsubmit = async e => { e.preventDefault(); try { authed(await api('/auth/register', 'POST', form(e.target))); } catch (x) { toast(x.message); } };
  $('#drv').onclick = () => go('driverReg');
  $('#goIn').onclick = () => { $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#login input').focus({ preventScroll: true }); };
  $('#goReg').onclick = () => { $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#reg input').focus({ preventScroll: true }); };
  reveal();
};

views.driverReg = async () => {
  const towns = await api('/towns');
  main.innerHTML = `<form class="card" id="dr" style="max-width:640px;margin:auto"><h2>Driver registration</h2>
  <p class="sim">Demo: use FICTIONAL details only. Do not enter real ID numbers. No card details are ever collected here.</p>
  <h3>1. Personal</h3><input name="name" placeholder="Full name" required><input name="phone" placeholder="Phone" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" required>
  <h3>2. Identity &amp; licence</h3><input name="idNumber" placeholder="National ID number (fictional)" required><label>ID expiry</label><input name="idExpiry" type="date" required>
  <input name="licenceNumber" placeholder="Driver's licence number (fictional)" required><label>Licence expiry</label><input name="licenceExpiry" type="date" required>
  <h3>3. Vehicle</h3><div class="row"><input name="make" placeholder="Make" required><input name="model" placeholder="Model" required></div><div class="row"><input name="year" type="number" placeholder="Year" required><input name="reg" placeholder="Registration no." required><input name="capacity" type="number" placeholder="Seats" required></div>
  <h3>4. Operating town</h3><select name="townId" required>${towns.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><p class="hint">You only receive ride requests whose pickup is inside this town. An admin must approve it.</p>
  <h3>5. Insurance &amp; registration</h3><input name="insuranceNumber" placeholder="Insurance policy number (fictional)" required><label>Insurance expiry</label><input name="insuranceExpiry" type="date" required><input name="regBook" placeholder="Vehicle registration book number (fictional)" required>
  <h3>6. Settlement</h3><select name="settlement"><option value="ecocash">EcoCash wallet</option><option value="bank">Bank account</option><option value="card">Card (via provider-hosted setup later)</option></select>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="docs" style="width:auto;margin:0"> I have attached sample (fictional) ID, licence, vehicle and insurance documents</label><br>
  <button class="btn">Submit for verification</button></form>`;
  $('#dr').onsubmit = async e => { e.preventDefault(); const f = form(e.target);
    try { authed(await api('/auth/driver-register', 'POST', { name: f.name, phone: f.phone, email: f.email, password: f.password,
      driver: { idNumber: f.idNumber, idExpiry: f.idExpiry, licenceNumber: f.licenceNumber, licenceExpiry: f.licenceExpiry, settlement: f.settlement, townId: f.townId, insuranceNumber: f.insuranceNumber, insuranceExpiry: f.insuranceExpiry, regBook: f.regBook, docsConfirmed: !!f.docs,
        vehicle: { make: f.make, model: f.model, year: +f.year, reg: f.reg, capacity: +f.capacity } } })); toast('Submitted. Status: pending verification'); } catch (x) { toast(x.message); } };
};

// ---------- passenger
views.passenger = async () => {
  main.innerHTML = `<div class="split"><div><button class="grab" id="grab" aria-label="Expand or collapse booking panel"></button><aside class="card" id="panel"></aside></div><div id="map"></div></div>`; $('#grab').onclick = () => $('#panel').classList.toggle('collapsed'); initMap(); api('/towns').then(ts => { if (map) ts.forEach(t => L.polygon(t.polygon, { color: '#d4af37', weight: 1, dashArray: '4', fillOpacity: .07, interactive: false }).addTo(map)); }).catch(() => {});
  map.on('click', e => { if (P.mode === 'plan') setPt(!P.from ? 'from' : 'to', e.latlng); });
  await tickP(); timer = setInterval(tickP, 3000);
};
async function tickP() {
  const l = await api('/bookings'), act = l.find(b => ACTIVE.includes(b.status)), pay = l.find(b => b.status === 'completed' && ['pending', 'processing', 'failed'].includes(b.payment.status));
  if (pay) P.payId = pay.id; const done = !act && !pay && P.payId && l.find(b => b.id === P.payId && b.payment.status === 'paid'); if (done) { P.receipt = done; P.payId = null; }
  const key = act ? 'a' + JSON.stringify({ ...act, driverLoc: null }) : pay ? 'p' + pay.id + pay.payment.status : P.receipt ? 'r' + P.receipt.id : 'plan';
  if (act) moveDriver(act.driverLoc); if (key === P.key) return; const was = P.key; P.key = key;
  if (act) { P.mode = 'active'; renderActive(act); } else if (pay) { P.mode = 'pay'; renderPay(pay); } else if (P.receipt) renderReceipt(P.receipt); else if (!was || was[0] !== 'p' || true) { P.mode = 'plan'; renderPlan(); }
}
function renderPlan() {
  ['from', 'to', 'route', 'drv'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k]));
  Object.assign(P, { from: null, to: null, quote: null, opt: P.opt || 'private', names: {} });
  $('#panel').innerHTML = `<h2>Book with ZIMOVA</h2>${phoneBanner()}<div class="seg" id="seg">${Object.entries({ private: 'Private', shared: 'Shared', package: 'Package', someone: 'For someone' }).map(([k, t]) => `<button data-o="${k}" class="${k === P.opt ? 'on' : ''}">${t}</button>`).join('')}</div>
  <p class="hint">Your pickup must be inside a gold service area. Tap the map to drop a <b>pickup</b> pin, then a <b>destination</b> pin. Drag pins to adjust, or search a town.</p>
  <label>Pickup</label><div class="row"><input id="fromIn" placeholder="e.g. Harare"><button class="btn sm ghost" id="loc" title="Use my current location">📍</button><button class="btn sm" data-s="from">Search</button></div>
  <label>Destination</label><div class="row"><input id="toIn" placeholder="e.g. Bulawayo"><button class="btn sm" data-s="to">Search</button></div>
  <div id="extra"></div><div id="quoteBox" class="hint">Set both pins to see the road distance and fare.</div>
  <label>Payment method</label><select id="payM"><option value="ecocash">EcoCash</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select>
  <div id="saved" class="chips"></div><button class="btn" id="book" disabled>Book ride</button>`; savedUI(); drawExtra(); $('#loc').onclick = () => locate(false); if ($('#vp')) $('#vp').onclick = verifyPhone; if ($('#ve')) $('#ve').onclick = verifyEmail; if (!P.located) { P.located = true; locate(true); }
  $$('[data-o]').forEach(b => b.onclick = () => { P.opt = b.dataset.o; $$('[data-o]').forEach(x => x.classList.toggle('on', x === b)); drawExtra(); if (P.quote) showQuote(); });
  $$('[data-s]').forEach(b => b.onclick = async () => {
    const q = $('#' + b.dataset.s + 'In').value.trim(); if (!q) return;
    try { const r = await MAPS.search(q);
      if (!r) return toast('Nothing found in Zimbabwe for "' + q + '"'); const ll = L.latLng(r.lat, r.lng); setPt(b.dataset.s, ll, q); map.setView(ll, 12);
    } catch { toast('Search service unavailable. Tap the map instead.'); } });
  $('#book').onclick = async () => {
    const v = id => ($(id) || {}).value || '', body = { from: P.from, to: P.to, fromName: v('#fromIn'), toName: v('#toIn'), type: P.opt, pay: v('#payM') };
    if (P.opt === 'someone') body.rider = { name: v('#rn'), phone: v('#rp') };
    if (P.opt === 'shared') body.consent = $('#consent').checked;
    if (P.opt === 'package') body.pkg = { senderName: v('#pk_sn'), senderPhone: v('#pk_sp'), recipientName: v('#pk_rn'), recipientPhone: v('#pk_rp'), description: v('#pk_d'), category: v('#pk_c'), size: v('#pk_z'), weightKg: +v('#pk_w'), instructions: v('#pk_i'), noProhibited: $('#pk_ok').checked };
    try { $('#book').disabled = true; await api('/bookings', 'POST', body, { 'Idempotency-Key': crypto.randomUUID() }); P.key = null; tickP(); toast(P.opt === 'package' ? 'Delivery requested' : 'Ride requested'); }
    catch (x) { toast(x.message); $('#book').disabled = false; } };
}
function drawExtra() {
  const o = P.opt, e = $('#extra'), opts = l => l.map(x => `<option value="${x}">${x[0].toUpperCase() + x.slice(1)}</option>`).join('');
  $('#book').textContent = { private: 'Book ride', shared: 'Request shared ride', package: 'Send package', someone: 'Book for them' }[o];
  e.innerHTML = o === 'someone' ? `<label>Passenger's name</label><input id="rn" maxlength="60"><label>Passenger's phone</label><input id="rp" type="tel" maxlength="20"><p class="hint">The driver sees this person's name and number to find them. You still pay.</p>`
    : o === 'shared' ? `<label class="chk"><input type="checkbox" id="consent" style="width:auto;margin:3px 0 0"> I agree to share this vehicle with other passengers. Other riders only see my first name.</label><p class="hint">Shared fare is $0.90 per km, for your own route only. If no match is found you still get the ride at the shared rate.</p>`
    : o === 'package' ? `<label>Sender name</label><input id="pk_sn" value="${esc(me.name)}"><label>Sender phone</label><input id="pk_sp" value="${esc(me.phone || '')}"><label>Recipient name</label><input id="pk_rn"><label>Recipient phone</label><input id="pk_rp" type="tel">
      <label>What is in the package?</label><input id="pk_d" maxlength="200"><div class="row"><select id="pk_c" style="flex:1">${opts(['documents', 'clothing', 'food', 'electronics', 'groceries', 'other'])}</select><select id="pk_z" style="flex:1">${opts(['small', 'medium', 'large'])}</select></div>
      <label>Approximate weight (kg)</label><input id="pk_w" type="number" min="0.1" max="50" step="0.1"><label>Special instructions (optional)</label><input id="pk_i" maxlength="200">
      <label class="chk"><input type="checkbox" id="pk_ok" style="width:auto;margin:3px 0 0"> This package contains no dangerous or illegal items (weapons, drugs, explosives, fuel, poisons).</label>` : '';
}
function showQuote() {
  const q = P.quote, f = q.fares[fareKey()];
  $('#quoteBox').innerHTML = `<p><b>${q.km} km</b> by road · about ${q.min} min · pickup in ${esc(q.town)} <span class="sim">estimate</span></p><div class="veh sel"><span>${TYPE[P.opt]}</span>${numEl(f.totalC)}</div><p class="hint">${q.driversOnline ? q.driversOnline + ' driver(s) online in ' + esc(q.town) : 'No drivers online in ' + esc(q.town) + ' right now'}</p>` +
    (P.opt === 'shared' ? `<p class="hint">Private would be ${money(q.fares.private.totalC)} for this route.</p>` : '') + breakdown(f); $('#book').disabled = false; runNums($('#quoteBox'));
}
function setPt(k, ll, label) {
  P[k] = { lat: ll.lat, lng: ll.lng }; P.last = k;
  if (layers[k]) layers[k].setLatLng(ll); else { layers[k] = L.marker(ll, { draggable: true, icon: pin(k) }).addTo(map).bindTooltip(k === 'from' ? 'Pickup' : 'Destination'); layers[k].on('dragend', e => setPt(k, e.target.getLatLng())); }
  const inp = $('#' + k + 'In'); inp.value = label || `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
  if (!label) MAPS.reverse(ll).then(n => { if (n && P[k] && P[k].lat === ll.lat) inp.value = n; }).catch(() => {});
  quote();
}
async function quote() {
  if (!P.from || !P.to) return; const id = P.qid = (P.qid || 0) + 1, box = $('#quoteBox'); $('#book').disabled = true; box.textContent = 'Finding the road route…';
  try { const q = await api('/quote', 'POST', { from: P.from, to: P.to }); if (id !== P.qid) return; P.quote = q;
    if (layers.route) map.removeLayer(layers.route); layers.route = L.polyline(q.geometry.map(([x, y]) => [y, x]), { color: '#d4af37', weight: 5 }).addTo(map); drawAnim(layers.route); map.fitBounds(layers.route.getBounds(), { padding: [30, 30] });
    showQuote();
  } catch (x) { if (id === P.qid) { P.quote = null; box.innerHTML = `<span style="color:var(--bad)">${esc(x.message)}</span>`; } }
}
async function renderActive(b) {
  const d = b.driver;
  $('#panel').innerHTML = `<h2>${LABEL[b.status]}</h2>${stepper(b.status)}${b.status === 'searching' ? matchingHtml() : ''}<p><span class="badge">${b.status}</span> <span class="sim">${sbx('sandbox payments')}</span></p>
  <p class="hint"><span class="badge">${typeLabel(b)}</span><br>${esc(b.fromName)} → ${esc(b.toName)}<br>${b.km} km · ~${b.etaMin} min</p>
  ${d ? `<div class="req"><b>${esc(d.name)}</b>${d.rating ? ` · ★ ${d.rating.avg}` : ''} · ${esc(d.phone)}<br>${esc(d.vehicle.make)} ${esc(d.vehicle.model)} · ${esc(d.vehicle.reg)}</div>` : '<p class="hint">Waiting for an approved, online driver to accept. (Open a driver account in another browser window to test.)</p>'}
  ${d ? `<p class="hint" id="drvloc">${b.driverLoc ? '📍 Driver location: live' : "Waiting for the driver's location…"}</p>` : ''}${b.pin && ['accepted', 'arrived'].includes(b.status) ? `<div class="pinbox"><span class="hint">${b.type === 'package' ? 'Collection code — the sender gives it to the driver' : 'Your ride PIN — tell it to your driver'}</span><b>${esc(b.pin)}</b></div>` : ''}${b.dcode && b.type === 'package' && b.status !== 'searching' ? `<div class="pinbox"><span class="hint">Delivery code — give it to the recipient</span><b>${esc(b.dcode)}</b></div>` : ''}${breakdown(b)}<br><div class="actions">${d ? '<button class="btn sm ghost" id="shr">Share trip</button><button class="btn sm red" id="sos">SOS</button>' : ''}<button class="btn red" id="cx">Cancel ride</button></div>`;
  if ($('#shr')) { $('#shr').onclick = async () => { try { const { code } = await api(`/bookings/${b.id}/share`, 'POST'), url = (window.ZIMOVA_WEB || location.origin) + '/?share=' + code; try { await navigator.clipboard.writeText(url); toast('Live trip link copied'); } catch { prompt('Copy this link', url); } } catch (x) { toast(x.message); } };
    $('#sos').onclick = async () => { if (!await confirmBox('Send an SOS alert?', 'ZIMOVA support will be alerted with your trip details and emergency contact. If you are in immediate danger, also contact local emergency services.', 'Send SOS')) return; try { await api(`/bookings/${b.id}/sos`, 'POST'); toast('Alert sent to ZIMOVA support. If you are in immediate danger, contact local emergency services.'); } catch (x) { toast(x.message); } }; }
  $('#cx').onclick = async () => { try { const f = await api(`/bookings/${b.id}/cancel-fee`);
    if (!await confirmBox('Cancel this ride?', f.feeC ? `Cancelling now carries a fee of ${money(f.feeC)} (free within ${f.graceSeconds}s of driver acceptance).` : 'No fee applies.', 'Cancel ride')) return;
    const r = (await ask('Reason (optional)', 'This helps us improve')) ?? ''; await api(`/bookings/${b.id}/cancel`, 'POST', { reason: r }); toast(f.feeC ? 'Cancelled. Fee of ' + money(f.feeC) + ' recorded (simulated, not charged)' : 'Cancelled'); P.key = null; tickP(); } catch (x) { toast(x.message); } };
  if (shownRoute !== b.id) { shownRoute = b.id; const g = await api('/bookings/' + b.id); if (map) drawBooking(g); P.geo = g.geometry; }
  moveDriver(b.driverLoc);
}
function renderPay(b) {
  if (b.payment.status === 'processing') { $('#panel').innerHTML = `<h2>Confirming payment…</h2><div class="radar"><i></i><i></i><i></i><b></b></div><p class="hint">Waiting for the payment provider to confirm ${money(b.totalC)}. This takes a few seconds.</p>`; return; }
  $('#panel').innerHTML = `<h2>Payment summary</h2><p class="hint">Trip complete — ${b.km} km</p>${breakdown(b)}<span class="sim">${sbx('SANDBOX — no real money moves')}</span>
  <label>Pay with</label><select id="pm"><option value="ecocash">EcoCash</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select>
  ${sbxOn() ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="fail" style="width:auto;margin:0"> Sandbox: simulate a declined payment</label><br>' : '<br>'}
  ${b.payment.status === 'failed' ? '<p style="color:var(--bad)">Last attempt failed. Try again.</p>' : ''}<button class="btn" id="pay">Pay ${money(b.totalC)}</button>`;
  $('#pm').value = b.payment.method || 'ecocash';
  $('#pay').onclick = async () => { try { await api(`/bookings/${b.id}/pay`, 'POST', { method: $('#pm').value, outcome: ($('#fail') || {}).checked ? 'fail' : 'ok' }); P.key = null; tickP(); } catch (x) { toast(x.message); } };
}
function renderReceipt(b) {
  $('#panel').innerHTML = `${successSvg()}<h2 style="text-align:center">Payment confirmed</h2><p style="text-align:center"><span class="badge ok">PAID${sbx(' (SANDBOX)')}</span></p><p class="hint">Ref ${esc(b.payment.ref)} · ${esc(b.payment.method)} · ${new Date(b.payment.at).toLocaleString()}</p>${breakdown(b)}
  ${b.rating ? `<p>You rated this trip ${'★'.repeat(b.rating.stars)}</p>` : `<label>Rate your driver</label><input id="rc" maxlength="200" placeholder="Add a comment (optional)"><div class="stars" id="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}">★</button>`).join('')}</div>`}
  <div class="actions"><button class="btn" id="nr">Book another ride</button><button class="btn ghost" id="pr">Print receipt</button></div>`;
  $$('[data-star]').forEach(s => { s.onmouseenter = () => $$('[data-star]').forEach(x => x.classList.toggle('on', +x.dataset.star <= +s.dataset.star));
    s.onclick = async () => { try { P.receipt = await api(`/bookings/${b.id}/rate`, 'POST', { stars: +s.dataset.star, comment: ($('#rc') || {}).value || '' }); toast('Thanks for rating your driver'); renderReceipt(P.receipt); } catch (x) { toast(x.message); } }; });
  $('#pr').onclick = () => print();
  $('#nr').onclick = () => { P.receipt = null; P.key = null; tickP(); };
}
views.history = async () => {
  const l = (await api('/bookings')).filter(b => !ACTIVE.includes(b.status));
  main.innerHTML = `<div class="card"><h2>My trips</h2><div class="wrap"><table><tr><th>Date</th><th>Route</th><th>Status</th><th class="r">Fare</th><th class="r">Fee</th><th class="r">Total</th><th class="r">Driver</th><th class="r">Commission</th></tr>` +
    (l.map(b => `<tr><td>${new Date(b.createdAt).toLocaleDateString()}</td><td>${esc(b.fromName)} → ${esc(b.toName)}<br><span class="hint">${typeLabel(b)}</span></td><td>${b.status}${b.status === 'completed' ? ' · ' + b.payment.status : ''}${b.cancel?.feeC ? ' · fee ' + money(b.cancel.feeC) + (b.cancel.waived ? ' (waived)' : '') : ''}</td><td class="r">${money(b.fareC)}</td><td class="r">${money(b.feeC)}</td><td class="r">${money(b.totalC)}</td><td class="r">${money(b.driverC)}</td><td class="r">${money(b.commissionC)}</td></tr>`).join('') || '<tr><td colspan="8">No trips yet.</td></tr>') + `</table></div><p class="sim">Demo rides — simulated payments</p></div>`;
};

// ---------- driver
views.driver = async () => {
  main.innerHTML = `<div class="grid2"><section class="card" id="dStat"></section><section class="card"><h2>Active trip</h2><div id="dTrip"></div><div id="map" class="mini"></div></section><section class="card" id="dReq"></section><section class="card" id="dEarn"></section></div>`; initMap();
  const hidden = new Set();
  main.onclick = async e => { const b = e.target.closest('[data-act]'); if (!b) return; const { act, id, type } = b.dataset;
    try { if (act === 'reject') hidden.add(id); else if (act === 'dcancel') await api(`/bookings/${id}/cancel`, 'POST', { reason: (await ask('Cancel this trip?', 'Reason (optional)')) ?? '' }); else if (act === 'start') await api(`/bookings/${id}/start`, 'POST', { pin: await askReq('Ride PIN', "Ask the passenger for their 4-digit PIN", { inputmode: 'numeric', max: 4 }) }); else if (act === 'complete' && type === 'package') await api(`/bookings/${id}/complete`, 'POST', { dcode: await askReq('Delivery code', "Ask the recipient for their 4-digit code", { inputmode: 'numeric', max: 4 }) }); else await api(`/bookings/${id}/${act}`, 'POST'); await tickD(hidden); } catch (x) { toast(x.message); } };
  await tickD(hidden); timer = setInterval(() => tickD(hidden), 3000);
};
async function tickD(hidden) {
  me = (await api('/me')).user; const l = await api('/bookings'), er = await api('/driver/earnings');
  const acts = l.filter(b => b.driverId && ['accepted', 'arrived', 'in_progress'].includes(b.status)), act = acts[0], v = me.driver.vehicle;
  shareLoc(acts.length > 0);
  $('#dStat').innerHTML = `<h2>Driver dashboard</h2><p>${esc(me.name)} <span class="badge ${me.status === 'approved' ? 'ok' : me.status === 'pending' ? '' : 'bad'}">${me.status.replace('pending', 'pending verification')}</span></p>
  <p class="hint">${esc(v.make)} ${esc(v.model)} · ${esc(v.reg)} · ${v.capacity} seats${er.rating ? ` · ★ ${er.rating.avg} (${er.rating.count})` : ''}<br>Operating town: <b>${esc(me.townName || '—')}</b></p>
  <button class="btn ${me.online ? 'green' : ''}" id="on" ${me.status !== 'approved' ? 'disabled' : ''}>${me.online ? 'ONLINE — tap to go offline' : 'OFFLINE — tap to go online'}</button>
  ${me.status !== 'approved' ? '<p class="hint">Only approved drivers can go online and accept rides. An admin must approve your documents.</p>' : ''}`;
  $('#on').onclick = async () => { try { await api('/driver/online', 'POST', { online: !me.online }); tickD(hidden); } catch (x) { toast(x.message); } };
  const nextA = { accepted: ['arrive', "I've arrived"], arrived: ['start', 'Start trip'], in_progress: ['complete', 'Complete trip'] };
  const who = a => a.pkg ? `Sender ${esc(a.pkg.senderName)} ${esc(a.pkg.senderPhone)} → Recipient ${esc(a.pkg.recipientName)} ${esc(a.pkg.recipientPhone)}<br>${esc(a.pkg.category)}, ${esc(a.pkg.size)}, ~${a.pkg.weightKg} kg · ${esc(a.pkg.description)}${a.pkg.instructions ? ' · ' + esc(a.pkg.instructions) : ''}`
    : a.rider ? `Passenger ${esc(a.rider.name)} ${esc(a.rider.phone)} (booked by ${esc(a.passenger?.name)})` : `${esc(a.passenger?.name)}${a.type === 'shared' ? ' (shared ride)' : ''}`;
  const lab = (a, k) => a.type === 'package' ? { start: 'Confirm collection', complete: 'Confirm delivery' }[k] || nextA[a.status][1] : nextA[a.status][1];
  $('#dTrip').innerHTML = acts.length ? acts.map(a => `<div class="req"><p><span class="badge">${LABEL[a.status]}</span> <span class="badge">${typeLabel(a)}</span></p><p>${esc(a.fromName)} → ${esc(a.toName)}<br><span class="hint">${who(a)} · ${a.km} km · you earn ${money(a.driverC)}</span></p>
    <a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${a.status === 'in_progress' ? a.to.lat + ',' + a.to.lng : a.from.lat + ',' + a.from.lng}">${a.status === 'in_progress' ? 'Navigate to destination' : 'Navigate to pickup'}</a>
    <button class="btn sm" data-act="${nextA[a.status][0]}" data-id="${a.id}" data-type="${a.type || ''}">${lab(a, nextA[a.status][0])}</button>
    ${a.status !== 'in_progress' ? `<button class="btn sm red" data-act="dcancel" data-id="${a.id}">Cancel</button>` : ''}</div>`).join('') : '<p class="hint">No active trip.</p>';
  if (act && shownRoute !== act.id) { shownRoute = act.id; drawBooking(await api('/bookings/' + act.id)); } else if (!act && shownRoute) { shownRoute = null; ['from', 'to', 'route', 'drv'].forEach(k => layers[k] && (map.removeLayer(layers[k]), delete layers[k])); }
  const reqs = me.status === 'approved' && me.online && !acts.length ? l.filter(b => b.status === 'searching' && !hidden.has(b.id)) : [];
  $('#dReq').innerHTML = `<h2>Ride requests</h2>` + (reqs.map(b => `<div class="req"><b>${esc(b.fromName)} → ${esc(b.toName)}</b> <span class="badge">${typeLabel(b)}</span><br><span class="hint">${b.km} km · ${b.pkg ? esc(b.pkg.category) + ', ' + esc(b.pkg.size) + ' · ' : ''}you earn ${money(b.driverC)} (commission ${money(b.commissionC)})</span><br>
    <button class="btn sm green" data-act="accept" data-id="${b.id}">Accept</button> <button class="btn sm ghost" data-act="reject" data-id="${b.id}">Reject</button></div>`).join('') || `<p class="hint">${me.online ? 'Waiting for requests…' : 'Go online to receive requests.'}</p>`);
  const s = x => `<div><span class="hint">${x[0]}</span><b>${money(x[1].netC)}</b><span class="hint">${x[1].trips} trips · fare ${money(x[1].fareC)} · commission −${money(x[1].commissionC)}</span></div>`;
  $('#dEarn').innerHTML = `<h2>Earnings</h2><div class="stat">${s(['Today', er.today])}${s(['This month', er.month])}${s(['All time', er.all])}</div><br><div class="wrap"><table><tr><th>Trip</th><th class="r">Fare</th><th class="r">Commission</th><th class="r">You earn</th><th>Payment</th></tr>` +
    (er.trips.map(b => `<tr><td>${esc(b.toName).slice(0, 24)}</td><td class="r">${money(b.fareC)}</td><td class="r">−${money(b.commissionC)}</td><td class="r">${money(b.driverC)}</td><td>${b.payment.status}${b.payment.simulated ? ' (sim)' : ''}</td></tr>`).join('') || '<tr><td colspan="5">No completed trips yet.</td></tr>') + `</table></div>`;
}

// ---------- admin
views.admin = async () => {
  const tabs = ['Reports', 'Drivers', 'Passengers', 'Bookings', 'Towns', 'Pricing', 'Payments', 'Payouts', 'Support', 'Revenue', 'Safety', 'Audit'];
  main.innerHTML = `<div class="tabs">${tabs.map(t => `<button class="btn sm" data-t="${t}">${t}</button>`).join('')}</div><div class="card" id="ab"></div>`;
  const show = async t => { $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); try { await adminTabs[t]($('#ab')); } catch (x) { toast(x.message); } };
  $$('[data-t]').forEach(b => b.onclick = () => show(b.dataset.t)); main.onclick = async e => {
    const s = e.target.closest('[data-st]'), w = e.target.closest('[data-w]');
    try { if (s) { await api(`/admin/drivers/${s.dataset.id}/status`, 'POST', { status: s.dataset.st }); show('Drivers'); } if (w) { await api(`/admin/bookings/${w.dataset.w}/waive`, 'POST'); show('Bookings'); } } catch (x) { toast(x.message); } };
  main.onchange = async e => { const dc = e.target.closest('[data-doc]'); if (dc) { try { await api(`/admin/drivers/${dc.dataset.id}/verify`, 'POST', { field: dc.dataset.doc, value: dc.checked }); } catch (x) { toast(x.message); dc.checked = !dc.checked; } return; } const s = e.target.closest('[data-dt]'); if (!s) return; try { await api(`/admin/drivers/${s.dataset.dt}/town`, 'POST', { townId: s.value }); toast('Driver town updated'); } catch (x) { toast(x.message); } };
  show('Reports');
};
const adminTabs = {
  async Drivers(el) { const l = await api('/admin/drivers'), towns = await api('/admin/towns');
    el.innerHTML = `<h2>Driver verification</h2><div class="wrap"><table><tr><th>Driver</th><th>ID / Licence (expiry)</th><th>Vehicle</th><th>Documents verified</th><th>Town</th><th>Status</th><th></th></tr>` + (l.map(d => `<tr><td>${esc(d.name)}<br><span class="hint">${esc(d.phone)}</span></td><td>${esc(d.driver.idNumber)} (${d.driver.idExpiry})<br>${esc(d.driver.licenceNumber)} (${d.driver.licenceExpiry})</td>
      <td>${esc(d.driver.vehicle.make)} ${esc(d.driver.vehicle.model)} ${d.driver.vehicle.year}<br>${esc(d.driver.vehicle.reg)}</td>${docCell(d)}<td><select data-dt="${d.id}">${towns.map(t => `<option value="${t.id}" ${t.id === d.townId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td><td><span class="badge">${d.status}</span></td>
      <td>${['approved', 'rejected', 'suspended'].filter(s => s !== d.status).map(s => `<button class="btn sm ${s === 'approved' ? 'green' : 'red'}" data-st="${s}" data-id="${d.id}">${s === 'approved' ? (d.status === 'suspended' ? 'Reinstate' : 'Approve') : s[0].toUpperCase() + s.slice(1, -2)}</button>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="5">No drivers.</td></tr>') + `</table></div>`; },
  async Bookings(el) { const l = await api('/bookings');
    el.innerHTML = `<h2>Bookings</h2><div class="wrap"><table><tr><th>ID</th><th>Passenger</th><th>Driver</th><th>Route</th><th>Status</th><th class="r">Total</th><th>Cancellation</th></tr>` + (l.map(b => `<tr><td>${b.id}</td><td>${esc(b.passenger?.name)}</td><td>${esc(b.driver?.name || '—')}</td><td>${esc(b.fromName)} → ${esc(b.toName)}<br><span class="hint">${typeLabel(b)}</span></td><td>${b.status}</td><td class="r">${money(b.totalC)}</td>
      <td>${b.cancel ? `by ${b.cancel.by}, ${esc(b.cancel.reason || 'no reason')}, fee ${money(b.cancel.feeC)}${b.cancel.waived ? ' (waived)' : b.cancel.feeC ? ` <button class="btn sm ghost" data-w="${b.id}">Waive</button>` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No bookings yet.</td></tr>') + `</table></div>`; },
  async Pricing(el) { const c = await api('/config'), f = (n, l, v, st = 'any') => `<label>${l}</label><input name="${n}" type="number" step="${st}" min="0" value="${v}" required>`;
    el.innerHTML = `<h2>Pricing, commission &amp; cancellation</h2><form id="cfg" style="max-width:420px">${f('base', 'Base fare ($)', c.base)}${f('perKm', 'Private trip per km ($)', c.perKm)}${f('min', 'Minimum fare ($)', c.min)}
      ${f('sharedPerKm', 'Shared trip per km, per passenger ($)', c.sharedPerKm)}${f('packagePerKm', 'Package delivery per km ($)', c.packagePerKm)}
      ${f('serviceFeePct', 'Passenger service fee (%)', c.serviceFeePct)}${f('commissionPct', 'Driver commission (%)', c.commissionPct)}${f('cancelFee', 'Cancellation fee ($)', c.cancelFee)}${f('graceSeconds', 'Free-cancel grace period after acceptance (seconds)', c.graceSeconds)}
      <button class="btn">Save settings</button><p class="hint">Applies to new bookings only. Existing bookings keep the rates they were priced with.</p></form>`;
    $('#cfg').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(Object.entries(form(e.target)).map(([k, x]) => [k, +x]));
      try { await api('/admin/config', 'PUT', { base: v.base, perKm: v.perKm, min: v.min, sharedPerKm: v.sharedPerKm, packagePerKm: v.packagePerKm, serviceFeePct: v.serviceFeePct, commissionPct: v.commissionPct, cancelFee: v.cancelFee, graceSeconds: v.graceSeconds }); toast('Settings saved'); } catch (x) { toast(x.message); } }; },
  async Transactions(el) { const l = await api('/admin/transactions');
    el.innerHTML = `<h2>Transactions <span class="sim">SIMULATED</span></h2><div class="wrap"><table><tr><th>Ref</th><th>Booking</th><th>Method</th><th class="r">Amount</th><th>Status</th><th>Time</th></tr>` + (l.map(t => `<tr><td>${t.ref}</td><td>${t.bookingId}</td><td>${t.method}</td><td class="r">${money(t.amountC)}</td><td>${t.status}</td><td>${new Date(t.at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="6">None yet.</td></tr>') + `</table></div>`; },
  async Revenue(el) { const s = await api('/admin/summary'), k = (l, v) => `<div><span class="hint">${l}</span><b>${v}</b></div>`;
    el.innerHTML = `<h2>Revenue <span class="sim">simulated, paid trips only</span></h2><div class="stat">${k('Paid trips', s.paidTrips)}${k('Gross fares', money(s.grossFareC))}${k('Commission', money(s.commissionC))}${k('Service fees', money(s.feeC))}${k('Platform revenue', money(s.platformRevenueC))}${k('Driver earnings', money(s.driverC))}${k('Passengers paid', money(s.passengerPaidC))}${k('Drivers pending', s.pendingDrivers)}</div>
      <p class="hint">Bookings by status: ${Object.entries(s.byStatus).map(([a, b]) => a + ' ' + b).join(' · ') || 'none'}. Platform revenue is before payment-processing costs, tax and expenses.</p>`; },
  async Towns(el) { const l = await api('/admin/towns');
    el.innerHTML = `<h2>Towns &amp; service areas</h2><p class="hint">Each boundary is a polygon of lat,lng points. The seeded shapes are rough circles for the demo; refine them before launch.</p><div class="wrap"><table><tr><th>Town</th><th>Status</th><th>Points</th><th></th></tr>` +
      l.map(t => `<tr><td>${esc(t.name)}</td><td><span class="badge ${t.active ? 'ok' : 'bad'}">${t.active ? 'active' : 'inactive'}</span></td><td>${t.polygon.length}</td><td><button class="btn sm ghost" data-te="${t.id}">Edit</button> <button class="btn sm ${t.active ? 'red' : 'green'}" data-tt="${t.id}">${t.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') +
      `</table></div><h3>Add or edit a town</h3><form id="tf" style="max-width:520px"><input type="hidden" name="id"><label>Name</label><input name="name" required><label>Boundary: one "lat,lng" per line (3+ lines)</label><textarea name="poly" rows="6" required style="width:100%;background:#0d0d0d;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px"></textarea><button class="btn">Save town</button></form>`;
    $$('[data-tt]', el).forEach(b => b.onclick = async () => { const t = l.find(x => x.id === b.dataset.tt); try { await api('/admin/towns/' + t.id, 'PUT', { active: !t.active }); adminTabs.Towns(el); } catch (x) { toast(x.message); } });
    $$('[data-te]', el).forEach(b => b.onclick = () => { const t = l.find(x => x.id === b.dataset.te), f = $('#tf'); f.id.value = t.id; f.name.value = t.name; f.poly.value = t.polygon.map(p => p.join(',')).join('\n'); f.scrollIntoView({ behavior: 'smooth' }); });
    $('#tf').onsubmit = async e => { e.preventDefault(); const f = form(e.target), polygon = f.poly.split('\n').map(x => x.trim()).filter(Boolean).map(x => x.split(',').map(Number));
      try { await api(f.id ? '/admin/towns/' + f.id : '/admin/towns', f.id ? 'PUT' : 'POST', { name: f.name, polygon }); toast('Town saved'); adminTabs.Towns(el); } catch (x) { toast(x.message); } }; },
  async Safety(el) { const l = await api('/admin/alerts');
    el.innerHTML = `<h2>Safety alerts</h2><div class="wrap"><table><tr><th>Time</th><th>From</th><th>Phone</th><th>Trip</th><th>Status</th></tr>` + (l.map(a => `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${esc(a.by)} (${a.role})</td><td>${esc(a.phone)}${a.emergency ? '<br><span class="hint">Emergency: ' + esc(a.emergency.name) + ' ' + esc(a.emergency.phone) + '</span>' : ''}</td><td>${a.bookingId} · ${esc(a.route)}</td><td>${a.status}</td></tr>`).join('') || '<tr><td colspan="5">No SOS alerts.</td></tr>') + `</table></div>`; },
  async Audit(el) { const l = await api('/admin/audit');
    el.innerHTML = `<h2>Audit log</h2><div class="wrap"><table>` + (l.map(a => `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${esc(a.by)}</td><td>${a.action}</td><td>${esc(a.detail).slice(0, 160)}</td></tr>`).join('') || '<tr><td>No admin actions yet.</td></tr>') + `</table></div>`; }
};
(async () => { await Promise.all([window.mapsReady, new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r))]); const sc = new URLSearchParams(location.search).get('share'); if (sc) { views.share(sc); return; } if (token) { try { me = (await api('/me')).user; } catch { token = null; localStorage.removeItem('zt'); } } home(); })();
