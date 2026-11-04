// Tests for SMS (Twilio + generic HTTP), email (SMTP), push (Firebase), CORS for the phone apps and native location uploads.
// Everything external is replaced by local stand-in servers, so no accounts are needed.
const { test, before, after } = require('node:test'), assert = require('node:assert/strict');
const http = require('http'), os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto'), { spawn } = require('child_process'), { SMTPServer } = require('smtp-server');
const sleep = ms => new Promise(r => setTimeout(r, ms)), listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sent = { twilio: [], http: [], mail: [], fcm: [], auth: [] }, dead = 'dead-token-0000000000';
let apps = [], fakeSvc, smtp, osrm, P1, P2, A, ADMIN;
const startApp = async env => { const port = 3700 + Math.floor(Math.random() * 400), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: port, DATA_DIR: tmp, RATE_LIMIT: '100000', ADMIN_PASSWORD: 'admin123', PAYMENT_WEBHOOK_SECRET: 'x', ...env }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`; for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch {} await sleep(150); }
  const call = async (p, m = 'GET', body, t, h = {}) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers }; };
  const app = { port, B, call, stop: () => proc.kill() }; apps.push(app); return app; };
before(async () => {
  fakeSvc = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { r.setHeader('content-type', 'application/json');
    if (q.url.includes('/Messages.json')) { sent.twilio.push({ auth: q.headers.authorization, form: Object.fromEntries(new URLSearchParams(b)) }); return r.end('{"sid":"SM1"}'); }
    if (q.url === '/sms') { sent.http.push({ auth: q.headers.authorization, body: JSON.parse(b) }); return r.end('{}'); }
    if (q.url === '/token') { const f = new URLSearchParams(b), [h, c, sg] = f.get('assertion').split('.'); sent.auth.push({ claim: JSON.parse(Buffer.from(c, 'base64url')), valid: crypto.createVerify('RSA-SHA256').update(h + '.' + c).verify(publicKey, sg, 'base64url') }); return r.end('{"access_token":"fake-access","expires_in":3600}'); }
    if (q.url === '/send') { const m = JSON.parse(b).message; sent.fcm.push({ auth: q.headers.authorization, m }); if (m.token === dead) { r.statusCode = 404; return r.end('{"error":{"status":"NOT_FOUND"}}'); } return r.end('{"name":"ok"}'); }
    r.statusCode = 404; r.end('{}'); }); });
  const fp = await listen(fakeSvc);
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, session, cb) { let d = ''; stream.on('data', c => d += c); stream.on('end', () => { sent.mail.push({ to: session.envelope.rcptTo.map(x => x.address), raw: d }); cb(); }); } }); const sp = await listen(smtp.server);
  osrm = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600, geometry: { coordinates: [[31.05, -17.83], [31.1, -17.9]] } }] })); }); const op = await listen(osrm);
  const sa = JSON.stringify({ project_id: 'zimova-test', client_email: 'push@zimova-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `http://127.0.0.1:${fp}/token` });
  A = await startApp({ NODE_ENV: 'production', OSRM_URL: `http://127.0.0.1:${op}`, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001111', TWILIO_API_URL: `http://127.0.0.1:${fp}`,
    EMAIL_PROVIDER: 'smtp', SMTP_URL: `smtp://127.0.0.1:${sp}`, EMAIL_FROM: 'ZIMOVA <hello@zimova.test>', PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_JSON: sa, FCM_SEND_URL: `http://127.0.0.1:${fp}/send` });
  global.fp = fp;
});
after(() => { apps.forEach(a => a.stop()); [fakeSvc, osrm].forEach(s => s && s.close()); smtp && smtp.close(); });

test('phone numbers are converted to international format', () => { const { toE164 } = require('../lib/messaging'); assert.equal(toE164('0771234567'), '+263771234567'); assert.equal(toE164('077 123-4567'), '+263771234567'); assert.equal(toE164('+263771234567'), '+263771234567'); assert.equal(toE164('00263771234567'), '+263771234567'); assert.equal(toE164('263771234567'), '+263771234567'); });
test('SMS code goes out through Twilio (stand-in) and is not leaked in the response', async () => {
  const r = await A.call('/auth/register', 'POST', { name: 'Sms Pax', phone: '0771234567', email: 'sms@x.zw', password: 'password1' }); P1 = r.j.token;
  const s = await A.call('/auth/phone/send', 'POST', {}, P1); assert.equal(s.j.sent, true); assert.equal(s.j.sandboxCode, undefined);
  const m = sent.twilio.at(-1); assert.equal(m.form.To, '+263771234567'); assert.equal(m.form.From, '+15550001111'); assert.match(m.auth, /^Basic /); const code = m.form.Body.match(/\d{6}/)[0];
  assert.equal((await A.call('/auth/phone/verify', 'POST', { code: '000000' }, P1)).s, 400); assert.equal((await A.call('/auth/phone/verify', 'POST', { code }, P1)).j.user.phoneVerified, true); });
test('email code goes out over SMTP and verifies', async () => {
  const s = await A.call('/auth/email/send', 'POST', {}, P1); assert.equal(s.j.sent, true); assert.equal(s.j.sandboxCode, undefined); await sleep(300);
  const m = sent.mail.at(-1); assert.deepEqual(m.to, ['sms@x.zw']); assert.match(m.raw, /Subject: Your ZIMOVA verification code/); const code = m.raw.match(/code is (\d{6})/)[1];
  assert.equal((await A.call('/auth/email/verify', 'POST', { code }, P1)).j.user.emailVerified, true); });
