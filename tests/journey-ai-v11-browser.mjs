import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJourneyRouter } from '../journey/server.js';
import { launchBrowser } from './browser-runtime.mjs';

// End-to-end HTTP fixture. No DeepSeek account, real API key, or browser route
// interception is used. Production page/modules/router/provider/SSE parser run.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts/journey-ai-v11');
const AI_KEY = 'shiyu-zuxia.ai.v1';
const FAKE_KEY = 'controlled-http-fixture-not-a-real-api-key';
const ADMIN = 'controlled-http-fixture-admin';
const LABEL = '受控 HTTP 测试应答（非真实 DeepSeek）';
const checks = [], errors = [], calls = [], apiCalls = [], screenshots = [], servers = [], leakedResponses = [];
let browser, context, page, origin, graphA, graphB, rootId, aId, bId, deepId, savedPathId;
let suggestionMode = 'valid', chatMode = 'json', holdRelease, holdArrived, holdResolve, unique = 0;
let env;

async function listen(app) {
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function envelope(res, value, finish = 'stop') {
  res.json({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: finish }] });
}
function upstreamStream(res, value) {
  res.set('Content-Type', 'text/event-stream');
  const text = JSON.stringify(value);
  for (let at = 0; at < text.length; at += 13) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(at, at + 13) }, finish_reason: null }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
}
async function setup() {
  await mkdir(OUT, { recursive: true });
  const provider = express(); provider.use(express.json({ limit: '2mb' }));
  provider.post('/chat/completions', async (req, res) => {
    const input = req.body; calls.push(input);
    if (input.max_tokens === 16) return envelope(res, 'OK');
    const system = input.messages?.[0]?.content || '';
    let data; try { data = JSON.parse(input.messages.at(-1).content); } catch { data = {}; }
    if (system.includes('"options"')) {
      const parent = data.parent_node?.title || '当前节点';
      const serial = ++unique;
      const options = ['项目探索', '访谈准备', '短期尝试'].map((kind, i) => ({ title: `${parent.slice(0, 24)}·${kind}${serial}-${i}`, nodeKind: 'milestone', rationale: `${LABEL}：从 ${parent} 继续考虑${kind}。`, prerequisites: ['具体条件仍待核实'], uncertainty: '这只是候选方向，不保证结果。' }));
      if (suggestionMode === 'invalid-json') return envelope(res, '{broken');
      if (suggestionMode === 'empty') return envelope(res, '');
      if (suggestionMode === 'two') options.pop();
      if (suggestionMode === 'duplicate') options[1].title = options[0].title;
      return envelope(res, { options }, suggestionMode === 'length' ? 'length' : 'stop');
    }
    if (system.includes('requiredPreparation')) {
      const ids = (data.turns || []).slice(0, 3).map(t => t.turnId);
      return envelope(res, { title: `${LABEL}·路线整理`, currentState: '尚无用户明示的当前履历事实。', destination: '计划继续探索材料方向', motivation: ['用户正在比较准备方向，仍待本人确认。'], requiredPreparation: [{ item: '核实一个小项目的准备事项', evidenceStatus: 'needs_verification', supportingTurnIds: ids.slice(0, 1) }], risksAndUnknowns: ['真实岗位条件与时间成本尚未核实'], nextActions: ['先记录一个可以验证的小问题'], sourceTurnIds: ids });
    }
    const mode = chatMode;
    if (mode === 'hold') {
      holdResolve?.();
      await new Promise(resolve => { holdRelease = resolve; });
    }
    if (mode === '401' || mode === '402') return res.status(Number(mode)).json({ error: FAKE_KEY });
    if (mode === 'timeout') return;
    if (mode === 'partial') {
      res.set('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"answer":"受控 HTTP 测试部分回答，未完成' }, finish_reason: null }] })}\n\n`);
      return;
    }
    if (mode === 'bad') return envelope(res, 'not JSON');
    const answer = { answer: `${LABEL}。可以先记录一个小尝试，再由本人判断。\n${mode === 'sse' ? '这段内容经过真实 HTTP SSE 分片。' : '此处为 HTTP JSON 回退。'}`, proposedOperations: [], caveats: ['本地受控 fixture，仅验证交互与存储；未验证真实模型。'] };
    return mode === 'sse' ? upstreamStream(res, answer) : envelope(res, answer);
  });
  const providerOrigin = await listen(provider);
  env = { JOURNEY_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: FAKE_KEY, DEEPSEEK_BASE_URL: providerOrigin, DEEPSEEK_MODEL: 'deepseek-flash', JOURNEY_AI_ALLOWED_BASE_URLS: providerOrigin, JOURNEY_AI_ADMIN_TOKEN: ADMIN };
  const app = express();
  app.use((req, _res, next) => { if (req.path.startsWith('/api/journey')) apiCalls.push({ path: req.path, method: req.method }); next(); });
  app.use('/api/journey', createJourneyRouter({ env, rateLimitMs: 0, maxRetries: 0, retryDelayMs: 1, timeoutMs: 8000 }));
  app.use('/journey', express.static(path.join(ROOT, 'journey'), { index: false, redirect: false }));
  app.get(['/', '/journey', '/trees', '/trees/:id'], (_req, res) => res.sendFile(path.join(ROOT, 'journey/index.html')));
  origin = await listen(app);
  browser = await launchBrowser(); context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/journey/')) response.text().then(text => { if (text.includes(FAKE_KEY)) leakedResponses.push(new URL(response.url()).pathname); }).catch(() => {}); });
  await page.goto(`${origin}/journey`); await page.locator('#start').click();
  await page.waitForURL('**/trees'); await createTree('v1.1 受控测试树 A');
}
async function createTree(title) {
  await page.locator('[data-create="career"]').click();
  await page.locator('#treeName').fill(title); await page.locator('#createTreeSubmit').click();
  await page.waitForURL('**/trees/*'); await page.locator('#canvas').waitFor({ state: 'visible' });
  await page.locator('#aiHistoryBar').waitFor();
}
async function documentState() {
  return page.evaluate(async () => {
    const { TreeLibrary } = await import('/journey/forest.js');
    const id = decodeURIComponent(location.pathname.split('/')[2]);
    return JSON.parse(new TreeLibrary(localStorage).scopedStorage(id).getItem('shiyu-zuxia.graph.v1'));
  });
}
async function state() { await page.locator('#save').click(); return (await documentState()).graph; }
async function aiData() { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{"data":{"turns":[],"narratives":[]}}').data, AI_KEY); }
async function turns(id = graphA) { return (await aiData()).turns.filter(t => t.graphId === id); }
async function waitFor(fn, message, ms = 10000) {
  const start = Date.now(); while (Date.now() - start < ms) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${message}`);
}
async function nodeFocus(id) {
  if (await page.locator('#closeAIHistory').isVisible()) await page.locator('#closeAIHistory').click();
  const g = await state(), node = g.nodes.find(n => n.id === id); assert(node, `node ${id}`);
  await page.locator('#search').fill(node.title); await page.locator('#find').click();
  await waitFor(async () => (await page.locator('#editTitle').inputValue().catch(() => '')) === node.title, 'focus node');
}
async function addNode(parentId, title, kind = 'milestone') {
  await nodeFocus(parentId); await page.locator('#add').click(); await page.locator('#custom').fill(title);
  await page.locator('#newKind').selectOption(kind); await page.locator('#confirmGrow').click();
  return (await state()).nodes.find(n => n.title === title).id;
}
async function openSuggestions(id, valid = true) {
  await nodeFocus(id); await page.locator('#detailAISuggestions').click();
  if (valid) await page.locator('#aiSuggestionOptions .ai-option').nth(2).waitFor();
  else await waitFor(async () => Boolean((await page.locator('#aiSuggestionError').textContent()).trim()), 'candidate error');
}
async function openHistory(mode = 'node') {
  if (!await page.locator('#aiHistoryDrawer').isVisible()) await page.locator('#aiHistoryBar').click();
  await page.locator('#aiHistoryMode').selectOption(mode);
}
async function send(question, { scope = 'node', terminal = true, preserveBinding = false } = {}) {
  await page.locator('#chatTab').click(); if (!preserveBinding) await page.locator('#scope').selectOption(scope);
  await page.locator('#question').fill(question); await page.locator('#send').click();
  const turn = await waitFor(async () => (await turns()).find(t => t.question === question), 'saved question');
  if (!terminal) return turn;
  return waitFor(async () => { const t = (await turns()).find(t => t.turnId === turn.turnId); return t && !['queued', 'generating'].includes(t.status) ? t : null; }, 'terminal answer');
}
async function screenshot(name) {
  await waitFor(async () => !await page.locator('#toast').evaluate(el => el.classList.contains('visible')), 'toast finished', 6000);
  // Screenshot metadata watermark only; removed before any further interaction.
  await page.evaluate(() => { const tag = document.createElement('div'); tag.id = 'browserTestFixtureWatermark'; tag.textContent = '浏览器回归 · 受控 HTTP fixture · 非真实 DeepSeek'; const modal = document.querySelector('dialog[open]'); tag.style.cssText = (modal ? 'position:sticky;top:0;margin:0 0 9px;width:fit-content;' : 'position:fixed;top:2px;left:50%;transform:translateX(-50%);') + 'z-index:2147483647;max-width:96vw;padding:4px 9px;border:1px solid #dabd76;background:#332b18;color:#ffe3a4;border-radius:6px;font:10px/1.4 sans-serif;pointer-events:none;white-space:nowrap'; (modal || document.body).prepend(tag); });
  const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
  await page.locator('#browserTestFixtureWatermark').evaluate(el => el.remove());
}
async function check(name, run) {
  const started = Date.now();
  try { const detail = await run(); checks.push({ name, passed: true, durationMs: Date.now() - started, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, durationMs: Date.now() - started, error: error.stack }); throw error; }
}
async function openNarrative() {
  if (await page.locator('#closeAIHistory').isVisible()) await page.locator('#closeAIHistory').click();
  await page.locator('#paths').click(); await page.locator(`.path-narrative-link[data-path-id="${savedPathId}"]`).click();
  await page.locator('#generateNarrative').waitFor();
}
async function sha(file) { return createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex'); }
const legacyFiles = ['index.html', 'job-search.html', 'career-prep.html', 'scripts/career-prep.js', 'styles/main.css'];
const legacyBefore = await Promise.all(legacyFiles.map(sha));

try {
  await setup();
  await check('真实大厅创建树，DIY 基线与原站存储保持独立', async () => {
    const g = await state(); graphA = g.graphId; rootId = g.rootNodeId;
    aId = await addNode(rootId, '材料方向 A', 'major');
    deepId = await addNode(aId, '研发探索深层', 'career');
    bId = await addNode(rootId, '另一分支 B', 'major');
    await nodeFocus(deepId); await page.locator('#editDescription').fill('本人独立写下的 DIY 说明，不允许 AI 覆盖。'); await page.locator('#nodeForm button[type="submit"]').click();
    await page.locator('#paths').click(); await page.locator('#saveCurrentPath').click(); savedPathId = (await state()).savedPaths[0].id;
    assert.equal((await state()).nodes.length, 4);
    return { graphCreatedViaUI: true, syntheticOnly: true };
  });
  await check('管理员状态只读，错误鉴权不调用模型，正确低成本连接测试不泄漏凭证', async () => {
    await page.locator('#modelSettings').click(); await page.locator('#modelStatusContent').getByText('已配置 · 尚未验证').waitFor();
    assert.equal(await page.locator('#modelSettingsDialog input').count(), 1); assert.equal(await page.locator('#modelAdminToken').getAttribute('type'), 'password');
    assert(await page.locator('#testModelConnection').isDisabled());
    const before = calls.length; await page.locator('#modelAdminToken').fill('wrong'); await page.locator('#testModelConnection').click();
    await page.locator('#modelTestResult').getByText('管理员', { exact: false }).waitFor(); assert.equal(calls.length, before);
    await page.locator('#modelAdminToken').fill(ADMIN); await page.locator('#testModelConnection').click(); await page.locator('#modelTestResult').getByText('连接测试成功。').waitFor();
    assert.equal(calls.at(-1).max_tokens, 16); assert(!JSON.stringify(await page.request.get(`${origin}/api/journey/ai/config/status`).then(r => r.json())).includes(FAKE_KEY));
    await screenshot('model-settings-fixture'); await page.locator('#closeModelSettings').click(); assert.equal(await page.locator('#modelAdminToken').inputValue(), '');
  });
  for (const [index, id] of [rootId, aId, deepId].entries()) await check(`根/中间/深层 ${index + 1}：三个默认不选、标题编辑、选 ${index + 1} 项一次事务并撤销重做`, async () => {
    const before = await state(); await openSuggestions(id);
    assert.equal(await page.locator('[data-pick-ai]:checked').count(), 0); assert(await page.locator('#applyAISuggestions').isDisabled());
    const providerInput = JSON.parse(calls.at(-1).messages.at(-1).content); assert.equal(providerInput.parent_node.id, id);
    await page.locator('#aiOptionTitle0').fill(`用户修改候选标题 ${index + 1}`);
    for (let k = 0; k <= index; k++) await page.locator('[data-pick-ai]').nth(k).check();
    if (index === 2) await screenshot('three-options-fixture');
    const apiBefore = apiCalls.filter(c => c.path.endsWith('/apply')).length;
    await page.locator('#applyAISuggestions').click({ clickCount: 2 }); await waitFor(async () => !await page.locator('#aiSuggestionsDialog').isVisible(), 'apply closes');
    const applied = await state(); assert.equal(applied.nodes.length, before.nodes.length + index + 1); assert.equal(applied.edges.length, before.edges.length + index + 1);
    assert.equal(applied.revision, before.revision + 1); assert.equal(apiCalls.filter(c => c.path.endsWith('/apply')).length, apiBefore + 1);
    assert(applied.nodes.some(n => n.title === `用户修改候选标题 ${index + 1}` && n.origin === 'ai' && n.knowledgeStatus === 'unverified'));
    await page.locator('#undo').click(); assert.equal((await state()).nodes.length, before.nodes.length);
    await page.locator('#redo').click(); assert.equal((await state()).nodes.length, applied.nodes.length);
  });
  await check('取消建议不写图', async () => { const before = await state(); await openSuggestions(aId); await page.locator('#cancelAISuggestions').click(); const after = await state(); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges); assert.equal(after.revision, before.revision); });
  for (const mode of ['empty', 'invalid-json', 'two', 'duplicate', 'length']) await check(`异常候选 ${mode} 拒绝，图版本和节点不变`, async () => {
    const before = await state(); suggestionMode = mode; await openSuggestions(aId, false); assert.equal(await page.locator('#aiSuggestionOptions .ai-option').count(), 0); assert(await page.locator('#applyAISuggestions').isDisabled()); await page.locator('#cancelAISuggestions').click();
    const after = await state(); assert.equal(after.revision, before.revision); assert.deepEqual(after.nodes, before.nodes); suggestionMode = 'valid';
  });
  let delayedTurn, failedTurn, globalTurn, multiTurn, sseTurn;
  await check('发送前已保存问题；焦点 A→B 后迟到答案只绑定 A', async () => {
    await nodeFocus(aId); chatMode = 'hold'; holdArrived = new Promise(resolve => { holdResolve = resolve; });
    delayedTurn = await send('A 专属迟到问题唯一标记', { terminal: false }); await holdArrived;
    assert.equal((await turns()).find(t => t.turnId === delayedTurn.turnId).status, 'generating'); assert.equal(delayedTurn.focusNodeIds[0], aId);
    await nodeFocus(bId); holdRelease();
    delayedTurn = await waitFor(async () => { const t = (await turns()).find(t => t.turnId === delayedTurn.turnId); return t.status === 'completed' && t; }, 'late answer stored');
    assert.deepEqual(delayedTurn.focusNodeIds, [aId]); assert.match(await page.locator('#aiHistoryBarText').textContent(), /（0）/);
    await nodeFocus(aId); await openHistory(); assert.equal(await page.locator(`[data-turn-id="${delayedTurn.turnId}"]`).count(), 1); chatMode = 'json';
    await screenshot('history-late-answer-fixture');
  });
  await check('真实 SSE 与 JSON 回退均完成，授权失败问题刷新保留', async () => {
    await nodeFocus(aId); chatMode = 'sse'; sseTurn = await send('测试真实 SSE 流式完整回答'); assert.equal(sseTurn.status, 'completed'); assert.match(sseTurn.answer, /HTTP SSE/);
    chatMode = '401'; failedTurn = await send('失败问题必须刷新仍在'); assert.equal(failedTurn.status, 'failed'); assert.equal(failedTurn.errorCode, 'AI_UNAUTHORIZED');
    assert(!JSON.stringify(await aiData()).includes(FAKE_KEY)); await page.reload(); await page.locator('#aiHistoryBar').waitFor(); assert((await turns()).some(t => t.turnId === failedTurn.turnId && t.status === 'failed')); chatMode = 'json';
  });
  await check('未配置模型显式提示，问题与 DIY 保存刷新仍在', async () => {
    env.DEEPSEEK_API_KEY = ''; await page.reload(); await page.locator('#aiHistoryBar').waitFor(); await nodeFocus(aId);
    const before = calls.length; const t = await send('无模型配置仍保存的问题'); assert.equal(t.status, 'unconfigured'); assert.equal(calls.length, before);
    await page.reload(); await page.locator('#aiHistoryBar').waitFor(); assert((await turns()).some(v => v.turnId === t.turnId && v.question === t.question));
    assert.equal((await state()).nodes.find(n => n.id === deepId).description, '本人独立写下的 DIY 说明，不允许 AI 覆盖。'); env.DEEPSEEK_API_KEY = FAKE_KEY;
  });
  await check('余额不足、超时、异常聊天 JSON 都保留失败问题', async () => {
    await page.reload(); await page.locator('#aiHistoryBar').waitFor(); await nodeFocus(aId);
    for (const [mode, code] of [['402', 'AI_INSUFFICIENT_BALANCE'], ['timeout', 'AI_TIMEOUT'], ['bad', 'AI_INVALID_RESPONSE']]) {
      chatMode = mode; const t = await send(`受控失败场景 ${mode} 保留原文`); assert.equal(t.status, 'failed'); assert.equal(t.errorCode, code);
    }
    chatMode = 'json';
  });
  await check('用户取消真实 SSE 后保留问题与明确未完成部分回答', async () => {
    await nodeFocus(aId); chatMode = 'partial'; const t = await send('取消时保存部分回答的问题', { terminal: false });
    await waitFor(async () => (await page.locator('#chatMessages').textContent()).includes('受控 HTTP 测试部分回答'), 'partial answer visible');
    await page.locator('#cancelAI').click(); const cancelled = await waitFor(async () => { const turn = (await turns()).find(v => v.turnId === t.turnId); return turn?.status === 'cancelled' && turn; }, 'cancel persisted');
    assert.match(cancelled.answer, /部分回答/); await page.reload(); await page.locator('#aiHistoryBar').waitFor(); assert.equal((await turns()).find(v => v.turnId === t.turnId).status, 'cancelled'); chatMode = 'json';
  });
  await check('全局/多选各存一条原文，关联保持准确', async () => {
    await page.reload(); await page.locator('#aiHistoryBar').waitFor(); await nodeFocus(aId);
    let count = (await turns()).length; globalTurn = await send('整棵树问题只存一份', { scope: 'tree' }); assert.equal(globalTurn.status, 'completed'); assert.equal(globalTurn.scope, 'graph'); assert.equal((await turns()).length, count + 1);
    await nodeFocus(aId); await page.locator('#multi').click(); await page.locator(`#nodes [data-node="${bId}"] .node-main`).click({ force: true });
    count = (await turns()).length; multiTurn = await send('多选 A B 问题只存一份', { scope: 'selection' }); assert.equal(multiTurn.status, 'completed'); assert.equal(multiTurn.scope, 'multi_node'); assert.deepEqual(new Set(multiTurn.focusNodeIds), new Set([aId, bId])); assert.equal((await turns()).length, count + 1);
    await page.locator('#multi').click();
  });
  await check('节点历史切换、真实 UI 发送 21 条与分页', async () => {
    await nodeFocus(aId);
    for (let i = 0; i < 21; i++) assert.equal((await send(`分页受控问题 ${String(i).padStart(2, '0')}`)).status, 'completed');
    await openHistory(); assert.equal(await page.locator('#aiHistoryItems .ai-turn').count(), 20); assert(await page.locator('#moreAIHistory').isVisible());
    await page.locator('#moreAIHistory').click(); assert((await page.locator('#aiHistoryItems .ai-turn').count()) > 20);
    await nodeFocus(bId); await openHistory(); const text = await page.locator('#aiHistoryItems').textContent(); assert(!text.includes('A 专属迟到问题唯一标记')); assert(text.includes('多选 A B 问题只存一份'));
    await nodeFocus(aId); await openHistory(); await screenshot('history-pagination-fixture');
  });
  await check('继续追问复用 thread，失败重问生成新 turn', async () => {
    await openHistory('graph'); if (await page.locator('#moreAIHistory').isVisible()) await page.locator('#moreAIHistory').click();
    await page.locator(`[data-continue-turn="${sseTurn.turnId}"]`).click();
    const continuation = await send('延续原先 SSE 问答继续追问', { preserveBinding: true }); assert.equal(continuation.status, 'completed'); assert.equal(continuation.threadId, sseTurn.threadId);
    await openHistory('graph'); if (await page.locator('#moreAIHistory').isVisible()) await page.locator('#moreAIHistory').click();
    await page.locator(`[data-retry-turn="${failedTurn.turnId}"]`).click(); assert.equal(await page.locator('#question').inputValue(), failedTurn.question);
    await page.locator('#send').click(); const retry = await waitFor(async () => (await turns()).find(t => t.turnId !== failedTurn.turnId && t.question === failedTurn.question && t.status === 'completed'), 'retry new turn'); assert.notEqual(retry.turnId, failedTurn.turnId); assert.equal((await turns()).find(t => t.turnId === failedTurn.turnId).status, 'failed');
  });
  await check('同匿名设备跨图隔离，无虚构用户账户', async () => {
    await page.locator('#backToTrees').click(); await createTree('v1.1 受控测试树 B'); graphB = (await state()).graphId; assert.notEqual(graphB, graphA);
    await openHistory('graph'); assert.equal(await page.locator('#aiHistoryItems .ai-turn').count(), 0); assert.equal((await turns(graphB)).length, 0);
    const inaccessible = await page.evaluate(async ({ key, id, graphId }) => { const { AIStore } = await import('/journey/ai-store.js'); return new AIStore(localStorage).getTurn(id, graphId); }, { key: AI_KEY, id: delayedTurn.turnId, graphId: graphB }); assert.equal(inaccessible, null);
    await page.locator('#backToTrees').click(); await page.locator(`[data-act="open"][data-id="${graphA}"]`).click(); await page.locator('#aiHistoryBar').waitFor(); assert((await turns()).length > 20);
  });
  await check('旧授权合成QA默认不勾，重新授权拒绝零请求，同意后才发送原文', async () => {
    await nodeFocus(deepId);
    // Only this historical precondition is seeded. Ordinary QA above was sent
    // through the real UI. This is synthetic old authorization, never user data.
    const oldTurnId = await page.evaluate(async ({ pathId, targetId }) => {
      const { TreeLibrary } = await import('/journey/forest.js'), { AIStore } = await import('/journey/ai-store.js'), { captureTurnBinding } = await import('/journey/ai-context.js');
      const id = decodeURIComponent(location.pathname.split('/')[2]), storage = new TreeLibrary(localStorage).scopedStorage(id), graph = JSON.parse(storage.getItem('shiyu-zuxia.graph.v1')).graph, path = graph.savedPaths.find(p => p.id === pathId), ai = new AIStore(localStorage);
      const turn = ai.createTurn(captureTurnBinding(graph, { question: '旧授权合成QA原文唯一标记', scope: 'path', focusNodeIds: [targetId], focusedPathEdgeIds: path.edgeIds, contextKey: 'synthetic-previous-consent\nnot-current-model-authorization' }));
      ai.updateTurn(turn.turnId, { status: 'completed', answer: '旧授权下合成的档案线索，非真实用户资料。', model: 'synthetic-history-seed-no-live-model' }, graph.graphId);
      return turn.turnId;
    }, { pathId: savedPathId, targetId: deepId });
    await page.reload(); await page.locator('#aiHistoryBar').waitFor(); await openNarrative();
    assert.equal(await page.locator(`[data-narrative-turn="${oldTurnId}"]`).isChecked(), false);
    assert.equal(await page.locator(`[data-narrative-turn="${delayedTurn.turnId}"]`).isChecked(), true);
    const providerBefore = calls.length, summaryBefore = apiCalls.filter(c => c.path.endsWith('/summary/draft')).length;
    await page.locator(`[data-narrative-turn="${oldTurnId}"]`).check(); await page.locator('#generateNarrative').click(); await page.locator('#confirmDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#confirmTitle').innerText(), /重新授权/); assert.match(await page.locator('#confirmText').innerText(), /原文/);
    await screenshot('history-reconsent-fixture');
    await page.locator('#confirmDialog button[value="cancel"]').click(); await waitFor(async () => await page.locator('#generateNarrative').isEnabled(), 'declined authorization settles');
    assert.equal(calls.length, providerBefore); assert.equal(apiCalls.filter(c => c.path.endsWith('/summary/draft')).length, summaryBefore); assert.equal(await page.locator('#narrativeDraftForm').count(), 0);
    await page.locator(`[data-narrative-turn="${oldTurnId}"]`).check(); await page.locator('#generateNarrative').click(); await page.locator('#confirmDialog').waitFor({ state: 'visible' }); await page.locator('#confirmAction').click(); await page.locator('#narrativeDraftForm').waitFor();
    assert.equal(calls.length, providerBefore + 1); assert.equal(apiCalls.filter(c => c.path.endsWith('/summary/draft')).length, summaryBefore + 1);
    const input = JSON.parse(calls.at(-1).messages.at(-1).content); assert(input.turns.some(t => t.turnId === oldTurnId && t.answer.includes('非真实用户资料'))); assert(input.turns.some(t => t.turnId === delayedTurn.turnId));
    assert.equal((await turns()).find(t => t.turnId === oldTurnId).contextKey, 'synthetic-previous-consent\nnot-current-model-authorization');
    await page.locator('#discardNarrativeDraft').click(); await openNarrative(); assert.equal(await page.locator(`[data-narrative-turn="${oldTurnId}"]`).isChecked(), false);
    return { syntheticHistoricalSeedOnly: true, rejectedProviderRequests: 0, acceptedProviderRequests: 1, consentIsForThisSummaryOnly: true };
  });
  let usedSummaryTurnIds;
  await check('路线摘要只含相关历史，草稿可编辑确认且不覆盖 DIY', async () => {
    await nodeFocus(deepId); await openNarrative();
    assert.equal(await page.locator(`[data-narrative-turn="${globalTurn.turnId}"]`).isChecked(), false); assert.equal(await page.locator(`[data-narrative-turn="${multiTurn.turnId}"]`).isChecked(), false);
    const before = await state(); await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor();
    const input = JSON.parse(calls.at(-1).messages.at(-1).content); usedSummaryTurnIds = input.turns.map(t => t.turnId); assert(usedSummaryTurnIds.includes(delayedTurn.turnId)); assert(!usedSummaryTurnIds.includes(globalTurn.turnId)); assert(!usedSummaryTurnIds.includes(multiTurn.turnId)); assert(!input.graph_context.nodes.some(n => n.id === bId));
    assert.equal(await page.locator('.ai-narrative-confirmed').count(), 0); await page.locator('#narrative_title').fill('用户确认的路线介绍唯一标记'); await page.locator('#narrative_destination').fill('计划先做小项目，再决定是否继续'); await page.locator('#confirmNarrativeDraft').click(); await page.locator('.ai-narrative-confirmed').waitFor();
    assert.match(await page.locator('.ai-narrative-confirmed').textContent(), /用户确认的路线介绍唯一标记/); assert.deepEqual((await state()).nodes, before.nodes); assert.equal(((await state()).tasks || []).length, (before.tasks || []).length);
    await page.locator('.ai-narrative-confirmed').evaluate(el => el.scrollIntoView({ block: 'start' })); await screenshot('narrative-confirmed-fixture');
  });
  await check('用户版独立编辑，重新生成不会覆盖用户版', async () => {
    await page.locator('#editUserNarrative').click(); await page.locator('#narrativeUser_destination').fill('用户版独立取舍唯一标记'); await page.locator('#saveUserNarrative').click();
    await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor(); assert.match(await page.locator('.ai-narrative-confirmed').textContent(), /用户版独立取舍唯一标记/); await page.locator('#discardNarrativeDraft').click();
    await page.reload(); await page.locator('#aiHistoryBar').waitFor(); await openNarrative(); assert.match(await page.locator('.ai-narrative-confirmed').textContent(), /用户版独立取舍唯一标记/);
  });
  await check('路线改变、新问答触发 stale，删除来源问答彻底清理派生介绍', async () => {
    await nodeFocus(deepId); await page.locator('#editDescription').fill('本人更新 DIY 内容，路线版本变化'); await page.locator('#nodeForm button[type="submit"]').click(); await openNarrative(); await page.locator('.ai-stale').waitFor();
    await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor(); await page.locator('#narrative_title').fill('当前版本待清理派生介绍唯一标记'); await page.locator('#confirmNarrativeDraft').click(); assert.equal(await page.locator('.ai-stale').count(), 0);
    await nodeFocus(aId); assert.equal((await send('新增相关问答触发摘要过期')).status, 'completed'); await openNarrative(); await page.locator('.ai-stale').waitFor();
    await openHistory('graph'); if (await page.locator('#moreAIHistory').isVisible()) await page.locator('#moreAIHistory').click();
    await page.locator(`[data-delete-turn="${delayedTurn.turnId}"]`).click(); await page.locator('#confirmAction').click(); await waitFor(async () => !(await turns()).some(t => t.turnId === delayedTurn.turnId), 'delete source turn');
    const data = JSON.stringify(await aiData()); assert(!data.includes('A 专属迟到问题唯一标记')); assert(!data.includes('用户确认的路线介绍唯一标记')); assert(!data.includes('用户版独立取舍唯一标记')); assert(!data.includes('当前版本待清理派生介绍唯一标记'));
    await openNarrative(); assert.equal(await page.locator('.ai-narrative-confirmed').count(), 0); assert.equal(await page.locator('#narrativeDraftForm').count(), 0);
  });
  await check('删除节点保留已归档问答，用户可再彻底删除记录', async () => {
    const archivedId = await addNode(rootId, '稍后归档的测试节点'); await nodeFocus(archivedId); const archivedTurn = await send('节点删除后保留的归档问题'); assert.equal(archivedTurn.status, 'completed');
    await nodeFocus(archivedId); await page.locator('#deleteNode').click(); await page.locator('#confirmAction').click(); assert(!(await state()).nodes.some(n => n.id === archivedId));
    assert((await turns()).some(t => t.turnId === archivedTurn.turnId)); await openHistory('archived'); assert.equal(await page.locator(`[data-turn-id="${archivedTurn.turnId}"]`).count(), 1);
    await page.locator(`[data-delete-turn="${archivedTurn.turnId}"]`).click(); await page.locator('#confirmAction').click(); assert(!(await turns()).some(t => t.turnId === archivedTurn.turnId));
  });
  await check('私密节点问题只保存在本机，不调用 provider 或出现在摘要追加列表', async () => {
    const secret = await addNode(rootId, '私密价值节点合成测试', 'value'); await nodeFocus(secret); await page.locator('#privateNode').check(); await page.locator('#nodeForm button[type="submit"]').click();
    const before = calls.length; const t = await send('私密问题不可外传唯一标记'); assert.equal(t.status, 'failed'); assert.equal(t.errorCode, 'AI_PRIVATE_CONTEXT'); assert.equal(calls.length, before);
    await nodeFocus(deepId); await openNarrative(); assert.equal(await page.locator(`[data-narrative-turn="${t.turnId}"]`).count(), 0);
  });
  await check('390px 手机历史抽屉限高、可关闭，返回画布能继续 DIY', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobileTree').click(); await openHistory('graph');
    const box = await page.locator('#aiHistoryDrawer').boundingBox(), historyBox = await page.locator('#aiHistory').boundingBox(), canvasBox = await page.locator('#canvas').boundingBox();
    assert(box && box.height <= 844 * 0.36, `drawer ${box?.height}`); assert(box.x >= 0 && box.x + box.width <= 391);
    const visibleCanvasHeight = historyBox.y - canvasBox.y; assert(visibleCanvasHeight >= 96, `visible canvas ${visibleCanvasHeight}px`);
    let focusedNodeBox;
    try { await waitFor(async () => { focusedNodeBox = await page.locator(`#nodes [data-node="${deepId}"]`).boundingBox(); return focusedNodeBox && focusedNodeBox.x >= 0 && focusedNodeBox.x + focusedNodeBox.width <= 391 && focusedNodeBox.y >= canvasBox.y && focusedNodeBox.y + focusedNodeBox.height <= historyBox.y; }, 'focused node remains visible above mobile history drawer'); }
    catch (error) { throw new Error(`${error.message}; geometry=${JSON.stringify({ focusedNodeBox, canvasBox, drawerBox: box })}`); }
    await screenshot('mobile-history-fixture');
    await page.locator('#closeAIHistory').click(); assert(!await page.locator('#aiHistoryDrawer').isVisible()); await page.locator('#mobileTree').click(); assert(await page.locator('#canvas').isVisible());
    await page.locator('#add').click(); await page.locator('#custom').fill('手机手动添加的想法'); await page.locator('#confirmGrow').click(); assert((await state()).nodes.some(n => n.title === '手机手动添加的想法'));
    await page.locator('#search').fill(''); await page.locator('#fit').click(); await screenshot('mobile-canvas-fixture'); await page.setViewportSize({ width: 1440, height: 1000 });
    return { width: 390, height: 844, drawerHeight: box.height, visibleCanvasHeight, focusedNodeBox };
  });
  await check('浏览器不保存 key，Journey 操作不修改职业工作台源码', async () => {
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage })); assert(!storage.includes(FAKE_KEY)); assert(!storage.includes(ADMIN)); assert(!(await page.locator('body').innerText()).includes(FAKE_KEY));
    const after = await Promise.all(legacyFiles.map(sha));
    assert.deepEqual(after, legacyBefore);
    const current = Object.fromEntries(legacyFiles.map((file, index) => [file, after[index]]));
    await writeFile(path.join(OUT, 'legacy-hashes.json'), JSON.stringify({ mode: 'fixture', current }, null, 2)); assert.deepEqual(errors, []); assert.deepEqual(leakedResponses, []);
  });
  await rm(path.join(OUT, 'failure.png'), { force: true });
} catch (error) {
  console.error(error.stack); if (page) await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); process.exitCode = 1;
} finally {
  const result = { mode: 'controlled-local-HTTP-provider-fixture', liveDeepSeekTested: false, fakeKeyOnly: true, productionRouter: true, origin, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, checks, pageErrors: errors, providerRequests: calls.length, applicationRequests: apiCalls.length, screenshots, limitations: ['未使用真实 DeepSeek key；不声称真实模型已连接。', '匿名本地 graph 隔离，不声称多用户服务端账户隔离。'] };
  await mkdir(OUT, { recursive: true }); await writeFile(path.join(OUT, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ mode: result.mode, passed: result.passed, failed: result.failed, providerRequests: calls.length, screenshots: screenshots.length }));
  holdRelease?.(); await browser?.close(); for (const server of servers.reverse()) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
}
