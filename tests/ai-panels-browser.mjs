// Isolated real-browser UI checks. Provider responses below are controlled
// contract fixtures, and do not claim a live DeepSeek connection.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { launchBrowser } from './browser-runtime.mjs';

const app = express(); app.use('/journey', express.static(resolve('journey')));
app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/journey/style.css"><link rel="stylesheet" href="/journey/workspace.css"><link rel="stylesheet" href="/journey/ai-v11.css"><title>AI v1.1 受控 UI 验证</title><body><div id="app" class="app"><header class="topbar">始于足下 · 受控 UI 验证</header><div class="workspace"><main class="mainpanel" id="mainpanel"><div class="canvas-head"><h2>人生树</h2></div><div class="canvas-wrapper" id="canvas"><p style="padding:25px">画布始终可见</p></div></main><aside class="rightpanel" id="rightpanel"><div class="righthead"><h3>陪你探索的 AI 顾问</h3></div><div class="panel-scroll" id="panelScroll"></div></aside></div><nav class="bottomnav"><button>人生树</button></nav></div></body></html>'));
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`, out = resolve('artifacts/ai-v11-panels'); await mkdir(out, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const page = await context.newPage();
const errors = [], checks = [], requests = []; page.on('pageerror', e => errors.push(e.message));
let optionCount = 3, delay = 0, summaryDelay = 0, setNumber = 0, applyMode = 'valid';
const sets = new Map();
await page.route('**/api/journey/**', async route => {
  const req = route.request(), url = new URL(req.url()); const body = req.postDataJSON(); requests.push({ path: url.pathname, body });
  let value;
  if (url.pathname.endsWith('/config/status')) value = { provider: 'deepseek', model: 'controlled-test-model', state: 'configured', configured: true, enabled: true, baseUrl: 'https://api.deepseek.com' };
  else if (url.pathname.endsWith('/config/test')) value = { status: 'connected', state: 'connected', model: 'controlled-test-model' };
  else if (/\/nodes\/[^/]+\/ai-suggestions$/.test(url.pathname)) {
    const parentNodeId = decodeURIComponent(url.pathname.split('/').at(-2));
    value = { id: `set_${++setNumber}`, graphId: body.graph.graphId, parentNodeId, graphRevision: body.graph.revision, model: 'controlled-test-model', createdAt: new Date().toISOString(), token: 'controlled-signed-token', options: ['跨学科研习', '体验研究项目', '行业访谈'].slice(0, optionCount).map((title, i) => ({ optionId: `option_${setNumber}_${i}`, title, nodeKind: 'skill', rationale: '结合当前材料方向探索下一步。', prerequisites: ['结合自己的时间安排核实'], uncertainty: '请先验证实际机会和个人兴趣。', knowledgeStatus: 'unverified' })) }; sets.set(value.id, value);
  } else if (/\/ai-suggestions\/[^/]+\/apply$/.test(url.pathname)) {
    if (['500', '422'].includes(applyMode)) return route.fulfill({ status: Number(applyMode), contentType: 'application/json', body: JSON.stringify({ error: `受控确认失败 ${applyMode}，图未改变。` }) });
    const set = sets.get(url.pathname.split('/').at(-2));
    value = { usedGraphRevision: body.expectedRevision + (applyMode === 'invalid-revision' ? 1 : 0), proposedOperations: body.selectedOptions.flatMap((o, i) => [{ op: 'add_node', tempId: `added_${set.id}_${i}`, node: { title: o.title, kind: 'skill' } }, { op: 'add_edge', fromId: set.parentNodeId, toId: `added_${set.id}_${i}` }]) };
  } else if (url.pathname.endsWith('/summary/draft')) {
    if (body.turns.some(t => !['node', 'path', 'selection', 'tree'].includes(t.scope))) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'TURN_SCOPE_MISMATCH: history scope must use the server wire contract.' }) });
    const pathId = decodeURIComponent(url.pathname.split('/').at(-3));
    value = { model: 'controlled-test-model', createdAt: new Date().toISOString(), usedGraphRevision: body.graph.revision, draft: { savedPathId: pathId, title: '材料方向探索介绍', currentState: '尚无用户明示履历事实。', destination: '计划探索材料研究方向', motivation: ['问题中表达了了解该方向的考虑，仍需本人确认。'], requiredPreparation: [{ item: '了解研究项目所需技能', evidenceStatus: 'needs_verification', supportingTurnIds: [body.turns[0].turnId] }], risksAndUnknowns: ['实际要求尚待核实'], nextActions: ['查阅项目资料'], sourceTurnIds: [body.turns[0].turnId], graphRevision: body.graph.revision, status: 'draft' } };
  } else throw new Error(`Unexpected fixture URL ${url.pathname}`);
  if (delay && /ai-suggestions$/.test(url.pathname)) await new Promise(r => setTimeout(r, delay));
  if (summaryDelay && url.pathname.endsWith('/summary/draft')) await new Promise(r => setTimeout(r, summaryDelay));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
});
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true, mode: 'controlled-provider-real-browser' }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; } }
try {
  await page.goto(base);
  await page.evaluate(async () => {
    const { createAIPanels } = await import('/journey/ai-panels.js'); const { GraphStore } = await import('/journey/store.js'); const { AIStore } = await import('/journey/ai-store.js');
    localStorage.clear(); const store = new GraphStore(localStorage); const aiStore = new AIStore(localStorage); let focus = store.graph.rootNodeId, tab = 'detail', consentKey = 'consent_1';
    store.commit([{ op: 'add_node', tempId: 'parent', node: { title: '材料科学', kind: 'major' } }, { op: 'add_node', tempId: 'other', node: { title: '另一条路线', kind: 'major' } }, { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'parent' }, { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'other' }]);
    focus = store.graph.nodes.find(n => n.title === '材料科学').id;
    const edge = store.graph.edges.find(e => e.to === focus); store.commit([{ op: 'save_path', title: '材料探索路线', edgeIds: [edge.id] }]); store.graph.savedPaths[0].note = '我自己写的 DIY 路线说明。';
    let copilot, confirmationDecision = true, confirmationHook = null; const events = [], confirmations = [];
    const ctx = { aiStore, graph: () => store.graph, nodeById: id => store.graph.nodes.find(n => n.id === id), focus: () => focus, consentKey: () => consentKey, requestExtras: () => ({}), toast: text => events.push(text), confirmation: async (title, text, action) => { confirmations.push({ title, text, action }); const hook = confirmationHook; confirmationHook = null; if (hook) await hook(); return confirmationDecision; }, transact: (ops, rev, settings) => { store.commit(ops, rev, settings); copilot.update(); return true; }, activeTab: () => tab, setActiveTab: value => tab = value, renderPanel: () => copilot.renderTab(tab), showMobile: value => document.getElementById('rightpanel').classList.toggle('mobile-visible', value), continueTurn: t => events.push(`continue:${t.threadId}`), retryTurn: t => events.push(`retry:${t.turnId}`) };
    copilot = createAIPanels(ctx); window.h = { store, aiStore, copilot, events, ctx, confirmations, setConfirmation: value => confirmationDecision = value, setConfirmationHook: hook => confirmationHook = hook, setFocus: id => { focus = id; copilot.update(); }, get focus() { return focus; }, setConsent: v => { consentKey = v; copilot.update(); } };
  });
  await check('read-only model settings never test automatically and discard administrator token on close', async () => {
    await page.evaluate(() => h.copilot.openSettings()); await page.locator('.ai-settings-status').waitFor(); assert.equal(requests.filter(r => r.path.endsWith('/config/test')).length, 0);
    assert(await page.locator('#testModelConnection').isDisabled()); assert.equal(await page.locator('#modelSettingsDialog input').count(), 1);
    await page.locator('#modelAdminToken').fill('controlled-admin-token'); await page.locator('#testModelConnection').click(); await page.getByText('连接测试成功。', { exact: true }).waitFor();
    await page.locator('#closeModelSettings').click(); await page.waitForFunction(() => document.getElementById('modelAdminToken').value === ''); assert(!await page.evaluate(() => JSON.stringify(localStorage).includes('controlled-admin-token')));
  });
  await check('three suggestions start unselected, accept edited two-option batch and double click only writes once', async () => {
    await page.evaluate(() => h.copilot.openSuggestions(h.focus)); await page.locator('.ai-option').nth(2).waitFor(); assert.equal(await page.locator('.ai-option').count(), 3); assert.equal(await page.locator('[data-pick-ai]:checked').count(), 0); assert(await page.locator('#applyAISuggestions').isDisabled());
    await page.locator('[data-pick-ai]').nth(0).check(); await page.locator('[data-pick-ai]').nth(1).check(); await page.locator('#aiOptionTitle0').fill('本人修改的研究体验');
    await page.screenshot({ path: resolve(out, 'three-suggestions-desktop.png') }); const before = await page.evaluate(() => ({ n: h.store.graph.nodes.length, e: h.store.graph.edges.length, undo: h.store.undoStack.length }));
    await page.locator('#applyAISuggestions').evaluate(button => { button.click(); button.click(); }); await page.locator('#aiSuggestionsDialog').waitFor({ state: 'hidden' });
    const after = await page.evaluate(() => ({ n: h.store.graph.nodes.length, e: h.store.graph.edges.length, undo: h.store.undoStack.length, titles: h.store.graph.nodes.map(n => n.title) }));
    assert.equal(after.n, before.n + 2); assert.equal(after.e, before.e + 2); assert.equal(after.undo, before.undo + 1); assert(after.titles.includes('本人修改的研究体验')); assert(!after.titles.includes('行业访谈')); assert.equal(requests.filter(r => r.path.endsWith('/apply')).length, 1);
  });
  await check('cancel and invalid two-option response leave the graph unchanged', async () => {
    const before = await page.evaluate(() => h.store.graph.revision); await page.evaluate(() => h.copilot.openSuggestions(h.focus)); await page.locator('.ai-option').nth(2).waitFor(); await page.locator('#cancelAISuggestions').click(); assert.equal(await page.evaluate(() => h.store.graph.revision), before);
    optionCount = 2; await page.evaluate(() => h.copilot.openSuggestions(h.focus)); await page.getByText('建议响应不符合当前节点与三个候选的约定，请重新生成。', { exact: true }).waitFor(); assert.equal(await page.locator('.ai-option').count(), 0); assert.equal(await page.evaluate(() => h.store.graph.revision), before); await page.locator('#cancelAISuggestions').click(); optionCount = 3;
  });
  await check('apply 500, validation failure and wrong revision restore controls without writing; retry commits once', async () => {
    const before = await page.evaluate(() => ({ revision: h.store.graph.revision, nodes: h.store.graph.nodes.length, edges: h.store.graph.edges.length }));
    await page.evaluate(() => h.copilot.openSuggestions(h.focus)); await page.locator('.ai-option').nth(2).waitFor(); await page.locator('[data-pick-ai]').nth(2).check();
    for (const mode of ['500', '422', 'invalid-revision']) {
      applyMode = mode; await page.locator('#applyAISuggestions').click();
      await page.waitForFunction(() => Boolean(document.querySelector('#aiSuggestionError').textContent.trim()) && !document.querySelector('#applyAISuggestions').disabled);
      assert.equal(await page.locator('#applyAISuggestions').innerText(), '添加已选 1 项'); assert(await page.locator('#regenerateAISuggestions').isEnabled());
      assert.deepEqual(await page.evaluate(() => ({ revision: h.store.graph.revision, nodes: h.store.graph.nodes.length, edges: h.store.graph.edges.length })), before);
    }
    const applyCalls = requests.filter(r => r.path.endsWith('/apply')).slice(-3); assert.equal(new Set(applyCalls.map(r => r.body.clientRequestId)).size, 1);
    applyMode = 'valid'; await page.locator('#applyAISuggestions').click(); await page.locator('#aiSuggestionsDialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => ({ revision: h.store.graph.revision, nodes: h.store.graph.nodes.length, edges: h.store.graph.edges.length })), { revision: before.revision + 1, nodes: before.nodes + 1, edges: before.edges + 1 });
  });
  await check('switching focus invalidates pending suggestions and drops late responses', async () => {
    delay = 500; await page.evaluate(() => h.copilot.openSuggestions(h.focus)); await page.locator('.ai-loading').waitFor(); await page.evaluate(() => h.setFocus(h.store.graph.nodes.find(n => n.title === '另一条路线').id)); await page.waitForTimeout(650); assert.equal(await page.locator('.ai-option').count(), 0); assert(await page.locator('#applyAISuggestions').isDisabled()); await page.locator('#cancelAISuggestions').click(); delay = 0;
  });
  await check('node history switches immediately, paginates, distinguishes path records and persists local questions', async () => {
    await page.evaluate(() => {
      const parent = h.store.graph.nodes.find(n => n.title === '材料科学'), edge = h.store.graph.edges.find(e => e.to === parent.id), path = h.store.graph.savedPaths[0]; h.setFocus(parent.id);
      for (let i = 0; i < 23; i++) { const t = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: `fixture_q_${i}`, question: `材料路线问题 ${i}`, scope: 'node', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [parent.id], contextKey: 'consent_1\ncurrent-route-context' }); h.aiStore.updateTurn(t.turnId, { status: 'completed', answer: `受控回答 ${i}，未核实。`, model: 'controlled-test-model' }); }
      const p = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_path_q', question: '这条完整路线需要什么？', scope: 'path', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [parent.id], pathNodeIds: [h.store.graph.rootNodeId, parent.id], focusedPathEdgeIds: [edge.id], savedPathId: path.id, contextKey: 'consent_1\ncurrent-route-context' }); h.aiStore.updateTurn(p.turnId, { status: 'completed', answer: '受控的路径回答，要求待核实。', model: 'controlled-test-model' }); h.copilot.update();
    });
    assert((await page.locator('#aiHistoryBarText').innerText()).includes('（24）')); await page.locator('#aiHistoryBar').click(); assert.equal(await page.locator('.ai-turn').count(), 20); await page.locator('#moreAIHistory').click(); assert.equal(await page.locator('.ai-turn').count(), 24);
    await page.evaluate(() => h.setFocus(h.store.graph.nodes.find(n => n.title === '另一条路线').id)); assert.equal(await page.locator('.ai-turn').count(), 0); assert((await page.locator('#aiHistoryBarText').innerText()).includes('（0）'));
    await page.evaluate(() => h.setFocus(h.store.graph.rootNodeId)); assert((await page.locator('#aiHistoryItems').innerText()).includes('本节点所在路线相关')); await page.evaluate(() => h.setFocus(h.store.graph.nodes.find(n => n.title === '材料科学').id));
    await page.screenshot({ path: resolve(out, 'history-desktop.png') });
  });
  await check('revoked or imported history stays local and unselected; rejection sends nothing, explicit consent sends, mid-dialog revocation blocks', async () => {
    await page.evaluate(() => { h.setConsent('consent_2_without_profile_or_docs'); h.copilot.openNarrative(h.store.graph.savedPaths[0].id); });
    assert.equal(await page.locator('[data-narrative-turn]:checked').count(), 0); assert((await page.locator('#narrativeContent').innerText()).includes('需重新授权发送原文'));
    assert.equal(await page.evaluate(() => h.aiStore.history(h.store.graph, { nodeId: h.focus }).total), 24);
    const id = await page.locator('[data-narrative-turn]').first().getAttribute('data-narrative-turn');
    let before = requests.filter(r => r.path.endsWith('/summary/draft')).length;
    await page.locator(`[data-narrative-turn="${id}"]`).check(); await page.evaluate(() => h.setConfirmation(false)); await page.locator('#generateNarrative').click();
    await page.waitForFunction(() => !document.getElementById('generateNarrative').disabled); assert.equal(requests.filter(r => r.path.endsWith('/summary/draft')).length, before);
    await page.locator(`[data-narrative-turn="${id}"]`).check(); await page.evaluate(() => h.setConfirmation(true)); await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor();
    assert.equal(requests.filter(r => r.path.endsWith('/summary/draft')).length, before + 1); assert.equal(requests.filter(r => r.path.endsWith('/summary/draft')).at(-1).body.turns.length, 1);
    assert((await page.evaluate(() => h.confirmations.at(-1).text)).includes('历史问题和回答原文'));
    await page.locator(`[data-narrative-turn="${id}"]`).check(); before = requests.filter(r => r.path.endsWith('/summary/draft')).length;
    await page.evaluate(() => h.setConfirmationHook(() => h.setConsent('consent_3_revoked_during_confirmation'))); await page.locator('#generateNarrative').click();
    await page.getByText('授权、焦点或所选问答已经变化，请重新选择后确认。', { exact: true }).waitFor(); assert.equal(requests.filter(r => r.path.endsWith('/summary/draft')).length, before);
    const stampId = await page.evaluate(() => { const t = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_qa_stamp_race', question: '授权确认期间仍在生成的问题', scope: 'node', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [h.focus], contextKey: 'consent_1\ncurrent-route-context' }); h.copilot.openNarrative(h.store.graph.savedPaths[0].id); return t.turnId; });
    await page.locator(`[data-narrative-turn="${stampId}"]`).check();
    await page.evaluate(id => h.setConfirmationHook(() => { h.aiStore.updateTurn(id, { status: 'completed', answer: '确认期间才收到的新原文。', model: 'controlled-test-model' }); h.copilot.update(); }), stampId);
    await page.locator('#generateNarrative').click(); await page.getByText('授权、焦点或所选问答已经变化，请重新选择后确认。', { exact: true }).waitFor(); assert.equal(requests.filter(r => r.path.endsWith('/summary/draft')).length, before);
    const legacyId = await page.evaluate(() => { const t = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_empty_import_signature', question: '没有授权签名的导入问题', scope: 'node', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [h.focus], contextKey: '' }); h.aiStore.updateTurn(t.turnId, { status: 'completed', answer: '导入的历史原文仅在本机可见。', model: 'controlled-test-model' }); h.setConsent('consent_1'); h.copilot.openNarrative(h.store.graph.savedPaths[0].id); return t.turnId; });
    assert.equal(await page.locator('[data-narrative-turn]:checked').count(), 25); assert.equal(await page.locator(`[data-narrative-turn="${legacyId}"]`).isChecked(), false); assert((await page.locator(`[data-narrative-turn="${legacyId}"]`).locator('..').innerText()).includes('需重新授权发送原文'));
  });
  await check('route draft maps explicitly selected graph history to tree, preserves DIY and user versions, and purges deleted derived text', async () => {
    await page.evaluate(() => {
      const other = h.store.graph.nodes.find(n => n.title === '另一条路线'); const t = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_extra', question: '另一条路线的公开考虑', scope: 'node', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [other.id] }); h.aiStore.updateTurn(t.turnId, { status: 'completed', answer: '公开的补充背景，受控回答。', model: 'controlled-test-model' });
      const global = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_extra_global', question: '全树公开问题需要显式追加', scope: 'graph', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [h.store.graph.rootNodeId] }); h.aiStore.updateTurn(global.turnId, { status: 'completed', answer: '全树的公开背景，默认不进入路线摘要。', model: 'controlled-test-model' });
      h.copilot.openNarrative(h.store.graph.savedPaths[0].id);
    });
    assert.equal(await page.locator('.narrative-extra [data-narrative-turn]:checked').count(), 0); await page.locator('.narrative-extra summary').click(); for (const input of await page.locator('.narrative-extra [data-narrative-turn]').all()) await input.check();
    await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor(); assert((await page.locator('#panelScroll').innerText()).includes('我自己写的 DIY 路线说明。'));
    const request = requests.filter(r => r.path.endsWith('/summary/draft')).at(-1); assert(request.body.turns.every(t => t.updatedAt)); assert(!JSON.stringify(request.body.graph).includes('另一条路线')); assert.equal(request.body.explicitAdditionalTurnIds.length, 2);
    const global = request.body.turns.find(t => t.question === '全树公开问题需要显式追加'); assert(global); assert.equal(global.scope, 'tree'); assert(request.body.explicitAdditionalTurnIds.includes(global.turnId));
    await page.locator('#narrative_title').fill('我的路线介绍'); await page.locator('#confirmNarrativeDraft').click(); await page.locator('.ai-narrative-confirmed h4').getByText('我的路线介绍', { exact: true }).waitFor();
    await page.locator('#editUserNarrative').click(); await page.locator('#narrativeUser_destination').fill('用户自写的新目标'); await page.locator('#saveUserNarrative').click(); assert((await page.locator('.ai-narrative-confirmed').innerText()).includes('用户自写的新目标'));
    await page.locator('#generateNarrative').click(); await page.locator('#narrativeDraftForm').waitFor(); assert((await page.locator('.ai-narrative-confirmed').innerText()).includes('用户自写的新目标'));
    await page.evaluate(() => { const n = h.aiStore.narrative(h.store.graph, h.store.graph.savedPaths[0].id); h.aiStore.deleteTurn(n.inputTurnIds[0], h.store.graph.graphId); h.copilot.renderTab('narrative'); }); assert.equal(await page.locator('.ai-narrative-confirmed').count(), 0); assert.equal(await page.locator('#narrativeDraftForm').count(), 0); assert((await page.locator('#panelScroll').innerText()).includes('我自己写的 DIY 路线说明。'));
  });
  await check('a question added while a narrative is generating rejects the old result', async () => {
    summaryDelay = 500; await page.locator('#generateNarrative').click(); await page.getByText('正在梳理…', { exact: true }).waitFor();
    await page.evaluate(() => { const t = h.aiStore.createTurn({ graphId: h.store.graph.graphId, rootNodeId: h.store.graph.rootNodeId, clientRequestId: 'fixture_during_summary', question: '生成期间的新问题', scope: 'node', graphRevisionAtAsk: h.store.graph.revision, focusNodeIds: [h.focus] }); h.aiStore.updateTurn(t.turnId, { status: 'unconfigured', errorMessage: '受控未配置状态' }); h.copilot.update(); });
    await page.getByText('相关问答在生成期间已更新，请重新梳理，旧结果没有保存。', { exact: true }).waitFor(); assert.equal(await page.locator('#narrativeDraftForm').count(), 0); summaryDelay = 0;
  });
  await check('mobile bottom drawer is bounded, internally scrolls and remains closable with visible canvas', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { h.ctx.showMobile(false); h.copilot.update(); }); if (await page.locator('#aiHistoryDrawer').isHidden()) await page.locator('#aiHistoryBar').click();
    const metrics = await page.locator('#aiHistoryDrawer').evaluate(el => ({ height: el.getBoundingClientRect().height, bottom: el.getBoundingClientRect().bottom, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })); assert(metrics.height <= 844 * .45 + 1); assert(metrics.bottom <= 844 - 57 + 1); assert(metrics.scrollHeight > metrics.clientHeight);
    assert(await page.locator('#canvas').isVisible()); assert(await page.locator('#closeAIHistory').isVisible()); await page.screenshot({ path: resolve(out, 'history-mobile.png') }); await page.locator('#closeAIHistory').click(); assert(await page.locator('#aiHistoryDrawer').isHidden());
  });
  assert.deepEqual(errors, []);
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); console.error(error); process.exitCode = 1; }
finally { await writeFile(resolve(out, 'results.json'), JSON.stringify({ fixture: 'controlled provider, not live DeepSeek', checks, errors }, null, 2)); await context.close(); await browser.close(); await new Promise(r => server.close(r)); }
