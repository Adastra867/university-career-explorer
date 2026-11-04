import test from 'node:test';
import assert from 'node:assert/strict';
import { AIStore, AI_STORAGE_KEY, validateAIData } from '../journey/ai-store.js';
import { createGraph, applyOperations } from '../journey/graph.js';

class Storage {
  constructor() { this.values = new Map(); this.writes = []; this.failRead = false; this.failWrite = false; this.failRemove = false; }
  getItem(key) { if (this.failRead) throw Object.assign(new Error('存储访问被禁止'), { name: 'SecurityError' }); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite) throw Object.assign(new Error('空间不足'), { name: 'QuotaExceededError' }); this.values.set(key, value); this.writes.push({ key, value }); }
  removeItem(key) { if (this.failRemove) throw new Error('不能删除'); this.values.delete(key); }
}
let request = 0;
function fixture(storage = new Storage()) {
  const statuses = [];
  return { storage, statuses, store: new AIStore(storage, (state, message) => statuses.push({ state, message })) };
}
function tree() {
  const initial = createGraph();
  let graph = applyOperations(initial, [
    { op: 'add_node', tempId: 'major', node: { title: '材料工程', kind: 'major' } },
    { op: 'add_node', tempId: 'career', node: { title: '新能源研发', kind: 'career' } },
    { op: 'add_node', tempId: 'other', node: { title: '另一条路线', kind: 'career' } },
    { op: 'add_edge', fromId: initial.rootNodeId, toId: 'major' },
    { op: 'add_edge', fromId: 'major', toId: 'career' },
    { op: 'add_edge', fromId: initial.rootNodeId, toId: 'other' },
  ]);
  graph = applyOperations(graph, [{ op: 'save_path', title: '研发路线', edgeIds: graph.edges.slice(0, 2).map(edge => edge.id) }]);
  graph.savedPaths[0].note = '用户自己的DIY描述不可覆盖';
  return graph;
}
function binding(graph, extra = {}) {
  return { graphId: graph.graphId, rootNodeId: graph.rootNodeId, question: '这条路线应怎样准备？', clientRequestId: `request_${++request}`, scope: 'node', graphRevisionAtAsk: graph.revision, focusNodeIds: [graph.nodes[2].id], pathNodeIds: graph.nodes.slice(0, 3).map(node => node.id), focusedPathEdgeIds: graph.edges.slice(0, 2).map(edge => edge.id), pathSnapshotLabel: '我 · 此刻 → 材料工程 → 新能源研发', contextKey: 'authorized_signature\ncurrent_path', ...extra };
}
function answered(store, graph, extra = {}) {
  const turn = store.createTurn(binding(graph, extra));
  return store.updateTurn(turn.turnId, { status: 'completed', answer: '根据当前规划，先核对项目要求。', model: 'deepseek-flash' });
}
function summary(graph, turnIds, extra = {}) {
  return { savedPathId: graph.savedPaths[0].id, title: '我正在考虑的研发路线', currentState: '目前正在探索', destination: '计划尝试新能源研发', motivation: ['用户询问过准备事项'], requiredPreparation: [{ item: '核对项目要求', evidenceStatus: 'needs_verification', supportingTurnIds: turnIds }], risksAndUnknowns: ['具体要求尚待核实'], nextActions: ['查阅目标项目官方材料'], sourceTurnIds: turnIds, graphRevision: graph.revision, status: 'draft', ...extra };
}

test('a question is durably queued before any model request and failed persistence prevents sending', () => {
  const { store, storage, statuses } = fixture(); const graph = tree();
  let sent = false;
  const send = question => { const turn = store.createTurn(question); assert.equal(JSON.parse(storage.getItem(AI_STORAGE_KEY)).data.turns[0].question, question.question); sent = true; return turn; };
  const queued = send(binding(graph));
  assert.equal(sent, true); assert.equal(queued.status, 'queued');
  assert.equal(statuses.at(-1).state, 'saved');
  const before = storage.getItem(AI_STORAGE_KEY); const count = store.exportData().turns.length;
  storage.failWrite = true; sent = false;
  assert.throws(() => send(binding(graph)), error => error.code === 'AI_STORAGE_QUOTA');
  assert.equal(sent, false); assert.equal(storage.getItem(AI_STORAGE_KEY), before); assert.equal(store.exportData().turns.length, count);
});

