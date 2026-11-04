import { createGraph, validateGraph } from './graph.js';
import { GraphStore, STORAGE_KEY, BACKUP_KEY } from './store.js';
import { prepareImport } from './privacy.js';

export const FOREST_KEY = 'shiyu-zuxia.forest.v1';
const WORKSPACE_KEY = 'shiyu-zuxia.workspace.v1';
const PROTOTYPE_KEY = 'shiyuzuxia_forest_demo_v3';
const OLD_PROTOTYPE_KEY = 'shiyuzuxia_life_tree_demo_v2';
export const TREE_TYPES = Object.freeze({
  career: { name: '职业树', title: '我的职业探索', root: '我的职业起点', description: '从现在的专业与选择出发' },
  life: { name: '生活树', title: '我想过的生活', root: '此刻的我', description: '自由、关系与日常的选择' },
  thought: { name: '思想与热爱树', title: '我的热爱与思考', root: '我的内在世界', description: '哲学、欲望与自由' },
  blank: { name: '空白自定义树', title: '一棵新的树', root: '新的起点', description: '由自己定义节点与关系' },
});
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
const uniqueId = prefix => `${prefix}_${crypto.randomUUID()}`;
const emptyIndex = () => ({ version: 1, trees: [], migrations: [] });
const validType = type => typeof type === 'string' && Object.hasOwn(TREE_TYPES, type);
function named(value, label, max = 120, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label}需要${max}字以内的${allowEmpty ? '' : '非空'}文本`);
  return value.trim();
}
function readJson(raw) { return typeof raw === 'string' ? JSON.parse(raw) : copy(raw); }
function envelope(graph, ui = {}) {
  return { storageVersion: 1, serial: uniqueId('serial'), graph, undo: [], redo: [], snapshots: [], ui: { selected: [], collapsed: [], entered: true, focused: graph.rootNodeId, chat: [], ...ui } };
}
function checkedEnvelope(value) { return GraphStore.prototype.decode.call(null, JSON.stringify(value)); }
function checkedWorkspace(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || JSON.stringify(value).length > 2000000) throw new Error('本树扩展资料格式不受支持或过大');
  return copy(value);
}
function indexData(raw) {
  if (raw === null) return emptyIndex();
  const value = readJson(raw);
  if (!value || value.version !== 1 || !Array.isArray(value.trees) || !Array.isArray(value.migrations)) throw new Error('树库索引格式不受支持');
  const ids = new Set();
  for (const entry of value.trees) {
    if (!entry || !validType(entry.type) || !Number.isSafeInteger(entry.nodeCount) || entry.nodeCount < 1) throw new Error('树库条目损坏');
    named(entry.id, '树ID', 160); named(entry.title, '树名'); named(entry.description, '树描述', 2000, true);
    if (ids.has(entry.id)) throw new Error('树库ID重复');
    ids.add(entry.id);
    for (const field of ['createdAt', 'updatedAt']) if (!Number.isFinite(Date.parse(entry[field]))) throw new Error('树库日期损坏');
  }
  if (value.migrations.some(item => typeof item !== 'string' || item.length > 400)) throw new Error('树库迁移记录损坏');
  return value;
}
function legacyChat(chat) {
  if (chat === undefined) return [];
  if (!Array.isArray(chat) || chat.length > 80) throw new Error('旧版聊天记录格式错误或超过80条');
  return chat.map(message => {
    if (!message || !['user', 'assistant'].includes(message.who) || typeof message.text !== 'string' || message.text.length > 20000) throw new Error('旧版聊天消息损坏');
    return { role: message.who, content: message.text };
  });
}
function prototypeDocument(data) {
  if (!data || !Array.isArray(data.nodes) || data.nodes.length < 1 || data.nodes.length > 300) throw new Error('旧版树节点需要1至300个；未截断原数据');
  const ids = new Set();
  for (const node of data.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error('旧版节点ID无效或重复');
    named(node.title, '旧版节点名'); ids.add(node.id);
  }
  const roots = data.nodes.filter(node => node.parent === null);
  if (roots.length !== 1 || roots[0].id !== 'origin') throw new Error('旧版树必须只有一个 origin 起点');
  for (const node of data.nodes) if (node.id !== 'origin' && !ids.has(node.parent)) throw new Error('旧版分支引用了不存在的节点');
  const graph = createGraph({ title: data.treeTitle || data.title || '导入的树' });
  graph.rootNodeId = 'origin';
  const createdAt = Number.isFinite(Date.parse(data.createdAt)) ? data.createdAt : now();
  const updatedAt = Number.isFinite(Date.parse(data.updatedAt)) ? data.updatedAt : createdAt;
  const kindMap = { root: 'self', academic: 'education', work: 'career', cross: 'other', living: 'lifestyle' };
  graph.createdAt = createdAt; graph.updatedAt = updatedAt;
  graph.nodes = data.nodes.map((node, index) => ({
    id: node.id, kind: node.id === 'origin' ? 'self' : kindMap[node.kind] || 'other', title: node.title,
    description: node.summary || node.subtitle || '', phase: 'exploring', origin: 'imported', knowledgeStatus: 'unverified', sourceIds: [], private: false,
    position: { x: 120 + (node.id === 'origin' ? 0 : 320), y: node.id === 'origin' ? 300 : 80 + index * 130 }, createdAt, updatedAt,
    attributes: { ...(node.subtitle ? { subtitle: node.subtitle } : {}), ...(node.skills ? { legacySkills: node.skills } : {}) },
  }));
  graph.edges = data.nodes.filter(node => node.id !== 'origin').map(node => ({
    id: uniqueId('edge'), from: node.parent, to: node.id, relation: 'possible_path', origin: 'imported', createdAt,
    requirements: node.via ? [{ id: uniqueId('req'), kind: 'other', label: node.via, detail: '', necessity: 'unknown', knowledgeStatus: 'unverified', sourceIds: [] }] : [],
  }));
  validateGraph(graph);
  const depths = new Map([['origin', 0]]), parents = new Map(data.nodes.map(node => [node.id, node.parent]));
  const depth = id => { if (!depths.has(id)) depths.set(id, depth(parents.get(id)) + 1); return depths.get(id); };
  for (const node of graph.nodes) node.position.x = 120 + depth(node.id) * 320;
  const selected = data.selectedPaths ?? data.selected ?? [];
  if (!Array.isArray(selected) || selected.some(id => !ids.has(id))) throw new Error('旧版比较选择引用了不存在的节点');
  return envelope(graph, { selected: copy(selected), focused: ids.has(data.focused) ? data.focused : 'origin', chat: legacyChat(data.chat) });
}
function reidentify(document, id, { resetDates = false } = {}) {
  const next = copy(document), date = now();
  for (const graph of [next.graph, ...(next.undo || []), ...(next.redo || []), ...(next.snapshots || []).map(item => item.graph)]) {
    graph.graphId = id;
    if (resetDates) { graph.createdAt = date; graph.updatedAt = date; }
  }
  next.serial = uniqueId('serial');
  return checkedEnvelope(next);
}

/** A small library around the existing GraphStore; original career keys pass through unchanged. */
export class TreeLibrary {
  constructor(storage, onStatus = () => {}) {
    this.storage = storage; this.onStatus = onStatus; this.memory = new Map(); this.storageAvailable = true; this.index = emptyIndex(); this.warned = false;
    try { this.index = indexData(storage.getItem(FOREST_KEY)); }
    catch (error) { this.storageAvailable = false; this.report(`树库无法读取，原数据保留：${error.message}。本次新树仅暂存在页面内存，请导出备份。`); }
    this.migrate();
  }
  report(message) { this.onStatus(message); }
  memoryWarning(error) {
    this.storageAvailable = false;
    if (!this.warned) { this.warned = true; this.report(`浏览器无法保存${error?.message ? `（${error.message}）` : ''}；仅暂存在本次页面内存，刷新会丢失，请导出 JSON 备份。`); }
  }
  read(key) {
    if (this.memory.has(key)) return this.memory.get(key);
    try { return this.storage.getItem(key); } catch (error) { this.memoryWarning(error); return null; }
  }
  write(key, value) {
    const text = String(value);
    if (this.storageAvailable) {
      try { this.storage.setItem(key, text); return; } catch (error) { this.memoryWarning(error); }
    }
    this.memory.set(key, text);
  }
  erase(key) {
    if (this.storageAvailable) {
      try { this.storage.removeItem(key); return; } catch (error) { this.memoryWarning(error); }
    }
    this.memory.set(key, null);
  }
  reloadIndex() {
    if (!this.storageAvailable) return;
    try { this.index = indexData(this.storage.getItem(FOREST_KEY)); }
    catch (error) { this.memoryWarning(error); this.report('树库索引已改变或损坏，未覆盖原数据；请导出当前内存副本。'); }
  }
  changeIndex(change) {
    this.reloadIndex(); change(this.index); this.write(FOREST_KEY, JSON.stringify(this.index));
  }
  keys(id) {
    named(id, '树ID', 160);
    const prefix = `shiyu-zuxia.tree.${encodeURIComponent(id)}`;
    return { graph: `${prefix}.graph.v1`, backup: `${prefix}.graph.v1.backup`, workspace: `${prefix}.workspace.v1` };
  }
  isTreeStorageKey(key, id) { return Object.values(this.keys(id)).includes(key); }
  scopedStorage(id) {
    const library = this, keys = this.keys(id);
    const scoped = new Map([[STORAGE_KEY, keys.graph], [BACKUP_KEY, keys.backup], [WORKSPACE_KEY, keys.workspace]]);
    return {
      get persistent() { return library.storageAvailable; },
      getItem(key) { return scoped.has(key) ? library.read(scoped.get(key)) : library.storage.getItem(key); },
      setItem(key, value) { if (scoped.has(key)) library.write(scoped.get(key), value); else library.storage.setItem(key, value); },
      removeItem(key) { if (scoped.has(key)) library.erase(scoped.get(key)); else library.storage.removeItem(key); },
    };
  }
  entry(record) {
    const raw = this.read(this.keys(record.id).graph);
    if (!raw) return copy(record);
    try { const doc = checkedEnvelope(readJson(raw)); return { ...copy(record), title: doc.graph.title, updatedAt: doc.graph.updatedAt, nodeCount: doc.graph.nodes.length }; }
    catch { this.report(`「${record.title}」的数据无法读取，原内容已保留，可尝试恢复备份。`); return copy(record); }
  }
  list() { this.reloadIndex(); return this.index.trees.map(record => this.entry(record)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id) { this.reloadIndex(); const record = this.index.trees.find(item => item.id === id); return record ? this.entry(record) : null; }
  refresh(id) {
    const entry = this.get(id); if (!entry) return null;
    const previous = this.index.trees.find(item => item.id === id);
    if (previous && JSON.stringify(previous) === JSON.stringify(entry)) return entry;
    this.changeIndex(index => { const record = index.trees.find(item => item.id === id); if (record) Object.assign(record, entry); });
    return entry;
  }
  addDocument(type, description, document, { workspace = null, backup = null, migration = null, resetDates = false } = {}) {
    if (!validType(type)) throw new Error('不支持的树类型');
    named(description, '树描述', 2000, true);
    checkedEnvelope(document); checkedWorkspace(workspace); if (backup) checkedEnvelope(backup);
    const id = uniqueId('tree'), doc = reidentify(document, id, { resetDates });
    const record = { id, type, title: doc.graph.title, description, createdAt: doc.graph.createdAt, updatedAt: doc.graph.updatedAt, nodeCount: doc.graph.nodes.length };
    const keys = this.keys(id);
    this.write(keys.graph, JSON.stringify(doc));
    if (backup) this.write(keys.backup, JSON.stringify(reidentify(backup, id, { resetDates })));
    if (workspace) this.write(keys.workspace, JSON.stringify(workspace));
    this.changeIndex(index => { index.trees.push(record); if (migration) index.migrations.push(migration); });
    return copy(record);
  }
  create(type, title = TREE_TYPES[type]?.title, description = '') {
    if (!validType(type)) throw new Error('不支持的树类型');
    named(title, '树名');
    const graph = createGraph({ title: title.trim() }); graph.nodes[0].title = TREE_TYPES[type].root;
    return this.addDocument(type, description, envelope(graph));
  }
  rename(id, title) {
    if (!this.get(id)) throw new Error('这棵树不存在');
    named(title, '树名');
    const store = new GraphStore(this.scopedStorage(id), (state, message) => { if (state === 'error') this.report(message); });
    if (store.blocked || !store.restored) throw new Error('树数据无法读取，未重命名');
    store.commit([{ op: 'rename_graph', title: title.trim() }]); store.save(); clearTimeout(store.timer);
    return this.refresh(id);
  }
  exportTree(id) {
    const tree = this.get(id); if (!tree) throw new Error('这棵树不存在');
    const keys = this.keys(id), raw = this.read(keys.graph);
    if (!raw) throw new Error('树数据缺失；未生成空白备份');
    const document = checkedEnvelope(readJson(raw)), backupRaw = this.read(keys.backup), workspaceRaw = this.read(keys.workspace);
    let backup = null, workspace = null;
    const recovery = {};
    if (backupRaw !== null) try { backup = checkedEnvelope(readJson(backupRaw)); } catch { recovery.backupRaw = backupRaw; this.report('本树备份损坏；原文已附入导出文件供恢复，未覆盖它。'); }
    if (workspaceRaw !== null) try { workspace = checkedWorkspace(readJson(workspaceRaw)); } catch { recovery.workspaceRaw = workspaceRaw; this.report('本树扩展资料损坏；原文已附入导出文件供恢复，未覆盖它。'); }
    return copy({ treeArchiveVersion: 1, exportedAt: now(), tree, document, backup, workspace, ...(Object.keys(recovery).length ? { recovery } : {}) });
  }
  duplicate(id) {
    const archive = this.exportTree(id), doc = archive.document;
    doc.graph.title = `${doc.graph.title.slice(0, 116)}（副本）`;
    if (archive.workspace) { archive.workspace.useProfile = false; archive.workspace.useDocuments = false; for (const item of archive.workspace.documents || []) item.shareWithAI = false; }
    return this.addDocument(archive.tree.type, archive.tree.description, doc, { workspace: archive.workspace, backup: archive.backup, resetDates: true });
  }
  remove(id) {
    if (!this.get(id)) return false;
    // Hide in the index first. A cleanup failure leaves recoverable bytes, never another tree's keys.
    this.changeIndex(index => { index.trees = index.trees.filter(item => item.id !== id); });
    for (const key of Object.values(this.keys(id))) this.erase(key);
    return true;
  }
  parseImport(raw) {
    if (typeof raw === 'string' && raw.length > 32 * 1024 * 1024) throw new Error('树备份超过32MB；未导入');
    const data = readJson(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('树文件必须是 JSON 对象');
    let document, workspace = null, backup = null, type = 'blank', description = '';
    if (data.treeArchiveVersion !== undefined) {
      if (data.treeArchiveVersion !== 1 || !validType(data.tree?.type)) throw new Error('不支持的树备份版本');
      document = checkedEnvelope(data.document); workspace = checkedWorkspace(data.workspace); backup = data.backup ? checkedEnvelope(data.backup) : null;
      type = data.tree.type; description = data.tree.description || '';
    } else if (data.storageVersion !== undefined) {
      document = checkedEnvelope(data); workspace = checkedWorkspace(data.workspace); type = validType(data.type) ? data.type : 'blank'; description = data.description || '';
    } else if (data.archiveVersion !== undefined) {
      if (data.archiveVersion !== 1) throw new Error('不支持的完整备份版本');
      document = checkedEnvelope({ ...envelope(copy(data.graph), data.ui || {}), snapshots: data.snapshots || [] }); workspace = checkedWorkspace(data.workspace);
    } else if (data.schemaVersion !== undefined) { validateGraph(data); document = envelope(copy(data)); }
    else if (Array.isArray(data.nodes)) {
      document = prototypeDocument(data); type = validType(data.treeType) ? data.treeType : validType(data.type) ? data.type : 'blank'; description = data.description || '';
    } else throw new Error('不支持的树文件格式');
    checkedEnvelope(document); return { document, workspace, backup, type, description };
  }
  importTree(raw) {
    const parsed = this.parseImport(raw);
    const resetClaims = document => {
      document.graph = prepareImport(document.graph);
      document.undo = (document.undo || []).map(prepareImport);
      document.redo = (document.redo || []).map(prepareImport);
      for (const snapshot of document.snapshots || []) snapshot.graph = prepareImport(snapshot.graph);
      return document;
    };
    parsed.document = resetClaims(parsed.document);
    if (parsed.backup) parsed.backup = resetClaims(parsed.backup);
    if (parsed.workspace) {
      parsed.workspace.useProfile = false; parsed.workspace.useDocuments = false;
      for (const item of parsed.workspace.documents || []) item.shareWithAI = false;
    }
    return this.addDocument(parsed.type, parsed.description, parsed.document, { workspace: parsed.workspace, backup: parsed.backup, resetDates: true });
  }
  migrate() {
    const migrated = marker => this.index.migrations.includes(marker);
    const attempt = (marker, action) => { if (migrated(marker)) return; try { action(marker); } catch (error) { this.report(`旧数据未迁移，原键完整保留（${marker}）：${error.message}`); } };
    const current = this.read(STORAGE_KEY), backupRaw = this.read(BACKUP_KEY);
    if (current !== null || backupRaw !== null) attempt(STORAGE_KEY, marker => {
      let document;
      try { document = checkedEnvelope(readJson(current)); }
      catch (error) {
        if (!backupRaw) throw error;
        document = checkedEnvelope(readJson(backupRaw)); this.report('旧单树主草稿损坏或缺失，已迁移有效备份；原主草稿与备份仍保留。');
      }
      const workspaceRaw = this.read(WORKSPACE_KEY);
      let workspace = null;
      if (workspaceRaw !== null) try { workspace = checkedWorkspace(readJson(workspaceRaw)); } catch (error) { this.report(`旧扩展资料未迁移，原内容保留：${error.message}`); }
      let backup = null;
      if (backupRaw !== null) try { backup = checkedEnvelope(readJson(backupRaw)); } catch (error) { this.report(`旧备份未迁移，原内容保留：${error.message}`); }
      this.addDocument('career', '从之前的单树画布保留的探索记录', document, { workspace, backup, migration: marker });
    });
    const prototypeRaw = this.read(PROTOTYPE_KEY);
    if (prototypeRaw !== null) attempt(`${PROTOTYPE_KEY}:format`, () => {
      const data = readJson(prototypeRaw);
      if (!data || !Array.isArray(data.trees)) throw new Error('旧树库格式损坏');
      const ids = new Set();
      for (const tree of data.trees) {
        if (!tree || typeof tree.id !== 'string' || !tree.id || ids.has(tree.id)) throw new Error('旧树库ID缺失或重复；未截断或覆盖原数据');
        ids.add(tree.id);
      }
      for (const tree of data.trees) attempt(`${PROTOTYPE_KEY}:${tree.id}`, marker => {
        const parsed = this.parseImport(tree);
        this.addDocument(parsed.type, parsed.description, parsed.document, { migration: marker });
      });
    });
    const oldRaw = this.read(OLD_PROTOTYPE_KEY);
    if (oldRaw !== null) attempt(OLD_PROTOTYPE_KEY, marker => {
      const data = readJson(oldRaw), document = prototypeDocument({ ...data, title: '之前的人生树' });
      this.addDocument('life', '从旧版单画布原型保留的探索记录', document, { migration: marker });
    });
  }
}
