import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGraph, applyOperations, validateGraph } from '../journey/graph.js';
import { computeRequirementGaps, comparePaths, makePlan, humanReadableReport } from '../journey/planning.js';
import { safeLegacyProfile, LegacyCareerAdapter } from '../journey/legacy-adapter.js';

const AT = '2026-10-13T08:00:00.000Z';
const find = (graph, title) => graph.nodes.find(node => node.title === title);
const add = (tempId, title, kind = 'career', extra = {}) => ({ op: 'add_node', tempId, node: { title, kind, ...extra } });
const edge = (fromId, toId, relation = 'possible_path') => ({ op: 'add_edge', fromId, toId, relation });
function fixture() {
  let graph = createGraph({ title: '合成测试人生树' });
  graph = applyOperations(graph, [
    add('major', '材料专业', 'major'), add('study', '继续深造', 'education'), add('work', '直接就业', 'milestone'), add('target', '研发目标'),
    add('freedom', '自由时间', 'value'), add('secret', '秘密家庭财务计划', 'lifestyle', { private: true }),
    edge(graph.rootNodeId, 'major'), edge('major', 'study'), edge('major', 'work'), edge('study', 'target'), edge('work', 'target'),
    edge('work', 'freedom', 'conflicts_with'), edge(graph.rootNodeId, 'secret'), edge('secret', 'target'),
  ]);
  const [common, study, work, studyTarget, workTarget, tradeoff, privateEdge, privateTarget] = graph.edges;
  graph = applyOperations(graph, [
    { op: 'upsert_source', source: { id: 'official', title: '合成大学官方要求样本', url: 'https://example.edu/requirements', publisher: '合成大学', checkedAt: AT, trustLevel: 'official', excerpt: '目标项目的公开准备要求。', contentHash: createHash('sha256').update('目标项目的公开准备要求。').digest('hex') } },
    { op: 'upsert_source', source: { id: 'personal', title: '用户项目材料样本', checkedAt: AT, trustLevel: 'user_provided', excerpt: '已提供可核对的项目作品记录。' } },
    { op: 'upsert_source', source: { id: 'hidden_source', title: '秘密家庭财务计划资料', checkedAt: AT, trustLevel: 'user_provided', excerpt: '仅用于私密路线的数字资产信息。' } },
    { op: 'annotate_edge', edgeId: common.id, requirements: [{ kind: 'skill', label: 'SQL', assessment: 'unknown' }, { kind: 'skill', label: '沟通能力', assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: study.id, requirements: [{ kind: 'education', label: '硕士学位', assessment: 'unknown', sourceIds: ['official'] }, { kind: 'time', label: '用户预估准备时间', durationMonths: { min: 12, max: 24 }, assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: work.id, requirements: [{ kind: 'cost', label: '生活成本', detail: '尚未提供数额', assessment: 'missing' }, { kind: 'skill', label: '项目实践', assessment: 'evidenced', evidenceNote: '已经附上真实的用户作品材料。', sourceIds: ['personal'] }] },
    { op: 'annotate_edge', edgeId: studyTarget.id, requirements: [{ kind: 'certificate', label: '英语证书', sourceIds: ['official'], knowledgeStatus: 'verified', assessment: 'unknown' }, { kind: 'skill', label: 'Python', detail: '项目实践', assessment: 'self_reported' }] },
    { op: 'annotate_edge', edgeId: workTarget.id, requirements: [{ kind: 'skill', label: 'Python', detail: '项目实践', assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: tradeoff.id, requirements: [{ kind: 'personal', label: '用户记录的时间取舍', detail: '需要自己决定工作和生活的安排。' }] },
    { op: 'annotate_edge', edgeId: privateEdge.id, requirements: [{ kind: 'cost', label: '秘密资产金额', detail: '不允许公开的原始说明', sourceIds: ['hidden_source'] }] },
    { op: 'save_path', title: '深造路线', edgeIds: [common.id, study.id, studyTarget.id] },
    { op: 'save_path', title: '就业路线', edgeIds: [common.id, work.id, workTarget.id] },
    { op: 'save_path', title: '隐藏路线标题', edgeIds: [privateEdge.id, privateTarget.id] },
  ]);
  return { graph, paths: graph.savedPaths.map(path => path.id), common, work, privateEdge };
}
function profile() {
  return safeLegacyProfile({ studentProfile: { major: '不应随公开报告披露的专业', education: 'undergraduate' }, experienceText: '我负责 SQL 项目并使用 Python 完成数据分析。', experienceAnalysis: { skills: ['SQL', 'Python'], tools: [] }, softSkills: { communication: 100 } }, ['skills', 'major', 'education'], { now: () => AT });
}

test('requirement gaps preserve four states and never infer certificates, degrees or score thresholds', () => {
  const { graph } = fixture();
  const before = JSON.stringify(graph);
  const gaps = computeRequirementGaps(graph, profile());
  assert.equal(gaps.find(item => item.label === 'SQL').status, 'self_reported');
  assert.equal(gaps.find(item => item.label === '沟通能力').status, 'unknown');
  assert.equal(gaps.find(item => item.label === '硕士学位').status, 'unknown');
  assert.equal(gaps.find(item => item.label === '英语证书').status, 'unknown', 'official requirements are not proof that the person holds a certificate');
  assert.equal(gaps.find(item => item.label === '项目实践').status, 'evidenced');
  assert.equal(gaps.find(item => item.label === '生活成本').status, 'missing');
  assert.ok(!gaps.some(item => item.label === '秘密资产金额'));
  assert.equal(JSON.stringify(graph), before);
});

test('unauthorized, revoked and score-only profiles cannot fill personal evidence gaps', () => {
  const { graph } = fixture();
  for (const imported of [null, { ...profile(), authorizedFields: ['major'] }, { ...profile(), revokedAt: AT }, { ...profile(), active: false }, { skills: profile().skills }]) {
    assert.equal(computeRequirementGaps(graph, imported).find(item => item.label === 'SQL').status, 'unknown');
  }
  const raw = { experienceText: '使用SQL完成项目。', experienceAnalysis: { skills: ['SQL'] } };
  const adapter = new LegacyCareerAdapter({ getItem(key) { return key === 'careerPredictor' ? JSON.stringify(raw) : null; } }, { now: () => AT });
  adapter.authorize(['skills']);
  assert.equal(computeRequirementGaps(graph, adapter.snapshot()).find(item => item.label === 'SQL').status, 'self_reported');
  adapter.revoke();
  assert.equal(computeRequirementGaps(graph, adapter.snapshot()).find(item => item.label === 'SQL').status, 'unknown');
});

test('explicit personal evidence notes and user-provided artifacts support their own conditions', () => {
  const { graph, common } = fixture();
  const updated = applyOperations(graph, [{ op: 'annotate_edge', edgeId: common.id, requirements: [
    { kind: 'skill', label: '作品', assessment: 'evidenced', sourceIds: ['personal'] },
    { kind: 'certificate', label: '用户明确证明的证书', assessment: 'evidenced', evidenceNote: '用户已附证书名称、持有人和有效期供人工核对。' },
  ] }]);
  const gaps = computeRequirementGaps(updated, null);
  assert.equal(gaps.find(item => item.label === '作品').status, 'evidenced');
  assert.equal(gaps.find(item => item.label === '用户明确证明的证书').status, 'evidenced');
  assert.equal(computeRequirementGaps(graph, null).find(item => item.label === 'SQL').status, 'unknown');
  assert.throws(() => applyOperations(graph, [{ op: 'annotate_edge', edgeId: common.id, requirements: [{ kind: 'certificate', label: '错误认定已获证书', assessment: 'evidenced', sourceIds: ['official'] }] }]), /官方要求不能证明/);
});

test('private personal evidence cannot indirectly disclose a public qualification status', () => {
  const { graph, common } = fixture();
  const changed = applyOperations(graph, [{ op: 'annotate_edge', edgeId: common.id, requirements: [{ kind: 'experience', label: '个人材料', assessment: 'evidenced', evidenceNote: '证明来自秘密家庭财务计划的资料。' }] }]);
  const gap = computeRequirementGaps(changed, null).find(item => item.label === '个人材料');
  assert.equal(gap.status, 'unknown');
  assert.deepEqual(gap.evidence, []);
  assert.doesNotMatch(JSON.stringify(gap), /秘密家庭财务计划/);
});

test('comparison uses two real saved edge chains and exposes common/different conditions, cost, time and value relations', () => {
  const { graph, paths } = fixture();
  const before = JSON.stringify(graph);
  const compared = comparePaths(graph, profile(), paths.slice(0, 2));
  assert.equal(compared.paths.length, 2);
  assert.ok(compared.common.requirements.some(item => item.label === 'SQL'));
  assert.ok(compared.common.requirements.some(item => item.label === 'Python'));
  assert.ok(compared.differences[0].uniqueRequirements.some(item => item.label === '硕士学位'));
  assert.ok(compared.differences[1].uniqueRequirements.some(item => item.label === '生活成本'));
  assert.deepEqual(compared.paths[0].time[0].durationMonths, { min: 12, max: 24 });
  assert.equal(compared.paths[1].costs[0].detail, '尚未提供数额');
  assert.ok(compared.paths[1].tradeoffs.some(item => item.relation === 'conflicts_with' && item.toTitle === '自由时间'));
  assert.equal(compared.paths[0].totalCost, undefined);
  assert.equal(compared.paths[0].totalMonths, undefined);
  assert.equal(compared.paths[0].successRate, undefined);
  assert.equal(JSON.stringify(graph), before);
});

test('comparison rejects duplicate, foreign, oversized and associative paths', () => {
  const { graph, paths } = fixture();
  for (const ids of [[], [paths[0]], [paths[0], paths[0]], [paths[0], 'foreign'], [...paths, 'fourth', 'fifth']]) assert.throws(() => comparePaths(graph, null, ids));
  const work = find(graph, '直接就业');
  const freedom = find(graph, '自由时间');
  const associative = graph.edges.find(edge => edge.from === work.id && edge.to === freedom.id);
  const changed = applyOperations(graph, [{ op: 'save_path', title: '仅价值关联', edgeIds: [associative.id] }]);
  assert.throws(() => comparePaths(changed, null, [paths[0], changed.savedPaths.at(-1).id]), /推进边链/);
  const corrupt = clone(graph);
  corrupt.savedPaths[0].edgeIds.reverse();
  assert.throws(() => comparePaths(corrupt, null, paths.slice(0, 2)), /不连续/);
});
const clone = value => structuredClone(value);

test('private routes and indirect private references are excluded from comparison', () => {
  const { graph, paths } = fixture();
  const changed = clone(graph);
  changed.savedPaths[0].note = '此路线与秘密家庭财务计划有关。';
  const result = comparePaths(changed, profile(), paths);
  assert.equal(result.paths.length, 2);
  assert.equal(result.omittedCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /秘密家庭财务计划|秘密资产金额|隐藏路线标题|不允许公开的原始说明/);
});

test('plan generation returns editable confirmation candidates accepted by actual add_task operations', () => {
  const { graph, paths } = fixture();
  const before = JSON.stringify(graph);
  const plan = makePlan(graph, profile(), paths.slice(0, 2));
  assert.equal(plan.requiresConfirmation, true);
  assert.ok(plan.near.length > 0 && plan.mid.length > 0 && plan.long.length > 0);
  const tasks = ['near', 'mid', 'long'].flatMap(horizon => plan[horizon].map(task => { assert.equal(task.horizon, horizon); assert.equal(task.status, 'todo'); assert.equal(task.dueDate, undefined); return task; }));
  assert.equal(JSON.stringify(graph), before);
  const committed = applyOperations(graph, tasks.map(task => ({ op: 'add_task', task })));
  assert.equal(committed.tasks.length, tasks.length);
  assert.equal(validateGraph(committed), committed);
  assert.doesNotMatch(JSON.stringify(plan), /秘密资产金额|秘密家庭财务计划|隐藏路线标题|successRate/);
});

test('human-readable report contains routes, evidence status, real recorded sources and only confirmed public tasks', () => {
  const { graph, paths, common, privateEdge } = fixture();
  const withTasks = applyOperations(graph, [
    { op: 'add_task', task: { title: '核对公开项目要求', description: '只对这条公开路线进行人工确认。', edgeId: common.id, horizon: 'near', sourceIds: ['official'] } },
    { op: 'add_task', task: { title: '不应公开的私密任务', edgeId: privateEdge.id, horizon: 'long', sourceIds: ['hidden_source'] } },
    { op: 'add_task', task: { title: '公共边上的间接私密任务', description: '涉及秘密家庭财务计划', edgeId: common.id } },
  ]);
  withTasks.savedPaths[0].note = '我的选择仍取决于秘密家庭财务计划。';
  const before = JSON.stringify(withTasks);
  const report = humanReadableReport(withTasks, profile(), paths);
  assert.equal(typeof report, 'string');
  assert.match(report, /主路线 1：深造路线/);
  assert.match(report, /备选路线 2：就业路线/);
  assert.match(report, /已有证据支持/);
  assert.match(report, /核对公开项目要求/);
  assert.match(report, /直接就业 ↔ 自由时间：存在张力／取舍/);
  assert.match(report, /https:\/\/example.edu\/requirements/);
  assert.match(report, /2026-10-13T08:00:00.000Z/);
  assert.doesNotMatch(report, /秘密家庭财务计划|秘密资产金额|隐藏路线标题|不应公开的私密任务|公共边上的间接私密任务|不应随公开报告披露的专业|数字资产信息/);
  assert.equal(JSON.stringify(withTasks), before);
});

test('report includes private data only through the explicit includePrivate option and handles no public saved route', () => {
  const { graph, paths } = fixture();
  assert.doesNotMatch(humanReadableReport(graph, null, [paths[2]]), /秘密家庭财务计划|隐藏路线标题|秘密资产金额/);
  assert.match(humanReadableReport(graph, null, [paths[2]], { includePrivate: true }), /秘密家庭财务计划/);
  assert.match(humanReadableReport(graph, null, []), /尚未选择可公开/);
});