test('focus is captured once and immutable while answers update the same turn', () => {
  const { store } = fixture(); const graph = tree(); const input = binding(graph);
  const turn = store.createTurn(input); const original = [...input.focusNodeIds];
  input.focusNodeIds[0] = graph.nodes[3].id; input.question = '后来编辑的输入';
  store.updateTurn(turn.turnId, { status: 'generating' });
  store.updateTurn(turn.turnId, { status: 'completed', answer: '这个答复属于原来的研发节点。' });
  assert.deepEqual(store.getTurn(turn.turnId).focusNodeIds, original);
  assert.equal(store.getTurn(turn.turnId).question, '这条路线应怎样准备？');
  assert.throws(() => store.updateTurn(turn.turnId, { focusNodeIds: [graph.nodes[3].id] }), /不支持/);
  assert.equal(store.history(graph, { nodeId: graph.nodes[3].id }).total, 0);
});

test('client request IDs are graph-scoped idempotent and cannot be reused for another question', () => {
  const { store, storage } = fixture(); const graph = tree(); const input = binding(graph);
  const first = store.createTurn(input); const count = storage.writes.length;
  assert.equal(store.createTurn(input).turnId, first.turnId); assert.equal(storage.writes.length, count);
  assert.throws(() => store.createTurn({ ...input, question: '不同的问题' }), error => error.code === 'AI_IDEMPOTENCY_CONFLICT');
  const other = tree(); assert.notEqual(store.createTurn(binding(other, { clientRequestId: input.clientRequestId })).turnId, first.turnId);
});

test('graph isolation, direct versus path links, and global root history do not duplicate original text', () => {
  const { store, storage } = fixture(); const graph = tree(); const other = tree();
  const direct = answered(store, graph, { question: '独特的问题只存一次' });
  const path = answered(store, graph, { scope: 'path', savedPathId: graph.savedPaths[0].id });
  answered(store, graph, { scope: 'graph', focusNodeIds: [], pathNodeIds: [], focusedPathEdgeIds: [], question: '全局问答' });
  const foreign = answered(store, other);
  assert.equal(store.history(graph).total, 3); assert.equal(store.history(other).total, 1);
  assert.equal(store.getTurn(foreign.turnId, graph.graphId), null);
  assert.throws(() => store.updateTurn(foreign.turnId, { status: 'completed' }, graph.graphId), /不属于/);
  assert.equal(store.history(graph, { nodeId: graph.nodes[2].id }).items.find(item => item.turn.turnId === direct.turnId).linkKind, 'direct');
  assert.equal(store.history(graph, { nodeId: graph.nodes[1].id }).items.find(item => item.turn.turnId === path.turnId).linkKind, 'path');
  assert.ok(store.history(graph, { nodeId: graph.rootNodeId }).items.some(item => item.linkKind === 'graph'));
  assert.equal(storage.getItem(AI_STORAGE_KEY).split('独特的问题只存一次').length - 1, 1);
});

test('multi-node history stores a single turn and reverse pagination has stable non-overlapping pages', () => {
  const { store } = fixture(); const graph = tree();
  const multi = answered(store, graph, { scope: 'multi_node', focusNodeIds: [graph.nodes[2].id, graph.nodes[3].id], pathNodeIds: [], focusedPathEdgeIds: [] });
  for (let index = 0; index < 6; index++) answered(store, graph, { question: `历史 ${index}` });
  assert.equal(store.history(graph, { nodeId: graph.nodes[3].id }).total, 1);
  assert.equal(store.history(graph, { nodeId: graph.nodes[2].id }).total, 7);
  const one = store.history(graph, { offset: 0, limit: 3 }); const two = store.history(graph, { offset: 3, limit: 3 });
  assert.equal(new Set([...one.items, ...two.items].map(item => item.turn.turnId)).size, 6);
  assert.equal(store.exportData().turns.filter(turn => turn.turnId === multi.turnId).length, 1);
});

test('node deletion archives history instead of erasing it and archived-only queries count exactly', () => {
  const { store } = fixture(); let graph = tree(); const turn = answered(store, graph);
  graph = applyOperations(graph, [{ op: 'delete_node', nodeId: graph.nodes[2].id }]);
  assert.equal(store.history(graph).total, 0);
  const archived = store.history(graph, { archivedOnly: true });
  assert.equal(archived.total, 1); assert.equal(archived.items[0].linkKind, 'archived'); assert.equal(archived.items[0].turn.turnId, turn.turnId);
  assert.equal(store.history(graph, { includeArchived: true }).total, 1);
});

