import { validateGraph } from './graph.js';

export const GapStatuses = Object.freeze({ evidenced: '已有证据支持', self_reported: '可能具备但未证明', missing: '尚未具备', unknown: '未知／待核实' });
const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const normalized = value => clean(value).toLocaleLowerCase().replace(/\s+/g, '');
const conditionKey = item => `${item.kind}:${normalized(item.label)}:${normalized(item.detail)}`;
const relationNames = { supports: '促进／支持', conflicts_with: '存在张力／取舍', inspired_by: '受到启发', related_to: '有关联' };
const clone = value => structuredClone(value);

function privacy(graph, includePrivate = false) {
  const privateNodes = includePrivate ? [] : graph.nodes.filter(node => node.private);
  const tokens = privateNodes.flatMap(node => [node.id, clean(node.title), clean(node.description)]).filter(Boolean);
  const hidden = text => tokens.some(token => clean(text).toLocaleLowerCase().includes(token.toLocaleLowerCase()));
  const text = value => hidden(value) ? '[私密内容已省略]' : clean(value);
  const nodeIds = new Set(graph.nodes.filter(node => includePrivate || !node.private).map(node => node.id));
  const edges = graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return { nodeIds, edges, text, hidden };
}

function permittedSkills(profile) {
  if (!profile || profile.schemaVersion !== 1 || profile.source !== 'legacy-career' || profile.revokedAt || profile.active === false || !Number.isFinite(Date.parse(profile.authorizedAt)) || !Array.isArray(profile.authorizedFields) || !profile.authorizedFields.includes('skills')) return [];
  return Array.isArray(profile.skills) ? profile.skills.filter(skill => skill && typeof skill.name === 'string').slice(0, 80) : [];
}

function assessment(requirement, profile, sources) {
  const evidence = [];
  const note = clean(requirement.evidenceNote);
  if (requirement.assessment === 'missing') return { status: 'missing', reason: '你在此条件上明确记录为尚未具备。', evidence };
  if (requirement.assessment === 'self_reported') return { status: 'self_reported', reason: '你记录为可能具备，仍需整理可核对的证明。', evidence: note ? [note] : evidence };
  if (requirement.assessment === 'evidenced') {
    // An official admission/JD requirement describes the route, not this
    // person's qualifications. Only an explicit personal note/user artifact
    // can support the user's personal assessment.
    const personalSources = (requirement.sourceIds || []).map(id => sources.get(id)).filter(source => source?.trustLevel === 'user_provided' && clean(source.excerpt));
    if (note || personalSources.length) return { status: 'evidenced', reason: '你已为此条件附上个人证据；适用性仍由你核对。', evidence: [note, ...personalSources.map(source => clean(source.excerpt))].filter(Boolean) };
    return { status: 'unknown', reason: '条件来源不能单独证明你已具备，需要补充个人证据。', evidence };
  }
  if (requirement.kind === 'skill') {
    const skill = permittedSkills(profile).find(skill => normalized(skill.name) === normalized(requirement.label));
    if (skill?.level === 'self_reported' && skill.evidenceType === 'text' && clean(skill.evidence)) return { status: 'self_reported', reason: '已授权的经历原文提到相关实践，尚不能证明达到这条路线的要求。', evidence: [clean(skill.evidence)] };
    if (skill) return { status: 'unknown', reason: '旧资料只有规则评分或标签，不能证明能力达标。', evidence };
  }
  if (requirement.kind === 'certificate') return { status: 'unknown', reason: '未提供此项证书的个人证明；技能标签和规则评分不代表已获证书。', evidence };
  if (requirement.kind === 'education') return { status: 'unknown', reason: '专业与学历阶段不能证明已取得相应学位或满足招生条件。', evidence };
  return { status: 'unknown', reason: '尚未记录个人证据或明确自评，需要核对。', evidence };
}

/** No graph mutation, score threshold or inferred qualification. */
export function computeRequirementGaps(graph, profile, { includePrivate = false } = {}) {
  validateGraph(graph);
  const publicView = privacy(graph, includePrivate);
  const sources = new Map((graph.sources || []).map(source => [source.id, source]));
  return publicView.edges.flatMap(edge => edge.requirements.filter(requirement => !publicView.hidden(requirement.label) && !publicView.hidden(requirement.detail)).map(requirement => {
    const result = assessment(requirement, profile, sources);
    const evidence = result.evidence.filter(item => !publicView.hidden(item));
    if (result.evidence.length && !evidence.length && ['evidenced', 'self_reported'].includes(result.status)) {
      result.status = 'unknown';
      result.reason = '当前可公开资料不足，保持待核实。';
    }
    return {
      edgeId: edge.id, requirementId: requirement.id, label: publicView.text(requirement.label), kind: requirement.kind,
      status: result.status, reason: result.reason, evidence,
    };
  }));
}

