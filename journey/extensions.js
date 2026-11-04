import { LegacyCareerAdapter } from './legacy-adapter.js';
import { computeRequirementGaps, comparePaths, makePlan, humanReadableReport } from './planning.js';
import { publicGraph, prepareImport, filterGraphView } from './privacy.js';
import { parseDocumentFile } from './documents.js';
import { pathsTo } from './graph.js';

export const WORKSPACE_KEY = 'shiyu-zuxia.workspace.v1';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未提供';
const safeURL = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const horizonNames = { near: '近期 · 3 个月', mid: '中期 · 1 年', long: '长期 · 3–5 年' };
const statusNames = { todo: '待准备', doing: '进行中', done: '已完成' };
const gapNames = { evidenced: '已有证据支持', self_reported: '可能具备但未证明', missing: '尚未具备', unknown: '未知 / 待核实' };
const relationNames = { possible_path: '可以通往', requires: '依赖', supports: '促进 / 支持', conflicts_with: '存在张力 / 取舍', inspired_by: '受到启发', related_to: '有关联' };
const selects = (values, labels, selected) => values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labels[v] || v)}</option>`).join('');
const defaults = () => ({ version: 1, profile: null, useProfile: false, documents: [], useDocuments: false, researchEnabled: true, liveSearch: false, research: null, view: 'all' });

export function evidenceFromAI(result) {
  if (Array.isArray(result.evidence)) return result.evidence;
  const records = new Map((result.sourceRecords || []).map(source => [source.id, source]));
  return (result.citations || []).map(citation => {
    const record = records.get(citation.sourceId) || {};
    return { ...record, ...citation, sourceId: citation.sourceId || record.id, excerpt: citation.relevantExcerpt || citation.excerpt || record.excerpt || '', hash: citation.hash || record.contentHash || '', expiresAt: record.expiresAt || citation.expiresAt };
  });
}

export function sanitizeWorkspaceImport(raw, { restoreCache = false } = {}) {
  if (!raw || raw.version !== 1) throw new Error('扩展资料备份格式不受支持。');
  const next = defaults();
  if (raw.profile) {
    const p = raw.profile;
    if (!Array.isArray(p.authorizedFields) || !Number.isFinite(Date.parse(p.authorizedAt))) throw new Error('备份中的档案授权记录无效。');
    next.profile = { schemaVersion: 1, source: 'legacy-career', authorizedAt: p.authorizedAt, authorizedFields: [...new Set(p.authorizedFields.filter(f => ['education', 'major', 'stage', 'skills', 'preferences'].includes(f)))] };
    const allowed = field => next.profile.authorizedFields.includes(field);
    if (allowed('education') && ['undergraduate', 'graduate'].includes(p.education)) next.profile.education = p.education;
    if (allowed('major') && typeof p.major === 'string') next.profile.major = p.major.slice(0, 120);
    if (allowed('stage') && ['junior', 'senior', 'other'].includes(p.stage)) next.profile.stage = p.stage;
    if (allowed('skills') && Array.isArray(p.skills)) next.profile.skills = p.skills.slice(0, 60).filter(s => s && typeof s.name === 'string').map(s => ({ name: s.name.slice(0, 120), evidence: typeof s.evidence === 'string' ? s.evidence.slice(0, 1000) : '', level: s.level === 'self_reported' ? 'self_reported' : 'score_only', evidenceType: ['text', 'score', 'mention'].includes(s.evidenceType) ? s.evidenceType : 'mention' }));
    if (allowed('preferences') && p.preferences && typeof p.preferences === 'object') {
      next.profile.preferences = {};
      for (const field of ['employmentChoice', 'location']) if (typeof p.preferences[field] === 'string') next.profile.preferences[field] = p.preferences[field].slice(0, 120);
      if (Array.isArray(p.preferences.directions)) next.profile.preferences.directions = p.preferences.directions.slice(0, 8).map(d => ({ title: String(d.title || '').slice(0, 120), jobs: Array.isArray(d.jobs) ? d.jobs.slice(0, 8).map(j => String(j).slice(0, 120)) : [] }));
    }
  }
  if (raw.documents !== undefined && (!Array.isArray(raw.documents) || raw.documents.length > 3)) throw new Error('备份资料数量超过限制。');
  const documentIds = new Set();
  next.documents = (raw.documents || []).map(d => {
    if (!d || typeof d.id !== 'string' || !d.id.trim() || d.id.length > 160 || typeof d.title !== 'string' || typeof d.text !== 'string' || d.text.length > 20000 || !['text', 'pdf_excerpt'].includes(d.kind)) throw new Error('备份中的文档不符合资料格式。');
    if (documentIds.has(d.id)) throw new Error('备份中的资料 ID 重复，请修复备份后再导入。');
    documentIds.add(d.id);
    return { id: d.id, title: d.title.slice(0, 120), text: d.text, kind: d.kind, locator: String(d.locator || '').slice(0, 250), createdAt: Number.isFinite(Date.parse(d.createdAt)) ? d.createdAt : new Date().toISOString(), shareWithAI: false };
  });
  next.view = ['all', 'career', 'values'].includes(raw.view) ? raw.view : 'all';
  next.researchEnabled = raw.researchEnabled !== false;
  if (restoreCache && raw.research && Array.isArray(raw.research.evidence) && raw.research.evidence.length <= 20 && JSON.stringify(raw.research).length <= 150000) next.research = { ...raw.research, cached: true };
  return next;
}

export function createExtensions(ctx) {
  const { store, storage, graph, nodeById, selectedIds, toast, confirmation, transact } = ctx;
  const legacy = new LegacyCareerAdapter(storage);
  let state = defaults(), planDraft = null, editingTask = null, selectedPaths = [], researchBusy = false, researchController = null, consentEpoch = 0, disposed = false, aiHooks = null;
  try {
    const saved = JSON.parse(storage.getItem(WORKSPACE_KEY) || 'null');
    if (saved?.version === 1) {
      state = sanitizeWorkspaceImport(saved, { restoreCache: true });
    }
  } catch { toast('扩展资料无法读取，原文件保留；人生树仍可继续编辑。'); }
  const panel = () => $('panelScroll');
  const currentProfile = () => state.profile ? { ...structuredClone(state.profile), consent: true } : null;
  const currentPublicPaths = () => graph().savedPaths.filter(p => p.edgeIds.every(id => {
    const edge = graph().edges.find(e => e.id === id);
    return edge && !nodeById(edge.from)?.private && !nodeById(edge.to)?.private;
  }));
  const persist = () => {
    try { storage.setItem(WORKSPACE_KEY, JSON.stringify(state)); return true; }
    catch { toast('扩展资料保存失败，可先导出包含资料的完整备份。'); return false; }
  };
  function invalidateConsent() { consentEpoch++; researchController?.abort(); ctx.invalidateAI(); }
  function open(tab) { ctx.setActiveTab(tab); ctx.renderPanel(); ctx.showMobile(true); }
  function download(data, filename, type = 'application/json;charset=utf-8') {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function consentControls() {
    const controls = $('extensionConsent'); if (!controls) return;
    controls.innerHTML = `<label class="inline-check"><input id="researchEnabled" type="checkbox"${state.researchEnabled ? ' checked' : ''}>查询公开资料</label><label class="inline-check"><input id="useProfile" type="checkbox"${state.useProfile && state.profile ? ' checked' : ''}${state.profile ? '' : ' disabled'}>使用已授权档案</label><label class="inline-check"><input id="useDocuments" type="checkbox"${state.useDocuments ? ' checked' : ''}${state.documents.some(d => d.shareWithAI) ? '' : ' disabled'}>使用勾选资料</label>`;
    for (const id of ['researchEnabled', 'useProfile', 'useDocuments']) $(id).onchange = () => { state[id] = $(id).checked; persist(); invalidateConsent(); };
  }
  function requestExtras() {
    return { researchEnabled: state.researchEnabled, liveSearch: state.liveSearch, ...(state.useProfile && state.profile ? { profile: currentProfile() } : {}), ...(state.useDocuments ? { documents: state.documents.filter(d => d.shareWithAI).map(({ id, title, text, kind, locator }) => ({ id, title, text, kind, locator })) } : {}) };
  }
  function consentKey() { return JSON.stringify([state.useProfile && state.profile ? state.profile.authorizedAt : null, state.useDocuments ? state.documents.filter(d => d.shareWithAI).map(d => d.id) : [], state.researchEnabled, state.liveSearch]); }
  function filter(visible) { return filterGraphView(graph(), visible, state.view); }
  function changeView(view) { state.view = view; persist(); ctx.render(); }

  function renderProfile() {
    const info = legacy.inspect();
    panel().innerHTML = `<div class="detail-label">YOUR CONTEXT, YOUR CONSENT</div><div class="detail-title">职业资料授权</div><p class="hint">按字段只读导入原站资料。先预览，再决定是否用于本次问答；授权可撤销。</p><form id="profileForm">${info.fields.map(f => `<label class="inline-check"><input type="checkbox" name="legacyField" value="${esc(f.id)}"${f.available ? ' checked' : ' disabled'}>${esc(f.label)}${f.available ? `（${f.count || 1} 项）` : '（未填写）'}</label>`).join('')}<div class="detail-actions"><button class="btn primary" type="submit"${info.available ? '' : ' disabled'}>读取所选资料</button><a class="btn" href="/index.html">前往原测评 ↗</a></div></form><div id="profilePreview"></div><div class="detail-block"><button class="btn ghost" id="revokeProfile"${state.profile ? '' : ' disabled'}>撤销导入授权</button></div>`;
    const preview = () => {
      $('profilePreview').innerHTML = state.profile ? `<h4>已授权快照</h4><p class="hint">${date(state.profile.authorizedAt)} · ${esc(state.profile.authorizedFields.join(' / '))}</p><pre class="text-preview">${esc(profileText(state.profile))}</pre><label class="inline-check"><input id="profileUse" type="checkbox"${state.useProfile ? ' checked' : ''}>本次问答允许使用这份档案</label>${state.profile.major ? '<button class="btn" id="applyMajor">将专业作为新分支</button>' : ''}` : '<p class="muted">还没有授权资料。空档案不影响人生树。</p>';
      if ($('profileUse')) $('profileUse').onchange = () => { state.useProfile = $('profileUse').checked; persist(); invalidateConsent(); consentControls(); };
      if ($('applyMajor')) $('applyMajor').onclick = () => {
        const tempId = `major_${crypto.randomUUID()}`;
        if (transact([{ op: 'add_node', tempId, node: { title: state.profile.major, kind: 'major', description: '本人授权的原站专业信息；可继续修改。' } }, { op: 'add_edge', fromId: graph().rootNodeId, toId: tempId }])) toast('已添加专业分支，原有节点保留');
      };
    };
    $('profileForm').onsubmit = event => {
      event.preventDefault();
      try { state.profile = legacy.authorize([...panel().querySelectorAll('[name=legacyField]:checked')].map(e => e.value)); state.useProfile = false; persist(); invalidateConsent(); renderProfile(); consentControls(); }
      catch (error) { toast(error.message); }
    };
    $('revokeProfile').onclick = () => { legacy.revoke(); state.profile = null; state.useProfile = false; persist(); invalidateConsent(); renderProfile(); consentControls(); toast('授权已撤销，原站资料未改变'); };
    preview();
  }
  function profileText(profile) {
    return [profile.major && `专业：${profile.major}`, profile.education && `学段：${profile.education}`, profile.stage && `阶段：${profile.stage}`, ...(profile.skills || []).map(s => `${s.name}：${s.level === 'score_only' ? '原站规则评分，不证明已掌握' : '本人填写'}${s.evidence ? `；${s.evidence}` : ''}`), profile.preferences && `偏好：${JSON.stringify(profile.preferences)}`].filter(Boolean).join('\n');
  }

  function renderResearch() {
    panel().innerHTML = `<div class="detail-label">EVIDENCE BEFORE CERTAINTY</div><div class="detail-title">路径资料与核验</div><p class="hint">按所选路线查询有限官方资料库，可选联网检索。上传资料保存在本机，勾选后才用于本次查询或模型。</p><form id="researchForm"><label for="researchQuestion">要核实的问题</label><textarea id="researchQuestion" maxlength="2000" rows="3" placeholder="例如：剑桥材料硕士需要什么英语成绩？">${esc(state.research?.question || '')}</textarea><label class="inline-check"><input id="liveSearch" type="checkbox"${state.liveSearch ? ' checked' : ''}>允许按问题联网检索（需配置检索服务）</label><div class="detail-actions"><button class="btn primary" id="runResearch" type="submit"${researchBusy ? ' disabled' : ''}>${researchBusy ? '正在检索…' : '检索资料'}</button>${researchBusy ? '<button class="btn" type="button" id="cancelResearch">取消</button>' : ''}</div></form><div class="upload-block"><label for="documentFile">导入 PDF / TXT / MD / CSV（≤5MB，最多3份）</label><input type="file" id="documentFile" accept=".pdf,.txt,.md,.csv"><p id="documentProgress" class="hint"></p>${state.documents.map(d => `<div class="document-card"><strong>${esc(d.title)}</strong><p class="hint">${esc(d.locator)} · ${d.text.length} 字</p><label class="inline-check"><input type="checkbox" data-share-document="${esc(d.id)}"${d.shareWithAI ? ' checked' : ''}>允许本次研究 / AI 使用这份资料</label><button class="btn small remove-document" data-id="${esc(d.id)}">移除待检索原文</button></div>`).join('')}</div><section id="researchResults"></section>`;
    $('researchForm').onsubmit = event => { event.preventDefault(); state.liveSearch = $('liveSearch').checked; runResearch($('researchQuestion').value); };
    if ($('cancelResearch')) $('cancelResearch').onclick = () => researchController?.abort();
    $('documentFile').onchange = async () => {
      const file = $('documentFile').files[0]; if (!file) return;
      if (state.documents.length >= 3) return toast('请先移除一份旧资料。');
      const epoch = consentEpoch;
      try { const document = await parseDocumentFile(file, text => { if ($('documentProgress')) $('documentProgress').textContent = text; }); if (epoch !== consentEpoch) return toast('资料导入已取消'); if (state.documents.length >= 3) throw new Error('资料数量已达上限，请先移除一份。'); state.documents.push({ ...document, shareWithAI: false }); persist(); if (ctx.activeTab() === 'research') renderResearch(); consentControls(); toast('资料已在浏览器解析，尚未授权发送'); }
      catch (error) { if ($('documentProgress')) $('documentProgress').textContent = error.message; toast(error.message); }
    };
    panel().querySelectorAll('[data-share-document]').forEach(input => input.onchange = () => { const document = state.documents.find(d => d.id === input.dataset.shareDocument); document.shareWithAI = input.checked; state.useDocuments = state.documents.some(d => d.shareWithAI); persist(); invalidateConsent(); consentControls(); });
    panel().querySelectorAll('.remove-document').forEach(button => button.onclick = () => { state.documents = state.documents.filter(d => d.id !== button.dataset.id); state.useDocuments = state.documents.some(d => d.shareWithAI); state.research = null; persist(); invalidateConsent(); renderResearch(); consentControls(); });
    renderResearchResults();
  }
  async function runResearch(question) {
    if (researchBusy || !question.trim()) return toast('请先写下要核实的问题。');
    const ids = selectedIds().length ? selectedIds() : [ctx.focus()];
    const request = { question: question.trim(), graph: ctx.compactGraph($('scope').value, ids), selectedNodeIds: ids.filter(id => !nodeById(id)?.private), scope: $('scope').value, researchEnabled: true, liveSearch: state.liveSearch, ...(state.useDocuments ? { documents: requestExtras().documents || [] } : {}), ...(state.useProfile && state.profile ? { profile: currentProfile() } : {}) };
    const epoch = consentEpoch;
    researchBusy = true; researchController = new AbortController(); renderResearch();
    try {
      const response = await fetch('/api/journey/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: researchController.signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '资料检索失败');
      if (epoch !== consentEpoch) return;
      state.research = { ...result, question, graphRevision: request.graph.revision, cachedAt: new Date().toISOString(), cached: false }; persist();
    } catch (error) {
      if (epoch !== consentEpoch) return;
      if (error.name === 'AbortError') toast('检索已取消，图没有改变');
      else if (state.research) { state.research.cached = true; toast('网络不可用，显示上次查询的缓存资料和核验日期。'); }
      else toast(`${error.message}，仍可手动记录待核实项。`);
    } finally { researchBusy = false; researchController = null; if (!disposed && epoch === consentEpoch && ctx.activeTab() === 'research') renderResearch(); }
  }
  function evidenceCard(e, index) {
    const stale = e.stale || Boolean(e.expiresAt && Date.parse(e.expiresAt) <= Date.now());
    const url = safeURL(e.url);
    return `<article class="source-card"><h4>${esc(e.title)}</h4><p class="hint">${esc(e.publisher || '用户资料')} · ${esc(e.region || '适用范围见原文')}<br>核验：${date(e.checkedAt)}${e.publishedAt ? ` · 发布：${esc(e.publishedAt)}` : ''}<br>${stale ? '⚠ 已超出本应用复核窗口，需重新核实' : e.trustLevel === 'official' ? '已记录官方来源，适用范围以原文为准' : '资料线索，尚未独立核实'} · ${esc(e.locator || '')}</p><p class="source-excerpt">${esc(e.excerpt || '')}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="source-link">打开原始来源 ↗</a>` : '<span class="hint">本机上传片段</span>'}<div class="detail-actions"><button class="btn small save-source" data-index="${index}">保存此来源</button><button class="btn small annotate-source" data-index="${index}">标注到所选连线</button></div></article>`;
  }
  function renderResearchResults() {
    if (!$('researchResults') || !state.research) return;
    const research = state.research, evidence = research.evidence || [];
    $('researchResults').innerHTML = `<h4>${research.cached ? '离线缓存 · 上次查询' : '资料摘录与核验结果'}</h4><p class="hint">查询：${esc(research.question)}<br>基于图版本 ${research.graphRevision}，当前 ${graph().revision} · ${date(research.cachedAt)}</p><pre class="text-preview">${esc(research.answer || '暂无匹配的可核验资料。')}</pre><p class="hint">${esc((research.caveats || []).join(' '))}</p>${evidence.map(evidenceCard).join('')}<p class="hint">保存来源不会自动改图；标注条件仍需确认，来源事实不等于当前路线的必需门槛。</p>`;
    $('researchResults').querySelectorAll('.save-source').forEach(b => b.onclick = () => saveEvidence(evidence[Number(b.dataset.index)], false));
    $('researchResults').querySelectorAll('.annotate-source').forEach(b => b.onclick = () => saveEvidence(evidence[Number(b.dataset.index)], true));
  }
  function sourceRecord(e) {
    const stale = e.stale || Boolean(e.expiresAt && Date.parse(e.expiresAt) <= Date.now());
    return { id: e.sourceId || e.id, title: e.title, url: safeURL(e.url), publisher: e.publisher || '', publishedAt: e.publishedAt || undefined, checkedAt: e.checkedAt || new Date().toISOString(), excerpt: (e.excerpt || '').slice(0, 6000), trustLevel: e.trustLevel === 'official' && !stale ? 'official' : e.trustLevel === 'user_provided' ? 'user_provided' : 'unverified', contentHash: e.hash || e.contentHash || '', license: e.license || '', region: e.region || '', language: e.language || '', locator: e.locator || '', expiresAt: e.expiresAt || undefined };
  }
  async function saveEvidence(e, annotate) {
    if (!e) return;
    const expectedRevision = graph().revision, epoch = consentEpoch;
    const edge = graph().edges.find(edge => edge.id === ctx.edgeFocus());
    if (annotate && !edge) return toast('请先在画布点击要标注的连线，再打开资料面板。');
    const source = sourceRecord(e), operations = [{ op: 'upsert_source', source }];
    if (annotate) operations.push({ op: 'annotate_edge', edgeId: edge.id, requirements: [...edge.requirements, { id: `req_${crypto.randomUUID()}`, kind: 'other', label: e.title.slice(0, 120), detail: (e.excerpt || '').slice(0, 2000), necessity: 'unknown', knowledgeStatus: source.trustLevel === 'official' && source.url && source.contentHash ? 'verified' : 'unverified', sourceIds: [source.id], assessment: 'unknown' }] });
    if (await confirmation(annotate ? '将资料作为待评估条件？' : '保存此来源？', `${e.title}。${annotate ? '必要性默认未知，个人是否具备也标为未知；之后可以修改。' : '仅加入当前人生树，不自动添加节点或条件。'}`, '确认保存')) { if (epoch !== consentEpoch) return toast('资料授权已变化，请重新查看来源后操作'); if (transact(operations, expectedRevision)) toast('来源及注释已保存'); }
  }

  function pathPicker() {
    const available = currentPublicPaths(); selectedPaths = selectedPaths.filter(id => available.some(p => p.id === id));
    if (!selectedPaths.length) selectedPaths = available.slice(0, 2).map(p => p.id);
    return `<div class="path-picker">${available.map(p => `<label class="inline-check"><input type="checkbox" name="comparePath" value="${esc(p.id)}"${selectedPaths.includes(p.id) ? ' checked' : ''}>${esc(p.title)}</label>`).join('') || '<p class="muted">先在画布选中目标并保存完整路线；私密路线不进入对比报告。</p>'}</div>`;
  }
  function readPathPicker() { selectedPaths = [...panel().querySelectorAll('[name=comparePath]:checked')].map(e => e.value).slice(0, 4); return selectedPaths; }
  function renderCompare() {
    const selected = selectedIds().filter(id => !nodeById(id)?.private);
    panel().innerHTML = `<div class="detail-label">DIFFERENT PATHS, SAME PERSON</div><div class="detail-title">路线比较与报告</div><p class="hint">可以先比较画布中选中的节点，也可以选择 2–4 条已保存路线。只比较本树已记录的条件。</p><div class="detail-actions"><button class="btn" id="chooseComparison">返回画布选择</button><button class="btn primary" id="askSelectedComparison"${selected.length < 2 ? ' disabled' : ''}>请 AI 比较所选路线</button></div>${selected.length ? `<section class="selected-comparison">${selected.map(id => { const route = pathsTo(graph(), id)[0]; return `<article class="saved-path"><h4>${esc(nodeById(id).title)}</h4><p class="path-text">${esc(route?.nodeIds.map(nodeId => nodeById(nodeId)?.title).join(' → ') || '尚无完整根路径')}</p><p class="hint">条件：${esc((route?.edgeIds || []).flatMap(edgeId => graph().edges.find(edge => edge.id === edgeId)?.requirements.map(requirement => requirement.label) || []).join('、') || '尚未补充')}</p></article>`; }).join('')}</section>` : '<p class="hint">尚未选择路线。在画布开启「多选比较」，选择至少两个节点。</p>'}${pathPicker()}<div class="detail-actions"><button class="btn primary" id="compareRoutes">比较路线</button><button class="btn" id="exportReport">导出文字报告</button><button class="btn" id="createPlan">生成准备清单</button></div><section id="routeComparison"></section>`;
    $('chooseComparison').onclick = () => { ctx.showMobile(false); if ($('multi').getAttribute('aria-pressed') !== 'true') $('multi').click(); };
    $('askSelectedComparison').onclick = () => { ctx.setActiveTab('chat'); ctx.renderPanel(); ctx.showMobile(true); $('scope').value = 'selection'; $('question').value = '请比较我选中的路线，说明条件、投入与取舍。'; $('chatForm').requestSubmit(); };
    $('compareRoutes').onclick = () => {
      try {
        const comparison = comparePaths(graph(), currentProfile(), readPathPicker());
        $('routeComparison').innerHTML = comparison.paths.map(p => `<article class="saved-path"><h4>${esc(p.title)}</h4><p class="path-text">${p.nodeIds.map(id => esc(nodeById(id)?.title)).join(' → ')}</p><p>技能 / 前提：${esc(p.requirements.map(r => `${r.label || r.requirement?.label || ''}（${gapNames[r.gap?.status] || '待核实'}）`).join('、') || '未记录')}</p><p>时间：${esc(formatValue(p.time))}</p><p>成本：${esc(formatValue(p.costs))}</p><p>主观取舍：${esc(formatValue(p.tradeoffs))}</p><p class="hint">额外准备：${esc(formatValue(comparison.differences.find(d => d.pathId === p.id)?.uniqueRequirements))}</p></article>`).join('') + `<p class="hint">共同准备：${esc(formatValue(comparison.common.requirements)) || '尚无已记录的共同条件'}</p>`;
      } catch (error) { toast(error.message); }
    };
    $('exportReport').onclick = () => {
      try { const report = humanReadableReport(graph(), currentProfile(), readPathPicker(), { includePrivate: false }); download(report, '始于足下-路径比较报告.txt', 'text/plain;charset=utf-8'); }
      catch (error) { toast(error.message); }
    };
    $('createPlan').onclick = () => { try { planDraft = makePlan(graph(), currentProfile(), readPathPicker()); open('plan'); } catch (error) { toast(error.message); } };
  }
  function formatValue(value) {
    if (!value || Array.isArray(value) && !value.length) return '未知 / 尚未记录';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(v => {
      if (typeof v === 'string') return v;
      if (v.fromTitle && v.toTitle) return `${v.fromTitle} ${relationNames[v.relation] || '关联'} ${v.toTitle}${v.notes?.length ? `：${v.notes.map(n => n.label + (n.detail ? `（${n.detail}）` : '')).join('、')}` : ''}`;
      const duration = v.durationMonths ? `${v.durationMonths.min ?? '?'}–${v.durationMonths.max ?? '?'} 个月` : '';
      return [v.label || v.title, duration, v.detail].filter(Boolean).join('：') || '未知 / 尚未记录';
    }).join('；');
    return JSON.stringify(value);
  }

  function renderPlan() {
    const tasks = graph().tasks || [], task = tasks.find(t => t.id === editingTask);
    const draftTasks = planDraft ? ['near', 'mid', 'long'].flatMap(h => planDraft[h] || []) : [];
    panel().innerHTML = `<div class="detail-label">ONE NEXT STEP AT A TIME</div><div class="detail-title">行动计划</div><p class="hint">任务表示你的准备计划。完成任务不会自动宣称节点已实现或能力已获证。</p>${draftTasks.length ? `<div class="proposal"><h4>准备清单草案 · 尚未保存</h4>${draftTasks.map(t => `<p>${esc(horizonNames[t.horizon])} · ${esc(t.title)}</p>`).join('')}<div class="detail-actions"><button class="btn primary" id="acceptPlan">确认加入 ${draftTasks.length} 个任务</button><button class="btn" id="rejectPlan">暂不采用</button></div></div>` : ''}<form id="taskForm" class="detail-form"><label for="taskTitle">${task ? '编辑任务' : '新建任务'}</label><input id="taskTitle" required maxlength="120" value="${esc(task?.title)}" placeholder="例如：核实目标项目英语要求"><label for="taskDescription">准备内容 / 依据</label><textarea id="taskDescription" rows="2" maxlength="2000">${esc(task?.description)}</textarea><div class="two-cols"><div><label for="taskHorizon">阶段</label><select id="taskHorizon">${selects(Object.keys(horizonNames), horizonNames, task?.horizon || 'near')}</select></div><div><label for="taskStatus">进度</label><select id="taskStatus">${selects(Object.keys(statusNames), statusNames, task?.status || 'todo')}</select></div></div><label for="taskDue">截止日期（选填）</label><input type="date" id="taskDue" value="${esc(task?.dueDate || '')}"><div class="detail-actions"><button class="btn primary" type="submit">${task ? '保存任务' : '添加任务'}</button>${task ? '<button class="btn ghost" id="cancelTaskEdit" type="button">取消编辑</button>' : ''}</div></form>${['near', 'mid', 'long'].map(h => `<section class="plan-section"><h4>${esc(horizonNames[h])}</h4>${tasks.filter(t => t.horizon === h).map(t => `<article class="task-card"><strong>${esc(t.title)}</strong><p>${esc(t.description || '')}</p><p class="hint">${esc(statusNames[t.status])}${t.dueDate ? ` · 截止 ${esc(t.dueDate)}` : ''}${t.edgeId ? ' · 已关联路径条件' : ''}</p><div class="detail-actions"><button class="btn small task-status" data-id="${esc(t.id)}">${t.status === 'done' ? '重新打开' : '标记完成'}</button><button class="btn small task-edit" data-id="${esc(t.id)}">编辑</button><button class="btn small ghost task-delete" data-id="${esc(t.id)}">删除</button></div></article>`).join('') || '<p class="hint">此阶段还没有任务。</p>'}</section>`).join('')}`;
    if ($('acceptPlan')) $('acceptPlan').onclick = () => { if (transact(draftTasks.map(task => ({ op: 'add_task', task })))) { planDraft = null; renderPlan(); toast('准备清单已加入，可逐项修改或删除'); } };
    if ($('rejectPlan')) $('rejectPlan').onclick = () => { planDraft = null; renderPlan(); };
    $('taskForm').onsubmit = event => {
      event.preventDefault();
      const patch = { title: $('taskTitle').value.trim(), description: $('taskDescription').value.trim(), horizon: $('taskHorizon').value, status: $('taskStatus').value, dueDate: $('taskDue').value || undefined };
      if (transact([task ? { op: 'update_task', taskId: task.id, patch } : { op: 'add_task', task: patch }])) { editingTask = null; renderPlan(); }
    };
    if ($('cancelTaskEdit')) $('cancelTaskEdit').onclick = () => { editingTask = null; renderPlan(); };
    panel().querySelectorAll('.task-status').forEach(b => b.onclick = () => { const t = tasks.find(t => t.id === b.dataset.id); transact([{ op: 'update_task', taskId: t.id, patch: { status: t.status === 'done' ? 'todo' : 'done' } }]); });
    panel().querySelectorAll('.task-edit').forEach(b => b.onclick = () => { editingTask = b.dataset.id; renderPlan(); });
    panel().querySelectorAll('.task-delete').forEach(b => b.onclick = () => transact([{ op: 'delete_task', taskId: b.dataset.id }]));
  }

  function renderHistory() {
    panel().innerHTML = `<div class="detail-label">YOUR PATH CAN CHANGE</div><div class="detail-title">版本与人生时间轴</div><p class="hint">保存此刻的想法。恢复旧版本会保留已有版本，也可以撤销恢复。</p><form id="snapshotForm"><label for="snapshotTitle">版本名称</label><input id="snapshotTitle" required maxlength="120" placeholder="例如：大三秋季 · 保留两条路线"><label for="snapshotNote">当时的想法（选填）</label><textarea id="snapshotNote" rows="2" maxlength="2000"></textarea><div class="detail-actions"><button class="btn primary" type="submit">保存命名版本</button></div></form><section>${store.snapshots.map(s => `<article class="snapshot-card"><h4>${esc(s.title)}</h4><p class="hint">${date(s.createdAt)} · 版本 ${s.revision} · ${s.nodeCount} 节点 / ${s.edgeCount} 连线</p><p>${esc(s.note || '')}</p><div class="detail-actions"><button class="btn small view-snapshot" data-id="${esc(s.id)}">查看内容</button><button class="btn small restore-snapshot" data-id="${esc(s.id)}">恢复此版本…</button></div><div id="snapshot-${esc(s.id)}"></div></article>`).join('') || '<p class="muted">尚无命名版本。撤销历史与命名版本分别保留。</p>'}</section><h4>节点状态时间轴</h4>${[...graph().nodes].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(n => `<div class="timeline-item"><span>${date(n.updatedAt)}</span><strong>${esc(n.title)}</strong><small>${esc(ctx.phaseName(n.phase))}${n.private ? ' · 私密' : ''}</small></div>`).join('')}`;
    $('snapshotForm').onsubmit = event => { event.preventDefault(); const result = store.snapshot($('snapshotTitle').value.trim(), $('snapshotNote').value.trim()); if (result) { renderHistory(); toast('此刻的想法已保存为命名版本'); } };
    panel().querySelectorAll('.view-snapshot').forEach(b => b.onclick = () => {
      const snapshot = store.getSnapshot(b.dataset.id); if (!snapshot) return;
      $(`snapshot-${b.dataset.id}`).innerHTML = `<pre class="text-preview">${esc(snapshot.graph.nodes.map(n => `${n.title} · ${ctx.phaseName(n.phase)}`).join('\n') + '\n\n条件注释：\n' + snapshot.graph.edges.flatMap(e => e.requirements.map(r => r.label + '：' + (r.detail || ''))).join('\n'))}</pre>`;
    });
    panel().querySelectorAll('.restore-snapshot').forEach(b => b.onclick = async () => {
      const expectedRevision = graph().revision, snapshot = store.getSnapshot(b.dataset.id);
      if (snapshot && await confirmation('恢复这个人生版本？', `将恢复「${snapshot.title}」中的节点、条件与任务。当前状态会保留为恢复前版本；后续命名版本不会删除。`, '确认恢复')) {
        if (store.restoreSnapshotById(snapshot.id, expectedRevision)) { ctx.resetFocus(); invalidateConsent(); ctx.render(); toast('旧版本已恢复，其他版本仍保留'); }
      }
    });
  }

  function renderReflections() {
    const reflections = graph().reflections || [];
    panel().innerHTML = `<div class="detail-label">ROOM FOR UNFINISHED THOUGHTS</div><div class="detail-title">自愿反思</div><p class="hint">可以矛盾，也可以暂时没有答案。反思默认私密，不进入模型问答、招聘匹配或分享副本。</p><form id="reflectionForm"><label for="reflectionText">此刻想记下什么？</label><textarea id="reflectionText" required rows="5" maxlength="4000" placeholder="例如：科研与旅行都很吸引我，我还在理解自己愿意如何安排时间。"></textarea><label class="inline-check"><input id="linkReflection" type="checkbox" checked>关联当前节点：${esc(nodeById(ctx.focus())?.title || '起点')}</label><div class="detail-actions"><button class="btn primary" type="submit">私密保存</button><button class="btn" type="button" id="reflectionPrompt">给我一个开放问题</button></div></form>${reflections.map(r => `<article class="reflection-card"><p>${esc(r.text)}</p><p class="hint">${date(r.updatedAt)} · 私密${r.nodeId ? ` · ${esc(nodeById(r.nodeId)?.title)}` : ''}</p><div class="detail-actions"><button class="btn small edit-reflection" data-id="${esc(r.id)}">编辑</button><button class="btn small ghost remove-reflection" data-id="${esc(r.id)}">删除</button></div></article>`).join('')}`;
    $('reflectionForm').onsubmit = event => { event.preventDefault(); transact([{ op: 'add_reflection', reflection: { text: $('reflectionText').value.trim(), private: true, ...($('linkReflection').checked ? { nodeId: ctx.focus() } : {}) } }]); };
    $('reflectionPrompt').onclick = () => { $('reflectionText').placeholder = '这条路最吸引你的是什么？有哪些部分，你愿意先尝试再判断？'; $('reflectionText').focus(); toast('这条路最吸引你的是什么？哪些部分愿意先尝试再判断？'); };
    panel().querySelectorAll('.remove-reflection').forEach(b => b.onclick = () => transact([{ op: 'delete_reflection', reflectionId: b.dataset.id }]));
    panel().querySelectorAll('.edit-reflection').forEach(b => b.onclick = () => {
      const reflection = reflections.find(r => r.id === b.dataset.id), replacement = prompt('修改这段私密反思', reflection.text);
      if (replacement !== null) transact([{ op: 'update_reflection', reflectionId: reflection.id, patch: { text: replacement, private: true } }]);
    });
  }

  function renderPrivacy() {
    const shared = publicGraph(graph()), sharedCount = shared.nodes.filter(n => n.shareAllowed).length;
    const sharedPreview = shared.nodes.map(n => n.title).join('\n') + '\n\n' + shared.edges.map(e => `${shared.nodes.find(n => n.id === e.from)?.title} → ${shared.nodes.find(n => n.id === e.to)?.title}（${relationNames[e.relation] || e.relation}）\n${e.requirements.map(r => `  ${r.label}：${r.detail || '无补充说明'}`).join('\n')}`).join('\n');
    panel().innerHTML = `<div class="detail-label">PRIVATE BY DEFAULT</div><div class="detail-title">导出、分享与导入</div><p class="hint">公开副本仅包含你明确勾选的非私密节点及其连线。档案、上传资料、任务和反思不进入公开副本。</p><div class="sharing-list">${graph().nodes.map(n => `<label class="inline-check"><input type="checkbox" data-share-node="${esc(n.id)}"${n.shareAllowed && !n.private ? ' checked' : ''}${n.private ? ' disabled' : ''}>${esc(n.title)}${n.private ? ' · 私密，禁止公开' : ''}</label>`).join('')}</div><div class="export-preview"><h4>公开副本预览 · ${sharedCount} 个授权节点</h4><pre class="text-preview">${esc(sharedPreview || '尚未授权分享内容')}\n\n${shared.edges.length} 条连线</pre><button class="btn primary" id="publicExport"${sharedCount ? '' : ' disabled'}>下载公开 JSON 副本</button></div><div class="export-preview"><h4>仅供自己的完整备份</h4><p class="hint">当前树：${graph().nodes.length} 节点、${graph().edges.length} 连线、${(graph().tasks || []).length} 任务、${(graph().reflections || []).length} 段私密反思；${store.snapshots.length} 个命名版本。完整备份可能包含敏感内容。</p><div class="detail-actions"><button class="btn" id="backupExport">导出当前树 JSON</button><button class="btn" id="archiveExport">完整备份（含版本和本机资料）</button></div></div><div class="upload-block"><label for="importGraph">从 JSON 备份恢复 / 导入</label><input id="importGraph" type="file" accept=".json,application/json"><p class="hint">先验证并预览，再确认导入；不会写入旧测评。导入来源需重新核实，公开授权默认关闭。</p><section id="importPreview"></section></div>`;
    panel().querySelectorAll('[data-share-node]').forEach(input => input.onchange = () => transact([{ op: 'update_node', nodeId: input.dataset.shareNode, patch: { shareAllowed: input.checked } }]));
    $('publicExport').onclick = () => download(publicGraph(graph()), '始于足下-公开副本-v1.json');
    $('backupExport').onclick = () => ctx.exportGraph();
    $('archiveExport').onclick = async () => {
      if (await confirmation('导出完整本机备份？', '备份包含私密节点、反思、命名版本、档案、上传资料及本树问答和路线介绍，仅供自己保管。', '确认导出')) download({ ...store.exportArchive(), workspace: state, ...(aiHooks ? { ai: aiHooks.exportData() } : {}) }, '始于足下-完整本机备份-v1.json');
    };
    $('importGraph').onchange = async () => {
      const file = $('importGraph').files[0]; if (!file) return;
      const epoch = consentEpoch;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('备份文件最多 8 MB。');
        const parsed = JSON.parse(await file.text()), imported = prepareImport(parsed.archiveVersion === 1 ? parsed.graph : parsed);
        if (disposed || epoch !== consentEpoch) return;
        const importedWorkspace = parsed.workspace ? sanitizeWorkspaceImport(parsed.workspace) : null;
        const aiImportOptions = { sourceGraphId: imported.graphId, sourceRootId: imported.rootNodeId };
        if (parsed.ai) { if (!aiHooks) throw new Error('当前页面没有问答存储，不能忽略备份中的问答。'); aiHooks.validateImport(parsed.ai, aiImportOptions); }
        const archive = parsed.archiveVersion === 1 ? { archiveVersion: 1, exportedAt: parsed.exportedAt, graph: imported, snapshots: (parsed.snapshots || []).map(s => ({ ...s, graph: prepareImport(s.graph) })) } : imported;
        const expectedRevision = graph().revision;
        $('importPreview').innerHTML = `<p>${esc(imported.title)} · ${imported.nodes.length} 节点 / ${imported.edges.length} 连线 / ${(imported.tasks || []).length} 任务</p><pre class="text-preview">${esc(imported.nodes.map(n => n.title).join('\n'))}</pre><button class="btn primary" id="confirmImport">确认导入备份…</button>`;
        $('confirmImport').onclick = async () => {
          if (await confirmation('导入这个人生树备份？', '当前图会保留为导入前版本，导入可撤销；原有命名版本会保留。', '确认导入')) {
            try {
              if (parsed.ai) aiHooks.validateImport(parsed.ai, aiImportOptions);
              if (store.importGraph(archive, expectedRevision)) {
                if (importedWorkspace) { state = importedWorkspace; persist(); $('graphView').value = state.view; consentControls(); }
                ctx.resetFocus(); invalidateConsent();
                if (parsed.ai) { try { aiHooks.importData(parsed.ai, aiImportOptions); } catch (error) { ctx.render(); return toast(`图已恢复，但问答导入失败：${error.message}。原问答保留，可撤销本次图导入。`); } }
                ctx.render(); toast('备份已导入；资料和档案恢复后需重新授权模型使用');
              }
            } catch (error) { toast(`导入失败：${error.message}`); }
          }
        };
      } catch (error) { toast(`导入失败：${error.message}`); }
    };
  }

  function decorateNode(node) {
    const section = document.createElement('section'); section.className = 'node-extra detail-block';
    const links = legacy.links(node);
    section.innerHTML = `<h4>与其他领域的关系</h4><label for="connectRelation">新连线关系</label><select id="connectRelation">${selects(Object.keys(relationNames), relationNames, 'possible_path')}</select><p class="hint">支持与冲突关系允许回环；推进与依赖关系仍禁止循环。</p><div class="detail-actions"><button class="btn small" id="nodeResearch">查这条路的资料</button><button class="btn small" id="nodeReflection">记一段私密反思</button></div>${!node.private ? `<div class="detail-actions"><a class="btn small" id="legacyJobLink" href="${esc(links.jobSearch.href)}">原站岗位匹配 ↗</a><button class="btn small" id="copyJobKeyword">复制岗位关键词</button><a class="btn small" href="${esc(links.preparation.href)}">求职准备 ↗</a></div><p class="hint">原站不读取路径查询参数，打开后请粘贴关键词；人生资料不会自动写入旧站。</p>` : '<p class="hint">私密节点不提供岗位外传入口。</p>'}`;
    panel().append(section);
    $('connectNode').onclick = () => { const target = $('connectTarget').value; if (!target) return toast('请先创建另一个节点。'); transact([{ op: 'add_edge', fromId: node.id, toId: target, relation: $('connectRelation').value }]); };
    $('nodeResearch').onclick = () => open('research'); $('nodeReflection').onclick = () => open('reflections');
    if ($('copyJobKeyword')) $('copyJobKeyword').onclick = async () => { try { await navigator.clipboard.writeText(links.jobSearch.keyword); toast('关键词已复制，请在原站粘贴'); } catch { toast(`岗位关键词：${links.jobSearch.keyword}`); } };
  }
  function decorateEdge(edge) {
    const gaps = computeRequirementGaps(graph(), currentProfile());
    const section = document.createElement('section'); section.className = 'detail-block';
    section.innerHTML = `<h4>个人证据与下一步</h4><p class="hint">有规则评分或关键词相似，不等于已经达标。状态可以由你依据实际证据修正。</p>${edge.requirements.map(r => {
      const gap = gaps.find(g => g.edgeId === edge.id && g.requirementId === r.id);
      return `<div class="gap-card"><strong>${esc(r.label)}</strong><p class="hint">${esc(gap?.reason || '没有可比对的本人证据')}</p><label>个人达成状态<select data-assessment="${esc(r.id)}">${selects(Object.keys(gapNames), gapNames, r.assessment || gap?.status || 'unknown')}</select></label><label>本人证据 / 备注<input data-evidence="${esc(r.id)}" maxlength="2000" value="${esc(r.evidenceNote || '')}"></label><div class="detail-actions"><button class="btn small save-assessment" data-id="${esc(r.id)}">保存证据状态</button><button class="btn small requirement-task" data-id="${esc(r.id)}">转为准备任务</button></div>${(r.sourceIds || []).map(id => { const s = (graph().sources || []).find(s => s.id === id), url = safeURL(s?.url); return s ? `<p class="hint">${url ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(s.title)} ↗</a>` : esc(s.title)} · ${date(s.checkedAt)}</p>` : ''; }).join('')}</div>`;
    }).join('') || '<p class="muted">先添加条件，再评估能力差距。</p>'}<button class="btn" id="edgeResearch">为这段路线查询资料</button>`;
    panel().append(section);
    section.querySelectorAll('.save-assessment').forEach(b => b.onclick = () => {
      const status = section.querySelector(`[data-assessment="${b.dataset.id}"]`).value, note = section.querySelector(`[data-evidence="${b.dataset.id}"]`).value.trim();
      transact([{ op: 'annotate_edge', edgeId: edge.id, requirements: edge.requirements.map(r => r.id === b.dataset.id ? { ...r, assessment: status, evidenceNote: note } : r) }]);
    });
    section.querySelectorAll('.requirement-task').forEach(b => b.onclick = () => { const r = edge.requirements.find(r => r.id === b.dataset.id); if (transact([{ op: 'add_task', task: { title: `准备 / 核实：${r.label}`.slice(0, 120), description: r.detail || '核对正式要求，再决定如何准备。', status: 'todo', horizon: 'near', edgeId: edge.id, requirementId: r.id, sourceIds: (r.sourceIds || []).filter(id => (graph().sources || []).some(s => s.id === id)) } }])) toast('已加入行动计划，仍可编辑'); });
    $('edgeResearch').onclick = () => open('research');
  }

  function render(tab) {
    const renderers = { profile: renderProfile, research: renderResearch, compare: renderCompare, plan: renderPlan, history: renderHistory, reflections: renderReflections, privacy: renderPrivacy };
    if (!renderers[tab]) return false;
    renderers[tab](); return true;
  }
  function resetLocalData() { consentEpoch++; researchController?.abort(); state = defaults(); planDraft = null; selectedPaths = []; legacy.revoke(); try { storage.removeItem(WORKSPACE_KEY); } catch { toast('扩展资料清理失败，请检查浏览器存储设置。'); } consentControls(); }
  function observeSources(result) {
    const evidence = evidenceFromAI(result);
    if (evidence.length) { state.research = { ...result, evidence, question: result.question || 'AI 本次引用的资料', graphRevision: result.usedGraphRevision ?? '未标注', cachedAt: new Date().toISOString() }; persist(); }
  }
  consentControls();
  if ($('graphView')) { $('graphView').value = state.view; $('graphView').onchange = () => changeView($('graphView').value); }
  return { open, render, decorateNode, decorateEdge, requestExtras, consentKey, filter, observeSources, resetLocalData, setAIHooks: hooks => { aiHooks = hooks; }, dispose: () => { disposed = true; consentEpoch++; researchController?.abort(); }, state: () => structuredClone(state) };
}
