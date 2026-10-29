// ZIMOVA Milestone 1 server. JSON-file storage (demo only) -> replace with PostgreSQL in Milestone 3.
const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path');
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
const pub = ({ salt, hash, ...r }) => r;

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
  const c = db.config, m = c.mult[veh]; if (!m) throw bad('Unknown vehicle category');
  const fareC = Math.max(C((c.base + km * c.perKm) * m), C(c.min));            // multiplier, then minimum fare
  const feeC = Math.round(fareC * c.serviceFeePct / 100), commissionC = Math.round(fareC * c.commissionPct / 100);
  return { km, vehicle: veh, fareC, feeC, totalC: fareC + feeC, commissionC, driverC: fareC - commissionC,   // driver + commission = fare exactly
    rates: { base: c.base, perKm: c.perKm, min: c.min, mult: m, serviceFeePct: c.serviceFeePct, commissionPct: c.commissionPct } };
}
const inZW = p => p && isFinite(p.lat) && isFinite(p.lng) && p.lat >= -22.6 && p.lat <= -15.5 && p.lng >= 25 && p.lng <= 33.3;
function pts(b) {
  const a = b.from && { lat: +b.from.lat, lng: +b.from.lng }, z = b.to && { lat: +b.to.lat, lng: +b.to.lng };
  if (!inZW(a) || !inZW(z)) throw bad('Pickup and destination must both be inside Zimbabwe'); return [a, z];
}
async function route(a, b) {   // real road routing; on failure we error out, never fall back to straight-line
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
      if (d.docsConfirmed !== true) throw bad('Confirm that the sample (fictional) documents are attached');
      o.status = 'pending'; o.online = false;
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

app.post('/api/quote', auth('passenger'), wrap(async (req, res) => {
  const [a, z] = pts(req.body), r = await route(a, z);
  res.json({ ...r, fares: Object.fromEntries(Object.keys(db.config.mult).map(v => [v, fare(r.km, v)])) });
}));

// ---- bookings
const LIVE = ['searching', 'accepted', 'arrived', 'in_progress'];
const bk = id => db.bookings.find(b => b.id === id) || (() => { throw bad('Booking not found', 404); })();
function view(b, full) {
  const { geometry, ...r } = b, d = b.driverId && db.users.find(u => u.id === b.driverId), p = db.users.find(u => u.id === b.passengerId);
  return { ...(full ? b : r), driver: d && { name: d.name, phone: d.phone, vehicle: d.driver.vehicle }, passenger: p && { name: p.name } };
}
app.post('/api/bookings', auth('passenger'), wrap(async (req, res) => {
  const [a, z] = pts(req.body), b = req.body;
  if (!['ecocash', 'visa', 'mastercard'].includes(b.pay)) throw bad('Choose a payment method');
  if (db.bookings.some(x => x.passengerId === req.user.id && LIVE.includes(x.status))) throw bad('You already have an active booking', 409);
  const r = await route(a, z), f = fare(r.km, b.vehicle);        // fare recomputed on the server, browser values ignored
  const bo = { id: 'b' + (++db.seq), passengerId: req.user.id, from: a, to: z, fromName: String(b.fromName || '').slice(0, 120), toName: String(b.toName || '').slice(0, 120),
    status: 'searching', etaMin: r.min, geometry: r.geometry, ...f, payment: { status: 'unpaid', method: b.pay, simulated: true }, createdAt: Date.now() };
  db.bookings.push(bo); save(); res.json(view(bo));
}));
app.get('/api/bookings', auth(), (req, res) => {
  const u = req.user; let l = db.bookings;
  if (u.role === 'passenger') l = l.filter(b => b.passengerId === u.id);
  else if (u.role === 'driver') l = l.filter(b => b.driverId === u.id || (b.status === 'searching' && u.status === 'approved'));
  res.json(l.slice().sort((a, b) => b.createdAt - a.createdAt).map(b => view(b)));
});
app.get('/api/bookings/:id', auth(), wrap((req, res) => {
  const b = bk(req.params.id), u = req.user;
  const ok = u.role === 'admin' || b.passengerId === u.id || b.driverId === u.id || (u.role === 'driver' && u.status === 'approved' && b.status === 'searching');
  if (!ok) throw bad('Not allowed', 403); res.json(view(b, true));
}));
const T = { accept: ['searching', 'accepted'], arrive: ['accepted', 'arrived'], start: ['arrived', 'in_progress'], complete: ['in_progress', 'completed'] };
app.post('/api/bookings/:id/:action(accept|arrive|start|complete)', auth('driver'), wrap((req, res) => {
  const a = req.params.action, b = bk(req.params.id), [from, to] = T[a], u = req.user;
  if (b.status !== from) throw bad(`Booking is "${b.status}"; cannot ${a}`, 409);   // blocks invalid / duplicate transitions
  if (a === 'accept') {
    if (u.status !== 'approved') throw bad('Only approved drivers can accept rides', 403);
    if (!u.online) throw bad('Go online first', 409);
    if (db.bookings.some(x => x.driverId === u.id && ['accepted', 'arrived', 'in_progress'].includes(x.status))) throw bad('Finish your current trip first', 409);
    b.driverId = u.id; b.acceptedAt = Date.now();
  } else if (b.driverId !== u.id) throw bad('Not your trip', 403);
  b.status = to; if (a === 'complete') { b.completedAt = Date.now(); b.payment = { ...b.payment, status: 'pending' }; }
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
  save(); res.json(view(b));
}));
app.post('/api/bookings/:id/pay', auth('passenger'), wrap((req, res) => {
  const b = bk(req.params.id); if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
  if (b.status !== 'completed') throw bad('Trip is not completed', 409);
  if (b.payment.status === 'paid') return res.json(view(b));            // idempotent: never pay twice
  if (!['ecocash', 'visa', 'mastercard'].includes(req.body.method)) throw bad('Choose a payment method');
  const ok = req.body.outcome !== 'fail', ref = 'SIM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  b.payment = { status: ok ? 'paid' : 'failed', method: req.body.method, ref, at: Date.now(), amountC: b.totalC, simulated: true };
  db.txns.push({ ref, bookingId: b.id, method: req.body.method, amountC: b.totalC, status: b.payment.status, at: Date.now(), simulated: true });
  save(); res.json(view(b));
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
  res.json({ today: sum(t.filter(b => b.completedAt >= d0)), month: sum(t.filter(b => b.completedAt >= m0)), all: sum(t), trips: t.slice(0, 20).map(b => view(b)) });
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
  if (!ok(n.base) || !ok(n.perKm) || !ok(n.min) || !ok(n.serviceFeePct, 0, 50) || !ok(n.commissionPct, 0, 50) || !ok(n.cancelFee) || !ok(n.graceSeconds, 0, 3600)) throw bad('Invalid pricing values');
  if (!n.mult || !Object.keys(db.config.mult).every(k => ok(n.mult[k], 0.1, 10))) throw bad('Invalid vehicle multipliers');
  const old = JSON.stringify(db.config); db.config = { ...db.config, ...n, mult: { ...n.mult } };
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

load(); app.listen(PORT, () => console.log(`ZIMOVA running at http://localhost:${PORT}\nAdmin: admin@zimova.test / admin123   Driver: driver@zimova.test / driver123 (change in .env)`));
