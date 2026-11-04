// Integration tests: starts the real server against a stand-in routing service and a throwaway data folder.
// Run: npm test          (PostgreSQL: DATABASE_URL=postgres://... npm test)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict');
const http = require('http'), os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto'), { spawn } = require('child_process');
const PORT = 3200 + Math.floor(Math.random() * 500), B = `http://127.0.0.1:${PORT}`, SECRET = 'test-webhook-secret';
let srv, osrm, tmp, admin, drv; const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (p, m = 'GET', body, t, h = {}) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error('timeout'); };
const A = { lat: -17.83, lng: 31.05 }, Z = { lat: -17.9, lng: 31.1 }, base = { from: A, to: Z, fromName: 'a', toName: 'b', pay: 'ecocash', type: 'private' };
let n = 0;
async function pax(name = 'Test Pax') { const k = ++n, r = await call('/auth/register', 'POST', { name, phone: '07712' + String(1000 + k), email: `p${k}@x.zw`, password: 'password1' }); const t = r.j.token;
  const s = await call('/auth/phone/send', 'POST', {}, t); await call('/auth/phone/verify', 'POST', { code: s.j.sandboxCode }, t); return t; }
async function drvAccount(townId, email) { const r = await call('/auth/driver-register', 'POST', { name: 'Drv ' + townId, phone: '0772000000', email, password: 'password1', driver: { idNumber: 'F-12345', idExpiry: '2031-01-01', licenceNumber: 'F-DL1', licenceExpiry: '2031-01-01', insuranceNumber: 'INS-1234', insuranceExpiry: '2031-01-01', regBook: 'RB-1', settlement: 'ecocash', townId, docsConfirmed: true, vehicle: { make: 'Honda', model: 'Fit', year: 2018, reg: 'T ' + townId, capacity: 4 } } });
  assert.equal(r.s, 200, JSON.stringify(r.j)); return r.j; }
async function trip(P, D, over = {}) { const bk = await call('/bookings', 'POST', { ...base, ...over }, P); assert.equal(bk.s, 200, JSON.stringify(bk.j)); const id = bk.j.id;
  assert.equal((await call(`/bookings/${id}/accept`, 'POST', null, D)).s, 200); await call(`/bookings/${id}/arrive`, 'POST', null, D);
  assert.equal((await call(`/bookings/${id}/start`, 'POST', { pin: bk.j.pin }, D)).s, 200); assert.equal((await call(`/bookings/${id}/complete`, 'POST', { dcode: bk.j.dcode }, D)).s, 200); return bk.j; }
const sign = o => { const raw = JSON.stringify(o); return { raw, sig: crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }; };
const hook = async (o, bad) => { const { raw, sig } = sign(o); const r = await fetch(B + '/api/webhooks/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ZIMOVA-Signature': bad ? 'x'.repeat(64) : sig }, body: raw }); return r.status; };

before(async () => {
  osrm = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600, geometry: { coordinates: [[31.05, -17.83], [31.1, -17.9]] } }] })); }).listen(0);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zimova-')); const env = { ...process.env, PORT, DATA_DIR: tmp, OSRM_URL: `http://127.0.0.1:${osrm.address().port}`, PAYMENT_WEBHOOK_SECRET: SECRET, SANDBOX_WEBHOOK_MS: '150', RATE_LIMIT: '100000', ADMIN_PASSWORD: 'admin123' };
  delete env.GOOGLE_MAPS_SERVER_KEY; srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  await until(async () => { try { return (await fetch(B + '/healthz')).ok; } catch { return false; } }, 20000);
  admin = (await call('/auth/login', 'POST', { email: 'admin@zimova.test', password: 'admin123' })).j.token; drv = (await call('/auth/login', 'POST', { email: 'driver@zimova.test', password: 'driver123' })).j.token; await call('/driver/online', 'POST', { online: true }, drv);
});
after(() => { srv && srv.kill(); osrm && osrm.close(); });

