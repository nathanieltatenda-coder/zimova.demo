// Usage: npm run backup      (cron it daily; also copy the output off the server)
// JSON mode: copies data/db.json. PostgreSQL mode: runs pg_dump (must be installed) into backups/.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = path.join(__dirname, '..', 'backups'), stamp = new Date().toISOString().replace(/[:.]/g, '-'); fs.mkdirSync(dir, { recursive: true });
try { require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; }); } catch {}
if (process.env.DATABASE_URL) { const out = path.join(dir, `zimova-${stamp}.sql`); execFileSync('pg_dump', ['--dbname', process.env.DATABASE_URL, '--file', out]); console.log('PostgreSQL dump written to', out); }
else { const src = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'db.json'), out = path.join(dir, `db-${stamp}.json`); fs.copyFileSync(src, out); console.log('Copied', src, '->', out); }
fs.readdirSync(dir).filter(f => /^(db|zimova)-/.test(f)).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(dir, f)));   // keep the newest 30
