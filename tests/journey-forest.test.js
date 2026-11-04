import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeLibrary, FOREST_KEY, TREE_TYPES } from '../journey/forest.js';
import { GraphStore, STORAGE_KEY, BACKUP_KEY } from '../journey/store.js';
import { createGraph, validateGraph } from '../journey/graph.js';

const WORKSPACE_KEY = 'shiyu-zuxia.workspace.v1';
const PROTOTYPE_KEY = 'shiyuzuxia_forest_demo_v3';
const OLD_PROTOTYPE_KEY = 'shiyuzuxia_life_tree_demo_v2';
class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = []; this.removals = []; this.failRead = false; this.failWrite = null; }
  getItem(key) { if (this.failRead) throw new Error('SecurityError'); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite === true || this.failWrite === key) throw new Error('QuotaExceededError'); this.values.set(key, String(value)); this.writes.push(key); }
  removeItem(key) { this.values.delete(key); this.removals.push(key); }
}
function fixture(storage = new MemoryStorage()) {
  const statuses = [], library = new TreeLibrary(storage, message => statuses.push(message));
  return { storage, library, statuses };
}
function open(t, library, id) {
  const statuses = [], store = new GraphStore(library.scopedStorage(id), (state, message) => statuses.push({ state, message }));
  t.after(() => clearTimeout(store.timer));
  return { store, statuses };
}
function branch(store, title = '独立分支') {
  store.commit([{ op: 'add_node', tempId: 'new', node: { kind: 'goal', title } }, { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'new' }]);
  return store.graph.nodes.at(-1).id;
}
function oldTree(id = 'old_tree', title = '旧树') {
  return { id, type: 'career', title, description: '原始备注', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z',
    nodes: [{ id: 'origin', parent: null, title: '原始起点', kind: 'root' }, { id: 'work', parent: 'origin', title: '就业', kind: 'work', via: '实习 · 经验', skills: ['写作'] }],
    focused: 'work', selected: ['work'], chat: [{ who: 'user', text: '仅属于这棵树的问题' }, { who: 'assistant', text: '旧演示回复' }] };
}

test('new users have an empty library and four named single-root tree types', t => {
  const { library, storage } = fixture();
  assert.deepEqual(library.list(), []); assert.equal(storage.writes.length, 0);
  for (const type of Object.keys(TREE_TYPES)) {
    const entry = library.create(type, `新的${type}`, '描述');
    const { store } = open(t, library, entry.id);
    assert.equal(entry.type, type); assert.equal(entry.nodeCount, 1);
    assert.equal(store.graph.nodes.length, 1); assert.equal(store.graph.nodes[0].title, TREE_TYPES[type].root);
    assert.equal(store.graph.edges.length, 0); assert.equal(store.ui.focused, store.graph.rootNodeId); assert.deepEqual(store.ui.chat, []);
  }
  assert.equal(library.list().length, 4);
});

test('same-named trees, selections, focus, chat, annotations and history remain independent across reopen', t => {
  const { library, storage } = fixture();
  const a = library.create('career', '同名'), b = library.create('career', '同名');
  assert.notEqual(a.id, b.id);
  const first = open(t, library, a.id).store, second = open(t, library, b.id).store;
  const child = branch(first);
  first.commit([{ op: 'annotate_edge', edgeId: first.graph.edges[0].id, requirements: [{ kind: 'skill', label: '写作' }] }]);
  first.ui.selected = [child]; first.ui.focused = child; first.ui.chat = [{ role: 'user', content: '树 A 专属问题' }];
  assert.equal(first.save(), true);
  second.ui.chat = [{ role: 'assistant', content: '树 B 专属回复' }]; assert.equal(second.save(), true);
  const reloadedLibrary = fixture(storage).library;
  const reopened = open(t, reloadedLibrary, a.id).store, untouched = open(t, reloadedLibrary, b.id).store;
  assert.equal(reopened.graph.nodes.length, 2); assert.equal(reopened.graph.edges[0].requirements[0].label, '写作');
  assert.equal(reopened.ui.focused, child); assert.deepEqual(reopened.ui.selected, [child]); assert.deepEqual(reopened.ui.chat, first.ui.chat);
  assert.equal(reopened.undoStack.length, 2); assert.equal(untouched.graph.nodes.length, 1); assert.deepEqual(untouched.ui.chat, second.ui.chat);
  assert.equal(reloadedLibrary.get(a.id).nodeCount, 2);
});

