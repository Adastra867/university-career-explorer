/** Local, graph-scoped AI history. One atomic key; deliberately no deleted-text backup. */
export const AI_STORAGE_KEY = 'shiyu-zuxia.ai.v1';
export const TURN_STATUSES = Object.freeze(['queued', 'generating', 'completed', 'cancelled', 'failed', 'unconfigured']);
const terminal = new Set(['completed', 'cancelled', 'failed', 'unconfigured']);
const scopes = ['node', 'path', 'multi_node', 'graph'];
const clone = value => structuredClone(value);
const newId = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const after = previous => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
const empty = () => ({ schemaVersion: 1, turns: [], narratives: [] });
const bindingFields = ['graphId', 'rootNodeId', 'threadId', 'clientRequestId', 'question', 'model', 'focusNodeIds', 'pathNodeIds', 'focusedPathEdgeIds', 'savedPathId', 'scope', 'graphRevisionAtAsk', 'pathSnapshotLabel', 'contextKey'];
const turnFields = [...bindingFields, 'turnId', 'answer', 'status', 'errorCode', 'errorMessage', 'citations', 'createdAt', 'updatedAt', 'completedAt'];
const draftFields = ['savedPathId', 'title', 'currentState', 'destination', 'motivation', 'requiredPreparation', 'risksAndUnknowns', 'nextActions', 'sourceTurnIds', 'graphRevision', 'status'];

