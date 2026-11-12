import { NodeKinds, RequirementKinds, applyOperations, pathsTo, visibleGraph, validateProposal } from './graph.js';
import { GraphStore, STORAGE_KEY, BACKUP_KEY } from './store.js';
import { TreeLibrary } from './forest.js';
import { createExtensions } from './extensions.js';
import { projectAIContext } from './privacy.js';
import { createAIIntegration } from './ai-integration.js';
import { cloneTreeAIData } from './forest-ai.js';
import { migrateAndClearChatCopies } from './ai-legacy-migration.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kindNames = { self: '此刻', major: '专业', education: '升学', career: '职业', milestone: '阶段', skill: '能力', goal: '目标', other: '自由想法', value: '价值', passion: '热爱', desire: '愿望', philosophy: '思想', lifestyle: '生活', life_event: '事件' };
const reqNames = { education: '学历', skill: '技能', certificate: '证书', experience: '经历', time: '时间', cost: '金钱', location: '地区', resource: '资源', personal: '个人条件', other: '其他' };
const necessityNames = { required: '必需（用户判断）', recommended: '建议', optional: '可选', unknown: '未知 / 待核实' };
const phaseNames = { idea: '设想', exploring: '探索中', planned: '计划中', in_progress: '准备中', achieved: '已实现', abandoned: '已放弃', paused: '暂时搁置' };
const star = $('start');
let toastTimer, entered = false, transitioning = false, multi = false, activeTab = 'detail', edgeFocus = null, growParent = null;
let aiState = { configured: false, checked: false }, aiStatusEpoch = 0, aiController = null, busy = false, proposal = null, messages = [];
let extensions, enhancedAI, conversationMigrated = false, aiEpoch = 0, currentTree = null, creatingType = null;
let storage;
try { storage = window.localStorage; } catch { storage = { getItem() { throw new Error('浏览器存储不可用'); }, setItem() { throw new Error('浏览器存储不可用'); } }; }
function saveStatus(state, text) {
  $('saveStatus').textContent = text + (state === 'saved' ? ' · 仅此设备，无云端同步' : '');
  $('saveStatus').className = `muted ${state === 'saved' ? 'saved-state' : 'dirty-state'}`;
  $('storageNotice').hidden = state !== 'error';
  $('storageError').textContent = text;
  if (state === 'saved' && currentTree) library.refresh(currentTree.id);
}
function libraryStatus(message) {
  $('libraryNotice').textContent = message;
  $('libraryNotice').hidden = !message;
}
const library = new TreeLibrary(storage, libraryStatus);
const scratch = new Map();
let store = new GraphStore({ getItem: key => scratch.get(key) ?? null, setItem: (key, value) => scratch.set(key, value), removeItem: key => scratch.delete(key) }, saveStatus);
let focus = store.ui.selected.find(id => store.graph.nodes.some(n => n.id === id)) || store.graph.rootNodeId;
const treeTypes = {
  career: { name: '职业树', title: '我的职业探索', description: '从现在的专业与阶段出发' },
  life: { name: '生活树', title: '我想过的生活', description: '自由、关系与日常的选择' },
  thought: { name: '思想与热爱树', title: '我的热爱与思考', description: '哲学、欲望与自由' },
  blank: { name: '空白自定义树', title: '一棵新的树', description: '由自己定义节点与关系' },
};
const graph = () => store.graph;
const nodeById = id => graph().nodes.find(n => n.id === id);
const selectedIds = () => store.ui.selected.filter(id => nodeById(id));
const options = (values, names, selected) => values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(names[v] || v)}</option>`).join('');
const paths = id => pathsTo(graph(), id, { maxPaths: 8, maxDepth: 300 });
const pathText = path => path.nodeIds.map(id => nodeById(id)?.title || '').join(' → ');
function toast(text) { $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
function transact(operations, expectedRevision, settings) {
  try { store.commit(operations, expectedRevision, settings); render(); return true; }
  catch (error) { toast(error.message); return false; }
}
function confirmation(title, text, action = '确认') {
  $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmAction').textContent = action;
  const dialog = $('confirmDialog');
  if (dialog.open) return Promise.resolve(false);
  dialog.returnValue = ''; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

// The opening always leads to the library. A canvas only opens by tree ID.
async function enter() {
  if (entered || transitioning) return;
  transitioning = true;
  $('intro').classList.add('transitioning');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 850));
  transitioning = false;
  navigate('/trees');
}
star.addEventListener('click', () => { if (entered) { selectNode(graph().rootNodeId); openGrow(graph().rootNodeId); } else enter(); });
function mountStar() {
  if (!entered) return;
  const root = $('nodes').querySelector(`[data-node="${graph().rootNodeId}"]`);
  if (root) { star.className = 'root-point'; star.style.cssText = ''; star.setAttribute('aria-label', '我 · 此刻，选择起点'); root.append(star); }
}
function persistConversation() {
  store.ui.focused = focus;
  if (conversationMigrated) delete store.ui.chat;
  else store.ui.chat = structuredClone(messages.slice(-80));
}
function clearMigratedChatCopies() {
  if (!conversationMigrated) return;
  try {
    migrateAndClearChatCopies({ storage, scopedStorage: store.storage, graph: graph(), aiStore: enhancedAI.aiStore });
    delete store.ui.chat;
    store.save();
  } catch (error) { toast(`问答已迁入独立历史，旧聊天副本清理未完成：${error.message}`); }
}
function flushTree() {
  if (!currentTree) return true;
  persistConversation();
  const saved = store.save();
  if (!saved && store.blocked) { toast('当前树有存储冲突，请先导出备份或读取另一页版本，再离开画布。'); return false; }
  library.refresh(currentTree.id);
  return true;
}
function initExtensions() {
  extensions = createExtensions({ store, storage: library.scopedStorage(currentTree.id), graph, nodeById, selectedIds, toast, confirmation, transact, compactGraph, exportGraph, render, renderPanel, showMobile, focus: () => focus, edgeFocus: () => edgeFocus, activeTab: () => activeTab, setActiveTab: tab => { activeTab = tab; }, phaseName: phase => phaseNames[phase] || '设想', resetFocus: () => { focus = graph().rootNodeId; edgeFocus = null; proposal = null; }, invalidateAI: () => { enhancedAI?.invalidate(); aiEpoch++; aiController?.abort(); aiController = null; setBusy(false); proposal = null; messages = []; persistConversation(); store.schedule(); renderGhosts(); if (activeTab === 'chat') renderChat(); } });
  extensions.setAIHooks({ exportData: () => enhancedAI.aiStore.exportData(graph().graphId), validateImport: (raw, options) => enhancedAI.aiStore.validateImport(raw, graph(), options), importData: (raw, options) => enhancedAI.aiStore.importData(raw, graph(), options) });
}
function deactivateTree() {
  enhancedAI?.invalidate({ close: true }); conversationMigrated = false;
  aiEpoch++; aiController?.abort(); aiController = null; setBusy(false);
  extensions?.dispose(); extensions = null;
  clearTimeout(store.timer); entered = false; currentTree = null; messages = []; proposal = null;
  edgeFocus = null; growParent = null; multi = false; activeTab = 'detail';
  pointers.clear(); pan = null; pinch = null;
  $('intro').append(star); star.className = 'star'; star.style.cssText = ''; star.setAttribute('aria-label', '点击光点，进入我的树大厅');
  $('intro').classList.remove('transitioning');
  for (const id of ['intro', 'treeHub', 'app', 'missingTree']) { $(id).hidden = true; $(id).inert = true; }
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close('cancel');
  $('mainpanel').classList.remove('mobile-hidden'); $('rightpanel').classList.remove('mobile-visible');
  $('question').value = ''; $('scope').value = 'path'; $('search').value = '';
}
function renderGallery() {
  const trees = library.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('treeTotal').textContent = `${trees.length} 棵树`;
  $('savedTrees').innerHTML = trees.length ? trees.map(tree => `<article class="saved-tree" data-tree-id="${esc(tree.id)}"><div class="saved-head"><span class="saved-kind">${esc(treeTypes[tree.type].name)}</span><span class="saved-time">最近编辑 ${esc(new Date(tree.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }))}</span></div><h4>${esc(tree.title)}</h4><p class="saved-desc">${esc(tree.description || treeTypes[tree.type].description)}</p><div class="saved-mini" aria-hidden="true"><i></i><span class="mini-link"></span><i></i><span class="mini-link"></span><i></i><span class="count">${tree.nodeCount} 个节点</span></div><div class="saved-actions"><button class="btn primary small" data-act="open" data-id="${esc(tree.id)}">继续探索 ↗</button><button class="btn ghost small" data-act="rename" data-id="${esc(tree.id)}">重命名</button><button class="btn ghost small" data-act="duplicate" data-id="${esc(tree.id)}">复制</button><button class="btn ghost small" data-act="export" data-id="${esc(tree.id)}">导出</button><button class="btn ghost small danger" data-act="delete" data-id="${esc(tree.id)}">删除</button></div></article>`).join('') : '<div class="empty-library"><span class="empty-dot" aria-hidden="true"></span><strong>还没有保存的树</strong><p>从上方选一种类型，为自己的探索留下第一棵树。<br>新建后，你随时可以返回这里继续。</p></div>';
}
function showRoute(path, { initial = false } = {}) {
  deactivateTree();
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/trees') {
    renderGallery(); $('treeHub').hidden = false; $('treeHub').inert = false;
    document.title = '我的树 · 始于足下';
    $('treeHub').scrollTop = 0; $('createTitle').tabIndex = -1; $('createTitle').focus({ preventScroll: true });
  } else if (normalized.startsWith('/trees/')) {
    let entry;
    try { entry = library.get(decodeURIComponent(normalized.slice('/trees/'.length))); } catch { entry = null; }
    if (!entry) {
      $('missingTree').hidden = false; $('missingTree').inert = false; $('missingBack').focus(); document.title = '未找到这棵树 · 始于足下'; return;
    }
    currentTree = entry;
    store = new GraphStore(library.scopedStorage(entry.id), saveStatus);
    const linkedNode = nodeById(new URLSearchParams(location.hash.slice(1)).get('node'));
    focus = linkedNode?.id || store.ui.focused || store.ui.selected.at(-1) || graph().rootNodeId;
    if (!nodeById(focus)) focus = graph().rootNodeId;
    if (linkedNode) {
      const parents = new Set(paths(focus).flatMap(path => path.nodeIds.slice(0, -1)));
      store.ui.selected = [focus];
      store.ui.collapsed = store.ui.collapsed.filter(id => !parents.has(id));
    }
    messages = structuredClone(store.ui.chat || []);
    $('app').hidden = false; $('app').inert = false; entered = true; store.ui.entered = true;
    initExtensions(); conversationMigrated = enhancedAI?.activate(messages) ?? false; clearMigratedChatCopies(); render();
    if (graph().nodes.length === 1 && graph().viewport.x === 0 && graph().viewport.y === 0) resetViewport();
    showMobile(false); persistConversation(); store.schedule();
    if (linkedNode) centerNode(focus);
    ($('nodes').querySelector('.node.focus .node-main') || $('nodes').querySelector('.node-main'))?.focus({ preventScroll: true });
  } else {
    $('intro').hidden = false; $('intro').inert = false; document.title = '始于足下 · 从一个点开始'; if (!initial) star.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}
function navigate(path, { replace = false, pop = false } = {}) {
  if (!flushTree()) { if (pop && currentTree) history.pushState({}, '', `/trees/${encodeURIComponent(currentTree.id)}`); return false; }
  if (!pop) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  showRoute(path);
  return true;
}
function openCreate(type) {
  creatingType = type; $('createTreeHeading').textContent = `新建${treeTypes[type].name}`;
  $('createTreeHint').textContent = `${treeTypes[type].description}。从一个起点开始，之后的分支由你决定。`;
  $('treeName').value = treeTypes[type].title; $('treeDescription').value = ''; $('createTreeError').textContent = '';
  $('createTreeDialog').showModal(); $('treeName').focus(); $('treeName').select();
}
function downloadTree(id) {
  if (currentTree?.id === id) { persistConversation(); store.save(); }
  let data;
  try { data = library.exportTree(id); }
  catch (error) {
    if (currentTree?.id !== id) throw error;
    data = { treeArchiveVersion: 1, exportedAt: new Date().toISOString(), tree: { ...currentTree, title: graph().title, nodeCount: graph().nodes.length }, document: { storageVersion: 1, serial: store.serial || crypto.randomUUID() }, backup: null, workspace: extensions?.state() || null, recovery: { primaryRaw: store.storage.getItem(STORAGE_KEY), note: error.message } };
  }
  if (currentTree?.id === id) data.document = { ...data.document, graph: structuredClone(graph()), ui: structuredClone(store.ui), undo: structuredClone(store.undoStack), redo: structuredClone(store.redoStack), snapshots: store.exportArchive().snapshots };
  data.ai = enhancedAI.aiStore.exportData(data.document.graph.graphId);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `始于足下-${library.get(id).title.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出完整树备份，含本树对话与资料，请自行保管。');
}
function attachTreeAI(entry, data, sourceGraphId) {
  if (!data.turns.length && !data.narratives.length) return;
  const targetGraph = new GraphStore(library.scopedStorage(entry.id)).graph;
  enhancedAI.aiStore.validateImport(data, targetGraph, { sourceGraphId });
  enhancedAI.aiStore.importData(data, targetGraph, { sourceGraphId });
}
function duplicateTree(id) {
  const source = library.exportTree(id).document.graph;
  const aiData = cloneTreeAIData(enhancedAI.aiStore.exportData(source.graphId), source.graphId);
  const entry = library.duplicate(id);
  try { attachTreeAI(entry, aiData, source.graphId); return entry; }
  catch (error) { library.remove(entry.id); throw error; }
}
function importTreeArchive(raw) {
  const parsed = library.parseImport(raw);
  const sourceGraphId = parsed.document.graph.graphId;
  const aiData = raw.ai ? cloneTreeAIData(raw.ai, sourceGraphId) : { schemaVersion: 1, turns: [], narratives: [] };
  const entry = library.importTree(raw);
  try { attachTreeAI(entry, aiData, sourceGraphId); return entry; }
  catch (error) { library.remove(entry.id); throw error; }
}
function removeTree(id) {
  if (!library.get(id)) return false;
  if (currentTree?.id === id) enhancedAI.invalidate({ close: true });
  const aiData = enhancedAI.aiStore.exportData(id);
  if (aiData.turns.length || aiData.narratives.length) enhancedAI.aiStore.deleteLocal(id);
  return library.remove(id);
}
function resetViewport() {
  const box = $('canvas').getBoundingClientRect();
  graph().viewport = { x: Math.max(38, box.width * .15) - 120, y: box.height * .47 - 347, zoom: 1 };
  paintViewport();
}
function paintViewport() {
  const v = graph().viewport || { x: 0, y: 0, zoom: 1 };
  $('tree').style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
  $('zoomLabel').textContent = `${Math.round(v.zoom * 100)}%`;
}
function zoom(factor, x, y) {
  const v = graph().viewport;
  const box = $('canvas').getBoundingClientRect();
  x ??= box.width / 2; y ??= box.height / 2;
  const next = Math.min(2.2, Math.max(.25, v.zoom * factor));
  graph().viewport = { x: x - (x - v.x) * next / v.zoom, y: y - (y - v.y) * next / v.zoom, zoom: next };
  paintViewport(); store.schedule();
}
function centerNode(id) {
  const node = nodeById(id); if (!node) return;
  const box = $('canvas').getBoundingClientRect(), z = graph().viewport.zoom;
  if (!box.width || !box.height) return;
  graph().viewport = { x: box.width / 2 - (node.position.x + 100) * z, y: box.height / 2 - (node.position.y + 47) * z, zoom: z };
  paintViewport(); store.schedule();
}
function fitView() {
  const visible = visibleGraph(graph(), store.ui.collapsed);
  const nodes = (extensions ? extensions.filter(visible) : visible).nodes;
  if (!nodes.length) return;
  const left = Math.min(...nodes.map(n => n.position.x)), top = Math.min(...nodes.map(n => n.position.y));
  const width = Math.max(...nodes.map(n => n.position.x + 210)) - left, height = Math.max(...nodes.map(n => n.position.y + 105)) - top;
  const box = $('canvas').getBoundingClientRect();
  const readableMinimum = matchMedia('(max-width:880px)').matches ? .8 : .65;
  const desiredZoom = Math.min((box.width - 75) / width, (box.height - 100) / height);
  const z = Math.min(1.1, Math.max(readableMinimum, desiredZoom));
  graph().viewport = { x: width * z > box.width - 56 ? 28 - left * z : (box.width - width * z) / 2 - left * z, y: height * z > box.height - 56 ? 28 - top * z : (box.height - height * z) / 2 - top * z, zoom: z };
  paintViewport(); store.schedule();
  if (desiredZoom < readableMinimum) toast('已保持可读缩放；可拖动画布查看其余分支。');
}

