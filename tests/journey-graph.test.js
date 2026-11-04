import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, validateGraph, applyOperations, validateProposal, pathsTo, visibleGraph, NodeKinds, RequirementKinds, Relations } from '../journey/graph.js';

const add = (tempId, title, kind = 'career', extra = {}) => ({ op: 'add_node', tempId, node: { title, kind, ...extra } });
const link = (fromId, toId, relation = 'possible_path') => ({ op: 'add_edge', fromId, toId, relation });
const find = (graph, title) => graph.nodes.find(node => node.title === title);

function diamond() {
  const initial = createGraph();
  const graph = applyOperations(initial, [
    add('major', '材料科学与工程', 'major'), add('study', '继续深造', 'education'), add('work', '直接就业', 'milestone'), add('target', '新能源材料研发'),
    link(initial.rootNodeId, 'major'), link('major', 'study'), link('major', 'work'), link('study', 'target'), link('work', 'target'),
  ]);
  return { graph, initial, major: find(graph, '材料科学与工程'), study: find(graph, '继续深造'), work: find(graph, '直接就业'), target: find(graph, '新能源材料研发') };
}

test('new graph is versioned and contains one independently identified self root', () => {
  const graph = createGraph();
  assert.equal(validateGraph(graph), graph);
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.revision, 0);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].id, graph.rootNodeId);
  assert.equal(graph.nodes[0].title, '我 · 此刻');
  assert.notEqual(createGraph().graphId, graph.graphId);
  assert.ok(NodeKinds.includes('major') && RequirementKinds.includes('certificate') && Relations.includes('possible_path'));
  assert.throws(() => createGraph({ title: '' }));
});

test('multi-node commands commit once, allow forward temp references and keep existing layout stable', () => {
  const graph = createGraph();
  const before = JSON.stringify(graph);
  const updated = applyOperations(graph, [link('major', 'career'), add('career', '材料测试工程师'), link(graph.rootNodeId, 'major'), add('major', '材料科学与工程', 'major')]);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(updated.revision, 1);
  assert.deepEqual(updated.nodes[0].position, graph.nodes[0].position);
  assert.equal(find(updated, '材料科学与工程').position.x, graph.nodes[0].position.x + 300);
  assert.equal(find(updated, '材料测试工程师').position.x, graph.nodes[0].position.x + 600);
  assert.equal(updated.edges[0].from, find(updated, '材料科学与工程').id);
  assert.equal(updated.edges[0].to, find(updated, '材料测试工程师').id);
  const preserved = applyOperations(updated, [{ op: 'rename_graph', title: '我的路线' }]);
  assert.deepEqual(preserved.nodes, updated.nodes);
  assert.deepEqual(preserved.edges, updated.edges);
});

test('failed transaction cannot leave a half-created branch or mutate its input', () => {
  const graph = createGraph();
  const before = JSON.stringify(graph);
  assert.throws(() => applyOperations(graph, [add('new', '应当回滚'), link('new', 'someone-elses-node')]), /不属于当前图/);
  assert.equal(JSON.stringify(graph), before);
  assert.throws(() => applyOperations(graph, [add('same', 'A'), add('same', 'B')]), /tempId/);
  assert.throws(() => applyOperations(graph, [add(graph.rootNodeId, '冲突')]), /tempId/);
  assert.throws(() => applyOperations(graph, [{ op: 'delete_node', nodeId: graph.rootNodeId }]), /根节点/);
  assert.equal(JSON.stringify(graph), before);
});

test('optimistic revision rejects stale mutations and stale AI proposals', () => {
  const { graph } = diamond();
  for (const call of [() => applyOperations(graph, [{ op: 'rename_graph', title: '冲突' }], 0), () => validateProposal(graph, [], 0)]) {
    assert.throws(call, error => error.code === 'REVISION_CONFLICT');
  }
});

