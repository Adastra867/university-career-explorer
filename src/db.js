import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const migrationDirectory = new URL('../migrations/', import.meta.url);
export const pool = process.env.DATABASE_URL ? new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000,
  ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
}) : null;
if (pool) pool.on('error', () => console.error('Database connection error'));

export async function transaction(work) {
  if (!pool) throw Object.assign(new Error('数据库尚未配置'), { status: 503, code: 'DATABASE_NOT_CONFIGURED' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { client.release(); }
}

export async function migrate({ directory = migrationDirectory } = {}) {
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(8672026)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now(), checksum text)');
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    for (const name of (await readdir(directory)).filter(value => value.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const applied = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])).rows[0];
      if (applied) {
        if (applied.checksum && applied.checksum !== checksum) throw Object.assign(new Error(`已执行迁移被修改：${name}；请恢复原文件并新增迁移`), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
        // Legacy migrations had no checksum; establish a baseline once without re-running SQL.
        if (!applied.checksum) await client.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [name, checksum]);
        continue;
      }
      await client.query(source);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}

export async function assertSchemaReady() {
  const expected = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql'));
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations WHERE checksum IS NOT NULL')).rows.map(row => row.name));
  if (expected.some(name => !applied.has(name))) throw Object.assign(new Error('数据库迁移未完成'), { code: 'DATABASE_SCHEMA_OUTDATED' });
}