test('storage adapter isolates all Journey keys and passes original career reads through', () => {
  const { library, storage } = fixture();
  storage.setItem('careerPredictor', 'legacy-assessment');
  const a = library.create('life', 'A'), b = library.create('life', 'B');
  const first = library.scopedStorage(a.id), second = library.scopedStorage(b.id);
  first.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, documents: [{ id: 'A' }] }));
  first.setItem(BACKUP_KEY, 'A-only-backup');
  assert.equal(second.getItem(WORKSPACE_KEY), null); assert.equal(second.getItem(BACKUP_KEY), null);
  assert.equal(storage.getItem(WORKSPACE_KEY), null); assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(first.getItem('careerPredictor'), 'legacy-assessment');
  assert.equal(library.isTreeStorageKey(library.keys(a.id).graph, a.id), true);
  assert.equal(library.isTreeStorageKey(library.keys(b.id).graph, a.id), false);
});

test('two pages editing different trees do not cause a graph serial conflict', t => {
  const { library, storage } = fixture(); const a = library.create('career', 'A'), b = library.create('thought', 'B');
  const other = fixture(storage).library;
  const first = open(t, library, a.id).store, second = open(t, other, b.id).store;
  branch(first, 'A修改'); branch(second, 'B修改');
  assert.equal(first.save(), true); assert.equal(second.save(), true);
  assert.equal(first.blocked, false); assert.equal(second.blocked, false);
});

test('two pages editing the same tree retain existing conflict protection', t => {
  const { library, storage } = fixture(), entry = library.create('career', 'A');
  const first = open(t, library, entry.id).store, second = open(t, fixture(storage).library, entry.id).store;
  branch(first, '先保存'); branch(second, '未保存'); assert.equal(first.save(), true); assert.equal(second.save(), false);
  assert.equal(second.blocked, true); assert.equal(second.graph.nodes.at(-1).title, '未保存');
});

test('concurrent library additions merge the latest index rather than losing other trees', () => {
  const { library, storage } = fixture(), other = fixture(storage).library;
  const a = library.create('career', 'A'), b = other.create('career', 'B');
  assert.deepEqual(new Set(library.list().map(item => item.id)), new Set([a.id, b.id]));
});

test('rename derives current metadata without replacing other trees or their data', t => {
  const { library } = fixture(), a = library.create('blank', 'A'), b = library.create('blank', 'B');
  library.rename(a.id, '新的树名');
  assert.equal(library.get(a.id).title, '新的树名'); assert.equal(library.get(b.id).title, 'B');
  assert.equal(open(t, library, a.id).store.graph.title, '新的树名');
});

test('duplicate deeply copies graph, UI, workspace and named versions under a new tree identity', t => {
  const { library } = fixture(), original = library.create('life', '生活'); const store = open(t, library, original.id).store;
  const child = branch(store); store.ui.focused = child; store.ui.selected = [child]; store.ui.chat = [{ role: 'user', content: '原始对话' }];
  assert.ok(store.snapshot('旧版本')); assert.equal(store.save(), true);
  library.scopedStorage(original.id).setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, profile: null, useProfile: true, useDocuments: true, documents: [{ id: 'doc', shareWithAI: true }] }));
  const duplicate = library.duplicate(original.id), copied = open(t, library, duplicate.id).store;
  assert.notEqual(duplicate.id, original.id); assert.notEqual(copied.graph.graphId, store.graph.graphId);
  assert.equal(copied.snapshots.length, 1); assert.equal(copied.getSnapshot(copied.snapshots[0].id).graph.graphId, copied.graph.graphId);
  assert.deepEqual(copied.ui, store.ui);
  copied.ui.chat[0].content = '副本自己的对话'; branch(copied, '副本节点'); assert.equal(copied.save(), true);
  assert.equal(open(t, library, original.id).store.graph.nodes.length, 2); assert.equal(store.ui.chat[0].content, '原始对话');
  const workspace = JSON.parse(library.scopedStorage(duplicate.id).getItem(WORKSPACE_KEY));
  assert.equal(workspace.useProfile, false); assert.equal(workspace.useDocuments, false); assert.equal(workspace.documents[0].shareWithAI, false);
});

test('complete JSON export/import preserves focus, comparisons, chat, versions and workspace as an independent tree', t => {
  const { library } = fixture(), original = library.create('thought', '思想', '完整备注'); const store = open(t, library, original.id).store;
  const child = branch(store); store.ui.focused = child; store.ui.selected = [child]; store.ui.chat = [{ role: 'assistant', content: '专属记录', contextKey: 'old-context' }];
  store.snapshot('一份命名版本'); store.save();
  const workspace = { version: 1, profile: null, useProfile: false, documents: [], useDocuments: false, researchEnabled: false, liveSearch: false, research: null, view: 'values' };
  library.scopedStorage(original.id).setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  const archive = library.exportTree(original.id), imported = library.importTree(JSON.stringify(archive));
  assert.notEqual(imported.id, original.id); assert.equal(imported.type, 'thought'); assert.equal(imported.description, '完整备注');
  const restored = open(t, library, imported.id).store;
  assert.deepEqual(restored.ui, store.ui); assert.equal(restored.snapshots.length, 1);
  assert.deepEqual(JSON.parse(library.scopedStorage(imported.id).getItem(WORKSPACE_KEY)), workspace);
  assert.equal(library.list().length, 2);
});

