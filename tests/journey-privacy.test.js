import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, applyOperations, validateGraph, visibleGraph } from '../journey/graph.js';
import { projectAIContext, publicGraph, filterGraphView, prepareImport } from '../journey/privacy.js';

function fixture() {
  let graph = createGraph();
  graph = applyOperations(graph, [
    { op: 'add_node', tempId: 'career', node: { title: '博士科研', kind: 'career' } },
    { op: 'add_node', tempId: 'music', node: { title: '喜欢音乐', kind: 'passion' } },
    { op: 'add_node', tempId: 'private', node: { title: '私密家庭信息', kind: 'lifestyle', private: true } },
    { op: 'add_edge', fromId: graph.rootNodeId, toId: 'career' },
    { op: 'add_edge', fromId: graph.rootNodeId, toId: 'music' },
    { op: 'add_edge', fromId: 'music', toId: 'career', relation: 'supports' },
  ]);
  return graph;
}
test('AI projection excludes private content, attributes and all independent data compartments', () => {
  let graph = fixture();
  graph = applyOperations(graph, [{ op: 'upsert_source', source: { id: 'private_source', title: '私密资料', checkedAt: new Date().toISOString(), trustLevel: 'user_provided', excerpt: '不应外传的文件片段' } }, { op: 'add_task', task: { title: '不应外传的任务' } }, { op: 'add_reflection', reflection: { text: '不应外传的反思', private: true } }]);
  graph.nodes[0].attributes = { secret: '不要传的任意属性' };
  const publicNode = graph.nodes.find(n => n.title === '博士科研');
  const outgoing = projectAIContext(graph, [publicNode.id], 'tree');
  const encoded = JSON.stringify(outgoing);
  assert(!encoded.includes('私密家庭信息')); assert(!encoded.includes('不要传'));
  assert(!encoded.includes('不应外传'));
  assert(!('sources' in outgoing)); assert(!('tasks' in outgoing)); assert(!('reflections' in outgoing));
  validateGraph(outgoing);
});
test('private titles mentioned indirectly in public notes and personal assessments do not leak', () => {
  let graph = fixture();
  graph = applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '英语', detail: '需要兼顾私密家庭信息', evidenceNote: '本人证明', assessment: 'evidenced' }, { kind: 'experience', label: '项目经历', detail: '准备公开作品', evidenceNote: '本人证据原文', assessment: 'evidenced' }] }]);
  graph.nodes.forEach(n => { n.shareAllowed = true; });
  const outgoing = projectAIContext(graph, [graph.nodes[1].id], 'tree');
  assert(!JSON.stringify(outgoing).includes('私密家庭信息'));
  const exported = publicGraph(graph);
  assert(!JSON.stringify(exported).includes('私密家庭信息'));
  assert(!JSON.stringify(exported).includes('本人证据原文'));
  assert.equal(exported.edges[0].requirements.length, 1);
  assert.equal(exported.edges[0].requirements[0].assessment, 'unknown');
});
test('node-only projection neutralizes the unauthorized root and strips project title', () => {
  const graph = fixture(); graph.title = '私人标题'; graph.nodes[0].title = '私人的根节点内容';
  const outgoing = projectAIContext(graph, [graph.nodes[1].id], 'node');
  assert(!JSON.stringify(outgoing).includes('私人的根节点内容')); assert(!JSON.stringify(outgoing).includes('私人标题'));
});
test('root, graph title and saved route names cannot indirectly disclose a private node', () => {
  let graph = fixture();
  graph = applyOperations(graph, [{ op: 'rename_graph', title: '私密家庭信息的图' }, { op: 'update_node', nodeId: graph.rootNodeId, patch: { title: '私密家庭信息里的此刻' } }, { op: 'save_path', title: '私密家庭信息之后的计划', edgeIds: [graph.edges[0].id] }]);
  graph.savedPaths[0].note = '私密家庭信息的备注';
  graph.nodes.forEach(n => { n.shareAllowed = true; });
  const outgoing = projectAIContext(graph, [graph.rootNodeId], 'tree');
  assert(!JSON.stringify(outgoing).includes('私密家庭信息'));
  const exported = publicGraph(graph);
  assert(!JSON.stringify(exported).includes('私密家庭信息'));
  assert(exported.nodes.every(n => !graph.nodes.some(old => old.id === n.id)));
});
test('sharing is empty by default and private remains excluded despite shareAllowed', () => {
  const graph = fixture();
  assert.equal(publicGraph(graph).nodes.length, 1);
  for (const n of graph.nodes) n.shareAllowed = true;
  const exported = publicGraph(graph);
  assert(exported.nodes.some(n => n.title === '喜欢音乐'));
  assert(!JSON.stringify(exported).includes('私密家庭信息'));
  assert(!('tasks' in exported)); assert(!('reflections' in exported)); assert.notEqual(exported.graphId, graph.graphId);
});
test('view filters are read-only and retain cross-domain relationships in the original graph', () => {
  const graph = fixture(), original = JSON.stringify(graph), visible = visibleGraph(graph);
  assert(!filterGraphView(graph, visible, 'career').nodes.some(n => n.kind === 'passion'));
  assert(!filterGraphView(graph, visible, 'values').nodes.some(n => n.kind === 'career'));
  assert.equal(JSON.stringify(graph), original);
  assert.equal(filterGraphView(graph, visible, 'all').edges.length, graph.edges.length);
});
test('import requires a valid graph and defaults shared content back to private', () => {
  const graph = fixture(); graph.nodes[1].shareAllowed = true;
  const result = prepareImport(graph);
  assert(result.nodes.every(n => n.shareAllowed === false)); assert.equal(graph.nodes[1].shareAllowed, true);
  assert.throws(() => prepareImport({ ...graph, nodes: [] }));
});
test('importing a personal source preserves its text and resets unsupported claimed proof', () => {
  let graph = fixture();
  graph = applyOperations(graph, [{ op: 'upsert_source', source: { id: 'personal', title: '本人提供的项目证明', checkedAt: new Date().toISOString(), trustLevel: 'user_provided', excerpt: '实际项目原文' } }, { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'experience', label: '项目经历', assessment: 'evidenced', sourceIds: ['personal'] }, { kind: 'skill', label: 'Python', assessment: 'evidenced', evidenceNote: '本人记录的作品链接' }] }]);
  const imported = prepareImport(graph);
  validateGraph(imported);
  assert.equal(imported.edges[0].requirements[0].assessment, 'unknown');
  assert.equal(imported.edges[0].requirements[1].assessment, 'evidenced');
  assert.equal(imported.sources[0].excerpt, '实际项目原文'); assert.equal(imported.sources[0].trustLevel, 'unverified');
  assert.equal(graph.edges[0].requirements[0].assessment, 'evidenced');
});
test('AI projection drops unconsented personal source text without leaving invalid proof claims', () => {
  let graph = fixture();
  graph = applyOperations(graph, [{ op: 'upsert_source', source: { id: 'personal_upload', title: '本人上传资料', checkedAt: new Date().toISOString(), trustLevel: 'user_provided', excerpt: '只在已授权资料使用时可发送的本人原文' } }, { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'experience', label: '项目经历', assessment: 'evidenced', sourceIds: ['personal_upload'] }] }]);
  const outgoing = projectAIContext(graph, [graph.nodes[1].id], 'path');
  validateGraph(outgoing);
  assert(!JSON.stringify(outgoing).includes('本人原文')); assert(!('sources' in outgoing));
  assert.equal(outgoing.edges[0].requirements[0].assessment, 'unknown');
  assert.equal(graph.edges[0].requirements[0].assessment, 'evidenced');
});
