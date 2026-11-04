import { NodeKinds, pathsTo } from './graph.js';
import { projectRouteContext } from './privacy.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未记录';
const states = { unconfigured: '未配置', configured: '已配置 · 尚未验证', connected: '已连接', error: '最近连接失败' };
const turnStates = { queued: '已保存 · 等待回答', generating: '正在生成', completed: '回答完成 · AI 建议未核实', failed: '回答失败 · 可重新询问', cancelled: '已取消 · 部分回答', unconfigured: '未配置模型 · 问题已保存' };
const kindNames = { self: '此刻', major: '专业', education: '升学', career: '职业', milestone: '阶段', skill: '能力', goal: '目标', other: '想法', value: '价值', passion: '热爱', desire: '愿望', philosophy: '思想', lifestyle: '生活', life_event: '事件' };
const evidenceNames = { user_plan: '用户规划', sourced_fact: '有来源的事实', needs_verification: '待核实' };
const summaryFields = [ ['title', '路线介绍标题'], ['currentState', '当前状态'], ['destination', '计划到达的方向'], ['motivation', '为什么考虑这条路'], ['risksAndUnknowns', '风险与未确定的问题'], ['nextActions', '建议的下一步'] ];
const uuid = () => crypto.randomUUID();
const lines = value => String(value || '').split('\n').map(v => v.trim()).filter(Boolean);

// The server validates independently. This guard also keeps an unexpected
// response from becoming selectable in the browser.
export function validateSuggestionSet(value, binding) {
  if (!value || !Array.isArray(value.options) || value.options.length !== 3 || value.graphId !== binding.graphId || value.parentNodeId !== binding.parentNodeId || value.graphRevision !== binding.graphRevision || typeof value.id !== 'string' || !value.id || typeof value.token !== 'string' || !value.token) throw new Error('建议响应不符合当前节点与三个候选的约定，请重新生成。');
  const ids = new Set(), titles = new Set();
  for (const option of value.options) {
    const title = typeof option.title === 'string' ? option.title.trim() : '';
    const normal = title.normalize('NFKC').toLowerCase();
    if (!option.optionId || typeof option.optionId !== 'string' || ids.has(option.optionId) || !title || title.length > 120 || titles.has(normal) || !NodeKinds.includes(option.nodeKind) || option.nodeKind === 'self' || typeof option.rationale !== 'string' || !Array.isArray(option.prerequisites) || option.prerequisites.some(p => typeof p !== 'string') || typeof option.uncertainty !== 'string' || option.knowledgeStatus !== 'unverified') throw new Error('AI 候选包含无效或重复内容，画布没有改变。');
    ids.add(option.optionId); titles.add(normal);
  }
  return structuredClone(value);
}

export function projectSpecificPath(graph, route) {
  if (!route || !Array.isArray(route.nodeIds) || !Array.isArray(route.edgeIds) || route.nodeIds.some(id => !graph.nodes.some(n => n.id === id && !n.private))) throw new Error('此路线包含私密或已删除节点，不能发送给模型。');
  return projectRouteContext(graph, route.edgeIds, { parentId: route.nodeIds.at(-1) });
}

