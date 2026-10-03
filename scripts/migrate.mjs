// مشغّل ترحيلات بسيط: ينفّذ ملفات db/migrations بالترتيب مرة واحدة لكل ملف.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL غير معرّف. انسخ .env.example إلى .env واضبطه.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const dir = path.resolve('db/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const done = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [f]);
  if (done.rowCount) { console.log('✓ سبق تطبيقه:', f); continue; }
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('✔ تم تطبيق:', f);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✘ فشل:', f, '\n', e.message);
    process.exit(1);
  }
}
await client.end();
