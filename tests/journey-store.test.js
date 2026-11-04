import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, STORAGE_KEY, BACKUP_KEY } from '../journey/store.js';
import { createGraph, validateGraph } from '../journey/graph.js';

class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = []; this.removals = []; this.failRead = false; this.failWrites = new Map(); this.failRemovals = new Map(); }
  getItem(key) {
    if (this.failRead) throw Object.assign(new Error('浏览器禁止存储访问'), { name: 'SecurityError' });
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    const failure = this.failWrites.get(key);
    if (failure) throw Object.assign(new Error(failure), { name: failure });
    this.values.set(key, String(value));
    this.writes.push({ key, value });
  }
  removeItem(key) {
    const failure = this.failRemovals.get(key);
    if (failure) throw Object.assign(new Error(failure), { name: failure });
    this.removals.push(key);
    this.values.delete(key);
  }
}
function setup(t, storage = new MemoryStorage()) {
  const statuses = [];
  const store = new GraphStore(storage, (state, message) => statuses.push({ state, message }));
  t.after(() => clearTimeout(store.timer));
  return { store, storage, statuses };
}
function rename(store, title) { return store.commit([{ op: 'rename_graph', title }]); }
function savedPair(t) {
  const fixture = setup(t);
  rename(fixture.store, '第一份有效版本');
  assert.equal(fixture.store.save(), true);
  const firstRaw = fixture.storage.getItem(STORAGE_KEY);
  rename(fixture.store, '第二份有效版本');
  assert.equal(fixture.store.save(), true);
  return { ...fixture, firstRaw, secondRaw: fixture.storage.getItem(STORAGE_KEY) };
}

test('local graph, layout, edge annotations and UI round-trip without touching legacy keys', t => {
  const { store, storage, statuses } = setup(t);
  storage.setItem('career_assessment_answers', 'legacy-data-exactly');
  const root = store.graph.rootNodeId;
  store.commit([
    { op: 'add_node', tempId: 'major', node: { kind: 'major', title: '材料工程', position: { x: 430, y: 210 } } },
    { op: 'add_edge', fromId: root, toId: 'major' },
  ]);
  store.commit([{ op: 'annotate_edge', edgeId: store.graph.edges[0].id, requirements: [{ kind: 'skill', label: '英语', detail: '由本人记录，项目要求待核对' }] }]);
  store.ui = { selected: [store.graph.nodes[1].id], collapsed: [root], entered: true };
  assert.equal(store.save(), true);
  const loaded = setup(t, storage).store;
  assert.equal(loaded.restored, true);
  assert.equal(loaded.blocked, false);
  assert.deepEqual(loaded.graph, store.graph);
  assert.deepEqual(loaded.ui, store.ui);
  assert.equal(loaded.undoStack.length, 2);
  assert.equal(storage.getItem('career_assessment_answers'), 'legacy-data-exactly');
  assert.equal(statuses.at(-1).state, 'saved');
});

test('debounced autosave persists only the latest quick edits', async t => {
  const { store, storage } = setup(t);
  rename(store, '快速输入一');
  rename(store, '快速输入二');
  rename(store, '最终标题');
  assert.equal(storage.getItem(STORAGE_KEY), null);
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).graph.title, '最终标题');
  assert.equal(storage.writes.filter(item => item.key === STORAGE_KEY).length, 1);
});

test('40-step undo/redo retains stable identities and monotonically increases revisions after reload', t => {
  const { store, storage } = setup(t);
  const root = store.graph.rootNodeId;
  for (let index = 0; index < 50; index++) rename(store, `第${index}次编辑`);
  assert.equal(store.undoStack.length, 40);
  assert.equal(store.graph.revision, 50);
  for (let index = 0; index < 40; index++) {
    const revision = store.graph.revision;
    assert.equal(store.undo(), true);
    assert.equal(store.graph.revision, revision + 1);
    assert.equal(store.graph.rootNodeId, root);
  }
  assert.equal(store.graph.title, '第9次编辑');
  assert.equal(store.graph.revision, 90);
  assert.equal(store.undo(), false);
  assert.equal(store.redoStack.length, 40);
  for (let index = 0; index < 40; index++) {
    const revision = store.graph.revision;
    assert.equal(store.redo(), true);
    assert.equal(store.graph.revision, revision + 1);
  }
  assert.equal(store.graph.title, '第49次编辑');
  assert.equal(store.graph.revision, 130);
  assert.equal(store.redo(), false);
  assert.equal(store.save(), true);
  const restored = setup(t, storage).store;
  assert.equal(restored.undo(), true);
  assert.equal(restored.graph.revision, 131);
  assert.equal(restored.graph.title, '第48次编辑');
  assert.equal(restored.redo(), true);
  assert.equal(restored.graph.revision, 132);
});

