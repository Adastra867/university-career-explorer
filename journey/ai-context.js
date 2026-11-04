import { validateGraph, pathsTo } from './graph.js';
import { projectAIContext, projectRouteContext } from './privacy.js';

const scopes = { node: 'node', path: 'path', selection: 'multi_node', tree: 'graph' };
export function captureTurnBinding(graph, { question, focusNodeIds = [], scope = 'path', focusedPathEdgeIds, contextKey = '', threadId, clientRequestId = `request_${crypto.randomUUID()}`, model } = {}) {
  validateGraph(graph);
  if (!scopes[scope] || typeof question !== 'string' || !question.trim() || question.length > 4000) throw new Error('请提供有效问题和上下文范围。');
  const ids = [...new Set(focusNodeIds.length ? focusNodeIds : [graph.rootNodeId])];
  if (ids.length > 12 || ids.some(id => !graph.nodes.some(n => n.id === id))) throw new Error('问题关联节点不属于当前树。');
  let routes = [];
  if (scope === 'path' && ids.length === 1 && focusedPathEdgeIds !== undefined) {
    projectRouteContext(graph, focusedPathEdgeIds, { parentId: ids[0] });
    const edges = focusedPathEdgeIds.map(id => graph.edges.find(e => e.id === id));
    routes = [{ edgeIds: [...focusedPathEdgeIds], nodeIds: edges.length ? [edges[0].from, ...edges.map(e => e.to)] : [ids[0]] }];
  } else if (scope === 'path' || scope === 'selection') {
    routes = ids.flatMap(id => pathsTo(graph, id, { maxPaths: 8, maxDepth: 300 }).filter(p => p.nodeIds.every(nodeId => !graph.nodes.find(n => n.id === nodeId)?.private)));
  }
  const pathNodeIds = [...new Set(routes.flatMap(r => r.nodeIds))];
  const edgeIds = [...new Set(routes.flatMap(r => r.edgeIds))];
  const saved = routes.length === 1 ? graph.savedPaths.find(p => p.edgeIds.join(',') === routes[0].edgeIds.join(',')) : null;
  const label = scope === 'tree' ? '整张人生树（授权的公开范围）' : routes.length ? routes.map(p => p.nodeIds.map(id => graph.nodes.find(n => n.id === id)?.title).join(' → ')).join('；') : ids.map(id => graph.nodes.find(n => n.id === id)?.title).join('、');
  return { graphId: graph.graphId, rootNodeId: graph.rootNodeId, question: question.trim(), clientRequestId, scope: scopes[scope], graphRevisionAtAsk: graph.revision, focusNodeIds: ids, pathNodeIds, focusedPathEdgeIds: edgeIds, ...(saved ? { savedPathId: saved.id } : {}), pathSnapshotLabel: label.slice(0, 2000), contextKey, ...(threadId ? { threadId } : {}), ...(model ? { model } : {}) };
}

export function projectChatRequest(graph, ids, scope, focusedPathEdgeIds) {
  if (scope === 'path' && ids.length === 1 && focusedPathEdgeIds !== undefined) return projectRouteContext(graph, focusedPathEdgeIds, { parentId: ids[0] });
  return projectAIContext(graph, ids, scope);
}

export function authorizedThreadHistory(aiStore, graph, threadId, projectedGraph, consentPrefix, currentContextKey) {
  if (!threadId) return [];
  const allowed = new Set(projectedGraph.nodes.filter(n => !n.private).map(n => n.id));
  return aiStore.threadTurns(graph, threadId).filter(turn => turn.status === 'completed' && turn.contextKey?.startsWith(consentPrefix) && (!currentContextKey || turn.contextKey === currentContextKey) && (turn.scope !== 'graph' || turn.contextKey === currentContextKey) && turn.focusNodeIds.every(id => allowed.has(id)) && (turn.pathNodeIds || []).every(id => allowed.has(id))).slice(-4).flatMap(turn => [{ role: 'user', content: turn.question.slice(0, 1200) }, ...(turn.answer ? [{ role: 'assistant', content: turn.answer.slice(0, 1200) }] : [])]);
}
