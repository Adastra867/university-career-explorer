(() => {
  'use strict';

  const KEY = 'careerChatSessionsV1';
  const TASKS = new Set(['profile', 'explore', 'plan', 'compare', 'growth']);
  const MESSAGE_STATUSES = new Set(['queued', 'generating', 'completed', 'interrupted', 'failed', 'stopped', 'cancelled']);
  const SESSION_FIELDS = new Set(['id', 'title', 'createdAt', 'updatedAt', 'messages', 'contextOptions', 'attachments', 'draft', 'focusNode', 'routes', 'task', 'revision', 'metadata']);
  const MESSAGE_FIELDS = new Set(['id', 'role', 'content', 'createdAt', 'updatedAt', 'status', 'attachments', 'metadata', 'result', 'question', 'error']);
  const copy = value => structuredClone(value);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

  function problem(code, message, draft) {
    return Object.assign(new Error(message), { code, ...(draft ? { draft: copy(draft) } : {}) });
  }

  function text(value, name, limit, empty = false) {
    if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) throw problem('INVALID_CHAT_DATA', `${name}格式不正确或超过 ${limit} 字。`);
    return value;
  }

  function date(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw problem('INVALID_CHAT_DATA', `${name}需要有效时间。`);
    return value;
  }

  function jsonValue(value, depth = 0) {
    if (depth > 40) throw problem('INVALID_CHAT_DATA', '聊天资料嵌套层级过多。');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!record(value) && !Array.isArray(value)) throw problem('INVALID_CHAT_DATA', '聊天资料包含无法保存的内容。');
    for (const child of Object.values(value)) jsonValue(child, depth + 1);
  }

  function attachments(value = []) {
    if (!Array.isArray(value) || value.length > 3 || value.some(item => !record(item))) throw problem('INVALID_CHAT_DATA', '一条消息或草稿最多保存 3 份附件。');
    jsonValue(value);
    return copy(value);
  }

  function messageData(input, fallbackDate) {
    if (!record(input) || Object.keys(input).some(key => !MESSAGE_FIELDS.has(key))) throw problem('INVALID_CHAT_DATA', '聊天消息格式不受支持。');
    text(input.id, '消息 ID', 160);
    if (!['user', 'assistant'].includes(input.role)) throw problem('INVALID_CHAT_DATA', '聊天消息角色不受支持。');
    text(input.content, '消息内容', 200000, true);
    const status = input.status ?? 'completed';
    if (!MESSAGE_STATUSES.has(status)) throw problem('INVALID_CHAT_DATA', '聊天消息状态不受支持。');
    if (input.updatedAt !== undefined) date(input.updatedAt, '消息更新时间');
    if (input.metadata !== undefined && !record(input.metadata)) throw problem('INVALID_CHAT_DATA', '消息附加资料需要为对象。');
    jsonValue(input);
    return { ...copy(input), createdAt: date(input.createdAt ?? fallbackDate, '消息时间'), status, attachments: attachments(input.attachments) };
  }

  function sessionData(input, restored = false) {
    if (!record(input) || Object.keys(input).some(key => !SESSION_FIELDS.has(key))) throw problem('INVALID_CHAT_DATA', '聊天会话格式不受支持。');
    const id = text(input.id, '会话 ID', 160);
    const createdAt = date(input.createdAt, '创建时间');
    const updatedAt = date(input.updatedAt ?? createdAt, '更新时间');
    const revision = input.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < (restored ? 1 : 0)) throw problem('INVALID_CHAT_DATA', '会话版本不正确。');
    if (!Array.isArray(input.messages)) throw problem('INVALID_CHAT_DATA', '聊天消息列表不正确。');
    const messages = input.messages.map(message => messageData(message, createdAt));
    if (new Set(messages.map(message => message.id)).size !== messages.length) throw problem('INVALID_CHAT_DATA', '聊天消息 ID 重复。');
    const task = input.task ?? 'explore';
    if (!TASKS.has(task)) throw problem('INVALID_CHAT_DATA', '聊天任务不受支持。');
    const contextOptions = input.contextOptions ?? {};
    if (!record(contextOptions)) throw problem('INVALID_CHAT_DATA', '资料设置格式不正确。');
    jsonValue(contextOptions);
    const focusNode = input.focusNode ?? null;
    if (focusNode !== null && !record(focusNode)) throw problem('INVALID_CHAT_DATA', '职业树节点上下文格式不正确。');
    jsonValue(focusNode);
    const routes = input.routes ?? [];
    if (!Array.isArray(routes)) throw problem('INVALID_CHAT_DATA', '职业路线列表格式不正确。');
    jsonValue(routes);
    const draft = text(input.draft ?? '', '输入草稿', 20000, true);
    const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim());
    const automaticTitle = firstUserMessage?.content.trim().replace(/\s+/g, ' ').slice(0, 36) || '新对话';
    if (input.title !== undefined) text(input.title, '会话标题', 120, true);
    const title = input.title?.trim() || automaticTitle;
    if (input.metadata !== undefined) jsonValue(input.metadata);
    return {
      ...copy(input), id, title, createdAt, updatedAt, revision, messages, task,
      contextOptions: copy(contextOptions), attachments: attachments(input.attachments), draft,
      focusNode: copy(focusNode), routes: copy(routes),
    };
  }

  function decode(raw) {
    if (raw === null) return [];
    if (typeof raw !== 'string') throw problem('CHAT_STORAGE_CORRUPT', '此浏览器的聊天记录格式不正确，原内容已保留。');
    let value;
    try { value = JSON.parse(raw); } catch { throw problem('CHAT_STORAGE_CORRUPT', '此浏览器的聊天记录无法读取，原内容已保留。'); }
    if (!record(value) || value.version !== 1 || !Array.isArray(value.sessions) || Object.keys(value).some(key => !['version', 'sessions'].includes(key))) {
      throw problem('CHAT_STORAGE_CORRUPT', '此浏览器的聊天记录版本不受支持，原内容已保留。');
    }
    try {
      const sessions = value.sessions.map(input => sessionData(input, true));
      if (new Set(sessions.map(session => session.id)).size !== sessions.length) throw new Error('重复会话');
      return sessions;
    } catch { throw problem('CHAT_STORAGE_CORRUPT', '此浏览器的聊天记录有损坏，原内容已保留。'); }
  }

  function persistentCopy(value) {
    if (Array.isArray(value)) return value.map(persistentCopy);
    if (!record(value)) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, persistentCopy(child)]));
    const documentSource = value.origin === 'user_document' || value.provenance === 'user_document' || value.verificationStatus === 'user_provided_unverified' || value.trustLevel === 'user_provided';
    if (documentSource && Object.hasOwn(result, 'excerpt')) result.excerpt = '';
    return result;
  }

  function restoreSession(session) {
    return { ...session, messages: session.messages.map(message =>
      ['queued', 'generating'].includes(message.status) ? { ...message, status: 'interrupted' } : message) };
  }

  class CareerChatStore {
    static KEY = KEY;
    static create(options) { return new CareerChatStore(options); }

    constructor({ storage, onStatus = () => {} } = {}) {
      this.key = KEY;
      this.onStatus = onStatus;
      this.sessions = new Map();
      this.pending = new Map();
      this.error = null;
      this.blocked = false;
      this.storage = storage;
      try {
        this.storage ??= globalThis.localStorage;
        this.adopt(this.read(), { restoring: true });
      } catch (error) { this.report(error, true); }
    }

    report(error, blocked = false) {
      this.error = { code: error.code || 'CHAT_STORAGE_UNAVAILABLE', message: error.message || '此浏览器暂时无法保存聊天记录。' };
      this.blocked = blocked;
      try { this.onStatus(copy(this.error)); } catch { /* Display callbacks do not change persistence results. */ }
      return error;
    }

    read() {
      if (!this.storage || typeof this.storage.getItem !== 'function') throw problem('CHAT_STORAGE_UNAVAILABLE', '此浏览器暂时无法读取聊天记录。');
      return decode(this.storage.getItem(KEY));
    }

    adopt(sessions, { restoring = false, savedId } = {}) {
      this.sessions = new Map(sessions.map(session => {
        const local = this.sessions.get(session.id);
        let loaded = restoreSession(session);
        if (savedId === session.id) loaded = session;
        else if (!restoring && local?.revision === session.revision) loaded = local;
        return [session.id, loaded];
      }));
      for (const [id, session] of this.pending) {
        const draft = restoring ? restoreSession(session) : session;
        this.pending.set(id, draft);
        this.sessions.set(id, draft);
      }
    }

    state() { return { blocked: this.blocked, error: copy(this.error), pendingIds: [...this.pending.keys()] }; }

    list(query = '') {
      const search = String(query).trim().normalize('NFKC').toLocaleLowerCase();
      return copy([...this.sessions.values()].reverse().filter(session => !search || [session.title, ...session.messages.map(message => message.content)]
        .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(search)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)));
    }

    get(id) { return this.sessions.has(id) ? copy(this.sessions.get(id)) : null; }

    reload() {
      try {
        this.adopt(this.read(), { restoring: true });
        this.error = null;
        this.blocked = false;
        return true;
      } catch (error) { this.report(error, true); return false; }
    }

    save(input) {
      const draft = sessionData(input);
      const local = this.sessions.get(draft.id);
      if (draft.title === '新对话' && draft.metadata?.titleEdited !== true && draft.messages.some(message => message.role === 'user' && message.content.trim()) && (!local || local.title === '新对话')) {
        draft.title = draft.messages.find(message => message.role === 'user' && message.content.trim()).content.trim().replace(/\s+/g, ' ').slice(0, 36);
      }
      this.pending.set(draft.id, copy(draft));
      this.sessions.set(draft.id, copy(draft));
      try {
        const latest = this.read();
        const current = latest.find(session => session.id === draft.id);
        if ((current?.revision ?? 0) !== draft.revision) throw problem('CHAT_SESSION_CONFLICT', '此对话已在另一页更新或删除，当前草稿已保留。请先导出草稿，再重新载入。', draft);
        const next = { ...draft, revision: draft.revision + 1, updatedAt: new Date().toISOString() };
        const safe = persistentCopy(next);
        const encoded = JSON.stringify({ version: 1, sessions: [...latest.filter(session => session.id !== draft.id), safe] });
        decode(encoded);
        this.storage.setItem(KEY, encoded);
        this.pending.delete(draft.id);
        this.adopt([...latest.filter(session => session.id !== draft.id), next], { savedId: next.id });
        this.error = null;
        this.blocked = false;
        return copy(next);
      } catch (error) { throw this.report(error, error.code === 'CHAT_STORAGE_CORRUPT'); }
    }

    rename(id, title) {
      const session = this.get(id);
      if (!session) throw problem('CHAT_SESSION_MISSING', '此对话已不存在。');
      return this.save({ ...session, title: text(title, '会话标题', 120).trim(), metadata: { ...session.metadata, titleEdited: true } });
    }

    delete(id) {
      const session = this.sessions.get(id);
      if (!session) return false;
      try {
        const latest = this.read();
        const current = latest.find(item => item.id === id);
        if (current && current.revision !== session.revision) throw problem('CHAT_SESSION_CONFLICT', '此对话已在另一页更新，请重新载入后再删除。');
        if (current) this.storage.setItem(KEY, JSON.stringify({ version: 1, sessions: latest.filter(item => item.id !== id) }));
        this.pending.delete(id);
        this.adopt(latest.filter(item => item.id !== id));
        this.error = null;
        this.blocked = false;
        return true;
      } catch (error) { throw this.report(error, error.code === 'CHAT_STORAGE_CORRUPT'); }
    }

    remove(id) { return this.delete(id); }

    exportData() {
      return {
        version: 1, sessions: persistentCopy(this.list()), pendingIds: [...this.pending.keys()],
        ...(this.error ? { error: copy(this.error) } : {}),
      };
    }
  }

  globalThis.CareerChatStore = CareerChatStore;
})();