test('reloading interrupted queued/generating turns retains questions and partial answers', () => {
  const { store, storage } = fixture(); const graph = tree();
  const queued = store.createTurn(binding(graph)); const generating = store.createTurn(binding(graph));
  store.updateTurn(generating.turnId, { status: 'generating', answer: '已经显示的部分回答' });
  const loaded = fixture(storage).store;
  for (const id of [queued.turnId, generating.turnId]) { assert.equal(loaded.getTurn(id).status, 'failed'); assert.equal(loaded.getTurn(id).errorCode, 'interrupted'); }
  assert.equal(loaded.getTurn(generating.turnId).answer, '已经显示的部分回答');
  assert.equal(JSON.parse(storage.getItem(AI_STORAGE_KEY)).data.turns[0].status, 'failed');
});

test('storage-event reload may observe another active page without declaring its request interrupted', () => {
  const { store, storage } = fixture(); const graph = tree();
  const observer = fixture(storage).store;
  const turn = store.createTurn(binding(graph)); const writes = storage.writes.length;
  assert.equal(observer.reload({ interruptPending: false }), true);
  assert.equal(observer.getTurn(turn.turnId).status, 'queued'); assert.equal(storage.writes.length, writes);
});

test('failure, cancellation, and unconfigured states retain the original question without fake answers', () => {
  const { store } = fixture(); const graph = tree();
  for (const status of ['failed', 'cancelled', 'unconfigured']) {
    const turn = store.createTurn(binding(graph));
    const finished = store.updateTurn(turn.turnId, { status, errorCode: status === 'failed' ? 'provider_timeout' : status });
    assert.equal(finished.question, turn.question); assert.equal(finished.answer, undefined); assert.ok(finished.completedAt);
    assert.throws(() => store.updateTurn(turn.turnId, { status: 'generating' }), /重新询问/);
  }
});

test('production citations persist safely and private profile or secret fields are rejected', () => {
  const { store } = fixture(); const graph = tree(); const turn = store.createTurn(binding(graph));
  const citations = [{ sourceId: 'official-source', title: '招生项目资料', url: 'https://example.edu/program', publisher: '高校', checkedAt: '2026-10-14T00:00:00.000Z', relevantExcerpt: '可追溯片段', publishedAt: '2026-01-01', trustLevel: 'official', locator: '第2页', stale: false }];
  assert.deepEqual(store.updateTurn(turn.turnId, { status: 'completed', answer: '请核对项目资料。', citations }).citations, citations);
  assert.throws(() => store.createTurn({ ...binding(graph), profile: { privateReport: '不应混写' } }), /不支持/);
  assert.throws(() => store.createTurn({ ...binding(graph), apiKey: 'do-not-save' }), /不支持/);
  const bad = store.createTurn(binding(graph));
  assert.throws(() => store.updateTurn(bad.turnId, { citations: [{ sourceId: 'x', title: '恶意链接', url: 'javascript:alert(1)' }] }), /HTTP/);
});

test('completed answers cannot be silently replaced and repeated completion is a no-op', () => {
  const { store, storage } = fixture(); const graph = tree(); const turn = answered(store, graph);
  const count = storage.writes.length;
  store.updateTurn(turn.turnId, { status: 'completed', answer: turn.answer }); assert.equal(storage.writes.length, count);
  assert.throws(() => store.updateTurn(turn.turnId, { status: 'completed', answer: '覆盖旧原文' }), /不可覆盖/);
});

test('draft, confirmed AI content, and user edits remain separate from DIY path notes', () => {
  const { store } = fixture(); const graph = tree(); const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  const draft = summary(graph, [turn.turnId]);
  assert.equal(store.setDraft(graph, pathId, draft, { model: 'deepseek-flash', inputTurnIds: [turn.turnId] }).status, 'draft');
  const confirmed = store.confirmDraft(graph, pathId, { ...draft, motivation: ['用户自行补充的考虑'] });
  assert.deepEqual(confirmed.confirmed.motivation, draft.motivation); assert.deepEqual(confirmed.userEdited.motivation, ['用户自行补充的考虑']);
  store.setDraft(graph, pathId, { ...draft, title: '新AI草稿' }, { inputTurnIds: [turn.turnId] });
  assert.equal(store.narrative(graph, pathId).draft.title, '新AI草稿');
  assert.deepEqual(store.narrative(graph, pathId).userEdited.motivation, ['用户自行补充的考虑']);
  assert.equal(graph.savedPaths[0].note, '用户自己的DIY描述不可覆盖');
  assert.equal(store.discardDraft(graph, pathId), true); assert.equal(store.narrative(graph, pathId).draft, null); assert.ok(store.narrative(graph, pathId).confirmed);
});