function invalid(message, code = 'AI_DATA_INVALID') { throw Object.assign(new Error(message), { code }); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 必须是对象`); }
function fields(value, allowed, label) { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label} 包含不支持的字段 ${key}`); }
function text(value, label, max = 160, allowEmpty = false) { if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalid(`${label} 需要${max}字以内的${allowEmpty ? '' : '非空'}文本`); }
function array(value, label, max) { if (!Array.isArray(value) || value.length > max) invalid(`${label} 必须是最多${max}项的数组，历史不会自动裁剪`); }
function ids(value, label, max = 300) { array(value, label, max); value.forEach(id => text(id, label)); if (new Set(value).size !== value.length) invalid(`${label} 包含重复ID`); }
function date(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid(`${label} 必须是ISO时间`); }
function revision(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} 必须是非负版本号`); }
function url(value, label) {
  if (value === '') return;
  text(value, label, 2048);
  let parsed;
  try { parsed = new URL(value); } catch { invalid(`${label} 不是网页地址`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid(`${label} 必须是安全的HTTP(S)地址`);
}
function strings(value, label, max = 20) { array(value, label, max); value.forEach(item => text(item, label, 2000)); }
function citation(value) {
  fields(value, ['sourceId', 'title', 'url', 'checkedAt', 'relevantExcerpt', 'publisher', 'publishedAt', 'trustLevel', 'locator', 'stale', 'verificationStatus'], 'citation');
  text(value.sourceId, 'citation.sourceId'); text(value.title, 'citation.title', 300);
  if (value.url !== undefined) url(value.url, 'citation.url');
  if (value.checkedAt !== undefined) date(value.checkedAt, 'citation.checkedAt');
  for (const field of ['publisher', 'publishedAt', 'trustLevel', 'verificationStatus']) if (value[field] !== undefined) text(value[field], `citation.${field}`, 300, true);
  if (value.locator !== undefined) text(value.locator, 'citation.locator', 1000, true);
  if (value.relevantExcerpt !== undefined) text(value.relevantExcerpt, 'citation.relevantExcerpt', 6000, true);
  if (value.stale !== undefined && typeof value.stale !== 'boolean') invalid('citation.stale 必须是布尔值');
}
function validateTurn(turn) {
  fields(turn, turnFields, 'turn');
  for (const field of ['turnId', 'graphId', 'rootNodeId', 'threadId', 'clientRequestId']) text(turn[field], field);
  text(turn.question, 'question', 12000);
  if (!TURN_STATUSES.includes(turn.status)) invalid('问答状态不受支持');
  if (!scopes.includes(turn.scope)) invalid('问答关联范围不受支持');
  ids(turn.focusNodeIds, 'focusNodeIds');
  ids(turn.pathNodeIds, 'pathNodeIds');
  ids(turn.focusedPathEdgeIds, 'focusedPathEdgeIds', 600);
  if (turn.scope === 'node' && turn.focusNodeIds.length !== 1) invalid('节点问答须绑定一个明确节点');
  if (turn.scope === 'multi_node' && turn.focusNodeIds.length < 2) invalid('多节点问答须绑定至少两个节点');
  if (turn.scope === 'path' && !turn.pathNodeIds.length) invalid('路径问答须保存当时的路径节点');
  revision(turn.graphRevisionAtAsk, 'graphRevisionAtAsk');
  if (turn.savedPathId !== undefined) text(turn.savedPathId, 'savedPathId');
  if (turn.pathSnapshotLabel !== undefined) text(turn.pathSnapshotLabel, 'pathSnapshotLabel', 2000, true);
  if (turn.contextKey !== undefined) text(turn.contextKey, 'contextKey', 12000, true);
  if (turn.model !== undefined) text(turn.model, 'model', 120, true);
  if (turn.answer !== undefined) text(turn.answer, 'answer', 60000, true);
  if (turn.errorCode !== undefined) text(turn.errorCode, 'errorCode', 80);
  if (turn.errorMessage !== undefined) text(turn.errorMessage, 'errorMessage', 2000, true);
  if (turn.citations !== undefined) { array(turn.citations, 'citations', 30); turn.citations.forEach(citation); }
  date(turn.createdAt, 'createdAt'); date(turn.updatedAt, 'updatedAt');
  if (turn.completedAt !== undefined) date(turn.completedAt, 'completedAt');
  if (terminal.has(turn.status) && !turn.completedAt) invalid('终止的问答必须记录完成时间');
  if (!terminal.has(turn.status) && turn.completedAt !== undefined) invalid('生成中的问答不能有完成时间');
}
function validateDraft(draft) {
  fields(draft, draftFields, '路线介绍');
  text(draft.savedPathId, 'savedPathId'); text(draft.title, 'title', 120);
  text(draft.currentState, 'currentState', 4000, true); text(draft.destination, 'destination', 4000, true);
  strings(draft.motivation, 'motivation', 12); strings(draft.risksAndUnknowns, 'risksAndUnknowns'); strings(draft.nextActions, 'nextActions');
  ids(draft.sourceTurnIds, 'sourceTurnIds', 1000);
  revision(draft.graphRevision, 'graphRevision');
  if (!['draft', 'confirmed', 'stale'].includes(draft.status)) invalid('路线介绍状态不受支持');
  array(draft.requiredPreparation, 'requiredPreparation', 30);
  for (const preparation of draft.requiredPreparation) {
    fields(preparation, ['item', 'evidenceStatus', 'supportingTurnIds', 'sourceIds'], 'preparation');
    text(preparation.item, 'preparation.item', 2000);
    if (!['user_plan', 'sourced_fact', 'needs_verification'].includes(preparation.evidenceStatus)) invalid('准备条件证据状态不受支持');
    ids(preparation.supportingTurnIds, 'supportingTurnIds', 1000);
    if (preparation.sourceIds !== undefined) ids(preparation.sourceIds, 'sourceIds', 20);
    if (preparation.evidenceStatus === 'sourced_fact' && !preparation.sourceIds?.length) invalid('有来源事实必须引用实际资料');
  }
}
function validateVersion(version, record, turns) {
  fields(version, ['content', 'model', 'inputTurnIds', 'sourceTurnIds', 'basedOnGraphRevision', 'pathStamp', 'qaStamp', 'turnStamps', 'createdAt'], 'narrative version');
  validateDraft(version.content);
  if (version.content.savedPathId !== record.savedPathId) invalid('介绍关联路线不一致');
  revision(version.basedOnGraphRevision, 'basedOnGraphRevision');
  if (version.content.graphRevision !== version.basedOnGraphRevision) invalid('介绍版本不一致');
  if (version.model !== undefined) text(version.model, 'model', 120, true);
  text(version.pathStamp, 'pathStamp', 2000000, true); text(version.qaStamp, 'qaStamp', 200000, true);
  date(version.createdAt, 'version.createdAt');
  ids(version.inputTurnIds, 'inputTurnIds', 1000); ids(version.sourceTurnIds, 'sourceTurnIds', 1000);
  for (const turnId of version.inputTurnIds) if (turns.get(turnId)?.graphId !== record.graphId) invalid('介绍输入问答不存在或属于其他图');
  const cited = [...version.sourceTurnIds, ...version.content.sourceTurnIds, ...version.content.requiredPreparation.flatMap(item => item.supportingTurnIds)];
  if (cited.some(turnId => !version.inputTurnIds.includes(turnId))) invalid('介绍引用了未输入的问答');
  if (JSON.stringify(version.sourceTurnIds) !== JSON.stringify(version.content.sourceTurnIds)) invalid('介绍出处记录不一致');
  array(version.turnStamps, 'turnStamps', 1000);
  const stamped = new Set();
  for (const stamp of version.turnStamps) {
    fields(stamp, ['turnId', 'updatedAt'], 'turn stamp'); text(stamp.turnId, 'stamp.turnId'); date(stamp.updatedAt, 'stamp.updatedAt');
    if (stamped.has(stamp.turnId) || !version.inputTurnIds.includes(stamp.turnId)) invalid('问答版本戳重复或越权');
    stamped.add(stamp.turnId);
  }
  if (stamped.size !== version.inputTurnIds.length) invalid('介绍缺少输入问答版本戳');
}

/** Validate a portable export, rejecting unknown fields and dangling derived text. */
export function validateAIData(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : clone(raw); } catch { invalid('AI历史JSON无法解析'); }
  fields(data, ['schemaVersion', 'turns', 'narratives'], 'AI历史');
  if (data.schemaVersion !== 1) invalid('不支持的AI历史版本');
  array(data.turns, 'turns', 1000); array(data.narratives, 'narratives', 30);
  const turnMap = new Map(); const requests = new Set(); const roots = new Map(); const recordIds = new Set();
  for (const turn of data.turns) {
    validateTurn(turn);
    if (turnMap.has(turn.turnId)) invalid('问答ID重复');
    const requestKey = JSON.stringify([turn.graphId, turn.clientRequestId]);
    if (requests.has(requestKey)) invalid('同图clientRequestId重复');
    requests.add(requestKey); turnMap.set(turn.turnId, turn); recordIds.add(turn.turnId);
    if (roots.has(turn.graphId) && roots.get(turn.graphId) !== turn.rootNodeId) invalid('同图根节点绑定不一致');
    roots.set(turn.graphId, turn.rootNodeId);
  }
  const paths = new Set();
  for (const record of data.narratives) {
    fields(record, ['narrativeId', 'graphId', 'rootNodeId', 'savedPathId', 'draft', 'confirmed', 'userEdited', 'createdAt', 'updatedAt'], 'narrative');
    for (const field of ['narrativeId', 'graphId', 'rootNodeId', 'savedPathId']) text(record[field], field);
    if (recordIds.has(record.narrativeId)) invalid('路线介绍ID重复');
    recordIds.add(record.narrativeId);
    const key = JSON.stringify([record.graphId, record.savedPathId]);
    if (paths.has(key)) invalid('同图路线介绍重复');
    paths.add(key);
    if (roots.has(record.graphId) && roots.get(record.graphId) !== record.rootNodeId) invalid('路线介绍根节点绑定不一致');
    roots.set(record.graphId, record.rootNodeId);
    date(record.createdAt, 'narrative.createdAt'); date(record.updatedAt, 'narrative.updatedAt');
    if (!record.draft && !record.confirmed && !record.userEdited) invalid('空路线介绍不应保存');
    for (const field of ['draft', 'confirmed', 'userEdited']) {
      if (record[field] !== null) validateVersion(record[field], record, turnMap);
    }
  }
  return data;
}

function pathNodes(graph, pathId) {
  const path = graph.savedPaths.find(item => item.id === pathId);
  if (!path) return [];
  const edges = path.edgeIds.map(id => graph.edges.find(edge => edge.id === id));
  if (!edges.length || edges.some(edge => !edge)) return [];
  return [edges[0].from, ...edges.map(edge => edge.to)];
}
function archived(turn, graph) { const nodes = new Set(graph.nodes.map(node => node.id)); return turn.focusNodeIds.some(id => !nodes.has(id)); }
function pathRelated(turn, graph, pathId) {
  if (turn.graphId !== graph.graphId || archived(turn, graph) || turn.scope === 'graph') return false;
  if (turn.savedPathId === pathId) return true;
  const nodes = new Set(pathNodes(graph, pathId));
  if (!nodes.size) return false;
  if (turn.scope === 'node') return turn.focusNodeIds.some(id => nodes.has(id));
  if (turn.scope === 'multi_node') return turn.focusNodeIds.length > 0 && turn.focusNodeIds.every(id => nodes.has(id));
  const path = graph.savedPaths.find(item => item.id === pathId);
  const chain = turn.focusedPathEdgeIds;
  if (!chain.length) return turn.pathNodeIds.length > 0 && turn.pathNodeIds.every(id => nodes.has(id));
  const start = path.edgeIds.indexOf(chain[0]);
  return start !== -1 && chain.every((id, index) => path.edgeIds[start + index] === id);
}
// Cache invalidation only, never an authorization token. Store a stamp instead
// of duplicating private graph descriptions or uncited QA IDs in AI history.
function fingerprint(value) {
  const serialized = JSON.stringify(value);
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < serialized.length; index++) {
    first = Math.imul(first ^ serialized.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ serialized.charCodeAt(index);
  }
  return `${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${serialized.length}`;
}
function pathStamp(graph, pathId) {
  const path = graph.savedPaths.find(item => item.id === pathId);
  if (!path) return '';
  const nodeIds = new Set(pathNodes(graph, pathId));
  const edges = path.edgeIds.map(id => graph.edges.find(edge => edge.id === id));
  const nodes = graph.nodes.filter(node => nodeIds.has(node.id)).map(({ id, kind, title, description, phase, knowledgeStatus, private: privacy, sourceIds, attributes }) => ({ id, kind, title, description, phase, knowledgeStatus, private: privacy, sourceIds, attributes }));
  // A narrative can cite research independently of graph node/edge citations.
  // Conservatively invalidate for any cached source change; only its fingerprint
  // is stored, so unrelated private documents are never copied into this key.
  return fingerprint({ path: { id: path.id, title: path.title, edgeIds: path.edgeIds, note: path.note }, nodes, edges, sources: graph.sources || [] });
}
function ordered(turns, descending = true) { return [...turns].sort((a, b) => (descending ? -1 : 1) * (a.createdAt.localeCompare(b.createdAt) || a.turnId.localeCompare(b.turnId))); }
function comparableNarrative(record) {
  const copy = clone(record);
  for (const key of ['draft', 'confirmed', 'userEdited']) if (copy[key]) copy[key].pathStamp = copy[key].pathStamp.replace(/^(?:imported:)+/, '');
  return copy;
}

export class AIStore {
  constructor(storage, onStatus = () => {}) {
    this.storage = storage; this.onStatus = onStatus; this.data = empty(); this.serial = null; this.blocked = false;
    this.reload();
  }
  _decode(raw) {
    if (raw === null) return null;
    let envelope;
    try { envelope = JSON.parse(raw); } catch { invalid('AI历史损坏，原文保留；请导出备份后恢复'); }
    fields(envelope, ['storageVersion', 'serial', 'data'], 'AI存储');
    if (envelope.storageVersion !== 1) invalid('不支持的AI存储版本');
    text(envelope.serial, 'serial');
    envelope.data = validateAIData(envelope.data);
    return envelope;
  }
  _error(error) {
    if (!error.code) error.code = error.name === 'QuotaExceededError' ? 'AI_STORAGE_QUOTA' : 'AI_STORAGE_UNAVAILABLE';
    this.onStatus('error', `${error.message || 'AI历史保存失败'}；原历史未覆盖，请导出当前副本。`);
    return error;
  }
  _fresh() {
    if (this.blocked) invalid('AI历史有冲突或无法读取，请先导出副本或重新读取', 'AI_STORAGE_BLOCKED');
    let current;
    try { current = this._decode(this.storage.getItem(AI_STORAGE_KEY)); } catch (error) { this.blocked = true; throw error; }
    if ((current?.serial ?? null) !== this.serial) { this.blocked = true; invalid('另一页已更新AI历史，当前内容未覆盖它', 'AI_STORAGE_CONFLICT'); }
  }
  _transaction(change) {
    try {
      this._fresh();
      const next = clone(this.data);
      const result = change(next);
      const validated = validateAIData(next);
      if (JSON.stringify(validated) !== JSON.stringify(this.data)) {
        const serial = newId('serial');
        this.storage.setItem(AI_STORAGE_KEY, JSON.stringify({ storageVersion: 1, serial, data: validated }));
        this.data = validated; this.serial = serial;
      }
      this.onStatus('saved', 'AI问答已保存在当前浏览器');
      return clone(result);
    } catch (error) { throw this._error(error); }
  }
  reload({ interruptPending = true } = {}) {
    try {
      const current = this._decode(this.storage.getItem(AI_STORAGE_KEY));
      this.data = current?.data ?? empty(); this.serial = current?.serial ?? null; this.blocked = false;
      if (interruptPending && this.data.turns.some(turn => ['queued', 'generating'].includes(turn.status))) {
        const interrupted = clone(this.data);
        for (const turn of interrupted.turns) if (['queued', 'generating'].includes(turn.status)) Object.assign(turn, { status: 'failed', errorCode: 'interrupted', errorMessage: '页面重新载入，先前请求已中断；问题和部分回答保留，可重新询问。', updatedAt: now(), completedAt: now() });
        try { this._transaction(next => { next.turns = interrupted.turns; return true; }); }
        catch { this.data = interrupted; this.blocked = true; return false; }
      }
      return true;
    } catch (error) { this.blocked = true; this._error(error); return false; }
  }
  createTurn(binding) {
    fields(binding, bindingFields, '问答绑定');
    return this._transaction(data => {
      const existing = data.turns.find(turn => turn.graphId === binding.graphId && turn.clientRequestId === binding.clientRequestId);
      const normalized = { ...clone(binding), focusNodeIds: clone(binding.focusNodeIds || []), pathNodeIds: clone(binding.pathNodeIds || []), focusedPathEdgeIds: clone(binding.focusedPathEdgeIds || []) };
      if (existing) {
        const original = Object.fromEntries(Object.keys(normalized).map(key => [key, existing[key]]));
        if (JSON.stringify(original) !== JSON.stringify(normalized)) invalid('同一请求ID的提问或焦点不同，请生成新的请求ID', 'AI_IDEMPOTENCY_CONFLICT');
        return existing;
      }
      if (data.turns.length >= 1000) invalid('本机已保存1000条问答；请导出或删除记录后继续，历史不会自动裁剪', 'AI_HISTORY_LIMIT');
      const timestamp = now();
      const turn = { ...normalized, turnId: newId('turn'), threadId: normalized.threadId ?? newId('thread'), status: 'queued', createdAt: timestamp, updatedAt: timestamp };
      data.turns.push(turn);
      return turn;
    });
  }
  updateTurn(turnId, patch, graphId) {
    fields(patch, ['status', 'answer', 'model', 'errorCode', 'errorMessage', 'citations', 'completedAt'], '问答更新');
    return this._transaction(data => {
      const turn = data.turns.find(item => item.turnId === turnId && (graphId === undefined || item.graphId === graphId));
      if (!turn) invalid('问答不存在或不属于当前图', 'AI_TURN_NOT_FOUND');
      const status = patch.status ?? turn.status;
      if (terminal.has(turn.status) && status !== turn.status) invalid('已结束的问答不可重写请求状态，请重新询问', 'AI_TURN_FINISHED');
      if (terminal.has(turn.status)) {
        if (Object.keys(patch).some(key => JSON.stringify(turn[key]) !== JSON.stringify(patch[key]))) invalid('已结束的问答原文不可覆盖，请重新询问', 'AI_TURN_FINISHED');
        return turn;
      }
      Object.assign(turn, clone(patch), { updatedAt: after(turn.updatedAt) });
      if (terminal.has(status)) turn.completedAt = patch.completedAt ?? turn.completedAt ?? turn.updatedAt;
      return turn;
    });
  }
  getTurn(id, graphId) { const turn = this.data.turns.find(item => item.turnId === id && (graphId === undefined || item.graphId === graphId)); return turn ? clone(turn) : null; }
  history(graph, { nodeId, pathId, offset = 0, limit = 20, includeArchived = false, archivedOnly = false } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) invalid('历史分页参数无效');
    if (nodeId !== undefined && !graph.nodes.some(node => node.id === nodeId)) return { items: [], total: 0 };
    const items = [];
    for (const turn of ordered(this.data.turns.filter(item => item.graphId === graph.graphId))) {
      const isArchived = archived(turn, graph);
      if (archivedOnly ? !isArchived : isArchived && !includeArchived) continue;
      let linkKind = isArchived ? 'archived' : turn.scope === 'graph' ? 'graph' : 'direct';
      if (nodeId !== undefined) {
        if (turn.scope === 'graph' && nodeId === graph.rootNodeId) linkKind = 'graph';
        else if (turn.focusNodeIds.includes(nodeId)) linkKind = isArchived ? 'archived' : 'direct';
        else if (turn.pathNodeIds.includes(nodeId)) linkKind = isArchived ? 'archived' : 'path';
        else continue;
      }
      if (pathId !== undefined) {
        if (!pathRelated(turn, graph, pathId)) continue;
        linkKind = turn.savedPathId === pathId ? 'direct' : 'path';
      }
      items.push({ turn: clone(turn), linkKind });
    }
    return { items: items.slice(offset, offset + limit), total: items.length };
  }
  relatedTurns(graph, pathId) { return ordered(this.data.turns.filter(turn => pathRelated(turn, graph, pathId)), false).map(clone); }
  threadTurns(graph, threadId) { return ordered(this.data.turns.filter(turn => turn.graphId === graph.graphId && turn.threadId === threadId), false).map(clone); }
  deleteTurn(id, graphId) {
    return this._transaction(data => {
      const turn = data.turns.find(item => item.turnId === id && (graphId === undefined || item.graphId === graphId));
      if (!turn) invalid('问答不存在或不属于当前图', 'AI_TURN_NOT_FOUND');
      data.turns = data.turns.filter(item => item.turnId !== id);
      // Delete all variants, including user edits, if any one version ever read this turn.
      data.narratives = data.narratives.filter(record => !['draft', 'confirmed', 'userEdited'].some(key => record[key]?.inputTurnIds.includes(id)));
      return true;
    });
  }
  _qaStamp(graph, pathId, data = this.data) { return fingerprint(ordered(data.turns.filter(turn => pathRelated(turn, graph, pathId)), false).map(turn => [turn.turnId, turn.updatedAt])); }
  _stale(version, graph, pathId, draft = false) {
    return !version || (draft && version.basedOnGraphRevision !== graph.revision) || version.pathStamp !== pathStamp(graph, pathId) || version.qaStamp !== this._qaStamp(graph, pathId) || version.turnStamps.some(stamp => this.data.turns.find(turn => turn.turnId === stamp.turnId)?.updatedAt !== stamp.updatedAt);
  }
  setDraft(graph, pathId, draft, { model, inputTurnIds = draft?.sourceTurnIds || [], expectedGraphRevision = draft?.graphRevision } = {}) {
    validateDraft(draft);
    if (draft.savedPathId !== pathId || !graph.savedPaths.some(path => path.id === pathId)) invalid('路线不存在或草稿绑定错误');
    if (expectedGraphRevision !== graph.revision || draft.graphRevision !== graph.revision) invalid('路线已更新，旧草稿未接受，请重新整理', 'AI_NARRATIVE_STALE');
    ids(inputTurnIds, 'inputTurnIds', 1000);
    this._transaction(data => {
      let record = data.narratives.find(item => item.graphId === graph.graphId && item.savedPathId === pathId);
      const timestamp = now();
      if (!record) {
        if (data.narratives.length >= 30) invalid('本机路线介绍已达30条，请导出或删除后继续；不会自动裁剪', 'AI_NARRATIVE_LIMIT');
        record = { narrativeId: newId('narrative'), graphId: graph.graphId, rootNodeId: graph.rootNodeId, savedPathId: pathId, draft: null, confirmed: null, userEdited: null, createdAt: timestamp, updatedAt: timestamp };
        data.narratives.push(record);
      }
      record.draft = { content: { ...clone(draft), status: 'draft' }, ...(model === undefined ? {} : { model }), inputTurnIds: clone(inputTurnIds), sourceTurnIds: clone(draft.sourceTurnIds), basedOnGraphRevision: graph.revision, pathStamp: pathStamp(graph, pathId), qaStamp: this._qaStamp(graph, pathId, data), turnStamps: inputTurnIds.map(turnId => ({ turnId, updatedAt: data.turns.find(turn => turn.turnId === turnId)?.updatedAt })), createdAt: timestamp };
      record.updatedAt = timestamp;
      return true;
    });
    return this.narrative(graph, pathId);
  }
  confirmDraft(graph, pathId, editedDraft) {
    this._transaction(data => {
      const record = data.narratives.find(item => item.graphId === graph.graphId && item.savedPathId === pathId);
      if (!record?.draft || this._stale(record.draft, graph, pathId, true)) invalid('草稿已过期，请重新整理后确认', 'AI_NARRATIVE_STALE');
      record.confirmed = clone(record.draft); record.confirmed.content.status = 'confirmed';
      if (editedDraft !== undefined) {
        validateDraft(editedDraft);
        if (editedDraft.savedPathId !== pathId || editedDraft.graphRevision !== graph.revision) invalid('编辑后的介绍绑定或版本错误');
        record.userEdited = { ...clone(record.draft), content: { ...clone(editedDraft), status: 'confirmed' }, sourceTurnIds: clone(editedDraft.sourceTurnIds) };
      } else record.userEdited = null;
      record.updatedAt = now();
      return true;
    });
    return this.narrative(graph, pathId);
  }
  editNarrative(graph, pathId, editedSummary) {
    validateDraft(editedSummary);
    this._transaction(data => {
      const record = data.narratives.find(item => item.graphId === graph.graphId && item.savedPathId === pathId);
      const base = record?.userEdited || record?.confirmed;
      if (!base) invalid('请先确认路线介绍，再保存独立的用户修改');
      if (editedSummary.savedPathId !== pathId || editedSummary.graphRevision !== base.basedOnGraphRevision) invalid('编辑后的介绍绑定或原始版本错误');
      record.userEdited = { ...clone(base), content: { ...clone(editedSummary), status: 'confirmed' }, sourceTurnIds: clone(editedSummary.sourceTurnIds) };
      record.updatedAt = now();
      return true;
    });
    return this.narrative(graph, pathId);
  }
  discardDraft(graph, pathId) {
    return this._transaction(data => {
      const record = data.narratives.find(item => item.graphId === graph.graphId && item.savedPathId === pathId);
      if (!record) return true;
      record.draft = null; record.updatedAt = now();
      if (!record.confirmed && !record.userEdited) data.narratives = data.narratives.filter(item => item !== record);
      return true;
    });
  }
  narrative(graph, pathId) {
    const record = this.data.narratives.find(item => item.graphId === graph.graphId && item.savedPathId === pathId);
    if (!record) return null;
    const statusOf = (version, draft) => !version ? null : this._stale(version, graph, pathId, draft) ? 'stale' : draft ? 'draft' : 'confirmed';
    const draftStatus = statusOf(record.draft, true); const confirmedStatus = statusOf(record.confirmed, false); const userEditedStatus = statusOf(record.userEdited, false);
    const version = record.userEdited || record.confirmed || record.draft;
    const status = userEditedStatus || confirmedStatus || draftStatus;
    return clone({ narrativeId: record.narrativeId, graphId: record.graphId, rootNodeId: record.rootNodeId, savedPathId: pathId, draft: record.draft?.content || null, confirmed: record.confirmed?.content || null, userEdited: record.userEdited?.content || null, status, stale: status === 'stale', draftStatus, confirmedStatus, userEditedStatus, model: version.model, updatedAt: record.updatedAt, basedOnGraphRevision: version.basedOnGraphRevision, inputTurnIds: version.inputTurnIds, sourceTurnIds: version.sourceTurnIds, turnStamps: version.turnStamps });
  }
  exportData(graphId) { return clone({ schemaVersion: 1, turns: this.data.turns.filter(turn => graphId === undefined || turn.graphId === graphId), narratives: this.data.narratives.filter(record => graphId === undefined || record.graphId === graphId) }); }
  exportArchive(graphId) { return this.exportData(graphId); }
  validateImport(raw, graph, options) {
    if (graph === undefined) return validateAIData(raw);
    this._fresh();
    const next = clone(this.data);
    this._mergeImport(next, raw, graph, options);
    return validateAIData(next);
  }
  migrateLegacyConversation(graph, messages) {
    array(messages, '旧会话', 2000);
    const plans = [];
    for (let index = 0; index < messages.length; index++) {
      const question = messages[index];
      object(question, '旧会话消息');
      if (question.role !== 'user') invalid('旧会话含无对应问题的答复；原文保留，请先导出备份', 'AI_LEGACY_INVALID');
      text(question.content, '旧问题', 12000);
      const answer = messages[index + 1]?.role === 'assistant' ? messages[index + 1] : null;
      if (answer) { object(answer, '旧答复'); text(answer.content, '旧答复', 60000, true); }
      const status = !answer || answer.error || answer.generating ? 'failed' : 'completed';
      const content = {
        question: question.content,
        ...(answer ? { answer: answer.content } : {}),
        status,
        ...(answer?.model ? { model: answer.model } : {}),
        citations: clone(answer?.citations || []),
        ...(status === 'failed' ? { errorCode: !answer ? 'LEGACY_UNANSWERED' : answer.generating ? 'LEGACY_INTERRUPTED' : 'LEGACY_FAILED', errorMessage: !answer ? '旧会话未保存答复，问题原文已保留。' : answer.generating ? '旧会话生成已中断，已保留部分答复。' : '旧会话记录显示生成失败，原文已保留。' } : {}),
      };
      plans.push({ index, knownTurnId: question.turnId, content, clientRequestId: `legacy_${index}_${fingerprint(content)}` });
      if (answer) index++;
    }
    return this._transaction(data => {
      for (const plan of plans) {
        const existing = data.turns.find(turn => turn.graphId === graph.graphId && turn.clientRequestId === plan.clientRequestId);
        if (existing) {
          const previous = Object.fromEntries(Object.keys(plan.content).map(key => [key, key === 'citations' ? existing.citations || [] : existing[key]]));
          if (JSON.stringify(previous) !== JSON.stringify(plan.content)) invalid('旧会话请求ID与已有原文冲突，未覆盖本机历史', 'AI_IMPORT_CONFLICT');
          continue;
        }
        if (plan.knownTurnId) {
          const known = data.turns.find(turn => turn.turnId === plan.knownTurnId && turn.graphId === graph.graphId);
          if (known) {
            if (known.question !== plan.content.question || (plan.content.answer !== undefined && known.answer !== plan.content.answer)) invalid('旧聊天副本与现有问答原文不同，请先导出副本，未自动覆盖', 'AI_IMPORT_CONFLICT');
            continue;
          }
        }
        const timestamp = now();
        data.turns.push({ ...clone(plan.content), turnId: newId('turn'), graphId: graph.graphId, rootNodeId: graph.rootNodeId, threadId: newId('thread'), clientRequestId: plan.clientRequestId, scope: 'graph', focusNodeIds: [graph.rootNodeId], pathNodeIds: [], focusedPathEdgeIds: [], graphRevisionAtAsk: graph.revision, pathSnapshotLabel: '旧会话导入（原节点归属未知）', contextKey: 'legacy-import-no-model-consent', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp });
      }
      return true;
    });
  }
  _mergeImport(data, raw, graph, { sourceGraphId, sourceRootId } = {}) {
    const imported = validateAIData(raw);
    const graphIds = [...new Set([...imported.turns, ...imported.narratives].map(item => item.graphId))];
    const fromGraph = sourceGraphId ?? (graphIds.length === 1 ? graphIds[0] : graph.graphId);
    if (graphIds.length && !graphIds.includes(fromGraph)) invalid('备份内没有指定图的AI历史');
    const selectedTurns = imported.turns.filter(turn => turn.graphId === fromGraph);
    const selectedNarratives = imported.narratives.filter(record => record.graphId === fromGraph);
    const fromRoot = sourceRootId ?? selectedTurns[0]?.rootNodeId ?? selectedNarratives[0]?.rootNodeId ?? graph.rootNodeId;
    if ([...selectedTurns, ...selectedNarratives].some(item => item.rootNodeId !== fromRoot)) invalid('导入AI历史的根节点不一致');
    const mapNode = id => id === fromRoot ? graph.rootNodeId : id;
      for (const incoming of selectedTurns) {
        const turn = clone(incoming);
        turn.graphId = graph.graphId; turn.rootNodeId = graph.rootNodeId;
        turn.focusNodeIds = turn.focusNodeIds.map(mapNode); turn.pathNodeIds = turn.pathNodeIds.map(mapNode);
        // Binding context is historical data; never restore model-send authorization.
        turn.contextKey = '';
        if (['queued', 'generating'].includes(turn.status)) Object.assign(turn, { status: 'failed', errorCode: 'interrupted', errorMessage: '导入的请求未继续发送，可重新询问。', updatedAt: now(), completedAt: now() });
        const sameId = data.turns.find(item => item.turnId === turn.turnId);
        const sameRequest = data.turns.find(item => item.graphId === turn.graphId && item.clientRequestId === turn.clientRequestId);
        if (sameId || sameRequest) {
          const previous = sameId || sameRequest;
          const comparable = clone(previous); comparable.contextKey = '';
          if (JSON.stringify(comparable) === JSON.stringify(turn)) continue;
          invalid('导入问答ID或请求ID与已有内容冲突，未覆盖本机历史', 'AI_IMPORT_CONFLICT');
        }
        data.turns.push(turn);
      }
      for (const incoming of selectedNarratives) {
        const record = clone(incoming); record.graphId = graph.graphId; record.rootNodeId = graph.rootNodeId;
        // A historical graph/root stamp is retained so imported summaries remain stale
        // until the user explicitly regenerates and confirms them in this graph.
        for (const key of ['draft', 'confirmed', 'userEdited']) if (record[key]) record[key].pathStamp = `imported:${record[key].pathStamp}`;
        const previous = data.narratives.find(item => item.narrativeId === record.narrativeId || item.graphId === record.graphId && item.savedPathId === record.savedPathId);
        if (previous) {
          if (JSON.stringify(comparableNarrative(previous)) === JSON.stringify(comparableNarrative(record))) continue;
          invalid('导入路线介绍与已有版本冲突，未覆盖本机简介', 'AI_IMPORT_CONFLICT');
        }
        data.narratives.push(record);
      }
      return true;
  }
  importData(raw, graph, options) { return this._transaction(data => this._mergeImport(data, raw, graph, options)); }
  deleteLocal(graphId) {
    if (graphId !== undefined) return this._transaction(data => {
      data.turns = data.turns.filter(turn => turn.graphId !== graphId); data.narratives = data.narratives.filter(record => record.graphId !== graphId); return true;
    });
    try { this._fresh(); this.storage.removeItem(AI_STORAGE_KEY); this.data = empty(); this.serial = null; this.onStatus('saved', '已删除本机AI问答与路线介绍'); return true; }
    catch (error) { throw this._error(error); }
  }
}
