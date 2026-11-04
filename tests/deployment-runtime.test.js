import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const runtime of [
  { label: 'production', env: { NODE_ENV: 'production', RENDER: '' } },
  { label: 'Render without NODE_ENV', env: { RENDER: 'true' } },
]) {
test(`${runtime.label} without persistent storage serves the site and rejects cloud records without writing a database`, { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'career-deploy-'));
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const env = {
    ...process.env, ...runtime.env, PORT: String(port),
    JOURNEY_LOAD_ENV: 'false', JOURNEY_ENABLED: 'true', CAREER_DB_PATH: '',
    CAREER_AI_ENABLED: 'false', JOURNEY_AI_ENABLED: 'false',
  };
  if (!Object.hasOwn(runtime.env, 'NODE_ENV')) delete env.NODE_ENV;
  // Test this deployment mode independently of a developer's private settings.
  for (const name of Object.keys(env)) if (/(?:API_KEY|ACCESS_TOKEN|SECRET|BASE_URL|AI_MODEL)$/.test(name)) delete env[name];
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '', spawnError;
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.once('error', error => { spawnError = error; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([ended, wait(3000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
    }
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('career-deploy-'));
    rmSync(target, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  // Windows cold starts can spend several seconds loading the SDK. Use an
  // elapsed-time budget so machine load does not turn readiness into a failure.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production server exited: ${output}`);
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the HTTP listener. */ }
    await wait(50);
  }
  assert.ok(ready, `Production server failed to start: ${output}`);
  for (const path of ['/', '/start', '/admin', '/trees', '/job-search.html', '/p0/start.js', '/journey/app.js']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  for (const [method, path] of [
    ['GET', '/api/career/status'], ['POST', '/api/guest-session'],
    ['GET', '/api/me/profile'], ['POST', '/api/intakes'],
    ['POST', '/api/intakes/fixture/turns'], ['POST', '/api/submissions'],
    ['GET', '/api/admin/session'], ['GET', '/api/admin/campaigns/fixture/qr.svg'],
  ]) {
    const response = await fetch(base + path, {
      method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    });
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    const body = await response.json();
    assert.equal(body.error.code, 'STORAGE_NOT_CONFIGURED');
    assert.match(body.error.message, /持久存储/);
  }
  assert.equal((await fetch(base + '/api/journey/ai/status')).status, 200);
  for (const path of ['/api/search-jobs', '/api/recommend-jobs', '/api/fetch-jd']) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400, `Legacy validation still handles ${path}`);
  }
  assert.equal((await fetch(base + '/api/career/unrelated')).status, 404);
  assert.deepEqual(readdirSync(directory), [], 'Disabled records API must not create data/ or SQLite files');
});
}
