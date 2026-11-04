// ZIMOVA premium UI layer: theme, splash, bottom navigation, modals, notifications, animated numbers, skeletons,
// and the extra screens (Help & safety, Profile, Driver wallet) plus the extra admin tabs. Loaded after app.js.
const sbxOn = () => !!(window.APPINFO && APPINFO.sandbox), sbx = t => sbxOn() ? t : '';
fetch((window.ZIMOVA_API || '') + '/api/app-info').then(r => r.json()).then(j => { window.APPINFO = j; const d = $('.demo'); if (d && !j.sandbox) d.remove(); }).catch(() => {});
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- theme (dark default, light optional)
function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('zth', t); const m = $('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f7f4ea' : '#0a0a0a'; }
setTheme(localStorage.getItem('zth') || 'dark');
const themeBtn = () => `<button class="icon" id="thm" aria-label="Switch dark/light mode" title="Dark / light">${document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️'}</button>`;
const wireTheme = () => { const b = $('#thm'); if (b) b.onclick = () => { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); b.textContent = document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️'; }; };

// ---- splash
addEventListener('load', () => setTimeout(() => { const s = $('#splash'); if (!s) return; s.classList.add('out'); setTimeout(() => s.remove(), 600); }, reduced() ? 0 : 1000));

// ---- modals
function sheet(html, wire) {
  return new Promise(res => { const o = document.createElement('div'); o.className = 'modal'; o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(o); const prev = document.activeElement;
    const close = v => { o.classList.remove('in'); setTimeout(() => o.remove(), 240); if (prev && prev.focus) prev.focus(); res(v); }; wire(o, close);
    requestAnimationFrame(() => { o.classList.add('in'); const i = o.querySelector('input,button'); i && i.focus(); });
    o.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); }); o.addEventListener('click', e => { if (e.target === o) close(null); }); });
}
const ask = (title, label = '', o = {}) => sheet(`<h3>${esc(title)}</h3>${label ? `<p class="hint">${esc(label)}</p>` : ''}<input id="mi" ${o.inputmode ? `inputmode="${o.inputmode}"` : ''} maxlength="${o.max || 120}" autocomplete="off" value="${esc(o.value || '')}"><div class="actions" style="margin-top:12px"><button class="btn" id="mok">OK</button><button class="btn ghost" id="mno">Cancel</button></div>`,
  (m, c) => { const i = m.querySelector('#mi'); m.querySelector('#mok').onclick = () => c(i.value.trim()); m.querySelector('#mno').onclick = () => c(null); i.onkeydown = e => { if (e.key === 'Enter') c(i.value.trim()); }; });
const askReq = async (...a) => { const v = await ask(...a); if (v === null) throw new Error('Cancelled'); return v; };
const confirmBox = (title, text, ok = 'Yes') => sheet(`<h3>${esc(title)}</h3><p class="hint">${esc(text)}</p><div class="actions"><button class="btn" id="mok">${esc(ok)}</button><button class="btn ghost" id="mno">Not now</button></div>`,
  (m, c) => { m.querySelector('#mok').onclick = () => c(true); m.querySelector('#mno').onclick = () => c(false); }).then(v => !!v);

// ---- numbers, skeletons, stepper, matching, success
function runNums(root = document) { $$('.num[data-c]', root).forEach(el => { if (el.dataset.done) return; el.dataset.done = 1; const to = +el.dataset.c, t0 = performance.now(), dur = reduced() ? 0 : 800;
  (function f(t) { const k = dur ? Math.min((t - t0) / dur, 1) : 1; el.textContent = money(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); })(t0); }); }
