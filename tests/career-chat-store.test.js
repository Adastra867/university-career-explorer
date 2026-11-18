import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/career-chat-store.js';

const { CareerChatStore } = globalThis;
class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = []; this.failRead = false; this.failWrite = false; }
  getItem(key) {
    if (this.failRead) throw new Error('SecurityError');
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failWrite) throw new Error('QuotaExceededError');
    this.values.set(key, String(value));
    this.writes.push(key);
  }
}

function session(id = 'session-a', values = {}) {
  return { id, createdAt: '2026-11-18T10:00:00.000Z', messages: [], ...values };
}

function user(content = '我做过电池仿真，想了解跨学科机会。') {
  return { id: 'message-user', role: 'user', content, createdAt: '2026-11-18T10:00:00.000Z' };
}

function fixture() {
  const storage = new MemoryStorage();
  const statuses = [];
  const store = CareerChatStore.create({ storage, onStatus: value => statuses.push(value) });
  return { storage, store, statuses };
}

test('chat sessions restore drafts, attachments, task context and structured answers independently of planning records', () => {
  const { storage, store } = fixture();
  storage.setItem('careerIntelligenceV1', 'existing-plans');
  storage.setItem('careerIntelligenceDocumentsV1', 'existing-documents');
  const input = session('working-session', {
    title: '能源科研', task: 'compare', draft: '两条方向能否并行？',
    contextOptions: { profile: true, history: false, research: true, live: false, challenge: true, publicSearchQuery: '' },
    attachments: [{ id: 'doc-a', title: '我的项目.txt', kind: 'text', text: '我完成过一个仿真项目。' }],
    focusNode: { treeId: 'tree-a', nodeId: 'node-a', title: '研发', description: '验证项目兴趣', parentTitle: '起点' },
    routes: [{ id: 'route-a', title: '材料研发', description: '验证实验兴趣' }],
    messages: [user(), { id: 'message-ai', role: 'assistant', content: '可迁移数值建模能力。', metadata: {
      record: { id: 'insight-a', question: '我能探索什么？', result: { task: 'profile', summary: '分析', branches: [] } },
    } }],
  });
  const saved = store.save(input);
  assert.equal(saved.revision, 1);
  const restored = new CareerChatStore({ storage }).get(input.id);
  assert.deepEqual(restored, saved);
  assert.equal(storage.getItem('careerIntelligenceV1'), 'existing-plans');
  assert.equal(storage.getItem('careerIntelligenceDocumentsV1'), 'existing-documents');
  assert.deepEqual(new Set(storage.writes.slice(2)), new Set([CareerChatStore.KEY]));
  restored.messages[0].content = '试图修改读取副本';
  assert.equal(store.get(input.id).messages[0].content, input.messages[0].content);
});

test('first user message supplies a title and explicit renames remain stable and searchable', () => {
  const { store } = fixture();
  let current = store.save(session('session-a', { title: '新对话' }));
  current.messages.push(user('  想从\n  能源专业转向 AI 研究  '));
  current = store.save(current);
  assert.equal(current.title, '想从 能源专业转向 AI 研究');
  current = store.rename(current.id, '我的转型方案');
  assert.equal(store.list('转型')[0].id, current.id);
  assert.equal(store.list('ai 研究')[0].id, current.id);
  assert.equal(store.list('没有出现的关键词').length, 0);
  current = store.rename(current.id, '新对话');
  current.draft = '这个名字由我自己选择';
  assert.equal(store.save(current).title, '新对话');
});

test('queued and generating messages become interrupted on restore and stay interrupted after another session is saved', () => {
  const { store, storage } = fixture();
  const current = store.save(session('running', { messages: [
    user(),
    { id: 'message-ai-queued', role: 'assistant', status: 'queued', content: '' },
    { id: 'message-ai-generating', role: 'assistant', status: 'generating', content: '部分回答', metadata: { source: 'real-provider' } },
  ] }));
  assert.equal(store.get('running').messages[2].status, 'generating');
  const originalRaw = storage.getItem(store.key);
  const restored = CareerChatStore.create({ storage });
  assert.equal(storage.getItem(store.key), originalRaw);
  assert.deepEqual(restored.get('running').messages.slice(1).map(message => message.status), ['interrupted', 'interrupted']);
  restored.save(session('new-session'));
  assert.deepEqual(restored.get('running').messages.slice(1).map(message => message.status), ['interrupted', 'interrupted']);
  assert.equal(restored.get('running').messages[2].content, '部分回答');
  assert.equal(restored.get('running').revision, current.revision);
  assert.equal(restored.reload(), true);
  assert.equal(restored.get('running').messages[2].status, 'interrupted');
});

