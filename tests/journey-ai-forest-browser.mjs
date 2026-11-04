import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts/journey-ai-forest');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const result = { baseUrl: BASE, mode: 'real-browser-synthetic-AIStore-seed', liveModelVerified: false, syntheticDataOnly: true, checks: [], pageErrors: [], modelRequests: [], screenshots: [] };
const GRAPH = 'shiyu-zuxia.graph.v1', WORK = 'shiyu-zuxia.workspace.v1';
let browser, page, sourceId, otherId, copyId, importedId, sourceBefore, otherBefore, copyData, archiveText;
await mkdir(OUT, { recursive: true });
async function check(name, fn) {
  const started = Date.now();
  try { const detail = await fn(); result.checks.push({ name, passed: true, durationMs: Date.now() - started, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); }
  catch (error) { result.checks.push({ name, passed: false, error: error.stack }); throw error; }
}
async function poll(fn, label) { const start = Date.now(); while (Date.now() - start < 12000) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } throw new Error(`Timed out: ${label}`); }
const activeId = () => decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
async function trees() { return page.evaluate(async () => { const { TreeLibrary } = await import('/journey/forest.js'); return new TreeLibrary(localStorage).list(); }); }
async function bundle(id) {
  return page.evaluate(async id => {
    const { TreeLibrary } = await import('/journey/forest.js'), { AIStore } = await import('/journey/ai-store.js');
    const library = new TreeLibrary(localStorage), storage = library.scopedStorage(id), document = JSON.parse(storage.getItem('shiyu-zuxia.graph.v1') || 'null');
    const ai = new AIStore(localStorage).exportData(id);
    return { document, workspace: JSON.parse(storage.getItem('shiyu-zuxia.workspace.v1') || 'null'), ai, narrativeStatus: document?.graph.savedPaths[0] ? new AIStore(localStorage).narrative(document.graph, document.graph.savedPaths[0].id)?.status : null };
  }, id);
}
async function hub() { await page.locator('#backToTrees').click(); await page.waitForURL(`${BASE}/trees`); }
async function open(id) { await page.locator(`[data-act="open"][data-id="${id}"]`).click(); await page.waitForURL(`${BASE}/trees/${id}`); await page.locator('#canvas').waitFor({ state: 'visible' }); }
async function create(title) {
  await page.locator('[data-create="career"]').click(); await page.locator('#treeName').fill(title); await page.locator('#createTreeSubmit').click(); await page.waitForURL(/\/trees\/.+$/); await page.locator('#canvas').waitFor({ state: 'visible' }); return activeId();
}
async function add(title, kind = 'milestone') { await page.locator('#add').click(); await page.locator('#custom').fill(title); await page.locator('#newKind').selectOption(kind); await page.locator('#confirmGrow').click(); await page.locator('#save').click(); }
async function confirm() { await page.locator('#confirmDialog').waitFor({ state: 'visible' }); await page.locator('#confirmAction').click(); await page.locator('#confirmDialog').waitFor({ state: 'hidden' }); }
async function screenshot(name) { await poll(async () => !await page.locator('#toast').evaluate(el => el.classList.contains('visible')), 'toast finish'); const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); result.screenshots.push(file); }
function assertRemapped(source, target, id) {
  const g = target.document.graph, old = source.ai, ai = target.ai;
  assert.equal(g.graphId, id); assert.equal(ai.turns.length, 2); assert.equal(ai.narratives.length, 1); assert.equal(new Set(ai.turns.map(t => t.threadId)).size, 1);
  const turnIds = new Set(ai.turns.map(t => t.turnId)), nodeIds = new Set(g.nodes.map(n => n.id)), edgeIds = new Set(g.edges.map(e => e.id)), pathIds = new Set(g.savedPaths.map(p => p.id)), sourceIds = new Set((g.sources || []).map(s => s.id));
  for (const turn of ai.turns) {
    const original = old.turns.find(t => t.question === turn.question); assert(original);
    assert.equal(turn.graphId, id); assert.equal(turn.rootNodeId, g.rootNodeId); assert.notEqual(turn.turnId, original.turnId); assert.notEqual(turn.threadId, original.threadId); assert.notEqual(turn.clientRequestId, original.clientRequestId); assert.equal(turn.contextKey, '');
    assert.equal(turn.answer, original.answer); assert(turn.focusNodeIds.every(n => nodeIds.has(n))); assert(turn.pathNodeIds.every(n => nodeIds.has(n))); assert(turn.focusedPathEdgeIds.every(e => edgeIds.has(e))); assert(pathIds.has(turn.savedPathId)); assert(turn.citations.every(c => sourceIds.has(c.sourceId)));
  }
  const narrative = ai.narratives[0]; assert.equal(narrative.graphId, id); assert.equal(narrative.rootNodeId, g.rootNodeId); assert.notEqual(narrative.narrativeId, old.narratives[0].narrativeId); assert(pathIds.has(narrative.savedPathId));
  for (const variant of ['draft', 'confirmed', 'userEdited']) {
    const v = narrative[variant]; assert(v, `${variant} retained`); assert.equal(v.content.savedPathId, narrative.savedPathId);
    for (const refs of [v.inputTurnIds, v.sourceTurnIds, v.content.sourceTurnIds, v.turnStamps.map(s => s.turnId), ...v.content.requiredPreparation.map(p => p.supportingTurnIds)]) { assert(refs.length); assert(refs.every(t => turnIds.has(t))); assert(refs.every(t => !old.turns.some(o => o.turnId === t))); }
    assert(v.pathStamp.startsWith('imported:')); assert.equal(v.content.title, old.narratives[0][variant].content.title);
  }
  assert.equal(target.narrativeStatus, 'stale'); assert.equal(target.workspace.useProfile, false); assert.equal(target.workspace.useDocuments, false); assert(target.workspace.documents.every(d => d.shareWithAI === false)); assert.equal(target.workspace.profile.major, source.workspace.profile.major);
  // Graph-local node/edge/path/source IDs may stay stable: their namespace is
  // graphId. Every reference must resolve in the target graph, never in source AI.
}
async function unchanged() { assert.deepEqual(await bundle(sourceId), sourceBefore); assert.deepEqual(await bundle(otherId), otherBefore); }