test('advancement cycles are rejected while typed associative cycles are allowed', () => {
  const { graph, target, major } = diamond();
  const before = JSON.stringify(graph);
  assert.throws(() => applyOperations(graph, [link(target.id, major.id)]), /有向环/);
  assert.throws(() => applyOperations(graph, [link(target.id, target.id, 'requires')]), /有向环/);
  const related = applyOperations(graph, [link(target.id, major.id, 'supports'), link(major.id, target.id, 'related_to'), link(target.id, target.id, 'conflicts_with')]);
  assert.equal(validateGraph(related), related);
  assert.equal(JSON.stringify(graph), before);
  assert.throws(() => applyOperations(graph, [link(graph.edges[0].from, graph.edges[0].to)]), /已存在/);
});

test('edge conditions are normalized, persist stable IDs, and cannot claim evidence without sources', () => {
  const { graph } = diamond();
  const annotated = applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[1].id, requirements: [
    { kind: 'skill', label: '英语', detail: '目标项目要求仍需核对', necessity: 'recommended' },
    { kind: 'experience', label: '科研经历', knowledgeStatus: 'user_asserted' },
    { kind: 'time', label: '时间成本', durationMonths: { min: 12, max: 24 } },
  ] }]);
  const requirements = annotated.edges[1].requirements;
  assert.equal(requirements.length, 3);
  assert.equal(requirements[0].knowledgeStatus, 'user_asserted');
  assert.equal(requirements[1].necessity, 'unknown');
  assert.equal(new Set(requirements.map(item => item.id)).size, 3);
  assert.deepEqual(validateGraph(JSON.parse(JSON.stringify(annotated))), annotated);
  assert.throws(() => applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'certificate', label: '伪证书门槛', knowledgeStatus: 'verified' }] }]), /核验证据/);
  assert.throws(() => applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'time', label: '倒置', durationMonths: { min: 24, max: 12 } }] }]), /范围倒置/);
});

test('node editing, drag coordinates and privacy are real graph state', () => {
  const { graph, major } = diamond();
  const updated = applyOperations(graph, [
    { op: 'update_node', nodeId: major.id, patch: { title: '材料工程', description: '自主规划', kind: 'major', private: true, phase: 'planned' } },
    { op: 'move_node', nodeId: major.id, position: { x: 900, y: -120 } },
  ]);
  assert.equal(find(updated, '材料工程').id, major.id);
  assert.equal(find(updated, '材料工程').private, true);
  assert.deepEqual(find(updated, '材料工程').position, { x: 900, y: -120 });
  assert.throws(() => applyOperations(graph, [{ op: 'update_node', nodeId: major.id, patch: { id: 'forged' } }]), /不支持的字段/);
  assert.throws(() => applyOperations(graph, [{ op: 'move_node', nodeId: major.id, position: { x: Infinity, y: 0 } }]), /坐标无效/);
});

test('deleting a shared parent preserves children and the other complete saved path', () => {
  const { graph, study, target } = diamond();
  const routes = pathsTo(graph, target.id);
  assert.equal(routes.length, 2);
  const saved = applyOperations(graph, routes.map((route, index) => ({ op: 'save_path', title: `方案 ${index + 1}`, edgeIds: route.edgeIds })));
  const deleted = applyOperations(saved, [{ op: 'delete_node', nodeId: study.id }]);
  assert.ok(deleted.nodes.some(node => node.id === target.id));
  assert.equal(deleted.savedPaths.length, 1);
  assert.equal(pathsTo(deleted, target.id).length, 1);
  assert.equal(deleted.edges.some(edge => edge.from === study.id || edge.to === study.id), false);
  assert.equal(saved.savedPaths.length, 2);
});

test('deleting an edge cleans saved paths and disconnected descendants remain editable', () => {
  const { graph, major, target } = diamond();
  const saved = applyOperations(graph, [{ op: 'save_path', title: '我的方案', edgeIds: pathsTo(graph, target.id)[0].edgeIds }]);
  const removed = applyOperations(saved, [{ op: 'delete_edge', edgeId: graph.edges[0].id }]);
  assert.equal(removed.savedPaths.length, 0);
  assert.equal(visibleGraph(removed).nodes.length, graph.nodes.length);
  assert.ok(visibleGraph(removed).nodes.some(node => node.id === major.id));
  assert.throws(() => applyOperations(graph, [{ op: 'save_path', title: '断裂路径', edgeIds: [graph.edges[0].id, graph.edges[3].id] }]), /不连续/);
  const cleared = applyOperations(saved, [{ op: 'delete_path', pathId: saved.savedPaths[0].id }]);
  assert.equal(cleared.savedPaths.length, 0);
});