test('quota failure retains the old durable version and new draft, then retries with its original revision', () => {
  const { store, storage, statuses } = fixture();
  const current = store.save(session());
  const raw = storage.getItem(store.key);
  const changed = { ...current, draft: '不能丢失的尚未发送问题', attachments: [{ id: 'doc', title: '新资料', text: '我的项目' }] };
  storage.failWrite = true;
  assert.throws(() => store.save(changed), /QuotaExceededError/);
  assert.equal(storage.getItem(store.key), raw);
  assert.deepEqual(store.get(current.id), changed);
  assert.equal(store.exportData().sessions[0].draft, changed.draft);
  assert.deepEqual(store.state().pendingIds, [current.id]);
  assert.equal(statuses.at(-1).code, 'CHAT_STORAGE_UNAVAILABLE');
  storage.failWrite = false;
  const saved = store.save(changed);
  assert.equal(saved.revision, current.revision + 1);
  assert.deepEqual(store.state(), { blocked: false, error: null, pendingIds: [] });
  assert.equal(new CareerChatStore({ storage }).get(current.id).draft, changed.draft);
});

test('reload interrupts unsaved generating drafts without discarding their content or expected revision', () => {
  const { store, storage } = fixture();
  const saved = store.save(session());
  storage.failWrite = true;
  assert.throws(() => store.save({ ...saved, messages: [{ id: 'pending', role: 'assistant', content: '已收到的部分内容', status: 'generating' }] }));
  assert.equal(store.get(saved.id).messages[0].status, 'generating');
  assert.equal(store.reload(), true);
  const draft = store.get(saved.id);
  assert.equal(draft.messages[0].status, 'interrupted');
  assert.equal(draft.messages[0].content, '已收到的部分内容');
  assert.equal(draft.revision, saved.revision);
  storage.failWrite = false;
  assert.equal(store.save(draft).revision, saved.revision + 1);
});

test('corrupt or unsupported stored records stay byte-for-byte intact while new drafts remain exportable', () => {
  for (const raw of ['', '{malformed', '{"version":2,"sessions":[]}', '{"version":1,"sessions":[{}]}']) {
    const storage = new MemoryStorage();
    storage.setItem(CareerChatStore.KEY, raw);
    const statuses = [];
    const store = new CareerChatStore({ storage, onStatus: status => statuses.push(status) });
    assert.equal(store.state().blocked, true);
    assert.equal(statuses[0].code, 'CHAT_STORAGE_CORRUPT');
    assert.throws(() => store.save(session('new', { draft: '新输入仍保留' })), { code: 'CHAT_STORAGE_CORRUPT' });
    assert.equal(storage.getItem(store.key), raw);
    assert.equal(store.get('new').draft, '新输入仍保留');
    assert.equal(store.exportData().sessions[0].draft, '新输入仍保留');
    assert.equal(store.reload(), false);
    assert.equal(store.get('new').draft, '新输入仍保留');
  }
});

test('different session writes merge and stale same-session saves or deletions cannot overwrite newer work', () => {
  const { store, storage } = fixture();
  let first = store.save(session('first'));
  const other = CareerChatStore.create({ storage });
  other.save(session('second', { draft: '第二页的新对话' }));
  first = store.save({ ...first, draft: '第一页正常更新' });
  assert.equal(new CareerChatStore({ storage }).list().length, 2);
  const stale = other.get('first');
  assert.throws(() => other.save({ ...stale, draft: '旧页未发送草稿' }), { code: 'CHAT_SESSION_CONFLICT' });
  assert.equal(new CareerChatStore({ storage }).get('first').draft, first.draft);
  assert.equal(other.get('first').draft, '旧页未发送草稿');
  assert.throws(() => other.delete('first'), { code: 'CHAT_SESSION_CONFLICT' });
  assert.equal(other.reload(), true);
  assert.equal(other.get('first').draft, '旧页未发送草稿');
  assert.equal(other.state().pendingIds[0], 'first');
});

