import assert from 'node:assert/strict';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGraph, applyOperations } from '../journey/graph.js';
import { launchBrowser } from './browser-runtime.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const OUT = resolve('artifacts/forest');
const GRAPH_KEY = 'shiyu-zuxia.graph.v1';
const WORKSPACE_KEY = 'shiyu-zuxia.workspace.v1';
const result = { baseUrl: BASE, syntheticDataOnly: true, startedAt: new Date().toISOString(), tests: [], screenshots: [], browserErrors: [], liveModelVerified: false };
await mkdir(OUT, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
context.setDefaultTimeout(12000);
const page = await context.newPage();
page.on('pageerror', error => result.browserErrors.push(error.message));
const activeId = p => new URL(p.url()).pathname.split('/')[2];
async function library(p = page) {
  return p.evaluate(async () => { const { TreeLibrary } = await import('/journey/forest.js'); return new TreeLibrary(localStorage).list(); });
}
async function compartment(p, key = GRAPH_KEY, id = activeId(p)) {
  return p.evaluate(async ({ key, id }) => {
    const { TreeLibrary } = await import('/journey/forest.js');
    return JSON.parse(new TreeLibrary(localStorage).scopedStorage(id).getItem(key) || 'null');
  }, { key, id });
}
async function aiData(p = page, id = activeId(p)) {
  return p.evaluate(async id => {
    const { AIStore } = await import('/journey/ai-store.js');
    return new AIStore(localStorage).exportData(id);
  }, id);
}
async function check(name, action, mode = 'real-browser-synthetic-data') {
  const started = Date.now();
  try { const detail = await action(); result.tests.push({ name, mode, passed: true, durationMs: Date.now() - started, detail }); console.log(`PASS ${name}`); }
  catch (error) { result.tests.push({ name, mode, passed: false, durationMs: Date.now() - started, error: error.message, stack: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); throw error; }
}
async function shot(name, p = page) {
  await p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('visible'));
  const path = resolve(OUT, name); await p.screenshot({ path, animations: 'disabled', fullPage: true }); result.screenshots.push(path);
}
async function hub(p = page) { await p.locator('#backToTrees').click(); await p.waitForURL(/\/trees$/); await p.locator('#savedTrees').waitFor({ state: 'visible' }); }
async function open(id, p = page) {
  await p.locator(`[data-act="open"][data-id="${id}"]`).click();
  await p.waitForURL(`${BASE}/trees/${id}`); await p.locator('#canvas').waitFor({ state: 'visible' });
}
async function create(type, title, description = '', p = page) {
  await p.locator(`[data-create="${type}"]`).click();
  await p.locator('#createTreeDialog').waitFor({ state: 'visible' });
  await p.locator('#treeName').fill(title); await p.locator('#treeDescription').fill(description);
  await p.locator('#createTreeSubmit').click(); await p.waitForURL(/\/trees\/[^/]+$/);
  await p.locator('#canvas').waitFor({ state: 'visible' }); return activeId(p);
}
async function autosaved(p, title) {
  await poll(p, async () => (await compartment(p))?.graph.nodes.some(node => node.title === title), `automatic save of ${title}`);
}
// The bundled browser runtime treats an async waitForFunction predicate as a
// truthy Promise. Await storage reads on the Node side so these checks really
// wait for the application's debounced autosave without clicking Save.
async function poll(p, predicate, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await predicate()) return; await p.waitForTimeout(60); }
  assert.fail(`Timed out waiting for ${label}`);
}
async function add(title, p = page) {
  await p.locator('#add').click(); await p.locator('#custom').fill(title); await p.locator('#newKind').selectOption('other');
  await p.locator('#confirmGrow').click(); await p.locator('#growDialog').waitFor({ state: 'hidden' }); await autosaved(p, title);
}
async function find(title, p = page) { await p.locator('#search').fill(title); await p.locator('#find').click(); }
async function ask(text, p = page) {
  await p.locator('#chatTab').click(); await p.locator('#question').fill(text); await p.locator('#send').click();
  await p.waitForFunction(() => !document.getElementById('send').disabled);
  await p.locator('#chatMessages .message.ai').last().waitFor({ state: 'visible' });
}
async function confirm(p = page) { await p.locator('#confirmDialog').waitFor({ state: 'visible' }); await p.locator('#confirmAction').click(); await p.locator('#confirmDialog').waitFor({ state: 'hidden' }); }