test('generic HTTP SMS provider adapter', async () => { process.env.SMS_PROVIDER = 'http'; process.env.SMS_HTTP_URL = `http://127.0.0.1:${global.fp}/sms`; process.env.SMS_HTTP_TOKEN = 'secret';
  await require('../lib/messaging').sendSms('0772222222', 'hello'); const m = sent.http.at(-1); assert.deepEqual(m.body, { to: '+263772222222', text: 'hello', from: 'ZIMOVA' }); assert.equal(m.auth, 'Bearer secret'); delete process.env.SMS_PROVIDER; });
test('booking needs BOTH phone and email verified', async () => {
  const r = await A.call('/auth/register', 'POST', { name: 'Half Pax', phone: '0771000222', email: 'half@x.zw', password: 'password1' }), t = r.j.token; const body = { from: { lat: -17.83, lng: 31.05 }, to: { lat: -17.9, lng: 31.1 }, fromName: 'a', toName: 'b', pay: 'ecocash', type: 'private' };
  assert.equal((await A.call('/bookings', 'POST', body, t)).s, 403); await sleep(0);
  const s = await A.call('/auth/phone/send', 'POST', {}, t); const code = sent.twilio.at(-1).form.Body.match(/\d{6}/)[0]; await A.call('/auth/phone/verify', 'POST', { code }, t); const e = await A.call('/bookings', 'POST', body, t); assert.equal(e.s, 403); assert.match(e.j.error, /email/i); });
test('push: device registers, driver gets a Firebase message for a new request, dead tokens are removed', async () => {
  const d = (await A.call('/auth/login', 'POST', { email: 'driver@zimova.test', password: 'driver123' })).j.token; await A.call('/driver/online', 'POST', { online: true }, d);
  assert.equal((await A.call('/devices', 'POST', { token: 'good-device-token-1234567', platform: 'android' }, d)).s, 200); await A.call('/devices', 'POST', { token: dead, platform: 'android' }, d);
  const before = (await A.call('/admin/metrics', 'GET', null, (await A.call('/auth/login', 'POST', { email: 'admin@zimova.test', password: 'admin123' })).j.token)).j.devices; ADMIN = (await A.call('/auth/login', 'POST', { email: 'admin@zimova.test', password: 'admin123' })).j.token;
  const r = await A.call('/auth/register', 'POST', { name: 'Push Pax', phone: '0771000333', email: 'push@x.zw', password: 'password1' }); P2 = r.j.token;
  await A.call('/auth/phone/send', 'POST', {}, P2); await A.call('/auth/phone/verify', 'POST', { code: sent.twilio.at(-1).form.Body.match(/\d{6}/)[0] }, P2); await A.call('/auth/email/send', 'POST', {}, P2); await sleep(300); await A.call('/auth/email/verify', 'POST', { code: sent.mail.at(-1).raw.match(/code is (\d{6})/)[1] }, P2);
  const bk = await A.call('/bookings', 'POST', { from: { lat: -17.83, lng: 31.05 }, to: { lat: -17.9, lng: 31.1 }, fromName: 'Avondale', toName: 'CBD', pay: 'ecocash', type: 'private' }, P2); assert.equal(bk.s, 200, JSON.stringify(bk.j)); await sleep(800);
  const good = sent.fcm.find(x => x.m.token === 'good-device-token-1234567'); assert.ok(good, 'no push reached Firebase stand-in'); assert.equal(good.auth, 'Bearer fake-access'); assert.match(good.m.notification.body, /New ride request in Harare: Avondale/); assert.equal(good.m.data.kind, 'request'); assert.equal(good.m.android.notification.channel_id, 'zimova');
  assert.equal(sent.auth.length >= 1 && sent.auth.every(x => x.valid), true); assert.equal(sent.auth[0].claim.scope, 'https://www.googleapis.com/auth/firebase.messaging'); assert.equal(sent.auth[0].claim.iss, 'push@zimova-test.iam.gserviceaccount.com');
  assert.equal((await A.call('/admin/metrics', 'GET', null, ADMIN)).j.devices, before - 1, 'dead token should be removed'); A.bk = bk.j; A.d = d; });
test('native background location upload (latitude/longitude + source) is accepted only during an active trip', async () => {
  const payload = { latitude: -17.84, longitude: 31.04, accuracy: 8, source: 'native' }; assert.equal((await A.call('/driver/location', 'POST', payload, A.d)).s, 409);
  assert.equal((await A.call(`/bookings/${A.bk.id}/accept`, 'POST', null, A.d)).s, 200); assert.equal((await A.call('/driver/location', 'POST', payload, A.d)).s, 200);
  assert.equal((await A.call('/bookings/' + A.bk.id, 'GET', null, P2)).j.driverLoc.lat, -17.84); });
test('CORS: phone-app origins allowed, others not; preflight works', async () => {
  const ok = await fetch(A.B + '/api/quote', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'capacitor://localhost'); assert.match(ok.headers.get('access-control-allow-headers'), /Authorization/i);
  const no = await fetch(A.B + '/api/towns', { headers: { Origin: 'https://evil.example' } }); assert.equal(no.headers.get('access-control-allow-origin'), null); });
test('production without any SMS/email provider refuses to show codes', async () => { const B = await startApp({ NODE_ENV: 'production' }); const r = await B.call('/auth/register', 'POST', { name: 'No Prov', phone: '0771000444', email: 'np@x.zw', password: 'password1' });
  assert.equal((await B.call('/auth/phone/send', 'POST', {}, r.j.token)).s, 503); assert.equal((await B.call('/auth/email/send', 'POST', {}, r.j.token)).s, 503); });
