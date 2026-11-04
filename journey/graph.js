/** Versioned, dependency-free graph model shared by the browser and server. */
export const NodeKinds = Object.freeze(['self', 'major', 'education', 'career', 'milestone', 'skill', 'goal', 'other', 'value', 'passion', 'desire', 'philosophy', 'lifestyle', 'life_event']);
export const RequirementKinds = Object.freeze(['education', 'skill', 'certificate', 'experience', 'time', 'cost', 'location', 'resource', 'personal', 'other']);
export const Relations = Object.freeze(['possible_path', 'requires', 'supports', 'conflicts_with', 'inspired_by', 'related_to']);
export const Origins = Object.freeze(['user', 'seed', 'ai', 'imported', 'verified_source']);
export const KnowledgeStatuses = Object.freeze(['user_asserted', 'verified', 'unverified', 'not_applicable']);
export const Necessities = Object.freeze(['required', 'recommended', 'optional', 'unknown']);
export const Assessments = Object.freeze(['evidenced', 'self_reported', 'missing', 'unknown']);
export const TaskStatuses = Object.freeze(['todo', 'doing', 'done']);
export const TaskHorizons = Object.freeze(['near', 'mid', 'long']);
export const SourceTrustLevels = Object.freeze(['official', 'user_provided', 'unverified']);
const phases = ['idea', 'exploring', 'planned', 'in_progress', 'achieved', 'paused', 'abandoned'];
const advancing = new Set(['possible_path', 'requires']);
const nodeFields = ['id', 'kind', 'title', 'description', 'phase', 'origin', 'knowledgeStatus', 'sourceIds', 'private', 'shareAllowed', 'position', 'createdAt', 'updatedAt', 'attributes'];
const requirementFields = ['id', 'kind', 'label', 'detail', 'necessity', 'knowledgeStatus', 'sourceIds', 'durationMonths', 'assessment', 'evidenceNote'];
const editableNodeFields = ['title', 'description', 'kind', 'phase', 'private', 'shareAllowed', 'position', 'attributes', 'knowledgeStatus', 'sourceIds'];
const newNodeFields = ['kind', 'title', 'description', 'position', 'private', 'shareAllowed', 'phase', 'attributes', 'knowledgeStatus', 'sourceIds'];
const taskEditableFields = ['title', 'description', 'status', 'horizon', 'dueDate', 'edgeId', 'requirementId', 'sourceIds'];
const sourceFields = ['id', 'title', 'url', 'publisher', 'publishedAt', 'checkedAt', 'excerpt', 'trustLevel', 'contentHash', 'license', 'region', 'language', 'locator', 'expiresAt'];
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const newId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`}`;