test('reference prototype import restores selectedPaths, focused node and local chat', t => {
  const { library } = fixture(), legacy = oldTree(); legacy.version = 3; legacy.treeType = 'career'; legacy.treeTitle = legacy.title;
  legacy.selectedPaths = ['work']; delete legacy.selected;
  const entry = library.importTree(legacy), store = open(t, library, entry.id).store;
  assert.deepEqual(store.ui.selected, ['work']); assert.equal(store.ui.focused, 'work'); assert.equal(store.ui.chat[0].content, '仅属于这棵树的问题');
  assert.equal(store.graph.edges[0].requirements[0].label, '实习 · 经验'); assert.equal(store.graph.nodes[1].kind, 'career');
});

test('legacy raw graph and existing GraphStore envelope import never overwrite the active tree', t => {
  const { library } = fixture(), original = library.create('career', '现有');
  const raw = createGraph({ title: '外部图' }), a = library.importTree(raw), envelope = library.exportTree(original.id).document, b = library.importTree(envelope);
  assert.equal(library.list().length, 3); assert.equal(library.get(original.id).title, '现有');
  assert.notEqual(a.id, b.id); assert.equal(open(t, library, a.id).store.graph.title, '外部图');
});

test('legacy global graph, backup and workspace migrate once without changing original keys', t => {
  const storage = new MemoryStorage(), old = new GraphStore(storage); t.after(() => clearTimeout(old.timer));
  branch(old); old.ui.chat = [{ role: 'user', content: '旧单树聊天' }]; old.save(); old.commit([{ op: 'rename_graph', title: '旧单树最新版本' }]); old.save();
  storage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, documents: [], view: 'career' }));
  const original = new Map([STORAGE_KEY, BACKUP_KEY, WORKSPACE_KEY].map(key => [key, storage.getItem(key)]));
  const library = fixture(storage).library; assert.equal(library.list().length, 1);
  const entry = library.list()[0], migrated = open(t, library, entry.id).store;
  assert.equal(migrated.graph.title, '旧单树最新版本'); assert.equal(migrated.graph.nodes.length, 2); assert.deepEqual(migrated.ui.chat, old.ui.chat);
  assert.ok(library.scopedStorage(entry.id).getItem(BACKUP_KEY));
  for (const [key, value] of original) assert.equal(storage.getItem(key), value);
  assert.equal(fixture(storage).library.list().length, 1);
});

test('both reference v3 collection and old v2 single tree migrate non-destructively', () => {
  const storage = new MemoryStorage(); storage.setItem(PROTOTYPE_KEY, JSON.stringify({ version: 3, trees: [oldTree()] }));
  storage.setItem(OLD_PROTOTYPE_KEY, JSON.stringify(oldTree('v2')));
  const v3 = storage.getItem(PROTOTYPE_KEY), v2 = storage.getItem(OLD_PROTOTYPE_KEY), library = fixture(storage).library;
  assert.equal(library.list().length, 2); assert.equal(storage.getItem(PROTOTYPE_KEY), v3); assert.equal(storage.getItem(OLD_PROTOTYPE_KEY), v2);
  assert.equal(fixture(storage).library.list().length, 2);
});

test('151 reference trees and a 251-node tree all survive migration and refresh', () => {
  const storage = new MemoryStorage(), many = Array.from({ length: 151 }, (_, i) => oldTree(`tree_${i}`, `树${i}`));
  many[0].nodes.push(...Array.from({ length: 249 }, (_, i) => ({ id: `extra_${i}`, parent: 'origin', title: `额外节点${i}`, kind: 'cross' })));
  storage.setItem(PROTOTYPE_KEY, JSON.stringify({ version: 3, trees: many }));
  const library = fixture(storage).library; assert.equal(library.list().length, 151); assert.equal(library.list().find(item => item.title === '树0').nodeCount, 251);
  const refreshed = fixture(storage).library; assert.equal(refreshed.list().length, 151); assert.equal(refreshed.list().find(item => item.title === '树0').nodeCount, 251);
});