test('deleting even an uncited input turn removes all derived narrative variants and deleted text from the only key', () => {
  const { store, storage } = fixture(); const graph = tree();
  const cited = answered(store, graph); const hidden = answered(store, graph, { question: '独特隐私原文应彻底删除' }); const pathId = graph.savedPaths[0].id;
  const draft = summary(graph, [cited.turnId], { title: '派生了独特隐私原文应彻底删除' });
  store.setDraft(graph, pathId, draft, { inputTurnIds: [cited.turnId, hidden.turnId] });
  store.confirmDraft(graph, pathId, { ...draft, currentState: '用户编辑也含独特隐私原文应彻底删除' });
  store.setDraft(graph, pathId, summary(graph, [cited.turnId]), { inputTurnIds: [cited.turnId] });
  assert.equal(store.deleteTurn(hidden.turnId, graph.graphId), true);
  assert.equal(store.narrative(graph, pathId), null); assert.equal(store.getTurn(hidden.turnId), null);
  assert.equal(storage.getItem(AI_STORAGE_KEY).includes('独特隐私原文应彻底删除'), false);
  assert.deepEqual([...storage.values.keys()], [AI_STORAGE_KEY]);
});

test('new relevant questions and updated inputs mark summaries stale while unrelated branches do not', () => {
  const { store } = fixture(); const graph = tree(); const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] }); store.confirmDraft(graph, pathId);
  answered(store, graph, { focusNodeIds: [graph.nodes[3].id], pathNodeIds: [graph.rootNodeId, graph.nodes[3].id], focusedPathEdgeIds: [graph.edges[2].id] });
  assert.equal(store.narrative(graph, pathId).stale, false);
  store.createTurn(binding(graph)); assert.equal(store.narrative(graph, pathId).stale, true);
});

test('path/requirement/source changes mark summaries stale and old revision drafts cannot confirm', () => {
  const { store } = fixture(); let graph = tree(); const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] });
  graph = applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '英语阅读', detail: '新增证据，尚待核实' }] }]);
  assert.equal(store.narrative(graph, pathId).draftStatus, 'stale');
  assert.throws(() => store.confirmDraft(graph, pathId), error => error.code === 'AI_NARRATIVE_STALE');
  assert.throws(() => store.setDraft(graph, pathId, summary({ ...graph, revision: graph.revision - 1 }, [turn.turnId])), error => error.code === 'AI_NARRATIVE_STALE');
  store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] }); assert.equal(store.narrative(graph, pathId).draftStatus, 'draft');
});

test('manual edits to an outdated confirmed introduction remain outdated and keep new AI drafts', () => {
  const { store } = fixture(); let graph = tree(); const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  const old = summary(graph, [turn.turnId]); store.setDraft(graph, pathId, old, { inputTurnIds: [turn.turnId] }); store.confirmDraft(graph, pathId);
  graph = applyOperations(graph, [{ op: 'update_node', nodeId: graph.nodes[2].id, patch: { description: '目标发生变化' } }]);
  store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] });
  store.editNarrative(graph, pathId, { ...old, title: '用户修改后的旧介绍' });
  const record = store.narrative(graph, pathId);
  assert.equal(record.userEdited.title, '用户修改后的旧介绍'); assert.equal(record.userEditedStatus, 'stale'); assert.equal(record.draftStatus, 'draft');
});

test('narrative provenance rejects unknown and cross-graph input turns as one transaction', () => {
  const { store } = fixture(); const graph = tree(); const other = tree(); const turn = answered(store, graph); const foreign = answered(store, other); const pathId = graph.savedPaths[0].id;
  const before = store.exportData();
  for (const turnId of ['not-existing', foreign.turnId]) assert.throws(() => store.setDraft(graph, pathId, summary(graph, [turnId]), { inputTurnIds: [turnId] }));
  assert.throws(() => store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [] }), /未输入/);
  assert.deepEqual(store.exportData(), before);
});