test('collapse respects multiple parents and removes only collapsed outgoing branches', () => {
  const { graph, major, study, work, target } = diamond();
  const one = visibleGraph(graph, [study.id]);
  assert.ok(one.nodes.some(node => node.id === target.id));
  assert.ok(one.edges.some(edge => edge.from === work.id && edge.to === target.id));
  assert.equal(one.edges.some(edge => edge.from === study.id), false);
  const both = visibleGraph(graph, [study.id, work.id]);
  assert.equal(both.nodes.some(node => node.id === target.id), false);
  assert.equal(visibleGraph(graph, [major.id]).nodes.length, 2);
  assert.equal(visibleGraph(graph, [graph.rootNodeId]).nodes.length, 1);
});

test('root-to-target paths are continuous, bounded, independent and loop safe', () => {
  const { graph, major, target } = diamond();
  const withLoop = applyOperations(graph, [link(target.id, major.id, 'related_to')]);
  assert.equal(pathsTo(withLoop, target.id).length, 2);
  assert.equal(pathsTo(graph, target.id, { maxPaths: 1 }).length, 1);
  assert.equal(pathsTo(graph, target.id, { maxDepth: 3 }).length, 0);
  assert.deepEqual(pathsTo(graph, graph.rootNodeId), [{ nodeIds: [graph.rootNodeId], edgeIds: [] }]);
  assert.deepEqual(pathsTo(graph, 'unknown'), []);
  const route = pathsTo(graph, target.id)[0];
  route.edgeIds.forEach((edgeId, index) => {
    const edge = graph.edges.find(item => item.id === edgeId);
    assert.equal(edge.from, route.nodeIds[index]);
    assert.equal(edge.to, route.nodeIds[index + 1]);
  });
});

test('AI proposal is preview only and adopts explicit AI/unverified provenance on confirmation', () => {
  const { graph, major } = diamond();
  const before = JSON.stringify(graph);
  const operations = [add('cross', '跨学科转型', 'other'), link(major.id, 'cross'), { op: 'update_node', nodeId: major.id, patch: { description: '建议结合兴趣进一步探索' } }];
  const proposal = validateProposal(graph, operations, graph.revision);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(operations[0].node.knowledgeStatus, undefined);
  const accepted = applyOperations(graph, proposal, graph.revision, { origin: 'ai' });
  assert.equal(find(accepted, '跨学科转型').origin, 'ai');
  assert.equal(find(accepted, '跨学科转型').knowledgeStatus, 'unverified');
  assert.equal(accepted.edges.at(-1).origin, 'ai');
  assert.equal(accepted.revision, graph.revision + 1);
});

test('AI rejects destructive operations, spoofed evidence, unknown fields, IDs and private data access', () => {
  const { graph, major } = diamond();
  const privateGraph = applyOperations(graph, [{ op: 'update_node', nodeId: major.id, patch: { private: true } }]);
  const cases = [
    [{ op: 'delete_node', nodeId: major.id }],
    [add('a', '虚构来源', 'career', { origin: 'verified_source' })],
    [add('a', '虚构核验', 'career', { knowledgeStatus: 'verified', sourceIds: ['forged'] })],
    [add('a', '未知字段', 'career', { password: 'wrong' })],
    [{ op: 'update_node', nodeId: major.id, patch: { private: false } }],
    [{ op: 'update_node', nodeId: 'another-user-node', patch: { title: '越权' } }],
    [link(graph.rootNodeId, 'another-user-node')],
    [add('same', 'A'), add('same', 'B')],
    [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '错误', knowledgeStatus: 'verified' }] }],
  ];
  for (const operations of cases) assert.throws(() => validateProposal(graph, operations), `must reject ${JSON.stringify(operations)}`);
  for (const operations of [
    [{ op: 'update_node', nodeId: major.id, patch: { title: '私密' } }],
    [add('a', '新节点'), link(major.id, 'a')],
    [{ op: 'annotate_edge', edgeId: privateGraph.edges[0].id, requirements: [] }],
  ]) assert.throws(() => validateProposal(privateGraph, operations), /私密/);
});