function selectNode(id, additive = false) {
  focus = id; edgeFocus = null;
  const selected = selectedIds();
  store.ui.selected = additive || multi ? selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] : [id];
  store.ui.focused = focus; activeTab = 'detail'; store.schedule(); render();
}
function curve(a, b) {
  const x1 = a.position.x + 200, y1 = a.position.y + 47, x2 = b.position.x, y2 = b.position.y + 47;
  const reach = Math.max(55, Math.abs(x2 - x1) * .5);
  return { d: `M${x1} ${y1} C${x1 + reach} ${y1},${x2 - reach} ${y2},${x2} ${y2}`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 17 };
}
function renderTree() {
  if (star.parentElement && star.parentElement !== $('intro') && !transitioning) document.body.append(star);
  const allVisible = visibleGraph(graph(), store.ui.collapsed);
  const visible = extensions ? extensions.filter(allVisible) : allVisible, visibleIds = new Set(visible.nodes.map(n => n.id));
  const byId = new Map(visible.nodes.map(n => [n.id, n]));
  const selected = selectedIds();
  $('edges').innerHTML = '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#729f93"/></marker></defs>';
  $('edgeLabels').innerHTML = '';
  for (const edge of visible.edges) {
    const line = curve(byId.get(edge.from), byId.get(edge.to));
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const active = edge.id === edgeFocus || selected.includes(edge.to);
    group.innerHTML = `<path class="edge-line${active ? ' selected' : ''}" d="${line.d}" marker-end="url(#arrow)"/><path class="edge-hit" d="${line.d}" role="button" tabindex="0" aria-label="${esc(`${byId.get(edge.from).title}到${byId.get(edge.to).title}，编辑路径条件`)}"/>`;
    const choose = () => { edgeFocus = edge.id; activeTab = 'detail'; render(); showMobile(true); };
    group.querySelector('.edge-hit').addEventListener('click', choose);
    group.querySelector('.edge-hit').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    $('edges').append(group);
    const label = document.createElement('button'); label.className = 'edge-label'; label.dataset.edge = edge.id;
    label.style.left = `${line.x}px`; label.style.top = `${line.y}px`;
    label.textContent = edge.requirements.length ? edge.requirements.slice(0, 3).map(r => r.label).join(' · ') + (edge.requirements.length > 3 ? ` +${edge.requirements.length - 3}` : '') : '＋ 条件';
    label.setAttribute('aria-label', `编辑${byId.get(edge.to).title}的路径条件`); label.onclick = choose;
    $('edgeLabels').append(label);
  }
  $('nodes').innerHTML = '';
  for (const node of visible.nodes) {
    const shell = document.createElement('div');
    shell.className = `node ${node.id === graph().rootNodeId ? 'root' : node.kind === 'career' ? 'end' : 'branch'}${selected.includes(node.id) ? ' active focus' : ''}${node.private ? ' private' : ''}`;
    shell.dataset.node = node.id; shell.style.left = `${node.position.x}px`; shell.style.top = `${node.position.y}px`;
    shell.innerHTML = `<button class="node-main" aria-label="${esc(node.title)}" aria-pressed="${selected.includes(node.id)}"><div class="type">${esc(kindNames[node.kind])} · ${node.origin === 'ai' ? 'AI 建议已采用 · 未核实' : node.origin === 'seed' || node.attributes?.example ? '已采用示例 · 未核实' : '用户已确认'}</div><div class="nt">${esc(node.title)}</div><div class="ns">${esc(phaseNames[node.phase] || '探索中')}${node.private ? ' · 私密，不发送给 AI' : ''}${store.ui.collapsed.includes(node.id) ? ' · 分支已折叠' : ''}</div></button><button class="node-plus" aria-label="${esc(`从${node.title}继续生长`)}">＋</button>`;
    shell.querySelector('.node-plus').onclick = event => { event.stopPropagation(); focus = node.id; openGrow(node.id); };
    shell.querySelector('.node-main').onclick = event => {
      if (shell.dataset.dragged) { delete shell.dataset.dragged; return; }
      selectNode(node.id, event.ctrlKey || event.metaKey || event.shiftKey);
    };
    shell.querySelector('.node-main').ondblclick = () => { if (!multi) openGrow(node.id); };
    bindNodeDrag(shell, node);
    $('nodes').append(shell);
  }
  if (!visibleIds.has(focus)) focus = graph().rootNodeId;
  mountStar(); paintViewport(); renderGhosts();
}
function bindNodeDrag(shell, node) {
  let start;
  shell.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.node-plus,.node-ai,.root-point')) return;
    start = { x: event.clientX, y: event.clientY, position: { ...node.position }, moved: false, pointerId: event.pointerId };
    event.stopPropagation();
  });
  shell.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = (event.clientX - start.x) / graph().viewport.zoom, dy = (event.clientY - start.y) / graph().viewport.zoom;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    if (!start.moved) shell.setPointerCapture(event.pointerId);
    start.moved = true; event.preventDefault(); shell.classList.add('dragging');
    shell.style.left = `${start.position.x + dx}px`; shell.style.top = `${start.position.y + dy}px`;
  });
  const end = event => {
    if (!start || event.pointerId !== start.pointerId) return;
    const previous = start; start = null;
    if (previous.moved) {
      shell.dataset.dragged = 'true';
      transact([{ op: 'move_node', nodeId: node.id, position: { x: previous.position.x + (event.clientX - previous.x) / graph().viewport.zoom, y: previous.position.y + (event.clientY - previous.y) / graph().viewport.zoom } }]);
    }
  };
  shell.addEventListener('pointerup', end);
  shell.addEventListener('pointercancel', () => { start = null; shell.classList.remove('dragging'); shell.style.left = `${node.position.x}px`; shell.style.top = `${node.position.y}px`; });
}
const pointers = new Map();
let pan = null, pinch = null;
$('canvas').addEventListener('pointerdown', event => {
  if (event.target.closest('.node,.edge-label,.edge-hit,button')) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  $('canvas').setPointerCapture(event.pointerId);
  if (pointers.size === 1) pan = { x: event.clientX, y: event.clientY, viewport: { ...graph().viewport } };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], box = $('canvas').getBoundingClientRect();
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), viewport: { ...graph().viewport }, x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top };
    pan = null;
  }
});
$('canvas').addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], box = $('canvas').getBoundingClientRect(), v = pinch.viewport;
    const z = Math.max(.25, Math.min(2.2, v.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance)));
    graph().viewport = { x: (a.x + b.x) / 2 - box.left - (pinch.x - v.x) * z / v.zoom, y: (a.y + b.y) / 2 - box.top - (pinch.y - v.y) * z / v.zoom, zoom: z };
  } else if (pan) graph().viewport = { ...pan.viewport, x: pan.viewport.x + event.clientX - pan.x, y: pan.viewport.y + event.clientY - pan.y };
  paintViewport();
});
function endCanvasPointer(event) { pointers.delete(event.pointerId); pan = null; pinch = null; if (entered) store.schedule(); }
$('canvas').addEventListener('pointerup', endCanvasPointer); $('canvas').addEventListener('pointercancel', endCanvasPointer);
$('canvas').addEventListener('wheel', event => { event.preventDefault(); const b = $('canvas').getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - b.left, event.clientY - b.top); }, { passive: false });