test('bad or oversized legacy trees are reported, preserved and never silently truncated', () => {
  const storage = new MemoryStorage(), bad = oldTree('oversized');
  bad.nodes.push(...Array.from({ length: 300 }, (_, i) => ({ id: `too_${i}`, parent: 'origin', title: '节点' })));
  storage.setItem(PROTOTYPE_KEY, JSON.stringify({ version: 3, trees: [oldTree('good'), bad] }));
  const raw = storage.getItem(PROTOTYPE_KEY), { library, statuses } = fixture(storage);
  assert.equal(library.list().length, 1); assert.ok(statuses.some(message => /未迁移.*oversized/.test(message))); assert.equal(storage.getItem(PROTOTYPE_KEY), raw);
});

test('corrupt index is preserved byte-for-byte and new trees remain exportable only in session memory', t => {
  const storage = new MemoryStorage(); storage.setItem(FOREST_KEY, '{broken-original-index');
  const { library, statuses } = fixture(storage), entry = library.create('blank', '内存树');
  const { store, statuses: saveStates } = open(t, library, entry.id); branch(store);
  assert.equal(store.save(), false); assert.equal(store.blocked, false); assert.equal(library.exportTree(entry.id).document.graph.nodes.length, 2);
  assert.equal(storage.getItem(FOREST_KEY), '{broken-original-index'); assert.equal(library.storageAvailable, false);
  assert.ok(statuses.some(message => /原数据保留/.test(message))); assert.equal(saveStates.at(-1).state, 'error');
});

test('denied storage allows repeated in-memory editing, tree switching and export without claiming a save', t => {
  const storage = new MemoryStorage(); storage.failRead = true; storage.failWrite = true;
  const { library, statuses } = fixture(storage), a = library.create('career', '内存 A'), b = library.create('life', '内存 B');
  const { store, statuses: saveStates } = open(t, library, a.id);
  branch(store); store.ui.chat = [{ role: 'user', content: '仍可保留' }]; assert.equal(store.save(), false);
  branch(store, '继续编辑'); assert.equal(store.save(), false); assert.equal(store.blocked, false);
  assert.equal(open(t, library, a.id).store.graph.nodes.length, 3); assert.equal(open(t, library, b.id).store.graph.nodes.length, 1);
  assert.equal(library.exportTree(a.id).document.ui.chat[0].content, '仍可保留');
  assert.equal(storage.writes.length, 0); assert.ok(statuses.some(message => /页面内存/.test(message)));
  assert.ok(saveStates.every(item => item.state !== 'saved'));
});

test('quota failure preserves last durable tree and retains an exportable edited memory version', t => {
  const { library, storage } = fixture(), entry = library.create('career', 'A'), before = storage.getItem(library.keys(entry.id).graph);
  const store = open(t, library, entry.id).store; branch(store);
  storage.failWrite = true; assert.equal(store.save(), false);
  assert.equal(storage.getItem(library.keys(entry.id).graph), before); assert.equal(library.exportTree(entry.id).document.graph.nodes.length, 2);
  assert.equal(store.blocked, false); branch(store, '再编辑'); assert.equal(store.save(), false);
  assert.equal(library.exportTree(entry.id).document.graph.nodes.length, 3);
});

test('malformed imports fail before changing the library or existing tree bytes', () => {
  const { library, storage } = fixture(), entry = library.create('blank', '保留'); const before = new Map(storage.values);
  const cyclic = oldTree(); cyclic.nodes[1].parent = 'work';
  const secondRoot = oldTree(); secondRoot.nodes.push({ id: 'root2', parent: null, title: '第二根' });
  const invalid = [null, '{bad-json', { nodes: [] }, cyclic, secondRoot, { ...createGraph(), schemaVersion: 99 }, { ...oldTree(), selected: ['missing'] }];
  for (const data of invalid) assert.throws(() => library.importTree(data));
  assert.deepEqual(storage.values, before); assert.equal(library.list().length, 1); assert.equal(library.get(entry.id).title, '保留');
});

test('deletion only removes the target tree and does not allow a stale editor to recreate it', t => {
  const { library, storage } = fixture(); storage.setItem('careerPredictor', 'original');
  const a = library.create('career', 'A'), b = library.create('life', 'B'), stale = open(t, library, a.id).store;
  const untouched = storage.getItem(library.keys(b.id).graph);
  library.scopedStorage(a.id).setItem(WORKSPACE_KEY, JSON.stringify({ version: 1 }));
  assert.equal(library.remove(a.id), true); assert.equal(library.get(a.id), null); assert.equal(library.list().length, 1);
  for (const key of Object.values(library.keys(a.id))) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem(library.keys(b.id).graph), untouched); assert.equal(storage.getItem('careerPredictor'), 'original');
  branch(stale); assert.equal(stale.save(), false); assert.equal(storage.getItem(library.keys(a.id).graph), null);
});