const numEl = c => `<b class="num" data-c="${c}">${money(c)}</b>`;
const skel = (n = 3) => Array.from({ length: n }, () => '<div class="skel"></div>').join('');
function stepper(st) { const i = { searching: 0, accepted: 1, arrived: 2, in_progress: 3, completed: 4 }[st] ?? 0; return `<div class="stepper" style="--p:${i}">${['Requested', 'Matched', 'Arrived', 'On trip', 'Done'].map((t, k) => `<span class="${k <= i ? 'on' : ''}"><i></i><em>${t}</em></span>`).join('')}</div>`; }
const matchingHtml = () => `<div class="radar"><i></i><i></i><i></i><b></b></div><p class="mtxt"><span>Contacting drivers in your town…</span><span>Checking who is closest…</span><span>Waiting for a driver to accept…</span></p>`;
const successSvg = () => '<svg class="okmark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg>';
const phoneBanner = () => { const need = [!me.phoneVerified && ['vp', 'phone'], (window.APPINFO || {}).emailRequired !== false && !me.emailVerified && ['ve', 'email']].filter(Boolean); if (!need.length) return '';
  return `<div class="pinbox" style="text-align:left"><b style="font-size:14px;letter-spacing:0;color:var(--text)">Verify your ${need.map(n => n[1]).join(' and ')} to book</b><span class="hint">Drivers and ZIMOVA support need to be able to reach you.</span><br>${need.map(n => `<button class="btn sm" id="${n[0]}">Verify ${n[1]}</button>`).join(' ')}</div>`; };
async function verifyCode(kind) { try { const s = await api(`/auth/${kind}/send`, 'POST', {});
  const code = await ask(`Verify your ${kind}`, s.sandboxCode ? `Sandbox mode: nothing is sent. Your code is ${s.sandboxCode}.` : (kind === 'phone' ? 'Enter the 6-digit code we sent by SMS.' : 'Enter the 6-digit code we emailed you.'), { inputmode: 'numeric', max: 6 }); if (!code) return;
  me = (await api(`/auth/${kind}/verify`, 'POST', { code })).user; toast(kind === 'phone' ? 'Phone verified' : 'Email verified'); P.key = null; if (P.mode) tickP(); else go('profile'); } catch (x) { toast(x.message); } }
const verifyPhone = () => verifyCode('phone'), verifyEmail = () => verifyCode('email');
window.zGo = v => go(v); window.zHome = () => go(me ? { passenger: 'passenger', driver: 'driver', admin: 'admin' }[me.role] : 'welcome');
window.zOpen = kind => { if (!me) return; go({ request: 'driver', trip: me.role === 'driver' ? 'driver' : 'passenger', payment: me.role === 'driver' ? 'earnings' : 'passenger', payout: 'earnings', support: 'help', account: 'profile' }[kind] || window.zHome());   // tapping a push notification opens the right screen
};