function fail(message, code = 'INVALID_GRAPH') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
}
function fields(value, allowed, name) {
  record(value, name);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} 包含不支持的字段 ${key}`);
}
function text(value, name, max = 120, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(`${name} 必须是${max}字以内的${allowEmpty ? '' : '非空'}文本`);
}
function id(value, name) { text(value, name, 160); }
function list(value, name, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${name} 必须是最多 ${max} 项的数组`);
}
function choice(value, choices, name) {
  if (!choices.includes(value)) fail(`${name} 的值不受支持`);
}
function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${name} 必须是 ISO 时间`);
}
function position(value, name = 'position') {
  fields(value, ['x', 'y'], name);
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1000000 || Math.abs(value.y) > 1000000) fail(`${name} 坐标无效`);
}
function provenance(value, name, sources) {
  choice(value.knowledgeStatus, KnowledgeStatuses, `${name}.knowledgeStatus`);
  if (value.sourceIds !== undefined) {
    list(value.sourceIds, `${name}.sourceIds`, 20);
    value.sourceIds.forEach(source => id(source, 'sourceId'));
    if (new Set(value.sourceIds).size !== value.sourceIds.length) fail(`${name} 来源 ID 重复`);
    if (sources && value.sourceIds.some(sourceId => !sources.has(sourceId))) fail(`${name} 引用了不存在的来源`);
  }
  if (value.knowledgeStatus === 'verified' && !value.sourceIds?.length) fail(`${name} 缺少核验证据，不能标记 verified`);
  if (value.origin === 'ai' && value.knowledgeStatus === 'verified') fail(`${name} AI 输出不能自我核验`);
  if (sources && value.knowledgeStatus === 'verified' && value.sourceIds.some(sourceId => {
    const source = sources.get(sourceId);
    return source.trustLevel !== 'official' || !source.url || !source.contentHash;
  })) fail(`${name} 未经官方资料核对，不能标记 verified`);
}
function unique(value, allIds, name) {
  id(value, `${name}.id`);
  if (allIds.has(value)) fail(`${name} ID 重复`);
  allIds.add(value);
}
function validateRequirement(requirement, allIds, sources) {
  fields(requirement, requirementFields, 'requirement');
  unique(requirement.id, allIds, 'requirement');
  choice(requirement.kind, RequirementKinds, 'requirement.kind');
  text(requirement.label, 'requirement.label');
  if (requirement.detail !== undefined) text(requirement.detail, 'requirement.detail', 2000, true);
  choice(requirement.necessity, Necessities, 'requirement.necessity');
  provenance(requirement, 'requirement', sources);
  if (requirement.assessment !== undefined) choice(requirement.assessment, Assessments, 'requirement.assessment');
  if (requirement.evidenceNote !== undefined) text(requirement.evidenceNote, 'requirement.evidenceNote', 2000, true);
  if (requirement.assessment === 'evidenced' && !requirement.evidenceNote?.trim() && !requirement.sourceIds?.some(sourceId => {
    const source = sources?.get(sourceId);
    return source?.trustLevel === 'user_provided' && source.excerpt?.trim();
  })) fail('已提供证据的能力条件需要实际说明或本人的资料引用，官方要求不能证明个人已具备');
  if (requirement.durationMonths !== undefined) {
    fields(requirement.durationMonths, ['min', 'max'], 'durationMonths');
    const { min, max } = requirement.durationMonths;
    if (min === undefined && max === undefined) fail('durationMonths 至少需要一个边界');
    for (const value of [min, max]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) fail('持续时间必须是非负月数');
    if (min !== undefined && max !== undefined && min > max) fail('持续时间范围倒置');
  }
}

function calendarDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(`${name} 必须是有效的 YYYY-MM-DD 日期`);
}
function sourceDate(value, name) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) calendarDate(value, name);
  else timestamp(value, name);
}
function validateSource(source, allIds) {
  fields(source, sourceFields, 'source');
  unique(source.id, allIds, 'source');
  text(source.title, 'source.title', 300);
  choice(source.trustLevel, SourceTrustLevels, 'source.trustLevel');
  timestamp(source.checkedAt, 'source.checkedAt');
  if (source.url !== undefined && source.url !== '') {
    text(source.url, 'source.url', 2048);
    let parsed;
    try { parsed = new URL(source.url); } catch { fail('source.url 必须是有效的网页地址'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('source.url 必须是安全的 HTTP(S) 地址');
  }
  for (const field of ['publisher', 'contentHash', 'license', 'region', 'language', 'locator']) if (source[field] !== undefined) text(source[field], `source.${field}`, field === 'locator' ? 1000 : 300, true);
  if (source.excerpt !== undefined) text(source.excerpt, 'source.excerpt', 6000, true);
  for (const field of ['publishedAt', 'expiresAt']) if (source[field] !== undefined) sourceDate(source[field], `source.${field}`);
}

function referenceSources(sourceIds, sources, name) {
  if (sourceIds === undefined) return;
  list(sourceIds, `${name}.sourceIds`, 20);
  if (new Set(sourceIds).size !== sourceIds.length) fail(`${name} 来源 ID 重复`);
  for (const sourceId of sourceIds) if (typeof sourceId !== 'string' || !sources?.has(sourceId)) fail(`${name} 引用了不存在的来源`);
}
function pathChain(edgeIds, edges) {
  list(edgeIds, 'path.edgeIds', 600);
  if (!edgeIds.length || new Set(edgeIds).size !== edgeIds.length) fail('保存路径需要不重复的连续边');
  let previous;
  for (const edgeId of edgeIds) {
    id(edgeId, 'path.edgeId');
    const edge = edges.get(edgeId);
    if (!edge || (previous && previous.to !== edge.from)) fail('保存路径包含缺失或不连续的边');
    previous = edge;
  }
}

export function createGraph({ title = '我的人生树' } = {}) {
  const now = new Date().toISOString();
  const rootNodeId = newId('node');
  return validateGraph({
    schemaVersion: 1, graphId: newId('graph'), title, rootNodeId,
    nodes: [{ id: rootNodeId, kind: 'self', title: '我 · 此刻', description: '', phase: 'exploring', origin: 'user', knowledgeStatus: 'user_asserted', sourceIds: [], private: false, position: { x: 120, y: 300 }, createdAt: now, updatedAt: now }],
    edges: [], savedPaths: [], viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, createdAt: now, updatedAt: now,
  });
}

/** Pure validation: successful validation returns the same graph object. */
export function validateGraph(graph) {
  fields(graph, ['schemaVersion', 'graphId', 'ownerId', 'title', 'rootNodeId', 'nodes', 'edges', 'savedPaths', 'viewport', 'revision', 'createdAt', 'updatedAt', 'tasks', 'sources', 'reflections'], 'graph');
  if (graph.schemaVersion !== 1) fail('不支持的图数据版本');
  id(graph.graphId, 'graphId');
  id(graph.rootNodeId, 'rootNodeId');
  if (graph.ownerId !== undefined) id(graph.ownerId, 'ownerId');
  text(graph.title, 'graph.title');
  if (!Number.isSafeInteger(graph.revision) || graph.revision < 0) fail('图版本必须是非负整数');
  timestamp(graph.createdAt, 'graph.createdAt');
  timestamp(graph.updatedAt, 'graph.updatedAt');
  list(graph.nodes, 'nodes', 300);
  list(graph.edges, 'edges', 600);
  list(graph.savedPaths, 'savedPaths', 100);
  if (!graph.nodes.length) fail('图必须保留根节点');
  const allIds = new Set();
  let sources;
  if (graph.sources !== undefined) {
    list(graph.sources, 'sources', 100);
    sources = new Map();
    for (const source of graph.sources) { validateSource(source, allIds); sources.set(source.id, source); }
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    fields(node, nodeFields, 'node');
    unique(node.id, allIds, 'node');
    choice(node.kind, NodeKinds, 'node.kind');
    text(node.title, 'node.title');
    if (node.description !== undefined) text(node.description, 'node.description', 2000, true);
    if (node.phase !== undefined) choice(node.phase, phases, 'node.phase');
    choice(node.origin, Origins, 'node.origin');
    provenance(node, 'node', sources);
    if (node.private !== undefined && typeof node.private !== 'boolean') fail('node.private 必须是布尔值');
    if (node.shareAllowed !== undefined && typeof node.shareAllowed !== 'boolean') fail('node.shareAllowed 必须是布尔值');
    position(node.position);
    timestamp(node.createdAt, 'node.createdAt');
    timestamp(node.updatedAt, 'node.updatedAt');
    if (node.attributes !== undefined) {
      record(node.attributes, 'node.attributes');
      let serialized;
      try { serialized = JSON.stringify(node.attributes); } catch { fail('attributes 必须可序列化'); }
      if (serialized.length > 20000) fail('attributes 超出长度限制');
    }
    nodes.set(node.id, node);
  }
  if (nodes.get(graph.rootNodeId)?.kind !== 'self') fail('rootNodeId 必须指向 self 根节点');
  const edges = new Map();
  const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    fields(edge, ['id', 'from', 'to', 'relation', 'requirements', 'origin', 'createdAt'], 'edge');
    unique(edge.id, allIds, 'edge');
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail('边引用了不属于当前图的节点');
    choice(edge.relation, Relations, 'edge.relation');
    choice(edge.origin, Origins, 'edge.origin');
    timestamp(edge.createdAt, 'edge.createdAt');
    list(edge.requirements, 'edge.requirements', 20);
    edge.requirements.forEach(requirement => validateRequirement(requirement, allIds, sources));
    if (edge.origin === 'ai' && edge.requirements.some(requirement => requirement.knowledgeStatus === 'verified')) fail('AI 边条件不能自我核验');
    if (advancing.has(edge.relation)) adjacency.get(edge.from).push(edge.to);
    edges.set(edge.id, edge);
  }
  // Check all connected components, including branches temporarily detached by a deletion.
  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) fail('推进路径不能形成有向环');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const child of adjacency.get(nodeId)) visit(child);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of nodes.keys()) visit(nodeId);
  for (const path of graph.savedPaths) {
    fields(path, ['id', 'title', 'edgeIds', 'selectedAt', 'note'], 'savedPath');
    unique(path.id, allIds, 'savedPath');
    text(path.title, 'savedPath.title');
    timestamp(path.selectedAt, 'savedPath.selectedAt');
    if (path.note !== undefined) text(path.note, 'savedPath.note', 2000, true);
    pathChain(path.edgeIds, edges);
  }
  if (graph.tasks !== undefined) {
    list(graph.tasks, 'tasks', 200);
    const requirements = new Map(graph.edges.flatMap(edge => edge.requirements.map(requirement => [requirement.id, edge.id])));
    for (const task of graph.tasks) {
      fields(task, ['id', ...taskEditableFields, 'createdAt', 'updatedAt'], 'task');
      unique(task.id, allIds, 'task');
      text(task.title, 'task.title');
      if (task.description !== undefined) text(task.description, 'task.description', 2000, true);
      choice(task.status, TaskStatuses, 'task.status');
      choice(task.horizon, TaskHorizons, 'task.horizon');
      if (task.dueDate !== undefined) calendarDate(task.dueDate, 'task.dueDate');
      if (task.edgeId !== undefined && !edges.has(task.edgeId)) fail('任务引用了不存在的边');
      if (task.requirementId !== undefined && (!requirements.has(task.requirementId) || (task.edgeId !== undefined && requirements.get(task.requirementId) !== task.edgeId))) fail('任务条件不存在或不属于关联边');
      referenceSources(task.sourceIds, sources, 'task');
      timestamp(task.createdAt, 'task.createdAt');
      timestamp(task.updatedAt, 'task.updatedAt');
    }
  }
  if (graph.reflections !== undefined) {
    list(graph.reflections, 'reflections', 200);
    for (const reflection of graph.reflections) {
      fields(reflection, ['id', 'nodeId', 'text', 'private', 'createdAt', 'updatedAt'], 'reflection');
      unique(reflection.id, allIds, 'reflection');
      if (reflection.nodeId !== undefined && !nodes.has(reflection.nodeId)) fail('反思关联节点不存在');
      text(reflection.text, 'reflection.text', 6000);
      if (typeof reflection.private !== 'boolean') fail('reflection.private 必须是布尔值');
      timestamp(reflection.createdAt, 'reflection.createdAt');
      timestamp(reflection.updatedAt, 'reflection.updatedAt');
    }
  }
  if (graph.viewport !== undefined) {
    fields(graph.viewport, ['x', 'y', 'zoom'], 'viewport');
    position({ x: graph.viewport.x, y: graph.viewport.y }, 'viewport');
    if (!Number.isFinite(graph.viewport.zoom) || graph.viewport.zoom <= 0 || graph.viewport.zoom > 20) fail('viewport.zoom 无效');
  }
  return graph;
}

function revisionCheck(graph, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== graph.revision) fail('人生树已发生变化，请基于最新版本重试', 'REVISION_CONFLICT');
}
function operationShape(operation) {
  record(operation, 'operation');
  const shapes = {
    add_node: ['op', 'tempId', 'node'], add_edge: ['op', 'fromId', 'toId', 'relation'],
    annotate_edge: ['op', 'edgeId', 'requirements'], update_node: ['op', 'nodeId', 'patch'],
    move_node: ['op', 'nodeId', 'position'], delete_node: ['op', 'nodeId'], delete_edge: ['op', 'edgeId'],
    rename_graph: ['op', 'title'], save_path: ['op', 'title', 'edgeIds'], delete_path: ['op', 'pathId'],
    add_task: ['op', 'task'], update_task: ['op', 'taskId', 'patch'], delete_task: ['op', 'taskId'],
    upsert_source: ['op', 'source'], add_source: ['op', 'source'], delete_source: ['op', 'sourceId'],
    add_reflection: ['op', 'reflection'], update_reflection: ['op', 'reflectionId', 'patch'], delete_reflection: ['op', 'reflectionId'],
  };
  if (!Object.hasOwn(shapes, operation.op)) fail('不支持的图操作', 'INVALID_OPERATION');
  fields(operation, shapes[operation.op], 'operation');
}

/** Apply a complete command batch to a copy, then validate once before returning it. */
export function applyOperations(graph, operations, expectedRevision = graph.revision, { origin = 'user' } = {}) {
  validateGraph(graph);
  revisionCheck(graph, expectedRevision);
  choice(origin, Origins, 'origin');
  list(operations, 'operations', 600);
  operations.forEach(operationShape);
  const aiSourceIds = sourceIds => {
    referenceSources(sourceIds, new Map((graph.sources || []).map(source => [source.id, source])), 'AI');
  };
  if (origin === 'ai') {
    if (operations.length > 36 || operations.filter(operation => operation.op === 'add_node').length > 12) fail('AI 草案超过操作上限', 'INVALID_PROPOSAL');
    const assertPublic = nodeId => {
      if (graph.nodes.some(node => node.id === nodeId && node.private)) fail('AI 不能访问未授权的私密节点', 'INVALID_PROPOSAL');
    };
    for (const operation of operations) {
      if (!['add_node', 'add_edge', 'annotate_edge', 'update_node'].includes(operation.op)) fail('AI 无权执行此操作', 'INVALID_PROPOSAL');
      if (operation.op === 'update_node') {
        assertPublic(operation.nodeId);
        fields(operation.patch, ['title', 'description'], 'AI patch');
      } else if (operation.op === 'add_edge') {
        assertPublic(operation.fromId);
        assertPublic(operation.toId);
      } else if (operation.op === 'annotate_edge') {
        const edge = graph.edges.find(item => item.id === operation.edgeId);
        if (edge) { assertPublic(edge.from); assertPublic(edge.to); }
        list(operation.requirements, 'requirements', 20);
        for (const requirement of operation.requirements) {
          if (requirement.knowledgeStatus !== undefined && requirement.knowledgeStatus !== 'unverified') fail('AI 条件必须为 unverified', 'INVALID_PROPOSAL');
          aiSourceIds(requirement.sourceIds);
          if (requirement.assessment !== undefined && !['unknown', 'missing'].includes(requirement.assessment)) fail('AI 不能代替用户认定已经具备能力', 'INVALID_PROPOSAL');
          if (requirement.evidenceNote?.trim()) fail('AI 不能编造个人能力证据', 'INVALID_PROPOSAL');
        }
      } else if (operation.op === 'add_node') {
        fields(operation.node, ['kind', 'title', 'description', 'knowledgeStatus', 'sourceIds'], 'AI node');
        if (operation.node.knowledgeStatus !== undefined && operation.node.knowledgeStatus !== 'unverified') fail('AI 节点必须为 unverified', 'INVALID_PROPOSAL');
        aiSourceIds(operation.node.sourceIds);
      }
    }
  }
  if (!operations.length) return clone(graph);
  const next = clone(graph);
  const now = new Date().toISOString();
  const tempIds = new Map();
  const nodes = new Map(next.nodes.map(node => [node.id, node]));
  const createdNodes = new Map();
  const resolve = nodeId => {
    id(nodeId, 'nodeId');
    const resolved = tempIds.get(nodeId) ?? nodeId;
    if (!nodes.has(resolved)) fail('操作引用了不属于当前图的节点', 'INVALID_OPERATION');
    return resolved;
  };
  // Allocate all node IDs first so edge commands may refer forward to another tempId.
  for (const operation of operations) {
    if (operation.op !== 'add_node') continue;
    id(operation.tempId, 'tempId');
    if (tempIds.has(operation.tempId) || nodes.has(operation.tempId)) fail('tempId 重复或与已有节点冲突', 'INVALID_OPERATION');
    fields(operation.node, newNodeFields, 'add_node.node');
    const nodeId = newId('node');
    tempIds.set(operation.tempId, nodeId);
    const node = {
      ...clone(operation.node), id: nodeId, origin,
      knowledgeStatus: origin === 'ai' ? 'unverified' : operation.node.knowledgeStatus ?? (origin === 'user' ? 'user_asserted' : 'unverified'),
      sourceIds: clone(operation.node.sourceIds ?? []), phase: operation.node.phase ?? 'idea',
      position: clone(operation.node.position ?? { x: 120, y: 300 }), createdAt: now, updatedAt: now,
    };
    if (origin === 'ai' && operation.node.knowledgeStatus === 'verified') fail('AI 不能提交 verified 节点', 'INVALID_OPERATION');
    nodes.set(nodeId, node);
    createdNodes.set(nodeId, operation);
    next.nodes.push(node);
  }
  // Place only new nodes. Explicitly dragged positions and all existing positions survive.
  const positioned = new Set(next.nodes.filter(node => !createdNodes.has(node.id) || createdNodes.get(node.id).node.position).map(node => node.id));
  const positioning = new Set();
  function place(nodeId) {
    if (positioned.has(nodeId) || positioning.has(nodeId)) return;
    positioning.add(nodeId);
    const incoming = operations.find(operation => operation.op === 'add_edge' && resolve(operation.toId) === nodeId && advancing.has(operation.relation ?? 'possible_path'));
    const parentId = incoming ? resolve(incoming.fromId) : graph.rootNodeId;
    if (createdNodes.has(parentId)) place(parentId);
    const parent = nodes.get(parentId);
    const node = nodes.get(nodeId);
    let x = parent.position.x + 300;
    let y = parent.position.y;
    while (next.nodes.some(other => other.id !== nodeId && positioned.has(other.id) && Math.abs(other.position.x - x) < 240 && Math.abs(other.position.y - y) < 110)) y += 124;
    node.position = { x, y };
    positioning.delete(nodeId);
    positioned.add(nodeId);
  }
  for (const nodeId of createdNodes.keys()) place(nodeId);
  const edgeById = edgeId => {
    id(edgeId, 'edgeId');
    const edge = next.edges.find(item => item.id === edgeId);
    if (!edge) fail('操作引用了不属于当前图的边', 'INVALID_OPERATION');
    return edge;
  };
  const prunePaths = deletedEdges => {
    next.savedPaths = next.savedPaths.filter(path => !path.edgeIds.some(edgeId => deletedEdges.has(edgeId)));
  };
  const detachTasks = (deletedEdges, deletedRequirements = new Set()) => {
    for (const task of next.tasks || []) {
      let changed = false;
      if (deletedEdges.has(task.edgeId)) { delete task.edgeId; changed = true; }
      if (deletedRequirements.has(task.requirementId)) { delete task.requirementId; changed = true; }
      if (changed) task.updatedAt = now;
    }
  };
  for (const operation of operations) {
    switch (operation.op) {
      case 'add_node': break;
      case 'add_edge': {
        const from = resolve(operation.fromId);
        const to = resolve(operation.toId);
        const relation = operation.relation ?? 'possible_path';
        choice(relation, Relations, 'relation');
        if (next.edges.some(edge => edge.from === from && edge.to === to && edge.relation === relation)) fail('该关系连线已存在', 'INVALID_OPERATION');
        next.edges.push({ id: newId('edge'), from, to, relation, requirements: [], origin, createdAt: now });
        break;
      }
      case 'annotate_edge': {
        const edge = edgeById(operation.edgeId);
        const previousRequirements = new Set(edge.requirements.map(requirement => requirement.id));
        list(operation.requirements, 'requirements', 20);
        edge.requirements = operation.requirements.map(requirement => {
          fields(requirement, requirementFields, 'requirement');
          if (origin === 'ai' && requirement.knowledgeStatus === 'verified') fail('AI 不能提交 verified 条件', 'INVALID_OPERATION');
          return {
            ...clone(requirement), id: requirement.id ?? newId('requirement'),
            knowledgeStatus: origin === 'ai' ? 'unverified' : requirement.knowledgeStatus ?? (origin === 'user' ? 'user_asserted' : 'unverified'),
            necessity: requirement.necessity ?? 'unknown', sourceIds: clone(requirement.sourceIds ?? []),
          };
        });
        const retained = new Set(edge.requirements.map(requirement => requirement.id));
        detachTasks(new Set(), new Set([...previousRequirements].filter(requirementId => !retained.has(requirementId))));
        break;
      }
      case 'update_node': {
        fields(operation.patch, editableNodeFields, 'patch');
        const node = nodes.get(resolve(operation.nodeId));
        if (origin === 'ai' && operation.patch.knowledgeStatus === 'verified') fail('AI 不能自我核验', 'INVALID_OPERATION');
        Object.assign(node, clone(operation.patch), { updatedAt: now });
        if (origin === 'ai') node.knowledgeStatus = 'unverified';
        break;
      }
      case 'move_node': {
        position(operation.position);
        Object.assign(nodes.get(resolve(operation.nodeId)), { position: clone(operation.position), updatedAt: now });
        break;
      }
      case 'delete_node': {
        const nodeId = resolve(operation.nodeId);
        if (nodeId === graph.rootNodeId) fail('根节点不能删除', 'INVALID_OPERATION');
        const removed = new Set(next.edges.filter(edge => edge.from === nodeId || edge.to === nodeId).map(edge => edge.id));
        const requirements = new Set(next.edges.filter(edge => removed.has(edge.id)).flatMap(edge => edge.requirements.map(requirement => requirement.id)));
        next.nodes = next.nodes.filter(node => node.id !== nodeId);
        next.edges = next.edges.filter(edge => !removed.has(edge.id));
        nodes.delete(nodeId);
        prunePaths(removed);
        detachTasks(removed, requirements);
        for (const reflection of next.reflections || []) if (reflection.nodeId === nodeId) { delete reflection.nodeId; reflection.updatedAt = now; }
        break;
      }
      case 'delete_edge': {
        const edge = edgeById(operation.edgeId);
        next.edges = next.edges.filter(item => item.id !== edge.id);
        prunePaths(new Set([edge.id]));
        detachTasks(new Set([edge.id]), new Set(edge.requirements.map(requirement => requirement.id)));
        break;
      }
      case 'rename_graph': next.title = operation.title; break;
      case 'save_path':
        pathChain(operation.edgeIds, new Map(next.edges.map(edge => [edge.id, edge])));
        next.savedPaths.push({ id: newId('path'), title: operation.title, edgeIds: clone(operation.edgeIds), selectedAt: now });
        break;
      case 'delete_path': {
        id(operation.pathId, 'pathId');
        if (!next.savedPaths.some(path => path.id === operation.pathId)) fail('保存路径不存在', 'INVALID_OPERATION');
        next.savedPaths = next.savedPaths.filter(path => path.id !== operation.pathId);
        break;
      }
      case 'upsert_source':
      case 'add_source': {
        validateSource(operation.source, new Set());
        next.sources ??= [];
        const index = next.sources.findIndex(source => source.id === operation.source.id);
        if (operation.op === 'add_source' && index !== -1) fail('来源 ID 已存在', 'INVALID_OPERATION');
        if (index === -1) next.sources.push(clone(operation.source));
        else next.sources[index] = clone(operation.source);
        // A changed source may withdraw previous evidence. Keep the user's
        // annotations and references, but never preserve unsupported certainty.
        for (const item of [...next.nodes, ...next.edges.flatMap(edge => edge.requirements)]) {
          if (!item.sourceIds?.includes(operation.source.id)) continue;
          let changed = false;
          if (item.knowledgeStatus === 'verified' && item.sourceIds.some(sourceId => {
            const source = next.sources.find(candidate => candidate.id === sourceId);
            return !source || source.trustLevel !== 'official' || !source.url || !source.contentHash;
          })) { item.knowledgeStatus = 'unverified'; changed = true; }
          if (item.assessment === 'evidenced' && !item.evidenceNote?.trim() && !item.sourceIds.some(sourceId => next.sources.some(source => source.id === sourceId && source.trustLevel === 'user_provided' && source.excerpt?.trim()))) { item.assessment = 'unknown'; changed = true; }
          if (changed && Object.hasOwn(item, 'updatedAt')) item.updatedAt = now;
        }
        break;
      }
      case 'delete_source': {
        id(operation.sourceId, 'sourceId');
        if (!next.sources?.some(source => source.id === operation.sourceId)) fail('来源不存在', 'INVALID_OPERATION');
        next.sources = next.sources.filter(source => source.id !== operation.sourceId);
        for (const item of [...next.nodes, ...next.edges.flatMap(edge => edge.requirements), ...(next.tasks || [])]) {
          if (!item.sourceIds?.includes(operation.sourceId)) continue;
          item.sourceIds = item.sourceIds.filter(sourceId => sourceId !== operation.sourceId);
          if (item.knowledgeStatus === 'verified') item.knowledgeStatus = 'unverified';
          if (item.assessment === 'evidenced' && !item.evidenceNote?.trim() && !item.sourceIds.some(sourceId => next.sources.some(source => source.id === sourceId && source.trustLevel === 'user_provided' && source.excerpt?.trim()))) item.assessment = 'unknown';
          if (Object.hasOwn(item, 'updatedAt')) item.updatedAt = now;
        }
        break;
      }
      case 'add_task': {
        fields(operation.task, taskEditableFields, 'task');
        next.tasks ??= [];
        next.tasks.push({ ...clone(operation.task), id: newId('task'), status: operation.task.status ?? 'todo', horizon: operation.task.horizon ?? 'near', sourceIds: clone(operation.task.sourceIds ?? []), createdAt: now, updatedAt: now });
        break;
      }
      case 'update_task': {
        fields(operation.patch, taskEditableFields, 'task.patch');
        const task = next.tasks?.find(item => item.id === operation.taskId);
        if (!task) fail('任务不存在', 'INVALID_OPERATION');
        Object.assign(task, clone(operation.patch), { updatedAt: now });
        for (const field of ['dueDate', 'edgeId', 'requirementId']) if (task[field] === null || task[field] === '') delete task[field];
        break;
      }
      case 'delete_task':
        if (!next.tasks?.some(task => task.id === operation.taskId)) fail('任务不存在', 'INVALID_OPERATION');
        next.tasks = next.tasks.filter(task => task.id !== operation.taskId);
        break;
      case 'add_reflection': {
        fields(operation.reflection, ['nodeId', 'text', 'private'], 'reflection');
        next.reflections ??= [];
        next.reflections.push({ ...clone(operation.reflection), id: newId('reflection'), private: operation.reflection.private ?? true, createdAt: now, updatedAt: now });
        break;
      }
      case 'update_reflection': {
        fields(operation.patch, ['nodeId', 'text', 'private'], 'reflection.patch');
        const reflection = next.reflections?.find(item => item.id === operation.reflectionId);
        if (!reflection) fail('反思不存在', 'INVALID_OPERATION');
        Object.assign(reflection, clone(operation.patch), { updatedAt: now });
        if (reflection.nodeId === null || reflection.nodeId === '') delete reflection.nodeId;
        break;
      }
      case 'delete_reflection':
        if (!next.reflections?.some(reflection => reflection.id === operation.reflectionId)) fail('反思不存在', 'INVALID_OPERATION');
        next.reflections = next.reflections.filter(reflection => reflection.id !== operation.reflectionId);
        break;
    }
  }
  next.revision = graph.revision + 1;
  next.updatedAt = now;
  return validateGraph(next);
}

/** Validate the exact AI capability boundary before preview or confirmation. */
export function validateProposal(graph, operations, expectedRevision = graph.revision) {
  validateGraph(graph);
  revisionCheck(graph, expectedRevision);
  list(operations, 'proposedOperations', 36);
  if (operations.filter(operation => operation?.op === 'add_node').length > 12) fail('AI 单次最多提议12个节点', 'INVALID_PROPOSAL');
  const normalized = clone(operations);
  const existing = new Map(graph.nodes.map(node => [node.id, node]));
  const temporary = new Set();
  for (const operation of normalized) {
    operationShape(operation);
    if (!['add_node', 'add_edge', 'annotate_edge', 'update_node'].includes(operation.op)) fail('AI 无权执行此操作', 'INVALID_PROPOSAL');
    if (operation.op === 'add_node') {
      id(operation.tempId, 'tempId');
      if (temporary.has(operation.tempId) || existing.has(operation.tempId)) fail('AI tempId 重复或越权', 'INVALID_PROPOSAL');
      temporary.add(operation.tempId);
      fields(operation.node, ['kind', 'title', 'description', 'origin', 'knowledgeStatus', 'sourceIds'], 'AI node');
      if (operation.node.origin !== undefined && operation.node.origin !== 'ai') fail('AI 不能伪造来源', 'INVALID_PROPOSAL');
      if (operation.node.knowledgeStatus !== undefined && operation.node.knowledgeStatus !== 'unverified') fail('AI 节点必须为 unverified', 'INVALID_PROPOSAL');
      referenceSources(operation.node.sourceIds, new Map((graph.sources || []).map(source => [source.id, source])), 'AI node');
      // origin/status are injected by applyOperations and never treated as model authority.
      delete operation.node.origin;
      operation.node.knowledgeStatus = 'unverified';
      operation.node.sourceIds = clone(operation.node.sourceIds ?? []);
    }
  }
  function accessible(nodeId) {
    id(nodeId, 'nodeId');
    if (temporary.has(nodeId)) return;
    const node = existing.get(nodeId);
    if (!node || node.private) fail('AI 草案引用未知或未授权的私密节点', 'INVALID_PROPOSAL');
  }
  const allRequirementIds = new Map(graph.edges.flatMap(edge => edge.requirements.map(requirement => [requirement.id, edge.id])));
  for (const operation of normalized) {
    if (operation.op === 'add_edge') {
      accessible(operation.fromId);
      accessible(operation.toId);
    } else if (operation.op === 'update_node') {
      accessible(operation.nodeId);
      fields(operation.patch, ['title', 'description'], 'AI patch');
    } else if (operation.op === 'annotate_edge') {
      const edge = graph.edges.find(item => item.id === operation.edgeId);
      if (!edge) fail('AI 草案引用未知边', 'INVALID_PROPOSAL');
      accessible(edge.from);
      accessible(edge.to);
      list(operation.requirements, 'requirements', 20);
      for (const requirement of operation.requirements) {
        fields(requirement, requirementFields, 'AI requirement');
        if (requirement.id !== undefined && allRequirementIds.has(requirement.id) && allRequirementIds.get(requirement.id) !== edge.id) fail('AI 条件 ID 不属于此边', 'INVALID_PROPOSAL');
        if (requirement.knowledgeStatus !== undefined && requirement.knowledgeStatus !== 'unverified') fail('AI 条件必须为 unverified', 'INVALID_PROPOSAL');
        referenceSources(requirement.sourceIds, new Map((graph.sources || []).map(source => [source.id, source])), 'AI requirement');
        if (requirement.assessment !== undefined && !['unknown', 'missing'].includes(requirement.assessment)) fail('AI 不能认定用户已经具备能力', 'INVALID_PROPOSAL');
        if (requirement.evidenceNote?.trim()) fail('AI 不能编造个人能力证据', 'INVALID_PROPOSAL');
        requirement.knowledgeStatus = 'unverified';
        requirement.sourceIds = clone(requirement.sourceIds ?? []);
      }
    }
  }
  applyOperations(graph, normalized, expectedRevision, { origin: 'ai' });
  return normalized;
}

/** Enumerate bounded, simple root-to-target progression paths without cycling. */
export function pathsTo(graph, nodeId, { maxPaths = 8, maxDepth = 64 } = {}) {
  if (!Number.isSafeInteger(maxPaths) || maxPaths < 1 || maxPaths > 100 || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 300) fail('路径遍历上限无效');
  if (!graph.nodes.some(node => node.id === nodeId)) return [];
  const incoming = new Map(graph.nodes.map(node => [node.id, []]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) if (advancing.has(edge.relation)) {
    incoming.get(edge.to)?.push(edge);
    outgoing.get(edge.from)?.push(edge.to);
  }
  // Prune detached components before enumerating: a large DAG may contain
  // exponentially many local paths but no path from this graph's root.
  const reachable = new Set();
  const queue = [graph.rootNodeId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  if (!reachable.has(nodeId)) return [];
  const result = [];
  let visits = 0;
  function visit(currentId, nodeIds, edgeIds, seen) {
    if (++visits > 20000 || result.length >= maxPaths || nodeIds.length > maxDepth) return;
    if (currentId === graph.rootNodeId) { result.push({ nodeIds: [...nodeIds].reverse(), edgeIds: [...edgeIds].reverse() }); return; }
    for (const edge of incoming.get(currentId) ?? []) {
      if (seen.has(edge.from) || !reachable.has(edge.from)) continue;
      visit(edge.from, [...nodeIds, edge.from], [...edgeIds, edge.id], new Set([...seen, edge.from]));
      if (result.length >= maxPaths) break;
    }
  }
  visit(nodeId, [nodeId], [], new Set([nodeId]));
  return result;
}

/** A collapsed parent hides a descendant only when no other visible parent reaches it. */
export function visibleGraph(graph, collapsedIds = []) {
  const collapsed = new Set(collapsedIds);
  const incoming = new Set();
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    if (!advancing.has(edge.relation)) continue;
    incoming.add(edge.to);
    outgoing.get(edge.from)?.push(edge.to);
  }
  // Detached nodes remain editable after removing one of their ancestors.
  const queue = graph.nodes.filter(node => node.id === graph.rootNodeId || !incoming.has(node.id)).map(node => node.id);
  const visible = new Set();
  for (let index = 0; index < queue.length; index++) {
    const nodeId = queue[index];
    if (visible.has(nodeId)) continue;
    visible.add(nodeId);
    if (!collapsed.has(nodeId)) queue.push(...(outgoing.get(nodeId) ?? []));
  }
  return {
    nodes: graph.nodes.filter(node => visible.has(node.id)),
    edges: graph.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to) && !(collapsed.has(edge.from) && advancing.has(edge.relation))),
  };
}