function candidates(node) {
  if (node.id === graph().rootNodeId) {
    const roots = {
      career: [{ title: '求知与深造', kind: 'education' }, { title: '职业与创造', kind: 'career' }, { title: '跨界与尝试', kind: 'goal' }],
      life: [{ title: '生活节奏', kind: 'lifestyle' }, { title: '关系与陪伴', kind: 'lifestyle' }, { title: '自由与远方', kind: 'desire' }, { title: '创作与热爱', kind: 'passion' }],
      thought: [{ title: '思想与哲学', kind: 'philosophy' }, { title: '创作与热爱', kind: 'passion' }, { title: '价值观与欲望', kind: 'value' }, { title: '未解的人生问题', kind: 'philosophy' }],
      blank: [],
    };
    return roots[currentTree?.type || 'blank'];
  }
  if (['philosophy', 'value', 'passion', 'desire', 'lifestyle'].includes(node.kind)) return [{ title: '我真正看重的是什么', kind: 'value' }, { title: '可以尝试的一小步', kind: 'goal' }, { title: '值得继续追问的问题', kind: 'philosophy' }];
  if (node.kind === 'major') return [{ title: '直接就业', kind: 'milestone' }, { title: '继续深造', kind: 'education' }, { title: '跨学科转型', kind: 'milestone' }];
  if (/直接就业/.test(node.title)) return [{ title: '材料测试工程师', kind: 'career' }, { title: '工艺工程师', kind: 'career' }, { title: '产品与商业', kind: 'career' }];
  if (node.kind === 'education') return [{ title: '新能源材料研发', kind: 'career' }, { title: '国内硕士', kind: 'education' }, { title: '海外硕士', kind: 'education' }, { title: '博士研究', kind: 'education' }];
  if (node.kind === 'career') return [{ title: '积累项目经历', kind: 'milestone' }, { title: '探索研究方向', kind: 'goal' }, { title: '跨领域发展', kind: 'goal' }];
  return [{ title: '学习新能力', kind: 'skill' }, { title: '尝试一个项目', kind: 'milestone' }, { title: '下一阶段', kind: 'goal' }];
}
let picked = new Map();
$('newKind').innerHTML = options(NodeKinds.filter(k => k !== 'self'), kindNames, 'other');
function openGrow(id) {
  if ($('growDialog').open) return;
  const node = nodeById(id); if (!node) return;
  focus = id; store.ui.focused = id; store.schedule();
  growParent = id; picked = new Map(); $('growTitle').textContent = `从「${node.title}」长出下一步`;
  $('custom').value = ''; $('newDescription').value = ''; $('growError').textContent = '';
  $('custom').placeholder = node.id === graph().rootNodeId && currentTree?.type === 'career' ? '请输入你的专业，也可以直接写目标' : '写下属于你的下一种可能';
  $('newKind').value = node.id === graph().rootNodeId && currentTree?.type === 'career' ? 'major' : 'other';
  $('choices').innerHTML = '';
  if (node.id === graph().rootNodeId && currentTree?.type === 'career') {
    for (const [title, kind] of [['从当前专业出发', 'major'], ['我有一个职业目标', 'career'], ['自由添加', 'other']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'choice'; button.textContent = title;
      button.onclick = () => { $('newKind').value = kind; $('custom').placeholder = kind === 'major' ? '例如：材料科学与工程' : kind === 'career' ? '请输入目标职业' : '写下你的想法'; $('choices').querySelectorAll('button').forEach(b => b.classList.toggle('chosen', b === button)); $('custom').focus(); };
      $('choices').append(button);
    }
  }
  for (const item of candidates(node)) {
    if (graph().edges.some(e => e.from === id && nodeById(e.to)?.title === item.title)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'choice'; button.textContent = item.title; button.setAttribute('aria-pressed', 'false');
    button.onclick = () => { picked.has(item.title) ? picked.delete(item.title) : picked.set(item.title, item); button.classList.toggle('chosen', picked.has(item.title)); button.setAttribute('aria-pressed', String(picked.has(item.title))); };
    $('choices').append(button);
  }
  $('growDialog').showModal();
  enhancedAI?.update();
}
$('closeGrow').onclick = () => $('growDialog').close();
$('growForm').onsubmit = event => {
  event.preventDefault();
  const entries = [...picked.values()].map(item => ({ ...item, seed: true }));
  const custom = $('custom').value.trim();
  if (custom) entries.push({ title: custom, kind: $('newKind').value, description: $('newDescription').value.trim(), seed: false });
  if (!entries.length) { $('growError').textContent = '请至少选择一个方向或输入节点名称。'; $('custom').focus(); return; }
  const unique = [...new Map(entries.map(item => [item.title, item])).values()];
  const operations = unique.flatMap(item => {
    const tempId = `new_${crypto.randomUUID()}`;
    return [{ op: 'add_node', tempId, node: { kind: item.kind, title: item.title, description: item.description || '可编辑的探索方向，尚未核验具体职业要求。', knowledgeStatus: item.seed ? 'unverified' : 'user_asserted', attributes: { example: Boolean(item.seed) } } }, { op: 'add_edge', fromId: growParent, toId: tempId, relation: 'possible_path' }];
  });
  const oldIds = new Set(graph().nodes.map(n => n.id));
  if (transact(operations)) {
    $('growDialog').close(); focus = graph().nodes.find(n => !oldIds.has(n.id))?.id || growParent; store.ui.selected = [focus]; activeTab = 'detail';
    showMobile(false); render(); centerNode(focus); toast(`已添加 ${unique.length} 个分支，可继续点击 ＋ 生长`);
  }
};

function renderDetail() {
  const area = $('panelScroll');
  if (edgeFocus) { renderEdge(); return; }
  const node = nodeById(focus) || nodeById(graph().rootNodeId), routeList = paths(node.id);
  area.innerHTML = `<div class="detail-label">YOUR NEXT POSSIBILITY</div><div class="detail-title">${esc(node.title)}</div><div class="hint">确认纳入规划，不代表已经实现。${node.origin === 'ai' ? 'AI 建议未经实时来源核验。' : ''}</div><form class="detail-form" id="nodeForm"><label for="editTitle">节点名称</label><input id="editTitle" required maxlength="120" value="${esc(node.title)}"><div class="two-cols"><div><label for="editKind">类别</label><select id="editKind"${node.kind === 'self' ? ' disabled' : ''}>${options(node.kind === 'self' ? ['self'] : NodeKinds.filter(k => k !== 'self'), kindNames, node.kind)}</select></div><div><label for="editPhase">状态</label><select id="editPhase">${options(Object.keys(phaseNames), phaseNames, node.phase || 'exploring')}</select></div></div><label for="editDescription">说明</label><textarea id="editDescription" maxlength="2000" rows="3">${esc(node.description)}</textarea><label class="checkbox"><input type="checkbox" id="privateNode"${node.private ? ' checked' : ''}>私密节点：不发送给 AI</label><div class="detail-actions"><button class="btn primary" type="submit">保存节点</button><button class="btn" type="button" id="expandDetail">＋ 继续生长</button></div></form><div class="detail-block"><strong>从起点到这里</strong>${routeList.length ? routeList.map(p => `<div class="path-text">${esc(pathText(p))}</div>`).join('') : '<p class="muted">暂无根节点连通路径；可连接已有节点。</p>'}</div><div class="detail-actions"><button class="btn small" id="selectCompare">${selectedIds().includes(node.id) && selectedIds().length > 1 ? '移出多选' : '加入多选'}</button><button class="btn small" id="duplicateNode">复制节点</button><button class="btn small" id="collapseNode">${store.ui.collapsed.includes(node.id) ? '展开分支' : '折叠分支'}</button></div><div class="detail-block"><strong>连接到已有节点</strong><select id="connectTarget" aria-label="连线终点">${graph().nodes.filter(n => n.id !== node.id && n.id !== graph().rootNodeId).map(n => `<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('')}</select><button class="btn small" id="connectNode">创建推进连线</button><p class="hint">允许多个父节点抵达同一目标；推进连线不可形成循环。</p></div>${node.id !== graph().rootNodeId ? '<button class="btn ghost" id="deleteNode">删除此节点…</button>' : ''}`;
  $('nodeForm').onsubmit = event => { event.preventDefault(); transact([{ op: 'update_node', nodeId: node.id, patch: { title: $('editTitle').value.trim(), description: $('editDescription').value.trim(), kind: $('editKind').value, phase: $('editPhase').value, private: $('privateNode').checked } }]); };
  $('expandDetail').onclick = () => openGrow(node.id);
  $('selectCompare').onclick = () => { multi = true; selectNode(node.id, true); };
  $('duplicateNode').onclick = () => {
    const incoming = graph().edges.find(e => e.to === node.id), tempId = `copy_${crypto.randomUUID()}`;
    transact([{ op: 'add_node', tempId, node: { kind: node.kind === 'self' ? 'other' : node.kind, title: `${node.title.slice(0, 114)}（副本）`, description: node.description || '', private: Boolean(node.private), position: { x: node.position.x, y: node.position.y + 130 } } }, { op: 'add_edge', fromId: incoming?.from || graph().rootNodeId, toId: tempId, relation: 'possible_path' }]);
  };
  $('collapseNode').onclick = () => { store.ui.collapsed = store.ui.collapsed.includes(node.id) ? store.ui.collapsed.filter(id => id !== node.id) : [...store.ui.collapsed, node.id]; store.schedule(); render(); };
  $('connectNode').onclick = () => { const target = $('connectTarget').value; if (!target) return toast('请先创建另一个节点。'); transact([{ op: 'add_edge', fromId: node.id, toId: target, relation: 'possible_path' }]); };
  if ($('deleteNode')) $('deleteNode').onclick = () => deleteNode(node.id);
  if (node.id !== graph().rootNodeId) {
    const removeBranch = document.createElement('button'); removeBranch.className = 'btn ghost'; removeBranch.id = 'deleteSubtree'; removeBranch.textContent = '删除整条分支…';
    removeBranch.onclick = () => deleteSubtree(node.id); area.append(removeBranch);
  }
  decorateCareerIntelligence(area, node);
  extensions?.decorateNode(node);
}

function decorateCareerIntelligence(area, node) {
  const metadata = node.attributes?.careerIntelligence;
  const branch = metadata?.version === 1 ? metadata.branch : null;
  const contextLink = currentTree?.type === 'career' && !node.private
    ? `<div class="detail-actions"><a class="btn small" href="/index.html#intelligence/tree/${encodeURIComponent(currentTree.id)}/${encodeURIComponent(node.id)}">在星轨 AI 探索后续方向 ↗</a></div>` : '';
  if (!branch) {
    area.insertAdjacentHTML('beforeend', contextLink);
    return;
  }
  const confidence = { low: '低', medium: '中', high: '高' };
  const detailRows = [
    ['推荐依据', branch.reason], ['发展目标', branch.goal], ['当前起点', branch.startingPoint],
    ['已有优势', branch.advantages], ['能力差距', branch.skillGaps], ['专业知识', branch.knowledge],
    ['证书与学历', branch.credentials], ['实践项目', branch.practice], ['主要风险', branch.risks],
    ['时间成本', branch.timeCost], ['经济成本', branch.economicCost], ['机会成本', branch.opportunityCost],
    ['转向灵活性', branch.flexibility], ['如何验证', branch.verification], ['下一步', branch.nextActions],
    ['建议把握', typeof branch.confidence === 'string' && Object.hasOwn(confidence, branch.confidence) ? confidence[branch.confidence] : ''],
  ].flatMap(([label, value]) => {
    const display = Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' · ') : value;
    return typeof display === 'string' && display ? [`<p><b>${label}</b>　${esc(display)}</p>`] : [];
  });
  const stages = Array.isArray(branch.stages) ? branch.stages : [];
  const stageNames = { near: '近期', mid: '中期', long: '远期' };
  const stageRows = stages.filter(stage => typeof stage?.title === 'string' && Object.hasOwn(stageNames, stage.timeframe)).map(stage =>
    `<p><b>${stageNames[stage.timeframe]} · ${esc(stage.title)}</b>　${esc(Array.isArray(stage.actions) ? stage.actions.filter(action => typeof action === 'string').join(' · ') : '')}</p>`);
  const evidence = Array.isArray(metadata.evidence) ? metadata.evidence : [];
  const verificationLabels = {
    official_snapshot_checked: '官方资料快照', official_snapshot_stale: '官方快照待更新',
    official_search_excerpt_unverified: '搜索摘要待核实', user_provided_unverified: '个人提供资料',
  };
  const sources = evidence.filter(source => typeof source?.title === 'string').map(source => {
    let href;
    try {
      const url = new URL(source.url);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) href = url.href;
    } catch { /* Sources without links can still be named. */ }
    const verification = typeof source.verificationStatus === 'string' && Object.hasOwn(verificationLabels, source.verificationStatus) ? verificationLabels[source.verificationStatus] : '';
    const stamp = [verification, typeof source.checkedAt === 'string' ? source.checkedAt.slice(0, 10) : ''].filter(Boolean).join(' · ');
    return `<p>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>` : esc(source.title)}${stamp ? ` · ${esc(stamp)}` : ''}</p>`;
  });
  const previous = Array.isArray(metadata.previous) ? metadata.previous.slice(0, 6) : [];
  const turnIds = [metadata.turnId, ...previous.map(turn => turn?.turnId)].filter(id => typeof id === 'string' && id);
  const historyLinks = [...new Set(turnIds)].map((id, index) =>
    `<a class="btn small" href="/index.html#intelligence/turn/${encodeURIComponent(id.toWellFormed())}">${index ? `查看较早的问答 ${index}` : '查看关联问答'} ↗</a>`);
  area.insertAdjacentHTML('beforeend', `<section class="detail-block"><strong>星轨 AI 建议</strong>
    ${detailRows.join('')}${stageRows.join('')}
    ${sources.length ? `<details><summary>参考来源</summary>${sources.join('')}</details>` : ''}
    <details><summary>关联问答</summary>${typeof metadata.question === 'string' && metadata.question ? `<p>${esc(metadata.question)}</p>` : ''}${typeof metadata.summary === 'string' && metadata.summary ? `<p>${esc(metadata.summary)}</p>` : ''}
    <div class="detail-actions">${historyLinks.join('')}</div></details>${contextLink}</section>`);
}
async function deleteSubtree(id) {
  if (id === graph().rootNodeId || !nodeById(id)) return;
  const advancing = graph().edges.filter(edge => ['possible_path', 'requires'].includes(edge.relation));
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of advancing) {
      if (removed.has(edge.from) && !removed.has(edge.to) && advancing.filter(parent => parent.to === edge.to).every(parent => removed.has(parent.from))) {
        removed.add(edge.to); changed = true;
      }
    }
  }
  if (await confirmation('删除整条分支？', `将删除「${nodeById(id).title}」及仅属于这条分支的后续节点，共 ${removed.size} 个。仍由其他分支引用的节点会保留，此操作可撤销。`, '删除分支')) {
    focus = graph().rootNodeId; edgeFocus = null;
    transact([...removed].map(nodeId => ({ op: 'delete_node', nodeId })));
  }
}
async function deleteNode(id) {
  const node = nodeById(id); if (!node || id === graph().rootNodeId) return;
  const edges = graph().edges.filter(e => e.from === id || e.to === id), ids = new Set(edges.map(e => e.id));
  const affected = graph().savedPaths.filter(p => p.edgeIds.some(e => ids.has(e)));
  if (await confirmation('删除此节点？', `将删除「${node.title}」及 ${edges.length} 条关联连线，并移除 ${affected.length} 条受影响的已保存路径。其他节点会保留，包括仍被其他路径引用的子节点。此操作可撤销。`, '确认删除')) {
    focus = graph().rootNodeId; edgeFocus = null; transact([{ op: 'delete_node', nodeId: id }]);
  }
}
function renderEdge() {
  const edge = graph().edges.find(e => e.id === edgeFocus);
  if (!edge) { edgeFocus = null; renderDetail(); return; }
  $('panelScroll').innerHTML = `<div class="detail-label">WHAT THIS PATH NEEDS</div><div class="detail-title">路径条件</div><div class="path-text">${esc(nodeById(edge.from)?.title)} → ${esc(nodeById(edge.to)?.title)}</div><p class="hint">这些是你的规划注释。必要性由你判断，具体门槛请按项目或岗位来源核实。</p><div id="requirementList">${edge.requirements.map(r => `<div class="requirement"><button class="btn ghost small remove-req" data-id="${esc(r.id)}">移除</button><strong>${esc(r.label)}</strong><p>${esc(r.detail || '暂无详细说明')}</p><span class="tag">${esc(reqNames[r.kind])} · ${esc(necessityNames[r.necessity])}</span><p>来源标记：${r.knowledgeStatus === 'unverified' ? 'AI / 示例建议，待核实' : '用户注释，未独立核实'}</p></div>`).join('') || '<p class="muted">还没有条件。先写下一项需要准备或核实的事。</p>'}</div><form class="requirement-form" id="requirementForm"><div class="two-cols"><div><label for="reqKind">条件分类</label><select id="reqKind">${options(RequirementKinds, reqNames, 'skill')}</select></div><div><label for="reqNecessity">必要性</label><select id="reqNecessity">${options(Object.keys(necessityNames), necessityNames, 'unknown')}</select></div></div><label for="reqLabel">短标签</label><input id="reqLabel" required maxlength="120" placeholder="例如：英语 / 科研经历 / 时间成本"><label for="reqDetail">解释 / 用户注释</label><textarea id="reqDetail" maxlength="2000" rows="3" placeholder="为什么想准备？哪些要求还需要查正式来源？"></textarea><div class="detail-actions"><button class="btn primary" type="submit">添加条件</button></div></form><button class="btn ghost" id="deleteEdge">删除此连线…</button>`;
  $('requirementForm').onsubmit = event => {
    event.preventDefault();
    const r = { id: `req_${crypto.randomUUID()}`, kind: $('reqKind').value, label: $('reqLabel').value.trim(), detail: $('reqDetail').value.trim(), necessity: $('reqNecessity').value, knowledgeStatus: 'user_asserted', sourceIds: [] };
    transact([{ op: 'annotate_edge', edgeId: edge.id, requirements: [...edge.requirements, r] }]);
  };
  document.querySelectorAll('.remove-req').forEach(button => button.onclick = () => transact([{ op: 'annotate_edge', edgeId: edge.id, requirements: edge.requirements.filter(r => r.id !== button.dataset.id) }]));
  $('deleteEdge').onclick = async () => {
    const count = graph().savedPaths.filter(p => p.edgeIds.includes(edge.id)).length;
    if (await confirmation('删除这条连线？', `两个端点都将保留，${count} 条受影响的已保存路径将移除。可撤销。`, '删除连线')) { edgeFocus = null; transact([{ op: 'delete_edge', edgeId: edge.id }]); }
  };
  extensions?.decorateEdge(edge);
}
function renderSelection() {
  const selected = selectedIds(), box = $('comparison');
  box.classList.toggle('open', selected.length > 1);
  if (selected.length < 2) { box.innerHTML = ''; return; }
  const canCompareInCareer = currentTree?.type === 'career' && selected.length <= 5 && selected.every(id => !nodeById(id).private);
  const careerLink = canCompareInCareer
    ? `<a class="btn small" id="compareInCareerIntelligence" href="/index.html#intelligence/compare-tree/${encodeURIComponent(currentTree.id)}/${selected.map(id => encodeURIComponent(id)).join(',')}">在星轨 AI 比较 ↗</a>` : '';
  box.innerHTML = `<div class="compare-title"><span>⇄ 已选 ${selected.length} 个节点 · 保留不同路线</span><div class="selection-actions">${careerLink}<button class="btn small primary" id="askCompare">请 AI 比较</button><button class="btn small" id="savePaths">保存路线</button><button class="btn small ghost" id="clearSelection">取消选择</button></div></div><div class="comparison-content">${selected.map(id => { const route = paths(id)[0]; const reqs = route ? graph().edges.filter(e => route.edgeIds.includes(e.id)).flatMap(e => e.requirements.map(r => r.label)) : []; return `<div class="path-card">${esc(route ? pathText(route) : `${nodeById(id).title}（暂无完整根路径）`)}<br>已有条件注释：${esc(reqs.join('、') || '尚未填写，可点击连线补充')}</div>`; }).join('')}</div>`;
  $('compareInCareerIntelligence')?.addEventListener('click', event => {
    persistConversation();
    if (store.save()) return;
    event.preventDefault();
    toast('请先解决职业树的保存问题，再比较这些路线。');
  });
  $('clearSelection').onclick = () => { store.ui.selected = []; multi = false; render(); store.schedule(); };
  $('savePaths').onclick = saveSelectedPaths;
  $('askCompare').onclick = () => { activeTab = 'chat'; $('scope').value = 'selection'; renderPanel(); showMobile(true); sendAI('请比较我选中的路线，说明共同准备、差异与仍待核实的问题。'); };
}
function saveSelectedPaths() {
  const operations = selectedIds().flatMap(id => paths(id).slice(0, 4).filter(p => p.edgeIds.length && !graph().savedPaths.some(existing => existing.edgeIds.join(',') === p.edgeIds.join(','))).map(p => ({ op: 'save_path', title: nodeById(id).title, edgeIds: p.edgeIds })));
  if (!operations.length) return toast('这些路线已保存，或还没有完整路径。');
  if (transact(operations)) toast(`已保存 ${operations.length} 条完整路线`);
}
function showSavedPaths() {
  activeTab = 'paths'; renderPanel(); showMobile(true);
}
function renderSavedPaths() {
  $('panelScroll').innerHTML = `<div class="detail-label">KEEP YOUR POSSIBILITIES</div><div class="detail-title">我的路径</div><p class="hint">保存的是连续的边，不只是一组节点名。</p><button class="btn primary" id="saveCurrentPath">保存当前路径</button>${graph().savedPaths.map(p => { const edges = p.edgeIds.map(id => graph().edges.find(e => e.id === id)); const text = edges.length ? [nodeById(edges[0].from)?.title, ...edges.map(e => nodeById(e.to)?.title)].join(' → ') : ''; return `<div class="saved-path"><strong>${esc(p.title)}</strong><div class="path-text">${esc(text)}</div><button class="btn small view-path" data-id="${esc(p.id)}">查看</button> <button class="btn small remove-path" data-id="${esc(p.id)}">移除收藏</button></div>`; }).join('') || '<p class="muted">还没有保存路线。先选中目标，再保存当前完整路径。</p>'}<div class="detail-block"><p class="hint">数据仅在当前浏览器。删除本机草稿会同时删除备份和撤销历史；原站测评不受影响。</p><button class="btn ghost" id="deleteGraph">删除本机草稿…</button></div>`;
  $('saveCurrentPath').onclick = saveSelectedPaths;
  document.querySelectorAll('.remove-path').forEach(b => b.onclick = () => transact([{ op: 'delete_path', pathId: b.dataset.id }]));
  document.querySelectorAll('.view-path').forEach(b => b.onclick = () => { const p = graph().savedPaths.find(p => p.id === b.dataset.id), last = graph().edges.find(e => e.id === p.edgeIds.at(-1)); store.ui.collapsed = []; selectNode(last.to); showMobile(false); centerNode(last.to); });
  $('deleteGraph').onclick = async () => {
    if (await confirmation('删除当前人生树及本机备份？', '将删除此人生树的节点、连线、路径、备份和撤销历史，同时清空本页聊天。此操作不可撤销，建议先导出 JSON。原站测评和求职资料会保留。', '删除本机草稿')) {
      aiController?.abort();
      if (currentTree && removeTree(currentTree.id)) { clearTimeout(store.timer); currentTree = null; navigate('/trees'); toast('这棵树已删除，其他树保持原样。'); }
    }
  };
}