test('quota and multi-page serial conflicts never partially replace histories or narratives', () => {
  const { store, storage } = fixture(); const graph = tree(); const turn = answered(store, graph); const other = fixture(storage).store;
  answered(store, graph); const saved = storage.getItem(AI_STORAGE_KEY); const previous = other.exportData();
  assert.throws(() => other.createTurn(binding(graph)), error => error.code === 'AI_STORAGE_CONFLICT');
  assert.equal(storage.getItem(AI_STORAGE_KEY), saved); assert.deepEqual(other.exportData(), previous);
  const before = store.exportData(); storage.failWrite = true;
  assert.throws(() => store.setDraft(graph, graph.savedPaths[0].id, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] }), error => error.code === 'AI_STORAGE_QUOTA');
  assert.deepEqual(store.exportData(), before); assert.equal(storage.getItem(AI_STORAGE_KEY), saved);
});

test('corrupt and inaccessible history preserves original bytes and blocks accidental replacement', () => {
  const storage = new Storage(); storage.setItem(AI_STORAGE_KEY, '{user-original-broken');
  const { store } = fixture(storage); assert.equal(store.blocked, true); assert.equal(storage.getItem(AI_STORAGE_KEY), '{user-original-broken');
  assert.throws(() => store.createTurn(binding(tree())), /冲突|无法读取/); assert.equal(storage.getItem(AI_STORAGE_KEY), '{user-original-broken');
  const locked = new Storage(); locked.failRead = true; const inaccessible = fixture(locked).store; assert.equal(inaccessible.blocked, true);
});

test('exports/imports preserve graph scope, root mapping, terminal answers and reset send authorization', () => {
  const source = fixture().store; const graph = tree(); const turn = answered(source, graph, { focusNodeIds: [graph.rootNodeId] }); const pathId = graph.savedPaths[0].id;
  source.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] }); source.confirmDraft(graph, pathId);
  const raw = source.exportArchive(graph.graphId); const target = tree(); target.savedPaths[0].id = pathId;
  const { store, storage } = fixture(); const count = storage.writes.length;
  const preview = store.validateImport(raw, target, { sourceGraphId: graph.graphId, sourceRootId: graph.rootNodeId }); assert.equal(storage.writes.length, count);
  assert.equal(preview.turns[0].graphId, target.graphId); assert.deepEqual(preview.turns[0].focusNodeIds, [target.rootNodeId]);
  assert.equal(store.importData(raw, target, { sourceGraphId: graph.graphId, sourceRootId: graph.rootNodeId }), true);
  const imported = store.getTurn(turn.turnId, target.graphId); assert.equal(imported.answer, turn.answer); assert.equal(imported.contextKey, '');
  assert.equal(store.history(graph).total, 0); assert.equal(store.narrative(target, pathId).status, 'stale');
  assert.equal(store.importData(raw, target, { sourceGraphId: graph.graphId, sourceRootId: graph.rootNodeId }), true);
  assert.equal(store.exportData(target.graphId).turns.length, 1);
});

test('import conflicts are detected by preflight before any write and cannot overwrite another graph original', () => {
  const { store, storage } = fixture(); const graph = tree(); const turn = answered(store, graph); const raw = store.exportData(graph.graphId);
  raw.turns[0].answer = '备份中同ID不同原文'; const before = storage.getItem(AI_STORAGE_KEY);
  assert.throws(() => store.validateImport(raw, graph), error => error.code === 'AI_IMPORT_CONFLICT');
  assert.throws(() => store.importData(raw, graph), error => error.code === 'AI_IMPORT_CONFLICT');
  assert.equal(storage.getItem(AI_STORAGE_KEY), before); assert.equal(store.getTurn(turn.turnId).answer, turn.answer);
});

test('schema validation rejects unknown fields, duplicate IDs, fake references, oversized text and restored grants', () => {
  const { store } = fixture(); const graph = tree(); answered(store, graph); const raw = store.exportData();
  assert.equal(validateAIData(raw).turns.length, 1);
  for (const value of [
    { ...raw, schemaVersion: 9 }, { ...raw, consentGranted: true },
    { ...raw, turns: [...raw.turns, raw.turns[0]] },
    { ...raw, turns: [{ ...raw.turns[0], question: 'x'.repeat(12001) }] },
    { ...raw, turns: [{ ...raw.turns[0], apiKey: 'secret' }] },
  ]) assert.throws(() => validateAIData(value));
});