test('focused and bounded chat UI are validated while older UI documents keep their original shape', t => {
  const { library } = fixture(), entry = library.create('career', 'A'), store = open(t, library, entry.id).store;
  const encoded = library.exportTree(entry.id).document;
  const old = structuredClone(encoded); delete old.ui.focused; delete old.ui.chat;
  store.adopt(store.decode(JSON.stringify(old))); assert.deepEqual(store.ui, old.ui);
  for (const ui of [{ focused: 42 }, { chat: {} }, { chat: [{ role: 'system', content: '越权' }] }, { chat: Array.from({ length: 81 }, () => ({ role: 'user', content: '超限' })) }]) {
    assert.throws(() => store.decode(JSON.stringify({ ...encoded, ui })));
  }
  store.adopt({ ...encoded, ui: { ...encoded.ui, focused: 'deleted-node' } }); assert.equal(store.ui.focused, store.graph.rootNodeId);
  assert.equal(validateGraph(store.graph), store.graph);
});

test('memory-only named versions stay consistent in the current store, reopened tree and export', t => {
  const storage = new MemoryStorage(); storage.failRead = true; storage.failWrite = true;
  const { library } = fixture(storage), entry = library.create('thought', '内存中的想法');
  const { store, statuses } = open(t, library, entry.id);
  const version = store.snapshot('本次页面版本');
  assert.ok(version); assert.equal(store.lastSaveCommitted, true);
  assert.equal(store.snapshots.length, 1);
  assert.equal(open(t, library, entry.id).store.snapshots[0].id, version.id);
  assert.equal(library.exportTree(entry.id).document.snapshots[0].id, version.id);
  assert.equal(store.save(), false); assert.equal(store.lastSaveCommitted, true);
  assert.equal(statuses.at(-1).state, 'error'); assert.match(statuses.at(-1).message, /页面内存.*刷新会丢失/);
  assert.equal(storage.writes.length, 0);
});

test('quota fallback snapshot restore commits one consistent session version without claiming browser persistence', t => {
  const { library, storage } = fixture(), entry = library.create('career', '最初标题');
  const { store, statuses } = open(t, library, entry.id), version = store.snapshot('最初的版本');
  store.commit([{ op: 'rename_graph', title: '当前标题' }]); assert.equal(store.save(), true);
  const lastDurable = storage.getItem(library.keys(entry.id).graph);
  storage.failWrite = true;
  assert.equal(store.restoreSnapshotById(version.id), true);
  assert.equal(store.lastSaveCommitted, true); assert.equal(store.graph.title, '最初标题');
  assert.equal(open(t, library, entry.id).store.graph.title, '最初标题');
  assert.equal(library.exportTree(entry.id).document.graph.title, '最初标题');
  assert.equal(storage.getItem(library.keys(entry.id).graph), lastDurable);
  assert.equal(statuses.at(-1).state, 'error'); assert.match(statuses.at(-1).message, /页面内存/);
  assert.equal(store.undo(), true); assert.equal(store.graph.title, '当前标题');
  assert.equal(store.save(), false); assert.equal(open(t, library, entry.id).store.graph.title, '当前标题');
});

test('quota fallback graph import keeps current, reopened and exported state aligned and remains undoable', t => {
  const { library, storage } = fixture(), entry = library.create('blank', '导入之前');
  const { store, statuses } = open(t, library, entry.id), originalId = store.graph.graphId;
  const imported = createGraph({ title: '导入的新规划' });
  const lastDurable = storage.getItem(library.keys(entry.id).graph);
  storage.failWrite = true;
  assert.equal(store.importGraph(imported), true);
  assert.equal(store.lastSaveCommitted, true); assert.equal(store.graph.graphId, originalId);
  assert.equal(store.graph.title, '导入的新规划');
  assert.equal(open(t, library, entry.id).store.graph.title, '导入的新规划');
  assert.equal(library.exportTree(entry.id).document.graph.title, '导入的新规划');
  assert.equal(storage.getItem(library.keys(entry.id).graph), lastDurable);
  assert.equal(statuses.at(-1).state, 'error'); assert.match(statuses.at(-1).message, /页面内存/);
  assert.equal(store.undo(), true); assert.equal(store.graph.title, '导入之前');
  assert.equal(store.save(), false); assert.equal(open(t, library, entry.id).store.graph.title, '导入之前');
});
