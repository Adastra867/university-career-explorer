import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, applyOperations, validateGraph } from '../journey/graph.js';
import { captureTurnBinding, projectChatRequest, authorizedThreadHistory } from '../journey/ai-context.js';

function fixture() {
  let g = createGraph();
  g = applyOperations(g, [{ op: 'add_node', tempId: 'a', node: { title: '材料专业', kind: 'major' } }, { op: 'add_node', tempId: 'b', node: { title: '跨学科路线', kind: 'milestone' } }, { op: 'add_node', tempId: 'c', node: { title: '研发目标', kind: 'career' } }, { op: 'add_edge', fromId: g.rootNodeId, toId: 'a' }, { op: 'add_edge', fromId: g.rootNodeId, toId: 'b' }, { op: 'add_edge', fromId: 'a', toId: 'c' }, { op: 'add_edge', fromId: 'b', toId: 'c' }]);
  return g;
}
test('ask binding is a detached snapshot and explicit merged paths do not disclose another branch', () => {
  const g = fixture(), target = g.nodes.find(n => n.title === '研发目标'), a = g.nodes.find(n => n.title === '材料专业');
  const selected = [g.edges.find(e => e.to === a.id).id, g.edges.find(e => e.from === a.id).id];
  const binding = captureTurnBinding(g, { question: '如何准备？', focusNodeIds: [target.id], focusedPathEdgeIds: selected });
  const projected = projectChatRequest(g, [target.id], 'path', selected);
  validateGraph(projected);
  assert(!JSON.stringify(projected).includes('跨学科路线'));
  g.nodes.find(n => n.id === target.id).title = '后来修改的名字'; selected.pop();
  assert(binding.pathSnapshotLabel.includes('研发目标')); assert.equal(binding.focusedPathEdgeIds.length, 2);
  assert.equal(binding.focusNodeIds[0], target.id);
});
test('multi-node and global questions have one binding with explicit scope and root fallback', () => {
  const g = fixture();
  const multi = captureTurnBinding(g, { question: '比较两条路', focusNodeIds: g.nodes.slice(1, 3).map(n => n.id), scope: 'selection' });
  assert.equal(multi.scope, 'multi_node'); assert.equal(multi.focusNodeIds.length, 2);
  const global = captureTurnBinding(g, { question: '整树建议', scope: 'tree' });
  assert.equal(global.scope, 'graph'); assert.deepEqual(global.focusNodeIds, [g.rootNodeId]);
});
test('thread replay requires the current consent and authorized nodes, preventing revoked uploads from riding along', () => {
  const g = fixture(), target = g.nodes[1];
  const turns = [{ question: '许可当前问题', answer: '当前答案', status: 'completed', contextKey: 'allowed\nold', focusNodeIds: [target.id], pathNodeIds: [] }, { question: '已撤销资料问题', answer: '不得重放原文', status: 'completed', contextKey: 'revoked\nold', focusNodeIds: [target.id], pathNodeIds: [] }, { question: '另一节点问题', status: 'completed', contextKey: 'allowed\nold', focusNodeIds: [g.nodes[2].id] }];
  const result = authorizedThreadHistory({ threadTurns: () => turns }, g, 'thread', projectChatRequest(g, [target.id], 'node'), 'allowed\n');
  assert.deepEqual(result.map(m => m.content), ['许可当前问题', '当前答案']);
});
test('global answers cannot be replayed after a graph revision or authorization scope changes', () => {
  const g = fixture(), outgoing = projectChatRequest(g, [g.rootNodeId], 'tree');
  const turn = { question: '旧整树问题', answer: '旧整树包含后来设为私密的分支', status: 'completed', scope: 'graph', contextKey: 'allowed\nold-tree-revision', focusNodeIds: [g.rootNodeId], pathNodeIds: [] };
  const fake = { threadTurns: () => [turn] };
  assert.deepEqual(authorizedThreadHistory(fake, g, 'thread', outgoing, 'allowed\n', 'allowed\nnew-tree-revision'), []);
  assert.equal(authorizedThreadHistory(fake, g, 'thread', outgoing, 'allowed\n', turn.contextKey).length, 2);
  assert.deepEqual(authorizedThreadHistory(fake, g, 'thread', projectChatRequest(g, [g.rootNodeId], 'node'), 'allowed\n', 'allowed\nnode-scope'), []);
});
