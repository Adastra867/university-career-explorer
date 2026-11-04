import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import express from 'express';
import { launchBrowser } from './browser-runtime.mjs';
import { createJourneyRouter } from '../journey/server.js';
import { createGraph, applyOperations } from '../journey/graph.js';

const base = process.env.BASE_URL || 'http://127.0.0.1:5000';
const out = resolve('artifacts/journey');
await mkdir(out, { recursive: true });
const checks = [], failures = [], browserErrors = [];
async function check(name, fn, mode = 'real-browser-local-service') {
  try { const detail = await fn(); checks.push({ name, mode, passed: true, detail }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, mode, passed: false, error: error.message }); failures.push(name); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', error => browserErrors.push(error.message));
const key = 'shiyu-zuxia.graph.v1';
const treeId = p => new URL(p.url()).pathname.split('/')[2];
const saved = async p => p.evaluate(async ({ key, id }) => {
  const { TreeLibrary } = await import('/journey/forest.js');
  return JSON.parse(new TreeLibrary(localStorage).scopedStorage(id).getItem(key) || 'null');
}, { key, id: treeId(p) });
const current = async p => (await saved(p)).graph;
async function flush(p) { await p.locator('#save').click(); assert(await saved(p)); }
async function createTree(p, title = '浏览器回归职业树', type = 'career') {
  await p.locator(`[data-create="${type}"]`).click();
  await p.locator('#treeName').fill(title);
  await p.locator('#createTreeSubmit').click();
  await p.waitForURL(/\/trees\/[^/]+$/);
  await p.locator('#canvas').waitFor({ state: 'visible' });
}
async function seedTree(p, graph, serial, selected = []) {
  await p.evaluate(async ({ graph, serial, key, id, selected }) => {
    const { TreeLibrary } = await import('/journey/forest.js');
    graph.graphId = id;
    new TreeLibrary(localStorage).scopedStorage(id).setItem(key, JSON.stringify({ storageVersion: 1, serial, graph, undo: [], redo: [], ui: { entered: true, selected, collapsed: [] } }));
  }, { graph, serial, key, id: treeId(p), selected });
  await p.reload(); await p.locator('#canvas').waitFor({ state: 'visible' });
}
async function addCustom(p, title, kind = 'other') {
  await p.locator('#custom').fill(title); await p.locator('#newKind').selectOption(kind); await p.locator('#confirmGrow').click(); await p.locator('#growDialog').waitFor({ state: 'hidden' }); await flush(p);
}
const node = (p, title) => p.getByRole('button', { name: title, exact: true });
async function rootTitle(p) { const g = await current(p); return g.nodes.find(n => n.id === g.rootNodeId).title; }
async function findNode(p, title) { await p.locator('#search').fill(title); await p.locator('#find').click(); }
let fixtureServer, fixtureAppServer, fixtureCalls = [], fixtureMode = 'answer', fixtureValidateDelay = 0;
try {
  await check('P0-T01 opening contains name and one accessible light point', async () => {
    await page.goto(`${base}/journey`);
    assert(await page.locator('#intro').isVisible()); assert(await page.locator('#app').isHidden());
    assert.equal(await page.locator('#intro button').count(), 1);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.intro-copy')).opacity) > .99);
    await page.screenshot({ path: resolve(out, 'opening-desktop.png') });
  });
  await check('P0-T02 keyboard opening enters the empty library before explicit tree creation', async () => {
    await page.locator('#start').focus(); await page.keyboard.press('Enter');
    await page.locator('#intro').waitFor({ state: 'hidden' });
    await page.waitForURL(/\/trees$/);
    assert.equal(await page.locator('#savedTrees .saved-tree').count(), 0);
    assert(await page.locator('#app').isHidden());
    await createTree(page);
    assert.equal(await page.locator('.node.root').count(), 1);
    const rootBox = await page.locator('.node.root').boundingBox(), canvasBox = await page.locator('#canvas').boundingBox();
    assert(rootBox.x < canvasBox.width * .35);
    await page.screenshot({ path: resolve(out, 'workspace-empty.png') });
  });
  await check('P0-T04 DIY creates the real major from the root', async () => {
    await page.getByRole('button', { name: `从${await rootTitle(page)}继续生长`, exact: true }).click();
    await page.getByRole('button', { name: '从当前专业出发', exact: true }).click();
    await addCustom(page, '材料科学与工程', 'major');
    assert((await current(page)).nodes.some(n => n.title === '材料科学与工程'));
    await node(page, '材料科学与工程').click();
    assert.equal(await page.locator('#editTitle').inputValue(), '材料科学与工程');
    await node(page, await rootTitle(page)).click();
    assert.equal(await page.locator('#editTitle').inputValue(), await rootTitle(page));
    await node(page, '材料科学与工程').click();
  });
  await check('P0-T06 one transaction adds two independent candidate branches', async () => {
    await page.getByRole('button', { name: '从材料科学与工程继续生长', exact: true }).click();
    await page.getByRole('button', { name: '直接就业', exact: true }).click();
    await page.getByRole('button', { name: '继续深造', exact: true }).click();
    const before = await current(page);
    await page.locator('#confirmGrow').click(); await flush(page);
    const after = await current(page);
    assert.equal(after.nodes.length, before.nodes.length + 2); assert.equal(after.revision, before.revision + 1);
    await page.locator('#undo').click(); await flush(page); assert.equal((await current(page)).nodes.length, before.nodes.length);
    await page.locator('#redo').click(); await flush(page); assert.equal((await current(page)).nodes.length, after.nodes.length);
  });
  await check('P0-T05 branches continue past four levels without fixed depth', async () => {
    await findNode(page, '直接就业'); await page.getByRole('button', { name: '从直接就业继续生长', exact: true }).click();
    await page.getByRole('button', { name: '材料测试工程师', exact: true }).click(); await page.locator('#confirmGrow').click();
    await findNode(page, '继续深造'); await page.getByRole('button', { name: '从继续深造继续生长', exact: true }).click();
    await page.getByRole('button', { name: '新能源材料研发', exact: true }).click(); await page.locator('#confirmGrow').click();
    await findNode(page, '新能源材料研发'); await page.getByRole('button', { name: '从新能源材料研发继续生长', exact: true }).click();
    await addCustom(page, '长期研究项目', 'goal');
    await page.getByRole('button', { name: '从长期研究项目继续生长', exact: true }).click(); await addCustom(page, '第五层仍能继续', 'goal');
    assert.equal((await current(page)).nodes.length, 8);
  });
  await check('P0-T08 three editable edge conditions persist with necessity and explanation', async () => {
    const g = await current(page), target = g.nodes.find(n => n.title === '继续深造');
    const edge = g.edges.find(e => e.to === target.id);
    await findNode(page, '继续深造');
    await page.locator(`[data-edge="${edge.id}"]`).click();
    for (const [label, kind] of [['英语', 'skill'], ['科研经历', 'experience'], ['时间成本', 'time']]) {
      await page.locator('#reqKind').selectOption(kind); await page.locator('#reqLabel').fill(label); await page.locator('#reqDetail').fill(`${label}由用户规划，具体要求待核实`); await page.getByRole('button', { name: '添加条件', exact: true }).click();
    }
    await flush(page); assert.equal((await current(page)).edges.find(e => e.id === edge.id).requirements.length, 3);
  });
  await check('P0-T07 node editing and pointer drag survive refresh', async () => {
    await findNode(page, '第五层仍能继续'); await page.locator('#editTitle').fill('持续探索'); await page.getByRole('button', { name: '保存节点', exact: true }).click(); await flush(page);
    const before = await current(page), n = before.nodes.find(n => n.title === '持续探索');
    const box = await node(page, '持续探索').boundingBox();
    await page.mouse.move(box.x + 50, box.y + 35); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 85, { steps: 8 }); await page.mouse.up(); await flush(page);
    const moved = (await current(page)).nodes.find(x => x.id === n.id); assert.notDeepEqual(moved.position, n.position);
    await page.reload(); await page.locator('#intro').waitFor({ state: 'hidden' });
    assert.deepEqual((await current(page)).nodes.find(x => x.id === n.id).position, moved.position);
  });
  await check('P0-T09 touch-visible multi-select preserves both complete routes', async () => {
    await page.locator('#root').click();
    await page.locator('#multi').click();
    await node(page, await rootTitle(page)).click();
    await findNode(page, '材料测试工程师'); await node(page, '材料测试工程师').click();
    await node(page, '材料测试工程师').click();
    await findNode(page, '新能源材料研发'); await node(page, '新能源材料研发').click();
    await node(page, '新能源材料研发').click();
    assert.equal(await page.locator('#nodes .node.focus').count(), 2);
    assert(await page.locator('#comparison').isVisible());
    const text = await page.locator('#comparison').innerText(); assert(text.includes('材料测试工程师')); assert(text.includes('新能源材料研发'));
    await page.locator('#savePaths').click(); await flush(page); assert((await current(page)).savedPaths.length >= 2);
    await page.locator('#fit').click();
    // Capture the core two-route scenario at readable scale in a fresh context.
    let sample = await current(page);
    const extraIds = sample.nodes.filter(n => n.kind === 'goal').map(n => n.id);
    if (extraIds.length) sample = applyOperations(sample, extraIds.map(nodeId => ({ op: 'delete_node', nodeId })));
    const sc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), sp = await sc.newPage();
    await sp.goto(`${base}/trees`); await createTree(sp, '双路线截图');
    await seedTree(sp, sample, 'screenshot-scenario', sample.nodes.filter(n => n.kind === 'career').map(n => n.id));
    await sp.locator('#fit').click(); await flush(sp);
    await sp.waitForTimeout(4300); await sp.screenshot({ path: resolve(out, 'workspace-desktop.png') }); await sc.close();
  });
  await check('P0-T12 unconfigured AI gives real 503 and leaves graph unchanged', async () => {
    const status = await (await page.request.get(`${base}/api/journey/ai/status`)).json(); assert.equal(status.configured, false);
    const before = await current(page); await page.locator('#askCompare').click();
    await page.getByText(/AI 未配置，你仍然可以手动编辑人生树/).last().waitFor();
    assert.equal((await current(page)).revision, before.revision);
    await page.screenshot({ path: resolve(out, 'ai-unconfigured.png') });
  });
  await check('P0-T20 exported JSON includes schema, graph, requirements and saved paths', async () => {
    const pending = page.waitForEvent('download'); await page.locator('#workspaceTool').selectOption('privacy'); await page.locator('#backupExport').click(); const download = await pending;
    const path = resolve(out, 'browser-export.json'); await download.saveAs(path);
    const { readFile } = await import('node:fs/promises'); const exported = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(exported.schemaVersion, 1); assert(exported.savedPaths.length >= 2); assert(exported.edges.some(e => e.requirements.length === 3));
  });
  await check('P0-T14 shared target survives parent deletion and saved paths stay valid', async () => {
    if (await page.locator('#clearSelection').count()) await page.locator('#clearSelection').click();
    await findNode(page, '直接就业'); const g = await current(page), target = g.nodes.find(n => n.title === '新能源材料研发');
    await page.locator('#connectTarget').selectOption(target.id); await page.locator('#connectNode').click(); await flush(page);
    assert.equal((await current(page)).edges.filter(e => e.to === target.id).length, 2);
    await findNode(page, '继续深造'); await page.locator('#deleteNode').click();
    assert(await page.locator('#confirmText').innerText().then(t => t.includes('其他节点会保留')));
    await page.locator('#confirmAction').click(); await flush(page);
    assert((await current(page)).nodes.some(n => n.id === target.id)); assert.equal((await current(page)).edges.filter(e => e.to === target.id).length, 1);
    await page.locator('#undo').click(); await flush(page);
  });
  await check('P0-T16 offline editing and legacy storage isolation', async () => {
    await page.evaluate(() => { localStorage.setItem('careerPredictor', '{"sentinel":"original-assessment"}'); localStorage.setItem('careerPredictorHistory', '{"sentinel":"original-history"}'); localStorage.setItem('careerPredictorPrep', '{"sentinel":"original-prep"}'); });
    await context.setOffline(true); await page.locator('#add').click(); await addCustom(page, '离线也能编辑', 'other'); await context.setOffline(false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('careerPredictor')).sentinel), 'original-assessment');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('careerPredictorHistory')).sentinel), 'original-history');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('careerPredictorPrep')).sentinel), 'original-prep');
  });
  await check('cross-tab save conflict is visible and cannot silently replace newer data', async () => {
    await flush(page);
    const sibling = await context.newPage(); await sibling.goto(page.url()); await sibling.locator('#canvas').waitFor({ state: 'visible' });
    await sibling.locator('#add').click(); await addCustom(sibling, '另一页新增的分支', 'other');
    await page.locator('#storageNotice').waitFor();
    await page.locator('#reloadDraft').click(); await page.locator('#confirmAction').click();
    await page.locator('#storageNotice').waitFor({ state: 'hidden' });
    await sibling.close();
  });
  await check('P0-T03 reduced-motion and repeated activation open the library without creating a tree', async () => {
    const c = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 850 } }), p = await c.newPage();
    await p.goto(`${base}/journey`); await p.locator('#start').focus();
    await p.locator('#start').evaluate(button => { button.click(); button.click(); button.click(); });
    await p.waitForURL(/\/trees$/); assert.equal(await p.locator('#savedTrees .saved-tree').count(), 0);
    await createTree(p); assert.equal(await p.locator('.node.root').count(), 1); await c.close();
  });
  await check('P0-T18 390px mobile can add, edit conditions, select and ask AI', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }), p = await c.newPage();
    await p.goto(`${base}/journey`); await p.locator('#start').tap(); await p.locator('#intro').waitFor({ state: 'hidden' });
    await createTree(p, '手机回归树');
    await p.locator('#add').tap(); await addCustom(p, '手机上的起点', 'major');
    await p.getByRole('button', { name: '从手机上的起点继续生长', exact: true }).tap();
    await p.getByRole('button', { name: '直接就业', exact: true }).tap(); await p.getByRole('button', { name: '继续深造', exact: true }).tap(); await p.locator('#confirmGrow').tap();
    await p.locator('#fit').tap();
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: resolve(out, 'workspace-mobile.png') });
    const g = await current(p), edge = g.edges[0]; await p.locator(`[data-edge="${edge.id}"]`).tap();
    await p.locator('#reqLabel').fill('手机条件'); await p.getByRole('button', { name: '添加条件', exact: true }).tap();
    await p.locator('#mobileTree').tap(); await p.locator('#multi').tap();
    await findNode(p, '直接就业'); await node(p, '直接就业').tap();
    await findNode(p, '继续深造'); await node(p, '继续深造').tap(); await node(p, '继续深造').tap();
    assert.equal(await p.locator('#nodes .node.focus').count(), 2);
    assert(await p.locator('#growDialog').isHidden());
    await p.locator('#askCompare').tap();
    await p.getByText(/AI 未配置，你仍然可以手动编辑人生树/).last().waitFor();
    await p.screenshot({ path: resolve(out, 'ai-mobile.png') });
    await p.locator('#mobileTree').tap(); await findNode(p, '手机上的起点');
    await p.locator('#mobileAI').tap(); await p.locator('#detailTab').tap(); await p.locator('#expandDetail').tap(); await addCustom(p, '侧栏里长出的节点', 'goal');
    const selectedBox = await p.locator('#nodes .node.focus').last().boundingBox(), canvasBox = await p.locator('#canvas').boundingBox();
    assert(selectedBox.x >= canvasBox.x && selectedBox.x + selectedBox.width <= canvasBox.x + canvasBox.width);
    assert(selectedBox.y >= canvasBox.y && selectedBox.y + selectedBox.height <= canvasBox.y + canvasBox.height);
    await c.close();
  });

  // A real HTTP fixture provider exercises the production adapter and signed
  // proposal confirmation. It does not represent a real external model result.
  fixtureServer = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw), payload = JSON.parse(request.messages.at(-1).content);
    fixtureCalls.push({ ...payload, history: request.messages.slice(1, -1) });
    if (fixtureMode === 'invalid') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })); return; }
    const ctx = payload.graph_context || payload.context || payload;
    const selected = ctx.selected_node_ids || [], from = selected.at(-1) || ctx.nodes?.at(-1)?.id;
    const result = { answer: `受控测试提供者：已收到 ${ctx.nodes?.map(n => n.title).join('、')}。`, proposedOperations: fixtureMode === 'proposal' ? [{ op: 'add_node', tempId: 'fixture_new', node: { kind: 'career', title: '跨学科转型草案', description: '浏览器测试的受控草案，非真实AI建议。' } }, { op: 'add_edge', fromId: from, toId: 'fixture_new', relation: 'possible_path' }] : [], caveats: ['测试 fixture，不是外部模型。'] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  fixtureServer.listen(0, '127.0.0.1'); await once(fixtureServer, 'listening');
  const fixtureApp = express();
  fixtureApp.use('/api/journey/ai/validate', (_req, _res, next) => fixtureValidateDelay ? setTimeout(next, fixtureValidateDelay) : next());
  fixtureApp.use('/api/journey', createJourneyRouter({ env: { JOURNEY_AI_API_KEY: 'test-fixture-no-real-key', JOURNEY_AI_MODEL: 'test-fixture', JOURNEY_AI_BASE_URL: `http://127.0.0.1:${fixtureServer.address().port}/v1` }, rateLimitMs: 0 }));
  fixtureApp.get(['/', '/trees', '/trees/:treeId', '/journey'], (_req, res) => res.sendFile(resolve('journey/index.html'))); fixtureApp.use('/journey', express.static(resolve('journey')));
  fixtureAppServer = fixtureApp.listen(0, '127.0.0.1'); await once(fixtureAppServer, 'listening');
  const fixtureURL = `http://127.0.0.1:${fixtureAppServer.address().port}`;
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), p = await c.newPage();
  p.on('pageerror', e => browserErrors.push(e.message));
  await p.goto(`${fixtureURL}/journey`); await p.locator('#start').click(); await p.locator('#intro').waitFor({ state: 'hidden' });
  await createTree(p, '受控 AI 回归树');
  await p.locator('#add').click(); await addCustom(p, '材料科学本科', 'major');
  await check('P0-T10 configured adapter reads selected path via real HTTP fixture', async () => {
    await p.locator('#chatTab').click(); await p.locator('#question').fill('解释当前路径'); await p.locator('#send').click();
    await p.locator('.message.ai').last().waitFor(); assert((await p.locator('.message.ai').last().innerText()).includes('材料科学本科'));
    assert.equal(fixtureCalls.length, 1);
  }, 'controlled-provider-real-http-and-browser');
  await check('P0-T11 signed preview reject/confirm/undo never writes without confirmation', async () => {
    fixtureMode = 'proposal'; const before = await current(p); await p.locator('#propose').click(); await p.locator('#acceptProposal').waitFor();
    assert.equal((await current(p)).nodes.length, before.nodes.length); assert.equal(await p.locator('.ghost-node').count(), 1);
    await p.locator('#acceptProposal').scrollIntoViewIfNeeded();
    const acceptBox = await p.locator('#acceptProposal').boundingBox(), inputBox = await p.locator('#chatForm').boundingBox();
    assert(acceptBox.y >= 0 && acceptBox.y + acceptBox.height < 1000);
    assert(inputBox.y + inputBox.height < 1000);
    await p.screenshot({ path: resolve(out, 'proposal-preview-fixture.png') });
    await p.locator('#rejectProposal').click(); assert.equal((await current(p)).nodes.length, before.nodes.length);
    await p.locator('#propose').click(); await p.locator('#acceptProposal').waitFor(); await p.locator('#acceptProposal').click();
    await p.locator('#proposalArea .proposal').waitFor({ state: 'hidden' }); await flush(p);
    assert.equal((await current(p)).nodes.length, before.nodes.length + 1); assert.equal((await current(p)).nodes.at(-1).origin, 'ai');
    await p.locator('#undo').click(); await flush(p); assert.equal((await current(p)).nodes.length, before.nodes.length);
  }, 'controlled-provider-real-http-and-browser');
  await check('confirmation in flight disables rejection and cancel cannot later write', async () => {
    fixtureMode = 'proposal'; fixtureValidateDelay = 600;
    const before = await current(p); await p.locator('#propose').click(); await p.locator('#acceptProposal').waitFor(); await p.locator('#acceptProposal').click();
    assert(await p.locator('#rejectProposal').isDisabled()); await p.locator('#cancelAI').click();
    await p.waitForTimeout(800); await flush(p); assert.equal((await current(p)).revision, before.revision);
    fixtureValidateDelay = 0; await p.locator('#rejectProposal').click();
  }, 'controlled-provider-real-http-and-browser');
  await check('same-scope follow-up preserves history; private content is filtered before HTTP', async () => {
    fixtureMode = 'answer';
    await p.locator('#chatTab').click(); await p.locator('#question').fill('继续比较这条路径'); await p.locator('#send').click(); await p.locator('#send').waitFor({ state: 'visible' });
    await p.waitForFunction(() => !document.getElementById('send').disabled);
    assert(fixtureCalls.at(-1).history?.length > 0);
    await p.locator('#root').click(); await p.locator('#add').click(); await addCustom(p, '非常私密的笔记', 'other');
    await p.locator('#privateNode').check(); await p.getByRole('button', { name: '保存节点', exact: true }).click();
    await findNode(p, '材料科学本科'); await p.locator('#chatTab').click(); await p.locator('#scope').selectOption('tree');
    let outbound; await p.route('**/api/journey/ai/chat', route => { outbound = route.request().postDataJSON(); return route.continue(); });
    await p.locator('#question').fill('解释授权的整张树'); await p.locator('#send').click(); await p.waitForFunction(() => !document.getElementById('send').disabled);
    assert(!JSON.stringify(outbound).includes('非常私密的笔记')); assert.equal(outbound.history.length, 0);
    assert(!JSON.stringify(fixtureCalls.at(-1)).includes('非常私密的笔记'));
  }, 'controlled-provider-real-http-and-browser');
  await check('P0-T13 malformed provider JSON does not modify canvas', async () => {
    fixtureMode = 'invalid'; const before = await current(p); await p.locator('#question').fill('错误场景'); await p.locator('#send').click();
    await p.locator('.message.error').last().waitFor(); assert.equal((await current(p)).revision, before.revision);
  }, 'controlled-provider-real-http-and-browser');
  await c.close();
  await check('250-node canvas records real rendering and basic pan/zoom timings', async () => {
    let g = createGraph();
    for (let offset = 0; offset < 249; offset += 10) {
      const ops = []; for (let n = offset; n < Math.min(offset + 10, 249); n++) ops.push({ op: 'add_node', tempId: `stress_${n}`, node: { title: `压测节点 ${n}`, kind: 'goal', position: { x: 420 + (n % 20) * 300, y: Math.floor(n / 20) * 125 } } }, { op: 'add_edge', fromId: g.rootNodeId, toId: `stress_${n}` });
      g = applyOperations(g, ops);
    }
    const s = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), q = await s.newPage();
    await q.goto(`${base}/trees`); await createTree(q, '250 节点测试');
    await seedTree(q, g, 'stress-fixture');
    const t = performance.now(); await q.reload(); await q.locator('#canvas').waitFor({ state: 'visible' }); assert.equal(await q.locator('#nodes .node').count(), 250);
    const renderMs = Math.round(performance.now() - t); const panT = performance.now(); await q.mouse.move(500, 300); await q.mouse.wheel(0, -80); await q.waitForTimeout(100); const interactionMs = Math.round(performance.now() - panT);
    await s.close(); return { nodes: 250, edges: 249, reloadToReadyMs: renderMs, wheelAndWaitMs: interactionMs, note: 'Actual local measurement; not a 60fps claim or production SLA.' };
  });
  await check('reset current tree requires confirmation and preserves old assessment data', async () => {
    await page.locator('#resetTree').click();
    await page.locator('#confirmDialog button[value="cancel"]').click();
    assert((await current(page)).nodes.length > 1);
    await page.locator('#resetTree').click(); await page.locator('#confirmAction').click();
    await page.waitForFunction(() => document.querySelectorAll('#nodes .node').length === 1);
    assert.equal(await page.locator('#nodes .node').count(), 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('careerPredictor')).sentinel), 'original-assessment');
  });
  assert.deepEqual(browserErrors, []);
} catch (error) {
  if (!failures.length) failures.push(error.message);
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
} finally {
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify({ at: new Date().toISOString(), checks, browserErrors, failures, liveModelVerified: false }, null, 2));
  await context.close(); await browser.close();
  if (fixtureAppServer) { fixtureAppServer.closeAllConnections(); await new Promise(r => fixtureAppServer.close(r)); }
  if (fixtureServer) { fixtureServer.closeAllConnections(); await new Promise(r => fixtureServer.close(r)); }
}
console.log(`${checks.filter(c => c.passed).length}/${checks.length} browser checks passed`);
if (failures.length) process.exitCode = 1;
