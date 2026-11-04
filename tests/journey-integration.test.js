import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createGraph } from '../journey/graph.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function unusedPort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

// Use raw HTTP paths: fetch/URL would normalize backslashes and dot segments
// before the application has a chance to validate them.
function request(port, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`Request timeout: ${method} ${path}`)));
    req.end(payload);
  });
}

async function startOwnedServer(t, enabled) {
  const port = await unusedPort();
  const env = { ...process.env, PORT: String(port), JOURNEY_LOAD_ENV: 'false' };
  // Tests must never borrow a user's live provider credentials or make an
  // external AI/search call. No existing browser profile or saved graph is used.
  for (const name of Object.keys(env)) {
    if (/^(JOURNEY_AI_|COZE_|OPENAI_)/i.test(name)) delete env[name];
  }
  delete env.JOURNEY_ENABLED;
  if (!enabled) env.JOURNEY_ENABLED = 'false';
  const child = spawn(process.execPath, [resolve(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let startupError;
  child.on('error', error => { startupError = error; });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    let timer;
    try {
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); })]);
    } finally { clearTimeout(timer); }
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned test server exited before ready: ${child.exitCode ?? child.signalCode}`);
    try {
      if ((await request(port, '/index.html')).status === 200) return port;
    } catch (_) { /* The owned child may still be loading modules. */ }
    await delay(50);
  }
  throw new Error('Owned test server did not become ready within 10 seconds');
}

async function assertLegacyPages(port, includeRoot = false) {
  const pages = [['/index.html', 'index.html'], ['/job-search.html', 'job-search.html'], ['/career-prep.html', 'career-prep.html']];
  if (includeRoot) pages.unshift(['/', 'index.html']);
  for (const [path, file] of pages) {
    const response = await request(port, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.text, await readFile(resolve(ROOT, file), 'utf8'), `${path} must serve its existing source unchanged`);
  }
}

const protectedPaths = [
  '/journey/server.js', '/server.js', '/server.js::$DATA', '/server.js.', '/server.js%20', '/server%2ejs',
  '/journey%2fserver.js', '/journey%5cserver.js', '/journey\\server.js',
  '/tests/journey-integration.test.js', '/tests%2fjourney-api.test.js', '/tests%5cjourney-graph.test.js', '/Tests/journey-store.test.js',
  '/node_modules/express/package.json',
];

async function assertMissingPaths(port, paths) {
  for (const path of paths) assert.equal((await request(port, path)).status, 404, `GET ${path}`);
}

async function assertLegacySearch(port) {
  // Synthetic job input reaches the old route, whose missing-key result is
  // explicitly unavailable; a 404 here would mean the flag broke that route.
  const response = await request(port, '/api/search-jobs', { method: 'POST', body: { query: '集成测试数据分析师', location: '测试城市', count: 1 } });
  assert.equal(response.status, 503);
  const body = JSON.parse(response.text);
  assert.equal(body.success, false);
  assert.equal(body.code, 'SEARCH_NOT_CONFIGURED');
  const invalid = await request(port, '/api/recommend-jobs', { method: 'POST', body: {} });
  assert.equal(invalid.status, 400, 'existing recommendation route remains registered');
}

test('root server enables the three Journey layers while retaining the existing application', { timeout: 20000 }, async t => {
  const port = await startOwnedServer(t, true);
  await t.test('assessment entry and both old standalone pages remain byte-for-byte unchanged', () => assertLegacyPages(port, true));
  await t.test('independent page and every allowed stylesheet/module are served', async () => {
    for (const path of ['/trees', '/trees/', '/trees/test-synthetic-id', '/journey', '/journey/']) {
      const response = await request(port, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.text, await readFile(resolve(ROOT, 'journey/index.html'), 'utf8'));
    }
    for (const asset of ['index.html', 'style.css', 'workspace.css', 'app.js', 'graph.js', 'store.js', 'forest.js', 'forest.css']) {
      const response = await request(port, `/journey/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.equal(response.text, await readFile(resolve(ROOT, 'journey', asset), 'utf8'), asset);
    }
  });
  await t.test('server, test and dependency source cannot escape the static allowlist', () => assertMissingPaths(port, protectedPaths));
  await t.test('unconfigured AI status and chat/propose return honest availability', async () => {
    const status = await request(port, '/api/journey/ai/status');
    assert.equal(status.status, 200);
    const availability = JSON.parse(status.text);
    assert.equal(availability.configured, false);
    assert.equal(availability.storage, 'local');
    const graph = createGraph({ title: '集成测试的临时人生树' });
    const before = JSON.stringify(graph);
    for (const endpoint of ['chat', 'propose']) {
      const response = await request(port, `/api/journey/ai/${endpoint}`, { method: 'POST', body: { graph, selectedNodeIds: [graph.rootNodeId], scope: 'node', message: '这是合成测试请求。', history: [] } });
      assert.equal(response.status, 503, endpoint);
      assert.equal(JSON.parse(response.text).code, 'AI_NOT_CONFIGURED', endpoint);
    }
    assert.equal(JSON.stringify(graph), before);
  });
  await t.test('old search routes retain their missing-key and validation responses', () => assertLegacySearch(port));
});

test('JOURNEY_ENABLED=false hides the complete new namespace and preserves old routes', { timeout: 20000 }, async t => {
  const port = await startOwnedServer(t, false);
  await t.test('old homepage, search and preparation remain available', () => assertLegacyPages(port, true));
  await t.test('literal, encoded, backslash, case and Windows-normalized Journey paths all return 404', async () => {
    await assertMissingPaths(port, [
      '/journey', '/journey/', '/journey/index.html', '/journey/style.css', '/journey/workspace.css', '/journey/app.js', '/journey/graph.js', '/journey/store.js',
      '/trees', '/trees/', '/trees/test-synthetic-id', '/Trees/test-synthetic-id', '/%74rees/test-synthetic-id', '/trees%2ftest-synthetic-id', '/trees\\test-synthetic-id',
      '/Journey', '/JOURNEY/index.html', '/%6aourney', '/%6AourNeY%2Fapp.js',
      '/journey%2findex.html', '/journey%5cindex.html', '/journey\\index.html', '/journey./index.html', '/journey%20/index.html',
      '/api/journey/ai/status', '/API/JOURNEY/AI/STATUS', '/api%2fjourney%2fai%2fstatus', '/api%5cjourney%5cai%5cstatus', '/api\\journey\\ai\\status', '/api/%6aourney/ai/status',
      ...protectedPaths,
    ]);
    for (const path of ['/api/journey/ai/chat', '/API/JOURNEY/ai/propose', '/api%2fjourney%2fai%2fpropose', '/api%5cjourney%5cai%5cvalidate']) {
      assert.equal((await request(port, path, { method: 'POST', body: { synthetic: true } })).status, 404, `POST ${path}`);
    }
  });
  await t.test('disabling Journey leaves old search routes registered', () => assertLegacySearch(port));
});
