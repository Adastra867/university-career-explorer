import { TreeLibrary, TREE_TYPES } from './forest.js';
import { applyOperations, createGraph } from './graph.js';
import { projectAIContext } from './privacy.js';
import { GraphStore } from './store.js';

function requireText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}需要 1 至 ${max} 字。`);
  return value.trim();
}

function localTreeLibrary(storage) {
  let warning;
  const library = new TreeLibrary(storage, message => { warning = message; });
  if (!library.storageAvailable) throw new Error(warning || '当前浏览器无法读取职业树。');
  return library;
}

function openTree(library, entry, onStatus) {
  if (entry?.type !== 'career') return null;
  const store = new GraphStore(library.scopedStorage(entry.id), onStatus);
  return store.restored && !store.blocked && store.graph.graphId === entry.id ? store : null;
}

export function listCareerTrees(storage = globalThis.localStorage) {
  const library = localTreeLibrary(storage);
  return library.list().flatMap(entry => {
    const store = openTree(library, entry);
    if (!store) return [];
    const nodes = store.graph.nodes.filter(node => !node.private).map(({ id, title, kind }) => ({ id, title, kind }));
    return [{ id: entry.id, title: entry.title, rootNodeId: store.graph.rootNodeId, nodes }];
  });
}

export function getCareerNodeContext(treeId, nodeId, storage = globalThis.localStorage) {
  const library = localTreeLibrary(storage);
  const store = openTree(library, library.get(treeId));
  if (!store) throw new Error('这棵职业树暂时无法读取。');
  const safe = projectAIContext(store.graph, [nodeId], 'path');
  const node = safe.nodes.find(item => item.id === nodeId && !item.private);
  if (!node) throw new Error('请选择可用于 AI 分析的职业树节点。');
  const parentIds = new Set(safe.edges.filter(item => item.to === nodeId && ['possible_path', 'requires'].includes(item.relation)).map(item => item.from));
  const parent = parentIds.size === 1 ? safe.nodes.find(item => parentIds.has(item.id) && !item.private) : null;
  return { title: node.title, description: (node.description || '').slice(0, 1000), parentTitle: parent?.title || '' };
}

const branchFields = [
  'id', 'type', 'title', 'description', 'reason', 'goal', 'startingPoint', 'advantages', 'skillGaps', 'risks',
  'knowledge', 'credentials', 'practice', 'nextActions', 'verification', 'timeCost', 'economicCost',
  'opportunityCost', 'flexibility', 'confidence', 'evidenceIds', 'stages',
];

function branchSnapshot(branch) {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) throw new Error('职业分支格式无效。');
  const draft = structuredClone(Object.fromEntries(branchFields.filter(key => Object.hasOwn(branch, key)).map(key => [key, branch[key]])));
  draft.id = requireText(draft.id, 160, '分支 ID');
  draft.title = requireText(draft.title, 120, '节点名称');
  if (draft.description !== undefined && (typeof draft.description !== 'string' || draft.description.length > 2000)) throw new Error('节点说明最多 2000 字。');
  return draft;
}

function resultFor(treeId, nodeIds) {
  return { treeId, nodeIds, href: `/trees/${encodeURIComponent(treeId)}#node=${encodeURIComponent(nodeIds[0])}` };
}

