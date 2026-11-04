// Payments (gateway abstraction, signed webhooks, refunds, payouts, reconciliation), notifications, phone verification,
// profile, support tickets, admin passengers / document checks / reports / metrics, health.
const crypto = require('crypto');
module.exports = ctx => {
  const { app, D, save, auth, A, wrap, bad, str, audit, notify, view, bk, pub, PORT, logErr, store } = ctx;
  const rid = p => p + crypto.randomBytes(5).toString('hex'), now = () => Date.now();
  const PROVIDER = process.env.PAYMENT_PROVIDER || 'sandbox', SANDBOX = PROVIDER === 'sandbox';
  const secret = () => process.env.PAYMENT_WEBHOOK_SECRET || crypto.createHmac('sha256', D().secret).update('payment-webhook').digest('hex');
  const sig = raw => crypto.createHmac('sha256', secret()).update(raw).digest('hex');
  const money = c => '$' + (c / 100).toFixed(2), sum = (l, k) => l.reduce((s, x) => s + x[k], 0);

  // ---------- payment providers. A real gateway (Paynow etc.) is added as another entry with the same 3 methods.
  async function deliver(evt) {   // the sandbox "gateway" calls our public webhook just like a real one would
    const raw = JSON.stringify(evt);
    try { await fetch(`http://127.0.0.1:${PORT}/api/webhooks/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ZIMOVA-Signature': sig(raw) }, body: raw }); } catch (e) { logErr('webhook-delivery', e.message); }
  }
  const providers = { sandbox: {
    async charge(p, o) { const ref = 'SBX-' + rid('').toUpperCase(); setTimeout(() => deliver({ type: o.outcome === 'fail' ? 'charge.failed' : 'charge.succeeded', providerRef: ref, amountC: p.amountC, reason: o.outcome === 'fail' ? 'declined (sandbox test)' : undefined }), +process.env.SANDBOX_WEBHOOK_MS || 1200); return { providerRef: ref }; },
    async refund() { return { refundRef: 'SBX-RF-' + rid('').toUpperCase() }; },
    async payout() { return { payoutRef: 'SBX-PO-' + rid('').toUpperCase(), status: 'paid' }; } } };
  const provider = () => providers[PROVIDER] || (() => { throw bad(`Payment provider "${PROVIDER}" is not set up yet. See PAYMENTS.md.`, 503); })();
  app.get('/api/app-info', (req, res) => res.json({ sandbox: SANDBOX, provider: PROVIDER, otpSandbox: process.env.NODE_ENV !== 'production', emailRequired: process.env.REQUIRE_EMAIL_VERIFICATION !== '0', push: process.env.PUSH_PROVIDER || 'sandbox' }));

  // ---------- charging. Only a verified webhook can mark a payment paid.
  const locks = new Set();
  app.post('/api/bookings/:id/pay', auth('passenger'), wrap(async (req, res) => {
    const b = bk(req.params.id); if (b.passengerId !== req.user.id) throw bad('Not allowed', 403);
    if (b.status !== 'completed') throw bad('Trip is not completed', 409);
    if (locks.has(b.id) || D().payments.some(p => p.bookingId === b.id && ['pending', 'paid'].includes(p.status))) return res.json(view(b));   // duplicate-payment protection
    if (!['ecocash', 'visa', 'mastercard'].includes(req.body.method)) throw bad('Choose a payment method');
    locks.add(b.id);
    try {
      const p = { id: rid('pay_'), bookingId: b.id, passengerId: b.passengerId, driverId: b.driverId, amountC: b.totalC, driverC: b.driverC, commissionC: b.commissionC, feeC: b.feeC, method: req.body.method, status: 'pending', provider: PROVIDER, createdAt: now() };
      const r = await provider().charge(p, { outcome: SANDBOX ? req.body.outcome : undefined });
      p.providerRef = r.providerRef; D().payments.push(p);
      b.payment = { status: 'processing', method: p.method, ref: p.providerRef, at: now(), amountC: p.amountC, simulated: SANDBOX }; save(); res.json(view(b));
    } finally { locks.delete(b.id); }
  }));
  function settle(p) {
    const b = D().bookings.find(x => x.id === p.bookingId); p.status = 'paid'; p.paidAt = now();
    b.payment = { status: 'paid', method: p.method, ref: p.providerRef, at: p.paidAt, amountC: p.amountC, simulated: SANDBOX };
    D().txns.push({ ref: p.providerRef, bookingId: b.id, method: p.method, amountC: p.amountC, status: 'paid', at: p.paidAt, simulated: SANDBOX });
    notify(p.passengerId, `Payment of ${money(p.amountC)} confirmed. Thank you!`, 'payment'); notify(p.driverId, `Trip paid: you earn ${money(p.driverC)} (ZIMOVA commission ${money(p.commissionC)}).`, 'payment');
  }
  function fail(p, reason) {
    const b = D().bookings.find(x => x.id === p.bookingId); p.status = 'failed'; p.failReason = String(reason || 'declined').slice(0, 100);
    b.payment = { status: 'failed', method: p.method, ref: p.providerRef, at: now(), amountC: p.amountC, simulated: SANDBOX };
    D().txns.push({ ref: p.providerRef, bookingId: b.id, method: p.method, amountC: p.amountC, status: 'failed', at: now(), simulated: SANDBOX });
    notify(p.passengerId, 'Your payment failed. Please try again or use another method.', 'payment');
  }
  app.post('/api/webhooks/payments', wrap((req, res) => {   // signature = HMAC-SHA256(secret, raw body)
    const given = String(req.headers['x-zimova-signature'] || ''), exp = sig(req.raw || Buffer.alloc(0));
    if (given.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(exp))) throw bad('Invalid signature', 401);
    const e = req.body || {}, p = D().payments.find(x => x.providerRef === e.providerRef); if (!p) throw bad('Unknown payment', 404);
    if (e.amountC !== p.amountC) { audit({ email: 'system' }, 'webhook_amount_mismatch', `${p.id} expected ${p.amountC} got ${e.amountC}`); save(); throw bad('Amount mismatch', 422); }
    if (p.status !== 'pending') return res.json({ ok: true, duplicate: true });   // webhooks may repeat: handled once
    if (e.type === 'charge.succeeded') settle(p); else if (e.type === 'charge.failed') fail(p, e.reason); else throw bad('Unknown event type');
    save(); res.json({ ok: true });
  }));

  // ---------- refunds (admin) and payouts
  app.post('/api/admin/payments/:id/refund', A, wrap(async (req, res) => {
    const p = D().payments.find(x => x.id === req.params.id); if (!p) throw bad('Payment not found', 404);
    if (p.status !== 'paid') throw bad('Only paid payments can be refunded', 409); if (locks.has(p.id)) throw bad('Refund already in progress', 409);
    locks.add(p.id);
    try { const r = await provider().refund(p); p.status = 'refunded'; p.refundedAt = now(); p.refundRef = r.refundRef; p.refundReason = String(req.body.reason || '').slice(0, 200);
      const b = D().bookings.find(x => x.id === p.bookingId); b.payment = { ...b.payment, status: 'refunded', refundedAt: p.refundedAt };
      D().txns.push({ ref: p.refundRef, bookingId: b.id, method: p.method, amountC: -p.amountC, status: 'refunded', at: p.refundedAt, simulated: SANDBOX });
      audit(req.user, 'refund', `${p.id} ${money(p.amountC)} ${p.refundReason}`); notify(p.passengerId, `Refund of ${money(p.amountC)} issued.`, 'payment'); notify(p.driverId, `A trip payment was refunded; ${money(p.driverC)} will be deducted from your balance.`, 'payment'); save(); res.json(p);
    } finally { locks.delete(p.id); }
  }));
  async function runPayouts(by) {
    const out = [], byDrv = {}; D().payments.filter(p => p.status === 'paid' && !p.payoutId).forEach(p => (byDrv[p.driverId] = byDrv[p.driverId] || []).push(p));
    for (const [driverId, pays] of Object.entries(byDrv)) {
      const u = D().users.find(x => x.id === driverId); if (!u) continue;
      const debts = D().payments.filter(p => p.driverId === driverId && p.status === 'refunded' && p.payoutId && !p.clawedBack), debtC = sum(debts, 'driverC'), amountC = sum(pays, 'driverC') - debtC;
      if (amountC <= 0) continue;
      const po = { id: rid('po_'), driverId, amountC, settlement: u.driver.settlement, status: 'pending', paymentIds: pays.map(p => p.id), debtC, createdAt: now() };
      pays.forEach(p => p.payoutId = po.id); debts.forEach(p => p.clawedBack = true); D().payouts.push(po); save();
      try { const r = await provider().payout(po); po.ref = r.payoutRef; if (r.status === 'paid') { po.status = 'paid'; po.paidAt = now(); notify(driverId, `Payout of ${money(amountC)} sent to your ${po.settlement}.`, 'payout'); } }
      catch (e) { po.status = 'failed'; po.error = e.message; pays.forEach(p => delete p.payoutId); debts.forEach(p => delete p.clawedBack); logErr('payout', e.message); }
      out.push(po);
    }
    audit(by, 'payout_run', `${out.length} payouts`); save(); return out;
  }
  setInterval(() => { const d = new Date(), day = d.toISOString().slice(0, 10); if (d.getHours() >= (+process.env.PAYOUT_HOUR || 23) && D().lastPayoutDay !== day) { D().lastPayoutDay = day; runPayouts({ email: 'system' }).catch(e => logErr('payout-job', e.message)); } }, 60000).unref();
  app.post('/api/admin/payouts/run', A, wrap(async (req, res) => res.json(await runPayouts(req.user))));
  app.get('/api/admin/payouts', A, (req, res) => res.json(D().payouts.slice().reverse().slice(0, 100).map(p => ({ ...p, driver: (D().users.find(u => u.id === p.driverId) || {}).name }))));
  app.get('/api/admin/payments', A, (req, res) => res.json(D().payments.slice().reverse().slice(0, 200)));
  app.get('/api/admin/reconciliation', A, (req, res) => {
    const P = D().payments, paid = P.filter(p => p.status === 'paid'), ref = P.filter(p => p.status === 'refunded'), po = D().payouts, issues = [];
    P.forEach(p => { if (p.status === 'paid' && p.amountC !== p.driverC + p.commissionC + p.feeC) issues.push(`${p.id}: amount does not equal driver + commission + fee`);
      if (p.status === 'pending' && now() - p.createdAt > 15 * 60e3) issues.push(`${p.id}: pending for over 15 minutes (webhook missing?)`); });
    D().bookings.filter(b => b.status === 'completed' && b.payment.status === 'paid' && !String(b.payment.ref).startsWith('SIM-') && !P.some(p => p.bookingId === b.id && p.status === 'paid')).forEach(b => issues.push(`${b.id}: marked paid but no paid payment record`));
    const paidOut = sum(po.filter(x => x.status === 'paid'), 'amountC'); if (paidOut > sum(paid, 'driverC') + sum(ref, 'driverC')) issues.push('Payouts exceed driver earnings');
    po.filter(x => x.status === 'pending').forEach(x => issues.push(`${x.id}: payout still pending`)); po.filter(x => x.status === 'failed').forEach(x => issues.push(`${x.id}: payout failed (${x.error})`));
    res.json({ collectedC: sum(paid, 'amountC'), driverShareC: sum(paid, 'driverC'), commissionC: sum(paid, 'commissionC'), serviceFeeC: sum(paid, 'feeC'), refundedC: sum(ref, 'amountC'), paidOutC: paidOut, pendingPayoutC: sum(po.filter(x => x.status === 'pending'), 'amountC'), unpaidToDriversC: sum(paid.filter(p => !p.payoutId), 'driverC'), issues, ok: !issues.length });
  });

  // ---------- driver wallet
  app.get('/api/driver/wallet', auth('driver'), (req, res) => {
    const id = req.user.id, mine = D().payments.filter(p => p.driverId === id), paid = mine.filter(p => p.status === 'paid'), refunded = mine.filter(p => p.status === 'refunded'), pos = D().payouts.filter(p => p.driverId === id);
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t0 = +d0, per = l => ({ trips: l.length, netC: sum(l, 'driverC'), commissionC: sum(l, 'commissionC') });
    const daily = Array.from({ length: 7 }, (_, i) => { const a = t0 - (6 - i) * 864e5, l = paid.filter(p => p.paidAt >= a && p.paidAt < a + 864e5); return { day: new Date(a).toLocaleDateString('en', { weekday: 'short' }), netC: sum(l, 'driverC') }; });
    res.json({ totalEarnedC: sum(paid, 'driverC'), commissionC: sum(paid, 'commissionC'), availableC: sum(paid.filter(p => !p.payoutId), 'driverC'), debtC: sum(refunded.filter(p => p.payoutId && !p.clawedBack), 'driverC'),
      pendingPayoutC: sum(pos.filter(p => p.status === 'pending'), 'amountC'), paidOutC: sum(pos.filter(p => p.status === 'paid'), 'amountC'), today: per(paid.filter(p => p.paidAt >= t0)), week: per(paid.filter(p => p.paidAt >= t0 - 6 * 864e5)), daily,
      payments: mine.slice().reverse().slice(0, 30).map(p => ({ id: p.id, bookingId: p.bookingId, at: p.paidAt || p.createdAt, amountC: p.amountC, driverC: p.driverC, commissionC: p.commissionC, status: p.status, paidOut: !!p.payoutId })),
      payouts: pos.slice().reverse().slice(0, 20), payoutHour: +process.env.PAYOUT_HOUR || 23,
      reviews: D().bookings.filter(b => b.driverId === id && b.rating).slice(-10).reverse().map(b => ({ stars: b.rating.stars, comment: b.rating.comment, at: b.rating.at })) });
  });

  // ---------- notifications
  app.get('/api/notifications', auth(), (req, res) => { const l = (D().notes || []).filter(n => n.userId === req.user.id); res.json({ unread: l.filter(n => !n.read).length, items: l.slice(-30).reverse() }); });
  app.post('/api/notifications/read', auth(), (req, res) => { (D().notes || []).forEach(n => { if (n.userId === req.user.id) n.read = true; }); save(); res.json({ ok: true }); });

  // ---------- phone + email verification: 6-digit codes sent by SMS / email (sandbox mode shows the code on screen outside production)
  const KINDS = { phone: { field: 'otp', flag: 'phoneVerified', env: 'SMS_PROVIDER', what: 'SMS' }, email: { field: 'eotp', flag: 'emailVerified', env: 'EMAIL_PROVIDER', what: 'email' } };
  for (const [kind, K] of Object.entries(KINDS)) {
    app.post(`/api/auth/${kind}/send`, auth(), wrap(async (req, res) => {
      const u = req.user, o = u[K.field] || {};
      if (o.sentAt && now() - o.sentAt < 30e3) throw bad('Wait 30 seconds before asking for another code', 429);
      const recent = (o.log || []).filter(t => t > now() - 36e5); if (recent.length >= 5) throw bad('Too many codes requested. Try again in an hour.', 429);
      const sandbox = (process.env[K.env] || 'sandbox') === 'sandbox'; if (sandbox && process.env.NODE_ENV === 'production') throw bad(`No ${K.what} provider is configured. Ask an admin to verify you.`, 503);
      const code = String(crypto.randomInt(100000, 1000000));
      u[K.field] = { hash: crypto.createHash('sha256').update(code + u.id + kind).digest('hex'), exp: now() + 10 * 60e3, sentAt: now(), tries: 0, log: [...recent, now()] };
      if (sandbox) { save(); return res.json({ sent: true, sandboxCode: code, note: 'Sandbox mode: nothing is sent, the code is shown here.' }); }
      try { if (kind === 'phone') await ctx.msg.sendSms(u.phone, `Your ZIMOVA code is ${code}. It expires in 10 minutes.`); else await ctx.msg.sendEmail(u.email, 'Your ZIMOVA verification code', `Your ZIMOVA code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this, you can ignore this message.`); }
      catch (e) { delete u[K.field]; logErr('send-' + kind, e.message); throw bad(`We could not send the ${K.what} code. Please try again later.`, 502); }
      save(); res.json({ sent: true });
    }));
    app.post(`/api/auth/${kind}/verify`, auth(), wrap((req, res) => {
      const u = req.user, o = u[K.field]; if (!o || o.exp < now()) throw bad('Code expired. Request a new one.', 410);
      if (++o.tries > 5) { delete u[K.field]; save(); throw bad('Too many wrong attempts. Request a new code.', 429); }
      if (crypto.createHash('sha256').update(String(req.body.code || '') + u.id + kind).digest('hex') !== o.hash) { save(); throw bad('Wrong code', 400); }
      u[K.flag] = true; delete u[K.field]; save(); res.json({ user: pub(u) });
    }));
  }
  app.post('/api/admin/users/:id/email-verify', A, wrap((req, res) => { const u = D().users.find(x => x.id === req.params.id); if (!u) throw bad('User not found', 404); u.emailVerified = true; audit(req.user, 'email_verified', u.email); save(); res.json(pub(u)); }));

  // ---------- phone-app push notifications: devices register a token; every notify() also pushes to the user's devices
  app.post('/api/devices', auth(), wrap((req, res) => {
    const t = String(req.body.token || ''); if (t.length < 10 || t.length > 4096) throw bad('Invalid device token');
    D().users.forEach(x => { if (x.devices) x.devices = x.devices.filter(d => d.token !== t); });   // a token belongs to one account at a time
    req.user.devices = [...(req.user.devices || []), { token: t, platform: ['android', 'ios'].includes(req.body.platform) ? req.body.platform : 'android', at: now() }].slice(-5); save(); res.json({ ok: true });
  }));
  app.delete('/api/devices', auth(), wrap((req, res) => { req.user.devices = (req.user.devices || []).filter(d => d.token !== String(req.body.token || '')); save(); res.json({ ok: true }); }));
  const TITLES = { trip: 'Your trip', payment: 'Payment', payout: 'Payout', request: 'New request', account: 'Your account', support: 'Support' };
  ctx.setPush((uid, text, kind) => { const u = D().users.find(x => x.id === uid); if (!u || !(u.devices || []).length) return;
    ctx.msg.sendPush(u, TITLES[kind] || 'ZIMOVA', text, { kind }).then(r => { const bad = r.filter(x => x.invalid).map(x => x.token); if (bad.length) { u.devices = u.devices.filter(d => !bad.includes(d.token)); save(); } }).catch(err => logErr('push', err.message)); });
  app.get('/api/admin/pushes', A, (req, res) => res.json(ctx.msg.pushLog.slice(-50).reverse()));

  // ---------- profile
  app.put('/api/profile', auth(), wrap((req, res) => {
    const u = req.user, b = req.body;
    if (!str(b.name, 2, 60) || !str(b.phone, 7, 20)) throw bad('Name and phone are required');
    if (b.phone.trim() !== u.phone) u.phoneVerified = false; u.name = b.name.trim(); u.phone = b.phone.trim();
    const e = b.emergency || {}; if (e.name || e.phone) { if (!str(e.name, 2, 60) || !str(e.phone, 7, 20)) throw bad('Emergency contact needs a name and phone'); u.emergency = { name: e.name.trim(), phone: e.phone.trim() }; } else delete u.emergency;
    if (b.prefMethod) { if (!['ecocash', 'visa', 'mastercard'].includes(b.prefMethod)) throw bad('Invalid payment method'); u.prefMethod = b.prefMethod; }
    save(); res.json({ user: pub(u) });
  }));

  // ---------- complaints, incidents, disputes, support
  app.post('/api/tickets', auth('passenger', 'driver'), wrap((req, res) => {
    const b = req.body; if (!['incident', 'complaint', 'dispute', 'support'].includes(b.category)) throw bad('Choose a category'); if (!str(b.text, 5, 1000)) throw bad('Please describe the problem (5+ characters)');
    let bookingId = null; if (b.bookingId) { const bo = D().bookings.find(x => x.id === b.bookingId); if (!bo || (bo.passengerId !== req.user.id && bo.driverId !== req.user.id)) throw bad('Trip not found', 404); bookingId = bo.id; }
    const t = { id: 't' + (++D().seq), userId: req.user.id, name: req.user.name, role: req.user.role, category: b.category, bookingId, text: b.text.trim(), status: 'open', createdAt: now() }; D().tickets.push(t); save(); res.json(t);
  }));
  app.get('/api/tickets', auth(), (req, res) => res.json(D().tickets.filter(t => t.userId === req.user.id).reverse()));
  app.get('/api/admin/tickets', A, (req, res) => res.json(D().tickets.slice().reverse()));
  app.post('/api/admin/tickets/:id', A, wrap((req, res) => {
    const t = D().tickets.find(x => x.id === req.params.id); if (!t) throw bad('Ticket not found', 404); if (!['open', 'in_review', 'resolved'].includes(req.body.status)) throw bad('Invalid status');
    t.status = req.body.status; t.resolution = String(req.body.resolution || t.resolution || '').slice(0, 500); t.updatedAt = now(); audit(req.user, 'ticket', `${t.id} -> ${t.status}`);
    notify(t.userId, `Your ${t.category} report is now "${t.status.replace('_', ' ')}".${t.resolution ? ' ' + t.resolution : ''}`, 'support'); save(); res.json(t);
  }));

  // ---------- admin: passengers, documents, suspension, reports, metrics
  app.get('/api/admin/passengers', A, (req, res) => res.json(D().users.filter(u => u.role === 'passenger').map(u => ({ ...pub(u), trips: D().bookings.filter(b => b.passengerId === u.id).length }))));
  app.post('/api/admin/users/:id/suspend', A, wrap((req, res) => {
    const u = D().users.find(x => x.id === req.params.id && x.role !== 'admin'); if (!u) throw bad('User not found', 404);
    if (req.body.suspended) { u.status = 'suspended'; u.online = false; } else if (u.status === 'suspended') { if (u.role === 'driver') u.status = 'pending'; else delete u.status; }
    audit(req.user, req.body.suspended ? 'suspend' : 'unsuspend', `${u.email} ${String(req.body.reason || '').slice(0, 100)}`); save(); res.json(pub(u));
  }));
  app.post('/api/admin/users/:id/phone-verify', A, wrap((req, res) => { const u = D().users.find(x => x.id === req.params.id); if (!u) throw bad('User not found', 404); u.phoneVerified = true; audit(req.user, 'phone_verified', u.email); save(); res.json(pub(u)); }));
  app.post('/api/admin/drivers/:id/verify', A, wrap((req, res) => {
    const u = D().users.find(x => x.id === req.params.id && x.role === 'driver'); if (!u) throw bad('Driver not found', 404);
    if (!['id', 'licence', 'vehicle', 'insurance'].includes(req.body.field)) throw bad('Unknown document'); u.driver.verified = { ...(u.driver.verified || {}), [req.body.field]: !!req.body.value };
    audit(req.user, 'doc_verify', `${u.email} ${req.body.field}=${!!req.body.value}`); save(); res.json(pub(u));
  }));
  app.get('/api/admin/reports', A, (req, res) => {
    const n = Math.min(+req.query.days || 14, 90), d0 = new Date(); d0.setHours(0, 0, 0, 0); const t0 = +d0, paid = D().payments.filter(p => p.status === 'paid'), B = D().bookings;
    const daily = Array.from({ length: n }, (_, i) => { const a = t0 - (n - 1 - i) * 864e5, l = paid.filter(p => p.paidAt >= a && p.paidAt < a + 864e5); return { day: new Date(a).toISOString().slice(5, 10), trips: l.length, grossC: sum(l, 'amountC'), commissionC: sum(l, 'commissionC') }; });
    const count = f => B.reduce((m, b) => { const k = f(b) || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {}), rated = B.filter(b => b.rating);
    const top = Object.entries(B.filter(b => b.status === 'completed').reduce((m, b) => (m[b.driverId] = (m[b.driverId] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, trips]) => ({ name: (D().users.find(u => u.id === id) || {}).name, trips }));
    res.json({ daily, byTown: count(b => (D().towns.find(t => t.id === b.townId) || {}).name), byType: count(b => b.type || b.vehicle), byStatus: count(b => b.status), avgRating: rated.length ? +(sum(rated.map(b => b.rating), 'stars') / rated.length).toFixed(2) : null, topDrivers: top,
      active: B.filter(b => ['searching', 'accepted', 'arrived', 'in_progress'].includes(b.status)).map(b => ({ id: b.id, status: b.status, route: `${b.fromName} → ${b.toName}`, driver: (D().users.find(u => u.id === b.driverId) || {}).name || '—' })),
      openTickets: D().tickets.filter(t => t.status !== 'resolved').length, passengers: D().users.filter(u => u.role === 'passenger').length, drivers: D().users.filter(u => u.role === 'driver').length });
  });
  app.get('/api/admin/metrics', A, (req, res) => res.json({ uptimeS: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576), store: store.kind, provider: PROVIDER, devices: D().users.reduce((n, u) => n + (u.devices || []).length, 0), bookings: D().bookings.length, users: D().users.length, payments: D().payments.length, node: process.version }));
  app.use((err, req, res, next) => { if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' }); logErr('express', err && err.stack || String(err), { path: req.path }); res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' }); });
};
