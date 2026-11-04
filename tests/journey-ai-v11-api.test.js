import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createJourneyRouter } from '../journey/server.js';
import { applyOperations } from '../journey/graph.js';
import { partialAnswer } from '../journey/ai-provider.js';

// All providers below are explicitly allowlisted local HTTP test fixtures, never live DeepSeek.
const AT = '2026-10-14T01:00:00.000Z', KEY = 'controlled-test-fixture-key';
function node(id, title, kind = 'career', privateNode = false) { return { id, title, kind, description: '', phase: 'planned', origin: 'user', knowledgeStatus: 'user_asserted', private: privateNode, position: { x: 0, y: 0 }, createdAt: AT, updatedAt: AT }; }
function edge(id, from, to) { return { id, from, to, relation: 'possible_path', requirements: [], origin: 'user', createdAt: AT }; }
function graph() { return { schemaVersion: 1, graphId: 'v11_fixture_graph', title: '测试树', rootNodeId: 'root', revision: 4, createdAt: AT, updatedAt: AT, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [node('root', '此刻', 'self'), node('major', '材料科学', 'major'), node('goal', '探索研发'), node('child', '已有分支'), node('secret', '私密内容不得发送', 'other', true)], edges: [edge('e1', 'root', 'major'), edge('e2', 'major', 'goal'), edge('e3', 'goal', 'child'), edge('es', 'root', 'secret')], savedPaths: [{ id: 'saved_route', title: '研发路线', edgeIds: ['e1', 'e2'], selectedAt: AT, note: '' }] }; }
function body(extra = {}) { return { graph: graph(), selectedNodeIds: ['goal'], scope: 'path', focusedPathEdgeIds: ['e1', 'e2'], message: '下一步怎么探索？', history: [], clientRequestId: 'request_1', ...extra }; }
function answer(extra = {}) { return { answer: '沿材料科学探索研发。\n先做小项目🙂', proposedOperations: [], caveats: [], ...extra }; }
function suggestions() { return { options: ['跨学科项目', '行业访谈', '小规模实习'].map(title => ({ title, nodeKind: 'milestone', rationale: `可围绕材料科学开展${title}`, prerequisites: ['具体要求待核实'], uncertainty: '先验证兴趣，不保证结果' })) }; }
function turn(extra = {}) { return { turnId: 'turn_1', question: '我应该准备什么？', answer: '可以先做一个材料项目。', status: 'completed', createdAt: AT, updatedAt: AT, scope: 'node', focusNodeIds: ['goal'], citations: [], ...extra }; }
function summary(extra = {}) { return { title: '材料研发探索', currentState: '用户已经获得硕士学位。', destination: '计划探索材料研发', motivation: ['问答中在考虑准备项目'], requiredPreparation: [{ item: '尝试一个小项目', evidenceStatus: 'needs_verification', supportingTurnIds: ['turn_1'] }], risksAndUnknowns: ['具体岗位条件待核实'], nextActions: ['核实一个目标岗位'], sourceTurnIds: ['turn_1'], ...extra }; }
async function listen(t, app) { const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); return `http://127.0.0.1:${server.address().port}`; }
async function provider(t, handler) { const captures = []; const app = express(); app.use(express.json()); app.post('/chat/completions', (req, res) => { captures.push(req.body); handler(req, res, captures.length); }); const origin = await listen(t, app); return { captures, env: { JOURNEY_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: KEY, DEEPSEEK_BASE_URL: origin, DEEPSEEK_MODEL: 'deepseek-flash', JOURNEY_AI_ALLOWED_BASE_URLS: origin } }; }
function envelope(res, value, finish = 'stop') { res.json({ choices: [{ message: { content: JSON.stringify(value) }, ...(finish == null ? {} : { finish_reason: finish }) }] }); }
async function api(t, options = {}) { const app = express(); app.use('/api/journey', createJourneyRouter({ rateLimitMs: 0, maxRetries: 0, ...options })); return listen(t, app); }
async function post(origin, path, payload, headers = {}) { const response = await fetch(`${origin}/api/journey${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) }); return { status: response.status, body: await response.json() }; }
async function events(origin, payload) { const response = await fetch(`${origin}/api/journey/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, stream: true }) }); const text = await response.text(); return { status: response.status, contentType: response.headers.get('content-type'), events: text.split('\n\n').filter(Boolean).map(block => ({ event: block.match(/event: (.+)/)?.[1], data: JSON.parse(block.match(/data: (.+)/)[1]) })) }; }
function stream(res, value, { done = true, finish = 'stop' } = {}) { res.set('Content-Type', 'text/event-stream'); const content = JSON.stringify(value); for (let at = 0; at < content.length; at += 7) { const packet = `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(at, at + 7) }, finish_reason: null }] })}\r\n\r\n`; res.write(packet.slice(0, 11)); res.write(packet.slice(11)); } res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\r\n\r\n`); if (done) res.write('data: [DONE]\r\n\r\n'); res.end(); }

test('configuration is environment-only, four-state status is honest and admin test is minimal', async t => {
  let unauthorized = false;
  const fixture = await provider(t, (req, res) => { if (unauthorized) return res.status(401).json({ error: KEY }); if (req.body.max_tokens === 16) return res.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }); envelope(res, answer()); });
  const origin = await api(t, { env: { ...fixture.env, JOURNEY_AI_ADMIN_TOKEN: 'fixture-admin-token', JOURNEY_AI_MAX_OUTPUT_TOKENS: '1200' } });
  const status = () => fetch(`${origin}/api/journey/ai/config/status`).then(r => r.json());
  assert.equal((await status()).state, 'configured');
  assert.equal((await post(origin, '/ai/config/test', { apiKey: KEY, model: 'client-override' })).status, 403);
  assert.equal(fixture.captures.length, 0);
  const tested = await post(origin, '/ai/config/test', {}, { Authorization: 'Bearer fixture-admin-token' });
  assert.equal(tested.body.status, 'connected'); assert.equal((await status()).state, 'connected');
  assert.equal(fixture.captures[0].max_tokens, 16); assert.equal('response_format' in fixture.captures[0], false);
  assert.equal((await post(origin, '/ai/config/test', {}, { Authorization: 'Bearer fixture-admin-token' })).status, 429); assert.equal(fixture.captures.length, 1);
  await post(origin, '/ai/chat', body()); assert.equal(fixture.captures[1].max_tokens, 1200);
  unauthorized = true; const failed = await post(origin, '/ai/chat', body()); assert.equal(failed.body.code, 'AI_UNAUTHORIZED'); assert.equal((await status()).state, 'error');
  assert.doesNotMatch(JSON.stringify([tested.body, failed.body, await status()]), new RegExp(KEY));
  const empty = await api(t, { env: {} }); assert.equal((await fetch(`${empty}/api/journey/ai/config/status`).then(r => r.json())).state, 'unconfigured');
  assert.equal((await post(empty, '/ai/config/test', {})).status, 403);
});

test('DeepSeek URLs require official origin or an explicit exact environment allowlist and disabling prevents calls', async t => {
  const fixture = await provider(t, (req, res) => envelope(res, answer()));
  for (const overrides of [{ JOURNEY_AI_ALLOWED_BASE_URLS: '' }, { JOURNEY_AI_ENABLED: 'false' }, { DEEPSEEK_BASE_URL: 'https://api.deepseek.com.evil.example' }]) {
    const origin = await api(t, { env: { ...fixture.env, ...overrides } });
    assert.equal((await fetch(`${origin}/api/journey/ai/status`).then(r => r.json())).configured, false);
    assert.equal((await post(origin, '/ai/chat', body())).status, 503);
  }
  assert.equal(fixture.captures.length, 0);
});

test('real provider SSE becomes human answer deltas and a complete normalized local result', async t => {
  const fixture = await provider(t, (req, res) => stream(res, answer())); const origin = await api(t, { env: fixture.env });
  const result = await events(origin, body({ turnId: 'turn_stream' }));
  assert.match(result.contentType, /text\/event-stream/);
  assert.equal(result.events.filter(e => e.event === 'answer_delta').map(e => e.data.text).join(''), answer().answer);
  const completed = result.events.at(-1); assert.equal(completed.event, 'answer_completed'); assert.equal(completed.data.turnId, 'turn_stream'); assert.equal(completed.data.answer, answer().answer); assert.equal(completed.data.usedGraphRevision, 4); assert.equal(completed.data.model, 'deepseek-flash'); assert.deepEqual(completed.data.proposedOperations, []);
  assert.equal(fixture.captures[0].stream, true); assert.doesNotMatch(JSON.stringify(fixture.captures[0]), /私密内容不得发送/);
});

test('SSE truncation, missing DONE and malformed JSON fail rather than complete', async t => {
  let mode = 'length'; const fixture = await provider(t, (req, res) => { if (mode === 'bad') { res.set('Content-Type', 'text/event-stream'); return res.end('data: not json\n\n'); } stream(res, answer(), { finish: mode === 'length' ? 'length' : 'stop', done: mode !== 'missing' }); }); const origin = await api(t, { env: fixture.env });
  for (mode of ['length', 'missing', 'bad']) { const result = await events(origin, body()); assert.equal(result.events.at(-1).event, 'answer_failed'); assert.equal(result.events.at(-1).data.code, 'AI_INVALID_RESPONSE'); assert(!result.events.some(e => e.event === 'answer_completed')); }
});

test('old JSON provider fallback still supports stream callers while explicit truncation fails', async t => {
  let finish = null; const fixture = await provider(t, (req, res) => envelope(res, answer(), finish)); const origin = await api(t, { env: fixture.env });
  assert.equal((await events(origin, body())).events.at(-1).event, 'answer_completed');
  finish = 'length'; assert.equal((await events(origin, body())).events.at(-1).event, 'answer_failed');
  assert.equal(partialAnswer('{"other":{"answer":"hidden"},"answer":"hi\\u4f60\\n'), 'hi你\n');
});

test('finite retry only covers 429/5xx, never authentication or balance failures', async t => {
  let mode = 'retry'; const fixture = await provider(t, (req, res, count) => { if (mode === 'retry' && count <= 2) return res.status(count === 1 ? 429 : 500).end(); if (mode !== 'retry') return res.status(mode === 'auth' ? 401 : 402).end(); envelope(res, answer()); }); const origin = await api(t, { env: { ...fixture.env, JOURNEY_AI_ADMIN_TOKEN: 'admin' }, maxRetries: 2, retryDelayMs: 1 });
  assert.equal((await post(origin, '/ai/chat', body())).status, 200); assert.equal(fixture.captures.length, 3);
  mode = 'auth'; assert.equal((await post(origin, '/ai/chat', body())).body.code, 'AI_UNAUTHORIZED'); assert.equal(fixture.captures.length, 4);
  mode = 'balance'; assert.equal((await post(origin, '/ai/config/test', {}, { Authorization: 'Bearer admin' })).body.status, 'insufficient_balance'); assert.equal(fixture.captures.length, 5);
});

test('SSE timeout releases concurrency and a following request can succeed', async t => {
  let hold = true; const fixture = await provider(t, (req, res) => { if (hold) { res.set('Content-Type', 'text/event-stream'); res.flushHeaders(); return; } stream(res, answer()); }); const origin = await api(t, { env: fixture.env, timeoutMs: 50, maxConcurrent: 1 });
  const failed = await events(origin, body()); assert.equal(failed.events.at(-1).data.code, 'AI_TIMEOUT');
  hold = false; assert.equal((await events(origin, body())).events.at(-1).event, 'answer_completed');
});

test('browser-style SSE disconnect cancels upstream and releases the concurrency slot', async t => {
  let hold = true, disconnected;
  const upstreamClosed = new Promise(resolve => { disconnected = resolve; });
  const fixture = await provider(t, (req, res) => { if (hold) { res.on('close', disconnected); res.set('Content-Type', 'text/event-stream'); res.flushHeaders(); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"answer":"部分' }, finish_reason: null }] })}\n\n`); return; } stream(res, answer()); });
  const origin = await api(t, { env: fixture.env, maxConcurrent: 1 });
  const controller = new AbortController(); const response = await fetch(`${origin}/api/journey/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ stream: true })), signal: controller.signal });
  const reader = response.body.getReader(); await reader.read(); controller.abort(); await reader.cancel().catch(() => {}); await upstreamClosed;
  hold = false; assert.equal((await events(origin, body())).events.at(-1).event, 'answer_completed');
});

test('three candidates are read-only, deduplicate generation and 1–3 choices form one valid AI transaction', async t => {
  const fixture = await provider(t, (req, res) => envelope(res, suggestions())); const origin = await api(t, { env: fixture.env }); const snapshot = graph(), before = JSON.stringify(snapshot);
  const payload = body({ graph: snapshot }); const generated = await post(origin, '/nodes/goal/ai-suggestions', payload);
  assert.equal(generated.status, 200); assert.equal(generated.body.options.length, 3); assert(generated.body.options.every(o => o.knowledgeStatus === 'unverified')); assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual((await post(origin, '/nodes/goal/ai-suggestions', payload)).body, generated.body); assert.equal(fixture.captures.length, 1);
  const captured = JSON.parse(fixture.captures[0].messages.at(-1).content); assert.equal(captured.existing_children[0].title, '已有分支');
  for (const count of [1, 2, 3]) {
    const set = count === 1 ? generated.body : (await post(origin, '/nodes/goal/ai-suggestions', body({ clientRequestId: `create_${count}` }))).body;
    const apply = { graph: snapshot, expectedRevision: 4, token: set.token, clientRequestId: `apply_${count}`, selectedOptions: set.options.slice(0, count).map(o => ({ optionId: o.optionId, title: `${o.title}（修改）` })) };
    const checked = await post(origin, `/ai-suggestions/${set.id}/apply`, apply); assert.equal(checked.status, 200); assert.equal(checked.body.proposedOperations.length, count * 2);
    const next = applyOperations(snapshot, checked.body.proposedOperations, 4, { origin: 'ai' }); assert.equal(next.nodes.length, snapshot.nodes.length + count); assert(next.nodes.slice(-count).every(n => n.origin === 'ai' && n.knowledgeStatus === 'unverified'));
    assert.deepEqual((await post(origin, `/ai-suggestions/${set.id}/apply`, apply)).body, checked.body);
    const changed = structuredClone(apply); changed.graph.revision++; changed.expectedRevision++; assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, changed)).status, 409);
  }
});

test('candidate validation rejects wrong count, duplicates, existing children, HTML, verified claims and illegal kinds', async t => {
  let value = suggestions(), finish = 'stop'; const fixture = await provider(t, (req, res) => envelope(res, value, finish)); const origin = await api(t, { env: fixture.env });
  const invalid = [s => s.options.pop(), s => { s.options[1].title = s.options[0].title; }, s => { s.options[0].title = '已有分支'; }, s => { s.options[0].rationale = '<img src=x onerror=alert(1)>'; }, s => { s.options[0].knowledgeStatus = 'verified'; }, s => { s.options[0].nodeKind = 'robot'; }];
  for (let i = 0; i < invalid.length; i++) { value = suggestions(); invalid[i](value); const result = await post(origin, '/nodes/goal/ai-suggestions', body({ clientRequestId: `invalid_${i}` })); assert.equal(result.status, 422); assert.equal(result.body.code, 'AI_INVALID_RESPONSE'); }
  value = suggestions(); finish = 'length'; assert.equal((await post(origin, '/nodes/goal/ai-suggestions', body({ clientRequestId: 'truncated' }))).status, 422);
});

test('ambiguous ancestry needs a chosen path and forged or expired selections never produce operations', async t => {
  let current = Date.parse(AT); const fixture = await provider(t, (req, res) => envelope(res, suggestions())); const origin = await api(t, { env: fixture.env, now: () => current, maxProposalAgeMs: 1000 });
  const fork = graph(); fork.nodes.push(node('other', '另一上游')); fork.edges.push(edge('f1', 'root', 'other'), edge('f2', 'other', 'goal'));
  const ambiguous = body({ graph: fork }); delete ambiguous.focusedPathEdgeIds;
  assert.equal((await post(origin, '/nodes/goal/ai-suggestions', ambiguous)).body.code, 'PATH_SELECTION_REQUIRED'); assert.equal(fixture.captures.length, 0);
  const set = (await post(origin, '/nodes/goal/ai-suggestions', body({ graph: fork }))).body;
  const input = { graph: fork, expectedRevision: 4, token: set.token, clientRequestId: 'apply', selectedOptions: [{ optionId: set.options[0].optionId, title: '新的标题' }] };
  assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, { ...input, token: `${set.token}x` })).status, 422);
  assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, { ...input, selectedOptions: [{ optionId: 'fake', title: '冒充候选' }] })).status, 422);
  assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, input)).status, 200);
  assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, { ...input, selectedOptions: [{ optionId: set.options[1].optionId, title: '不同选择' }] })).status, 409);
  current += 1001; assert.equal((await post(origin, `/ai-suggestions/${set.id}/apply`, input)).body.code, 'PROPOSAL_EXPIRED');
});

test('summary only receives authorized related turns, preserves provenance and cannot infer personal facts from a question', async t => {
  const fixture = await provider(t, (req, res) => envelope(res, summary())); const origin = await api(t, { env: fixture.env }); const payload = body({ turns: [turn()] });
  const result = await post(origin, '/paths/saved_route/summary/draft', payload); assert.equal(result.status, 200); assert.equal(result.body.draft.status, 'draft'); assert.equal(result.body.draft.savedPathId, 'saved_route'); assert.deepEqual(result.body.draft.sourceTurnIds, ['turn_1']); assert.match(result.body.draft.currentState, /尚无用户明示/); assert.equal(result.body.usedGraphRevision, 4);
  assert.deepEqual((await post(origin, '/paths/saved_route/summary/draft', payload)).body, result.body); assert.equal(fixture.captures.length, 1);
  const context = JSON.parse(fixture.captures[0].messages.at(-1).content); assert.equal(context.turns.length, 1); assert.deepEqual(context.explicit_user_facts, []); assert.doesNotMatch(JSON.stringify(context), /私密内容不得发送/);
  const unrelated = await post(origin, '/paths/saved_route/summary/draft', body({ clientRequestId: 'unrelated', turns: [turn({ focusNodeIds: ['secret'] })] })); assert.equal(unrelated.status, 403); assert.equal(unrelated.body.code, 'TURN_SCOPE_MISMATCH'); assert.equal(fixture.captures.length, 1);
  const broad = await post(origin, '/paths/saved_route/summary/draft', body({ clientRequestId: 'tree_turn', turns: [turn({ scope: 'tree' })] })); assert.equal(broad.status, 403);
});

test('summary rejects invented turn/source citations and client-declared official provenance', async t => {
  let value = summary(); const fixture = await provider(t, (req, res) => envelope(res, value)); const origin = await api(t, { env: fixture.env });
  for (const [id, patch] of [['fake_turn', { sourceTurnIds: ['unknown_turn'] }], ['fake_source', { requiredPreparation: [{ item: '资格', evidenceStatus: 'sourced_fact', supportingTurnIds: ['turn_1'], sourceIds: ['invented'] }] }]]) { value = summary(patch); assert.equal((await post(origin, '/paths/saved_route/summary/draft', body({ clientRequestId: id, turns: [turn()] }))).status, 422); }
  const g = graph(); g.sources = [{ id: 'claimed_official', title: '客户端声明', checkedAt: AT, trustLevel: 'official', url: 'https://example.org', contentHash: 'fake-hash' }];
  value = summary({ requiredPreparation: [{ item: '资格', evidenceStatus: 'sourced_fact', supportingTurnIds: ['turn_1'], sourceIds: ['claimed_official'] }] });
  assert.equal((await post(origin, '/paths/saved_route/summary/draft', body({ graph: g, clientRequestId: 'spoofed_official', turns: [turn({ citations: [{ sourceId: 'claimed_official' }] })] }))).status, 422);
});

test('other public questions require an explicit per-turn additional-context grant', async t => {
  const fixture = await provider(t, (req, res) => envelope(res, summary({ sourceTurnIds: ['turn_1', 'turn_other'] }))); const origin = await api(t, { env: fixture.env });
  const extra = turn({ turnId: 'turn_other', focusNodeIds: ['another_public_node'], scope: 'tree', savedPathId: 'other_saved_route', question: '另一条公开路线有什么取舍？' });
  const payload = body({ turns: [turn(), extra] });
  assert.equal((await post(origin, '/paths/saved_route/summary/draft', payload)).status, 403);
  const granted = await post(origin, '/paths/saved_route/summary/draft', { ...payload, clientRequestId: 'explicit_extra', explicitAdditionalTurnIds: ['turn_other'] });
  assert.equal(granted.status, 200);
  const context = JSON.parse(fixture.captures[0].messages.at(-1).content); assert.equal(context.turns[1].contextRelation, 'explicit_additional_context'); assert(!context.graph_context.nodes.some(n => n.id === 'another_public_node'));
  const privateExtra = body({ clientRequestId: 'private_extra', turns: [turn(), turn({ turnId: 'turn_private', focusNodeIds: ['secret'] })], explicitAdditionalTurnIds: ['turn_private'] });
  assert.equal((await post(origin, '/paths/saved_route/summary/draft', privateExtra)).status, 403);
});