test('a deleted persisted session cannot be recreated by a stale page and new unsaved drafts can be removed', () => {
  const { store, storage } = fixture();
  const saved = store.save(session());
  const stalePage = new CareerChatStore({ storage });
  assert.equal(store.delete(saved.id), true);
  assert.equal(store.delete(saved.id), false);
  assert.throws(() => stalePage.save(saved), { code: 'CHAT_SESSION_CONFLICT' });
  assert.equal(new CareerChatStore({ storage }).get(saved.id), null);
  storage.failWrite = true;
  assert.throws(() => store.save(session('unsaved')), /QuotaExceededError/);
  assert.equal(store.delete('unsaved'), true);
  assert.equal(store.get('unsaved'), null);
  assert.deepEqual(store.state().pendingIds, []);
});

test('failed delete or rename retains all saved data and failed rename remains recoverable', () => {
  const { store, storage } = fixture();
  const saved = store.save(session());
  const raw = storage.getItem(store.key);
  storage.failWrite = true;
  assert.throws(() => store.delete(saved.id), /QuotaExceededError/);
  assert.deepEqual(store.get(saved.id), saved);
  assert.throws(() => store.rename(saved.id, '待保存的新标题'), /QuotaExceededError/);
  assert.equal(store.get(saved.id).title, '待保存的新标题');
  assert.equal(storage.getItem(store.key), raw);
  storage.failWrite = false;
  store.save(store.get(saved.id));
  assert.equal(new CareerChatStore({ storage }).get(saved.id).title, '待保存的新标题');
});

test('personal evidence excerpts are stripped recursively from persistence and export while source labels and messages remain', () => {
  const { store, storage } = fixture();
  const sources = [
    { sourceId: 'personal', origin: 'user_document', title: '我的简历', excerpt: '仅供当次分析的个人片段' },
    { sourceId: 'unverified-personal', verificationStatus: 'user_provided_unverified', excerpt: '另一个个人片段' },
    { sourceId: 'official', origin: 'official_snapshot', excerpt: '公开职业资料' },
  ];
  store.save(session('evidence-session', { messages: [{
    id: 'assistant', role: 'assistant', content: '对个人资料的分析。', metadata: { record: { result: { evidence: sources } } },
  }] }));
  assert.ok(!storage.getItem(store.key).includes('仅供当次分析的个人片段'));
  assert.ok(!JSON.stringify(store.exportData()).includes('另一个个人片段'));
  const restored = new CareerChatStore({ storage }).get('evidence-session').messages[0];
  assert.deepEqual(restored.metadata.record.result.evidence.map(source => source.excerpt), ['', '', '公开职业资料']);
  assert.equal(restored.content, '对个人资料的分析。');
  assert.equal(restored.metadata.record.result.evidence[0].title, '我的简历');
  assert.equal(store.get('evidence-session').messages[0].metadata.record.result.evidence[0].excerpt, sources[0].excerpt);
});

test('malformed writes fail before changing existing data or the last valid in-memory session', () => {
  const { store, storage } = fixture();
  const saved = store.save(session());
  const raw = storage.getItem(store.key);
  for (const patch of [
    { title: 42 }, { updatedAt: 'tomorrow' }, { revision: -1 }, { task: 'unknown' },
    { messages: [user(), user()] }, { messages: [{ ...user(), role: 'system' }] },
    { messages: [{ ...user(), status: 'unknown' }] }, { messages: [{ ...user(), metadata: 'not-an-object' }] },
    { attachments: [{}, {}, {}, {}] }, { contextOptions: [] }, { routes: {} },
    { focusNode: [] }, { unusedTypo: true },
  ]) {
    assert.throws(() => store.save({ ...saved, ...patch }), { code: 'INVALID_CHAT_DATA' });
    assert.equal(storage.getItem(store.key), raw);
    assert.deepEqual(store.get(saved.id), saved);
  }
});

test('read denial preserves a loaded draft and recovery does not silently discard unsaved content', () => {
  const { store, storage } = fixture();
  const saved = store.save(session());
  storage.failRead = true;
  assert.throws(() => store.save({ ...saved, draft: '读取失败时的新输入' }), /SecurityError/);
  assert.equal(store.reload(), false);
  assert.equal(store.get(saved.id).draft, '读取失败时的新输入');
  const blocked = new CareerChatStore({ storage });
  assert.equal(blocked.state().blocked, true);
  storage.failRead = false;
  assert.equal(store.reload(), true);
  assert.equal(store.get(saved.id).draft, '读取失败时的新输入');
  store.save(store.get(saved.id));
  assert.equal(new CareerChatStore({ storage }).get(saved.id).draft, '读取失败时的新输入');
});