test('explicit history limits refuse new data rather than trimming the original 1000 turns', () => {
  const seed = fixture().store; const graph = tree(); const one = answered(seed, graph); const document = seed.exportData();
  document.turns = Array.from({ length: 1000 }, (_, index) => ({ ...one, turnId: `turn_limit_${index}`, clientRequestId: `limit_request_${index}` }));
  const { store, storage } = fixture();
  assert.equal(store.importData(document, graph), true);
  const before = storage.getItem(AI_STORAGE_KEY);
  assert.throws(() => store.createTurn(binding(graph)), error => error.code === 'AI_HISTORY_LIMIT');
  assert.equal(store.exportData().turns.length, 1000);
  assert.equal(store.exportData().turns[0].turnId, 'turn_limit_0');
  assert.equal(storage.getItem(AI_STORAGE_KEY), before);
});

test('deleting current graph AI data preserves other graph data and every legacy/graph key', () => {
  const { store, storage } = fixture(); const graph = tree(); const other = tree(); answered(store, graph); const foreign = answered(store, other);
  storage.setItem('shiyu-zuxia.graph.v1', 'original-graph'); storage.setItem('career_answers', 'original-assessment');
  assert.equal(store.deleteLocal(graph.graphId), true); assert.equal(store.history(graph).total, 0); assert.equal(store.getTurn(foreign.turnId).graphId, other.graphId);
  assert.equal(storage.getItem('shiyu-zuxia.graph.v1'), 'original-graph'); assert.equal(storage.getItem('career_answers'), 'original-assessment');
  assert.equal(store.deleteLocal(), true); assert.equal(storage.getItem(AI_STORAGE_KEY), null); assert.equal(storage.getItem('career_answers'), 'original-assessment');
});

test('thread continuation stays graph-scoped and returns chronological turns without rebinding earlier questions', () => {
  const { store } = fixture(); const graph = tree(); const first = answered(store, graph);
  const second = answered(store, graph, { threadId: first.threadId, question: '接着上一个问题', focusNodeIds: [graph.nodes[3].id] });
  answered(store, tree(), { threadId: first.threadId });
  const thread = store.threadTurns(graph, first.threadId);
  assert.equal(thread.length, 2); assert.deepEqual(new Set(thread.map(turn => turn.turnId)), new Set([first.turnId, second.turnId]));
  assert.deepEqual(store.getTurn(first.turnId).focusNodeIds, first.focusNodeIds);
});

test('evidence updates stale confirmed summaries without copying private graph text into history stamps', () => {
  const { store, storage } = fixture(); let graph = tree();
  const source = { id: 'evidence-update', title: '官方项目说明', url: 'https://example.edu/program', checkedAt: '2026-10-14T00:00:00.000Z', trustLevel: 'official', contentHash: 'document-hash', excerpt: '第一版官方片段' };
  graph = applyOperations(graph, [
    { op: 'upsert_source', source },
    { op: 'update_node', nodeId: graph.nodes[1].id, patch: { description: '不应在AI历史版本戳复制的私密图说明', sourceIds: [source.id] } },
  ]);
  const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  store.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] }); store.confirmDraft(graph, pathId);
  assert.equal(storage.getItem(AI_STORAGE_KEY).includes('不应在AI历史版本戳复制的私密图说明'), false);
  graph = applyOperations(graph, [{ op: 'upsert_source', source: { ...source, excerpt: '第二版说明发生变化', trustLevel: 'unverified' } }]);
  assert.equal(store.narrative(graph, pathId).confirmedStatus, 'stale');
});

test('30 narrative limit refuses overflow explicitly and keeps every earlier version and turn', () => {
  const { store, storage } = fixture();
  for (let index = 0; index < 30; index++) {
    const graph = tree(); const turn = answered(store, graph);
    store.setDraft(graph, graph.savedPaths[0].id, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] });
  }
  const overflow = tree(); const turn = answered(store, overflow); const before = storage.getItem(AI_STORAGE_KEY);
  assert.throws(() => store.setDraft(overflow, overflow.savedPaths[0].id, summary(overflow, [turn.turnId]), { inputTurnIds: [turn.turnId] }), error => error.code === 'AI_NARRATIVE_LIMIT');
  assert.equal(store.exportData().narratives.length, 30); assert.equal(store.exportData().turns.length, 31); assert.equal(storage.getItem(AI_STORAGE_KEY), before);
});