test('AI restrictions also hold at transaction commit when a caller skips proposal validation', () => {
  const { graph, major } = diamond();
  const privateGraph = applyOperations(graph, [{ op: 'update_node', nodeId: major.id, patch: { private: true } }]);
  for (const operations of [
    [{ op: 'delete_node', nodeId: major.id }],
    [{ op: 'update_node', nodeId: major.id, patch: { title: '不可访问' } }],
    [add('hidden', '偷偷新增', 'career', { private: true })],
    [add('proof', '伪造证据', 'career', { knowledgeStatus: 'verified', sourceIds: ['fake'] })],
  ]) assert.throws(() => applyOperations(privateGraph, operations, privateGraph.revision, { origin: 'ai' }));
  assert.throws(() => validateProposal(graph, [add('malformed', '来源必须是数组', 'career', { sourceIds: {} })]), /数组/);
});

test('path enumeration prunes a detached DAG with exponentially many local combinations', () => {
  const initial = createGraph();
  const operations = [];
  for (let level = 0; level < 25; level++) {
    for (let side = 0; side < 2; side++) {
      operations.push(add(`d${level}_${side}`, `独立 ${level} / ${side}`));
      if (level > 0) for (let previous = 0; previous < 2; previous++) operations.push(link(`d${level - 1}_${previous}`, `d${level}_${side}`));
    }
  }
  const graph = applyOperations(initial, operations);
  assert.deepEqual(pathsTo(graph, find(graph, '独立 24 / 0').id), []);
  // Even malformed externally supplied loops must never trap path traversal.
  graph.edges.push({ ...graph.edges[0], id: 'loop', from: find(graph, '独立 24 / 0').id, to: graph.rootNodeId });
  assert.deepEqual(pathsTo(graph, graph.rootNodeId), [{ nodeIds: [graph.rootNodeId], edgeIds: [] }]);
});

test('strict schema enforces size limits, unique IDs and evidence statuses', () => {
  const graph = createGraph();
  assert.throws(() => applyOperations(graph, [add('long', 'x'.repeat(121))]), /120/);
  assert.throws(() => applyOperations(graph, [add('long', '标题', 'career', { description: 'x'.repeat(2001) })]), /2000/);
  assert.throws(() => validateProposal(graph, Array.from({ length: 13 }, (_, index) => add(`n${index}`, `节点 ${index}`))), /12个节点/);
  assert.throws(() => validateProposal(graph, Array.from({ length: 37 }, () => ({ op: 'update_node', nodeId: graph.rootNodeId, patch: { title: '我' } }))), /36/);
  const corrupted = structuredClone(graph);
  corrupted.nodes.push(structuredClone(corrupted.nodes[0]));
  assert.throws(() => validateGraph(corrupted), /ID 重复/);
  const future = { ...graph, schemaVersion: 999 };
  assert.throws(() => validateGraph(future), /版本/);
  assert.throws(() => validateGraph({ ...graph, malicious: true }), /不支持的字段/);
  const noEvidence = structuredClone(graph);
  noEvidence.nodes[0].knowledgeStatus = 'verified';
  assert.throws(() => validateGraph(noEvidence), /核验证据/);
});

test('300-node graph validates and adding a 301st node fails atomically', () => {
  const graph = createGraph();
  const operations = [];
  for (let index = 0; index < 299; index++) {
    operations.push(add(`n${index}`, `第 ${index + 1} 步`, 'milestone'));
    operations.push(link(index === 0 ? graph.rootNodeId : `n${index - 1}`, `n${index}`));
  }
  const full = applyOperations(graph, operations);
  assert.equal(full.nodes.length, 300);
  assert.equal(validateGraph(full), full);
  assert.equal(pathsTo(full, full.nodes.at(-1).id, { maxDepth: 300 }).length, 1);
  const before = JSON.stringify(full);
  assert.throws(() => applyOperations(full, [add('overflow', '第301节点')]), /300/);
  assert.equal(JSON.stringify(full), before);
});

