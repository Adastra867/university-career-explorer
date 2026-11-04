import { AIStore, AI_STORAGE_KEY } from './ai-store.js';
import { createAIPanels } from './ai-panels.js';
import { captureTurnBinding, projectChatRequest, authorizedThreadHistory } from './ai-context.js';
import { projectAIContext } from './privacy.js';
import { validateProposal, pathsTo } from './graph.js';
import { readAIResponse } from './ai-client.js';

const $ = id => document.getElementById(id);
const storeScopes = { node: 'node', path: 'path', multi_node: 'selection', graph: 'tree' };

export function createAIIntegration(ctx) {
  const aiStore = new AIStore(ctx.storage, (_state, message) => ctx.toast(message));
  const threads = new Map();
  let active = null, epoch = 0, continuation = null, historyViewport = null;
  const consentPrefix = () => `${ctx.consentKey()}\n`;
  const graph = ctx.graph;
  const safeUpdate = (id, patch, graphId) => {
    const existing = aiStore.getTurn(id, graphId);
    if (!existing || ['completed', 'failed', 'cancelled', 'unconfigured'].includes(existing.status)) return;
    try { return aiStore.updateTurn(id, patch, graphId); }
    catch (error) { ctx.toast(`${error.message}；当前回答仍可查看，请导出历史备份。`); }
  };
  function onHistoryToggle(open, historyElement) {
    if (!ctx.isActive()) { historyViewport = null; return; }
    if (!open) {
      if (historyViewport?.graphId === graph().graphId && JSON.stringify(graph().viewport) === JSON.stringify(historyViewport.adjusted)) { graph().viewport = historyViewport.before; ctx.paintViewport?.(); ctx.persistViewport?.(); }
      historyViewport = null; return;
    }
    const canvas = $('canvas').getBoundingClientRect(), overlay = historyElement.getBoundingClientRect();
    const selected = [...document.querySelectorAll('#nodes .node')].find(node => node.dataset.node === ctx.focus());
    if (!selected) return;
    const node = selected.getBoundingClientRect(), bottom = Math.min(canvas.bottom, overlay.top), available = bottom - canvas.top;
    const outsideX = node.left < canvas.left + 5 || node.right > canvas.right - 5;
    const outsideY = node.top < canvas.top + 5 || node.bottom > bottom - 5;
    if (available < 60 || (!outsideX && !outsideY)) return;
    const before = structuredClone(graph().viewport);
    graph().viewport = { ...before, x: before.x + (outsideX ? canvas.left + canvas.width / 2 - (node.left + node.width / 2) : 0), y: before.y + (outsideY ? canvas.top + available / 2 - (node.top + node.height / 2) : 0) };
    historyViewport = { graphId: graph().graphId, before, adjusted: structuredClone(graph().viewport) };
    ctx.paintViewport?.(); ctx.persistViewport?.();
  }
  const panels = createAIPanels({ ...ctx, aiStore, continueTurn, retryTurn, onHistoryToggle, fetchStatus: ctx.checkAI, onDeleteTurn: id => {
    if (active?.turnId === id) cancel();
    ctx.setMessages(ctx.messages().filter(m => m.turnId !== id));
    if (continuation?.turnId === id) continuation = null;
    if (ctx.activeTab() === 'chat') ctx.renderChat();
  } });

  function safeRoutes(id) {
    const safe = new Set(projectAIContext(graph(), [id], 'path').nodes.filter(n => !n.private).map(n => n.id));
    return pathsTo(graph(), id, { maxPaths: 12, maxDepth: 300 }).filter(p => p.nodeIds.every(nodeId => safe.has(nodeId)));
  }
  function selection() {
    const scope = $('scope').value;
    return scope === 'node' ? [ctx.focus()] : ctx.selectedIds().length ? ctx.selectedIds() : [ctx.focus() || graph().rootNodeId];
  }
  function updateBinding() {
    if (!$('aiBindingLabel')) {
      const label = document.createElement('div'); label.id = 'aiBindingLabel'; label.className = 'hint ai-binding-label';
      const select = document.createElement('select'); select.id = 'aiFocusPath'; select.setAttribute('aria-label', '选择本次完整路径');
      $('aiControls').prepend(select); $('aiControls').prepend(label);
      select.onchange = updateBinding;
    }
    const select = $('aiFocusPath'), ids = selection(), routes = ids.length === 1 && $('scope').value === 'path' ? safeRoutes(ids[0]) : [];
    const previous = select.value;
    select.replaceChildren(); select.hidden = routes.length <= 1;
    if (routes.length > 1) { const option = document.createElement('option'); option.value = ''; option.textContent = '请选择要讨论的具体路线'; select.append(option); }
    for (const p of routes) { const option = document.createElement('option'); option.value = p.edgeIds.join(','); option.textContent = p.nodeIds.map(id => ctx.nodeById(id)?.title).join(' → '); select.append(option); }
    if (routes.some(p => p.edgeIds.join(',') === previous)) select.value = previous;
    const chosen = routes.find(p => p.edgeIds.join(',') === select.value);
    const label = $('scope').value === 'tree' ? '整张树（仅授权范围）' : chosen ? chosen.nodeIds.map(id => ctx.nodeById(id)?.title).join(' → ') : ids.map(id => ctx.nodeById(id)?.title).join('、');
    let citedCount = 0;
    if (continuation) try {
      const scope = $('scope').value, outgoing = projectChatRequest(graph(), ids, scope, chosen?.edgeIds);
      const permitted = ids.filter(id => outgoing.nodes.some(n => n.id === id && !n.private));
      const key = `${consentPrefix()}${graph().graphId}:${graph().revision}:${scope}:${permitted.slice().sort().join(',')}:${chosen?.edgeIds.join(',') || ''}`;
      citedCount = authorizedThreadHistory(aiStore, graph(), continuation.threadId, outgoing, consentPrefix(), key).filter(m => m.role === 'user').length;
    } catch { /* No old messages are replayed outside the current authorization. */ }
    $('aiBindingLabel').textContent = `关联到：${label}${continuation ? ` · 继续问答 ${continuation.turnId.slice(-8)}，引用当前图版本和授权范围内的 ${citedCount} 条已完成记录` : ''}`;
  }
  function cancel() {
    if (!active) return;
    const request = active;
    request.controller.abort();
    safeUpdate(request.turnId, { status: 'cancelled', answer: request.partial, errorCode: 'AI_CANCELLED', errorMessage: '请求已取消；已保存问题及收到的部分回答。', completedAt: new Date().toISOString() }, request.graphId);
  }
  function invalidate({ close = false } = {}) {
    epoch++; cancel(); active = null; threads.clear(); continuation = null;
    ctx.setBusy(false); ctx.setController(null);
    panels.invalidate({ close });
  }
  function update() {
    if (!ctx.isActive()) return;
    if (!$('aiModelStatus')) { const status = document.createElement('div'); status.id = 'aiModelStatus'; status.className = 'hint'; $('modelSettings')?.after(status); }
    const modelState = ctx.aiState();
    if ($('aiModelStatus')) $('aiModelStatus').textContent = `${modelState.model || 'DeepSeek'} · ${({ unconfigured: '未配置', configured: '已配置 · 尚未验证', connected: '已连接', error: '最近连接失败' })[modelState.state] || (modelState.configured ? '已配置 · 尚未验证' : '未配置')}`;
    updateBinding(); panels.update();
    if (!$('chatHistoryShortcut')) { const shortcut = document.createElement('button'); shortcut.type = 'button'; shortcut.id = 'chatHistoryShortcut'; shortcut.className = 'btn small'; shortcut.textContent = '本节点历史'; shortcut.onclick = () => { ctx.showMobile(false); if ($('aiHistoryBar').getAttribute('aria-expanded') !== 'true') $('aiHistoryBar').click(); }; $('clearChat').before(shortcut); }
    for (const shell of document.querySelectorAll('#nodes .node')) {
      if (shell.querySelector('.node-ai')) continue;
      const node = ctx.nodeById(shell.dataset.node); if (!node) continue;
      const button = document.createElement('button'); button.className = 'node-ai'; button.type = 'button'; button.textContent = '✦ AI 建议'; button.dataset.aiSuggest = node.id;
      button.setAttribute('aria-label', `为${node.title}生成三个 AI 建议`); button.disabled = Boolean(node.private);
      button.onclick = event => { event.stopPropagation(); ctx.selectNode(node.id); panels.openSuggestions(node.id); };
      shell.append(button);
    }
    const detail = $('expandDetail');
    if (detail && !$('detailAISuggestions')) { const b = document.createElement('button'); b.id = 'detailAISuggestions'; b.type = 'button'; b.className = 'btn'; b.textContent = '✦ AI 建议'; b.disabled = Boolean(ctx.nodeById(ctx.focus())?.private); b.onclick = () => panels.openSuggestions(ctx.focus()); detail.parentElement.append(b); }
    document.querySelectorAll('.saved-path .view-path').forEach(b => {
      if (b.parentElement.querySelector('.path-narrative-link')) return;
      const button = document.createElement('button'); button.className = 'btn small path-narrative-link'; button.textContent = '路线介绍 / 历史'; button.dataset.pathId = b.dataset.id; button.onclick = () => panels.openNarrative(b.dataset.id); b.after(button);
    });
    if ($('growDialog').open && !$('growAISuggestions')) { const b = document.createElement('button'); b.type = 'button'; b.id = 'growAISuggestions'; b.className = 'btn'; b.textContent = '✦ 生成三个 AI 建议'; b.onclick = () => { const id = ctx.growParent(); $('growDialog').close(); ctx.selectNode(id); panels.openSuggestions(id); }; $('growForm').querySelector('.modal-actions').prepend(b); }
  }
  async function send(text, propose = false) {
    const question = text.trim(); if (!question || ctx.isBusy()) return;
    ctx.openChat(); updateBinding();
    const ids = selection(); let scope = $('scope').value, explicitPath;
    if (scope === 'selection' && ids.length === 1) scope = 'node';
    if (ids.length > 12) return ctx.toast('一次 AI 请求最多选择 12 个节点。');
    if (scope === 'path' && ids.length === 1 && !ctx.nodeById(ids[0])?.private) {
      const routes = safeRoutes(ids[0]);
      if (routes.length > 1 && !$('aiFocusPath').value) return ctx.toast('请先选择本次问题关联的具体路线。');
      if (routes.length) explicitPath = routes.find(p => p.edgeIds.join(',') === $('aiFocusPath').value)?.edgeIds || routes[0].edgeIds;
      else scope = 'node';
    }
    if (ids.every(id => ctx.nodeById(id)?.private)) scope = ids.length === 1 ? 'node' : 'selection';
    let turn, outgoing, contextKey;
    const privateOnly = ids.every(id => ctx.nodeById(id)?.private);
    try {
      outgoing = privateOnly ? null : projectChatRequest(graph(), ids, scope, explicitPath);
      const permittedIds = outgoing ? ids.filter(id => outgoing.nodes.some(n => n.id === id && !n.private)) : ids;
      contextKey = `${consentPrefix()}${graph().graphId}:${graph().revision}:${scope}:${permittedIds.slice().sort().join(',')}:${explicitPath?.join(',') || ''}`;
      const threadId = continuation?.graphId === graph().graphId ? continuation.threadId : threads.get(contextKey);
      turn = aiStore.createTurn(captureTurnBinding(graph(), { question, focusNodeIds: ids, scope, focusedPathEdgeIds: explicitPath, contextKey, threadId, model: ctx.aiState().model }));
      threads.set(contextKey, turn.threadId); continuation = null;
    } catch (error) { ctx.toast(`问题尚未发送：${error.message}`); return; }
    const questionMessage = { role: 'user', content: question, contextKey, turnId: turn.turnId, context: turn.pathSnapshotLabel };
    ctx.setMessages([...ctx.messages(), questionMessage]); $('question').value = '';
    if (privateOnly) {
      safeUpdate(turn.turnId, { status: 'failed', errorCode: 'AI_PRIVATE_CONTEXT', errorMessage: '已在本机记录问题；私密节点不会发送给模型。', completedAt: new Date().toISOString() }, turn.graphId);
      ctx.setMessages([...ctx.messages(), { role: 'assistant', error: true, content: '已在本机记录问题；私密节点不会发送给模型。', turnId: turn.turnId, context: turn.pathSnapshotLabel }]); ctx.renderChat(); update(); return;
    }
    const pending = { role: 'assistant', generating: true, content: '问题已保存，正在等待模型…', turnId: turn.turnId, context: turn.pathSnapshotLabel };
    ctx.setMessages([...ctx.messages(), pending]);
    const requestEpoch = epoch, request = { turnId: turn.turnId, graphId: turn.graphId, controller: new AbortController(), partial: '' };
    const originGraph = structuredClone(graph()); active = request;
    const history = authorizedThreadHistory(aiStore, graph(), turn.threadId, outgoing, consentPrefix(), contextKey);
    ctx.setController(request.controller); ctx.setBusy(true); ctx.renderChat(); panels.update();
    try {
      aiStore.updateTurn(turn.turnId, { status: 'generating' }, turn.graphId);
      const response = await fetch(`/api/journey/ai/${propose ? 'propose' : 'chat'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: propose ? 'application/json' : 'text/event-stream' }, body: JSON.stringify({ graph: outgoing, selectedNodeIds: ids.filter(id => outgoing.nodes.some(n => n.id === id && !n.private)), scope, ...(explicitPath ? { focusedPathEdgeIds: explicitPath } : {}), message: question, history, ...ctx.requestExtras(), stream: !propose, turnId: turn.turnId, clientRequestId: turn.clientRequestId }), signal: request.controller.signal });
      const result = await readAIResponse(response, { signal: request.controller.signal, onDelta: (_delta, full) => { request.partial = full; pending.content = full; if (requestEpoch === epoch && ctx.isActive() && graph().graphId === turn.graphId && ctx.activeTab() === 'chat') ctx.renderChat(); } });
      if (typeof result.answer !== 'string' || !Array.isArray(result.proposedOperations)) throw Object.assign(new Error('模型返回格式无效。'), { code: 'AI_INVALID_RESPONSE' });
      if (request.controller.signal.aborted || requestEpoch !== epoch) throw new DOMException('请求已取消', 'AbortError');
      safeUpdate(turn.turnId, { status: 'completed', answer: result.answer, model: result.model || ctx.aiState().model || '未提供模型名', citations: result.citations || [], completedAt: new Date().toISOString() }, turn.graphId);
      pending.generating = false; pending.content = `${result.answer}\n\n${(result.caveats || []).join('\n')}`; pending.citations = result.citations || [];
      if (graph().graphId === turn.graphId) {
        ctx.observeSources(result);
        if (result.proposedOperations.length && graph().revision === result.usedGraphRevision) { validateProposal(originGraph, result.proposedOperations, result.usedGraphRevision); ctx.setProposal({ ...result, requestGraph: outgoing }); }
        else if (result.proposedOperations.length) ctx.toast('回答已保存；画布已更新，旧草案不会应用。');
      }
    } catch (error) {
      const cancelled = error.name === 'AbortError' || requestEpoch !== epoch;
      const status = cancelled ? 'cancelled' : ['AI_NOT_CONFIGURED', 'AI_DISABLED'].includes(error.code) ? 'unconfigured' : 'failed';
      safeUpdate(turn.turnId, { status, answer: request.partial, errorCode: cancelled ? 'AI_CANCELLED' : String(error.code || 'AI_REQUEST_FAILED').slice(0, 80), errorMessage: (cancelled ? '请求已取消。' : error.message).slice(0, 2000), completedAt: new Date().toISOString() }, turn.graphId);
      pending.generating = false; pending.error = true; pending.content = `${request.partial ? `${request.partial}\n\n（未完成的部分回答）\n` : ''}${cancelled ? '请求已取消，问题已保留。' : `${error.message}\n问题已保存，你仍然可以手动编辑人生树。`}`;
    } finally {
      if (active === request) { active = null; ctx.setBusy(false); ctx.setController(null); }
      if (requestEpoch === epoch) ctx.checkAI?.();
      if (requestEpoch === epoch && ctx.isActive() && graph().graphId === turn.graphId) { if (ctx.activeTab() === 'chat') ctx.renderChat(); ctx.renderGhosts(); panels.update(); updateBinding(); }
    }
  }
  function continueTurn(turn) {
    if (turn.graphId !== graph().graphId) return ctx.toast('问答属于另一棵树。');
    const id = turn.focusNodeIds.find(id => ctx.nodeById(id)) || (turn.scope === 'graph' ? graph().rootNodeId : null);
    if (!id) return ctx.toast('原节点已归档，可重新询问并选择新的关联范围。');
    ctx.selectNode(id);
    if (turn.scope === 'multi_node') ctx.restoreSelection?.(turn.focusNodeIds.filter(id => ctx.nodeById(id)));
    $('scope').value = storeScopes[turn.scope] || 'path'; continuation = turn;
    ctx.openChat(); updateBinding();
    if (turn.focusedPathEdgeIds?.length && [...$('aiFocusPath').options].some(o => o.value === turn.focusedPathEdgeIds.join(','))) $('aiFocusPath').value = turn.focusedPathEdgeIds.join(',');
    updateBinding(); $('question').value = ''; $('question').focus();
  }
  function retryTurn(turn) { continueTurn(turn); continuation = null; if (ctx.activeTab() === 'chat') { $('question').value = turn.question; updateBinding(); $('question').focus(); } }
  function clearThreadMessages() {
    const ids = [...new Set(ctx.messages().map(m => m.turnId).filter(Boolean))];
    for (const id of ids) if (aiStore.getTurn(id, graph().graphId)) aiStore.deleteTurn(id, graph().graphId);
    invalidate(); ctx.setMessages([]); ctx.setProposal(null); ctx.renderChat(); panels.update();
  }
  function activate(legacyMessages = []) {
    // Preserve older gallery conversations as graph-level records; their original
    // node binding is unknown, so never infer it from the currently focused node.
    try { if (legacyMessages.length && legacyMessages.some(message => !message.turnId)) aiStore.migrateLegacyConversation(graph(), legacyMessages); }
    catch (error) { ctx.toast(`旧对话原文仍保留：${error.message}`); return false; }
    const recent = aiStore.history(graph(), { includeArchived: true, limit: 40 }).items.slice().reverse().map(item => item.turn);
    ctx.setMessages(recent.flatMap(turn => [{ role: 'user', content: turn.question, context: turn.pathSnapshotLabel, turnId: turn.turnId, contextKey: turn.contextKey }, ...((turn.answer || turn.status !== 'completed') ? [{ role: 'assistant', content: turn.answer || turn.errorMessage || '问题已保存，尚未回答。', error: turn.status !== 'completed', context: turn.pathSnapshotLabel, turnId: turn.turnId, citations: turn.citations || [] }] : [])]));
    update(); return true;
  }
  function clearGraphHistory() {
    cancel(); aiStore.deleteLocal(graph().graphId); invalidate();
    ctx.setMessages([]); ctx.setProposal(null); ctx.renderChat(); panels.update();
  }
  window.addEventListener('storage', event => { if (event.key === AI_STORAGE_KEY) { aiStore.reload({ interruptPending: false }); if (ctx.isActive()) panels.update(); } });
  window.addEventListener('pagehide', cancel);
  $('scope').addEventListener('change', () => { continuation = null; updateBinding(); });
  if ($('modelSettings')) $('modelSettings').onclick = panels.openSettings;
  return { aiStore, panels, send, update, activate, invalidate, cancel, clearThreadMessages, clearGraphHistory, renderTab: panels.renderTab };
}