function selectPaths(graph, pathIds, { min = 1, max = 4, includePrivate = false } = {}) {
  validateGraph(graph);
  const ids = pathIds === undefined ? graph.savedPaths.slice(0, max).map(path => path.id) : pathIds;
  if (!Array.isArray(ids) || ids.length < min || ids.length > max || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error(`请选择 ${min}–${max} 条不同的已保存路线。`);
  const view = privacy(graph, includePrivate);
  const edgeMap = new Map(graph.edges.map(edge => [edge.id, edge]));
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  const paths = [];
  let omittedCount = 0;
  for (const id of ids) {
    const path = graph.savedPaths.find(path => path.id === id);
    if (!path) throw new Error('所选路线不属于当前人生树。');
    const edges = path.edgeIds.map(edgeId => edgeMap.get(edgeId));
    if (!edges.length || edges.some((edge, index) => !edge || !['possible_path', 'requires'].includes(edge.relation) || (index > 0 && edges[index - 1].to !== edge.from))) throw new Error('比较与规划需要连续的有向推进边链。');
    const nodeIds = [edges[0].from, ...edges.map(edge => edge.to)];
    if (nodeIds.some(nodeId => !view.nodeIds.has(nodeId))) { omittedCount++; continue; }
    const requirements = edges.flatMap(edge => edge.requirements.filter(requirement => !view.hidden(requirement.label) && !view.hidden(requirement.detail)).map(requirement => ({
      ...clone(requirement), label: view.text(requirement.label), detail: view.text(requirement.detail), evidenceNote: view.text(requirement.evidenceNote), edgeId: edge.id,
    })));
    paths.push({
      id, title: view.text(path.title), note: view.text(path.note), nodeIds, edgeIds: [...path.edgeIds],
      nodes: nodeIds.map(nodeId => ({ id: nodeId, title: view.text(nodeMap.get(nodeId).title), kind: nodeMap.get(nodeId).kind, description: view.text(nodeMap.get(nodeId).description), phase: nodeMap.get(nodeId).phase })),
      requirements,
    });
  }
  return { paths, omittedCount, view };
}

/** Compare actual saved edge chains; ranges are annotations, never promises. */
export function comparePaths(graph, profile, pathIds, { includePrivate = false } = {}) {
  const selected = selectPaths(graph, pathIds, { min: 2, includePrivate });
  const gaps = new Map(computeRequirementGaps(graph, profile, { includePrivate }).map(gap => [gap.requirementId, gap]));
  const pathData = selected.paths.map(path => {
    const nodeIds = new Set(path.nodeIds);
    const requirements = path.requirements.map(requirement => ({ ...requirement, gap: gaps.get(requirement.id) }));
    const tradeoffs = selected.view.edges.filter(edge => ['supports', 'conflicts_with', 'inspired_by', 'related_to'].includes(edge.relation) && (nodeIds.has(edge.from) || nodeIds.has(edge.to))).map(edge => ({
      relation: edge.relation, fromId: edge.from, toId: edge.to,
      fromTitle: selected.view.text(graph.nodes.find(node => node.id === edge.from).title), toTitle: selected.view.text(graph.nodes.find(node => node.id === edge.to).title),
      notes: edge.requirements.filter(requirement => !selected.view.hidden(requirement.label) && !selected.view.hidden(requirement.detail)).map(requirement => ({ label: selected.view.text(requirement.label), detail: selected.view.text(requirement.detail) })),
    }));
    return {
      ...path, requirements,
      costs: requirements.filter(requirement => requirement.kind === 'cost' || requirement.kind === 'resource').map(requirement => ({ requirementId: requirement.id, label: requirement.label, detail: requirement.detail, sourceIds: requirement.sourceIds || [], knowledgeStatus: requirement.knowledgeStatus })),
      time: requirements.filter(requirement => requirement.kind === 'time').map(requirement => ({ requirementId: requirement.id, label: requirement.label, detail: requirement.detail, ...(requirement.durationMonths ? { durationMonths: clone(requirement.durationMonths) } : {}), sourceIds: requirement.sourceIds || [], note: '路径已记录的时间条件；不代表可保证的总完成时间。' })),
      tradeoffs,
    };
  });
  const first = pathData[0];
  const commonNodeIds = first ? first.nodeIds.filter(id => pathData.every(path => path.nodeIds.includes(id))) : [];
  const commonConditions = first ? [...new Map(first.requirements.filter(requirement => pathData.every(path => path.requirements.some(item => conditionKey(item) === conditionKey(requirement)))).map(requirement => [conditionKey(requirement), { kind: requirement.kind, label: requirement.label, detail: requirement.detail }])).values()] : [];
  const commonKeys = new Set(commonConditions.map(conditionKey));
  return {
    paths: pathData, omittedCount: selected.omittedCount,
    common: { nodeIds: commonNodeIds, requirements: commonConditions },
    differences: pathData.map(path => ({ pathId: path.id, uniqueNodeIds: path.nodeIds.filter(id => !commonNodeIds.includes(id)), uniqueRequirements: path.requirements.filter(requirement => !commonKeys.has(conditionKey(requirement))) })),
    warnings: [
      ...(selected.omittedCount ? ['含私密节点的路线已整条省略，不能据此比较完整路线。'] : []),
      '未记录的时间与费用保持未知；共同条件也可能有不同的适用范围。',
      '价值关系来自你的记录，不对人生选择排序，也不生成成功率。',
    ],
  };
}

/** Return canonical add_task inputs only; the UI must preview and confirm them. */
export function makePlan(graph, profile, pathIds) {
  const selected = selectPaths(graph, pathIds);
  const gaps = new Map(computeRequirementGaps(graph, profile).map(gap => [gap.requirementId, gap]));
  const result = { near: [], mid: [], long: [], requiresConfirmation: true, omittedCount: selected.omittedCount, truncated: false };
  const seen = new Set();
  const add = (horizon, title, description, requirement) => {
    const key = `${horizon}:${requirement ? conditionKey(requirement) : title}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (result[horizon].length >= 12) { result.truncated = true; return; }
    result[horizon].push({ title: clean(title, 120), description: clean(description), status: 'todo', horizon, ...(requirement ? { edgeId: requirement.edgeId, requirementId: requirement.id, sourceIds: [...(requirement.sourceIds || [])] } : {}) });
  };
  for (const path of selected.paths) {
    for (const requirement of path.requirements) {
      const gap = gaps.get(requirement.id);
      if (!gap) continue;
      if (gap.status === 'unknown') add('near', `核实「${requirement.label}」的正式要求`, '先核对目标项目、岗位或个人目标是否真的需要此条件，记录适用地区、日期与来源。尚未确认前不把它视为必需。', requirement);
      if (gap.status === 'self_reported') add('near', `整理「${requirement.label}」的个人证据`, '列出实际做过的工作、作品或材料，对照这条路线的要求；不把旧规则评分当作资格证明。', requirement);
      if (gap.status === 'missing') {
        add('near', `确认「${requirement.label}」的补足方式`, '结合已核实要求和自身资源，选择可执行的小步骤；可修改、延期或放弃这项候选任务。', requirement);
        add('mid', `准备「${requirement.label}」相关行动`, '在核对要求后安排学习、项目或申请材料，并由你确定范围、预算与截止时间。', requirement);
      }
      if (gap.status === 'evidenced') add('mid', `复核「${requirement.label}」证据的适用性`, '检查已记录证据是否仍适用于当前目标；正式要求与个人情况都可能变化。', requirement);
    }
    add('long', `回顾「${path.title}」与当前生活选择`, '回看这条路线的条件、投入和价值关系，记录是否继续、修改或暂时搁置。近期、中期、长期只是计划分组，不代表已实现或保证完成。');
    const task = result.long.at(-1);
    if (task && !task.edgeId) task.edgeId = path.edgeIds.at(-1);
  }
  return result;
}

function sourceLine(source, view) {
  const raw = [source.title, source.publisher, source.url, source.excerpt, source.locator].filter(Boolean).join(' ');
  if (view.hidden(raw)) return null;
  const url = /^https?:\/\//i.test(source.url || '') ? source.url : '';
  return `- ${view.text(source.title)}${source.publisher ? `；发布者：${view.text(source.publisher)}` : ''}${url ? `；${url}` : ''}；记录核对时间：${view.text(source.checkedAt)}；可信级别：${view.text(source.trustLevel)}${source.publishedAt ? `；发布时间：${view.text(source.publishedAt)}` : ''}${source.expiresAt ? `；记录有效期：${view.text(source.expiresAt)}` : ''}`;
}

/** Plain text for .txt export or textContent preview; imported profile is omitted. */
export function humanReadableReport(graph, profile, pathIds, { includePrivate = false } = {}) {
  const selected = selectPaths(graph, pathIds, { min: 0, includePrivate });
  const gapMap = new Map(computeRequirementGaps(graph, profile, { includePrivate }).map(gap => [gap.requirementId, gap]));
  const sourceIds = new Set();
  const publicEdges = new Set(selected.paths.flatMap(path => path.edgeIds));
  const lines = [
    `始于足下 · ${selected.view.text(graph.title)}`, `图版本：${graph.revision}；最近记录：${graph.updatedAt}`, '',
    '这是一份用户规划记录，已选择的路线不代表已经实现。不推断学位、证书、个人成绩或成功概率。',
    includePrivate ? '此副本包含你明确选择的私密内容，请检查接收范围。' : '公开副本已排除私密节点及包含私密节点的整条路线；不会附带已授权个人档案。', '',
  ];
  for (const [index, path] of selected.paths.entries()) {
    lines.push(`${index === 0 ? '主路线' : '备选路线'} ${index + 1}：${path.title}`, path.nodes.map(node => node.title).join(' → '));
    if (path.note) lines.push(`用户路线备注：${path.note}`);
    for (const node of path.nodes) if (node.description) lines.push(`用户节点记录「${node.title}」：${node.description}`);
    if (!path.requirements.length) lines.push('准备条件：尚未记录，保持未知。');
    for (const requirement of path.requirements) {
      const gap = gapMap.get(requirement.id);
      const edge = graph.edges.find(edge => edge.id === requirement.edgeId);
      const from = graph.nodes.find(node => node.id === edge.from);
      const to = graph.nodes.find(node => node.id === edge.to);
      lines.push(`- ${selected.view.text(from.title)} → ${selected.view.text(to.title)}：条件「${requirement.label}」；类型：${requirement.kind}；必要性：${requirement.necessity}；个人证据状态：${GapStatuses[gap?.status || 'unknown']}`);
      if (requirement.detail) lines.push(`  用户/来源记录：${requirement.detail}`);
      if (requirement.evidenceNote) lines.push(`  用户证据备注：${requirement.evidenceNote}`);
      if (requirement.durationMonths) lines.push(`  已记录时间范围：${requirement.durationMonths.min ?? '未知'}–${requirement.durationMonths.max ?? '未知'} 个月（不作总工期承诺）`);
      for (const sourceId of requirement.sourceIds || []) sourceIds.add(sourceId);
    }
    for (const nodeId of path.nodeIds) {
      const node = graph.nodes.find(node => node.id === nodeId);
      for (const sourceId of node.sourceIds || []) sourceIds.add(sourceId);
    }
    const pathNodes = new Set(path.nodeIds);
    const relations = selected.view.edges.filter(edge => relationNames[edge.relation] && (pathNodes.has(edge.from) || pathNodes.has(edge.to)));
    if (relations.length) lines.push('用户记录的跨领域关联与取舍（不含私密反思）：');
    for (const edge of relations) {
      const from = graph.nodes.find(node => node.id === edge.from);
      const to = graph.nodes.find(node => node.id === edge.to);
      lines.push(`- ${selected.view.text(from.title)} ↔ ${selected.view.text(to.title)}：${relationNames[edge.relation]}`);
      for (const requirement of edge.requirements) {
        if (selected.view.hidden(requirement.label) || selected.view.hidden(requirement.detail)) continue;
        lines.push(`  ${selected.view.text(requirement.label)}${requirement.detail ? `：${selected.view.text(requirement.detail)}` : ''}`);
        for (const sourceId of requirement.sourceIds || []) sourceIds.add(sourceId);
      }
    }
    lines.push('');
  }
  const tasks = (graph.tasks || []).filter(task => task.edgeId && publicEdges.has(task.edgeId) && !selected.view.hidden(task.title) && !selected.view.hidden(task.description));
  if (tasks.length) {
    lines.push('用户已确认的阶段任务');
    for (const task of tasks) {
      lines.push(`- ${selected.view.text(task.title)}；阶段：${task.horizon}；状态：${task.status}${task.dueDate ? `；截止日期：${task.dueDate}` : ''}`);
      if (task.description) lines.push(`  ${selected.view.text(task.description)}`);
      for (const sourceId of task.sourceIds || []) sourceIds.add(sourceId);
    }
    lines.push('');
  }
  const cited = (graph.sources || []).filter(source => sourceIds.has(source.id)).map(source => sourceLine(source, selected.view)).filter(Boolean);
  lines.push('引用来源', ...(cited.length ? cited : ['尚未记录可随此路线公开的来源；具体要求保持待核实。']), '', '准备时间、费用与价值取舍以已记录条件为限；缺失数据不补造，不对人生选择作个人结论。');
  if (!selected.paths.length) lines.push('尚未选择可公开的已保存路线。');
  if (selected.omittedCount) lines.push('部分所选路线含私密节点，已整条省略。');
  return lines.join('\n');
}