// ---- navigation: header on desktop, animated bottom bar on phones, notification bell
const NAVS = { passenger: [['passenger', 'Book', '🚗'], ['history', 'Trips', '🧾'], ['help', 'Help', '💬'], ['profile', 'Profile', '👤']], driver: [['driver', 'Drive', '🚗'], ['earnings', 'Wallet', '💵'], ['help', 'Help', '💬'], ['profile', 'Profile', '👤']], admin: [['admin', 'Admin', '🛠️'], ['profile', 'Profile', '👤']] };
window.nav = function nav() {
  const n = $('#nav'), b = $('#bnav'); wireNote.stop();
  if (!me) { n.innerHTML = themeBtn(); b.className = ''; b.innerHTML = ''; wireTheme(); return; }
  const L = NAVS[me.role];
  n.innerHTML = L.map(([v, t]) => `<button class="btn sm ghost deskonly" data-v="${v}">${t}</button>`).join('') + `<button class="icon" id="bell" aria-label="Notifications">🔔<span id="bdg" hidden></span></button>` + themeBtn() + `<button class="btn sm" id="out">Sign out</button>`;
  b.className = 'show'; b.style.setProperty('--n', L.length); b.innerHTML = L.map(([v, t, i]) => `<button data-v="${v}"><span class="ic">${i}</span>${t}</button>`).join('');
  $$('[data-v]', n).concat($$('[data-v]', b)).forEach(x => x.onclick = () => go(x.dataset.v));
  $('#out').onclick = async () => { try { if (window.ZNative) await ZNative.onLogout(token); } catch {} token = null; me = null; localStorage.removeItem('zt'); go('welcome'); }; wireTheme(); wireNote(); markNav(); if (window.ZNative) ZNative.onLogin(token);   // phone app: register for push once signed in
};
function markNav() { const L = me && NAVS[me.role]; if (!L) return; const i = Math.max(0, L.findIndex(x => x[0] === window.curView)); $$('[data-v]').forEach(x => x.classList.toggle('on', x.dataset.v === window.curView)); $('#bnav').style.setProperty('--i', i); }
const seenNotes = new Set(); let primedNotes = false;
function wireNote() {
  const bell = $('#bell'); if (!bell) return; const poll = async () => { try { const r = await api('/notifications'); const g = $('#bdg'); if (g) { g.hidden = !r.unread; g.textContent = r.unread > 9 ? '9+' : r.unread; }
    if (window.ZNative && !ZNative.pushOk) { r.items.filter(x => !x.read && !seenNotes.has(x.id)).forEach(x => { seenNotes.add(x.id); if (primedNotes) ZNative.localNotify('ZIMOVA', x.text); }); primedNotes = true; }   // no push yet: still alert while the app is open
    return r; } catch {} };
  poll(); wireNote.t = setInterval(poll, 15000);
  bell.onclick = async e => { e.stopPropagation(); const old = $('.notes'); if (old) return old.remove(); const r = await poll() || { items: [] }; const d = document.createElement('div'); d.className = 'notes';
    d.innerHTML = `<h4>Notifications</h4>` + (r.items.map(x => `<div class="note ${x.read ? '' : 'new'}"><span>${esc(x.text)}</span><em>${new Date(x.at).toLocaleString()}</em></div>`).join('') || '<p class="hint">Nothing yet. Updates about your trips and payments appear here.</p>'); document.body.appendChild(d);
    api('/notifications/read', 'POST', {}).then(() => { const g = $('#bdg'); if (g) g.hidden = true; }).catch(() => {}); setTimeout(() => addEventListener('click', function f(ev) { if (!d.contains(ev.target)) { d.remove(); removeEventListener('click', f); } }), 0); };
}
wireNote.stop = () => { clearInterval(wireNote.t); const o = $('.notes'); if (o) o.remove(); };

