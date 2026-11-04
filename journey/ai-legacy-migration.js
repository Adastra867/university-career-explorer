import { STORAGE_KEY, BACKUP_KEY } from './store.js';
import { validateGraph } from './graph.js';

function failure(message, code = 'AI_LEGACY_COPY_INVALID') { return Object.assign(new Error(message), { code }); }

/**
 * Preserve each historical chat in AIStore before removing only its obsolete
 * ui.chat copy. No whole-key deletion and no writes to assessments/workspaces.
 * The graph store and source bytes remain owned by their existing adapters.
 */
export function migrateAndClearChatCopies({ storage, scopedStorage, graph, aiStore }) {
  validateGraph(graph);
  const sources = [
    { storage: scopedStorage, key: STORAGE_KEY, global: false },
    { storage: scopedStorage, key: BACKUP_KEY, global: false },
    { storage, key: STORAGE_KEY, global: true },
    { storage, key: BACKUP_KEY, global: true },
  ];
  const visited = new Map();
  let cleaned = 0;
  try {
    for (const source of sources) {
      const keys = visited.get(source.storage) || new Set();
      if (keys.has(source.key)) continue;
      keys.add(source.key); visited.set(source.storage, keys);
      const raw = source.storage.getItem(source.key);
      if (raw === null) continue;
      let document;
      try { document = JSON.parse(raw); } catch { throw failure('旧聊天副本无法解析，原串保留；请先导出备份'); }
      if (!document || typeof document !== 'object' || Array.isArray(document)) throw failure('旧聊天副本格式损坏，原串保留');
      // The global source can belong to a different tree. Never touch it without
      // the original root identity tying it to this migrated tree.
      if (source.global && document.graph?.rootNodeId !== graph.rootNodeId) continue;
      if (!document.ui || typeof document.ui !== 'object' || Array.isArray(document.ui)) {
        if (document.ui === undefined) continue;
        throw failure('旧聊天界面状态损坏，原串保留');
      }
      if (!Object.hasOwn(document.ui, 'chat')) continue;
      if (source.storage.persistent === false) throw failure('旧聊天副本目前仅在页面内存，无法确认磁盘原件清理；请先导出备份', 'AI_LEGACY_SOURCE_VOLATILE');
      validateGraph(document.graph);
      if (document.graph.rootNodeId !== graph.rootNodeId) throw failure('当前聊天副本不属于这棵树，未迁移或覆盖');
      const messages = document.ui.chat;
      if (!Array.isArray(messages)) throw failure('旧聊天记录格式损坏，原串保留');
      // This method validates every pair and persists the complete batch before
      // returning. It is graph-scoped and independent of later graph revisions.
      if (messages.length) aiStore.migrateLegacyConversation(graph, messages);
      if (source.storage.getItem(source.key) !== raw) throw failure('另一页已改变旧聊天副本，问答已保存但未覆盖该副本；请重新读取', 'AI_LEGACY_SOURCE_CHANGED');
      delete document.ui.chat;
      const encoded = JSON.stringify(document);
      source.storage.setItem(source.key, encoded);
      if (source.storage.persistent === false) {
        // TreeLibrary can fall back to memory instead of throwing quota errors.
        // Do not report a privacy cleanup while its disk copy still has chat.
        if (source.storage.getItem(source.key) === encoded) source.storage.setItem(source.key, raw);
        throw failure('浏览器未能清理磁盘聊天原件，原串已保留；问答已迁入独立历史，请先导出备份', 'AI_LEGACY_SOURCE_VOLATILE');
      }
      if (source.storage.getItem(source.key) !== encoded) throw failure('聊天副本清理后又被其他页面改变，请重新读取并确认', 'AI_LEGACY_SOURCE_CHANGED');
      cleaned++;
    }
    return cleaned;
  } catch (error) {
    error.cleanedCopies = cleaned;
    throw error;
  }
}
