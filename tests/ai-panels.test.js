import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, applyOperations, pathsTo } from '../journey/graph.js';
import { validateSuggestionSet, projectSpecificPath } from '../journey/ai-panels.js';

function suggestions() {
  return { id: 'set_1', graphId: 'graph_1', parentNodeId: 'parent_1', graphRevision: 3, model: 'controlled-test', token: 'signed-test-token', createdAt: new Date().toISOString(), options: ['研究体验', '学习编程', '行业访谈'].map((title, i) => ({ optionId: `option_${i}`, title, nodeKind: 'skill', rationale: '结合当前方向探索下一步', prerequisites: ['核实时间安排'], uncertainty: '需要验证个人偏好', knowledgeStatus: 'unverified' })) };
}
const binding = { graphId: 'graph_1', parentNodeId: 'parent_1', graphRevision: 3 };
test('suggestion cards accept exactly three distinct unverified options bound to one parent and revision', () => {
  const response = suggestions(); const result = validateSuggestionSet(response, binding);
  assert.deepEqual(result, response); result.options[0].title = '修改候选'; assert.notEqual(result.options[0].title, response.options[0].title);
  for (const patch of [{ graphId: 'other' }, { parentNodeId: 'other' }, { graphRevision: 4 }, { token: '' }, { options: response.options.slice(0, 2) }]) assert.throws(() => validateSuggestionSet({ ...response, ...patch }, binding));
});
test('malformed, duplicate and falsely verified suggestions never become selectable', () => {
  for (const mutate of [r => r.options[1].title = r.options[0].title, r => r.options[1].optionId = r.options[0].optionId, r => r.options[0].knowledgeStatus = 'verified', r => r.options[0].nodeKind = 'self', r => r.options[0].prerequisites = [4], r => r.options[0].title = ' ']) {
    const response = suggestions(); mutate(response); assert.throws(() => validateSuggestionSet(response, binding));
  }
});
test('route summaries project the chosen route and omit other parents, private data and DIY route notes', () => {
  let graph = createGraph();
  graph = applyOperations(graph, [
    { op: 'add_node', tempId: 'a', node: { title: '路线A', kind: 'major' } },
    { op: 'add_node', tempId: 'b', node: { title: '路线B', kind: 'major' } },
    { op: 'add_node', tempId: 'goal', node: { title: '共同目标', kind: 'career' } },
    { op: 'add_node', tempId: 'private', node: { title: '私人价值反思', kind: 'value', private: true } },
    { op: 'add_edge', fromId: graph.rootNodeId, toId: 'a' }, { op: 'add_edge', fromId: graph.rootNodeId, toId: 'b' },
    { op: 'add_edge', fromId: 'a', toId: 'goal' }, { op: 'add_edge', fromId: 'b', toId: 'goal' },
    { op: 'add_reflection', reflection: { text: '私密反思原文' } },
  ]);
  const a = graph.nodes.find(n => n.title === '路线A'), goal = graph.nodes.find(n => n.title === '共同目标');
  const route = pathsTo(graph, goal.id).find(p => p.nodeIds.includes(a.id));
  graph = applyOperations(graph, [{ op: 'save_path', title: '保存路线A', edgeIds: route.edgeIds }]); graph.savedPaths[0].note = 'DIY不会发送也不会覆盖';
  const before = JSON.stringify(graph), projected = projectSpecificPath(graph, route), encoded = JSON.stringify(projected);
  assert.deepEqual(projected.edges.map(e => e.id), route.edgeIds); assert.equal(projected.savedPaths[0].id, graph.savedPaths[0].id);
  for (const excluded of ['路线B', '私人价值反思', '私密反思原文', 'DIY不会发送也不会覆盖']) assert(!encoded.includes(excluded));
  assert.equal(JSON.stringify(graph), before);
});
test('private or disconnected route input is rejected before any model request', () => {
  let graph = createGraph(); graph = applyOperations(graph, [{ op: 'add_node', tempId: 'secret', node: { title: '家庭隐私', kind: 'value', private: true } }, { op: 'add_edge', fromId: graph.rootNodeId, toId: 'secret' }]);
  const privateNode = graph.nodes.find(n => n.private), route = pathsTo(graph, privateNode.id)[0];
  assert.throws(() => projectSpecificPath(graph, route)); assert.throws(() => projectSpecificPath(graph, { nodeIds: [graph.rootNodeId], edgeIds: ['missing'] }));
});
