// Persistence layer. JSON file by default; PostgreSQL when DATABASE_URL is set.
// PostgreSQL mode stores each top-level collection (users, bookings, payments...) as a JSONB row in table zimova_state,
// written through a debounced, serialized, transactional flush. Normalising into relational tables is a later step.
const fs = require('fs'), path = require('path');

function jsonStore(dir) {
  const FILE = path.join(process.env.DATA_DIR || path.join(dir, 'data'), 'db.json'), BK = path.join(path.dirname(FILE), 'backups'); let lastBackup = '';
  return {
    kind: 'json',
    async init() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : null; },
    save(db) {
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE);   // atomic replace: a crash never leaves half a file
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastBackup) { lastBackup = day; try { fs.mkdirSync(BK, { recursive: true }); fs.copyFileSync(FILE, path.join(BK, `db-${day}.json`));
        fs.readdirSync(BK).filter(f => /^db-.*\.json$/.test(f)).sort().slice(0, -14).forEach(f => fs.unlinkSync(path.join(BK, f))); } catch (e) { console.error('backup failed', e.message); } }
    },
    async flush() {}, async ping() { return fs.existsSync(FILE); }
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined, max: 5 });
  let cache = null, timer = null, chain = Promise.resolve(); const last = {};
  const flushNow = () => { chain = chain.then(async () => {
    if (!cache) return; const c = await pool.connect();
    try { await c.query('BEGIN');
      for (const k of Object.keys(cache)) { const s = JSON.stringify(cache[k]); if (last[k] === s) continue;
        await c.query('INSERT INTO zimova_state(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [k, s]); last[k] = s; }
      await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); Object.keys(last).forEach(k => delete last[k]); console.error('postgres flush failed', e.message); } finally { c.release(); } }); return chain; };
  return {
    kind: 'postgres',
    async init() {
      await pool.query('CREATE TABLE IF NOT EXISTS zimova_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
      const r = await pool.query('SELECT key, value FROM zimova_state'); if (!r.rows.length) return null;
      const db = {}; r.rows.forEach(x => { db[x.key] = x.value; last[x.key] = JSON.stringify(x.value); }); return db;
    },
    save(db) { cache = db; clearTimeout(timer); timer = setTimeout(flushNow, 60); },
    async flush() { clearTimeout(timer); await flushNow(); }, async ping() { await pool.query('SELECT 1'); return true; }
  };
}
module.exports = dir => process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : jsonStore(dir);