try {
  browser = await launchBrowser(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce', locale: 'zh-CN' }); page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('request', request => { if (/\/api\/journey\/(?:ai\/(?:chat|propose|config\/test)|nodes\/.*\/ai-suggestions|paths\/.*\/summary\/draft)/.test(request.url())) result.modelRequests.push(new URL(request.url()).pathname); });
  await page.goto(`${BASE}/trees`); await page.locator('#savedTrees').waitFor({ state: 'visible' });
  await check('真实大厅创建两树，AIStore合成两问同线程和确认/用户编辑简介', async () => {
    sourceId = await create('AI 森林合成来源树 A'); await add('合成材料方向', 'major'); await add('合成研发目标', 'career'); await page.locator('#paths').click(); await page.locator('#saveCurrentPath').click(); await page.locator('#save').click(); await hub();
    otherId = await create('AI 森林合成独立树 B'); await add('独立 B 节点'); await hub();
    await page.evaluate(async ({ sourceId, otherId }) => {
      const { TreeLibrary } = await import('/journey/forest.js'), { GraphStore } = await import('/journey/store.js'), { AIStore } = await import('/journey/ai-store.js'), { captureTurnBinding } = await import('/journey/ai-context.js');
      const library = new TreeLibrary(localStorage), storage = library.scopedStorage(sourceId), graphStore = new GraphStore(storage), now = new Date().toISOString();
      graphStore.commit([{ op: 'upsert_source', source: { id: 'synthetic_source_a', title: '合成资料来源 A（非真实官方事实）', checkedAt: now, excerpt: '浏览器验收合成资料。', trustLevel: 'user_provided' } }]); graphStore.save();
      const graph = graphStore.graph, path = graph.savedPaths[0], target = graph.edges.find(e => e.id === path.edgeIds.at(-1)).to, ai = new AIStore(localStorage);
      const first = ai.createTurn(captureTurnBinding(graph, { question: '合成来源问题 A1', focusNodeIds: [target], scope: 'path', focusedPathEdgeIds: path.edgeIds, contextKey: 'synthetic-prior-model-authorization\nsource-A' }));
      ai.updateTurn(first.turnId, { status: 'completed', answer: '合成答复 A1，仅验证复制与引用。', model: 'synthetic-seed-no-model', citations: [{ sourceId: 'synthetic_source_a', title: '合成资料来源 A' }] }, graph.graphId);
      const second = ai.createTurn(captureTurnBinding(graph, { question: '合成来源问题 A2', focusNodeIds: [target], scope: 'path', focusedPathEdgeIds: path.edgeIds, threadId: first.threadId, contextKey: 'synthetic-prior-model-authorization\nsource-A' }));
      ai.updateTurn(second.turnId, { status: 'completed', answer: '合成答复 A2，不代表真实模型结论。', model: 'synthetic-seed-no-model', citations: [{ sourceId: 'synthetic_source_a', title: '合成资料来源 A' }] }, graph.graphId);
      const ids = [first.turnId, second.turnId], draft = { savedPathId: path.id, title: '合成已确认路线简介', currentState: '正在探索，未声称取得任何资格。', destination: '计划核实研发准备事项', motivation: ['本人尚待确认'], requiredPreparation: [{ item: '核实准备事项', evidenceStatus: 'needs_verification', supportingTurnIds: ids }], risksAndUnknowns: ['实际要求未知'], nextActions: ['核实资料'], sourceTurnIds: ids, graphRevision: graph.revision, status: 'draft' };
      ai.setDraft(graph, path.id, draft, { model: 'synthetic-seed-no-model', inputTurnIds: ids }); ai.confirmDraft(graph, path.id, draft); ai.editNarrative(graph, path.id, { ...draft, title: '合成用户独立编辑版', destination: '本人自己的合成取舍', status: 'confirmed' });
      storage.setItem('shiyu-zuxia.workspace.v1', JSON.stringify({ version: 1, profile: { schemaVersion: 1, source: 'legacy-career', authorizedAt: now, authorizedFields: ['major'], major: '合成材料专业' }, useProfile: true, documents: [{ id: 'synthetic_doc_a', title: '合成上传资料', kind: 'text', text: '合成资料仅供浏览器验收。', locator: '合成第1段', createdAt: now, shareWithAI: true }], useDocuments: true, researchEnabled: false, liveSearch: false, research: null, view: 'all' }));
      const other = new GraphStore(library.scopedStorage(otherId)).graph, b = ai.createTurn(captureTurnBinding(other, { question: '独立树 B 不可串线问题', scope: 'tree', focusNodeIds: [other.rootNodeId], contextKey: 'synthetic-B' })); ai.updateTurn(b.turnId, { status: 'completed', answer: '独立 B 合成答复', model: 'synthetic-seed-no-model' }, other.graphId);
    }, { sourceId, otherId });
    await page.reload(); await page.locator('#savedTrees').waitFor(); sourceBefore = await bundle(sourceId); otherBefore = await bundle(otherId);
    assert.equal(sourceBefore.ai.turns.length, 2); assert.equal(new Set(sourceBefore.ai.turns.map(t => t.threadId)).size, 1); assert.equal(sourceBefore.ai.narratives.length, 1); assert.equal(sourceBefore.narrativeStatus, 'confirmed'); assert.equal(sourceBefore.workspace.useProfile, true); assert.equal(sourceBefore.workspace.useDocuments, true); assert.equal(otherBefore.ai.turns.length, 1);
  });
  await check('真实复制入口重映射问答/线程/请求/简介及所有溯源，授权清空且简介stale', async () => {
    const ids = new Set((await trees()).map(t => t.id)); await page.locator(`[data-act="duplicate"][data-id="${sourceId}"]`).click(); copyId = (await poll(async () => (await trees()).find(t => !ids.has(t.id)), 'copy appears')).id;
    copyData = await bundle(copyId); assertRemapped(sourceBefore, copyData, copyId); await unchanged(); return { copiedGraphId: copyId, qaCount: copyData.ai.turns.length, narrativeVariants: ['draft', 'confirmed', 'userEdited'], authorizationCleared: true };
  });
  await check('复制树历史和用户简介真实可见，stale提示及历史依据跳转可用', async () => {
    await open(copyId); await page.locator('#chatTab').click(); assert.match(await page.locator('#chatMessages').innerText(), /合成来源问题 A1/); assert.doesNotMatch(await page.locator('#chatMessages').innerText(), /独立树 B/);
    await page.locator('#paths').click(); await page.locator('.path-narrative-link').click(); await page.locator('.ai-stale').waitFor(); assert.match(await page.locator('.ai-narrative-confirmed').innerText(), /合成用户独立编辑版/);
    await page.locator('[data-source-turn]').first().click(); await page.locator('#aiHistoryDrawer').waitFor({ state: 'visible' }); assert.match(await page.locator('#aiHistoryItems').innerText(), /合成来源问题 A/); await screenshot('copied-ai-history'); await hub(); await unchanged();
  });
  await check('真实导出下载完整备份只含来源树AI，保留确认和编辑版本', async () => {
    const pending = page.waitForEvent('download'); await page.locator(`[data-act="export"][data-id="${sourceId}"]`).click(); const download = await pending; const file = path.join(OUT, 'synthetic-tree-ai-backup.json'); await download.saveAs(file); archiveText = await readFile(file, 'utf8'); const archive = JSON.parse(archiveText);
    assert.equal(archive.treeArchiveVersion, 1); assert.equal(archive.document.graph.graphId, sourceId); assert.deepEqual(archive.ai, sourceBefore.ai); assert.equal(archive.ai.narratives.length, 1); assert.doesNotMatch(archiveText, /独立树 B|独立 B 合成答复/); assert(archive.ai.turns.every(t => t.graphId === sourceId)); assert.equal(archive.workspace.useProfile, true); await unchanged();
  });
  await check('真实导入入口创建独立新树，所有AI引用再重映射且原树/另一树不变', async () => {
    const ids = new Set((await trees()).map(t => t.id)); await page.locator('#importTreeInput').setInputFiles({ name: 'synthetic-tree-ai-backup.json', mimeType: 'application/json', buffer: Buffer.from(archiveText) }); importedId = (await poll(async () => (await trees()).find(t => !ids.has(t.id)), 'import appears')).id;
    const imported = await bundle(importedId); assertRemapped(sourceBefore, imported, importedId);
    assert(imported.ai.turns.every(t => !copyData.ai.turns.some(c => c.turnId === t.turnId || c.threadId === t.threadId || c.clientRequestId === t.clientRequestId))); assert.notEqual(imported.ai.narratives[0].narrativeId, copyData.ai.narratives[0].narrativeId); await unchanged();
    await page.reload(); await page.locator('#savedTrees').waitFor(); assertRemapped(sourceBefore, await bundle(importedId), importedId);
  });
  await check('取消删除保留副本AI；确认删除只清该树问答和所有简介变体', async () => {
    const before = await bundle(copyId), importedBefore = await bundle(importedId), count = (await trees()).length;
    await page.locator(`[data-act="delete"][data-id="${copyId}"]`).click(); await page.locator('#confirmDialog button[value="cancel"]').click(); assert.equal((await trees()).length, count); assert.deepEqual(await bundle(copyId), before);
    await page.locator(`[data-act="delete"][data-id="${copyId}"]`).click(); await confirm(); assert.equal((await trees()).length, count - 1); assert(!(await trees()).some(t => t.id === copyId));
    const deleted = await bundle(copyId); assert.equal(deleted.document, null); assert.equal(deleted.workspace, null); assert.deepEqual(deleted.ai, { schemaVersion: 1, turns: [], narratives: [] }); assert.deepEqual(await bundle(importedId), importedBefore); await unchanged();
  });
  await check('导入树刷新后仍显示用户简介与stale，回来源树全部AI保持原样', async () => {
    await open(importedId); await page.locator('#paths').click(); await page.locator('.path-narrative-link').click(); await page.locator('.ai-stale').waitFor(); assert.match(await page.locator('.ai-narrative-confirmed').innerText(), /合成用户独立编辑版/); await page.locator('.ai-stale').evaluate(el => el.scrollIntoView({ block: 'start' })); await screenshot('imported-narrative-stale'); await hub(); await unchanged();
    await open(sourceId); await page.locator('#chatTab').click(); assert.match(await page.locator('#chatMessages').innerText(), /合成来源问题 A1/); assert.doesNotMatch(await page.locator('#chatMessages').innerText(), /独立树 B/); await hub(); await unchanged();
  });
  await check('全程未发送任何模型请求、无页面异常，合成数据仅在独立context', async () => { assert.deepEqual(result.modelRequests, []); assert.deepEqual(result.pageErrors, []); await screenshot('forest-ai-final'); return { modelCalls: 0, sourceTreesRetained: 2, copiedTreeDeleted: true, importedTreeRetained: true }; });
  await rm(path.join(OUT, 'failure.png'), { force: true });
} catch (error) { console.error(error.stack); if (!result.checks.some(c => !c.passed)) result.checks.push({ name: 'browser setup', passed: false, error: error.stack }); await page?.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {}); process.exitCode = 1; }
finally { result.passed = result.checks.filter(c => c.passed).length; result.failed = result.checks.filter(c => !c.passed).length; await writeFile(path.join(OUT, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ passed: result.passed, failed: result.failed, modelRequests: result.modelRequests.length })); await browser?.close(); }