test('undo clears references to removed nodes and a new commit invalidates redo as one transaction', t => {
  const { store } = setup(t);
  store.commit([
    { op: 'add_node', tempId: 'a', node: { kind: 'career', title: '路线A' } },
    { op: 'add_node', tempId: 'b', node: { kind: 'career', title: '路线B' } },
    { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'a' },
    { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'b' },
  ]);
  const addedIds = store.graph.nodes.slice(1).map(node => node.id);
  store.ui.selected = [...addedIds]; store.ui.collapsed = [...addedIds];
  assert.equal(store.undo(), true);
  assert.equal(store.graph.nodes.length, 1);
  assert.deepEqual(store.ui.selected, []);
  assert.deepEqual(store.ui.collapsed, []);
  assert.equal(store.redo(), true);
  assert.deepEqual(store.graph.nodes.slice(1).map(node => node.id), addedIds);
  assert.equal(store.undo(), true);
  rename(store, '另一项编辑');
  assert.equal(store.redo(), false);
});

test('invalid or empty commits do not create partial graph state or history entries', t => {
  const { store } = setup(t);
  const before = JSON.stringify(store.graph);
  assert.throws(() => store.commit([{ op: 'rename_graph', title: 'x'.repeat(121) }]));
  assert.equal(JSON.stringify(store.graph), before);
  assert.equal(store.undoStack.length, 0);
  assert.equal(store.commit([]), store.graph);
  assert.equal(store.undoStack.length, 0);
  assert.equal(store.timer, null);
});

test('corrupt primary recovers backup without any automatic overwrite and explicit acceptance preserves backup', t => {
  const { storage, firstRaw } = savedPair(t);
  const corruptRaw = '{"user-original-text": broken';
  storage.setItem(STORAGE_KEY, corruptRaw);
  const writes = storage.writes.length;
  const { store, statuses } = setup(t, storage);
  assert.equal(store.recovery, true);
  assert.equal(store.restored, true);
  assert.equal(store.blocked, true);
  assert.equal(store.graph.title, '第一份有效版本');
  assert.equal(storage.writes.length, writes);
  rename(store, '恢复后的手动编辑');
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), corruptRaw);
  assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
  assert.match(statuses.at(-1).message, /保存失败/);
  assert.equal(store.save({ replace: true }), true);
  assert.equal(store.recovery, false);
  assert.equal(store.blocked, false);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).graph.title, '恢复后的手动编辑');
  assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
});

test('missing primary offers backup recovery rather than starting a fresh tree', t => {
  const { storage, firstRaw } = savedPair(t);
  storage.removeItem(STORAGE_KEY);
  const { store } = setup(t, storage);
  assert.equal(store.recovery, true);
  assert.equal(store.graph.title, '第一份有效版本');
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(store.save({ replace: true }), true);
  assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
});

test('corrupt primary and backup remain byte-for-byte intact while DIY and undo stay usable', t => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, 'original primary user data');
  storage.setItem(BACKUP_KEY, 'original backup user data');
  const { store, statuses } = setup(t, storage);
  assert.equal(store.blocked, true);
  assert.equal(store.recovery, false);
  rename(store, '仍能手工编辑');
  assert.equal(store.graph.title, '仍能手工编辑');
  assert.equal(store.undo(), true);
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), 'original primary user data');
  assert.equal(storage.getItem(BACKUP_KEY), 'original backup user data');
  assert.equal(statuses.at(-1).state, 'error');
});

