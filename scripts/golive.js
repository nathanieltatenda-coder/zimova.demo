// Prepares an existing ZIMOVA database for real use. STOP THE SERVER FIRST (a running server keeps its own copy and would overwrite this).
//   npm run golive                      (asks questions)
//   node scripts/golive.js --yes --remove-demo --wipe-data --admin-email you@example.com --admin-password '...'   (no questions)
// Options: --remove-demo   delete the old test accounts (anything @zimova.test)
//          --wipe-data     delete ALL trips, payments, payouts, transactions, notifications, reports, alerts and the audit log
//          --wipe-users    delete ALL accounts except the admin you set below (use if testers registered fake accounts)
// A backup is always written first (backups/pre-golive-*).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
try { fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
const argv = process.argv.slice(2), flag = k => argv.includes('--' + k), opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout }), ask = q => new Promise(r => rl.question(q, a => r(a.trim())));
const yes = async (q, flagName) => flag('yes') ? flag(flagName) : /^y/i.test(await ask(q + ' (y/n) '));
(async () => {
  const store = require('../lib/store')(root), db = await store.init(); if (!db) { console.log('No database found yet. Nothing to do: just set ADMIN_EMAIL and ADMIN_PASSWORD in .env and start the server.'); process.exit(0); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), bdir = path.join(root, 'backups'); fs.mkdirSync(bdir, { recursive: true });
  if (store.kind === 'json') fs.writeFileSync(path.join(bdir, `pre-golive-${stamp}.json`), JSON.stringify(db)); else execFileSync('pg_dump', ['--dbname', process.env.DATABASE_URL, '--file', path.join(bdir, `pre-golive-${stamp}.sql`)]);
  console.log(`Backup written to backups/pre-golive-${stamp}.*`);
  const demo = db.users.filter(u => /@zimova\.test$/i.test(u.email)), others = db.users.filter(u => u.role !== 'admin' && !demo.includes(u));
  console.log(`\nFound: ${db.users.length} accounts (${demo.length} old test accounts, ${others.length} other non-admin accounts), ${db.bookings.length} trips, ${(db.payments || []).length} payments.\n`);
  const removeDemo = demo.length && await yes(`Remove the ${demo.length} old test accounts?`, 'remove-demo'), wipeData = await yes('Delete ALL trips, payments, payouts, notifications and reports (test data)?', 'wipe-data'), wipeUsers = others.length && await yes(`Delete the ${others.length} other accounts too (keeps only the admin)?`, 'wipe-users');
  let email = (opt('admin-email') || process.env.ADMIN_EMAIL || '').toLowerCase(), pw = opt('admin-password') || process.env.ADMIN_PASSWORD || '';
  const admins = () => db.users.filter(u => u.role === 'admin');
  const gone = new Set([...(removeDemo ? demo : []), ...(wipeUsers ? others : [])].map(u => u.id));
  const needAdmin = !db.users.some(u => u.role === 'admin' && !gone.has(u.id) && !/@zimova\.test$/i.test(u.email)) || flag('admin-email');
  if (needAdmin) {
    if (!email && !flag('yes')) email = (await ask('Admin email (your real address): ')).toLowerCase(); if (!pw && !flag('yes')) pw = await ask('Admin password (10+ characters, letters and numbers): ');
    if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 10 || !/\d/.test(pw) || !/[a-z]/i.test(pw)) { console.error('Need a real admin email and a password of 10+ characters with letters and numbers. Nothing was changed.'); process.exit(1); }
  }
  if (!flag('yes') && !/^RESET$/.test(await ask('\nType RESET to apply these changes: '))) { console.log('Cancelled. Nothing was changed.'); process.exit(0); }
  db.users = db.users.filter(u => !gone.has(u.id));
  if (wipeData) { ['bookings', 'txns', 'audit', 'payments', 'payouts', 'notes', 'tickets', 'alerts'].forEach(k => { db[k] = []; }); delete db.lastPayoutDay; db.users.forEach(u => { delete u.devices; }); }
  else { const ids = new Set(db.users.map(u => u.id)); db.bookings = db.bookings.filter(b => ids.has(b.passengerId)); }
  if (needAdmin) {
    const old = db.users.find(u => u.role === 'admin' && u.email === email), salt = crypto.randomBytes(16).toString('hex'), hash = crypto.scryptSync(pw, salt, 32).toString('hex');
    if (old) Object.assign(old, { salt, hash, tv: (old.tv || 0) + 1 }); else db.users.push({ id: 'u' + (++db.seq), name: process.env.ADMIN_NAME || 'ZIMOVA Admin', email, phone: process.env.ADMIN_PHONE || '0000000', role: 'admin', emailVerified: true, phoneVerified: true, salt, hash, createdAt: Date.now() });
  }
  (db.audit = db.audit || []).push({ at: Date.now(), by: 'golive-script', action: 'golive', detail: `removeDemo=${!!removeDemo} wipeData=${!!wipeData} wipeUsers=${!!wipeUsers}` });
  store.save(db); await store.flush(); console.log(`\nDone. ${db.users.length} account(s) remain. Admin: ${admins().map(a => a.email).join(', ')}\nNow start the server and sign in. Change the admin password in Profile if you used a temporary one.`); rl.close(); process.exit(0);
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