test('health, security headers, towns', async () => { const r = await fetch(B + '/healthz'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-powered-by'), null); assert.equal((await call('/towns')).j.length, 9); });
test('fares: private $1/km, shared $0.90, package $1; 90/10 split; outside towns refused', async () => { const P = await pax(); const q = await call('/quote', 'POST', { from: A, to: Z }, P);
  assert.deepEqual([q.j.fares.private.totalC, q.j.fares.shared.totalC, q.j.fares.package.totalC, q.j.fares.private.driverC, q.j.fares.private.commissionC], [1000, 900, 1000, 900, 100]);
  assert.equal((await call('/quote', 'POST', { from: { lat: -19, lng: 30 }, to: Z }, P)).s, 422); });
test('booking needs a verified phone', async () => { const r = await call('/auth/register', 'POST', { name: 'No Verify', phone: '0771999999', email: 'nv@x.zw', password: 'password1' }); assert.equal((await call('/bookings', 'POST', base, r.j.token)).s, 403); });
test('OTP: wrong code rejected, right code accepted', async () => { const r = await call('/auth/register', 'POST', { name: 'Otp Pax', phone: '0771888888', email: 'otp@x.zw', password: 'password1' }), t = r.j.token; const s = await call('/auth/phone/send', 'POST', {}, t);
  assert.equal((await call('/auth/phone/verify', 'POST', { code: '000000' }, t)).s, 400); assert.equal((await call('/auth/phone/verify', 'POST', { code: s.j.sandboxCode }, t)).j.user.phoneVerified, true); });
test('driver documents must be verified before approval', async () => { const d = await drvAccount('harare', 'newdrv@x.zw'); const id = d.user.id;
  assert.equal((await call(`/admin/drivers/${id}/status`, 'POST', { status: 'approved' }, admin)).s, 409);
  for (const f of ['id', 'licence', 'vehicle', 'insurance']) await call(`/admin/drivers/${id}/verify`, 'POST', { field: f, value: true }, admin);
  assert.equal((await call(`/admin/drivers/${id}/status`, 'POST', { status: 'approved' }, admin)).s, 200); });
test('town restriction: Bulawayo driver cannot see or accept a Harare request', async () => { const d = await drvAccount('bulawayo', 'byo@x.zw'), id = d.user.id;
  for (const f of ['id', 'licence', 'vehicle', 'insurance']) await call(`/admin/drivers/${id}/verify`, 'POST', { field: f, value: true }, admin); await call(`/admin/drivers/${id}/status`, 'POST', { status: 'approved' }, admin); await call('/driver/online', 'POST', { online: true }, d.token);
  const P = await pax(), bk = await call('/bookings', 'POST', base, P); assert.ok(!(await call('/bookings', 'GET', null, d.token)).j.some(b => b.id === bk.j.id)); assert.equal((await call(`/bookings/${bk.j.id}/accept`, 'POST', null, d.token)).s, 403);
  await call(`/bookings/${bk.j.id}/cancel`, 'POST', {}, P); });
let paidPay, paidBooking, paxA;
test('payment: pending until a signed webhook confirms; duplicates blocked; 90/10 recorded', async () => { paxA = await pax(); const b = await trip(paxA, drv); paidBooking = b.id;
  const [r1, r2] = await Promise.all([call(`/bookings/${b.id}/pay`, 'POST', { method: 'ecocash' }, paxA), call(`/bookings/${b.id}/pay`, 'POST', { method: 'ecocash' }, paxA)]); assert.equal(r1.j.payment.status, 'processing');
  await until(async () => (await call('/bookings/' + b.id, 'GET', null, paxA)).j.payment.status === 'paid');
  const all = (await call('/admin/payments', 'GET', null, admin)).j.filter(p => p.bookingId === b.id); assert.equal(all.length, 1); paidPay = all[0]; assert.deepEqual([paidPay.amountC, paidPay.driverC, paidPay.commissionC, paidPay.status], [1000, 900, 100, 'paid']);
  assert.ok((await call('/notifications', 'GET', null, paxA)).j.items.some(x => x.kind === 'payment')); });
test('webhook security: bad signature, unknown payment, wrong amount, replay', async () => { assert.equal(await hook({ type: 'charge.succeeded', providerRef: paidPay.providerRef, amountC: 1000 }, true), 401); assert.equal(await hook({ type: 'charge.succeeded', providerRef: 'nope', amountC: 1 }), 404);
  assert.equal(await hook({ type: 'charge.succeeded', providerRef: paidPay.providerRef, amountC: 5 }), 422); assert.equal(await hook({ type: 'charge.succeeded', providerRef: paidPay.providerRef, amountC: 1000 }), 200);
  assert.equal((await call('/admin/payments', 'GET', null, admin)).j.filter(p => p.bookingId === paidBooking && p.status === 'paid').length, 1); });
test('failed payment can be retried', async () => { const P = await pax(), b = await trip(P, drv); await call(`/bookings/${b.id}/pay`, 'POST', { method: 'visa', outcome: 'fail' }, P);
  await until(async () => (await call('/bookings/' + b.id, 'GET', null, P)).j.payment.status === 'failed'); await call(`/bookings/${b.id}/pay`, 'POST', { method: 'visa' }, P); await until(async () => (await call('/bookings/' + b.id, 'GET', null, P)).j.payment.status === 'paid'); });
test('driver wallet, payout run, no double payout, reconciliation', async () => { const w = (await call('/driver/wallet', 'GET', null, drv)).j; assert.ok(w.availableC >= 900);
  assert.equal((await call('/admin/payouts/run', 'POST', {}, admin)).j.length >= 1, true); const w2 = (await call('/driver/wallet', 'GET', null, drv)).j; assert.equal(w2.availableC, 0); assert.ok(w2.paidOutC >= 900);
  assert.equal((await call('/admin/payouts/run', 'POST', {}, admin)).j.length, 0); const rc = (await call('/admin/reconciliation', 'GET', null, admin)).j; assert.equal(rc.ok, true, JSON.stringify(rc.issues)); });
test('refund: admin only, once, reverses driver balance (clawback on next payout)', async () => { assert.equal((await call(`/admin/payments/${paidPay.id}/refund`, 'POST', {}, paxA)).s, 403);
  assert.equal((await call(`/admin/payments/${paidPay.id}/refund`, 'POST', { reason: 'test' }, admin)).j.status, 'refunded'); assert.equal((await call(`/admin/payments/${paidPay.id}/refund`, 'POST', {}, admin)).s, 409);
  assert.equal((await call('/bookings/' + paidBooking, 'GET', null, paxA)).j.payment.status, 'refunded'); assert.equal((await call('/driver/wallet', 'GET', null, drv)).j.debtC, 900); });
test('shared rides, package codes, ride for someone else', async () => { const [p1, p2] = [await pax(), await pax()];
  const s1 = await call('/bookings', 'POST', { ...base, type: 'shared', consent: true }, p1), s2 = await call('/bookings', 'POST', { ...base, type: 'shared', consent: true }, p2);
  assert.equal(s1.j.fareC, 900); await call(`/bookings/${s1.j.id}/accept`, 'POST', null, drv); assert.equal((await call('/bookings/' + s2.j.id, 'GET', null, p2)).j.status, 'accepted');
  for (const [s, p] of [[s1, p1], [s2, p2]]) { await call(`/bookings/${s.j.id}/arrive`, 'POST', null, drv); await call(`/bookings/${s.j.id}/start`, 'POST', { pin: s.j.pin }, drv); await call(`/bookings/${s.j.id}/complete`, 'POST', null, drv); }
  const P = await pax(), pk = { senderName: 'S S', senderPhone: '0771111111', recipientName: 'R R', recipientPhone: '0772222222', description: 'Clothes', category: 'clothing', size: 'small', weightKg: 2, noProhibited: true };
  assert.equal((await call('/bookings', 'POST', { ...base, type: 'package', pkg: { ...pk, description: 'petrol' } }, P)).s, 400);
  const b = await call('/bookings', 'POST', { ...base, type: 'package', pkg: pk }, P); await call(`/bookings/${b.j.id}/accept`, 'POST', null, drv); await call(`/bookings/${b.j.id}/arrive`, 'POST', null, drv); await call(`/bookings/${b.j.id}/start`, 'POST', { pin: b.j.pin }, drv);
  assert.equal((await call(`/bookings/${b.j.id}/complete`, 'POST', { dcode: '0000' }, drv)).s, 403); assert.equal((await call(`/bookings/${b.j.id}/complete`, 'POST', { dcode: b.j.dcode }, drv)).s, 200);
  const Q = await pax(), sm = await call('/bookings', 'POST', { ...base, type: 'someone', rider: { name: 'Gogo', phone: '0779999999' } }, Q); assert.equal(sm.s, 200); await call(`/bookings/${sm.j.id}/cancel`, 'POST', {}, Q); });
test('idempotency key prevents duplicate bookings', async () => { const P = await pax(), h = { 'Idempotency-Key': 'k1' }; const a = await call('/bookings', 'POST', base, P, h), b = await call('/bookings', 'POST', base, P, h); assert.equal(a.j.id, b.j.id);
  assert.equal((await call('/bookings', 'POST', base, P)).s, 409); await call(`/bookings/${a.j.id}/cancel`, 'POST', {}, P); });
test('tickets, admin reports, metrics, passenger suspension', async () => { const P = await pax('Ticket Pax'); const t = await call('/tickets', 'POST', { category: 'complaint', text: 'Driver was late' }, P); assert.equal(t.s, 200);
  assert.equal((await call('/admin/tickets/' + t.j.id, 'POST', { status: 'resolved', resolution: 'Apologised' }, admin)).j.status, 'resolved'); assert.ok((await call('/notifications', 'GET', null, P)).j.items.some(x => x.kind === 'support'));
  const r = (await call('/admin/reports?days=7', 'GET', null, admin)).j; assert.equal(r.daily.length, 7); assert.equal((await call('/admin/metrics', 'GET', null, P)).s, 403); assert.ok((await call('/admin/metrics', 'GET', null, admin)).j.uptimeS >= 0);
  const me = (await call('/me', 'GET', null, P)).j.user; await call(`/admin/users/${me.id}/suspend`, 'POST', { suspended: true, reason: 'test' }, admin); assert.equal((await call('/me', 'GET', null, P)).s, 403); });
test('privacy: another passenger cannot read my trip; passenger cannot reach admin APIs', async () => { const a = await pax(), b = await pax(), bk = await call('/bookings', 'POST', base, a); assert.equal((await call('/bookings/' + bk.j.id, 'GET', null, b)).s, 403); assert.equal((await call('/admin/payments', 'GET', null, a)).s, 403); await call(`/bookings/${bk.j.id}/cancel`, 'POST', {}, a); });