// ---- Help & safety
views.help = async () => {
  main.innerHTML = `<div class="card">${skel(4)}</div>`;
  const [tk, trips] = await Promise.all([api('/tickets'), api('/bookings')]);
  main.innerHTML = `<div class="grid2"><section class="card"><h2>Report a problem</h2><p class="hint">Tell us what happened. An admin reviews every report.</p>
    <form id="tf"><label>Type</label><select name="category"><option value="incident">Safety incident</option><option value="complaint">Complaint about a driver or passenger</option><option value="dispute">Payment or fare dispute</option><option value="support">General help</option></select>
    <label>Trip (optional)</label><select name="bookingId"><option value="">Not about a specific trip</option>${trips.slice(0, 15).map(b => `<option value="${b.id}">${new Date(b.createdAt).toLocaleDateString()} · ${esc(b.fromName)} → ${esc(b.toName)}</option>`).join('')}</select>
    <label>What happened?</label><textarea name="text" rows="4" required minlength="5" maxlength="1000"></textarea><button class="btn">Send report</button></form></section>
    <section class="card"><h2>Emergency</h2><p>If you are in immediate danger, contact your local emergency services first.</p><p class="hint">During a trip, the <b>SOS</b> button alerts ZIMOVA support with your trip details and your emergency contact. You can also share a live trip link with someone you trust.</p>
    <button class="btn ghost" data-v="profile" id="ec">${me.emergency ? 'Edit emergency contact' : 'Add an emergency contact'}</button></section>
    <section class="card"><h2>My reports</h2>${tk.map(t => `<div class="req"><span class="badge ${t.status === 'resolved' ? 'ok' : ''}">${t.status.replace('_', ' ')}</span> <b>${t.category}</b><br><span class="hint">${esc(t.text)}</span>${t.resolution ? `<br>Reply: ${esc(t.resolution)}` : ''}</div>`).join('') || '<p class="hint">No reports yet.</p>'}</section>
    <section class="card"><h2>Quick answers</h2>${[['How is my fare calculated?', 'Road distance × the per-km rate for your booking type, shown before you book.'], ['What is the ride PIN?', 'A 4-digit code only you can see. Tell it to your driver so only the right person starts your trip.'], ['How are drivers paid?', 'You pay in the app. The driver gets 90%, ZIMOVA 10%, and driver earnings are paid out once a day.'], ['Can I pay cash?', 'No. ZIMOVA is electronic payments only.']].map(q => `<details><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join('')}</section></div>`;
  $('#ec').onclick = () => go('profile');
  $('#tf').onsubmit = async e => { e.preventDefault(); const f = form(e.target); try { await api('/tickets', 'POST', { category: f.category, bookingId: f.bookingId || undefined, text: f.text }); toast('Report sent. Thank you.'); go('help'); } catch (x) { toast(x.message); } };
};

// ---- Profile
views.profile = async () => {
  me = (await api('/me')).user; const e = me.emergency || {}, v = me.driver && me.driver.vehicle;
  main.innerHTML = `<div class="grid2"><form class="card" id="pf"><h2>My profile</h2><label>Full name</label><input name="name" value="${esc(me.name)}" required><label>Phone ${me.phoneVerified ? '<span class="badge ok">verified</span>' : '<span class="badge bad">not verified</span>'}</label><input name="phone" value="${esc(me.phone)}" required>
    ${!me.phoneVerified ? '<button class="btn sm" type="button" id="vp">Verify phone</button><br>' : ''}<label>Email ${me.emailVerified ? '<span class="badge ok">verified</span>' : '<span class="badge bad">not verified</span>'}</label><input value="${esc(me.email)}" disabled>${me.emailVerified ? '' : '<button class="btn sm" type="button" id="ve">Verify email</button><br>'}
    ${me.role === 'passenger' ? `<label>Preferred payment method</label><select name="prefMethod"><option value="ecocash">EcoCash</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select><p class="hint">Card numbers are never stored by ZIMOVA. Payments go through the payment provider.</p>` : ''}
    <h3>Emergency contact</h3><input name="en" placeholder="Name" value="${esc(e.name || '')}"><input name="ep" placeholder="Phone" value="${esc(e.phone || '')}"><p class="hint">Included in SOS alerts so support can reach someone you trust.</p><button class="btn">Save profile</button></form>
    ${v ? `<section class="card"><h2>Driver details</h2><p>${esc(v.make)} ${esc(v.model)} ${v.year} · ${esc(v.reg)} · ${v.capacity} seats</p><p>Approved town: <b>${esc(me.townName || '—')}</b></p><p>Status: <span class="badge">${me.status}</span></p><p class="hint">Documents verified by ZIMOVA: ${Object.entries((me.driver.verified) || {}).map(([k, x]) => `${k} ${x ? '✓' : '✗'}`).join(' · ')}</p></section>` : ''}
    <section class="card"><h2>Appearance</h2><p class="hint">Switch between dark and light mode.</p><button class="btn ghost" id="thm2">Toggle dark / light</button></section></div>`;
  if ($('[name=prefMethod]')) $('[name=prefMethod]').value = me.prefMethod || 'ecocash';
  if ($('#vp')) $('#vp').onclick = verifyPhone; if ($('#ve')) $('#ve').onclick = verifyEmail; $('#thm2').onclick = () => { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); wireTheme(); nav(); };
  $('#pf').onsubmit = async ev => { ev.preventDefault(); const f = form(ev.target); try { me = (await api('/profile', 'PUT', { name: f.name, phone: f.phone, prefMethod: f.prefMethod, emergency: { name: f.en, phone: f.ep } })).user; toast('Profile saved'); nav(); go('profile'); } catch (x) { toast(x.message); } };
};

// ---- Driver wallet & payouts
views.earnings = async () => {
  main.innerHTML = `<div class="card">${skel(5)}</div>`; const w = await api('/driver/wallet'), mx = Math.max(1, ...w.daily.map(d => d.netC));
  main.innerHTML = `<div class="stat wallet"><div>Available (next payout ${String(w.payoutHour).padStart(2, '0')}:00)${numEl(w.availableC)}</div><div>Payout pending${numEl(w.pendingPayoutC)}</div><div>Paid out${numEl(w.paidOutC)}</div><div>Total earned (90%)${numEl(w.totalEarnedC)}</div><div>ZIMOVA commission (10%)${numEl(w.commissionC)}</div></div>
    ${w.debtC ? `<p class="hint">A refund of ${money(w.debtC)} will be deducted from your next payout.</p>` : ''}
    <div class="grid2" style="margin-top:12px"><section class="card"><h2>Last 7 days</h2><p class="hint">Today ${money(w.today.netC)} (${w.today.trips} trips) · 7 days ${money(w.week.netC)} (${w.week.trips} trips)</p><div class="bars">${w.daily.map(d => `<div><i style="--h:${Math.round(d.netC / mx * 100)}%"></i><em>${d.day}</em></div>`).join('')}</div></section>
    <section class="card"><h2>Payouts</h2><div class="wrap"><table><tr><th>Date</th><th>To</th><th>Status</th><th class="r">Amount</th></tr>${w.payouts.map(p => `<tr><td>${new Date(p.createdAt).toLocaleDateString()}</td><td>${p.settlement}</td><td><span class="badge ${p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : ''}">${p.status}</span></td><td class="r">${money(p.amountC)}</td></tr>`).join('') || '<tr><td colspan="4">No payouts yet.</td></tr>'}</table></div></section></div>
    <section class="card" style="margin-top:12px"><h2>Transactions</h2><div class="wrap"><table><tr><th>Date</th><th>Trip</th><th>Status</th><th class="r">Fare paid</th><th class="r">Commission</th><th class="r">You earn</th></tr>${w.payments.map(p => `<tr><td>${new Date(p.at).toLocaleString()}</td><td>${p.bookingId}</td><td>${p.status}${p.paidOut ? ' · paid out' : ''}</td><td class="r">${money(p.amountC)}</td><td class="r">${money(p.commissionC)}</td><td class="r">${money(p.driverC)}</td></tr>`).join('') || '<tr><td colspan="6">No paid trips yet.</td></tr>'}</table></div></section>
    <section class="card" style="margin-top:12px"><h2>Ratings &amp; reviews</h2>${w.reviews.map(r => `<div class="req">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} <span class="hint">${new Date(r.at).toLocaleDateString()}</span>${r.comment ? `<br>${esc(r.comment)}` : ''}</div>`).join('') || '<p class="hint">No reviews yet.</p>'}</section>`;
  runNums();
};

// ---- extra admin tabs
const tbl = (head, rows, empty) => `<div class="wrap"><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('') || `<tr><td colspan="${head.length}">${empty}</td></tr>`}</table></div>`;
Object.assign(adminTabs, {
  async Reports(el) { el.innerHTML = skel(4); const r = await api('/admin/reports?days=14'), mx = Math.max(1, ...r.daily.map(d => d.grossC)), kv = o => Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v}</td></tr>`).join('');
    el.innerHTML = `<h2>Platform overview</h2><div class="stat"><div>Passengers<b>${r.passengers}</b></div><div>Drivers<b>${r.drivers}</b></div><div>Active trips now<b>${r.active.length}</b></div><div>Open reports<b>${r.openTickets}</b></div><div>Avg rating<b>${r.avgRating ?? '—'}</b></div></div>
      <h3>Paid fares, last 14 days</h3><div class="bars wide">${r.daily.map(d => `<div title="${money(d.grossC)} · ${d.trips} trips"><i style="--h:${Math.round(d.grossC / mx * 100)}%"></i><em>${d.day}</em></div>`).join('')}</div>
      <div class="grid2"><div><h3>Trips by town</h3><table>${kv(r.byTown) || '<tr><td>No trips yet</td></tr>'}</table></div><div><h3>By booking type</h3><table>${kv(r.byType) || '<tr><td>No trips yet</td></tr>'}</table></div><div><h3>By status</h3><table>${kv(r.byStatus) || '<tr><td>—</td></tr>'}</table></div><div><h3>Top drivers</h3><table>${r.topDrivers.map(t => `<tr><td>${esc(t.name)}</td><td class="r">${t.trips}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table></div></div>
      <h3>Trips in progress</h3>${tbl(['ID', 'Status', 'Route', 'Driver'], r.active.map(a => `<tr><td>${a.id}</td><td>${a.status}</td><td>${esc(a.route)}</td><td>${esc(a.driver)}</td></tr>`), 'None right now.')}`; },
  async Passengers(el) { el.innerHTML = skel(4); const l = await api('/admin/passengers');
    el.innerHTML = `<h2>Passengers</h2>` + tbl(['Name', 'Contact', 'Phone', 'Trips', 'Status', ''], l.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)} ${u.phoneVerified ? '<span class="badge ok">verified</span>' : `<button class="btn sm ghost" data-pv="${u.id}">Mark verified</button>`}</td><td>${u.trips}</td><td>${u.status || 'active'}</td><td><button class="btn sm ${u.status === 'suspended' ? 'green' : 'red'}" data-su="${u.id}" data-s="${u.status === 'suspended' ? 0 : 1}">${u.status === 'suspended' ? 'Reinstate' : 'Suspend'}</button></td></tr>`), 'No passengers yet.');
    el.onclick = async e => { const a = e.target.closest('[data-su]'), p = e.target.closest('[data-pv]'); try { if (a) { const reason = a.dataset.s === '1' ? await ask('Suspend this account?', 'Reason (kept in the audit log)') : ''; if (reason === null) return; await api(`/admin/users/${a.dataset.su}/suspend`, 'POST', { suspended: a.dataset.s === '1', reason }); adminTabs.Passengers(el); } if (p) { await api(`/admin/users/${p.dataset.pv}/phone-verify`, 'POST'); adminTabs.Passengers(el); } } catch (x) { toast(x.message); } }; },
  async Payments(el) { el.innerHTML = skel(4); const [l, rc] = await Promise.all([api('/admin/payments'), api('/admin/reconciliation')]);
    el.innerHTML = `<h2>Payments &amp; reconciliation</h2><div class="stat"><div>Collected${numEl(rc.collectedC)}</div><div>Drivers (90%)${numEl(rc.driverShareC)}</div><div>ZIMOVA (10%)${numEl(rc.commissionC)}</div><div>Refunded${numEl(rc.refundedC)}</div><div>Owed to drivers${numEl(rc.unpaidToDriversC)}</div></div>
      <p>${rc.ok ? '<span class="badge ok">Books balance</span>' : `<span class="badge bad">${rc.issues.length} issue(s)</span> ${rc.issues.map(esc).join(' · ')}`} <span class="hint">Provider: ${esc((window.APPINFO || {}).provider || '')}${sbx(' (sandbox, no real money)')}</span></p>` +
      tbl(['Date', 'Trip', 'Method', 'Status', 'Ref', 'Total', 'Driver', 'ZIMOVA', ''], l.map(p => `<tr><td>${new Date(p.createdAt).toLocaleString()}</td><td>${p.bookingId}</td><td>${p.method}</td><td>${p.status}${p.failReason ? ' (' + esc(p.failReason) + ')' : ''}</td><td>${esc(p.providerRef)}</td><td>${money(p.amountC)}</td><td>${money(p.driverC)}</td><td>${money(p.commissionC)}</td><td>${p.status === 'paid' ? `<button class="btn sm red" data-rf="${p.id}">Refund</button>` : ''}</td></tr>`), 'No payments yet.'); runNums(el);
    el.onclick = async e => { const b = e.target.closest('[data-rf]'); if (!b) return; const reason = await ask('Refund this payment?', 'Reason (shown to the passenger)'); if (reason === null) return; try { await api(`/admin/payments/${b.dataset.rf}/refund`, 'POST', { reason }); toast('Refund issued'); adminTabs.Payments(el); } catch (x) { toast(x.message); } }; },
  async Payouts(el) { el.innerHTML = skel(3); const l = await api('/admin/payouts');
    el.innerHTML = `<h2>Driver payouts</h2><p class="hint">Payouts run automatically once a day (server time, hour ${'set by PAYOUT_HOUR'}). You can also run them now.</p><button class="btn" id="po">Run payouts now</button>` + tbl(['Date', 'Driver', 'To', 'Status', 'Ref', 'Amount'], l.map(p => `<tr><td>${new Date(p.createdAt).toLocaleString()}</td><td>${esc(p.driver)}</td><td>${p.settlement}</td><td><span class="badge ${p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : ''}">${p.status}</span>${p.error ? ' ' + esc(p.error) : ''}</td><td>${esc(p.ref || '')}</td><td>${money(p.amountC)}</td></tr>`), 'No payouts yet.');
    $('#po').onclick = async () => { try { const r = await api('/admin/payouts/run', 'POST'); toast(r.length ? `${r.length} payout(s) created` : 'Nothing to pay out'); adminTabs.Payouts(el); } catch (x) { toast(x.message); } }; },
  async Support(el) { el.innerHTML = skel(3); const l = await api('/admin/tickets');
    el.innerHTML = `<h2>Complaints, incidents &amp; disputes</h2>` + tbl(['Date', 'From', 'Type', 'Trip', 'Report', 'Status', ''], l.map(t => `<tr><td>${new Date(t.createdAt).toLocaleDateString()}</td><td>${esc(t.name)} (${t.role})</td><td>${t.category}</td><td>${t.bookingId || ''}</td><td>${esc(t.text)}${t.resolution ? `<br><span class="hint">Reply: ${esc(t.resolution)}</span>` : ''}</td><td><span class="badge ${t.status === 'resolved' ? 'ok' : ''}">${t.status.replace('_', ' ')}</span></td><td><button class="btn sm ghost" data-tk="${t.id}" data-s="in_review">Review</button> <button class="btn sm green" data-tk="${t.id}" data-s="resolved">Resolve</button></td></tr>`), 'No reports.');
    el.onclick = async e => { const b = e.target.closest('[data-tk]'); if (!b) return; const resolution = await ask(b.dataset.s === 'resolved' ? 'Resolve report' : 'Mark in review', 'Message to the user (optional)'); if (resolution === null) return; try { await api(`/admin/tickets/${b.dataset.tk}`, 'POST', { status: b.dataset.s, resolution }); adminTabs.Support(el); } catch (x) { toast(x.message); } }; }
});
const docCell = d => `<td>${['id', 'licence', 'vehicle', 'insurance'].map(k => `<label class="chk"><input type="checkbox" data-doc="${k}" data-id="${d.id}" ${((d.driver.verified || {})[k]) ? 'checked' : ''} style="width:auto;margin:0"> ${k}</label>`).join('')}<span class="hint">Ins. ${esc(d.driver.insuranceNumber || '—')} (${esc(d.driver.insuranceExpiry || '—')}) · Reg book ${esc(d.driver.regBook || '—')}</span></td>`;

// ---- remember which screen is open (for nav highlight) and wrap every view with a skeleton-friendly entry
Object.keys(views).forEach(k => { const f = views[k]; views[k] = async (...a) => { window.curView = k; markNav(); return f(...a); }; });
