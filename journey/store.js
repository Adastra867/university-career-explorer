import { createGraph, validateGraph, applyOperations } from './graph.js';

export const STORAGE_KEY = 'shiyu-zuxia.graph.v1';
export const BACKUP_KEY = `${STORAGE_KEY}.backup`;
const clone = value => structuredClone(value);
const snapshotId = () => `version_${crypto.randomUUID()}`;

function snapshotMetadata(snapshot) {
  return Object.freeze({ id: snapshot.id, title: snapshot.title, note: snapshot.note || '', createdAt: snapshot.createdAt, revision: snapshot.graph.revision, nodeCount: snapshot.graph.nodes.length, edgeCount: snapshot.graph.edges.length });
}
function sameTree(graph, other) {
  return graph.graphId === other.graphId && graph.rootNodeId === other.rootNodeId && graph.ownerId === other.ownerId;
}
function namedText(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label}需要${max}字以内的${allowEmpty ? '' : '非空'}文本`);
}
function importIntoCurrentTree(imported, current) {
  const graph = clone(imported);
  const identifiers = [
    ...graph.nodes.map(node => node.id), ...graph.edges.map(edge => edge.id),
    ...graph.edges.flatMap(edge => edge.requirements.map(requirement => requirement.id)),
    ...graph.savedPaths.map(path => path.id), ...(graph.sources || []).map(source => source.id),
    ...(graph.tasks || []).map(task => task.id), ...(graph.reflections || []).map(reflection => reflection.id),
  ];
  const mapping = new Map([[graph.rootNodeId, current.rootNodeId]]);
  if (graph.rootNodeId !== current.rootNodeId && identifiers.includes(current.rootNodeId)) mapping.set(current.rootNodeId, `import_${crypto.randomUUID()}`);
  const mapped = identifier => mapping.get(identifier) ?? identifier;
  for (const node of graph.nodes) { node.id = mapped(node.id); if (node.sourceIds) node.sourceIds = node.sourceIds.map(mapped); }
  for (const edge of graph.edges) {
    edge.id = mapped(edge.id); edge.from = mapped(edge.from); edge.to = mapped(edge.to);
    for (const requirement of edge.requirements) { requirement.id = mapped(requirement.id); if (requirement.sourceIds) requirement.sourceIds = requirement.sourceIds.map(mapped); }
  }
  for (const path of graph.savedPaths) { path.id = mapped(path.id); path.edgeIds = path.edgeIds.map(mapped); }
  for (const source of graph.sources || []) source.id = mapped(source.id);
  for (const task of graph.tasks || []) {
    task.id = mapped(task.id);
    if (task.edgeId !== undefined) task.edgeId = mapped(task.edgeId);
    if (task.requirementId !== undefined) task.requirementId = mapped(task.requirementId);
    if (task.sourceIds) task.sourceIds = task.sourceIds.map(mapped);
  }
  for (const reflection of graph.reflections || []) { reflection.id = mapped(reflection.id); if (reflection.nodeId !== undefined) reflection.nodeId = mapped(reflection.nodeId); }
  graph.graphId = current.graphId;
  graph.rootNodeId = current.rootNodeId;
  if (current.ownerId === undefined) delete graph.ownerId;
  else graph.ownerId = current.ownerId;
  graph.createdAt = current.createdAt;
  return graph;
}

function validateUi(ui) {
  if (ui === undefined) return;
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) throw new Error('草稿界面状态损坏');
  for (const field of ['selected', 'collapsed']) {
    if (ui[field] !== undefined && (!Array.isArray(ui[field]) || ui[field].length > 300 || ui[field].some(id => typeof id !== 'string'))) throw new Error('草稿节点选择状态损坏');
  }
  if (ui.entered !== undefined && typeof ui.entered !== 'boolean') throw new Error('草稿开幕状态损坏');
  if (ui.focused !== undefined && (typeof ui.focused !== 'string' || !ui.focused.trim() || ui.focused.length > 160)) throw new Error('草稿焦点状态损坏');
  if (ui.chat !== undefined) {
    if (!Array.isArray(ui.chat) || ui.chat.length > 80) throw new Error('草稿聊天记录超过80条或格式损坏');
    for (const message of ui.chat) {
      if (!message || typeof message !== 'object' || Array.isArray(message) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 20000 || JSON.stringify(message).length > 64000) throw new Error('草稿聊天消息格式损坏或过长');
    }
  }
}

// Local persistence is separate from every legacy assessment key.
export class GraphStore {
  constructor(storage, onStatus = () => {}) {
    this.storage = storage;
    this.onStatus = onStatus;
    this.graph = createGraph();
    this.undoStack = [];
    this.redoStack = [];
    this._snapshots = [];
    this.ui = { selected: [], collapsed: [], entered: false };
    this.serial = null;
    this.blocked = false;
    this.timer = null;
    this.restored = false;
    this.recovery = false;
    this.observedRaw = undefined;
    this.lastSaveCommitted = false;
    this.load();
  }
  decode(raw) {
    if (raw === null) return null;
    if (typeof raw !== 'string') throw new Error('草稿内容无法读取');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('草稿格式不受支持');
    validateGraph(data.graph);
    if (data.storageVersion !== 1 || typeof data.serial !== 'string' || !data.serial.trim() || data.serial.length > 160) throw new Error('草稿格式不受支持');
    for (const field of ['undo', 'redo']) {
      if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].length > 40)) throw new Error('草稿历史记录损坏');
      for (const snapshot of data[field] || []) {
        validateGraph(snapshot);
        if (!sameTree(snapshot, data.graph)) throw new Error('历史记录不属于当前人生树');
      }
    }
    if (data.snapshots !== undefined) {
      if (!Array.isArray(data.snapshots) || data.snapshots.length > 30) throw new Error('命名版本记录损坏或超过30份');
      const ids = new Set();
      for (const snapshot of data.snapshots) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).some(key => !['id', 'title', 'note', 'createdAt', 'graph'].includes(key))) throw new Error('命名版本格式损坏');
        namedText(snapshot.id, '版本ID', 160);
        if (ids.has(snapshot.id)) throw new Error('命名版本ID重复');
        ids.add(snapshot.id);
        namedText(snapshot.title, '版本名称', 120);
        if (snapshot.note !== undefined) namedText(snapshot.note, '版本备注', 2000, true);
        if (typeof snapshot.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(snapshot.createdAt) || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('版本时间损坏');
        validateGraph(snapshot.graph);
        if (!sameTree(snapshot.graph, data.graph)) throw new Error('命名版本不属于当前人生树');
      }
    }
    validateUi(data.ui);
    return data;
  }
  adopt(data) {
    this.graph = clone(data.graph);
    this.undoStack = clone((data.undo || []).slice(-40));
    this.redoStack = clone((data.redo || []).slice(-40));
    this._snapshots = clone(data.snapshots || []);
    const validIds = new Set(this.graph.nodes.map(node => node.id));
    this.ui = {
      selected: [...new Set(data.ui?.selected || [])].filter(id => validIds.has(id)),
      collapsed: [...new Set(data.ui?.collapsed || [])].filter(id => validIds.has(id)),
      entered: data.ui?.entered ?? true,
      ...(data.ui?.focused !== undefined ? { focused: validIds.has(data.ui.focused) ? data.ui.focused : this.graph.rootNodeId } : {}),
      ...(data.ui?.chat !== undefined ? { chat: clone(data.ui.chat) } : {}),
    };
    this.serial = data.serial;
    this.restored = true;
  }
  load() {
    try {
      this.observedRaw = this.storage.getItem(STORAGE_KEY);
      const data = this.decode(this.observedRaw);
      if (data) {
        this.adopt(data);
        this.blocked = false;
        this.recovery = false;
      } else {
        const backup = this.decode(this.storage.getItem(BACKUP_KEY));
        if (backup) {
          this.adopt(backup);
          this.blocked = true;
          this.recovery = true;
          this.onStatus('error', '原草稿缺失，已读取上一份有效备份；请确认采用。');
        }
      }
    } catch {
      this.blocked = true;
      try {
        const backup = this.decode(this.storage.getItem(BACKUP_KEY));
        if (backup) { this.adopt(backup); this.recovery = true; }
      } catch { /* Keep the original invalid data for manual recovery. */ }
      this.onStatus('error', this.recovery ? '原草稿损坏，已读取上一份有效备份；请确认采用。' : '本地草稿无法读取；原数据保留，可先导出当前副本。');
    }
  }
  commit(operations, expectedRevision = this.graph.revision, options) {
    const next = applyOperations(this.graph, operations, expectedRevision, options);
    if (next.revision === this.graph.revision) return this.graph;
    this.undoStack.push(clone(this.graph));
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.graph = next;
    this.ui.selected = this.ui.selected.filter(id => next.nodes.some(n => n.id === id));
    this.ui.collapsed = this.ui.collapsed.filter(id => next.nodes.some(n => n.id === id));
    this.schedule();
    return next;
  }
  undo() { return this.restoreSnapshot(this.undoStack, this.redoStack); }
  redo() { return this.restoreSnapshot(this.redoStack, this.undoStack); }
  restoreSnapshot(from, to) {
    if (!from.length) return false;
    const snapshot = clone(from.at(-1));
    snapshot.revision = this.graph.revision + 1;
    snapshot.updatedAt = new Date().toISOString();
    validateGraph(snapshot);
    to.push(clone(this.graph));
    if (to.length > 40) to.splice(0, to.length - 40);
    from.pop();
    this.graph = snapshot;
    this.ui.selected = this.ui.selected.filter(id => snapshot.nodes.some(n => n.id === id));
    this.ui.collapsed = this.ui.collapsed.filter(id => snapshot.nodes.some(n => n.id === id));
    this.schedule();
    return true;
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.blocked) {
      this.onStatus('error', this.recovery ? '已读取备份，尚未替换原草稿；请先确认采用或导出副本。' : '草稿有冲突或无法读取；当前编辑保留在内存，请先导出副本或读取另一页版本。');
      return;
    }
    this.onStatus('dirty', '尚未保存');
    this.timer = setTimeout(() => this.save(), 450);
  }
  save({ replace = false } = {}) {
    clearTimeout(this.timer);
    // A scoped adapter can successfully commit a session-memory version while
    // correctly reporting that durable browser storage is unavailable.
    this.lastSaveCommitted = false;
    try {
      if (this.blocked && !replace) throw new Error('草稿有冲突或待恢复；请先导出副本或读取另一页版本。');
      validateGraph(this.graph);
      const currentRaw = this.storage.getItem(STORAGE_KEY);
      let current;
      if (replace && this.recovery) {
        if (currentRaw !== this.observedRaw) {
          this.blocked = true;
          throw new Error('另一页已改变原草稿，未覆盖它；请先读取另一页版本。');
        }
      } else {
        try { current = this.decode(currentRaw); } catch (error) { this.blocked = true; throw error; }
        if ((current?.serial ?? null) !== this.serial) {
          this.blocked = true;
          throw new Error('另一页已保存更新或删除草稿，当前改动未覆盖它。请导出副本或读取另一页版本。');
        }
      }
      // Check the external serial before comparing content: an unchanged page
      // must not bypass a real conflict, nor create one just by closing a tab.
      const state = { graph: this.graph, undo: this.undoStack.slice(-40), redo: this.redoStack.slice(-40), ui: this.ui, snapshots: this._snapshots };
      if (current && JSON.stringify({ graph: current.graph, undo: current.undo || [], redo: current.redo || [], ui: current.ui, snapshots: current.snapshots || [] }) === JSON.stringify(state)) {
        this.lastSaveCommitted = true;
        if (this.storage.persistent === false) { this.onStatus('error', '仅暂存在本次页面内存，刷新会丢失；请导出 JSON 备份。'); return false; }
        this.onStatus('saved', '已保存在当前浏览器');
        return true;
      }
      const serial = crypto.randomUUID();
      const next = { storageVersion: 1, serial, ...state };
      // Validate before both writes. A failed primary write leaves the previous primary intact.
      const encoded = JSON.stringify(next);
      this.decode(encoded);
      let backupFailed = false;
      if (currentRaw) {
        try {
          this.decode(currentRaw);
          try { this.storage.setItem(BACKUP_KEY, currentRaw); } catch { backupFailed = true; }
        } catch { /* A corrupt primary must never replace the valid recovery backup. */ }
      }
      this.storage.setItem(STORAGE_KEY, encoded);
      this.lastSaveCommitted = true;
      this.serial = serial;
      this.observedRaw = encoded;
      this.blocked = false;
      this.recovery = false;
      if (this.storage.persistent === false) { this.onStatus('error', '仅暂存在本次页面内存，刷新会丢失；请导出 JSON 备份。'); return false; }
      this.onStatus('saved', backupFailed ? '当前版本已保存在当前浏览器；备份写入失败，请导出 JSON 副本。' : '已保存在当前浏览器');
      return true;
    } catch (error) {
      this.onStatus('error', `保存失败：${error.message || '浏览器存储不可用'}。可导出 JSON 备份。`);
      return false;
    }
  }
  reload() {
    clearTimeout(this.timer);
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const data = this.decode(raw);
      if (!data) throw new Error('没有可读取的草稿');
      this.adopt(data);
      this.observedRaw = raw;
      this.blocked = false;
      this.recovery = false;
      this.onStatus('saved', '已读取另一页保存的版本');
      return true;
    } catch (error) {
      this.blocked = true;
      this.onStatus('error', error.message);
      return false;
    }
  }
  get snapshots() { return Object.freeze(this._snapshots.map(snapshotMetadata)); }
  getSnapshot(id) {
    const snapshot = this._snapshots.find(item => item.id === id);
    return snapshot ? clone(snapshot) : null;
  }
  assertFresh(expectedRevision = this.graph.revision) {
    if (expectedRevision !== this.graph.revision || !Number.isSafeInteger(expectedRevision)) throw Object.assign(new Error('人生树已发生变化，请基于最新版本重试'), { code: 'REVISION_CONFLICT' });
    if (this.blocked) throw new Error('草稿有冲突或待恢复；请先导出副本或读取另一页版本。');
    let current;
    try { current = this.decode(this.storage.getItem(STORAGE_KEY)); } catch (error) { this.blocked = true; throw error; }
    if ((current?.serial ?? null) !== this.serial) {
      this.blocked = true;
      throw new Error('另一页已保存更新或删除草稿，未覆盖它；请先读取另一页版本。');
    }
  }
  snapshot(title, note = '') {
    clearTimeout(this.timer);
    try {
      this.assertFresh();
      namedText(title, '版本名称', 120);
      namedText(note, '版本备注', 2000, true);
      if (this._snapshots.length >= 30) throw new Error('本机最多保存30份命名版本；请导出完整备份后管理存储空间。');
      const snapshot = { id: snapshotId(), title, note, createdAt: new Date().toISOString(), graph: clone(this.graph) };
      this._snapshots.push(snapshot);
      if (!this.save() && !this.lastSaveCommitted) { this._snapshots.pop(); return null; }
      return snapshotMetadata(snapshot);
    } catch (error) {
      this.onStatus('error', `版本保存失败：${error.message}`);
      return null;
    }
  }
  replaceGraphTransaction(next, snapshots = this._snapshots) {
    validateGraph(next);
    const previous = { graph: this.graph, undo: this.undoStack, redo: this.redoStack, ui: this.ui, snapshots: this._snapshots };
    this.undoStack = [...this.undoStack, clone(this.graph)].slice(-40);
    this.redoStack = [];
    this.graph = next;
    this._snapshots = snapshots;
    const ids = new Set(next.nodes.map(node => node.id));
    this.ui = { ...this.ui, selected: this.ui.selected.filter(id => ids.has(id)), collapsed: this.ui.collapsed.filter(id => ids.has(id)), entered: true };
    if (this.save() || this.lastSaveCommitted) return true;
    this.graph = previous.graph; this.undoStack = previous.undo; this.redoStack = previous.redo; this.ui = previous.ui; this._snapshots = previous.snapshots;
    return false;
  }
  restoreSnapshotById(id, expectedRevision = this.graph.revision) {
    clearTimeout(this.timer);
    try {
      this.assertFresh(expectedRevision);
      const snapshot = this.getSnapshot(id);
      if (!snapshot) throw new Error('命名版本不存在');
      const graph = snapshot.graph;
      graph.revision = this.graph.revision + 1;
      graph.updatedAt = new Date().toISOString();
      return this.replaceGraphTransaction(graph);
    } catch (error) {
      this.onStatus('error', `版本恢复失败：${error.message}`);
      return false;
    }
  }
  // The UI must preview the validated file and obtain confirmation before calling.
  importGraph(document, expectedRevision = this.graph.revision) {
    clearTimeout(this.timer);
    try {
      this.assertFresh(expectedRevision);
      const parsed = typeof document === 'string' ? JSON.parse(document) : document;
      let imported = parsed;
      let snapshots = this._snapshots;
      if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'archiveVersion')) {
        if (parsed.archiveVersion !== 1 || Object.keys(parsed).some(key => !['archiveVersion', 'exportedAt', 'graph', 'snapshots'].includes(key))) throw new Error('不支持的完整备份版本');
        this.decode(JSON.stringify({ storageVersion: 1, serial: 'import-archive', graph: parsed.graph, snapshots: parsed.snapshots }));
        imported = parsed.graph;
        snapshots = [...this._snapshots];
        for (const incoming of parsed.snapshots || []) {
          const snapshot = { ...clone(incoming), graph: importIntoCurrentTree(incoming.graph, this.graph) };
          const previous = snapshots.find(item => item.id === snapshot.id);
          if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) continue;
          if (previous) snapshot.id = snapshotId();
          snapshots.push(snapshot);
        }
        if (snapshots.length > 30) throw new Error('导入后命名版本超过30份；未覆盖本机版本。');
      }
      validateGraph(imported);
      const graph = importIntoCurrentTree(imported, this.graph);
      graph.revision = this.graph.revision + 1;
      graph.updatedAt = new Date().toISOString();
      return this.replaceGraphTransaction(graph, snapshots);
    } catch (error) {
      this.onStatus('error', `导入失败：${error.message}`);
      return false;
    }
  }
  exportArchive() {
    return clone({ archiveVersion: 1, exportedAt: new Date().toISOString(), graph: this.graph, snapshots: this._snapshots });
  }
  deleteLocal() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      if (this.blocked) throw new Error('草稿有冲突或待恢复；请先导出副本或读取另一页版本。');
      let current;
      try { current = this.decode(this.storage.getItem(STORAGE_KEY)); } catch (error) { this.blocked = true; throw error; }
      if ((current?.serial ?? null) !== this.serial) {
        this.blocked = true;
        throw new Error('另一页已保存更新或删除草稿，未删除它；请先读取另一页版本。');
      }
      const fresh = createGraph();
      // Remove only this feature's keys. Keeping the primary until last means
      // a failed backup removal cannot erase the current saved graph.
      this.storage.removeItem(BACKUP_KEY);
      this.storage.removeItem(STORAGE_KEY);
      this.graph = fresh;
      this.undoStack = [];
      this.redoStack = [];
      this._snapshots = [];
      this.ui = { selected: [], collapsed: [], entered: true };
      this.serial = null;
      this.observedRaw = null;
      this.restored = false;
      this.recovery = false;
      this.blocked = false;
      this.onStatus('saved', '已删除本机旧草稿，可开始新的探索');
      return true;
    } catch (error) {
      this.onStatus('error', `删除失败：${error.message || '浏览器存储不可用'}。当前编辑已保留，可先导出 JSON 副本。`);
      return false;
    }
  }
  changedElsewhere() {
    this.blocked = true;
    clearTimeout(this.timer);
    this.onStatus('error', '另一页已保存更新；请先导出当前副本，再读取另一页版本。');
  }
}
