import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertTestDatabase } from './helpers/environment.js';
assertTestDatabase(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, migrate, transaction } = await import('../src/db.js');
const { saveWorkspace, loadWorkspace, exportAccount } = await import('../src/services/workspace.js');

test('database integrity, concurrency, migrations and cascade deletion', { timeout: 30000 }, async t => {
  await migrate();
  const userId = randomUUID();
  t.after(async () => { await pool.query('DELETE FROM users WHERE id=$1', [userId]); await pool.end(); });
  await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [userId, `database-${userId}@example.com`, 'test-only-hash']);
  await pool.query('INSERT INTO user_state(user_id) VALUES($1)', [userId]);
  await t.test('database rejects invalid JSON shapes, duplicate emails, orphans and negative versions', async () => {
    await assert.rejects(pool.query('UPDATE user_state SET prep=$2 WHERE user_id=$1', [userId, '[]']), { code: '23514' });
    await assert.rejects(pool.query('UPDATE user_state SET version=-1 WHERE user_id=$1', [userId]), { code: '23514' });
    await assert.rejects(pool.query('INSERT INTO profiles VALUES($1,$2)', [randomUUID(), '{}']), { code: '23503' });
    await assert.rejects(pool.query('INSERT INTO users VALUES($1,$2,$3)', [randomUUID(), `database-${userId}@example.com`, 'hash']), { code: '23505' });
    await assert.rejects(pool.query('INSERT INTO reports VALUES($1,$2,$3)', [userId, 'a', { id: 'b', snapshot: {} }]), { code: '23514' });
    await assert.rejects(pool.query('INSERT INTO reports VALUES($1,$2,$3)', [userId, 'null-id', { id: null, snapshot: {} }]), { code: '23514' });
    await assert.rejects(pool.query('INSERT INTO reports VALUES($1,$2,$3)', [userId, '1', { id: 1, snapshot: {} }]), { code: '23514' });
    await assert.rejects(pool.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)', [randomUUID(), userId, '']), { code: '23514' });
  });
  const snapshot = { version: 0, appData: { studentProfile: { major: '计算机' } }, history: [{ id: 'report-1', snapshot: {} }], prep: {} };
  await t.test('simultaneous saves accept one version and reject the other without partial writes', async () => {
    const results = await Promise.allSettled([saveWorkspace(userId, snapshot), saveWorkspace(userId, { ...snapshot, appData: { studentProfile: { major: '机械' } } })]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(results.find(x => x.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    assert.equal((await loadWorkspace(userId)).version, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM reports WHERE user_id=$1', [userId])).rows[0].n, 1);
  });
  await t.test('failed saves roll back the version and unchanged reports are not rewritten', async () => {
    const before = (await pool.query('SELECT xmin::text AS revision FROM reports WHERE user_id=$1', [userId])).rows[0].revision;
    await assert.rejects(saveWorkspace(userId, { ...snapshot, version: 1, history: [{ id: 'invalid-report', snapshot: [] }] }), { code: '23514' });
    assert.equal((await loadWorkspace(userId)).version, 1);
    await saveWorkspace(userId, { ...snapshot, version: 1 });
    const after = (await pool.query('SELECT xmin::text AS revision FROM reports WHERE user_id=$1', [userId])).rows[0].revision;
    assert.equal(before, after);
    assert.equal((await exportAccount(userId)).history.length, 1);
  });
  await t.test('applied migrations are idempotent and altered files are rejected', async () => {
    const count = Number((await pool.query('SELECT count(*) AS n FROM schema_migrations')).rows[0].n);
    await migrate();
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM schema_migrations')).rows[0].n), count);
    const folder = await mkdtemp(join(tmpdir(), 'career-migrations-'));
    const directory = pathToFileURL(folder + '/');
    try {
      for (const name of await readdir(new URL('../migrations/', import.meta.url))) await writeFile(new URL(name, directory), await readFile(new URL('../migrations/' + name, import.meta.url)));
      const original = await readFile(new URL('001_initial.sql', directory), 'utf8');
      await writeFile(new URL('001_initial.sql', directory), original + '\n-- unexpected edit');
      await assert.rejects(migrate({ directory }), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
      await writeFile(new URL('001_initial.sql', directory), original);
      await writeFile(new URL('900_test_probe.sql', directory), 'CREATE TABLE migration_failure_probe(id integer);');
      await writeFile(new URL('901_test_failure.sql', directory), 'THIS IS NOT SQL;');
      await assert.rejects(migrate({ directory }), { code: '42601' });
      assert.equal((await pool.query("SELECT to_regclass('migration_failure_probe') AS name")).rows[0].name, null);
      assert.equal((await pool.query("SELECT 1 FROM schema_migrations WHERE name='900_test_probe.sql'")).rowCount, 0);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  await t.test('deleting a user removes owned data and preserves the global spending counter', async () => {
    const conversation = randomUUID();
    await pool.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)', [conversation, userId, 'test']);
    await pool.query('INSERT INTO messages(conversation_id,role,content,request_id) VALUES($1,$2,$3,$4)', [conversation, 'user', 'test', randomUUID()]);
    await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 day')", [randomUUID(), userId]);
    await pool.query('INSERT INTO ai_daily_usage(user_id,requests) VALUES($1,1)', [userId]);
    await pool.query('INSERT INTO ai_service_usage(requests) VALUES(1) ON CONFLICT(day) DO NOTHING');
    await transaction(client => client.query('DELETE FROM users WHERE id=$1', [userId]));
    for (const table of ['profiles', 'assessments', 'reports', 'sessions', 'user_state', 'conversations', 'ai_daily_usage']) assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`, [userId])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM messages WHERE conversation_id=$1', [conversation])).rowCount, 0);
    assert.ok((await pool.query('SELECT 1 FROM ai_service_usage WHERE day=CURRENT_DATE')).rowCount);
  });
});