/** Persist an explicitly confirmed selection through the same store as the canvas. */
export function saveCareerBranches({ treeId, parentNodeId, updateNodeId, branches, turnId, question, summary, evidence }, storage = globalThis.localStorage) {
  const sourceTurnId = requireText(turnId, 160, '问答 ID');
  if (!Array.isArray(branches) || branches.length < 1 || branches.length > 5) throw new Error('请选择 1 至 5 条职业分支。');
  const drafts = branches.map(branchSnapshot);
  if (new Set(drafts.map(branch => branch.id)).size !== drafts.length) throw new Error('同一条职业分支只能选一次。');
  if (!treeId && (parentNodeId || updateNodeId)) throw new Error('请先选择目标职业树。');
  if (updateNodeId && drafts.length !== 1) throw new Error('每次请选择一条建议更新节点。');

  const library = localTreeLibrary(storage);
  let storageError;
  const status = (state, message) => { if (state === 'error') storageError = message; };
  let store;
  if (treeId) {
    store = openTree(library, library.get(treeId), status);
    if (!store) throw new Error(storageError || '这棵职业树已删除或需要恢复。');
  } else {
    for (const entry of library.list()) {
      const candidate = openTree(library, entry);
      if (candidate?.graph.nodes[0]?.attributes?.careerIntelligenceTurnId === sourceTurnId) {
        store = candidate;
        treeId = entry.id;
        break;
      }
    }
  }

  const graph = store?.graph || createGraph({ title: TREE_TYPES.career.title });
  const parentId = parentNodeId || graph.rootNodeId;
  if (!graph.nodes.some(node => node.id === parentId && !node.private)) throw new Error('目标节点已删除或设为私密，请重新选择。');
  const updateNode = graph.nodes.find(node => node.id === updateNodeId && node.id !== graph.rootNodeId && !node.private);
  if (updateNodeId && !updateNode) throw new Error('待更新节点已删除、设为私密或属于树的起点。');

  const childIds = new Set(graph.edges.filter(edge => edge.from === parentId && edge.relation === 'possible_path').map(edge => edge.to));
  const candidates = updateNode ? [updateNode] : graph.nodes.filter(node => childIds.has(node.id));
  const matched = new Map();
  for (const node of candidates) {
    const metadata = node.attributes?.careerIntelligence;
    if (metadata?.turnId === sourceTurnId) matched.set(metadata.branch?.id, node.id);
    if (!Array.isArray(metadata?.previous)) continue;
    for (const previous of metadata.previous) {
      if (previous?.turnId === sourceTurnId) matched.set(previous.branchId, node.id);
    }
  }
  const pending = drafts.filter(branch => !matched.has(branch.id));
  if (!pending.length) return resultFor(treeId, drafts.map(branch => matched.get(branch.id)));

  const operations = pending.flatMap(branch => {
    const metadata = {
      version: 1,
      turnId: sourceTurnId,
      question: typeof question === 'string' ? question.slice(0, 600) : '',
      summary: typeof summary === 'string' ? summary.slice(0, 900) : '',
      branch,
      evidence: evidenceForBranch(evidence, branch),
    };
    const fields = { title: branch.title, description: branch.description || '', knowledgeStatus: 'unverified' };
    if (updateNode) {
      const previous = updateNode.attributes?.careerIntelligence;
      if (typeof previous?.turnId === 'string' && typeof previous.branch?.id === 'string') {
        const older = Array.isArray(previous.previous) ? previous.previous : [];
        metadata.previous = [{ turnId: previous.turnId, branchId: previous.branch.id }, ...older].slice(0, 6);
      }
      const textChanged = fields.title !== updateNode.title || fields.description !== (updateNode.description || '');
      return [{ op: 'update_node', nodeId: updateNode.id, patch: {
        ...fields, knowledgeStatus: textChanged ? 'unverified' : updateNode.knowledgeStatus,
        attributes: { ...updateNode.attributes, careerIntelligence: metadata },
      } }];
    }
    const tempId = `career_branch_${crypto.randomUUID()}`;
    return [
      { op: 'add_node', tempId, node: { ...fields, kind: 'goal', phase: 'exploring', attributes: { careerIntelligence: metadata } } },
      { op: 'add_edge', fromId: parentId, toId: tempId, relation: 'possible_path' },
    ];
  });

  let next;
  if (store) {
    next = store.commit(operations, graph.revision);
    if (!store.save()) throw new Error(storageError || '职业树暂时无法保存，请重试。');
  } else {
    graph.nodes[0].title = TREE_TYPES.career.root;
    graph.nodes[0].attributes = { careerIntelligenceTurnId: sourceTurnId };
    next = applyOperations(graph, operations);
    const entry = library.addDocument('career', '', {
      storageVersion: 1, serial: crypto.randomUUID(), graph: next, undo: [graph], redo: [], snapshots: [],
      ui: { selected: [], collapsed: [], entered: true, focused: next.nodes[1].id },
    });
    if (!library.storageAvailable) {
      try { storage.removeItem(library.keys(entry.id).graph); } catch { /* An unindexed draft cannot overwrite an existing tree. */ }
      throw new Error('当前浏览器无法保存新的职业树。');
    }
    treeId = entry.id;
  }

  const writtenIds = updateNode ? [updateNode.id] : next.nodes.slice(graph.nodes.length).map(node => node.id);
  pending.forEach((branch, index) => matched.set(branch.id, writtenIds[index]));
  return resultFor(treeId, drafts.map(branch => matched.get(branch.id)));
}

function evidenceForBranch(evidence, branch) {
  if (!Array.isArray(evidence) || !Array.isArray(branch.evidenceIds)) return [];
  const referenced = new Set(branch.evidenceIds);
  return evidence.filter(item => item && referenced.has(item.sourceId)).slice(0, 8).map(item => ({
    sourceId: item.sourceId,
    title: typeof item.title === 'string' ? item.title.slice(0, 250) : '',
    ...(typeof item.url === 'string' && item.url.length <= 480 ? { url: item.url } : {}),
    ...(typeof item.checkedAt === 'string' ? { checkedAt: item.checkedAt.slice(0, 40) } : {}),
    ...(typeof item.verificationStatus === 'string' ? { verificationStatus: item.verificationStatus.slice(0, 60) } : {}),
  }));
}