test('invalid provenance in imported narratives cannot leave half-imported turns on disk', () => {
  const source = fixture().store; const graph = tree(); const turn = answered(source, graph); const pathId = graph.savedPaths[0].id;
  source.setDraft(graph, pathId, summary(graph, [turn.turnId]), { inputTurnIds: [turn.turnId] });
  const raw = source.exportData(); raw.narratives[0].draft.inputTurnIds.push('unknown-input');
  const { store, storage } = fixture();
  assert.throws(() => store.importData(raw, graph)); assert.deepEqual(store.exportData(), { schemaVersion: 1, turns: [], narratives: [] }); assert.equal(storage.getItem(AI_STORAGE_KEY), null);
});

test('failed deletion and corruption after load preserve all current original text', () => {
  const { store, storage } = fixture(); const graph = tree(); const turn = answered(store, graph);
  const before = storage.getItem(AI_STORAGE_KEY); storage.failWrite = true;
  assert.throws(() => store.deleteTurn(turn.turnId)); assert.equal(store.getTurn(turn.turnId).answer, turn.answer); assert.equal(storage.getItem(AI_STORAGE_KEY), before);
  storage.failWrite = false; storage.setItem(AI_STORAGE_KEY, 'raw-corruption-preserved');
  assert.throws(() => store.createTurn(binding(graph))); assert.equal(store.blocked, true); assert.equal(store.getTurn(turn.turnId).answer, turn.answer); assert.equal(storage.getItem(AI_STORAGE_KEY), 'raw-corruption-preserved');
});

test('legacy migration saves the whole paired conversation atomically with explicit unknown node ownership', () => {
  const { store, storage } = fixture(); const graph = tree(); const old = [
    { role: 'user', content: ' 旧问题原文保留空格 ' }, { role: 'assistant', content: '旧模型原始答复', model: 'legacy-model' },
    { role: 'user', content: '失败的问题' }, { role: 'assistant', content: '旧错误原文', error: true },
    { role: 'user', content: '没有答复的问题' },
  ];
  const unchanged = structuredClone(old);
  assert.equal(store.migrateLegacyConversation(graph, old), true);
  assert.equal(storage.writes.length, 1); assert.deepEqual(old, unchanged);
  const turns = store.exportData(graph.graphId).turns;
  assert.equal(turns.length, 3);
  assert.equal(turns[0].question, old[0].content); assert.equal(turns[0].answer, '旧模型原始答复'); assert.equal(turns[0].status, 'completed');
  assert.equal(turns[1].status, 'failed'); assert.equal(turns[1].answer, '旧错误原文'); assert.equal(turns[2].status, 'failed'); assert.equal(turns[2].answer, undefined);
  for (const turn of turns) {
    assert.equal(turn.scope, 'graph'); assert.deepEqual(turn.focusNodeIds, [graph.rootNodeId]); assert.deepEqual(turn.pathNodeIds, []);
    assert.equal(turn.contextKey, 'legacy-import-no-model-consent'); assert.match(turn.pathSnapshotLabel, /原节点归属未知/);
  }
  assert.equal(store.history(graph, { nodeId: graph.nodes[2].id }).total, 0);
});

test('legacy migration quota or invalid final message never commits an earlier partial pair', () => {
  const { store, storage } = fixture(); const graph = tree(); answered(store, graph);
  const before = storage.getItem(AI_STORAGE_KEY); const memory = store.exportData();
  const old = [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }, { role: 'user', content: '第二问' }];
  storage.failWrite = true;
  assert.throws(() => store.migrateLegacyConversation(graph, old), error => error.code === 'AI_STORAGE_QUOTA');
  assert.equal(storage.getItem(AI_STORAGE_KEY), before); assert.deepEqual(store.exportData(), memory);
  storage.failWrite = false;
  assert.throws(() => store.migrateLegacyConversation(graph, [...old, { role: 'assistant', content: 'x'.repeat(60001) }]));
  assert.equal(storage.getItem(AI_STORAGE_KEY), before); assert.deepEqual(store.exportData(), memory);
});

test('legacy retries after reload and graph revision changes are idempotent without rewriting terminal text', () => {
  const { store, storage } = fixture(); let graph = tree();
  const old = [{ role: 'user', content: '先前的问题' }, { role: 'assistant', content: '先前完整回答' }];
  assert.equal(store.migrateLegacyConversation(graph, old), true);
  const turn = store.exportData(graph.graphId).turns[0]; const writes = storage.writes.length;
  graph = applyOperations(graph, [{ op: 'rename_graph', title: '修订后的人生树' }]);
  const loaded = fixture(storage).store;
  assert.equal(loaded.migrateLegacyConversation(graph, old), true);
  assert.equal(storage.writes.length, writes); assert.deepEqual(loaded.getTurn(turn.turnId), turn);
  assert.equal(loaded.exportData(graph.graphId).turns.length, 1);
});