test('an empty stored string is corruption and cannot silently become a new primary', t => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, '');
  const { store } = setup(t, storage);
  assert.equal(store.blocked, true);
  rename(store, '临时副本');
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), '');
});

test('primary quota failure preserves the old primary and serial, and a retry saves the in-memory draft', t => {
  const { store, storage, secondRaw } = savedPair(t);
  const serial = store.serial;
  rename(store, '未保存但保留的编辑');
  storage.failWrites.set(STORAGE_KEY, 'QuotaExceededError');
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), secondRaw);
  assert.equal(store.serial, serial);
  assert.equal(store.graph.title, '未保存但保留的编辑');
  assert.equal(setup(t, storage).store.graph.title, '第二份有效版本');
  storage.failWrites.delete(STORAGE_KEY);
  assert.equal(store.save(), true);
  assert.notEqual(store.serial, serial);
  assert.equal(setup(t, storage).store.graph.title, '未保存但保留的编辑');
});

test('backup quota failure does not prevent an atomic primary update and is disclosed in save status', t => {
  const { store, storage, firstRaw } = savedPair(t);
  const statuses = [];
  store.onStatus = (state, message) => statuses.push({ state, message });
  storage.failWrites.set(BACKUP_KEY, 'QuotaExceededError');
  rename(store, 'primary可以更新');
  assert.equal(store.save(), true);
  assert.equal(store.blocked, false);
  assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).graph.title, 'primary可以更新');
  assert.equal(statuses.at(-1).state, 'saved');
  assert.match(statuses.at(-1).message, /备份写入失败/);
});

test('serial conflict across pages cannot overwrite the first writer, even with replace=true', t => {
  const { store: first, storage } = setup(t);
  assert.equal(first.save(), true);
  const { store: second } = setup(t, storage);
  rename(first, '第一页更新');
  rename(second, '第二页尚未保存');
  assert.equal(first.save(), true);
  const winnerRaw = storage.getItem(STORAGE_KEY);
  assert.equal(second.save(), false);
  assert.equal(second.blocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), winnerRaw);
  assert.equal(second.graph.title, '第二页尚未保存');
  assert.equal(second.save({ replace: true }), false);
  assert.equal(storage.getItem(STORAGE_KEY), winnerRaw);
  assert.equal(second.reload(), true);
  assert.equal(second.graph.title, '第一页更新');
  assert.equal(second.blocked, false);
  rename(second, '读取后再次编辑');
  assert.equal(second.save(), true);
});