const officialSource = (id = 'source_official') => ({ id, title: '官方培养计划', url: 'https://example.edu/program', publisher: '示例高校', checkedAt: '2026-10-13T00:00:00.000Z', trustLevel: 'official', contentHash: 'official-document-content-hash', excerpt: '项目官方说明摘录', region: '中国', language: 'zh-CN', locator: '入学要求', expiresAt: '2027-10-13' });

test('P1 sources are explicit versioned graph data with safe URLs and strict citation references', () => {
  const { graph } = diamond();
  const legacy = structuredClone(graph);
  legacy.nodes[0].sourceIds = ['legacy-external-id'];
  assert.equal(validateGraph(legacy), legacy);
  const source = officialSource();
  const sourced = applyOperations(graph, [{ op: 'upsert_source', source }, { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'education', label: '项目学历要求', knowledgeStatus: 'verified', sourceIds: [source.id] }] }]);
  assert.equal(sourced.sources.length, 1);
  assert.equal(sourced.edges[0].requirements[0].knowledgeStatus, 'verified');
  const changed = applyOperations(sourced, [{ op: 'upsert_source', source: { ...source, excerpt: '更新后的官方说明' } }]);
  assert.equal(changed.sources.length, 1);
  assert.equal(changed.sources[0].excerpt, '更新后的官方说明');
  assert.throws(() => applyOperations(sourced, [{ op: 'update_node', nodeId: sourced.rootNodeId, patch: { sourceIds: ['forged-source'] } }]), /不存在的来源/);
  assert.throws(() => applyOperations(graph, [{ op: 'upsert_source', source: { ...source, url: 'javascript:alert(1)' } }]), /HTTP/);
  assert.throws(() => applyOperations(graph, [{ op: 'upsert_source', source: { ...source, checkedAt: 'yesterday' } }]), /ISO/);
  assert.throws(() => applyOperations(graph, [{ op: 'upsert_source', source: { ...source, trustLevel: 'user_provided', url: '' } }, { op: 'update_node', nodeId: graph.rootNodeId, patch: { knowledgeStatus: 'verified', sourceIds: [source.id] } }]), /官方资料/);
});

test('P1 task CRUD has explicit preparation status and never changes actual node achievement', () => {
  const { graph, target } = diamond();
  const annotated = applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '英语阅读', assessment: 'missing' }] }]);
  const requirement = annotated.edges[0].requirements[0];
  const planned = applyOperations(annotated, [{ op: 'add_task', task: { title: '整理英语练习记录', description: '三个月内准备', edgeId: annotated.edges[0].id, requirementId: requirement.id, dueDate: '2027-01-13' } }]);
  const task = planned.tasks[0];
  assert.equal(task.status, 'todo');
  assert.equal(task.horizon, 'near');
  const completed = applyOperations(planned, [{ op: 'update_task', taskId: task.id, patch: { status: 'done', horizon: 'mid', dueDate: null } }]);
  assert.equal(completed.tasks[0].status, 'done');
  assert.equal(completed.tasks[0].dueDate, undefined);
  assert.equal(completed.nodes.find(node => node.id === target.id).phase, target.phase);
  assert.equal(completed.edges[0].requirements[0].assessment, 'missing');
  assert.equal(applyOperations(completed, [{ op: 'delete_task', taskId: task.id }]).tasks.length, 0);
  assert.throws(() => applyOperations(graph, [{ op: 'add_task', task: { title: '错误状态', status: 'achieved' } }]), /status/);
  assert.throws(() => applyOperations(graph, [{ op: 'add_task', task: { title: '错误日期', dueDate: '2026-02-31' } }]), /有效/);
  assert.throws(() => applyOperations(graph, [{ op: 'add_task', task: { title: '外部任务', edgeId: 'another-graph-edge' } }]), /不存在的边/);
  assert.throws(() => applyOperations(annotated, [{ op: 'add_task', task: { title: '条件不匹配', edgeId: annotated.edges[1].id, requirementId: requirement.id } }]), /不属于关联边/);
});