test('legacy migration preserves originals when a same-request record has conflicting content', () => {
  const { store, storage } = fixture(); const graph = tree(); const old = [{ role: 'user', content: '原问题' }, { role: 'assistant', content: '原答复' }];
  store.migrateLegacyConversation(graph, old);
  const envelope = JSON.parse(storage.getItem(AI_STORAGE_KEY)); envelope.data.turns[0].answer = '同请求ID内的冲突文本';
  storage.setItem(AI_STORAGE_KEY, JSON.stringify(envelope)); const loaded = fixture(storage).store; const raw = storage.getItem(AI_STORAGE_KEY);
  assert.throws(() => loaded.migrateLegacyConversation(graph, old), error => error.code === 'AI_IMPORT_CONFLICT');
  assert.equal(storage.getItem(AI_STORAGE_KEY), raw); assert.equal(loaded.exportData().turns[0].answer, '同请求ID内的冲突文本');
});

test('a same-graph full backup with unchanged narrative is idempotent without overwriting send bindings or user edits', () => {
  const { store, storage } = fixture(); const graph = tree(); const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  const draft = summary(graph, [turn.turnId]);
  store.setDraft(graph, pathId, draft, { inputTurnIds: [turn.turnId], model: 'deepseek-flash' });
  store.confirmDraft(graph, pathId, { ...draft, title: '用户自己编辑的路线标题' });
  const exported = store.exportData(graph.graphId); const before = storage.getItem(AI_STORAGE_KEY); const writes = storage.writes.length;
  assert.doesNotThrow(() => store.validateImport(exported, graph));
  assert.equal(store.importData(exported, graph), true);
  assert.equal(storage.getItem(AI_STORAGE_KEY), before); assert.equal(storage.writes.length, writes);
  assert.equal(store.getTurn(turn.turnId).contextKey, turn.contextKey);
  assert.equal(store.narrative(graph, pathId).userEdited.title, '用户自己编辑的路线标题');
  for (const key of ['draft', 'confirmed', 'userEdited']) exported.narratives[0][key].pathStamp = `imported:imported:${exported.narratives[0][key].pathStamp}`;
  assert.equal(store.importData(exported, graph), true); assert.equal(storage.writes.length, writes);
  exported.narratives[0].confirmed.content.title = '真实正文发生改变';
  assert.throws(() => store.validateImport(exported, graph), error => error.code === 'AI_IMPORT_CONFLICT');
  assert.throws(() => store.importData(exported, graph), error => error.code === 'AI_IMPORT_CONFLICT');
  assert.equal(storage.getItem(AI_STORAGE_KEY), before);
});

test('evidence referenced only by narrative preparation still invalidates it when source metadata changes', () => {
  const { store } = fixture(); let graph = tree();
  const source = { id: 'narrative-only-evidence', title: '仅简介引用的官方资料', url: 'https://example.edu/narrative', checkedAt: '2026-10-14T00:00:00.000Z', trustLevel: 'official', contentHash: 'source-first-content', excerpt: '第一版资料' };
  graph = applyOperations(graph, [{ op: 'upsert_source', source }]);
  const turn = answered(store, graph); const pathId = graph.savedPaths[0].id;
  const draft = summary(graph, [turn.turnId], { requiredPreparation: [{ item: '核对项目官方说明', evidenceStatus: 'sourced_fact', supportingTurnIds: [turn.turnId], sourceIds: [source.id] }] });
  assert.equal(graph.nodes.some(node => node.sourceIds?.includes(source.id)), false);
  assert.equal(graph.edges.some(edge => edge.requirements.some(requirement => requirement.sourceIds?.includes(source.id))), false);
  store.setDraft(graph, pathId, draft, { inputTurnIds: [turn.turnId] }); store.confirmDraft(graph, pathId);
  assert.equal(store.narrative(graph, pathId).stale, false);
  graph = applyOperations(graph, [{ op: 'upsert_source', source: { ...source, excerpt: '第二版资料需重新核对', contentHash: 'source-second-content' } }]);
  assert.equal(store.narrative(graph, pathId).confirmedStatus, 'stale');
});
