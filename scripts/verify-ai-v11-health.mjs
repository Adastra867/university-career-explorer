import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createGraph } from '../journey/graph.js';

const origin = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const result = { origin, checkedAt: new Date().toISOString(), liveModelTested: false, routes: [], legacyHashes: [] };
for (const path of ['/', '/index.html', '/job-search.html', '/career-prep.html', '/journey', '/trees', '/trees/health-synthetic-id', '/journey/ai-store.js', '/journey/ai-panels.js', '/journey/ai-integration.js', '/journey/ai-legacy-migration.js', '/journey/ai-v11.css', '/journey/forest-ai.js', '/journey/vendor/pdf.mjs', '/journey/vendor/pdf.worker.mjs']) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  if (path === '/') assert.equal(await response.text(), await readFile('index.html', 'utf8'), 'Legacy homepage is preserved');
  else await response.body.cancel();
  result.routes.push({ path, status: response.status });
}
for (const path of ['/journey/ai-provider.js', '/journey/ai-v11-server.js', '/journey/server.js', '/.env', '/tests/journey-ai-v11-browser.mjs']) {
  const response = await fetch(origin + path); await response.body.cancel();
  assert.equal(response.status, 404, path); result.routes.push({ path, status: response.status });
}
const statusResponse = await fetch(origin + '/api/journey/ai/config/status');
assert.equal(statusResponse.status, 200); result.aiStatus = await statusResponse.json();
assert.ok(!Object.keys(result.aiStatus).some(key => /secret|token|api.?key/i.test(key)));
const denied = await fetch(origin + '/api/journey/ai/config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(denied.status, 403); result.unauthenticatedConnectionTest = { status: denied.status, body: await denied.json() };
if (!result.aiStatus.configured) {
  const graph = createGraph({ title: '健康检查合成树' });
  const response = await fetch(origin + '/api/journey/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph, message: '健康检查合成问题', selectedNodeIds: [graph.rootNodeId], scope: 'node' }) });
  const body = await response.json(); assert.equal(response.status, 503); assert.equal(body.code, 'AI_NOT_CONFIGURED');
  result.unconfiguredChat = { status: response.status, body };
}
const baseline = JSON.parse(await readFile('artifacts/journey/legacy-baseline.json', 'utf8'));
for (const [file, expected] of Object.entries(baseline.files)) {
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  assert.equal(hash, expected, file); result.legacyHashes.push({ file, sha256: hash, unchanged: true });
}
await mkdir('artifacts/journey-ai-v11', { recursive: true });
await writeFile('artifacts/journey-ai-v11/final-health.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ routes: result.routes.length, unchangedLegacyFiles: result.legacyHashes.length, aiState: result.aiStatus.state, origin }));
