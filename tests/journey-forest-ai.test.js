import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTreeAIData } from '../journey/forest-ai.js';
import { AIStore, validateAIData } from '../journey/ai-store.js';
import { createGraph, applyOperations, validateGraph } from '../journey/graph.js';

class Storage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function tree(title) {
  const initial = createGraph({ title });
  let graph = applyOperations(initial, [
    { op: 'add_node', tempId: 'goal', node: { kind: 'career', title: '研发方向' } },
    { op: 'add_edge', fromId: initial.rootNodeId, toId: 'goal' },
  ]);
  graph = applyOperations(graph, [{ op: 'save_path', title: '研发路线', edgeIds: [graph.edges[0].id] }]);
  return graph;
}
function newTreeFrom(graph, title, { newRoot = false } = {}) {
  const next = structuredClone(graph); next.graphId = `graph_${crypto.randomUUID()}`; next.title = title;
  if (newRoot) {
    const previous = next.rootNodeId; next.rootNodeId = `node_${crypto.randomUUID()}`;
    next.nodes.find(node => node.id === previous).id = next.rootNodeId;
    for (const edge of next.edges) { if (edge.from === previous) edge.from = next.rootNodeId; if (edge.to === previous) edge.to = next.rootNodeId; }
  }
  return validateGraph(next);
}
function turn(store, graph, question, { threadId, pending = false } = {}) {
  const queued = store.createTurn({
    graphId: graph.graphId, rootNodeId: graph.rootNodeId, clientRequestId: `request_${crypto.randomUUID()}`,
    question, scope: 'path', graphRevisionAtAsk: graph.revision, focusNodeIds: [graph.nodes.at(-1).id],
    pathNodeIds: graph.nodes.map(node => node.id), focusedPathEdgeIds: graph.edges.map(edge => edge.id), savedPathId: graph.savedPaths[0].id,
    pathSnapshotLabel: '起点 → 研发方向', contextKey: '用户当时的模型授权', ...(threadId ? { threadId } : {}),
  });
  if (pending) return queued;
  return store.updateTurn(queued.turnId, { status: 'completed', answer: `回答：${question}`, model: '测试模型', citations: [{ sourceId: 'official_source', title: '官方来源', url: 'https://example.com/requirements', checkedAt: '2026-10-14T00:00:00.000Z' }] }, graph.graphId);
}
function draft(graph, turnIds) {
  return { savedPathId: graph.savedPaths[0].id, title: '研发路线说明', currentState: '当前状态', destination: '研发方向',
    motivation: ['用户自己的想法'], requiredPreparation: [{ item: '核实官方要求', evidenceStatus: 'sourced_fact', supportingTurnIds: turnIds, sourceIds: ['official_source'] }],
    risksAndUnknowns: ['仍需核实'], nextActions: ['准备材料'], sourceTurnIds: turnIds, graphRevision: graph.revision, status: 'draft' };
}
function setup() {
  const store = new AIStore(new Storage()), graph = tree('来源树'), unrelated = tree('其他树');
  const first = turn(store, graph, '来源树第一问'), second = turn(store, graph, '来源树追问', { threadId: first.threadId });
  const other = turn(store, unrelated, '不应复制的另一棵树');
  const content = draft(graph, [first.turnId, second.turnId]);
  store.setDraft(graph, graph.savedPaths[0].id, content);
  store.confirmDraft(graph, graph.savedPaths[0].id, { ...content, currentState: '用户修改后的现状' });
  return { store, graph, unrelated, first, second, other };
}

test('clone selects only the requested tree and remaps global identities without mutating its source', () => {
  const { store, graph, first, second } = setup(), data = store.exportData(), before = JSON.stringify(data);
  const cloned = cloneTreeAIData(data, graph.graphId);
  assert.equal(JSON.stringify(data), before); assert.equal(cloned.turns.length, 2); assert.equal(cloned.narratives.length, 1);
  assert.ok(cloned.turns.every(item => item.graphId === graph.graphId && item.rootNodeId === graph.rootNodeId));
  assert.notEqual(cloned.turns[0].turnId, first.turnId); assert.notEqual(cloned.turns[1].turnId, second.turnId);
  assert.equal(cloned.turns[0].threadId, cloned.turns[1].threadId); assert.notEqual(cloned.turns[0].threadId, first.threadId);
  for (const item of cloned.turns) assert.equal(item.contextKey, '');
  assert.deepEqual(cloned.turns[0].pathNodeIds, first.pathNodeIds); assert.deepEqual(cloned.turns[0].focusedPathEdgeIds, first.focusedPathEdgeIds);
  assert.equal(cloned.turns[0].savedPathId, first.savedPathId); assert.deepEqual(cloned.turns[0].citations, first.citations);
  assert.notEqual(cloned.turns[0].clientRequestId, first.clientRequestId);
  assert.notEqual(cloned.narratives[0].narrativeId, data.narratives[0].narrativeId);
});

test('all draft, confirmed and user-edited narrative references resolve to the cloned turns', () => {
  const { store, graph, first, second } = setup(), data = store.exportData(graph.graphId), cloned = cloneTreeAIData(data, graph.graphId);
  const turnIds = new Set(cloned.turns.map(item => item.turnId));
  for (const key of ['draft', 'confirmed', 'userEdited']) {
    const version = cloned.narratives[0][key]; assert.ok(version);
    assert.ok(version.inputTurnIds.every(id => turnIds.has(id))); assert.ok(version.sourceTurnIds.every(id => turnIds.has(id)));
    assert.deepEqual(version.sourceTurnIds, version.content.sourceTurnIds);
    assert.deepEqual(version.content.requiredPreparation[0].supportingTurnIds, version.sourceTurnIds);
    assert.ok(version.turnStamps.every(stamp => turnIds.has(stamp.turnId)));
    assert.ok(version.inputTurnIds.every(id => ![first.turnId, second.turnId].includes(id)));
    assert.deepEqual(version.content.requiredPreparation[0].sourceIds, ['official_source']);
    assert.equal(version.content.savedPathId, graph.savedPaths[0].id);
  }
  assert.doesNotThrow(() => validateAIData(cloned));
});

