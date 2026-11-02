// ZIMOVA Milestone 1 server. JSON-file storage (demo only) -> replace with PostgreSQL in Milestone 3.
const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path');
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}   // minimal .env loader
const PORT = process.env.PORT || 3000, OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db;
const C = x => Math.round(x * 100);                       // dollars -> integer cents (all money is cents)
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
function addUser(o, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id: 'u' + (++db.seq), salt, hash: hash(pw, salt), createdAt: Date.now(), ...o };
  db.users.push(u); return u;
}
function load() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) { db = JSON.parse(fs.readFileSync(DB_FILE)); return; }
  db = { secret: crypto.randomBytes(32).toString('hex'), seq: 0, users: [], bookings: [], txns: [], audit: [],
    config: { base: 0.5, perKm: 0.4, min: 1.5, mult: { economy: 1, comfort: 1.35, suv: 1.7 },
      serviceFeePct: 5, commissionPct: 5, cancelFee: 0.5, graceSeconds: 120 } };
  addUser({ name: 'ZIMOVA Admin', email: process.env.ADMIN_EMAIL || 'admin@zimova.test', phone: '0000000', role: 'admin' }, process.env.ADMIN_PASSWORD || 'admin123');
  addUser({ name: 'Demo Driver', email: 'driver@zimova.test', phone: '0771000000', role: 'driver', status: 'approved', online: false,
    driver: { idNumber: 'FICTIONAL-001', idExpiry: '2030-01-01', licenceNumber: 'FICTIONAL-DL1', licenceExpiry: '2030-01-01',
      vehicle: { make: 'Toyota', model: 'Aqua', year: 2016, reg: 'DEMO 1234', capacity: 4 }, settlement: 'ecocash', docsConfirmed: true } }, 'driver123');
  save();
}
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const wrap = f => async (req, res) => { try { await f(req, res); } catch (e) { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); } };
const str = (v, min = 1, max = 100) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const pub = ({ salt, hash, ...r }) => ({ ...r, ...(r.townId ? { townName: (db.towns.find(t => t.id === r.townId) || {}).name } : {}) });
// ---- towns / service areas (polygons are [lat,lng] pairs). Seeded shapes are rough ~10-25 km circles for the demo; refine in Admin > Towns.
const circle = (lat, lng, r) => Array.from({ length: 12 }, (_, i) => { const t = i * Math.PI / 6; return [+(lat + r * Math.sin(t)).toFixed(4), +(lng + r * Math.cos(t) / 0.95).toFixed(4)]; });
const SEED_TOWNS = [['Harare', -17.83, 31.05, .25], ['Bulawayo', -20.15, 28.58, .2], ['Mutare', -18.97, 32.67, .12], ['Gweru', -19.45, 29.82, .12], ['Masvingo', -20.07, 30.83, .1],
  ['Kwekwe', -18.93, 29.81, .1], ['Chinhoyi', -17.36, 30.2, .1], ['Karoi', -16.81, 29.69, .08], ['Kariba', -16.52, 28.8, .08]].map(([name, la, ln, r]) => ({ id: name.toLowerCase(), name, active: true, polygon: circle(la, ln, r) }));
function inPoly(p, poly) {   // ray casting
  let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (((yi > p.lat) !== (yj > p.lat)) && p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) c = !c; } return c;
}
const townAt = p => db.towns.find(t => t.active && inPoly(p, t.polygon));
const NOTOWN = 'ZIMOVA does not operate at this pickup location yet. Choose a pickup inside a gold service area on the map.';
function migrate() {   // upgrades older data files in place
  if (!db.towns) db.towns = SEED_TOWNS;
  if (db.config.packagePerKm === undefined && db.config.sharedPerKm !== undefined) db.config.packagePerKm = 1;
  if (db.config.sharedPerKm === undefined) db.config = { base: 0, perKm: 1, sharedPerKm: 0.9, packagePerKm: 1, min: 1, mult: { private: 1 }, serviceFeePct: 0, commissionPct: 10, cancelFee: 0.5, graceSeconds: 120 };
  db.users.forEach(u => { if (u.role === 'driver' && !u.townId) u.townId = 'harare'; });
  db.bookings.forEach(b => { if (!b.townId) { const t = townAt(b.from); b.townId = t ? t.id : 'harare'; } });
  save();
}