function renderChat() {
  const summary = selectedIds().map(id => nodeById(id)?.title).join('、') || nodeById(focus)?.title;
  $('panelScroll').innerHTML = `<div class="assistant-bubble"><strong>✧ 先理解你的路径，再一起想下一步</strong><br>当前关注：${esc(summary)}<br><span class="muted">${aiState.checked ? aiState.configured ? '模型服务已配置；具体条件按引用来源核实。' : 'AI 未配置。你仍然可以手动编辑、撤销并保存人生树。' : '正在检查模型配置…'}</span></div><div class="suggestions"><button data-question="这条路线需要准备哪些能力，哪些条件需要核实？">能力与待核实项</button><button data-question="请比较我选中的路线，说明条件和取舍。">比较所选路线</button></div><div id="chatMessages">${messages.map(m => `<div class="message ${m.role === 'user' ? 'user' : m.error ? 'ai error' : 'ai'}">${esc(m.content)}${m.context ? `<div class="hint">本次依据：${esc(m.context)}</div>` : ''}</div>`).join('')}</div><div id="proposalArea"></div>`;
  $('panelScroll').querySelectorAll('[data-question]').forEach(b => b.onclick = () => sendAI(b.dataset.question));
  [...$('chatMessages').children].forEach((element, index) => {
    const citations = messages[index]?.citations || [];
    if (!citations.length) return;
    const list = document.createElement('ul'); list.className = 'source-citations';
    for (const citation of citations) {
      const item = document.createElement('li');
      let url;
      try { url = new URL(citation.url); } catch { url = null; }
      if (url && ['http:', 'https:'].includes(url.protocol)) { const anchor = document.createElement('a'); anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = citation.title || citation.sourceId; item.append(anchor); }
      else item.textContent = citation.title || '上传资料片段';
      if (citation.checkedAt) item.append(` · 核验 ${new Date(citation.checkedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      list.append(item);
    }
    element.append(list);
  });
  [...$('chatMessages').children].forEach((element, index) => { if (messages[index]?.generating) { element.classList.remove('ai'); element.classList.add('generating'); } });
  renderProposal();
  $('panelScroll').scrollTop = $('panelScroll').scrollHeight;
}
function operationLabel(op) {
  const title = id => nodeById(id)?.title || proposal?.proposedOperations.find(item => item.op === 'add_node' && item.tempId === id)?.node.title || id;
  if (op.op === 'add_node') return `新增「${op.node.title}」`;
  if (op.op === 'add_edge') return `连接「${title(op.fromId)}」→「${title(op.toId)}」`;
  if (op.op === 'annotate_edge') {
    const edge = graph().edges.find(edge => edge.id === op.edgeId);
    return `更新「${title(edge.from)} → ${title(edge.to)}」条件：${op.requirements.map(r => r.label).join('、') || '清空'}；原条件：${edge.requirements.map(r => r.label).join('、') || '无'}`;
  }
  return `修改「${nodeById(op.nodeId)?.title || op.nodeId}」：${op.patch.title || op.patch.description || '节点说明'}`;
}
function renderProposal() {
  const area = $('proposalArea'); if (!area) return;
  if (!proposal) { area.innerHTML = ''; return; }
  const stale = proposal.usedGraphRevision !== graph().revision;
  area.innerHTML = `<div class="proposal"><h4>AI 草案 · 尚未写入人生树</h4><p class="muted">基于图版本 ${proposal.usedGraphRevision}；当前版本 ${graph().revision}。${stale ? '图已更新，请重新生成。' : '确认后整次应用，可撤销。'}</p><ul>${proposal.proposedOperations.map(op => `<li>${esc(operationLabel(op))}</li>`).join('')}</ul><div class="proposal-actions"><button class="btn ghost" id="rejectProposal"${busy ? ' disabled' : ''}>拒绝草案</button><button class="btn primary" id="acceptProposal"${stale || busy ? ' disabled' : ''}>确认添加</button></div></div>`;
  $('rejectProposal').onclick = () => { proposal = null; renderGhosts(); renderProposal(); toast('已拒绝，人生树未改变'); };
  $('acceptProposal').onclick = acceptProposal;
}
function renderGhosts() {
  $('ghosts').innerHTML = '';
  if (!proposal || proposal.usedGraphRevision !== graph().revision) return;
  try {
    const preview = applyOperations(graph(), proposal.proposedOperations, proposal.usedGraphRevision, { origin: 'ai' });
    const oldIds = new Set(graph().nodes.map(n => n.id));
    for (const node of preview.nodes.filter(n => !oldIds.has(n.id))) {
      const div = document.createElement('div'); div.className = 'node ghost-node'; div.style.left = `${node.position.x}px`; div.style.top = `${node.position.y}px`;
      div.innerHTML = `<div class="node-main"><div class="type">AI 待确认 · 尚未保存</div><div class="nt">${esc(node.title)}</div><div class="ns">确认后才生效</div></div>`;
      $('ghosts').append(div);
    }
  } catch { /* A stale or invalid proposal is never applied to the live graph. */ }
}
function renderPanel() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('current', t.dataset.tab === activeTab));
  $('aiControls').hidden = activeTab !== 'chat';
  if (enhancedAI?.renderTab(activeTab)) return;
  if (extensions?.render(activeTab)) { enhancedAI?.update(); return; }
  if (activeTab === 'chat') renderChat(); else if (activeTab === 'paths') renderSavedPaths(); else renderDetail();
  enhancedAI?.update();
}
function render() {
  renderTree(); renderSelection(); renderPanel();
  store.ui.focused = focus;
  if (currentTree) {
    $('canvasTitle').textContent = graph().title;
    $('canvasDescription').textContent = currentTree.description || '点击一个节点，让新的可能从这里延伸。允许多条路线同时存在。';
    $('canvasKicker').textContent = `${treeTypes[currentTree.type].name} / CANVAS 03`;
    $('currentTreeBadge').textContent = `${treeTypes[currentTree.type].name} · ${graph().title}`;
    document.title = `${graph().title} · 始于足下`;
  }
  $('multi').setAttribute('aria-pressed', String(multi));
  $('undo').disabled = !store.undoStack.length; $('redo').disabled = !store.redoStack.length;
  $('status').textContent = `${graph().title} · ${graph().nodes.length} 个节点 / ${graph().edges.length} 条连接 · ${selectedIds().length} 个已选`;
  $('paths').textContent = `我的路径${graph().savedPaths.length ? ` · ${graph().savedPaths.length}` : ''}`;
  $('recoverDraft').hidden = !store.recovery;
  enhancedAI?.update();
}
async function checkAI() {
  const epoch = ++aiStatusEpoch;
  try { const response = await fetch('/api/journey/ai/status'); if (!response.ok) throw new Error(); const result = await response.json(); if (epoch !== aiStatusEpoch) return; aiState = { ...result, checked: true }; }
  catch { if (epoch !== aiStatusEpoch) return; aiState = { ...aiState, state: 'error', lastErrorCode: 'AI_STATUS_UNAVAILABLE', checked: true }; }
  if (activeTab === 'chat') renderPanel();
  enhancedAI?.update();
}
function compactGraph(scope, selection) {
  return projectAIContext(graph(), selection, scope);
}
function setBusy(value) {
  busy = value; $('send').disabled = value; $('propose').disabled = value; $('cancelAI').hidden = !value;
  $('send').textContent = value ? '处理中…' : '发送 ↗';
}
async function sendAI(text, propose = false) {
  return enhancedAI.send(text, propose);
}
async function acceptProposal() {
  if (!proposal || busy) return;
  const current = proposal;
  const epoch = aiEpoch;
  if (current.usedGraphRevision !== graph().revision) { toast('人生树已更新，请重新生成草案。'); return; }
  setBusy(true); renderProposal(); aiController = new AbortController();
  try {
    const response = await fetch('/api/journey/ai/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: current.requestGraph, expectedRevision: current.usedGraphRevision, proposedOperations: current.proposedOperations, proposalToken: current.proposalToken }), signal: aiController.signal });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '草案校验失败');
    if (proposal !== current || aiController.signal.aborted) throw new Error('草案确认已取消，人生树未改变');
    validateProposal(graph(), result.proposedOperations, result.usedGraphRevision);
    // Validation is against the signed consented snapshot; application rechecks the full current graph.
    if (transact(result.proposedOperations, result.usedGraphRevision, { origin: 'ai' })) { proposal = null; toast('已确认添加；可撤销本次全部修改'); }
  } catch (error) { toast(error.name === 'AbortError' ? '已取消确认，人生树未改变' : error.message); }
  finally { if (epoch === aiEpoch) { setBusy(false); aiController = null; render(); } }
}

function showMobile(show) {
  if (!matchMedia('(max-width:880px)').matches) return;
  $('mainpanel').classList.toggle('mobile-hidden', show); $('rightpanel').classList.toggle('mobile-visible', show);
  $('mobileTree').classList.toggle('active', !show); $('mobileAI').classList.toggle('active', show && !['paths', 'compare'].includes(activeTab)); $('mobilePaths').classList.toggle('active', show && ['paths', 'compare'].includes(activeTab));
}
function exportGraph() {
  const blob = new Blob([JSON.stringify(graph(), null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `始于足下-v1-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出当前图，包含你自愿记录的私密节点；请自行保管。');
}
$('add').onclick = () => openGrow(focus);
$('multi').onclick = () => { multi = !multi; render(); toast(multi ? '多选已开启，点击节点可加入或移出' : '已退出多选模式'); };
$('undo').onclick = () => { if (store.undo()) { edgeFocus = null; focus = nodeById(focus) ? focus : graph().rootNodeId; render(); } };
$('redo').onclick = () => { if (store.redo()) render(); };
$('fit').onclick = fitView;
$('paths').onclick = showSavedPaths;
$('root').onclick = () => { focus = graph().rootNodeId; store.ui.collapsed = []; selectNode(focus); resetViewport(); store.schedule(); };
$('zoomIn').onclick = () => zoom(1.2); $('zoomOut').onclick = () => zoom(1 / 1.2);
$('save').onclick = () => { if (store.save()) toast('已保存，仅在当前设备 / 浏览器'); };
$('export').onclick = () => { if (currentTree) downloadTree(currentTree.id); };
$('workspaceTool').onchange = () => { const tab = $('workspaceTool').value; if (tab) extensions.open(tab); $('workspaceTool').value = ''; };
$('renameTree').onclick = () => {
  const title = prompt('为这棵人生树取一个名字', graph().title);
  if (title !== null) transact([{ op: 'rename_graph', title: title.trim() }]);
};
$('reloadDraft').onclick = async () => { if (await confirmation('读取另一页版本？', '当前尚未保存的改动将被替换。建议先导出 JSON 副本。', '读取版本') && store.reload()) { focus = store.ui.focused || graph().rootNodeId; messages = structuredClone(store.ui.chat || []); aiEpoch++; aiController?.abort(); setBusy(false); edgeFocus = null; proposal = null; render(); } };
$('recoverDraft').onclick = async () => { if (await confirmation('采用恢复草稿？', '将用已读取的有效备份替换损坏的草稿。', '采用备份')) store.save({ replace: true }); };
$('find').onclick = () => {
  const q = $('search').value.trim(); if (!q) return;
  const node = graph().nodes.find(n => n.title.includes(q)); if (!node) return toast('没有找到该节点');
  store.ui.collapsed = []; selectNode(node.id); centerNode(node.id);
};
$('search').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('find').click(); } };
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { activeTab = t.dataset.tab; renderPanel(); });
$('chatForm').onsubmit = event => { event.preventDefault(); sendAI($('question').value); };
$('propose').onclick = () => sendAI($('question').value.trim() || '请在当前路径上提议一条跨学科转型路线，返回待确认的新节点与连线。', true);
$('cancelAI').onclick = () => aiController?.abort();
$('clearChat').onclick = async () => { if (await confirmation('清空本树对话？', '将删除当前树的全部问答与引用它们的派生路线介绍。节点及其他树的问答保留。', '清空对话')) { try { aiEpoch++; enhancedAI.clearGraphHistory(); persistConversation(); store.schedule(); renderPanel(); renderGhosts(); } catch (error) { toast(error.message); } } };
$('mobileTree').onclick = () => { showMobile(false); paintViewport(); };
$('mobileAI').onclick = () => { activeTab = 'chat'; renderPanel(); showMobile(true); };
$('mobilePaths').onclick = () => extensions.open('compare');
document.addEventListener('keydown', event => {
  if (!entered || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,#aiHistory')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? $('redo') : $('undo')).click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); $('redo').click(); }
  if (event.key === 'Delete' && focus !== graph().rootNodeId) { event.preventDefault(); deleteNode(focus); }
});
window.addEventListener('storage', event => {
  if (currentTree && library.isTreeStorageKey(event.key, currentTree.id)) store.changedElsewhere();
  else if (!$('treeHub').hidden) renderGallery();
});
window.addEventListener('pagehide', () => { if (entered) flushTree(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && entered) flushTree(); });
new ResizeObserver(() => { if (entered) paintViewport(); }).observe($('canvas'));
document.querySelectorAll('[data-create]').forEach(button => button.onclick = () => openCreate(button.dataset.create));
$('cancelCreateTree').onclick = () => $('createTreeDialog').close();
$('createTreeForm').onsubmit = event => {
  event.preventDefault();
  try {
    const entry = library.create(creatingType, $('treeName').value.trim(), $('treeDescription').value.trim());
    $('createTreeDialog').close(); navigate(`/trees/${encodeURIComponent(entry.id)}`);
  } catch (error) { $('createTreeError').textContent = error.message; }
};
$('hubBackIntro').onclick = () => navigate('/journey');
$('backToTrees').onclick = () => navigate('/trees');
$('missingBack').onclick = event => { event.preventDefault(); navigate('/trees'); };
$('savedTrees').onclick = async event => {
  const button = event.target.closest('[data-act]'); if (!button) return;
  const { act, id } = button.dataset, entry = library.get(id); if (!entry) return renderGallery();
  try {
    if (act === 'open') return navigate(`/trees/${encodeURIComponent(id)}`);
    if (act === 'rename') { const title = prompt('给这棵树一个新的名字', entry.title); if (title === null) return; library.rename(id, title.trim()); }
    if (act === 'duplicate') { duplicateTree(id); toast('已复制一棵独立的树。'); }
    if (act === 'export') return downloadTree(id);
    if (act === 'delete' && await confirmation('删除这棵树？', `将删除「${entry.title}」及它在当前浏览器中的节点、对话与资料。其他树不受影响，建议先导出备份。`, '确认删除')) {
      if (!removeTree(id)) return toast('删除未完成，请检查本地存储提示。');
      toast('这棵树已删除。');
    }
    renderGallery();
  } catch (error) { toast(error.message); }
};
$('importTreeButton').onclick = () => $('importTreeInput').click();
$('importTreeInput').onchange = async () => {
  const file = $('importTreeInput').files?.[0]; if (!file) return;
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error('备份超过 12MB，请检查文件大小。');
    const entry = importTreeArchive(JSON.parse(await file.text())); renderGallery(); toast(`已导入「${entry.title}」，原有树保持独立。`);
  } catch (error) { toast(`导入失败：${error.message}`); }
  finally { $('importTreeInput').value = ''; }
};
$('resetTree').onclick = async () => {
  if (!await confirmation('清空当前画布？', '将移除当前树中起点之外的节点、路径和条件，保留树名与本树对话。其他树不受影响，可以撤销。', '清空画布')) return;
  const operations = graph().nodes.filter(node => node.id !== graph().rootNodeId).map(node => ({ op: 'delete_node', nodeId: node.id }));
  if (operations.length && !transact(operations)) return;
  proposal = null; focus = graph().rootNodeId; store.ui.selected = []; store.ui.collapsed = []; multi = false; edgeFocus = null; render(); resetViewport(); store.schedule();
};
enhancedAI = createAIIntegration({
  storage, graph, nodeById, selectedIds, selectNode, toast, confirmation, transact, renderPanel, renderChat, renderGhosts, showMobile, checkAI, paintViewport, persistViewport: () => store.schedule(),
  restoreSelection: ids => { store.ui.selected = ids; focus = ids.at(-1) || graph().rootNodeId; multi = ids.length > 1; edgeFocus = null; store.schedule(); render(); },
  focus: () => focus, growParent: () => growParent, isActive: () => entered && Boolean(currentTree), activeTab: () => activeTab, setActiveTab: value => { activeTab = value; },
  aiState: () => aiState, isBusy: () => busy, setBusy, setController: value => { aiController = value; }, messages: () => messages, setMessages: value => { messages = value; },
  setProposal: value => { proposal = value; }, consentKey: () => extensions?.consentKey() || '', requestExtras: () => extensions?.requestExtras() || {}, observeSources: result => extensions?.observeSources(result),
  openChat: () => { activeTab = 'chat'; renderPanel(); showMobile(true); },
});
window.addEventListener('popstate', () => navigate(location.pathname, { pop: true }));
showRoute(location.pathname, { initial: true });
checkAI();