test('real AIStore can import a copy alongside its source without global identity conflicts', () => {
  const { store, graph } = setup(), original = store.exportData(graph.graphId), target = newTreeFrom(graph, '独立副本');
  const cloned = cloneTreeAIData(store.exportData(), graph.graphId);
  assert.doesNotThrow(() => store.validateImport(cloned, target, { sourceGraphId: graph.graphId }));
  assert.equal(store.importData(cloned, target, { sourceGraphId: graph.graphId }), true);
  assert.deepEqual(store.exportData(graph.graphId), original);
  const imported = store.exportData(target.graphId); assert.equal(imported.turns.length, 2); assert.equal(imported.narratives.length, 1);
  assert.ok(imported.turns.every(item => item.graphId === target.graphId && item.rootNodeId === target.rootNodeId));
  assert.equal(store.narrative(target, target.savedPaths[0].id).status, 'stale');
});

test('the same backup can be independently imported twice with disjoint identities and intact source data', () => {
  const { store, graph, unrelated } = setup(), backup = JSON.stringify(store.exportData(graph.graphId)), original = store.exportData(graph.graphId), untouched = store.exportData(unrelated.graphId);
  const a = newTreeFrom(graph, '第一次导入'), b = newTreeFrom(graph, '第二次导入');
  const first = cloneTreeAIData(backup, graph.graphId), second = cloneTreeAIData(backup, graph.graphId);
  assert.equal(store.importData(first, a, { sourceGraphId: graph.graphId }), true);
  assert.equal(store.importData(second, b, { sourceGraphId: graph.graphId }), true);
  const all = store.exportData(); assert.equal(new Set(all.turns.map(item => item.turnId)).size, all.turns.length);
  assert.equal(new Set(all.narratives.map(item => item.narrativeId)).size, all.narratives.length);
  assert.deepEqual(store.exportData(graph.graphId), original); assert.deepEqual(store.exportData(unrelated.graphId), untouched);
  assert.equal(store.exportData(a.graphId).turns.length, 2); assert.equal(store.exportData(b.graphId).turns.length, 2);
});

test('deleting the new graph history cannot remove source or unrelated graph records', () => {
  const { store, graph, unrelated } = setup(), original = store.exportData(graph.graphId), untouched = store.exportData(unrelated.graphId), target = newTreeFrom(graph, '删除此副本');
  store.importData(cloneTreeAIData(original, graph.graphId), target, { sourceGraphId: graph.graphId });
  assert.equal(store.deleteLocal(target.graphId), true);
  assert.deepEqual(store.exportData(target.graphId), { schemaVersion: 1, turns: [], narratives: [] });
  assert.deepEqual(store.exportData(graph.graphId), original); assert.deepEqual(store.exportData(unrelated.graphId), untouched);
});

test('AIStore remaps a different target root while child, edge, path and source bindings remain historical', () => {
  const { store, graph } = setup(), target = newTreeFrom(graph, '新根的导入', { newRoot: true });
  store.importData(cloneTreeAIData(store.exportData(), graph.graphId), target, { sourceGraphId: graph.graphId, sourceRootId: graph.rootNodeId });
  const data = store.exportData(target.graphId);
  for (const item of data.turns) {
    assert.equal(item.rootNodeId, target.rootNodeId); assert.equal(item.pathNodeIds[0], target.rootNodeId);
    assert.equal(item.pathNodeIds[1], graph.nodes[1].id); assert.deepEqual(item.focusedPathEdgeIds, graph.edges.map(edge => edge.id));
    assert.equal(item.savedPathId, graph.savedPaths[0].id); assert.equal(item.citations[0].sourceId, 'official_source');
  }
  assert.equal(data.narratives[0].rootNodeId, target.rootNodeId);
});

test('pending imported requests become interrupted without resuming a model request or altering the original', () => {
  const { store, graph } = setup(), pending = turn(store, graph, '原树还在等待', { pending: true }), target = newTreeFrom(graph, '导入未完成请求');
  store.importData(cloneTreeAIData(store.exportData(), graph.graphId), target, { sourceGraphId: graph.graphId });
  const imported = store.exportData(target.graphId).turns.find(item => item.question === pending.question);
  assert.equal(imported.status, 'failed'); assert.equal(imported.errorCode, 'interrupted'); assert.equal(imported.contextKey, '');
  assert.equal(store.getTurn(pending.turnId, graph.graphId).status, 'queued');
});

test('validation precedes filtering and invalid provenance cannot produce a partial copy', () => {
  const { store, graph, unrelated } = setup(), data = store.exportData(), before = JSON.stringify(data);
  data.narratives[0].confirmed.inputTurnIds.push('missing-turn');
  assert.throws(() => cloneTreeAIData(data, unrelated.graphId));
  assert.equal(JSON.stringify(store.exportData()), before);
  assert.throws(() => cloneTreeAIData('{bad-json', graph.graphId));
  assert.throws(() => cloneTreeAIData(store.exportData(), ''));
  assert.deepEqual(cloneTreeAIData(store.exportData(), 'graph_not_present'), { schemaVersion: 1, turns: [], narratives: [] });
});