test('two fresh pages and a primary deleted elsewhere both detect conflicts', t => {
  const { store: first, storage } = setup(t);
  const { store: second } = setup(t, storage);
  assert.equal(first.save(), true);
  assert.equal(second.save(), false);
  assert.equal(second.blocked, true);
  const { store: loaded } = setup(t, storage);
  storage.removeItem(STORAGE_KEY);
  rename(loaded, '另一页已删除');
  assert.equal(loaded.save(), false);
  assert.equal(loaded.blocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('recovery acceptance refuses to overwrite a primary repaired by another page after the prompt', t => {
  const { storage, secondRaw } = savedPair(t);
  storage.setItem(STORAGE_KEY, 'broken-primary');
  const { store } = setup(t, storage);
  assert.equal(store.recovery, true);
  storage.setItem(STORAGE_KEY, secondRaw);
  assert.equal(store.save({ replace: true }), false);
  assert.equal(storage.getItem(STORAGE_KEY), secondRaw);
  assert.equal(store.reload(), true);
  assert.equal(store.recovery, false);
  assert.equal(store.graph.title, '第二份有效版本');
});

test('storage security failures report errors without preventing manual graph edits', t => {
  const storage = new MemoryStorage();
  storage.failRead = true;
  const { store, statuses } = setup(t, storage);
  assert.equal(store.blocked, true);
  assert.equal(validateGraph(store.graph), store.graph);
  rename(store, '隐私模式仍可编辑');
  assert.equal(store.undo(), true);
  assert.equal(store.redo(), true);
  assert.equal(store.graph.title, '隐私模式仍可编辑');
  assert.equal(store.save(), false);
  assert.equal(storage.writes.length, 0);
  assert.equal(statuses.at(-1).state, 'error');
});

test('invalid UI and foreign or malformed history are rejected before adoption', t => {
  const { storage, secondRaw, firstRaw } = savedPair(t);
  const valid = JSON.parse(secondRaw);
  for (const data of [
    { ...valid, ui: { selected: 'not-an-array' } },
    { ...valid, ui: { collapsed: null } },
    { ...valid, ui: { entered: 'yes' } },
    { ...valid, undo: {} },
    { ...valid, redo: [createGraph()] },
  ]) {
    const damaged = JSON.stringify(data);
    storage.setItem(STORAGE_KEY, damaged);
    const { store } = setup(t, storage);
    assert.equal(store.recovery, true);
    assert.equal(store.graph.title, '第一份有效版本');
    assert.equal(storage.getItem(STORAGE_KEY), damaged);
    assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
  }
});

test('failed reload preserves the complete current in-memory draft and original invalid bytes', t => {
  const { store, storage } = savedPair(t);
  rename(store, '先保留内存编辑');
  const graph = JSON.stringify(store.graph);
  const undo = JSON.stringify(store.undoStack);
  const serial = store.serial;
  storage.setItem(STORAGE_KEY, '{malformed');
  assert.equal(store.reload(), false);
  assert.equal(store.blocked, true);
  assert.equal(JSON.stringify(store.graph), graph);
  assert.equal(JSON.stringify(store.undoStack), undo);
  assert.equal(store.serial, serial);
  assert.equal(store.save(), false);
  assert.equal(storage.getItem(STORAGE_KEY), '{malformed');
});

test('storage-event handling cancels pending save while keeping an exportable local draft', async t => {
  const { store, storage, statuses } = setup(t);
  rename(store, '当前副本');
  store.changedElsewhere();
  await new Promise(resolve => setTimeout(resolve, 480));
  assert.equal(storage.writes.length, 0);
  assert.equal(store.graph.title, '当前副本');
  assert.equal(store.blocked, true);
  assert.equal(statuses.at(-1).state, 'error');
});

test('confirmed local deletion removes only journey keys and resets memory without saving the fresh graph', t => {
  const { store, storage } = savedPair(t);
  storage.setItem('career_answers', 'legacy-assessment');
  storage.setItem('career_history', 'legacy-reports');
  const oldGraphId = store.graph.graphId;
  rename(store, '一并删除尚未保存的编辑');
  store.ui.selected = [store.graph.rootNodeId];
  store.ui.collapsed = [store.graph.rootNodeId];
  const statuses = [];
  store.onStatus = (state, message) => statuses.push({ state, message });
  const writeCount = storage.writes.length;
  assert.equal(store.deleteLocal(), true);
  assert.deepEqual(storage.removals, [BACKUP_KEY, STORAGE_KEY]);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem(BACKUP_KEY), null);
  assert.equal(storage.getItem('career_answers'), 'legacy-assessment');
  assert.equal(storage.getItem('career_history'), 'legacy-reports');
  assert.equal(storage.writes.length, writeCount);
  assert.notEqual(store.graph.graphId, oldGraphId);
  assert.equal(store.graph.nodes.length, 1);
  assert.equal(store.graph.revision, 0);
  assert.deepEqual(store.undoStack, []);
  assert.deepEqual(store.redoStack, []);
  assert.deepEqual(store.ui, { selected: [], collapsed: [], entered: true });
  assert.equal(store.serial, null);
  assert.equal(store.timer, null);
  assert.equal(store.restored, false);
  assert.equal(store.recovery, false);
  assert.equal(store.blocked, false);
  assert.deepEqual(statuses.at(-1), { state: 'saved', message: '已删除本机旧草稿，可开始新的探索' });
});

test('local deletion rejects a serial conflict and never deletes another page newer version', t => {
  const { store: first, storage } = savedPair(t);
  const { store: second } = setup(t, storage);
  rename(first, '另一页的新版本');
  assert.equal(first.save(), true);
  const primary = storage.getItem(STORAGE_KEY);
  const backup = storage.getItem(BACKUP_KEY);
  const oldMemory = JSON.stringify(second.graph);
  assert.equal(second.deleteLocal(), false);
  assert.equal(second.blocked, true);
  assert.equal(JSON.stringify(second.graph), oldMemory);
  assert.equal(storage.getItem(STORAGE_KEY), primary);
  assert.equal(storage.getItem(BACKUP_KEY), backup);
  assert.deepEqual(storage.removals, []);
});

test('blocked recovery and inaccessible storage refuse deletion and preserve the in-memory graph', t => {
  const { storage } = savedPair(t);
  storage.setItem(STORAGE_KEY, 'original-corrupt-data');
  const { store: recovering } = setup(t, storage);
  const recovered = JSON.stringify(recovering.graph);
  const backup = storage.getItem(BACKUP_KEY);
  assert.equal(recovering.deleteLocal(), false);
  assert.equal(JSON.stringify(recovering.graph), recovered);
  assert.equal(storage.getItem(STORAGE_KEY), 'original-corrupt-data');
  assert.equal(storage.getItem(BACKUP_KEY), backup);
  const healthy = setup(t);
  assert.equal(healthy.store.save(), true);
  healthy.storage.failRead = true;
  const original = JSON.stringify(healthy.store.graph);
  assert.equal(healthy.store.deleteLocal(), false);
  assert.equal(JSON.stringify(healthy.store.graph), original);
  assert.deepEqual(healthy.storage.removals, []);
});

test('backup removal failure leaves both saved versions and the current memory intact', t => {
  const { store, storage, firstRaw, secondRaw } = savedPair(t);
  rename(store, '内存草稿保持');
  const memory = JSON.stringify(store.graph);
  const undo = JSON.stringify(store.undoStack);
  const serial = store.serial;
  storage.failRemovals.set(BACKUP_KEY, 'SecurityError');
  assert.equal(store.deleteLocal(), false);
  assert.equal(JSON.stringify(store.graph), memory);
  assert.equal(JSON.stringify(store.undoStack), undo);
  assert.equal(store.serial, serial);
  assert.equal(store.timer, null);
  assert.equal(storage.getItem(BACKUP_KEY), firstRaw);
  assert.equal(storage.getItem(STORAGE_KEY), secondRaw);
  assert.deepEqual(storage.removals, []);
});

test('primary removal failure preserves the saved primary and current graph after backup removal', t => {
  const { store, storage, secondRaw } = savedPair(t);
  rename(store, '内存修改不丢失');
  const memory = JSON.stringify(store.graph);
  const serial = store.serial;
  storage.failRemovals.set(STORAGE_KEY, 'SecurityError');
  assert.equal(store.deleteLocal(), false);
  assert.equal(JSON.stringify(store.graph), memory);
  assert.equal(store.serial, serial);
  assert.equal(storage.getItem(STORAGE_KEY), secondRaw);
  assert.equal(storage.getItem(BACKUP_KEY), null);
  assert.deepEqual(storage.removals, [BACKUP_KEY]);
});

test('a new unsaved store can be locally reset and subsequent intentional edits persist normally', t => {
  const { store, storage } = setup(t);
  rename(store, '新页面的未保存草稿');
  assert.equal(store.deleteLocal(), true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  rename(store, '重新开始的路线');
  assert.equal(store.save(), true);
  assert.equal(setup(t, storage).store.graph.title, '重新开始的路线');
});

test('unchanged repeated saves and a read-only reopened page do not write or change the serial', t => {
  const { store, storage } = savedPair(t);
  const serial = store.serial;
  const primary = storage.getItem(STORAGE_KEY);
  const backup = storage.getItem(BACKUP_KEY);
  const writeCount = storage.writes.length;
  for (let index = 0; index < 3; index++) assert.equal(store.save(), true);
  assert.equal(store.serial, serial);
  assert.equal(storage.writes.length, writeCount);
  assert.equal(storage.getItem(STORAGE_KEY), primary);
  assert.equal(storage.getItem(BACKUP_KEY), backup);
  const { store: reopened, statuses } = setup(t, storage);
  assert.equal(reopened.save(), true);
  assert.equal(reopened.serial, serial);
  assert.equal(storage.writes.length, writeCount);
  assert.equal(statuses.at(-1).state, 'saved');
  rename(store, '原页继续真正编辑');
  assert.equal(store.save(), true);
  assert.notEqual(store.serial, serial);
});

test('identical content with a changed external serial still conflicts before the no-op comparison', t => {
  const { store, storage } = savedPair(t);
  const memory = JSON.stringify(store.graph);
  const oldSerial = store.serial;
  const external = JSON.parse(storage.getItem(STORAGE_KEY));
  external.serial = 'another-page-new-serial';
  const newerRaw = JSON.stringify(external);
  storage.setItem(STORAGE_KEY, newerRaw);
  const writeCount = storage.writes.length;
  assert.equal(store.save(), false);
  assert.equal(store.blocked, true);
  assert.equal(store.serial, oldSerial);
  assert.equal(JSON.stringify(store.graph), memory);
  assert.equal(storage.getItem(STORAGE_KEY), newerRaw);
  assert.equal(storage.writes.length, writeCount);
});

test('UI-only changes are persisted once while an unchanged graph and history stay intact', t => {
  const { store, storage } = savedPair(t);
  const oldSerial = store.serial;
  const revision = store.graph.revision;
  store.ui.selected = [store.graph.rootNodeId];
  assert.equal(store.save(), true);
  assert.notEqual(store.serial, oldSerial);
  assert.equal(store.graph.revision, revision);
  const writeCount = storage.writes.length;
  const serial = store.serial;
  assert.equal(store.save(), true);
  assert.equal(storage.writes.length, writeCount);
  assert.equal(store.serial, serial);
  assert.deepEqual(setup(t, storage).store.ui.selected, [store.graph.rootNodeId]);
});

function graphWithConditions(store) {
  store.commit([
    { op: 'add_node', tempId: 'major', node: { kind: 'major', title: '材料工程' } },
    { op: 'add_edge', fromId: store.graph.rootNodeId, toId: 'major' },
  ]);
  store.commit([{ op: 'annotate_edge', edgeId: store.graph.edges[0].id, requirements: [
    { kind: 'skill', label: '英语', detail: '本人记录，项目标准尚待核实', assessment: 'self_reported', evidenceNote: '已经完成一次英文课程作业' },
    { kind: 'experience', label: '科研经历', assessment: 'missing' },
    { kind: 'time', label: '时间成本', durationMonths: { min: 12, max: 24 } },
  ] }]);
}

test('P2 two named versions survive reload and restoring either keeps later history and edge annotations', t => {
  const { store, storage } = setup(t);
  graphWithConditions(store);
  const first = store.snapshot('当时的我', '保留三条边条件');
  assert.ok(first);
  const originalRequirements = structuredClone(store.graph.edges[0].requirements);
  rename(store, '现在的我');
  store.commit([{ op: 'add_reflection', reflection: { nodeId: store.graph.nodes[1].id, text: '我开始重新考虑研究方向' } }]);
  const second = store.snapshot('现在的我', '后续版本也必须保留');
  assert.ok(second);
  const loaded = setup(t, storage).store;
  assert.equal(loaded.snapshots.length, 2);
  const beforeRevision = loaded.graph.revision;
  assert.equal(loaded.restoreSnapshotById(first.id), true);
  assert.equal(loaded.graph.revision, beforeRevision + 1);
  assert.deepEqual(loaded.graph.edges[0].requirements, originalRequirements);
  assert.equal(loaded.graph.reflections, undefined);
  assert.equal(loaded.snapshots.length, 2);
  assert.equal(loaded.getSnapshot(second.id).graph.reflections[0].text, '我开始重新考虑研究方向');
  assert.equal(loaded.restoreSnapshotById(second.id), true);
  assert.equal(loaded.graph.revision, beforeRevision + 2);
  assert.equal(loaded.graph.title, '现在的我');
  assert.deepEqual(loaded.graph.edges[0].requirements, originalRequirements);
  assert.equal(loaded.undo(), true);
  assert.equal(loaded.graph.revision, beforeRevision + 3);
  assert.equal(loaded.snapshots.length, 2);
  assert.equal(loaded.save(), true);
  assert.equal(setup(t, storage).store.snapshots.length, 2);
});

test('P2 snapshot accessors cannot mutate persisted history or leak mutable graph references', t => {
  const { store } = setup(t);
  const version = store.snapshot('不可变历史', '说明');
  const list = store.snapshots;
  assert.equal(Object.isFrozen(list), true);
  assert.equal(Object.isFrozen(list[0]), true);
  assert.throws(() => list.push({}));
  const copy = store.getSnapshot(version.id);
  copy.graph.nodes[0].title = '不能改掉历史';
  copy.note = '不能改掉备注';
  assert.equal(store.getSnapshot(version.id).graph.nodes[0].title, '我 · 此刻');
  assert.equal(store.getSnapshot(version.id).note, '说明');
  assert.equal(store.getSnapshot('unknown-version'), null);
  assert.equal(store.graph.nodes[0].title, '我 · 此刻');
});

test('P2 quota failures roll back a new named version and a restore transaction in memory', t => {
  const { store, storage } = setup(t);
  const version = store.snapshot('原版本');
  rename(store, '当前编辑');
  assert.equal(store.save(), true);
  const graph = JSON.stringify(store.graph);
  const history = JSON.stringify(store.undoStack);
  const primary = storage.getItem(STORAGE_KEY);
  storage.failWrites.set(STORAGE_KEY, 'QuotaExceededError');
  assert.equal(store.snapshot('无法保存的版本'), null);
  assert.equal(store.snapshots.length, 1);
  assert.equal(store.restoreSnapshotById(version.id), false);
  assert.equal(JSON.stringify(store.graph), graph);
  assert.equal(JSON.stringify(store.undoStack), history);
  assert.equal(storage.getItem(STORAGE_KEY), primary);
  assert.equal(store.snapshots.length, 1);
});

test('P2 stale serial and revision checks protect snapshot, restore and import without losing local edits', t => {
  const { store: first, storage } = setup(t);
  const version = first.snapshot('原版本');
  const { store: second } = setup(t, storage);
  rename(first, '另一页新版本');
  assert.equal(first.save(), true);
  const raw = storage.getItem(STORAGE_KEY);
  const memory = JSON.stringify(second.graph);
  assert.equal(second.snapshot('过期命名'), null);
  assert.equal(second.restoreSnapshotById(version.id), false);
  assert.equal(second.importGraph(createGraph()), false);
  assert.equal(JSON.stringify(second.graph), memory);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(second.reload(), true);
  assert.equal(second.restoreSnapshotById(version.id, second.graph.revision - 1), false);
  assert.equal(second.importGraph(createGraph(), second.graph.revision - 1), false);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});

test('P2 confirmed graph import validates first, preserves local identity and remains undoable with old snapshots', t => {
  const { store } = setup(t);
  rename(store, '本机旧规划');
  const localVersion = store.snapshot('本机旧版本');
  const oldId = store.graph.graphId;
  const oldRoot = store.graph.rootNodeId;
  const importedStore = setup(t).store;
  graphWithConditions(importedStore);
  importedStore.commit([
    { op: 'add_task', task: { title: '真实导入的计划', edgeId: importedStore.graph.edges[0].id, requirementId: importedStore.graph.edges[0].requirements[0].id } },
    { op: 'add_reflection', reflection: { nodeId: importedStore.graph.rootNodeId, text: '根上的自愿反思' } },
  ]);
  const incoming = structuredClone(importedStore.graph);
  const beforeRevision = store.graph.revision;
  assert.equal(store.importGraph(JSON.stringify(incoming)), true);
  assert.equal(store.graph.graphId, oldId);
  assert.equal(store.graph.rootNodeId, oldRoot);
  assert.equal(store.graph.revision, beforeRevision + 1);
  assert.equal(store.graph.edges[0].from, oldRoot);
  assert.equal(store.graph.reflections[0].nodeId, oldRoot);
  assert.deepEqual(store.graph.edges[0].requirements, incoming.edges[0].requirements);
  assert.equal(store.snapshots.length, 1);
  assert.equal(validateGraph(store.graph), store.graph);
  assert.equal(store.undo(), true);
  assert.equal(store.graph.title, '本机旧规划');
  assert.equal(store.snapshots[0].id, localVersion.id);
  assert.equal(store.redo(), true);
  assert.equal(store.graph.tasks[0].title, '真实导入的计划');
  const saved = JSON.stringify(store.graph);
  assert.equal(store.importGraph({ ...incoming, schemaVersion: 99 }), false);
  assert.equal(store.importGraph('{bad-json'), false);
  assert.equal(JSON.stringify(store.graph), saved);
});

test('P2 archive import merges named versions without erasing existing or duplicate IDs', t => {
  const { store } = setup(t);
  const local = store.snapshot('本机版本');
  const other = setup(t).store;
  graphWithConditions(other);
  const incomingVersion = other.snapshot('外部旧版本');
  rename(other, '外部当前版本');
  const archive = other.exportArchive();
  assert.equal(archive.archiveVersion, 1);
  assert.equal(store.importGraph(archive), true);
  assert.equal(store.snapshots.length, 2);
  assert.ok(store.getSnapshot(local.id));
  assert.ok(store.getSnapshot(incomingVersion.id));
  assert.equal(store.graph.title, '外部当前版本');
  assert.equal(store.importGraph(archive), true);
  assert.equal(store.snapshots.length, 2);
  archive.snapshots[0].title = '同ID另一份内容';
  assert.equal(store.importGraph(archive), true);
  assert.equal(store.snapshots.length, 3);
  assert.equal(new Set(store.snapshots.map(item => item.id)).size, 3);
  assert.ok(store.snapshots.some(item => item.title === '外部旧版本'));
  assert.ok(store.snapshots.some(item => item.title === '同ID另一份内容'));
});

test('P2 old envelopes remain compatible, and named snapshots participate in no-op save and local deletion', t => {
  const { store, storage } = savedPair(t);
  const old = JSON.parse(storage.getItem(STORAGE_KEY));
  delete old.snapshots;
  const oldRaw = JSON.stringify(old);
  storage.setItem(STORAGE_KEY, oldRaw);
  const loaded = setup(t, storage).store;
  assert.deepEqual(loaded.snapshots, []);
  const writes = storage.writes.length;
  assert.equal(loaded.save(), true);
  assert.equal(storage.writes.length, writes);
  assert.equal(storage.getItem(STORAGE_KEY), oldRaw);
  const named = loaded.snapshot('新增长期版本');
  assert.ok(named);
  const serial = loaded.serial;
  const namedWrites = storage.writes.length;
  assert.equal(loaded.save(), true);
  assert.equal(storage.writes.length, namedWrites);
  assert.equal(loaded.serial, serial);
  assert.equal(loaded.deleteLocal(), true);
  assert.deepEqual(loaded.snapshots, []);
});

test('P2 full version capacity reports failure without trimming old or later records', t => {
  const { store } = setup(t);
  const ids = [];
  for (let index = 0; index < 30; index++) ids.push(store.snapshot(`版本${index}`).id);
  assert.equal(store.snapshot('不得挤掉旧记录'), null);
  assert.deepEqual(store.snapshots.map(item => item.id), ids);
  assert.equal(store.restoreSnapshotById(ids[0]), true);
  assert.deepEqual(store.snapshots.map(item => item.id), ids);
});

test('P1 task reference cleanup is undoable along with the original edge evidence', t => {
  const { store } = setup(t);
  graphWithConditions(store);
  const edgeId = store.graph.edges[0].id;
  const requirementId = store.graph.edges[0].requirements[0].id;
  store.commit([{ op: 'add_task', task: { title: '我的准备计划', edgeId, requirementId } }]);
  store.commit([{ op: 'delete_edge', edgeId }]);
  assert.equal(store.graph.tasks[0].edgeId, undefined);
  assert.equal(store.graph.tasks[0].requirementId, undefined);
  assert.equal(store.undo(), true);
  assert.equal(store.graph.tasks[0].edgeId, edgeId);
  assert.equal(store.graph.tasks[0].requirementId, requirementId);
  assert.equal(store.graph.edges[0].requirements[0].evidenceNote, '已经完成一次英文课程作业');
});
