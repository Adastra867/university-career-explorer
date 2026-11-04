import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  const listener = createServer(); listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  await Promise.race([ended, wait(3000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
}

test('actual process restart preserves guest/admin sessions and submitted snapshots; private routes remain closed', { timeout: 45000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'career-persist-'));
  const database = join(directory, 'persistent.sqlite');
  const password = `fixture-${randomUUID()}`;
  const env = { ...process.env, NODE_ENV: 'test', JOURNEY_LOAD_ENV: 'false', JOURNEY_ENABLED: 'false', CAREER_AI_ENABLED: 'false', JOURNEY_AI_ENABLED: 'false', CAREER_DB_PATH: database, CAREER_PUBLIC_URL: '', CAREER_ADMIN_USERNAME: 'persistence-fixture', CAREER_ADMIN_PASSWORD: password, CAREER_ADMIN_DISPLAY_NAME: '虚构持久化测试组织者' };
  for (const key of Object.keys(env)) if (/(?:API_KEY|ACCESS_TOKEN|SECRET|BASE_URL|AI_MODEL)$/.test(key)) delete env[key];
  let child;
  t.after(async () => {
    await stop(child);
    const target = resolve(directory), intendedRoot = resolve(tmpdir());
    assert.equal(dirname(target).toLowerCase(), intendedRoot.toLowerCase());
    assert.ok(basename(target).startsWith('career-persist-'));
    rmSync(target, { recursive: true, force: true });
  });
  const initialized = spawnSync(process.execPath, ['scripts/career-admin.mjs'], { cwd: workspace, env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /管理员已创建/);

  async function start() {
    const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], { cwd: workspace, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', spawnError;
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
    child.once('error', error => { spawnError = error; });
    for (let attempt = 0; attempt < 160; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Server exited before ready: ${output}`);
      try { const response = await fetch(`${base}/api/career/status`, { signal: AbortSignal.timeout(300) }); if (response.ok) return base; } catch { /* Wait for the actual HTTP listener. */ }
      await wait(50);
    }
    throw new Error(`Server failed to start: ${output}`);
  }
  let base = await start();
  function identity() {
    const jar = new Map(); let csrf = '';
    return { async call(method, path, body) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const set of response.headers.getSetCookie()) { const [pair] = set.split(';'), at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
      const value = await response.json(); if (value.csrf_token) csrf = value.csrf_token;
      return { status: response.status, body: value };
    } };
  }
  const admin = identity(), guest = identity();
  assert.equal((await admin.call('POST', '/api/admin/login', { username: env.CAREER_ADMIN_USERNAME, password })).status, 200);
  const campaign = (await admin.call('POST', '/api/admin/campaigns', { name: '虚构重启验证活动', description: '仅集成测试使用', scope: '本次输入、相关资料及结果' })).body;
  const session = await guest.call('POST', '/api/guest-session', { consent: true, notice_version: 'p0-v1' });
  assert.equal(session.status, 200);
  let intake = (await guest.call('POST', '/api/intakes', { task_type: 'explore_direction', campaign_slug: campaign.slug, input: '大一，能源专业，没有项目和实习，不知道做什么' })).body;
  const analyzed = await guest.call('POST', `/api/intakes/${intake.id}/turns`, { expected_revision: intake.input_revision, action: 'generate', idempotency_key: randomUUID() });
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.body)); intake = analyzed.body;
  assert.equal(intake.mode, 'rules');
  assert.equal(intake.question, null);
  assert.equal(intake.result.options.length, 3);
  const preview = (await guest.call('POST', `/api/intakes/${intake.id}/submission-preview`, {})).body;
  const submitted = await guest.call('POST', '/api/submissions', { preview_id: preview.preview_id, idempotency_key: randomUUID() });
  assert.equal(submitted.status, 201);
  const before = (await admin.call('GET', `/api/admin/submissions/${submitted.body.id}`)).body;
  assert.equal(before.snapshot.profile.fields['education.major'].value, '能源专业');
  assert.equal(before.snapshot.mode, 'rules');

  await stop(child);
  base = await start();
  const restored = await admin.call('GET', `/api/admin/submissions/${submitted.body.id}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body, before);
  const personal = await guest.call('GET', `/api/intakes/${intake.id}`);
  assert.equal(personal.status, 200);
  assert.equal(personal.body.input, intake.input);
  assert.equal((await admin.call('GET', '/api/admin/submissions')).body.total, 1);
  assert.equal((await guest.call('GET', '/api/me/submissions')).body.items[0].id, submitted.body.id);

  for (const path of ['/p0/api.js', '/p0/store.js', '/p0/migrations/001_initial.sql', '/data/career.sqlite', '/data/persistent.sqlite', '/artifacts', '/artifacts/p0/student-mobile.png', '/docs/CAREER_P0_HANDOFF.md', '/server.js', '/p0%2fapi.js', '/data%5ccareer.sqlite', '/docs%2fCAREER_P0_HANDOFF.md']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, `Private route exposed: ${path}`);
  }
  assert.equal((await fetch(base + '/start')).status, 200);
  assert.equal((await fetch(base + '/admin')).status, 200);
  assert.equal((await fetch(base + '/p0/start.js')).status, 200);
});