// ---- auth: HMAC-signed token, scrypt password hashes, role checks always on the server
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', db.secret).update(b).digest('base64url'); };
function verify(t) {
  const [b, s] = (t || '').split('.'); if (!b || !s) return;
  const e = crypto.createHmac('sha256', db.secret).update(b).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return;
  const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : undefined;
}
const auth = (...roles) => (req, res, next) => {
  const p = verify((req.headers.authorization || '').slice(7)), u = p && db.users.find(x => x.id === p.id);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  if (u.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
  req.user = u; next();
};
const audit = (u, action, detail) => { db.audit.push({ at: Date.now(), by: u.email, action, detail }); };

// ---- fares (server is authoritative)
function fare(km, veh) {
  const c = db.config, rate = { private: c.perKm, shared: c.sharedPerKm, package: c.packagePerKm ?? c.perKm }[veh]; if (rate === undefined) throw bad('Unknown booking type');
  const fareC = Math.max(C(c.base + km * rate), C(c.min));            // multiplier, then minimum fare
  const feeC = Math.round(fareC * c.serviceFeePct / 100), commissionC = Math.round(fareC * c.commissionPct / 100);
  return { km, vehicle: veh, fareC, feeC, totalC: fareC + feeC, commissionC, driverC: fareC - commissionC,   // driver + commission = fare exactly
    rates: { base: c.base, perKm: rate, min: c.min, mult: 1, serviceFeePct: c.serviceFeePct, commissionPct: c.commissionPct } };
}
const inZW = p => p && isFinite(p.lat) && isFinite(p.lng) && p.lat >= -22.6 && p.lat <= -15.5 && p.lng >= 25 && p.lng <= 33.3;
function pts(b) {
  const a = b.from && { lat: +b.from.lat, lng: +b.from.lng }, z = b.to && { lat: +b.to.lat, lng: +b.to.lng };
  if (!inZW(a) || !inZW(z)) throw bad('Pickup and destination must both be inside Zimbabwe'); return [a, z];
}
function decodePoly(str) {   // Google encoded polyline -> [[lng,lat],...]
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) { for (const k of [0, 1]) { let sh = 0, r = 0, c; do { c = str.charCodeAt(i++) - 63; r |= (c & 31) << sh; sh += 5; } while (c >= 32); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (k === 0) lat += d; else lng += d; } out.push([lng / 1e5, lat / 1e5]); }
  return out;
}
async function googleRoute(a, b) {   // Routes API, server-side key only; never sent to the browser
  let j; try { j = await (await fetch(process.env.ROUTES_URL || 'https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_SERVER_KEY, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } }, travelMode: 'DRIVE' }) })).json(); }
  catch { throw bad('Routing service unavailable. No road distance or fare can be confirmed right now.', 502); }
  const r = j.routes && j.routes[0]; if (!r || !r.polyline) throw bad('No road route found between these points.', 422);
  return { km: Math.round(r.distanceMeters / 10) / 100, min: Math.round(parseInt(r.duration) / 60), geometry: decodePoly(r.polyline.encodedPolyline) };
}
async function route(a, b) {
  if (process.env.GOOGLE_MAPS_SERVER_KEY) return googleRoute(a, b);   // real road routing; on failure we error out, never fall back to straight-line
  let j; try { j = await (await fetch(`${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(12000) })).json(); }
  catch { throw bad('Routing service unavailable. No road distance or fare can be confirmed right now.', 502); }
  if (j.code !== 'Ok' || !j.routes?.[0]) throw bad('No road route found between these points (map coverage may be incomplete there).', 422);
  const r = j.routes[0]; return { km: Math.round(r.distance / 10) / 100, min: Math.round(r.duration / 60), geometry: r.geometry.coordinates };
}

const app = express(); app.use(express.json({ limit: '100kb' })); app.use(express.static(path.join(__dirname, 'public')));
const tries = {};
app.post('/api/auth/login', wrap((req, res) => {
  const n = tries[req.ip] = (tries[req.ip] || []).filter(t => t > Date.now() - 6e4);
  if (n.length >= 10) throw bad('Too many attempts. Wait a minute.', 429); n.push(Date.now());
  const u = db.users.find(x => x.email === String(req.body.email || '').toLowerCase().trim());
  const h = u && hash(String(req.body.password || ''), u.salt);
  if (!u || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) throw bad('Wrong email or password', 401);
  if (u.status === 'suspended') throw bad('Account suspended', 403);
  res.json({ token: sign({ id: u.id, exp: Date.now() + 7 * 864e5 }), user: pub(u) });
}));
function register(role) {
  return wrap((req, res) => {
    const b = req.body;
    if (!str(b.name, 2) || !str(b.phone, 7, 20) || !/^\S+@\S+\.\S+$/.test(b.email || '') || !str(b.password, 8)) throw bad('Name, phone, a valid email and a password of 8+ characters are required');
    const email = b.email.toLowerCase().trim(); if (db.users.some(u => u.email === email)) throw bad('That email is already registered', 409);
    const o = { name: b.name.trim(), phone: b.phone.trim(), email, role };
    if (role === 'driver') {
      const d = b.driver || {}, v = d.vehicle || {}, fut = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(s) > new Date();
      if (!str(d.idNumber, 5, 30) || !fut(d.idExpiry) || !str(d.licenceNumber, 4, 30) || !fut(d.licenceExpiry)) throw bad('ID and licence numbers with future expiry dates are required');
      if (!str(v.make, 2, 30) || !str(v.model, 1, 30) || !str(v.reg, 3, 15) || !(+v.capacity >= 1 && +v.capacity <= 14) || !(+v.year >= 1990 && +v.year <= 2027)) throw bad('Complete vehicle details are required');
      if (!['ecocash', 'bank', 'card'].includes(d.settlement)) throw bad('Choose a settlement method');
      const tw = db.towns.find(t => t.id === d.townId && t.active); if (!tw) throw bad('Choose your operating town');
      if (d.docsConfirmed !== true) throw bad('Confirm that the sample (fictional) documents are attached');
      o.status = 'pending'; o.online = false; o.townId = tw.id;
      o.driver = { idNumber: d.idNumber.trim(), idExpiry: d.idExpiry, licenceNumber: d.licenceNumber.trim(), licenceExpiry: d.licenceExpiry,
        vehicle: { make: v.make.trim(), model: v.model.trim(), year: +v.year, reg: v.reg.trim(), capacity: +v.capacity }, settlement: d.settlement, docsConfirmed: true };
    }
    const u = addUser(o, b.password); save(); res.json({ token: sign({ id: u.id, exp: Date.now() + 7 * 864e5 }), user: pub(u) });
  });
}
app.post('/api/auth/register', register('passenger'));
app.post('/api/auth/driver-register', register('driver'));
app.get('/api/me', auth(), (req, res) => res.json({ user: pub(req.user) }));
app.get('/api/config', auth(), (req, res) => res.json(db.config));
app.get('/api/map-config', (req, res) => res.json(process.env.GOOGLE_MAPS_BROWSER_KEY ? { provider: 'google', key: process.env.GOOGLE_MAPS_BROWSER_KEY } : { provider: 'osm' }));
app.post('/api/driver/location', auth('driver'), wrap((req, res) => {   // only accepted while the driver has an active trip
  const p = { lat: +req.body.lat, lng: +req.body.lng }; if (!inZW(p)) throw bad('Location outside Zimbabwe');
  if (!db.bookings.some(b => b.driverId === req.user.id && ['accepted', 'arrived', 'in_progress'].includes(b.status))) { delete LOC[req.user.id]; return res.status(409).json({ error: 'No active trip. Location sharing has stopped.', stop: true }); }
  LOC[req.user.id] = { ...p, at: Date.now() }; res.json({ ok: true });
}));
app.get('/api/towns', (req, res) => res.json(db.towns.filter(t => t.active)));

app.post('/api/quote', auth('passenger'), wrap(async (req, res) => {
  const [a, z] = pts(req.body), tn = townAt(a); if (!tn) throw bad(NOTOWN, 422);
  const r = await route(a, z);
  res.json({ ...r, town: tn.name, fares: Object.fromEntries(['private', 'shared', 'package'].map(v => [v, fare(r.km, v)])) });
}));

// ---- bookings
const drvRating = id => { const r = db.bookings.filter(b => b.driverId === id && b.rating).map(b => b.rating.stars); return r.length ? { avg: Math.round(r.reduce((a, c) => a + c, 0) / r.length * 10) / 10, count: r.length } : null; };
const LOC = {};   // live driver positions, memory only, exist only while a trip is active
const liveLoc = b => ['accepted', 'arrived', 'in_progress'].includes(b.status) && b.driverId && LOC[b.driverId] && Date.now() - LOC[b.driverId].at < 120000 ? LOC[b.driverId] : null;
const LIVE = ['searching', 'accepted', 'arrived', 'in_progress'];
const bk = id => db.bookings.find(b => b.id === id) || (() => { throw bad('Booking not found', 404); })();
function view(b, full) {
  const { geometry, pin, dcode, ...r } = b, d = b.driverId && db.users.find(u => u.id === b.driverId), p = db.users.find(u => u.id === b.passengerId);
  const offers = (b.counteroffers || (b.counteroffer ? [b.counteroffer] : [])).map(co => { const cu = db.users.find(x => x.id === co.driverId); return { id: co.id || String(co.driverId), amountC: co.amountC, status: co.status, at: co.at, driver: cu ? { name: cu.name, rating: drvRating(cu.id), vehicle: cu.driver.vehicle } : null }; });
  return { ...(full ? (({ pin, dcode, ...x }) => x)(b) : r), driver: d && { name: d.name, phone: d.phone, vehicle: d.driver.vehicle, rating: drvRating(d.id) }, passenger: p && { name: b.type === 'shared' ? p.name.split(' ')[0] : p.name }, driverLoc: liveLoc(b), counteroffer: offers.find(x => x.status === 'pending') || null, counteroffers: offers };
}

function passengerView(b, full = false) {
  const r = view(b, full);
  // These values are internal settlement data and must never be sent to a passenger.
  delete r.driverC;
  delete r.commissionC;
  if (r.rates) {
    r.rates = { ...r.rates };
    delete r.rates.commissionPct;
  }
  return r;
}
// ---- booking types: private | shared | package | someone (ride for someone else)
const PROHIBITED = /\b(gun|firearm|pistol|rifle|ammo|ammunition|explosive|bomb|grenade|dynamite|fireworks|drug|cocaine|heroin|marijuana|cannabis|dagga|mbanje|poison|acid|petrol|diesel|fuel|weapon|knife)s?\b/i;
const CATS = ['documents', 'clothing', 'food', 'electronics', 'groceries', 'other'], SIZES = ['small', 'medium', 'large'];
function validateExtra(type, b) {
  if (type === 'someone') { const r = b.rider || {}; if (!str(r.name, 2, 60) || !str(r.phone, 7, 20)) throw bad("Enter the passenger's name and phone number"); return { rider: { name: r.name.trim(), phone: r.phone.trim() } }; }
  if (type === 'shared') { if (b.consent !== true) throw bad('Please agree to share the vehicle with other passengers'); return { sharedConsentAt: Date.now() }; }
  if (type === 'package') {
    const p = b.pkg || {}, w = +p.weightKg;
    if (!str(p.senderName, 2, 60) || !str(p.senderPhone, 7, 20) || !str(p.recipientName, 2, 60) || !str(p.recipientPhone, 7, 20)) throw bad('Sender and recipient names and phone numbers are required');
    if (!str(p.description, 3, 200)) throw bad('Describe what is in the package');
    if (!CATS.includes(p.category) || !SIZES.includes(p.size) || !(w > 0 && w <= 50)) throw bad('Choose a category, a size and a weight up to 50 kg');
    if (p.noProhibited !== true || PROHIBITED.test(p.description + ' ' + (p.instructions || ''))) throw bad('Dangerous or illegal items (weapons, drugs, explosives, fuel, poisons) cannot be sent with ZIMOVA');
    return { pkg: { senderName: p.senderName.trim(), senderPhone: p.senderPhone.trim(), recipientName: p.recipientName.trim(), recipientPhone: p.recipientPhone.trim(), description: p.description.trim(),
      category: p.category, size: p.size, weightKg: w, instructions: String(p.instructions || '').slice(0, 200) }, dcode: String(crypto.randomInt(1000, 10000)) };
  }
  return {};
}
const hav = (p, q) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(q.lat - p.lat), dn = r(q.lng - p.lng), h = Math.sin(dl / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const OPEN = ['searching', 'accepted', 'arrived'];
function matchGroup(a, z, townId) {   // compatible route: pickups within 3 km, destinations within 5 km, same town, seats left
  for (const c of db.bookings.filter(x => x.type === 'shared' && x.townId === townId && OPEN.includes(x.status) && hav(x.from, a) <= 3 && hav(x.to, z) <= 5)) {
    const mem = db.bookings.filter(x => x.groupId === c.groupId && OPEN.includes(x.status)), withDrv = mem.find(m => m.driverId);
    const cap = withDrv ? db.users.find(u => u.id === withDrv.driverId).driver.vehicle.capacity - 1 : 3;
    if (mem.length < cap) return { gid: c.groupId, driverId: withDrv && withDrv.driverId };
  }
}
app.post('/api/bookings', auth('passenger'), wrap(async (req, res) => {
  const [a, z] = pts(req.body), b = req.body, tn = townAt(a); if (!tn) throw bad(NOTOWN, 422);
  if (!['ecocash', 'visa', 'mastercard'].includes(b.pay)) throw bad('Choose a payment method');
  if (db.bookings.some(x => x.passengerId === req.user.id && LIVE.includes(x.status))) throw bad('You already have an active booking', 409);
  const type = ['private', 'shared', 'package', 'someone'].includes(b.type) ? b.type : 'private', extra = validateExtra(type, b);
  const r = await route(a, z), f = fare(r.km, type === 'someone' ? 'private' : type);        // fare recomputed on the server, browser values ignored
  // Passenger may propose a fair price. Drivers see this offer before accepting; server validates it.
  const offerC = b.offerC == null ? f.totalC : Math.round(+b.offerC);
  if (!Number.isFinite(offerC) || offerC < Math.round(f.totalC * 0.5) || offerC > Math.round(f.totalC * 2)) throw bad('Your offer must be between 50% and 200% of the suggested fare.');
  f.fareC = Math.max(0, offerC - f.feeC); f.totalC = offerC; f.commissionC = Math.round(f.fareC * db.config.commissionPct / 100); f.driverC = f.fareC - f.commissionC;
  const bo = { id: 'b' + (++db.seq), offerC, suggestedFareC: fare(r.km, type === 'someone' ? 'private' : type).totalC, passengerId: req.user.id, from: a, to: z, fromName: String(b.fromName || '').slice(0, 120), toName: String(b.toName || '').slice(0, 120),
    status: 'searching', type, ...extra, townId: tn.id, pin: String(crypto.randomInt(1000, 10000)), etaMin: r.min, geometry: r.geometry, ...f, payment: { status: 'unpaid', method: b.pay, simulated: true }, createdAt: Date.now() };
  if (type === 'shared') { const m = matchGroup(a, z, tn.id); bo.groupId = m ? m.gid : bo.id; if (m && m.driverId) { bo.driverId = m.driverId; bo.acceptedAt = Date.now(); bo.status = 'accepted'; } }
  db.bookings.push(bo); save(); res.json({ ...passengerView(bo), pin: bo.pin, dcode: bo.dcode });
}));
app.get('/api/bookings', auth(), (req, res) => {
  const u = req.user; let l = db.bookings;
  if (u.role === 'passenger') l = l.filter(b => b.passengerId === u.id);
  else if (u.role === 'driver') l = l.filter(b => b.driverId === u.id || (b.status === 'searching' && u.status === 'approved' && b.townId === u.townId));
  res.json(l.slice().sort((a, b) => b.createdAt - a.createdAt).map(b => u.role === 'passenger' ? { ...passengerView(b), pin: b.pin, dcode: b.dcode } : view(b)));
});
app.get('/api/bookings/:id', auth(), wrap((req, res) => {
  const b = bk(req.params.id), u = req.user;
  const ok = u.role === 'admin' || b.passengerId === u.id || b.driverId === u.id || (u.role === 'driver' && u.status === 'approved' && b.status === 'searching' && b.townId === u.townId);
  if (!ok) throw bad('Not allowed', 403); res.json(u.role === 'passenger' ? { ...passengerView(b, true), pin: b.pin, dcode: b.dcode } : view(b, true));
}));
const T = { accept: ['searching', 'accepted'], arrive: ['accepted', 'arrived'], start: ['arrived', 'in_progress'], complete: ['in_progress', 'completed'] };
// Multiple drivers may independently submit one counteroffer each. Passenger chooses one.
app.post('/api/bookings/:id/counteroffer', auth('driver'), wrap((req, res) => {
  const b = bk(req.params.id), u = req.user, amountC = Math.round(Number(req.body.amountC));
  if (b.status !== 'searching' || b.driverId) throw bad('This request is no longer available', 409);
  if (u.status !== 'approved' || !u.online || u.townId !== b.townId) throw bad('You must be an approved, online driver in the pickup town', 403);
  if (db.bookings.some(x => x.driverId === u.id && ['accepted', 'arrived', 'in_progress'].includes(x.status))) throw bad('Finish your current trip first', 409);
  if (!Number.isFinite(amountC) || amountC < Math.round(b.suggestedFareC * 0.5) || amountC > Math.round(b.suggestedFareC * 2)) throw bad('Counteroffer must be between 50% and 200% of the suggested fare');
  b.counteroffers = b.counteroffers || (b.counteroffer ? [b.counteroffer] : []);
  const prior = b.counteroffers.find(x => x.driverId === u.id);
  if (prior) { prior.amountC = amountC; prior.at = Date.now(); prior.status = 'pending'; }
  else b.counteroffers.push({ id: 'co' + (++db.seq), driverId: u.id, amountC, at: Date.now(), status: 'pending' });
  delete b.counteroffer; save(); res.json({ ok: true, offers: b.counteroffers.length });
}));
app.post('/api/bookings/:id/counteroffer/respond', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id), choice = req.body.choice, offerId = String(req.body.offerId || '');
  if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  b.counteroffers = b.counteroffers || (b.counteroffer ? [b.counteroffer] : []);
  const co = b.counteroffers.find(x => (x.id || String(x.driverId)) === offerId && x.status === 'pending');
  if (b.status !== 'searching' || !co) throw bad('That driver offer is no longer available', 409);
  if (choice === 'accept') {
    const driver = db.users.find(u => u.id === co.driverId);
    if (!driver || driver.status !== 'approved' || !driver.online || driver.townId !== b.townId) throw bad('That driver is no longer available', 409);
    const totalC = co.amountC, feeC = Math.round((b.feeC || 0));
    b.totalC = totalC; b.fareC = Math.max(0, totalC - feeC); b.commissionC = Math.round(b.fareC * db.config.commissionPct / 100); b.driverC = b.fareC - b.commissionC;
    b.offerC = totalC; b.driverId = driver.id; b.acceptedAt = Date.now(); b.status = 'accepted'; co.status = 'accepted';
    b.counteroffers.forEach(x => { if (x !== co && x.status === 'pending') x.status = 'closed'; });
  } else if (choice === 'decline') { co.status = 'declined'; co.respondedAt = Date.now(); } else throw bad('Choose accept or decline');
  save(); res.json({ ...passengerView(b), pin: b.pin, dcode: b.dcode });
}));
app.post('/api/bookings/:id/:action(accept|arrive|start|complete)', auth('driver'), wrap((req, res) => {
  const a = req.params.action, b = bk(req.params.id), [from, to] = T[a], u = req.user;
  if (b.status !== from) throw bad(`Booking is "${b.status}"; cannot ${a}`, 409);   // blocks invalid / duplicate transitions
  if (a === 'accept') {
    if ((b.counteroffers || (b.counteroffer ? [b.counteroffer] : [])).some(co => co.status === 'pending')) throw bad('The passenger is comparing driver offers; wait for their decision', 409);
    if (u.status !== 'approved') throw bad('Only approved drivers can accept rides', 403);
    if (!u.online) throw bad('Go online first', 409);
    if (b.townId !== u.townId) throw bad('This pickup is outside your approved town', 403);
    if (db.bookings.some(x => x.driverId === u.id && ['accepted', 'arrived', 'in_progress'].includes(x.status))) throw bad('Finish your current trip first', 409);
    b.driverId = u.id; b.acceptedAt = Date.now();
    if (b.type === 'shared') { const cap = Math.max(u.driver.vehicle.capacity - 1, 1);   // passengers who matched the same route ride together
      db.bookings.filter(x => x !== b && x.groupId === b.groupId && x.status === 'searching' && x.townId === u.townId).forEach((x, i) => { if (i + 2 <= cap) { x.driverId = u.id; x.acceptedAt = Date.now(); x.status = 'accepted'; } else x.groupId = x.id; }); }
  } else if (b.driverId !== u.id) throw bad('Not your trip', 403);
  if (a === 'start' && b.pin && String(req.body.pin || '') !== b.pin) throw bad('Incorrect ride PIN. Ask the passenger for their 4-digit PIN.', 403);   // trust: right driver, right passenger
  if (a === 'complete' && b.type === 'package' && String(req.body.dcode || '') !== b.dcode) throw bad('Incorrect delivery code. Ask the recipient for their 4-digit code.', 403);
  b.status = to; if (a === 'complete') { b.completedAt = Date.now(); if (!db.bookings.some(x => x !== b && x.driverId === u.id && ['accepted', 'arrived', 'in_progress'].includes(x.status))) delete LOC[u.id]; b.payment = { ...b.payment, status: 'pending' }; }
  save(); res.json(view(b));
}));
const cancelFee = b => b.status === 'searching' ? 0 : (Date.now() - b.acceptedAt <= db.config.graceSeconds * 1000 ? 0 : C(db.config.cancelFee));
app.get('/api/bookings/:id/cancel-fee', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id); if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  res.json({ feeC: ['searching', 'accepted', 'arrived'].includes(b.status) ? cancelFee(b) : 0, graceSeconds: db.config.graceSeconds });
}));
app.post('/api/bookings/:id/cancel', auth('passenger', 'driver'), wrap((req, res) => {
  const b = bk(req.params.id), u = req.user, reason = String(req.body.reason || '').slice(0, 200);
  if (!['searching', 'accepted', 'arrived'].includes(b.status)) throw bad('This booking can no longer be cancelled', 409);
  if (u.role === 'passenger') {
    if (b.passengerId !== u.id) throw bad('Not allowed', 403);
    const feeC = cancelFee(b);
    b.status = 'cancelled'; b.cancel = { by: 'passenger', at: Date.now(), reason, feeC, waived: false, payment: feeC ? 'owed (simulated, not charged)' : 'n/a' };
  } else {                                              // driver cancels: no passenger fee, ride goes back to the pool
    if (b.driverId !== u.id) throw bad('Not allowed', 403);
    (b.cancelLog = b.cancelLog || []).push({ by: 'driver', at: Date.now(), reason, feeC: 0 });
    b.status = 'searching'; b.driverId = null; b.acceptedAt = null;
  }
  save(); res.json(u.role === 'passenger' ? passengerView(b) : view(b));
}));
app.post('/api/bookings/:id/pay', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id); if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  if (b.status !== 'completed') throw bad('Trip is not completed', 409);
  if (b.payment.status === 'paid') return res.json(passengerView(b));            // idempotent: never pay twice
  if (!['ecocash', 'visa', 'mastercard'].includes(req.body.method)) throw bad('Choose a payment method');
  const ok = req.body.outcome !== 'fail', ref = 'SIM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  b.payment = { status: ok ? 'paid' : 'failed', method: req.body.method, ref, at: Date.now(), amountC: b.totalC, simulated: true };
  db.txns.push({ ref, bookingId: b.id, method: req.body.method, amountC: b.totalC, status: b.payment.status, at: Date.now(), simulated: true });
  save(); res.json(passengerView(b));
}));

// ---- trust & safety: rating, share-trip link, SOS
app.post('/api/bookings/:id/rate', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id), n = Math.round(+req.body.stars);
  if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  if (b.status !== 'completed') throw bad('You can rate a driver after the trip is completed', 409);
  if (b.rating) throw bad('You already rated this trip', 409);
  if (!(n >= 1 && n <= 5)) throw bad('Choose 1 to 5 stars');
  b.rating = { stars: n, comment: String(req.body.comment || '').slice(0, 200), at: Date.now() }; save(); res.json(passengerView(b));
}));
app.post('/api/bookings/:id/share', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id); if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  b.shareCode = b.shareCode || crypto.randomBytes(8).toString('hex'); save(); res.json({ code: b.shareCode });
}));
app.get('/api/share/:code', wrap((req, res) => {   // public, read-only, unguessable link
  const b = db.bookings.find(x => x.shareCode && x.shareCode === req.params.code); if (!b) throw bad('Link not found', 404);
  const d = b.driverId && db.users.find(u => u.id === b.driverId);
  res.json({ status: b.status, fromName: b.fromName, toName: b.toName, from: b.from, to: b.to, geometry: b.geometry, etaMin: b.etaMin, driverLoc: liveLoc(b), driver: d && { name: d.name.split(' ')[0], vehicle: d.driver.vehicle } });
}));
app.post('/api/bookings/:id/sos', auth('passenger', 'driver'), wrap((req, res) => {
  const b = bk(req.params.id), u = req.user; if (b.passengerId !== u.id && b.driverId !== u.id) throw bad('Not allowed', 403);
  (db.alerts = db.alerts || []).push({ at: Date.now(), by: u.name, role: u.role, phone: u.phone, bookingId: b.id, route: b.fromName + ' → ' + b.toName, status: b.status });
  save(); res.json({ ok: true });
}));

// ---- driver
app.post('/api/driver/online', auth('driver'), wrap((req, res) => {
  if (req.user.status !== 'approved') throw bad('Your account is ' + req.user.status + '. Only approved drivers can go online.', 403);
  req.user.online = !!req.body.online; save(); res.json({ online: req.user.online });
}));
app.get('/api/driver/earnings', auth('driver'), (req, res) => {
  const t = db.bookings.filter(b => b.driverId === req.user.id && b.status === 'completed').sort((a, b) => b.completedAt - a.completedAt);
  const sum = l => ({ trips: l.length, fareC: l.reduce((s, b) => s + b.fareC, 0), commissionC: l.reduce((s, b) => s + b.commissionC, 0), netC: l.reduce((s, b) => s + b.driverC, 0) });
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const m0 = new Date(d0); m0.setDate(1);
  res.json({ rating: drvRating(req.user.id), today: sum(t.filter(b => b.completedAt >= d0)), month: sum(t.filter(b => b.completedAt >= m0)), all: sum(t), trips: t.slice(0, 20).map(b => view(b)) });
});

// ---- admin
const A = auth('admin');
app.get('/api/admin/drivers', A, (req, res) => res.json(db.users.filter(u => u.role === 'driver').map(pub)));
app.post('/api/admin/drivers/:id/status', A, wrap((req, res) => {
  const u = db.users.find(x => x.id === req.params.id && x.role === 'driver'); if (!u) throw bad('Driver not found', 404);
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(req.body.status)) throw bad('Invalid status');
  u.status = req.body.status; if (u.status !== 'approved') u.online = false;
  audit(req.user, 'driver_status', `${u.email} -> ${u.status}`); save(); res.json(pub(u));
}));
app.put('/api/admin/config', A, wrap((req, res) => {
  const n = req.body, ok = (v, lo = 0, hi = 1e6) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
  if (!ok(n.base) || !ok(n.perKm) || !ok(n.sharedPerKm) || !ok(n.packagePerKm) || !ok(n.min) || !ok(n.serviceFeePct, 0, 50) || !ok(n.commissionPct, 0, 50) || !ok(n.cancelFee) || !ok(n.graceSeconds, 0, 3600)) throw bad('Invalid pricing values');
  const old = JSON.stringify(db.config); db.config = { ...db.config, ...n, mult: db.config.mult };
  audit(req.user, 'config_change', `${old} -> ${JSON.stringify(db.config)}`); save(); res.json(db.config);   // past bookings keep the rates they were priced with
}));
app.post('/api/admin/bookings/:id/waive', A, wrap((req, res) => {
  const b = bk(req.params.id); if (!b.cancel || !b.cancel.feeC) throw bad('No cancellation fee on this booking', 409);
  b.cancel.waived = true; audit(req.user, 'waive_cancel_fee', b.id); save(); res.json(view(b));
}));
app.get('/api/admin/transactions', A, (req, res) => res.json(db.txns.slice().reverse()));
app.get('/api/admin/audit', A, (req, res) => res.json(db.audit.slice().reverse().slice(0, 50)));
app.get('/api/admin/summary', A, (req, res) => {
  const paid = db.bookings.filter(b => b.status === 'completed' && b.payment.status === 'paid'), s = k => paid.reduce((t, b) => t + b[k], 0);
  const by = {}; db.bookings.forEach(b => by[b.status] = (by[b.status] || 0) + 1);
  res.json({ byStatus: by, paidTrips: paid.length, grossFareC: s('fareC'), feeC: s('feeC'), commissionC: s('commissionC'), driverC: s('driverC'),
    platformRevenueC: s('feeC') + s('commissionC'), passengerPaidC: s('totalC'), pendingDrivers: db.users.filter(u => u.role === 'driver' && u.status === 'pending').length });
});

const parsePoly = p => { if (!Array.isArray(p) || p.length < 3 || p.length > 200) throw bad('A boundary needs 3 to 200 points');
  return p.map(q => { const la = +q[0], ln = +q[1]; if (!inZW({ lat: la, lng: ln })) throw bad('Boundary points must be inside Zimbabwe (lat,lng)'); return [la, ln]; }); };
app.get('/api/admin/towns', A, (req, res) => res.json(db.towns));
app.post('/api/admin/towns', A, wrap((req, res) => {
  const b = req.body; if (!str(b.name, 2, 40)) throw bad('Town name required'); const polygon = parsePoly(b.polygon);
  let id = b.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-'); if (db.towns.some(t => t.id === id)) id += '-' + Date.now().toString(36);
  const t = { id, name: b.name.trim(), active: true, polygon }; db.towns.push(t); audit(req.user, 'town_add', t.name); save(); res.json(t);
}));
app.put('/api/admin/towns/:id', A, wrap((req, res) => {
  const t = db.towns.find(x => x.id === req.params.id), b = req.body; if (!t) throw bad('Town not found', 404);
  if (b.name !== undefined) { if (!str(b.name, 2, 40)) throw bad('Town name required'); t.name = b.name.trim(); }
  if (b.polygon !== undefined) t.polygon = parsePoly(b.polygon);
  if (b.active !== undefined) t.active = !!b.active;
  audit(req.user, 'town_edit', `${t.name} active=${t.active} points=${t.polygon.length}`); save(); res.json(t);
}));
app.post('/api/admin/drivers/:id/town', A, wrap((req, res) => {
  const u = db.users.find(x => x.id === req.params.id && x.role === 'driver'), t = db.towns.find(x => x.id === req.body.townId);
  if (!u || !t) throw bad('Driver or town not found', 404); u.townId = t.id; audit(req.user, 'driver_town', `${u.email} -> ${t.name}`); save(); res.json(pub(u));
}));
app.get('/api/admin/alerts', A, (req, res) => res.json((db.alerts || []).slice().reverse().slice(0, 50)));

load(); migrate(); app.listen(PORT, () => console.log(`ZIMOVA running at http://localhost:${PORT}\nAdmin: admin@zimova.test / admin123   Driver: driver@zimova.test / driver123 (change in .env)`));
