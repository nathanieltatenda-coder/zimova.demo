// Outgoing messages: SMS, email and push. Every channel has a "sandbox" mode (nothing leaves the server) and real adapters.
//   SMS_PROVIDER   sandbox | twilio | http         EMAIL_PROVIDER  sandbox | smtp         PUSH_PROVIDER  sandbox | fcm
const crypto = require('crypto'), fs = require('fs');
const env = process.env, post = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });

// Zimbabwe numbers are often typed as 0771234567; providers need +263771234567.
function toE164(phone, cc = env.DEFAULT_COUNTRY_CODE || '263') {
  let p = String(phone || '').replace(/[\s\-().]/g, ''); if (p.startsWith('+')) return p; if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+' + cc + p.slice(1); return '+' + (p.startsWith(cc) ? p : cc + p);
}
async function sendSms(to, text) {
  const p = env.SMS_PROVIDER || 'sandbox', num = toE164(to);
  if (p === 'sandbox') return { sandbox: true };
  if (p === 'twilio') {   // Twilio Programmable Messaging. Check that your account can deliver to Zimbabwe before relying on it.
    const url = `${env.TWILIO_API_URL || 'https://api.twilio.com'}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const r = await post(url, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: num, From: env.TWILIO_FROM, Body: text }) });
    if (!r.ok) throw new Error('Twilio rejected the message: HTTP ' + r.status); return { ok: true };
  }
  if (p === 'http') {   // any provider with a simple JSON API: POST {to, text, from} with a bearer token
    const r = await post(env.SMS_HTTP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.SMS_HTTP_TOKEN ? { Authorization: 'Bearer ' + env.SMS_HTTP_TOKEN } : {}) }, body: JSON.stringify({ to: num, text, from: env.SMS_HTTP_FROM || 'ZIMOVA' }) });
    if (!r.ok) throw new Error('SMS provider rejected the message: HTTP ' + r.status); return { ok: true };
  }
  throw new Error(`Unknown SMS_PROVIDER "${p}"`);
}
let mailer = null;
async function sendEmail(to, subject, text) {
  const p = env.EMAIL_PROVIDER || 'sandbox'; if (p === 'sandbox') return { sandbox: true };
  if (p === 'smtp') { mailer = mailer || require('nodemailer').createTransport(env.SMTP_URL); await mailer.sendMail({ from: env.EMAIL_FROM || 'ZIMOVA <no-reply@localhost>', to, subject, text }); return { ok: true }; }
  throw new Error(`Unknown EMAIL_PROVIDER "${p}"`);
}
// ---- push (Firebase Cloud Messaging HTTP v1, authenticated with a service-account key)
let sa = null, tok = null; const pushLog = [];
function serviceAccount() { if (sa) return sa; const raw = env.FCM_SERVICE_ACCOUNT_JSON || (env.FCM_SERVICE_ACCOUNT_FILE && fs.readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, 'utf8')); if (!raw) throw new Error('FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE is not set'); return (sa = JSON.parse(raw)); }
async function fcmToken() {
  const s = serviceAccount(); if (tok && tok.exp > Date.now() + 60000) return tok.v;
  const now = Math.floor(Date.now() / 1000), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), aud = s.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64({ alg: 'RS256', typ: 'JWT' }), claim = b64({ iss: s.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud, iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(s.private_key, 'base64url');
  const r = await post(env.FCM_TOKEN_URL || aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('Firebase authentication failed: HTTP ' + r.status); tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return tok.v;
}
async function sendPush(user, title, body, data = {}) {
  const p = env.PUSH_PROVIDER || 'sandbox', out = [];
  for (const d of user.devices || []) {
    if (p === 'sandbox') { pushLog.push({ userId: user.id, platform: d.platform, title, body, data, at: Date.now() }); if (pushLog.length > 200) pushLog.shift(); out.push({ token: d.token, ok: true }); continue; }
    if (p !== 'fcm') throw new Error(`Unknown PUSH_PROVIDER "${p}"`);
    const s = serviceAccount(), r = await post(env.FCM_SEND_URL || `https://fcm.googleapis.com/v1/projects/${s.project_id}/messages:send`, { method: 'POST', headers: { Authorization: 'Bearer ' + await fcmToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: d.token, notification: { title, body }, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), android: { priority: 'high', notification: { channel_id: 'zimova' } }, apns: { payload: { aps: { sound: 'default' } } } } }) });
    if (r.ok) out.push({ token: d.token, ok: true }); else { const j = await r.json().catch(() => ({})), st = j.error && j.error.status; out.push({ token: d.token, ok: false, invalid: r.status === 404 || st === 'NOT_FOUND' || st === 'UNREGISTERED' || st === 'INVALID_ARGUMENT' }); }
  }
  return out;
}
module.exports = { toE164, sendSms, sendEmail, sendPush, pushLog };