test('P1 removing conditions, edges and sources detaches references without silently deleting task text', () => {
  const { graph } = diamond();
  const source = officialSource();
  const annotated = applyOperations(graph, [{ op: 'upsert_source', source }, { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '文档证明', assessment: 'unknown', sourceIds: [source.id], knowledgeStatus: 'verified' }] }]);
  const requirement = annotated.edges[0].requirements[0];
  const planned = applyOperations(annotated, [{ op: 'add_task', task: { title: '保留我的准备计划', edgeId: annotated.edges[0].id, requirementId: requirement.id, sourceIds: [source.id] } }]);
  const noSource = applyOperations(planned, [{ op: 'delete_source', sourceId: source.id }]);
  assert.deepEqual(noSource.tasks[0].sourceIds, []);
  assert.equal(noSource.edges[0].requirements[0].knowledgeStatus, 'unverified');
  assert.equal(noSource.edges[0].requirements[0].assessment, 'unknown');
  const noRequirement = applyOperations(noSource, [{ op: 'annotate_edge', edgeId: noSource.edges[0].id, requirements: [] }]);
  assert.equal(noRequirement.tasks[0].requirementId, undefined);
  assert.equal(noRequirement.tasks[0].edgeId, graph.edges[0].id);
  const noEdge = applyOperations(noRequirement, [{ op: 'delete_edge', edgeId: graph.edges[0].id }]);
  assert.equal(noEdge.tasks[0].edgeId, undefined);
  assert.equal(noEdge.tasks[0].title, '保留我的准备计划');
  assert.equal(validateGraph(noEdge), noEdge);
});

test('P1 assessment is explicit user evidence and AI cannot create facts or sources', () => {
  const { graph } = diamond();
  const source = officialSource();
  const sourced = applyOperations(graph, [{ op: 'upsert_source', source }]);
  const evidence = { kind: 'experience', label: '我的科研记录', assessment: 'evidenced', evidenceNote: '本人提供项目报告作为记录' };
  const annotated = applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [evidence] }]);
  assert.equal(annotated.edges[0].requirements[0].assessment, 'evidenced');
  assert.throws(() => applyOperations(graph, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ ...evidence, evidenceNote: '' }] }]), /实际说明/);
  assert.throws(() => applyOperations(sourced, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ ...evidence, evidenceNote: '', sourceIds: [source.id] }] }]), /官方要求不能证明/);
  const ownSource = { ...source, id: 'my-project-report', trustLevel: 'user_provided', url: '', excerpt: '本人上传的项目结题报告片段' };
  const ownEvidence = applyOperations(sourced, [{ op: 'upsert_source', source: ownSource }, { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ ...evidence, evidenceNote: '', sourceIds: [ownSource.id] }] }]);
  assert.equal(ownEvidence.edges[0].requirements[0].assessment, 'evidenced');
  assert.equal(applyOperations(ownEvidence, [{ op: 'delete_source', sourceId: ownSource.id }]).edges[0].requirements[0].assessment, 'unknown');
  for (const operations of [
    [{ op: 'upsert_source', source }],
    [{ op: 'add_task', task: { title: '自动写任务' } }],
    [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [evidence] }],
    [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'skill', label: '猜测已具备', assessment: 'self_reported' }] }],
  ]) assert.throws(() => validateProposal(graph, operations));
  const proposal = validateProposal(sourced, [{ op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'education', label: '官方项目说明，仍待具体核对', sourceIds: [source.id], assessment: 'unknown' }] }]);
  const accepted = applyOperations(sourced, proposal, sourced.revision, { origin: 'ai' });
  assert.deepEqual(accepted.edges[0].requirements[0].sourceIds, [source.id]);
  assert.equal(accepted.edges[0].requirements[0].knowledgeStatus, 'unverified');
});