const requests = [];
let lateResolve;
let lateStartedResolve;
await context.route('**/api/journey/ai/chat', async route => {
  const body = route.request().postDataJSON(); requests.push(body);
  if (body.message === '合成延迟请求') { lateStartedResolve?.(); await new Promise(resolve => { lateResolve = resolve; }); }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: `受控浏览器回答：${body.message}`, proposedOperations: [], usedGraphRevision: body.graph.revision, contextSummary: '仅当前树的合成测试内容', caveats: ['受控测试应答，并非真实模型。'] }) }).catch(() => {});
});

let careerA, careerB, life, thought, blank, duplicate, imported;
let savedA, savedAI, exportedText;
try {
  await check('Opening keyboard activation only opens an empty tree library', async () => {
    assert.equal((await page.goto(`${BASE}/journey`)).status(), 200);
    assert(await page.locator('#intro').isVisible()); assert.equal(await page.locator('#intro button').count(), 1);
    await shot('opening-desktop.png');
    await page.locator('#start').focus(); await page.keyboard.press('Enter'); await page.waitForURL(`${BASE}/trees`);
    assert(await page.locator('#app').isHidden()); assert.equal((await library()).length, 0);
    assert.equal(await page.locator('[data-create]').count(), 4);
    assert.match(await page.locator('#savedTrees').innerText(), /创建|新树|新建/);
    assert.match(await page.locator('.hub-foot').innerText(), /当前浏览器本地/);
    assert.equal(await page.locator('#treeHub a[href="/index.html"]').count(), 1);
    await shot('library-empty-desktop.png');
  });
  await check('All four types start with one root and same-name career trees remain distinct', async () => {
    for (const [type, title] of [['career', '同名职业路线'], ['career', '同名职业路线'], ['life', '生活的节奏'], ['thought', '思想与热爱'], ['blank', '我的空白树']]) {
      const id = await create(type, title, `${type} 的合成测试描述`);
      const data = await compartment(page); assert.equal(data.graph.nodes.length, 1); assert.equal(data.graph.edges.length, 0);
      if (type === 'career') { if (!careerA) careerA = id; else careerB = id; }
      if (type === 'life') life = id; if (type === 'thought') thought = id; if (type === 'blank') blank = id;
      await hub();
    }
    assert.notEqual(careerA, careerB);
    const entries = await library(); assert.equal(entries.length, 5);
    assert.equal(entries.filter(tree => tree.title === '同名职业路线').length, 2);
    assert.deepEqual(new Set(entries.map(tree => tree.type)), new Set(['career', 'life', 'thought', 'blank']));
    for (const entry of entries) { assert.equal(entry.nodeCount, 1); assert.ok(Number.isFinite(Date.parse(entry.updatedAt))); assert.ok(entry.description); }
    await shot('library-desktop.png');
  });
  await check('Node edits, edge conditions and multiple selected routes autosave without a manual save', async () => {
    await open(careerA); await add('A 专属第一条路线'); await page.locator('#root').click(); await add('A 专属第二条路线');
    await find('A 专属第一条路线'); await page.locator('#editTitle').fill('A 已修改的第一条路线');
    await page.getByRole('button', { name: '保存节点', exact: true }).click(); await autosaved(page, 'A 已修改的第一条路线');
    const graph = (await compartment(page)).graph, edge = graph.edges.find(edge => edge.to === graph.nodes.find(node => node.title === 'A 已修改的第一条路线').id);
    assert.ok(edge, `edited node must retain an incoming edge: ${JSON.stringify({ nodes: graph.nodes.map(node => ({ id: node.id, title: node.title })), edges: graph.edges })}`);
    await page.locator(`[data-edge="${edge.id}"]`).click(); await page.locator('#reqLabel').fill('A 本树的时间条件');
    await page.locator('#reqKind').selectOption('time'); await page.getByRole('button', { name: '添加条件', exact: true }).click();
    await page.locator('#multi').click();
    await find('A 已修改的第一条路线'); await page.getByRole('button', { name: 'A 已修改的第一条路线', exact: true }).click();
    await find('A 专属第二条路线'); await page.getByRole('button', { name: 'A 专属第二条路线', exact: true }).click();
    // The canvas exposes selected routes independently of the focused detail.
    if (await page.locator('#nodes .node.focus').count() !== 2) await page.getByRole('button', { name: 'A 专属第二条路线', exact: true }).click();
    assert.equal(await page.locator('#nodes .node.focus').count(), 2);
    await page.locator('#savePaths').click(); await page.locator('#fit').click();
    await ask('A 本树的合成问题');
    await hub(); savedA = await compartment(page, GRAPH_KEY, careerA);
    savedAI = await aiData(page, careerA);
    assert.equal(savedA.ui.selected.length, 2); assert.ok(savedA.ui.focused);
    assert.ok(savedAI.turns.some(turn => turn.question === 'A 本树的合成问题' && turn.status === 'completed' && turn.answer.includes('A 本树的合成问题')));
    assert.ok(savedAI.turns.every(turn => turn.graphId === careerA));
    assert.ok(savedA.graph.edges.some(edge => edge.requirements.some(item => item.label === 'A 本树的时间条件')));
    assert.equal(savedA.graph.savedPaths.length, 2);
  });
  await check('Switching same-type trees isolates nodes, focus, selections and AI request history', async () => {
    await open(careerB);
    const before = await compartment(page); assert.equal(before.graph.nodes.length, 1); assert.equal(before.ui.selected.length, 0); assert.equal((await aiData()).turns.length, 0);
    await add('B 专属路线'); await ask('B 本树的合成问题');
    const outbound = requests.at(-1); assert.doesNotMatch(JSON.stringify(outbound), /A 本树的合成问题|A 已修改|A 专属/);
    assert.ok(outbound.graph.nodes.some(node => node.title === 'B 专属路线'));
    assert.ok((await aiData()).turns.every(turn => turn.graphId === careerB && turn.question.includes('B 本树')));
    assert.deepEqual(await aiData(page, careerA), savedAI);
    await hub(); await open(careerA);
    assert.deepEqual((await compartment(page)).graph, savedA.graph);
    assert.equal(await page.locator('#nodes .node.focus').count(), 2);
    await page.locator('#chatTab').click();
    assert.match(await page.locator('#chatMessages').innerText(), /A 本树的合成问题/);
    assert.doesNotMatch(await page.locator('#chatMessages').innerText(), /B 本树的合成问题/);
    await shot('canvas-desktop.png');
  });
  await check('Refreshing a canvas restores its route, selected paths, focused node and chat', async () => {
    await page.reload(); await page.locator('#canvas').waitFor({ state: 'visible' }); assert.equal(activeId(page), careerA);
    assert.equal(await page.locator('#nodes .node.focus').count(), 2);
    assert.equal((await compartment(page)).ui.focused, savedA.ui.focused);
    await page.locator('#chatTab').click(); assert.match(await page.locator('#chatMessages').innerText(), /A 本树的合成问题/);
    assert.deepEqual(await aiData(), savedAI);
    await ask('A 刷新后的合成问题');
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /B 本树的合成问题|B 专属/);
    savedAI = await aiData(); assert.equal(savedAI.turns.length, 2);
    await hub(); await page.reload(); assert.equal(await page.locator('#savedTrees .saved-tree').count(), 5);
  });
  await check('Browser back and forward revisit the same independent tree without creating another', async () => {
    await open(life); await hub(); await page.goBack(); await page.locator('#canvas').waitFor({ state: 'visible' }); assert.equal(activeId(page), life);
    await page.goForward(); await page.waitForURL(`${BASE}/trees`); assert.equal((await library()).length, 5);
  });
  await check('A missing tree route offers the library without replacing existing trees', async () => {
    const before = await library(); await page.goto(`${BASE}/trees/missing-synthetic-id`);
    assert(await page.locator('#missingTree').isVisible()); assert(await page.locator('#app').isHidden());
    await page.locator('#missingBack').click(); await page.waitForURL(`${BASE}/trees`); assert.deepEqual(await library(), before);
  });
  await check('Renaming and duplicating preserve identity and make independently editable copies', async () => {
    page.once('dialog', dialog => dialog.accept('重命名后的职业路线'));
    await page.locator(`[data-act="rename"][data-id="${careerA}"]`).click();
    assert.equal((await library()).find(tree => tree.id === careerA).title, '重命名后的职业路线');
    const ids = new Set((await library()).map(tree => tree.id));
    await page.locator(`[data-act="duplicate"][data-id="${careerA}"]`).click();
    duplicate = (await library()).find(tree => !ids.has(tree.id)).id;
    await open(duplicate); assert.equal((await compartment(page)).graph.nodes.length, savedA.graph.nodes.length);
    const copiedAI = await aiData();
    assert.equal(copiedAI.turns.length, savedAI.turns.length);
    assert.ok(copiedAI.turns.every(turn => turn.graphId === duplicate && !savedAI.turns.some(source => source.turnId === turn.turnId)));
    await page.locator('#chatTab').click(); assert.match(await page.locator('#chatMessages').innerText(), /A 本树的合成问题/);
    await add('副本独有的新想法'); await ask('副本独有的合成问题'); await hub();
    assert.ok(!(await compartment(page, GRAPH_KEY, careerA)).graph.nodes.some(node => node.title === '副本独有的新想法'));
    assert.ok((await compartment(page, GRAPH_KEY, duplicate)).graph.nodes.some(node => node.title === '副本独有的新想法'));
    assert.doesNotMatch(JSON.stringify(await aiData(page, careerA)), /副本独有的合成问题/);
  });
  await check('A full tree JSON backup imports as a new document without overwriting the source', async () => {
    const pending = page.waitForEvent('download'); await page.locator(`[data-act="export"][data-id="${careerA}"]`).click();
    if (await page.locator('#confirmDialog').isVisible()) await confirm();
    const download = await pending; const path = resolve(OUT, 'tree-backup.json'); await download.saveAs(path); exportedText = await readFile(path, 'utf8');
    const archive = JSON.parse(exportedText); assert.match(exportedText, /A 已修改的第一条路线/); assert.match(exportedText, /A 本树的合成问题/); assert.doesNotMatch(exportedText, /B 专属路线/);
    assert.equal(archive.ai.schemaVersion, 1); assert.equal(archive.ai.turns.length, savedAI.turns.length);
    assert.ok(archive.ai.turns.every(turn => turn.graphId === careerA));
    assert.doesNotMatch(JSON.stringify(archive.ai), /B 本树|副本独有/);
    const ids = new Set((await library()).map(tree => tree.id));
    await page.locator('#importTreeInput').setInputFiles({ name: 'tree-backup.json', mimeType: 'application/json', buffer: Buffer.from(exportedText) });
    if (await page.locator('#confirmDialog').isVisible()) await confirm();
    await poll(page, async () => (await library()).length === ids.size + 1, 'imported tree to appear in the library');
    imported = (await library()).find(tree => !ids.has(tree.id)).id; assert.notEqual(imported, careerA);
    if (new URL(page.url()).pathname !== '/trees') await hub();
    await open(imported); const data = await compartment(page);
    assert.equal(data.graph.nodes.length, savedA.graph.nodes.length); assert.equal(data.graph.edges.length, savedA.graph.edges.length);
    const importedAI = await aiData();
    assert.equal(importedAI.turns.length, savedAI.turns.length);
    assert.ok(importedAI.turns.every(turn => turn.graphId === imported && !savedAI.turns.some(source => source.turnId === turn.turnId)));
    await page.locator('#chatTab').click(); assert.match(await page.locator('#chatMessages').innerText(), /A 本树的合成问题/);
    await add('导入树独有的新想法'); await ask('导入树独有的合成问题'); await hub();
    assert.ok(!(await compartment(page, GRAPH_KEY, careerA)).graph.nodes.some(node => node.title === '导入树独有的新想法'));
    assert.doesNotMatch(JSON.stringify(await aiData(page, careerA)), /导入树独有的合成问题/);
  });
  await check('Canceling deletion preserves the tree; confirmation removes only its own compartments', async () => {
    await open(blank); await ask('待删除空白树的合成问题'); await hub();
    const deletedAI = await aiData(page, blank), retainedAI = await aiData(page, careerA);
    assert.equal(deletedAI.turns.length, 1);
    const count = (await library()).length;
    await page.locator(`[data-act="delete"][data-id="${blank}"]`).click(); await page.locator('#confirmDialog button[value="cancel"]').click();
    assert.equal((await library()).length, count); assert.ok((await library()).some(tree => tree.id === blank));
    assert.deepEqual(await aiData(page, blank), deletedAI);
    await page.locator(`[data-act="delete"][data-id="${blank}"]`).click(); await confirm();
    assert.equal((await library()).length, count - 1); assert.ok(!(await library()).some(tree => tree.id === blank));
    assert.deepEqual(await aiData(page, blank), { schemaVersion: 1, turns: [], narratives: [] });
    assert.deepEqual(await aiData(page, careerA), retainedAI);
    assert.ok((await compartment(page, GRAPH_KEY, careerA)).graph.nodes.some(node => node.title === 'A 已修改的第一条路线'));
  });
  await check('A delayed AI answer from a departed tree cannot enter another tree conversation', async () => {
    const intercepted = new Promise(resolve => { lateStartedResolve = resolve; });
    await open(careerA); await page.locator('#chatTab').click(); await page.locator('#question').fill('合成延迟请求'); await page.locator('#send').click(); await intercepted;
    await page.waitForFunction(() => document.getElementById('send').disabled); await hub(); await open(careerB);
    lateResolve?.(); await page.locator('#chatTab').click(); await ask('B 切树后的合成问题');
    assert.doesNotMatch(await page.locator('#chatMessages').innerText(), /合成延迟请求/);
    assert.doesNotMatch(JSON.stringify(await aiData()), /合成延迟请求/);
    const departed = await aiData(page, careerA);
    assert.ok(departed.turns.some(turn => turn.question === '合成延迟请求' && turn.status === 'cancelled'));
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /A 本树的合成问题|合成延迟请求|A 已修改/);
    await hub();
  }, 'controlled-http-response-ui');
  await check('Returning to the opening and entering again retains the entire library', async () => {
    const before = await library(); await page.locator('#hubBackIntro').click(); await page.waitForURL(`${BASE}/journey`);
    assert(await page.locator('#intro').isVisible()); await page.locator('#start').click(); await page.waitForURL(`${BASE}/trees`);
    assert.deepEqual(await library(), before); await shot('library-saved-desktop.png');
  });
  await check('Deleting a subtree removes exclusive descendants, preserves a shared target and can be undone', async () => {
    await open(thought); await add('待删分支起点'); await add('仅此分支的下级'); await add('仍被其他路线共享的目标');
    const sharedId = (await compartment(page)).graph.nodes.find(node => node.title === '仍被其他路线共享的目标').id;
    await page.locator('#root').click(); await add('另一条保留路线');
    await page.locator('#connectTarget').selectOption(sharedId); await page.locator('#connectNode').click();
    await poll(page, async () => (await compartment(page)).graph.edges.filter(edge => edge.to === sharedId).length === 2, 'the second parent connection');
    const before = (await compartment(page)).graph;
    await find('待删分支起点'); await page.locator('#deleteSubtree').click(); await confirm();
    await poll(page, async () => !(await compartment(page)).graph.nodes.some(node => node.title === '待删分支起点'), 'confirmed subtree deletion');
    const after = (await compartment(page)).graph;
    assert.ok(!after.nodes.some(node => node.title === '仅此分支的下级'));
    assert.ok(after.nodes.some(node => node.id === sharedId)); assert.equal(after.edges.filter(edge => edge.to === sharedId).length, 1);
    assert.ok(after.nodes.some(node => node.title === '另一条保留路线'));
    await page.locator('#undo').click(); await autosaved(page, '待删分支起点');
    assert.deepEqual((await compartment(page)).graph.nodes, before.nodes); assert.deepEqual((await compartment(page)).graph.edges, before.edges);
    await hub();
  });
  await check('Reset confirmation only clears the current tree and undo restores its full graph', async () => {
    await open(thought); const before = (await compartment(page)).graph, other = (await compartment(page, GRAPH_KEY, careerA)).graph;
    await page.locator('#resetTree').click(); await page.locator('#confirmDialog button[value="cancel"]').click();
    assert.deepEqual((await compartment(page)).graph, before);
    await page.locator('#resetTree').click(); await confirm();
    await poll(page, async () => (await compartment(page)).graph.nodes.length === 1, 'reset tree to autosave');
    assert.equal((await compartment(page)).graph.edges.length, 0); assert.deepEqual((await compartment(page, GRAPH_KEY, careerA)).graph, other);
    await page.locator('#undo').click(); await autosaved(page, '待删分支起点');
    assert.deepEqual((await compartment(page)).graph.nodes, before.nodes); assert.deepEqual((await compartment(page)).graph.edges, before.edges);
    await hub();
  });
  await check('A damaged primary still allows exporting the valid recovered draft and the original corrupt bytes', async () => {
    const c = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true }); const p = await c.newPage();
    try {
      await p.goto(`${BASE}/trees`); const id = await create('blank', '损坏恢复的合成树', '', p); await add('恢复副本中的真实节点', p);
      const broken = '{synthetic-corrupt-primary';
      await p.evaluate(async ({ id, key, broken }) => {
        const { TreeLibrary } = await import('/journey/forest.js'); const storage = new TreeLibrary(localStorage).scopedStorage(id);
        storage.setItem(`${key}.backup`, storage.getItem(key)); storage.setItem(key, broken);
      }, { id, key: GRAPH_KEY, broken });
      await p.reload(); await p.locator('#canvas').waitFor({ state: 'visible' });
      assert(await p.locator('#storageNotice').isVisible()); assert(await p.locator('#recoverDraft').isVisible());
      const pending = p.waitForEvent('download'); await p.locator('#export').click(); const download = await pending;
      const path = resolve(OUT, 'recovered-draft.json'); await download.saveAs(path); const archive = JSON.parse(await readFile(path, 'utf8'));
      assert.ok(archive.document.graph.nodes.some(node => node.title === '恢复副本中的真实节点'));
      assert.equal(archive.recovery.primaryRaw, broken);
      assert.equal(await p.evaluate(async ({ id, key }) => { const { TreeLibrary } = await import('/journey/forest.js'); return new TreeLibrary(localStorage).scopedStorage(id).getItem(key); }, { id, key: GRAPH_KEY }), broken);
      await shot('recovered-draft-desktop.png', p);
    } finally { await c.close(); }
  });
  await check('390px touch workflow can create, grow, visit AI and comparison, and reopen a saved tree', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const p = await mobileContext.newPage(); p.on('pageerror', error => result.browserErrors.push(error.message));
    try {
      await p.goto(`${BASE}/journey`); await p.locator('#start').tap(); await p.waitForURL(`${BASE}/trees`); await shot('library-mobile.png', p);
      const id = await create('thought', '手机上的思想与热爱', '移动端合成测试', p); await add('手机上的开放问题', p); await p.locator('#fit').tap();
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)); await shot('canvas-mobile.png', p);
      await p.locator('#mobileAI').tap(); assert(await p.locator('#rightpanel').isVisible()); assert(await p.locator('#question').isVisible()); await shot('ai-mobile.png', p);
      await p.locator('#mobilePaths').tap(); assert(await p.locator('#rightpanel').isVisible()); assert.match(await p.locator('#panelScroll').innerText(), /比较|路线|路径/); await shot('compare-mobile.png', p);
      await hub(p); await open(id, p); assert.ok((await compartment(p)).graph.nodes.some(node => node.title === '手机上的开放问题'));
      await p.reload(); await p.locator('#canvas').waitFor({ state: 'visible' }); assert.equal(activeId(p), id);
    } finally { await mobileContext.close(); }
  });
  await check('Existing single-tree history migrates once, clears redundant chat and preserves the source graph and workspace', async () => {
    const c = await browser.newContext({ reducedMotion: 'reduce' }); const p = await c.newPage();
    let graph = createGraph({ title: '升级前的合成人生树' }); graph = applyOperations(graph, [{ op: 'add_node', tempId: 'old', node: { title: '迁移前的专属节点', kind: 'other' } }, { op: 'add_edge', fromId: graph.rootNodeId, toId: 'old' }]);
    const old = JSON.stringify({ storageVersion: 1, serial: 'migration-source', graph, undo: [], redo: [], ui: { entered: true, selected: [], collapsed: [], chat: [{ role: 'user', content: '迁移前的本树问题' }, { role: 'assistant', content: '迁移前的本树回答' }] } });
    const oldWithoutChat = JSON.parse(old); delete oldWithoutChat.ui.chat;
    const oldWorkspace = JSON.stringify({ version: 1, useProfile: false, useDocuments: false, liveSearch: false, profile: null, documents: [{ id: 'migration-doc', title: '迁移前的合成资料', text: '资料与旧图一起保留', kind: 'text', shareWithAI: false }], research: null });
    await c.addInitScript(({ key, value, workspaceKey, workspaceValue }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      if (!localStorage.getItem(workspaceKey)) localStorage.setItem(workspaceKey, workspaceValue);
    }, { key: GRAPH_KEY, value: old, workspaceKey: WORKSPACE_KEY, workspaceValue: oldWorkspace });
    try {
      await p.goto(`${BASE}/trees`); assert.equal((await library(p)).length, 1); const id = (await library(p))[0].id;
      await open(id, p); assert.ok((await compartment(p)).graph.nodes.some(node => node.title === '迁移前的专属节点'));
      const migratedAI = await aiData(p);
      assert.ok(migratedAI.turns.some(turn => turn.question === '迁移前的本树问题' && turn.answer === '迁移前的本树回答' && turn.graphId === id));
      assert.equal((await compartment(p, WORKSPACE_KEY)).documents[0].text, '资料与旧图一起保留');
      assert.deepEqual(await p.evaluate(key => JSON.parse(localStorage.getItem(key)), GRAPH_KEY), oldWithoutChat);
      assert.equal(await p.evaluate(key => localStorage.getItem(key), WORKSPACE_KEY), oldWorkspace);
      await hub(p); await p.reload(); assert.equal((await library(p)).length, 1);
      assert.deepEqual(await p.evaluate(key => JSON.parse(localStorage.getItem(key)), GRAPH_KEY), oldWithoutChat);
      await open(id, p); assert.equal((await aiData(p)).turns.filter(turn => turn.question === '迁移前的本树问题').length, 1);
      await p.evaluate(async id => { const { AIStore } = await import('/journey/ai-store.js'); const store = new AIStore(localStorage); const turn = store.exportData(id).turns.find(t => t.question === '迁移前的本树问题'); store.deleteTurn(turn.turnId, id); }, id);
      await p.reload(); await p.locator('#canvas').waitFor({ state: 'visible' });
      assert.equal((await aiData(p)).turns.filter(turn => turn.question === '迁移前的本树问题').length, 0);
    } finally { await c.close(); }
  });
  await check('Storage permission denial is visible while a temporary tree remains editable', async () => {
    const c = await browser.newContext({ reducedMotion: 'reduce' });
    await c.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('合成测试：存储权限拒绝', 'SecurityError'); } }));
    const p = await c.newPage(); p.on('pageerror', error => result.browserErrors.push(error.message));
    try {
      await p.goto(`${BASE}/trees`); assert(await p.locator('#libraryNotice').isVisible()); assert.match(await p.locator('#libraryNotice').innerText(), /保存|存储|浏览器/);
      await create('blank', '无存储权限的临时树', '', p); await p.locator('#add').click(); await p.locator('#custom').fill('内存仍可编辑'); await p.locator('#confirmGrow').click();
      await p.getByRole('button', { name: '内存仍可编辑', exact: true }).waitFor({ state: 'visible' });
      assert.match(await p.locator('#saveStatus').innerText(), /保存|存储|内存|浏览器/); await shot('storage-denied.png', p);
    } finally { await c.close(); }
  });
} catch (_) {
  await shot('failure.png').catch(() => {});
} finally {
  lateResolve?.();
  if (result.browserErrors.length) result.tests.push({ name: 'No uncaught browser errors', passed: false, errors: result.browserErrors });
  result.requestSummary = requests.map(request => ({ graphId: request.graph.graphId, nodes: request.graph.nodes.length, selected: request.selectedNodeIds.length, history: request.history.length }));
  result.completedAt = new Date().toISOString(); result.summary = { passed: result.tests.filter(test => test.passed).length, failed: result.tests.filter(test => !test.passed).length };
  if (result.summary.failed === 0) await unlink(resolve(OUT, 'failure.png')).catch(() => {});
  await writeFile(resolve(OUT, 'results.json'), `${JSON.stringify(result, null, 2)}\n`); await context.close(); await browser.close();
  console.log(JSON.stringify(result.summary)); process.exitCode = result.summary.failed ? 1 : 0;
}
