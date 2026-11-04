import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateAndClearChatCopies } from '../journey/ai-legacy-migration.js';
import { AIStore, AI_STORAGE_KEY } from '../journey/ai-store.js';
import { STORAGE_KEY, BACKUP_KEY } from '../journey/store.js';
import { createGraph } from '../journey/graph.js';

class Storage {
  constructor() { this.values = new Map(); this.writes = []; this.failKeys = new Set(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failKeys.has(key)) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); this.values.set(key, value); this.writes.push(key); }
  removeItem(key) { this.values.delete(key); }
}
const chat = (question = '旧问题', answer = '旧答复') => [{ role: 'user', content: question }, { role: 'assistant', content: answer }];
function envelope(graph, messages) {
  return { storageVersion: 1, serial: 'source-serial-unchanged', graph: structuredClone(graph), undo: [], redo: [], snapshots: [], ui: { selected: [graph.rootNodeId], collapsed: [], entered: true, focused: graph.rootNodeId, view: 'all', chat: messages }, extraExistingMetadata: { kept: 'exact-value' } };
}
function setup() { const storage = new Storage(), scopedStorage = new Storage(), graph = createGraph(), aiStore = new AIStore(storage); return { storage, scopedStorage, graph, aiStore }; }
function withoutChat(document) { const copied = structuredClone(document); delete copied.ui.chat; return copied; }

test('all four copies migrate distinct history before removing only ui.chat and preserving every other JSON value', () => {
  const fixture = setup(); const { storage, scopedStorage, graph, aiStore } = fixture;
  const copies = [
    [scopedStorage, STORAGE_KEY, envelope(graph, chat('当前草稿问题', '当前草稿答复'))],
    [scopedStorage, BACKUP_KEY, envelope(graph, chat('备份独有历史', '备份独有答复'))],
    [storage, STORAGE_KEY, envelope({ ...graph, graphId: 'old-single-tree' }, chat('旧全局问题', '旧全局答复'))],
    [storage, BACKUP_KEY, envelope({ ...graph, graphId: 'old-single-tree' }, chat('旧全局备份问题', '旧全局备份答复'))],
  ];
  for (const [source, key, document] of copies) source.setItem(key, JSON.stringify(document));
  storage.setItem('career_answers', '职业测评原串'); storage.setItem('shiyu-zuxia.workspace.v1', '旧资料原串');
  assert.equal(migrateAndClearChatCopies(fixture), 4);
  for (const [source, key, document] of copies) assert.deepEqual(JSON.parse(source.getItem(key)), withoutChat(document));
  assert.equal(aiStore.exportData(graph.graphId).turns.length, 4);
  assert.equal(storage.getItem('career_answers'), '职业测评原串'); assert.equal(storage.getItem('shiyu-zuxia.workspace.v1'), '旧资料原串');
  assert.equal(aiStore.exportData().turns.every(turn => turn.scope === 'graph' && turn.pathSnapshotLabel.includes('原节点归属未知')), true);
});

test('a repeated cleanup is a no-op and a primary/backup with identical chat creates only one history turn', () => {
  const fixture = setup(); const document = envelope(fixture.graph, chat()); const raw = JSON.stringify(document);
  fixture.storage.setItem(STORAGE_KEY, raw); fixture.scopedStorage.setItem(STORAGE_KEY, raw); fixture.scopedStorage.setItem(BACKUP_KEY, raw);
  assert.equal(migrateAndClearChatCopies(fixture), 3); assert.equal(fixture.aiStore.exportData().turns.length, 1);
  const writes = fixture.storage.writes.length + fixture.scopedStorage.writes.length;
  assert.equal(migrateAndClearChatCopies(fixture), 0);
  assert.equal(fixture.storage.writes.length + fixture.scopedStorage.writes.length, writes);
});

test('global source belonging to a different root is left byte-for-byte intact', () => {
  const fixture = setup(); const unrelated = JSON.stringify(envelope(createGraph(), chat('其他树的问题', '其他树的答复')));
  fixture.storage.setItem(STORAGE_KEY, unrelated); fixture.storage.setItem(BACKUP_KEY, unrelated);
  assert.equal(migrateAndClearChatCopies(fixture), 0);
  assert.equal(fixture.storage.getItem(STORAGE_KEY), unrelated); assert.equal(fixture.storage.getItem(BACKUP_KEY), unrelated);
  assert.equal(fixture.aiStore.exportData().turns.length, 0);
});

test('AI storage quota failure preserves every original chat byte and does not half-migrate a pair', () => {
  const fixture = setup(); const raw = JSON.stringify(envelope(fixture.graph, [...chat(), { role: 'user', content: '第二个未回答问题' }]));
  fixture.scopedStorage.setItem(STORAGE_KEY, raw); fixture.storage.failKeys.add(AI_STORAGE_KEY);
  assert.throws(() => migrateAndClearChatCopies(fixture), error => error.name === 'QuotaExceededError' && error.cleanedCopies === 0);
  assert.equal(fixture.scopedStorage.getItem(STORAGE_KEY), raw); assert.equal(fixture.storage.getItem(AI_STORAGE_KEY), null); assert.equal(fixture.aiStore.exportData().turns.length, 0);
});