test('P2 private reflection CRUD and abandoned stages stay distinct from achieved life events', () => {
  const { graph, major } = diamond();
  const reflected = applyOperations(graph, [{ op: 'update_node', nodeId: major.id, patch: { phase: 'abandoned', shareAllowed: true } }, { op: 'add_reflection', reflection: { nodeId: major.id, text: '这是我自愿留下的想法' } }]);
  assert.equal(reflected.nodes.find(node => node.id === major.id).phase, 'abandoned');
  assert.equal(reflected.reflections[0].private, true);
  const revised = applyOperations(reflected, [{ op: 'update_reflection', reflectionId: reflected.reflections[0].id, patch: { text: '我的想法有所变化' } }]);
  const detached = applyOperations(revised, [{ op: 'delete_node', nodeId: major.id }]);
  assert.equal(detached.reflections[0].text, '我的想法有所变化');
  assert.equal(detached.reflections[0].nodeId, undefined);
  assert.equal(applyOperations(detached, [{ op: 'delete_reflection', reflectionId: detached.reflections[0].id }]).reflections.length, 0);
  assert.throws(() => validateProposal(graph, [{ op: 'add_reflection', reflection: { text: '自动推测人格' } }]));
  assert.equal(graph.nodes[0].shareAllowed, undefined);
});

test('P1 source trust withdrawal downgrades verified claims without losing IDs, annotations or task text', () => {
  const { graph, major } = diamond();
  const source = officialSource();
  const supported = applyOperations(graph, [
    { op: 'upsert_source', source },
    { op: 'update_node', nodeId: major.id, patch: { knowledgeStatus: 'verified', sourceIds: [source.id] } },
    { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [{ kind: 'education', label: '官方项目要求', detail: '保留本人补充的原始说明', necessity: 'required', knowledgeStatus: 'verified', sourceIds: [source.id] }] },
  ]);
  const requirement = supported.edges[0].requirements[0];
  const planned = applyOperations(supported, [{ op: 'add_task', task: { title: '重新核对官方项目要求', edgeId: supported.edges[0].id, requirementId: requirement.id, sourceIds: [source.id] } }]);
  for (const trustLevel of ['unverified', 'user_provided']) {
    const updated = applyOperations(planned, [{ op: 'upsert_source', source: { ...source, trustLevel, expiresAt: '2020-01-01' } }]);
    assert.equal(updated.nodes.find(node => node.id === major.id).knowledgeStatus, 'unverified');
    assert.equal(updated.edges[0].requirements[0].knowledgeStatus, 'unverified');
    assert.equal(updated.edges[0].requirements[0].id, requirement.id);
    assert.equal(updated.edges[0].requirements[0].detail, '保留本人补充的原始说明');
    assert.deepEqual(updated.edges[0].requirements[0].sourceIds, [source.id]);
    assert.deepEqual(updated.tasks, planned.tasks);
    assert.equal(updated.sources[0].id, source.id);
    assert.equal(validateGraph(updated), updated);
  }
  assert.equal(planned.edges[0].requirements[0].knowledgeStatus, 'verified');
});

test('P1 changed personal evidence clears unsupported assessment while preserving explicit user notes', () => {
  const { graph } = diamond();
  const source = { ...officialSource(), trustLevel: 'user_provided', url: '', excerpt: '本人上传的项目证明片段' };
  const supported = applyOperations(graph, [
    { op: 'upsert_source', source },
    { op: 'annotate_edge', edgeId: graph.edges[0].id, requirements: [
      { kind: 'experience', label: '来自文件的科研记录', assessment: 'evidenced', sourceIds: [source.id], detail: '此注释必须保留' },
      { kind: 'skill', label: '本人明确说明的经历', assessment: 'evidenced', evidenceNote: '本人已经提供课程作业记录', sourceIds: [source.id] },
    ] },
  ]);
  for (const replacement of [{ ...source, excerpt: '' }, { ...source, trustLevel: 'unverified' }, { ...source, trustLevel: 'official', url: 'https://example.edu/program' }]) {
    const updated = applyOperations(supported, [{ op: 'upsert_source', source: replacement }]);
    assert.equal(updated.edges[0].requirements[0].assessment, 'unknown');
    assert.equal(updated.edges[0].requirements[0].detail, '此注释必须保留');
    assert.equal(updated.edges[0].requirements[0].id, supported.edges[0].requirements[0].id);
    assert.equal(updated.edges[0].requirements[1].assessment, 'evidenced');
    assert.equal(updated.edges[0].requirements[1].evidenceNote, '本人已经提供课程作业记录');
    assert.equal(validateGraph(updated), updated);
  }
});