export function createAIPanels(ctx) {
  const { aiStore, graph, nodeById, toast, confirmation, transact } = ctx;
  const $ = id => document.getElementById(id);
  let destroyed = false, generation = 0, suggestion = null, suggestionController = null, settingController = null;
  let historyOpen = false, reportedHistoryOpen = false, historyToggleEpoch = 0, historyMode = 'node', historyLimit = 20, expanded = new Set(), jumpTurnId = null;
  let narrativePathId = null, narrativeBusy = false, narrativeController = null, narrativeEpoch = 0, narrativeError = '', extraTurnIds = new Set(), narrativeRequestRevision = null, editingUserPathId = null, narrativeAuthorization = null;
  let lastFocus = ctx.focus(), lastGraphId = graph().graphId, lastConsent = ctx.consentKey?.() || '', providerStatus = null;
  const panel = () => $('panelScroll');
  const activeTab = () => ctx.activeTab?.() || '';
  const consent = () => ctx.consentKey?.() || '';
  const focusKey = () => JSON.stringify([graph().graphId, ctx.focus(), consent()]);
  function requestError(result, fallback) { return typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : fallback; }
  async function jsonRequest(url, body, signal, headers = {}) {
    const response = await fetch(url, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { 'Content-Type': 'application/json', ...headers }, signal });
    let result;
    try { result = await response.json(); } catch { throw new Error('服务返回了无法读取的结果，请稍后重试。'); }
    if (!response.ok) throw new Error(requestError(result, `请求失败（${response.status}）`));
    return result;
  }
  function dialog(id, content, className = '') {
    const node = document.createElement('dialog'); node.id = id; node.className = `modal ai-v11-modal ${className}`; node.innerHTML = content; document.body.append(node); return node;
  }
  const settingsDialog = dialog('modelSettingsDialog', '<div class="eyebrow">MODEL CONNECTION</div><h3>模型设置</h3><div id="modelStatusContent" role="status">正在读取配置…</div><p class="hint">站点管理员通过服务器环境变量配置 DeepSeek。普通用户共用站点配置，无需输入 API Key。密钥不会保存在浏览器中。</p><details><summary>管理员配置指引</summary><pre class="ai-config-guide">JOURNEY_AI_PROVIDER=deepseek\nDEEPSEEK_API_KEY=（仅在服务器填写）\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash\nJOURNEY_AI_ENABLED=true\nJOURNEY_AI_ADMIN_TOKEN=（服务器管理员凭证）</pre><p class="hint">修改服务器环境变量后重启本地服务。关闭 AI 可设 JOURNEY_AI_ENABLED=false。</p></details><label for="modelAdminToken">管理员连接测试凭证（仅本次弹窗使用）</label><input id="modelAdminToken" type="password" autocomplete="off" maxlength="512" placeholder="没有管理权限可直接关闭"><p id="modelTestResult" class="hint" role="status"></p><div class="modal-actions"><button class="btn ghost" id="closeModelSettings">关闭</button><button class="btn primary" id="testModelConnection" disabled>测试连接</button></div>');
  const suggestionDialog = dialog('aiSuggestionsDialog', '<div class="eyebrow">THREE POSSIBILITIES, YOUR CHOICE</div><h3 id="aiSuggestionsTitle">AI 建议</h3><p id="aiSuggestionsContext" class="hint"></p><div id="aiSuggestionPathPicker"></div><div id="aiSuggestionOptions"></div><p id="aiSuggestionError" class="error" role="alert"></p><div class="modal-actions"><button class="btn ghost" id="cancelAISuggestions">取消</button><button class="btn" id="regenerateAISuggestions">生成三个建议</button><button class="btn primary" id="applyAISuggestions" disabled>选择后添加</button></div>', 'ai-suggestions-modal');
  const history = document.createElement('section'); history.className = 'ai-history'; history.id = 'aiHistory'; history.setAttribute('aria-label', 'AI 问答历史');
  history.innerHTML = '<button class="ai-history-bar" id="aiHistoryBar" aria-expanded="false" aria-controls="aiHistoryDrawer"><span id="aiHistoryBarText"></span><span id="aiHistoryToggle">展开 ▴</span></button><div class="ai-history-drawer" id="aiHistoryDrawer" hidden><div class="ai-history-head"><div><strong id="aiHistoryHeading">问答记录</strong><span class="hint">仅当前设备保存</span></div><button class="btn small" id="closeAIHistory">收起 ↓</button></div><div class="ai-history-tools"><select id="aiHistoryMode" aria-label="历史记录范围"><option value="node">当前节点</option><option value="graph">整树问答</option><option value="archived">已归档节点</option></select><button class="btn small" id="exportAIHistory">导出历史 JSON</button><button class="btn small" id="historyNarrative">梳理路线介绍</button></div><div id="aiHistoryItems"></div><button class="btn small" id="moreAIHistory" hidden>查看更早记录</button></div>';
  $('mainpanel').append(history);
  $('aiHistoryBar').onclick = () => { historyOpen = !historyOpen; renderHistory(); };
  $('closeAIHistory').onclick = () => { historyOpen = false; renderHistory(); };
  $('aiHistoryMode').onchange = () => { historyMode = $('aiHistoryMode').value; historyLimit = 20; expanded.clear(); jumpTurnId = null; renderHistory(); };
  $('moreAIHistory').onclick = () => { historyLimit = Math.min(1000, historyLimit + 20); renderHistory(); };
  $('exportAIHistory').onclick = () => { const data = aiStore.exportArchive(graph().graphId); download(data, '始于足下_AI问答历史.json'); };
  $('historyNarrative').onclick = () => openNarrative();
  function clearSettings() { settingController?.abort(); settingsDialog.querySelector('#modelAdminToken').value = ''; settingsDialog.querySelector('#modelTestResult').textContent = ''; settingsDialog.querySelector('#testModelConnection').disabled = true; }
  $('closeModelSettings').onclick = () => { clearSettings(); settingsDialog.close(); };
  settingsDialog.addEventListener('close', () => { if (!settingsDialog.open) clearSettings(); });
  $('modelAdminToken').oninput = () => { $('testModelConnection').disabled = !($('modelAdminToken').value.trim()) || Boolean(settingController); };
  $('testModelConnection').onclick = testConnection;
  function clearSuggestions() { generation++; suggestionController?.abort(); suggestionController = null; suggestion = null; }
  function closeSuggestions() { clearSuggestions(); if (suggestionDialog.open) suggestionDialog.close(); }
  $('cancelAISuggestions').onclick = closeSuggestions;
  suggestionDialog.addEventListener('close', () => { if (!suggestionDialog.open) clearSuggestions(); });
  suggestionDialog.addEventListener('cancel', () => suggestionController?.abort());
  $('regenerateAISuggestions').onclick = generateSuggestions;
  $('applyAISuggestions').onclick = applySuggestions;

  function download(data, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function renderStatus() {
    const s = providerStatus;
    $('modelStatusContent').innerHTML = s ? `<dl class="ai-settings-status"><div><dt>供应商</dt><dd>${esc(s.provider || 'DeepSeek')}</dd></div><div><dt>模型</dt><dd>${esc(s.model || '未配置')}</dd></div><div><dt>服务地址</dt><dd>${esc(s.baseUrl || s.baseURL || 'https://api.deepseek.com')}</dd></div><div><dt>AI 开关</dt><dd>${s.enabled === false ? '已停用' : '已启用'}</dd></div><div><dt>连接状态</dt><dd>${esc(states[s.state] || (s.configured ? states.configured : states.unconfigured))}</dd></div></dl>${s.lastCheckedAt ? `<p class="hint">最近检查：${date(s.lastCheckedAt)}${s.lastErrorCode ? ` · ${esc(s.lastErrorCode)}` : ''}</p>` : ''}` : '<p class="error">配置状态读取失败，可继续手动探索。</p>';
  }
  async function openSettings() {
    if (destroyed || settingsDialog.open) return;
    settingsDialog.showModal(); $('modelStatusContent').textContent = '正在读取配置…';
    try { providerStatus = await jsonRequest('/api/journey/ai/config/status'); }
    catch (error) { providerStatus = null; $('modelTestResult').textContent = error.message; }
    if (!destroyed && settingsDialog.open) renderStatus();
  }
  async function testConnection() {
    const token = $('modelAdminToken').value.trim(); if (!token || settingController) return;
    settingController = new AbortController(); $('testModelConnection').disabled = true; $('modelTestResult').textContent = '正在由服务器测试真实连接…';
    try {
      const result = await jsonRequest('/api/journey/ai/config/test', {}, settingController.signal, { Authorization: `Bearer ${token}` });
      if (!settingsDialog.open) return;
      $('modelTestResult').textContent = result.status === 'connected' ? '连接测试成功。' : `连接测试：${result.status || result.state || '失败'}`;
      providerStatus = await jsonRequest('/api/journey/ai/config/status'); renderStatus(); await ctx.fetchStatus?.();
    } catch (error) { if (error.name !== 'AbortError' && settingsDialog.open) $('modelTestResult').textContent = error.message; }
    finally { settingController = null; if (!destroyed) $('testModelConnection').disabled = !settingsDialog.open || !$('modelAdminToken').value.trim(); }
  }

  function safeRoutes(id) { return pathsTo(graph(), id, { maxPaths: 12, maxDepth: 300 }).filter(p => p.nodeIds.every(n => !nodeById(n)?.private)); }
  function routeLabel(route) { return route.nodeIds.map(id => nodeById(id)?.title || '已删除节点').join(' → '); }
  function openSuggestions(parentId) {
    const parent = nodeById(parentId); if (!parent || parent.private) return toast('私密节点不会发送给模型，请使用手动添加。');
    if (suggestionDialog.open && suggestion?.parentNodeId === parentId) return;
    if (suggestionDialog.open) closeSuggestions();
    const routes = safeRoutes(parentId); if (!routes.length) return toast('当前节点没有可授权的完整路径，请先连接到起点。');
    suggestion = { parentNodeId: parentId, graphId: graph().graphId, graphRevision: graph().revision, routes, routeIndex: routes.length === 1 ? 0 : null, focusKey: focusKey(), set: null, selected: new Set(), titles: new Map(), generating: false, applying: false, error: '' };
    renderSuggestions(); suggestionDialog.showModal(); if (routes.length === 1) generateSuggestions();
  }
  function renderSuggestions() {
    const s = suggestion; if (!s) return;
    $('aiSuggestionsTitle').textContent = `从「${nodeById(s.parentNodeId)?.title || '已删除节点'}」继续生长`;
    $('aiSuggestionsContext').textContent = `候选尚未加入树。请选择 1–3 项并确认；本次绑定画布版本 ${s.graphRevision}。`;
    $('aiSuggestionPathPicker').innerHTML = s.routes.length > 1 ? `<label for="aiSuggestionPath">选择这次要沿用的具体路径</label><select id="aiSuggestionPath"${s.generating || s.applying ? ' disabled' : ''}><option value="">请选择路径，不会自动拼接不同路线</option>${s.routes.map((p, i) => `<option value="${i}"${s.routeIndex === i ? ' selected' : ''}>${esc(routeLabel(p))}</option>`).join('')}</select>` : `<p class="path-text">${esc(routeLabel(s.routes[0]))}</p>`;
    if ($('aiSuggestionPath')) $('aiSuggestionPath').onchange = () => { s.routeIndex = $('aiSuggestionPath').value === '' ? null : Number($('aiSuggestionPath').value); s.set = null; s.selected.clear(); s.titles.clear(); s.error = ''; renderSuggestions(); };
    $('aiSuggestionOptions').innerHTML = s.generating ? '<p class="ai-loading" role="status">正在生成三个建议…关闭可取消，人生树保持原样。</p>' : s.set ? s.set.options.map((o, i) => `<article class="ai-option${s.selected.has(o.optionId) ? ' selected' : ''}"><label class="ai-option-check"><input type="checkbox" data-pick-ai="${esc(o.optionId)}"${s.selected.has(o.optionId) ? ' checked' : ''}${s.applying ? ' disabled' : ''}><span>候选 ${i + 1} · ${esc(kindNames[o.nodeKind] || o.nodeKind)}</span></label><label class="sr-only" for="aiOptionTitle${i}">候选 ${i + 1} 标题</label><input id="aiOptionTitle${i}" data-title-ai="${esc(o.optionId)}" value="${esc(s.titles.get(o.optionId) ?? o.title)}" maxlength="120"${s.applying ? ' disabled' : ''}><p>${esc(o.rationale)}</p><ul>${o.prerequisites.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p class="hint">待核实：${esc(o.uncertainty || '准备条件需要结合真实资料核实。')}</p></article>`).join('') : '<p class="muted">成功生成后将显示恰好三个候选，默认都不选择。</p>';
    $('aiSuggestionOptions').querySelectorAll('[data-pick-ai]').forEach(input => input.onchange = () => { input.checked ? s.selected.add(input.dataset.pickAi) : s.selected.delete(input.dataset.pickAi); input.closest('.ai-option').classList.toggle('selected', input.checked); updateSuggestionButtons(); });
    $('aiSuggestionOptions').querySelectorAll('[data-title-ai]').forEach(input => input.oninput = () => { s.titles.set(input.dataset.titleAi, input.value); });
    $('aiSuggestionError').textContent = s.error || ''; updateSuggestionButtons();
  }
  function updateSuggestionButtons() {
    const s = suggestion; if (!s) return;
    $('regenerateAISuggestions').disabled = s.generating || s.applying || s.routeIndex === null;
    $('regenerateAISuggestions').textContent = s.generating ? '生成中…' : s.set ? '重新生成三个' : '生成三个建议';
    $('applyAISuggestions').disabled = s.generating || s.applying || !s.set || !s.selected.size;
    $('applyAISuggestions').textContent = s.applying ? '正在确认…' : s.selected.size ? `添加已选 ${s.selected.size} 项` : '选择后添加';
    $('cancelAISuggestions').textContent = s.generating ? '取消生成' : '取消';
  }
  async function generateSuggestions() {
    const s = suggestion; if (!s || s.generating || s.applying || s.routeIndex === null) return;
    let snapshot;
    try { snapshot = projectRouteContext(graph(), s.routes[s.routeIndex].edgeIds, { parentId: s.parentNodeId, includeChildren: true }); } catch (e) { s.error = e.message; renderSuggestions(); return; }
    const epoch = ++generation, controller = new AbortController(); suggestionController = controller;
    s.graphRevision = graph().revision; s.graphId = graph().graphId; s.focusKey = focusKey(); s.snapshot = snapshot; s.generating = true; s.error = ''; s.set = null; s.selected.clear(); s.titles.clear(); renderSuggestions();
    try {
      const result = await jsonRequest(`/api/journey/nodes/${encodeURIComponent(s.parentNodeId)}/ai-suggestions`, { graph: snapshot, selectedNodeIds: [s.parentNodeId], scope: 'path', focusedPathEdgeIds: s.routes[s.routeIndex].edgeIds, ...(ctx.requestExtras?.() || {}), clientRequestId: uuid() }, controller.signal);
      if (epoch !== generation || suggestion !== s || !suggestionDialog.open) return;
      if (graph().revision !== s.graphRevision || focusKey() !== s.focusKey) throw new Error('当前画布或授权已更新，请重新生成建议。');
      s.set = validateSuggestionSet(result, s); s.applyRequestId = null;
    } catch (error) { if (epoch === generation && suggestion === s) s.error = error.name === 'AbortError' ? '生成已取消，人生树没有改变。' : error.message; }
    finally { if (epoch === generation && suggestion === s) { s.generating = false; suggestionController = null; renderSuggestions(); } }
  }
  async function applySuggestions() {
    const s = suggestion; if (!s?.set || s.applying || s.generating || !s.selected.size) return;
    if (graph().revision !== s.graphRevision || focusKey() !== s.focusKey || nodeById(s.parentNodeId)?.private) { s.error = '当前画布、焦点或授权已更新，请重新检查建议。'; s.set = null; renderSuggestions(); return; }
    const selectedOptions = s.set.options.filter(o => s.selected.has(o.optionId)).map(o => ({ optionId: o.optionId, title: (s.titles.get(o.optionId) ?? o.title).trim() }));
    if (selectedOptions.some(o => !o.title || o.title.length > 120) || new Set(selectedOptions.map(o => o.title.normalize('NFKC').toLowerCase())).size !== selectedOptions.length) { s.error = '所选候选的标题不能为空或重复。'; renderSuggestions(); return; }
    const epoch = ++generation; s.applying = true; s.error = ''; const controller = new AbortController(); suggestionController = controller; renderSuggestions();
    s.applyRequestId ||= uuid();
    try {
      const result = await jsonRequest(`/api/journey/ai-suggestions/${encodeURIComponent(s.set.id)}/apply`, { graph: s.snapshot, expectedRevision: s.graphRevision, selectedOptions, token: s.set.token, clientRequestId: s.applyRequestId }, controller.signal);
      if (epoch !== generation || suggestion !== s || focusKey() !== s.focusKey || graph().revision !== s.graphRevision) return;
      if (result.usedGraphRevision !== s.graphRevision || !Array.isArray(result.proposedOperations)) throw new Error('确认结果版本无效，人生树没有改变。');
      if (transact(result.proposedOperations, s.graphRevision, { origin: 'ai', undoGroupId: `suggestion_${s.set.id}` })) { closeSuggestions(); toast(`已一次添加 ${selectedOptions.length} 项，可整体撤销。`); }
      else { s.error = '画布提交失败，未重复添加，请检查保存状态。'; }
    } catch (error) { if (epoch === generation && suggestion === s) s.error = error.name === 'AbortError' ? '确认已取消，人生树没有改变。' : error.message; }
    finally { if (epoch === generation && suggestion === s) { s.applying = false; suggestionController = null; renderSuggestions(); } }
  }

  function historyResult() {
    if (historyMode === 'archived') return aiStore.history(graph(), { includeArchived: true, archivedOnly: true, offset: 0, limit: historyLimit });
    return aiStore.history(graph(), { ...(historyMode === 'node' ? { nodeId: ctx.focus() } : {}), offset: 0, limit: historyLimit, includeArchived: historyMode === 'graph' });
  }
  function renderHistory() {
    if (destroyed) return;
    const current = aiStore.history(graph(), { nodeId: ctx.focus(), limit: 1 });
    const title = nodeById(ctx.focus())?.title || '整树';
    history.classList.toggle('is-open', historyOpen);
    if (historyOpen !== reportedHistoryOpen) {
      reportedHistoryOpen = historyOpen;
      const open = historyOpen, epoch = ++historyToggleEpoch;
      requestAnimationFrame(() => { if (!destroyed && epoch === historyToggleEpoch) ctx.onHistoryToggle?.(open, history); });
    }
    $('aiHistoryBarText').textContent = `「${title}」历史问答（${current.total}）${current.items[0]?.turn ? ` · 最近：${current.items[0].turn.question.slice(0, 42)}` : ' · 暂无提问'}`;
    $('aiHistoryBar').setAttribute('aria-expanded', String(historyOpen)); $('aiHistoryToggle').textContent = historyOpen ? '收起 ▾' : '展开 ▴'; $('aiHistoryDrawer').hidden = !historyOpen;
    if (!historyOpen) return;
    $('aiHistoryMode').value = historyMode;
    $('aiHistoryHeading').textContent = historyMode === 'node' ? `「${title}」的问答` : historyMode === 'archived' ? '已归档节点的问答' : '整棵树的问答';
    const result = historyResult();
    $('aiHistoryItems').innerHTML = result.items.map(({ turn: t, linkKind }) => `<article class="ai-turn${jumpTurnId === t.turnId ? ' highlighted' : ''}" data-turn-id="${esc(t.turnId)}"><div class="ai-turn-meta"><span>${date(t.createdAt)} · ${esc(t.model || '未生成模型回答')}</span><span class="ai-turn-link">${linkKind === 'direct' ? '直接关联本节点' : linkKind === 'path' ? '本节点所在路线相关' : linkKind === 'archived' ? '已归档节点问答' : '整树问答'}</span></div><h4>Q：${esc(t.question)}</h4><p class="hint">${esc(turnStates[t.status] || t.status)}${t.pathSnapshotLabel ? ` · ${esc(t.pathSnapshotLabel)}` : ''}${t.errorMessage ? ` · ${esc(t.errorMessage)}` : ''}</p><div class="ai-turn-answer">${esc(t.answer ? expanded.has(t.turnId) ? t.answer : t.answer.slice(0, 180) + (t.answer.length > 180 ? '…' : '') : '暂无回答。问题已保留，可重新询问。')}</div>${expanded.has(t.turnId) && t.citations?.length ? `<ul class="source-citations">${t.citations.map(c => `<li>${citationHTML(c)}</li>`).join('')}</ul>` : ''}<div class="detail-actions">${t.answer ? `<button class="btn small" data-expand-turn="${esc(t.turnId)}">${expanded.has(t.turnId) ? '收起答案' : '展开答案'}</button>` : ''}<button class="btn small" data-continue-turn="${esc(t.turnId)}">继续追问</button><button class="btn small" data-retry-turn="${esc(t.turnId)}">重新询问</button><button class="btn small ghost" data-delete-turn="${esc(t.turnId)}">删除记录</button></div></article>`).join('') || '<p class="ai-history-empty">这里还没有问答记录。发送前会先保存问题；失败或取消也会保留。</p>';
    $('moreAIHistory').hidden = result.total <= historyLimit; $('moreAIHistory').textContent = `查看更早记录（已显示 ${result.items.length} / ${result.total}）`;
    $('aiHistoryItems').querySelectorAll('[data-expand-turn]').forEach(b => b.onclick = () => { expanded.has(b.dataset.expandTurn) ? expanded.delete(b.dataset.expandTurn) : expanded.add(b.dataset.expandTurn); renderHistory(); });
    $('aiHistoryItems').querySelectorAll('[data-continue-turn]').forEach(b => b.onclick = () => { const t = aiStore.getTurn(b.dataset.continueTurn, graph().graphId); if (t) ctx.continueTurn?.(t); });
    $('aiHistoryItems').querySelectorAll('[data-retry-turn]').forEach(b => b.onclick = () => { const t = aiStore.getTurn(b.dataset.retryTurn, graph().graphId); if (t) ctx.retryTurn?.(t); });
    $('aiHistoryItems').querySelectorAll('[data-delete-turn]').forEach(b => b.onclick = () => deleteTurn(b.dataset.deleteTurn));
    if (jumpTurnId) $('aiHistoryItems').querySelector(`[data-turn-id="${CSS.escape(jumpTurnId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function citationHTML(c) {
    let url; try { const u = new URL(c.url); if (['https:', 'http:'].includes(u.protocol)) url = u.href; } catch { /* Uploads may have no link. */ }
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.sourceId)}</a>` : esc(c.title || c.sourceId || '来源片段');
  }
  async function deleteTurn(id) {
    const graphId = graph().graphId;
    if (!await confirmation('删除这条问答？', '问题、回答和关联将删除；引用它的路线介绍将一并清除，防止删除内容仍通过总结曝光。此操作不可撤销。', '删除问答')) return;
    if (graph().graphId !== graphId) return;
    try { invalidateNarrative(); aiStore.deleteTurn(id, graphId); expanded.delete(id); if (jumpTurnId === id) jumpTurnId = null; ctx.onDeleteTurn?.(id); renderHistory(); if (activeTab() === 'narrative') renderNarrative(); toast('问答及受影响的派生介绍已删除。'); }
    catch (e) { toast(e.message); }
  }
  function jumpToTurn(id) {
    if (!aiStore.getTurn(id, graph().graphId)) return toast('原问答已删除。');
    historyMode = 'graph'; historyOpen = true; jumpTurnId = id; expanded.add(id);
    const result = aiStore.history(graph(), { includeArchived: true, offset: 0, limit: 1000 });
    const index = result.items.findIndex(item => item.turn.turnId === id); historyLimit = Math.max(20, Math.ceil((index + 1) / 20) * 20);
    ctx.showMobile?.(false); renderHistory();
  }

  function savedRoute(pathId) {
    const p = graph().savedPaths.find(p => p.id === pathId); if (!p?.edgeIds.length) return null;
    const edges = p.edgeIds.map(id => graph().edges.find(e => e.id === id)); if (edges.some(e => !e)) return null;
    return { path: p, nodeIds: [edges[0].from, ...edges.map(e => e.to)], edgeIds: [...p.edgeIds] };
  }
  function availablePaths() { return graph().savedPaths.filter(p => { const route = savedRoute(p.id); return route && route.nodeIds.every(id => !nodeById(id)?.private); }); }
  function openNarrative(pathId) {
    invalidateNarrative(); narrativeError = ''; extraTurnIds.clear(); editingUserPathId = null;
    const paths = availablePaths();
    narrativePathId = pathId && paths.some(p => p.id === pathId) ? pathId : null;
    if (!narrativePathId) {
      const focused = paths.filter(p => savedRoute(p.id).nodeIds.includes(ctx.focus()));
      if (focused.length === 1) narrativePathId = focused[0].id;
    }
    ctx.openTab?.('narrative'); ctx.setActiveTab?.('narrative'); ctx.renderPanel(); ctx.showMobile?.(true);
  }
  function relatedForPath() { return narrativePathId ? aiStore.relatedTurns(graph(), narrativePathId).filter(t => !t.focusNodeIds.some(id => nodeById(id)?.private) && !(t.pathNodeIds || []).some(id => nodeById(id)?.private)) : []; }
  function hasCurrentHistoryConsent(turn) { return typeof turn.contextKey === 'string' && turn.contextKey.startsWith(`${consent()}\n`); }
  function narrativeTurnChoice(turn, checked, additional = false) {
    return `<label class="inline-check"><input type="checkbox" data-narrative-turn="${esc(turn.turnId)}"${checked ? ' checked' : ''}${narrativeBusy || narrativeAuthorization ? ' disabled' : ''}><span>${esc(turn.question)}${additional ? '' : ` · ${esc(turnStates[turn.status])}`}${additional ? `<small>${esc(turn.pathSnapshotLabel || '其他范围')}</small>` : ''}${!hasCurrentHistoryConsent(turn) ? '<small>需重新授权发送原文（可能包含过去授权的资料）</small>' : ''}</span></label>`;
  }
  function renderNarrative() {
    const paths = availablePaths(), route = savedRoute(narrativePathId);
    if (!route || !paths.some(p => p.id === narrativePathId)) narrativePathId = null;
    panel().innerHTML = `<div class="detail-label">A ROUTE, IN YOUR WORDS</div><div class="detail-title">路线详细介绍</div><p class="hint">AI 整理是独立草稿。提问不代表认同答案，计划不代表已经实现；原路线备注会保留。</p><label for="narrativePath">选择要整理的具体路线</label><select id="narrativePath"${narrativeBusy ? ' disabled' : ''}><option value="">请选择，不会自动混合不同路线</option>${paths.map(p => `<option value="${esc(p.id)}"${p.id === narrativePathId ? ' selected' : ''}>${esc(p.title)} · ${esc(routeLabel(savedRoute(p.id)))}</option>`).join('')}</select><section id="narrativeContent"></section>`;
    $('narrativePath').onchange = () => { invalidateNarrative(); narrativePathId = $('narrativePath').value || null; extraTurnIds.clear(); editingUserPathId = null; narrativeError = ''; renderNarrative(); };
    if (!narrativePathId) { $('narrativeContent').innerHTML = `<p class="muted">${paths.length ? '先选定一条已保存路线，再选择本次引用的问答。' : '还没有可整理的已保存路线。先选择目标节点并保存路径；私密节点所在路线不会发送。'}</p>`; return; }
    const selectedRoute = savedRoute(narrativePathId), related = relatedForPath(), relatedIds = new Set(related.map(t => t.turnId));
    const all = aiStore.history(graph(), { includeArchived: false, limit: 1000 }).items.map(i => i.turn).filter(t => !relatedIds.has(t.turnId) && t.status === 'completed' && !t.focusNodeIds.some(id => !nodeById(id) || nodeById(id).private) && !(t.pathNodeIds || []).some(id => !nodeById(id) || nodeById(id).private));
    const record = aiStore.narrative(graph(), narrativePathId), draft = record?.draft;
    $('narrativeContent').innerHTML = `<p class="path-text">${esc(routeLabel(selectedRoute))}</p>${selectedRoute.path.note ? `<div class="ai-narrative-note"><strong>你原先写的路线备注</strong><p>${esc(selectedRoute.path.note)}</p></div>` : ''}${record?.status === 'stale' ? '<p class="ai-stale" role="status">可能过期：路线、来源或相关问答发生变化。已有用户版保留，可重新梳理。</p>' : ''}${record?.userEdited || record?.confirmed ? narrativeDisplay(record.userEdited || record.confirmed, record) : ''}<h4>本次引用的问答</h4><p class="hint">默认仅选中此路线直接关联、且仍在当前授权范围内的问答。过去授权或导入的原文需你重新勾选并确认；私密内容始终排除。</p><div class="narrative-turn-picker">${related.map(t => narrativeTurnChoice(t, hasCurrentHistoryConsent(t))).join('') || '<p class="muted">此路线暂无直接关联问答，可先提问，再来整理。</p>'}</div>${all.length ? `<details class="narrative-extra"><summary>显式追加其他公开问答（${all.length}）</summary><div class="narrative-turn-picker">${all.map(t => narrativeTurnChoice(t, extraTurnIds.has(t.turnId), true)).join('')}</div></details>` : ''}<div class="detail-actions"><button class="btn primary" id="generateNarrative"${narrativeBusy ? ' disabled' : ''}>${narrativeBusy ? '正在梳理…' : record ? '重新梳理介绍草稿' : '生成路线介绍草稿'}</button>${narrativeBusy ? '<button class="btn" id="cancelNarrative">取消生成</button>' : ''}</div><p id="narrativeError" class="error" role="alert">${esc(narrativeError)}</p><div id="narrativeDraft">${draft ? narrativeEditor(draft) : ''}</div>`;
    $('generateNarrative').onclick = generateNarrative;
    const userVersion = record?.userEdited || record?.confirmed;
    if (userVersion) {
      const controls = document.createElement('div'); controls.className = 'detail-actions'; controls.innerHTML = '<button class="btn small" id="editUserNarrative">编辑已确认的用户版</button>';
      panel().querySelector('.ai-narrative-confirmed').append(controls);
      $('editUserNarrative').onclick = () => { editingUserPathId = narrativePathId; renderNarrative(); };
      if (editingUserPathId === narrativePathId) {
        const editor = document.createElement('div'); editor.innerHTML = narrativeEditor(userVersion, true); panel().querySelector('.ai-narrative-confirmed').after(editor);
        $('narrativeUserForm').onsubmit = event => { event.preventDefault(); try { const edited = readNarrativeEditor(userVersion, 'narrativeUser'); aiStore.editNarrative(graph(), narrativePathId, edited); editingUserPathId = null; renderNarrative(); toast('用户版介绍已保存，AI 草稿保留。'); } catch (e) { toast(e.message); } };
        $('cancelUserNarrative').onclick = () => { editingUserPathId = null; renderNarrative(); };
      }
    }
    if ($('cancelNarrative')) $('cancelNarrative').onclick = () => { invalidateNarrative(); narrativeError = '生成已取消，原介绍没有改变。'; renderNarrative(); };
    panel().querySelectorAll('[data-narrative-turn]').forEach(input => input.onchange = () => { if (!relatedIds.has(input.dataset.narrativeTurn)) input.checked ? extraTurnIds.add(input.dataset.narrativeTurn) : extraTurnIds.delete(input.dataset.narrativeTurn); });
    panel().querySelectorAll('[data-source-turn]').forEach(button => button.onclick = () => jumpToTurn(button.dataset.sourceTurn));
    if ($('narrativeDraftForm')) $('narrativeDraftForm').onsubmit = confirmNarrative;
    if ($('discardNarrativeDraft')) $('discardNarrativeDraft').onclick = () => { try { aiStore.discardDraft?.(graph(), narrativePathId); renderNarrative(); } catch (e) { toast(e.message); } };
  }
  function narrativeDisplay(value, record) {
    return `<article class="ai-narrative-confirmed"><div class="ai-turn-meta"><strong>AI 整理的路线介绍 · 已确认${record.userEdited ? ' / 已编辑' : ''}</strong><span>${date(record.updatedAt)} · ${esc(record.model || '')}</span></div><h4>${esc(value.title)}</h4><strong>当前状态</strong><p>${esc(value.currentState)}</p><strong>计划方向</strong><p>${esc(value.destination)}</p><strong>我为什么考虑这条路</strong>${textList(value.motivation)}<strong>需要准备什么</strong><ul>${(value.requiredPreparation || []).map(r => `<li>${esc(r.item)} <span class="tag">${esc(evidenceNames[r.evidenceStatus])}</span></li>`).join('')}</ul><strong>风险与未确定的问题</strong>${textList(value.risksAndUnknowns)}<strong>建议的下一步</strong>${textList(value.nextActions)}<p class="hint">这些建议没有自动创建行动任务。</p><div class="ai-narrative-sources">历史依据（${value.sourceTurnIds.length}）：${value.sourceTurnIds.map((id, i) => `<button class="btn small" data-source-turn="${esc(id)}">问答 Q${i + 1}</button>`).join('')}</div></article>`;
  }
  function textList(values) { return `<ul>${(values || []).map(v => `<li>${esc(v)}</li>`).join('')}</ul>`; }
  function narrativeEditor(draft, user = false) {
    const prefix = user ? 'narrativeUser' : 'narrative';
    return `<form id="${user ? 'narrativeUserForm' : 'narrativeDraftForm'}" class="ai-narrative-editor"><h4>${user ? '编辑你的已确认版本' : '可编辑草稿 · 尚未确认'}</h4>${summaryFields.map(([key, label]) => `<label for="${prefix}_${key}">${label}${Array.isArray(draft[key]) ? '（每行一项）' : ''}</label><textarea id="${prefix}_${key}" name="${key}" rows="${key === 'title' ? 1 : 3}" maxlength="${key === 'title' ? 120 : 4000}">${esc(Array.isArray(draft[key]) ? draft[key].join('\n') : draft[key])}</textarea>`).join('')}<h4>准备事项</h4>${(draft.requiredPreparation || []).map((r, i) => `<div class="ai-preparation-row"><label for="${prefix}_prepare_${i}">事项 ${i + 1}</label><textarea id="${prefix}_prepare_${i}" rows="2" maxlength="1000">${esc(r.item)}</textarea><label for="${prefix}_evidence_${i}">证据状态</label><select id="${prefix}_evidence_${i}">${Object.entries(evidenceNames).map(([k, v]) => `<option value="${k}"${r.evidenceStatus === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>`).join('')}<p class="hint">依据 ${draft.sourceTurnIds.length} 条问答，画布版本 ${draft.graphRevision}。保存只更新介绍，不会修改节点、条件或任务。</p><div class="ai-narrative-sources">原始依据：${draft.sourceTurnIds.map((id, i) => `<button type="button" class="btn small" data-source-turn="${esc(id)}">问答 Q${i + 1}</button>`).join('')}</div><div class="detail-actions"><button type="button" class="btn ghost" id="${user ? 'cancelUserNarrative' : 'discardNarrativeDraft'}">${user ? '取消编辑' : '放弃草稿'}</button><button type="submit" class="btn primary" id="${user ? 'saveUserNarrative' : 'confirmNarrativeDraft'}"${narrativeBusy ? ' disabled' : ''}>${user ? '保存用户版' : '确认这版介绍'}</button></div></form>`;
  }
  async function generateNarrative() {
    if (narrativeBusy || narrativeAuthorization || !narrativePathId) return;
    const route = savedRoute(narrativePathId), pathId = narrativePathId, revision = graph().revision, key = focusKey();
    const selectedTurnIds = [...panel().querySelectorAll('[data-narrative-turn]:checked')].map(i => i.dataset.narrativeTurn);
    const selectedTurns = selectedTurnIds.map(id => aiStore.getTurn(id, graph().graphId)).filter(Boolean);
    if (!selectedTurns.length) return toast('请先选择至少一条问答。');
    if (selectedTurns.length > 40) return toast('本次最多整理 40 条问答，请取消部分勾选。');
    if (selectedTurnIds.filter(id => extraTurnIds.has(id)).length > 12) return toast('本次最多显式追加 12 条其他公开问答。');
    const relatedStamp = JSON.stringify(aiStore.relatedTurns(graph(), pathId).map(t => [t.turnId, t.updatedAt]));
    const inputStillCurrent = () => narrativePathId === pathId && graph().revision === revision && focusKey() === key && !selectedTurns.some(t => aiStore.getTurn(t.turnId, graph().graphId)?.updatedAt !== t.updatedAt) && JSON.stringify(aiStore.relatedTurns(graph(), pathId).map(t => [t.turnId, t.updatedAt])) === relatedStamp;
    const needsNewConsent = selectedTurns.filter(t => !hasCurrentHistoryConsent(t));
    if (needsNewConsent.length) {
      const pending = { epoch: narrativeEpoch }; narrativeAuthorization = pending;
      if ($('generateNarrative')) { $('generateNarrative').disabled = true; $('generateNarrative').textContent = '等待确认历史原文授权…'; }
      let accepted = false;
      try { accepted = await confirmation('重新授权发送历史原文？', `所选 ${needsNewConsent.length} 条问答来自过去的授权或导入记录。此次会把所选历史问题和回答原文发送给站点模型，其中可能包含你过去授权的档案、上传资料或个人经历。只授权本次整理；拒绝会保留本机记录且不发送请求。`, '同意本次发送原文'); }
      catch (e) { toast(e.message); }
      finally { if (narrativeAuthorization === pending) narrativeAuthorization = null; }
      if (!accepted) { if (activeTab() === 'narrative' && narrativePathId === pathId) renderNarrative(); return; }
      const currentSelection = [...panel().querySelectorAll('[data-narrative-turn]:checked')].map(i => i.dataset.narrativeTurn);
      if (pending.epoch !== narrativeEpoch || !inputStillCurrent() || JSON.stringify(currentSelection) !== JSON.stringify(selectedTurnIds)) { narrativeError = '授权、焦点或所选问答已经变化，请重新选择后确认。'; if (activeTab() === 'narrative') renderNarrative(); return; }
    }
    let snapshot;
    try { snapshot = projectSpecificPath(graph(), route); } catch (e) { narrativeError = e.message; renderNarrative(); return; }
    const epoch = ++narrativeEpoch, controller = new AbortController(); narrativeController = controller; narrativeBusy = true; narrativeRequestRevision = revision; narrativeError = '';
    const turns = selectedTurns.map(t => ({ turnId: t.turnId, graphId: t.graphId, question: t.question.slice(0, 4000), answer: (t.answer || '').slice(0, 10000), status: t.status, scope: ({ multi_node: 'selection', graph: 'tree' })[t.scope] || t.scope, focusNodeIds: t.focusNodeIds, focusedPathEdgeIds: t.focusedPathEdgeIds || [], savedPathId: t.savedPathId, graphRevisionAtAsk: t.graphRevisionAtAsk, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.completedAt ? { completedAt: t.completedAt } : {}), citations: t.citations || [] }));
    renderNarrative();
    try {
      const result = await jsonRequest(`/api/journey/paths/${encodeURIComponent(pathId)}/summary/draft`, { graph: snapshot, selectedNodeIds: [route.nodeIds.at(-1)], scope: 'path', turns, explicitAdditionalTurnIds: selectedTurnIds.filter(id => extraTurnIds.has(id)), clientRequestId: uuid() }, controller.signal);
      if (epoch !== narrativeEpoch || narrativePathId !== pathId || graph().revision !== revision || focusKey() !== key) return;
      if (result.usedGraphRevision !== revision) throw new Error('路线版本已经改变，请重新梳理。');
      if (selectedTurns.some(t => aiStore.getTurn(t.turnId, graph().graphId)?.updatedAt !== t.updatedAt) || JSON.stringify(aiStore.relatedTurns(graph(), pathId).map(t => [t.turnId, t.updatedAt])) !== relatedStamp) throw new Error('相关问答在生成期间已更新，请重新梳理，旧结果没有保存。');
      aiStore.setDraft(graph(), pathId, result.draft, { model: result.model, inputTurnIds: selectedTurnIds, expectedGraphRevision: revision });
    } catch (e) { if (epoch === narrativeEpoch) narrativeError = e.name === 'AbortError' ? '生成已取消，原介绍没有改变。' : e.message; }
    finally { if (epoch === narrativeEpoch) { narrativeBusy = false; narrativeController = null; if (activeTab() === 'narrative') renderNarrative(); } }
  }
  function confirmNarrative(event) {
    event.preventDefault(); const record = aiStore.narrative(graph(), narrativePathId); if (!record?.draft) return;
    try { const draft = readNarrativeEditor(record.draft, 'narrative'); aiStore.confirmDraft(graph(), narrativePathId, draft); renderNarrative(); toast('路线介绍已确认，原备注和人生树保持原样。'); }
    catch (e) { narrativeError = e.message; $('narrativeError').textContent = e.message; }
  }
  function readNarrativeEditor(base, prefix) {
    const draft = structuredClone(base);
    for (const [key] of summaryFields) draft[key] = Array.isArray(draft[key]) ? lines($(`${prefix}_${key}`).value) : $(`${prefix}_${key}`).value.trim();
    draft.requiredPreparation = draft.requiredPreparation.map((r, i) => ({ ...r, item: $(`${prefix}_prepare_${i}`).value.trim(), evidenceStatus: $(`${prefix}_evidence_${i}`).value }));
    if (!draft.title || draft.requiredPreparation.some(r => !r.item)) throw new Error('标题和已有准备事项不能为空。');
    return draft;
  }
  function invalidateNarrative() { narrativeEpoch++; narrativeController?.abort(); narrativeController = null; narrativeBusy = false; narrativeRequestRevision = null; narrativeAuthorization = null; }
  function invalidate({ close = false } = {}) {
    generation++; suggestionController?.abort(); suggestionController = null;
    if (suggestion) { suggestion.generating = false; suggestion.applying = false; suggestion.set = null; suggestion.selected.clear(); suggestion.error = '当前画布、焦点或授权已更新，请重新生成。'; if (suggestionDialog.open) renderSuggestions(); }
    invalidateNarrative();
    if (close) { historyOpen = false; closeSuggestions(); if (settingsDialog.open) { clearSettings(); settingsDialog.close(); } renderHistory(); }
  }
  function update() {
    if (destroyed) return;
    const nextFocus = ctx.focus(), nextGraphId = graph().graphId, nextConsent = consent();
    const changed = nextFocus !== lastFocus || nextGraphId !== lastGraphId || nextConsent !== lastConsent;
    if (changed) { invalidate({ close: nextGraphId !== lastGraphId }); historyLimit = 20; expanded.clear(); jumpTurnId = null; if (nextGraphId !== lastGraphId) { historyMode = 'node'; narrativePathId = null; } lastFocus = nextFocus; lastGraphId = nextGraphId; lastConsent = nextConsent; }
    if (suggestion && graph().revision !== suggestion.graphRevision && !suggestion.applying && (suggestion.set || suggestion.generating)) invalidate();
    if (narrativeBusy && (graph().revision !== narrativeRequestRevision || narrativePathId && !savedRoute(narrativePathId))) { invalidateNarrative(); narrativeError = '路线版本已更新，请重新梳理。'; if (activeTab() === 'narrative') renderNarrative(); }
    if (activeTab() === 'narrative' && narrativePathId) {
      const record = aiStore.narrative(graph(), narrativePathId);
      if (!savedRoute(narrativePathId) || !record && (panel().querySelector('.ai-narrative-confirmed') || $('narrativeDraftForm'))) renderNarrative();
      else if (record?.status === 'stale' && !panel().querySelector('.ai-stale')) {
        const notice = document.createElement('p'); notice.className = 'ai-stale'; notice.setAttribute('role', 'status'); notice.textContent = '可能过期：路线、来源或相关问答发生变化。已有用户版保留，可重新梳理。'; $('narrativeContent')?.prepend(notice);
      }
    }
    renderHistory();
  }
  function renderTab(tab) { if (tab !== 'narrative') return false; renderNarrative(); return true; }
  function destroy() { destroyed = true; invalidate(); settingController?.abort(); settingsDialog.remove(); suggestionDialog.remove(); history.remove(); }
  update();
  return { renderTab, update, invalidate, openSettings, openSuggestions, openNarrative, jumpToTurn, destroy };
}