test('malformed source and malformed chat preserve original bytes without dropping user records', () => {
  for (const raw of ['{corrupt-original', JSON.stringify(envelope(createGraph(), { not: 'an array' }))]) {
    const fixture = setup();
    const input = raw.startsWith('{corrupt') ? raw : JSON.stringify(envelope(fixture.graph, { not: 'an array' }));
    fixture.scopedStorage.setItem(STORAGE_KEY, input);
    assert.throws(() => migrateAndClearChatCopies(fixture));
    assert.equal(fixture.scopedStorage.getItem(STORAGE_KEY), input); assert.equal(fixture.aiStore.exportData().turns.length, 0);
  }
});

test('a concurrent source update after history persistence is never overwritten and retry is idempotent', () => {
  const fixture = setup(); const { graph, scopedStorage, aiStore } = fixture;
  const old = envelope(graph, chat()); const changed = { ...structuredClone(old), serial: 'other-page-new-serial', titleFromAnotherPage: '不得覆盖' };
  scopedStorage.setItem(STORAGE_KEY, JSON.stringify(old));
  const migrate = aiStore.migrateLegacyConversation.bind(aiStore);
  aiStore.migrateLegacyConversation = (...args) => { const result = migrate(...args); scopedStorage.setItem(STORAGE_KEY, JSON.stringify(changed)); return result; };
  assert.throws(() => migrateAndClearChatCopies(fixture), error => error.code === 'AI_LEGACY_SOURCE_CHANGED');
  assert.deepEqual(JSON.parse(scopedStorage.getItem(STORAGE_KEY)), changed); assert.equal(aiStore.exportData().turns.length, 1);
  aiStore.migrateLegacyConversation = migrate;
  assert.equal(migrateAndClearChatCopies(fixture), 1); assert.equal(aiStore.exportData().turns.length, 1);
  assert.deepEqual(JSON.parse(scopedStorage.getItem(STORAGE_KEY)), withoutChat(changed));
});

test('failed source rewrite retains the original copy after successful history migration and can safely retry', () => {
  const fixture = setup(); const raw = JSON.stringify(envelope(fixture.graph, chat())); fixture.scopedStorage.setItem(STORAGE_KEY, raw);
  fixture.scopedStorage.failKeys.add(STORAGE_KEY);
  assert.throws(() => migrateAndClearChatCopies(fixture));
  assert.equal(fixture.scopedStorage.getItem(STORAGE_KEY), raw); assert.equal(fixture.aiStore.exportData().turns.length, 1);
  fixture.scopedStorage.failKeys.clear();
  assert.equal(migrateAndClearChatCopies(fixture), 1); assert.equal(fixture.aiStore.exportData().turns.length, 1);
});

test('same storage object is not processed twice and removing migrated history cannot resurrect source chat', () => {
  const fixture = setup(); fixture.scopedStorage = fixture.storage;
  fixture.storage.setItem(STORAGE_KEY, JSON.stringify(envelope(fixture.graph, chat('需要彻底删除的历史', '需要彻底删除的答复'))));
  assert.equal(migrateAndClearChatCopies(fixture), 1);
  const turn = fixture.aiStore.exportData().turns[0]; fixture.aiStore.deleteTurn(turn.turnId, fixture.graph.graphId);
  assert.equal(migrateAndClearChatCopies(fixture), 0); assert.equal(fixture.aiStore.exportData().turns.length, 0);
  assert.equal([...fixture.storage.values.values()].some(raw => raw.includes('需要彻底删除的历史') || raw.includes('需要彻底删除的答复')), false);
});

test('TreeLibrary memory fallback after a quota failure cannot falsely report disk chat cleanup', () => {
  const fixture = setup();
  class FallbackStorage extends Storage {
    constructor() { super(); this.persistent = true; this.fail = false; }
    setItem(key, value) {
      if (this.fail) { this.persistent = false; this.values.set(key, value); return; }
      super.setItem(key, value);
    }
  }
  const scoped = new FallbackStorage(); const raw = JSON.stringify(envelope(fixture.graph, chat('必须保留的源原文', '原答复')));
  scoped.setItem(STORAGE_KEY, raw); scoped.fail = true; fixture.scopedStorage = scoped;
  assert.throws(() => migrateAndClearChatCopies(fixture), error => error.code === 'AI_LEGACY_SOURCE_VOLATILE' && error.cleanedCopies === 0);
  assert.equal(scoped.getItem(STORAGE_KEY), raw); assert.equal(fixture.aiStore.exportData().turns[0].question, '必须保留的源原文');
});
