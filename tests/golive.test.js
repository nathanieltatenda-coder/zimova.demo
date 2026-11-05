// Tests for real-use setup: no demo accounts, strong admin required, password change/reset, test-mode honesty, go-live cleanup script.
const { test, after } = require('node:test'), assert = require('node:assert/strict');
const os = require('os'), path = require('path'), fs = require('fs'), { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms)), procs = [], created = [];
const baseEnv = { ...process.env, RATE_LIMIT: '100000', PAYMENT_WEBHOOK_SECRET: 'x' }; delete baseEnv.SEED_DEMO; delete baseEnv.DATABASE_URL; delete baseEnv.ADMIN_EMAIL; delete baseEnv.ADMIN_PASSWORD;
async function start(env, dir) {
  const port = 4300 + Math.floor(Math.random() * 600), tmp = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'zg-')), B = `http://127.0.0.1:${port}`;
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...baseEnv, PORT: port, DATA_DIR: tmp, ...env }, stdio: ['ignore', 'ignore', 'pipe'] }); procs.push(p); let err = ''; p.stderr.on('data', d => err += d); let exited = null; p.on('exit', c => exited = c);
  for (let i = 0; i < 80 && exited === null; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch {} await sleep(150); }
  const call = async (u, m = 'GET', body, t) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  return { B, call, tmp, p, exitCode: () => exited, err: () => err, stop: () => new Promise(r => { if (exited !== null) return r(); p.once('exit', r); p.kill(); }) };
}
after(() => procs.forEach(p => p.kill()));
const ADMIN = { ADMIN_EMAIL: 'owner@zimova.co.zw', ADMIN_PASSWORD: 'Str0ngOwnerPass' };

test('first start refuses to run without a real admin email and strong password', async () => {
  for (const env of [{}, { ADMIN_EMAIL: 'owner@zimova.co.zw', ADMIN_PASSWORD: 'password123' }, { ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: 'Str0ngOwnerPass' }, { ADMIN_EMAIL: 'owner@zimova.co.zw', ADMIN_PASSWORD: 'short1' }]) {
    const s = await start(env); await sleep(500); assert.equal(s.exitCode(), 1, JSON.stringify(env)); assert.match(s.err(), /First start/); } });
test('no demo accounts exist; the owner account works', async () => {
  const s = await start(ADMIN); const a = await s.call('/auth/login', 'POST', { email: 'owner@zimova.co.zw', password: 'Str0ngOwnerPass' }); assert.equal(a.s, 200); assert.equal(a.j.user.role, 'admin');
  for (const [email, password] of [['admin@zimova.test', 'admin123'], ['driver@zimova.test', 'driver123']]) assert.equal((await s.call('/auth/login', 'POST', { email, password })).s, 401);
  assert.equal((await s.call('/admin/passengers', 'GET', null, a.j.token)).j.length, 0); assert.equal((await s.call('/towns')).j.length, 9);
  const si = await s.call('/admin/setup', 'GET', null, a.j.token); assert.ok(si.j.some(c => c.key === 'pay' && c.ok === false), 'payments should be flagged as test mode'); });
test('changing the password signs out other devices', async () => {
  const s = await start(ADMIN), login = pw => s.call('/auth/login', 'POST', { email: 'owner@zimova.co.zw', password: pw }), t1 = (await login('Str0ngOwnerPass')).j.token;
  assert.equal((await s.call('/auth/password', 'POST', { current: 'wrong-pass', password: 'NewPassw0rdXY' }, t1)).s, 403); const r = await s.call('/auth/password', 'POST', { current: 'Str0ngOwnerPass', password: 'NewPassw0rdXY' }, t1); assert.equal(r.s, 200);
  assert.equal((await s.call('/me', 'GET', null, t1)).s, 401, 'old token must stop working'); assert.equal((await s.call('/me', 'GET', null, r.j.token)).s, 200); assert.equal((await login('Str0ngOwnerPass')).s, 401); assert.equal((await login('NewPassw0rdXY')).s, 200); });
test('forgot password: code by email (test mode shows it), no account enumeration, single use', async () => {
  const s = await start(ADMIN), reg = await s.call('/auth/register', 'POST', { name: 'Real Pax', phone: '0771234567', email: 'real@example.com', password: 'oldpassword1' }); assert.equal(reg.s, 200);
  const unknown = await s.call('/auth/forgot', 'POST', { email: 'nobody@example.com' }); assert.equal(unknown.j.sent, true); assert.equal(unknown.j.sandboxCode, undefined);
  const f = await s.call('/auth/forgot', 'POST', { email: 'real@example.com' }); assert.match(f.j.sandboxCode, /^\d{6}$/);
  assert.equal((await s.call('/auth/reset', 'POST', { email: 'real@example.com', code: '000000', password: 'brandnewpass1' })).s, 400);
  assert.equal((await s.call('/auth/reset', 'POST', { email: 'real@example.com', code: f.j.sandboxCode, password: 'brandnewpass1' })).s, 200);
  assert.equal((await s.call('/me', 'GET', null, reg.j.token)).s, 401); assert.equal((await s.call('/auth/login', 'POST', { email: 'real@example.com', password: 'brandnewpass1' })).s, 200);
  assert.equal((await s.call('/auth/reset', 'POST', { email: 'real@example.com', code: f.j.sandboxCode, password: 'anotherpass12' })).s, 400, 'code must be single use'); });
test('production without an email provider cannot send reset codes; app-info reports honest test mode', async () => {
  const s = await start({ ...ADMIN, NODE_ENV: 'production' }); assert.equal((await s.call('/auth/forgot', 'POST', { email: 'x@y.zw' })).s, 503);
  const i = (await (await fetch(s.B + '/api/app-info')).json()); assert.equal(i.production, true); assert.equal(i.sandbox, true); });
test('go-live script removes test accounts and data, keeps real people, sets the real admin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-')), seed = await start({ SEED_DEMO: '1', ADMIN_PASSWORD: 'admin123' }, dir);
  const reg = await seed.call('/auth/register', 'POST', { name: 'Real Person', phone: '0771234567', email: 'person@example.com', password: 'realpassword1' }); assert.equal(reg.s, 200); await sleep(300); await seed.stop();
  const before = new Set(fs.existsSync(path.join(ROOT, 'backups')) ? fs.readdirSync(path.join(ROOT, 'backups')) : []);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'golive.js'), '--yes', '--remove-demo', '--wipe-data', '--admin-email', 'boss@zimova.co.zw', '--admin-password', 'Boss1234567x'], { env: { ...baseEnv, DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Backup written/); fs.readdirSync(path.join(ROOT, 'backups')).filter(f => f.startsWith('pre-golive') && !before.has(f)).forEach(f => fs.unlinkSync(path.join(ROOT, 'backups', f)));
  const live = await start({}, dir); const call = live.call;
  assert.equal((await call('/auth/login', 'POST', { email: 'boss@zimova.co.zw', password: 'Boss1234567x' })).s, 200); assert.equal((await call('/auth/login', 'POST', { email: 'admin@zimova.test', password: 'admin123' })).s, 401);
  assert.equal((await call('/auth/login', 'POST', { email: 'driver@zimova.test', password: 'driver123' })).s, 401); assert.equal((await call('/auth/login', 'POST', { email: 'person@example.com', password: 'realpassword1' })).s, 200, 'real accounts must survive'); });
