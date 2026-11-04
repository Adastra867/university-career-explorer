import { validateGraph, pathsTo } from './graph.js';

const lifeKinds = new Set(['value', 'passion', 'desire', 'philosophy', 'lifestyle', 'life_event']);
function mentionsPrivate(value, graph) {
  const text = String(value || '').normalize('NFKC').toLowerCase();
  return graph.nodes.filter(n => n.private).some(n => {
    const title = n.title.normalize('NFKC').toLowerCase();
    return title.length >= 2 && text.includes(title);
  });
}

export function filterGraphView(graph, visible, view = 'all') {
  if (view === 'all') return visible;
  const ids = new Set(visible.nodes.filter(n => n.id === graph.rootNodeId || (view === 'career' ? !lifeKinds.has(n.kind) : lifeKinds.has(n.kind) || n.kind === 'goal')).map(n => n.id));
  return { nodes: visible.nodes.filter(n => ids.has(n.id)), edges: visible.edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
}

function withoutEvidence(node, graph) {
  return { ...node, description: graph && mentionsPrivate(node.description, graph) ? '' : node.description, attributes: {}, sourceIds: [], knowledgeStatus: node.knowledgeStatus === 'verified' ? 'unverified' : node.knowledgeStatus };
}
function withoutEdgeEvidence(edge, graph, publicly = false) {
  return { ...edge, requirements: edge.requirements.filter(r => !graph || !mentionsPrivate([r.label, r.detail, r.evidenceNote].join(' '), graph)).map(r => ({ ...r, ...(publicly ? { assessment: 'unknown', evidenceNote: '' } : r.assessment === 'evidenced' && !r.evidenceNote?.trim() ? { assessment: 'unknown' } : {}), sourceIds: [], knowledgeStatus: r.knowledgeStatus === 'verified' ? 'unverified' : r.knowledgeStatus })) };
}

// A graph's private reflections, uploads, tasks and profile never ride along
// with a node request. Research/profile have their own explicit consent.
export function projectAIContext(graph, selectedIds, scope = 'path') {
  validateGraph(graph);
  const safe = new Set(graph.nodes.filter(n => !n.private && !mentionsPrivate(n.title, graph)).map(n => n.id));
  const allowed = new Set();
  if (scope === 'tree') safe.forEach(id => allowed.add(id));
  else for (const id of selectedIds) {
    if (scope !== 'node') for (const path of pathsTo(graph, id, { maxDepth: 300 })) {
      if (path.nodeIds.every(n => safe.has(n))) path.nodeIds.forEach(n => allowed.add(n));
    }
    if (safe.has(id)) allowed.add(id);
  }
  allowed.add(graph.rootNodeId);
  const nodes = graph.nodes.filter(n => allowed.has(n.id)).map(n => {
    const placeholder = n.private || !safe.has(n.id) || (scope === 'node' && n.id === graph.rootNodeId && !selectedIds.includes(n.id));
    return withoutEvidence(placeholder ? { ...n, title: '起点（内容未授权）', description: '', private: true, shareAllowed: false } : n, graph);
  });
  const edges = graph.edges.filter(e => allowed.has(e.from) && allowed.has(e.to) && safe.has(e.from) && safe.has(e.to)).map(e => withoutEdgeEvidence(e, graph));
  const edgeIds = new Set(edges.map(e => e.id));
  const { sources, tasks, reflections, ownerId, ...base } = graph;
  return validateGraph({ ...base, title: scope === 'tree' && !mentionsPrivate(graph.title, graph) ? graph.title : '人生树（选定范围）', nodes, edges, savedPaths: graph.savedPaths.filter(p => p.edgeIds.every(id => edgeIds.has(id))).map(p => ({ ...p, title: '已选路径', note: '' })) });
}

export function projectRouteContext(graph, edgeIds, { parentId, includeChildren = false } = {}) {
  validateGraph(graph);
  if (!Array.isArray(edgeIds) || edgeIds.length > 300 || new Set(edgeIds).size !== edgeIds.length) throw new Error('请选择一条有效的完整路线。');
  const chain = edgeIds.map(id => graph.edges.find(e => e.id === id));
  if (chain.some(e => !e || !['possible_path', 'requires'].includes(e.relation)) || chain.some((e, i) => i && chain[i - 1].to !== e.from)) throw new Error('路线必须是连续的推进边链。');
  if (chain.length && chain[0].from !== graph.rootNodeId) throw new Error('请选择从起点到当前节点的完整路线。');
  const target = chain.at(-1)?.to || graph.rootNodeId;
  if (parentId && parentId !== target) throw new Error('所选路线没有抵达当前节点。');
  const ids = new Set(chain.length ? [chain[0].from, ...chain.map(e => e.to)] : [target]);
  const allowedEdges = new Set(edgeIds);
  if (includeChildren) for (const e of graph.edges.filter(e => e.from === target)) { ids.add(e.to); allowedEdges.add(e.id); }
  const safe = projectAIContext(graph, [...ids], 'node');
  if (chain.some(e => !safe.edges.some(candidate => candidate.id === e.id)) || safe.nodes.find(n => n.id === target)?.private) throw new Error('这条路线包含未授权的私密内容，请选择另一条路线。');
  safe.edges = safe.edges.filter(e => allowedEdges.has(e.id));
  const edgeSet = new Set(safe.edges.map(e => e.id));
  safe.savedPaths = safe.savedPaths.filter(p => p.edgeIds.every(id => edgeSet.has(id)));
  return validateGraph(safe);
}

export function publicGraph(graph) {
  validateGraph(graph);
  const allowed = new Set(graph.nodes.filter(n => n.shareAllowed === true && !n.private && !mentionsPrivate(n.title, graph)).map(n => n.id));
  const root = graph.nodes.find(n => n.id === graph.rootNodeId);
  const nodes = graph.nodes.filter(n => allowed.has(n.id)).map(n => withoutEvidence(n, graph));
  if (!allowed.has(root.id)) nodes.unshift(withoutEvidence({ ...root, title: '人生树起点', description: '', phase: 'idea', private: false, shareAllowed: false }));
  const edges = graph.edges.filter(e => allowed.has(e.from) && allowed.has(e.to)).map(e => withoutEdgeEvidence(e, graph, true));
  const edgeIds = new Set(edges.map(e => e.id));
  const now = new Date().toISOString();
  const nodeIds = new Map(nodes.map(n => [n.id, `node_${crypto.randomUUID()}`]));
  const edgeIdMap = new Map(edges.map(e => [e.id, `edge_${crypto.randomUUID()}`]));
  return validateGraph({ schemaVersion: 1, graphId: `shared_${crypto.randomUUID()}`, title: '始于足下 · 分享副本', rootNodeId: nodeIds.get(root.id), nodes: nodes.map(n => ({ ...n, id: nodeIds.get(n.id), createdAt: now, updatedAt: now })), edges: edges.map(e => ({ ...e, id: edgeIdMap.get(e.id), from: nodeIds.get(e.from), to: nodeIds.get(e.to), createdAt: now, requirements: e.requirements.map(r => ({ ...r, id: `req_${crypto.randomUUID()}` })) })), savedPaths: graph.savedPaths.filter(p => p.edgeIds.every(id => edgeIds.has(id))).map(p => ({ ...p, id: `path_${crypto.randomUUID()}`, title: '已选路径', edgeIds: p.edgeIds.map(id => edgeIdMap.get(id)), selectedAt: now, note: '' })), revision: 0, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 } });
}

export function prepareImport(input) {
  validateGraph(input);
  const imported = structuredClone(input);
  // Imported provenance is user-supplied. It needs fresh verification before
  // a file's claimed official status can appear as an independently checked fact.
  imported.nodes = imported.nodes.map(n => ({ ...n, shareAllowed: false, knowledgeStatus: n.knowledgeStatus === 'verified' ? 'unverified' : n.knowledgeStatus }));
  imported.edges = imported.edges.map(e => ({ ...e, requirements: e.requirements.map(r => ({ ...r, knowledgeStatus: r.knowledgeStatus === 'verified' ? 'unverified' : r.knowledgeStatus, ...(r.assessment === 'evidenced' && !r.evidenceNote?.trim() ? { assessment: 'unknown' } : {}) })) }));
  if (imported.sources) imported.sources = imported.sources.map(s => ({ ...s, trustLevel: 'unverified' }));
  return validateGraph(imported);
}
