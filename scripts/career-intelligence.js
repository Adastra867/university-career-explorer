(() => {
  const byId = id => document.getElementById(id);
  const tasks = {
    profile: ['个人画像', '梳理个人画像', '说说你的学习、科研或实习经历，找出可迁移能力和仍需核实的优势。', '我是能源专业本科生，做过电池仿真和有机光伏科研。我有哪些能迁移到其他领域的能力？'],
    explore: ['发现方向', '探索职业方向', '从专业、经历和兴趣出发，探索就业、升学、科研或跨界路线。', '我是能源专业本科生，做过电池仿真实习，参与过有机光伏稳定性科研，也对 AI 感兴趣。还有哪些适合我验证的方向？'],
    plan: ['制定路线', '制定阶段计划', '选择一条方向或写下你的目标，梳理近期、中期和远期的行动。', '我想探索电池数字孪生，本学期每周能投入 6 小时。接下来怎样补齐能力并做出一个可展示的项目？'],
    compare: ['比较取舍', '比较发展路线', '选两到五条已生成路线，或直接描述你正在权衡的选择。可补充时间、预算或生活偏好。', '我在本科毕业后进入电池企业和申请交叉学科硕士之间犹豫。我希望两年内积累可迁移的技术能力，也在意经济成本。两条路各会放弃什么？'],
    growth: ['成长建议', '调整下一步行动', '选择已有路线并补充新的经历、反馈或顾虑，看看哪些行动需要调整。', '我刚完成一个材料数据预测项目，发现自己更喜欢实验设计。怎样验证我是否适合继续做交叉科研？'],
  };
  const kinds = { steady: '稳健路线', advanced: '进阶路线', cross_field: '跨界路线', exploratory: '探索路线', aspirational: '理想路线' };
  const confidence = { low: '低', medium: '中', high: '高' };
  const stages = { near: '近期 · 0–6 个月', mid: '中期 · 6 个月–2 年', long: '远期 · 2–5 年及以上' };
  const threeYearStages = { near: '近期 · 0–3 个月', mid: '中期 · 3–12 个月', long: '远期 · 1–3 年' };
  const dimensions = { interest_fit: '兴趣匹配', ability_fit: '能力匹配', transition_cost: '转型成本', time_cost: '时间成本', economic_cost: '经济成本', market_demand: '市场需求', competition: '竞争程度', growth: '长期发展', flexibility: '转向灵活性', lifestyle_fit: '生活方式' };
  const storageKey = 'careerIntelligenceV1';
  const documentKey = 'careerIntelligenceDocumentsV1';
  const profilePreferenceKey = 'careerChatUseProfile';
  const profileConsentKey = 'careerAIProfileConsentV1';
  const profileConsentVersion = 'career-ai-profile-v1';
  const profileLabels = {
    'education.major': '专业', 'education.stage': '年级或职业阶段', 'education.degree': '学历',
    'education.school': '学校', 'experience.text': '学习、项目或工作经历', 'skills.self_report': '技能',
    'preferences.long_term_goal': '长期目标', 'preferences.city': '城市偏好',
  };
  const prompts = {
    profile: '请利用我已提供或已授权的资料，直接梳理最多 3 项核心优势、3 项可迁移能力、2～3 个潜在发展方向和3 项值得提升的能力。区分已有依据与推测；资料少时也先给初步分析和验证方法，不要求填写完整画像。',
    explore: '请基于已有信息主动探索 3～5 条有实质区别的发展方向，说明推荐依据、已有优势、关键能力缺口和一个低成本验证方式。考虑本专业、跨专业、交叉学科与潜在创业机会。背景少时标明通用探索，先给方案。',
    plan: '请直接制定一份可执行的初步成长路线。近期 0～3 个月、中期 3～12 个月、远期 1～3 年，每阶段给 2～3 项行动或目标，最后指出现在最值得做的第一件事。缺少年级或明确方向时，用探索步骤和条件分支处理，并标明关键假设。',
    compare: '请直接比较我正在考虑的选择，从兴趣和能力适配、时间与经济成本、风险和长期灵活性解释收益、限制与机会成本。没有权重时使用定性比较，未知条件用适用情景处理。先给结论与可执行的验证步骤。',
    growth: '请利用我已提供或已授权的经历和目标，指出当前最值得优先解决的问题，推荐 3 项行动并解释各自目的，最后给一个现在就能完成的小任务。资料不足时给通用起步建议，默认不反问。',
  };
  const optionIds = { profile: 'ciUseProfile', history: 'ciUseHistory', research: 'ciResearch', live: 'ciLive', challenge: 'ciChallenge' };
  const message = byId('ciMessage');
  const sessions = CareerChatStore.create();
  let session = null;
  let task = 'explore';
  let turn = null;
  let request = null;
  let focusNode = null;
  let activeRoute = '';
  let activation = 0;
  let documents = [];
  let importing = false;
  let draftTimer;
  let profileOverride = null;
  let consentRequest = null;
  const selectedRoutes = new Map();

  function readArray(key, strict = false) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return [];
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error('记录格式无效');
      return value;
    } catch {
      if (strict) throw new Error('已有记录无法读取，原内容已保留。请检查浏览器存储后重试。');
      return [];
    }
  }

  function status(id, value, error = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = value;
    node.dataset.error = String(error);
  }

  function add(parent, tag, value = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function button(parent, label, action, className = 'ci-link') {
    const element = add(parent, 'button', label, className);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }

  function records(strict = false) {
    return readArray(storageKey, strict).filter(item => item?.id && (item.note || item.result?.task));
  }

  function contextOptions() {
    const options = { ...Object.fromEntries(Object.entries(optionIds).map(([key, id]) => [key, byId(id).checked])),
      localProfile: byId('ciUseLocalProfile').checked, publicSearchQuery: byId('ciPublicQuery').value };
    if (profileOverride === null && (!hasProfileConsent() || window.CareerProfile.state === 'loading')) delete options.profile;
    return options;
  }

  function captureSession() {
    if (!session) return;
    session.draft = message.value;
    session.task = task;
    session.contextOptions = contextOptions();
    session.attachments = documents;
    session.focusNode = focusNode;
    session.routes = [...selectedRoutes.values()];
  }

  function persistSession() {
    if (!session) return true;
    clearTimeout(draftTimer);
    captureSession();
    try {
      session = sessions.save(session);
      renderSessions();
      return true;
    } catch (error) {
      status('ciStatus', `${error.message} 当前内容仍在此页面，可复制后重试。`, true);
      renderSessions();
      return false;
    }
  }

  function scheduleDraft() {
    resizeComposer();
    if (!session && !message.value.trim()) return;
    if (!session && !createSession({ prompt: message.value, nextTask: task, inheritContext: true })) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistSession, 300);
  }

  function resizeComposer() {
    message.style.height = 'auto';
    message.style.height = `${Math.min(180, Math.max(48, message.scrollHeight))}px`;
    byId('ciSubmit').disabled = Boolean(request) || importing || !message.value.trim();
    byId('ciStop').hidden = !request;
    byId('ciSubmit').hidden = Boolean(request);
  }

  function setSessionURL(id, replace = false) {
    const href = `/index.html#intelligence/chat/${encodeURIComponent(id)}`;
    history[replace ? 'replaceState' : 'pushState'](null, '', href);
    activeRoute = `chat/${id}/`;
  }

  function createSession({ prompt = '', nextTask = 'explore', inheritContext = false } = {}) {
    const settings = inheritContext ? contextOptions() : {};
    cancelRequest();
    if (session && !persistSession()) return false;
    const now = new Date().toISOString();
    const next = { id: crypto.randomUUID(), title: '新对话', createdAt: now, updatedAt: now, revision: 0,
      messages: [], contextOptions: settings, attachments: [], draft: prompt, task: nextTask, routes: [], focusNode: null };
    try { session = sessions.save(next); }
    catch (error) { status('ciStatus', error.message, true); return false; }
    applySession();
    setSessionURL(session.id);
    closeSidebar();
    message.focus();
    return true;
  }

  function applySession() {
    documents = session?.attachments || [];
    focusNode = session?.focusNode || null;
    selectedRoutes.clear();
    for (const route of session?.routes || []) selectedRoutes.set(route.id, route);
    const settings = session?.contextOptions || {};
    for (const [key, id] of Object.entries(optionIds)) byId(id).checked = settings[key] === true;
    profileOverride = Object.hasOwn(settings, 'profile') ? settings.profile === true : null;
    byId('ciUseLocalProfile').checked = localProfileConsent().includeLegacy === true && settings.localProfile !== false;
    syncProfileChoice();
    byId('ciPublicQuery').value = settings.publicSearchQuery || '';
    message.value = session?.draft || '';
    task = session?.task || 'explore';
    turn = session?.messages.findLast(item => item.role === 'assistant' && item.metadata?.record)?.metadata.record || null;
    refreshSettings();
    selectTask(task);
    renderFocus();
    renderDocuments();
    renderThread();
    renderSessions();
    resizeComposer();
  }

  function openSession(id) {
    if (session?.id === id) return;
    cancelRequest();
    if (session && !persistSession()) return;
    const saved = sessions.get(id);
    if (!saved) return status('ciStatus', '这条对话已删除或无法读取。', true);
    session = saved;
    applySession();
    setSessionURL(id);
    status('ciStatus', '');
    closeSidebar();
  }

  function renderSessions() {
    const parent = byId('ciSessions');
    parent.replaceChildren();
    const items = sessions.list(byId('ciSessionSearch').value);
    if (!items.length) add(parent, 'p', byId('ciSessionSearch').value ? '没有找到相关对话' : '从一个问题开始吧', 'ci-muted ci-session-empty');
    for (const item of items) {
      const row = add(parent, 'div', '', `ci-session${session?.id === item.id ? ' is-active' : ''}`);
      const open = button(row, '', () => openSession(item.id), 'ci-session-open');
      if (session?.id === item.id) open.setAttribute('aria-current', 'true');
      add(open, 'span', item.title, 'ci-session-title');
      add(open, 'time', dateLabel(item.updatedAt), 'ci-session-time');
      const menu = add(row, 'details', '', 'ci-session-menu');
      const summary = add(menu, 'summary', '···');
      summary.setAttribute('aria-label', `${item.title} 的操作`);
      button(menu, '重命名', () => {
        const title = window.prompt('对话名称', item.title)?.trim();
        if (!title) return;
        if (request && session?.id === item.id) return status('ciStatus', '请先停止生成，再重命名对话。', true);
        try {
          if (session?.id === item.id && !persistSession()) return;
          const renamed = sessions.rename(item.id, title);
          if (session?.id === item.id) { session = renamed; byId('ciChatTitle').textContent = renamed.title; }
          renderSessions();
        } catch (error) { status('ciStatus', error.message, true); }
      });
      button(menu, '删除', () => {
        if (!window.confirm(`删除对话「${item.title}」？已保存的规划记录可以继续查看。`)) return;
        if (session?.id === item.id) cancelRequest();
        try {
          sessions.remove(item.id);
          if (session?.id === item.id) {
            session = null;
            applySession();
            history.pushState(null, '', '/index.html#intelligence');
            activeRoute = '//';
          }
          renderSessions();
        } catch (error) { status('ciStatus', error.message, true); }
      });
    }
  }

  function refreshSettings() {
    byId('ciSearchFields').hidden = !byId('ciLive').checked;
    const tags = byId('ciSourcesTags');
    tags.replaceChildren();
    for (const [key, label] of [['profile', '个人资料'], ['history', '历史记录'], ['research', '职业知识库'], ['live', '实时搜索'], ['challenge', '反向检验']]) {
      if (byId(optionIds[key]).checked) add(tags, 'span', key === 'live' && !byId('ciPublicQuery').value.trim() ? '实时搜索待补充公开词' : label, 'ci-source-tag');
    }
    if (!byId('ciUseProfile').checked && Object.values(window.CareerProfile.readFields()).some(field => field.value_state === 'known')) {
      button(tags, '参考已保存的个人资料', () => enableProfileUse());
    }
    renderProfileConnection();
  }

  function renderFocus() {
    const parent = byId('ciFocusNode');
    parent.replaceChildren();
    parent.hidden = !focusNode;
    if (!focusNode) return;
    add(parent, 'span', `所选方向 · ${focusNode.title}`);
    button(parent, '移除', () => { focusNode = null; renderFocus(); persistSession(); });
  }

  function closeSidebar() {
    const wasOpen = document.body.classList.contains('ci-sidebar-open');
    document.body.classList.remove('ci-sidebar-open');
    const mobile = matchMedia('(max-width: 850px)').matches;
    byId('ciSidebarToggle').setAttribute('aria-expanded', String(!mobile && !document.body.classList.contains('ci-sidebar-collapsed')));
    byId('ciSidebarBackdrop').hidden = true;
    byId('ciChatMain').inert = false;
    byId('ciSidebar').inert = mobile || document.body.classList.contains('ci-sidebar-collapsed');
    if (wasOpen) {
      document.querySelector('.career-nav').inert = false;
      document.querySelector('.career-top').inert = false;
    }
    byId('ciSidebar').removeAttribute('aria-modal');
    byId('ciSidebar').removeAttribute('role');
  }

  function writeRecord(record) {
    const previous = records(true);
    const existing = previous.find(item => item.id === record.id);
    const safe = record.result ? { ...record, result: {
      ...record.result,
      evidence: (record.result.evidence || []).map(source => source.origin === 'user_document' ? { ...source, excerpt: '' } : source),
    } } : record;
    const next = [{ ...existing, ...safe }, ...previous.filter(item => item.id !== record.id)];
    localStorage.setItem(storageKey, JSON.stringify(next));
    renderMemory();
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '';
  }

  function renderMemory() {
    const parent = byId('ciMemoryList');
    parent.replaceChildren();
    const items = records();
    if (!items.length) add(parent, 'p', '还没有保存的规划记录。', 'ci-muted');
    for (const record of items) {
      const card = add(parent, 'article', '', 'ci-memory-item');
      add(card, 'p', record.note || record.question);
      add(card, 'time', dateLabel(record.createdAt));
      const actions = add(card, 'div', '', 'ci-inline-actions');
      if (record.result) {
        const link = add(actions, 'a', '查看分析', 'ci-link');
        link.href = `/index.html#intelligence/turn/${encodeURIComponent(record.id)}`;
      }
      button(actions, '删除', () => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(records().filter(item => item.id !== record.id)));
          renderMemory();
          renderRouteInput();
          status('ciMemoryStatus', '已删除记录。');
        } catch { status('ciMemoryStatus', '当前浏览器无法删除记录。', true); }
      });
    }
  }

  function routePool() {
    const routes = new Map(selectedRoutes);
    const conversationRecords = (session?.messages || []).map(item => item.metadata?.record).filter(Boolean);
    for (const record of [turn, ...conversationRecords, ...records()]) {
      for (const branch of record?.result?.branches || []) {
        if (record.excludedBranches?.includes(branch.id)) continue;
        const id = `${record.id}_${branch.id}`;
        if (!routes.has(id)) routes.set(id, branchContext(id, branch));
      }
    }
    return [...routes.values()].slice(0, 12);
  }

  function branchContext(id, branch) {
    const plan = (branch.stages || []).map(stage => `${stage.title}（${(stage.actions || []).join('、')}）`);
    const description = [branch.description, branch.goal, ...plan].filter(Boolean).join('\n').slice(0, 1500);
    return { id, title: branch.title, description };
  }

  function renderRouteInput() {
    const parent = byId('ciRouteInput');
    const routes = routePool();
    parent.replaceChildren();
    parent.hidden = !['plan', 'compare', 'growth'].includes(task) || !routes.length;
    if (parent.hidden) return;
    const single = task !== 'compare';
    add(parent, 'p', single ? '选一条路线，或在下方描述目标' : '选择 2–5 条路线，或在下方描述选择', 'ci-muted');
    const choices = single ? [{ id: '', title: '使用下方描述' }, ...routes] : routes;
    for (const route of choices) {
      const label = add(parent, 'label');
      const input = add(label, 'input');
      input.type = single ? 'radio' : 'checkbox';
      input.name = 'ciRoute';
      input.checked = route.id ? selectedRoutes.has(route.id) : !selectedRoutes.size;
      label.append(document.createTextNode(route.title));
      input.addEventListener('change', () => {
        if (single) selectedRoutes.clear();
        if (!route.id) { persistSession(); return; }
        if (input.checked && selectedRoutes.size >= 5) {
          input.checked = false;
          return status('ciStatus', '一次最多比较 5 条路线。', true);
        }
        if (input.checked) selectedRoutes.set(route.id, route);
        else selectedRoutes.delete(route.id);
        persistSession();
        status('ciStatus', '');
      });
    }
  }

  function selectTask(next) {
    if (!Object.hasOwn(tasks, next)) next = 'explore';
    if (task !== next) {
      selectedRoutes.clear();
    }
    task = next;
    const [, title, help] = tasks[task];
    byId('ciTaskTitle').textContent = title;
    byId('ciTaskHelp').textContent = help;
    byId('ciSubmit').setAttribute('aria-label', '发送消息');
    const indicator = byId('ciTaskIndicator');
    if (indicator) indicator.textContent = tasks[task][0];
    message.placeholder = '输入你的经历、目标或困惑，让 AI 帮你一起梳理……';
    renderRouteInput();
  }

  function localData() {
    try { return JSON.parse(localStorage.getItem('careerPredictor')) || {}; }
    catch { return {}; }
  }

  function profileContext() {
    const saved = window.CareerProfile.readLocalFields(byId('ciUseLocalProfile').checked);
    const fields = Object.fromEntries(Object.keys(profileLabels).filter(key => saved[key]?.value_state === 'known')
      .map(key => {
        const { value, source_type, confirmation_state } = saved[key];
        return [key, { value_state: 'known', value: String(value), source_type, confirmation_state }];
      }));
    return {
      consent: true, fields,
    };
  }

  function localProfileConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(profileConsentKey));
      return saved?.granted === true && saved.notice_version === profileConsentVersion ? saved : {};
    } catch { return {}; }
  }

  function hasProfileConsent() {
    const stored = window.CareerProfile.profile?.ai_profile_consent;
    if (window.CareerProfile.profile) return stored?.granted === true && stored.notice_version === profileConsentVersion;
    return localProfileConsent().granted === true;
  }

  function syncProfileChoice() {
    byId('ciUseProfile').checked = profileOverride !== false && hasProfileConsent();
  }

  function renderProfileConnection() {
    const state = window.CareerProfile.state;
    const enabled = byId('ciUseProfile').checked;
    const localFields = window.CareerProfile.readLocalFields(byId('ciUseLocalProfile').checked);
    const localAvailable = Object.values(localFields).some(field => field.value_state === 'known');
    let title, help;
    if (state === 'loading') {
      title = '正在读取个人资料…';
      help = '发送前会等待资料读取完成。';
    } else if (state === 'load_failed') {
      title = '个人资料加载失败';
      help = '可重试连接；已授权时，发送请求仍会由服务器核对资料。';
    } else if (!hasProfileConsent()) {
      title = window.CareerProfile.profile ? '已连接统一资料 · 待 AI 授权' :
        state === 'session_expired' ? '访客身份已失效' : localAvailable ? '本浏览器有已保存资料 · 待 AI 授权' : '尚未连接个人资料';
      help = '授权后，可将教育、经历、技能和职业偏好用于在线 AI 问答。';
    } else if (!enabled) {
      title = '本次不使用个人资料';
      help = '已保存的资料和授权继续保留。';
    } else if (window.CareerProfile.profile) {
      title = '已连接个人资料';
      help = '本次 AI 将参考已保存的教育、经历、技能和职业偏好。';
    } else {
      title = localAvailable ? '本次参考已授权的本机资料' : '当前未连接统一资料';
      help = state === 'session_expired' ? '原访客身份已失效，可重新连接统一资料。' :
        state === 'storage_unavailable' ? '统一资料服务暂未配置，本次使用获准的本机资料。' : '可先根据本次问题获得建议。';
    }
    byId('ciProfileConnectionTitle').textContent = title;
    byId('ciProfileConnectionHelp').textContent = help;
    byId('ciProfileUse').textContent = state === 'load_failed' ? '重试连接' :
      enabled ? '本次不使用个人资料' : hasProfileConsent() ? '本次使用个人资料' : '授权并使用';
    byId('ciProfileUse').disabled = state === 'loading';
  }

  function rememberProfileUse(enabled) {
    profileOverride = enabled;
    try { localStorage.setItem(profilePreferenceKey, enabled ? 'yes' : 'no'); } catch {}
    syncProfileChoice();
    refreshSettings();
  }

  async function enableProfileUse(includeLegacy = false) {
    await window.CareerProfile.ready;
    if (!hasProfileConsent() || includeLegacy && !localProfileConsent().includeLegacy) {
      if (!consentRequest) {
        const modal = byId('ciProfileConsentDialog');
        byId('ciConsentIncludeLocal').checked = includeLegacy || byId('ciUseLocalProfile').checked;
        status('ciProfileConsentStatus', '');
        modal.returnValue = '';
        consentRequest = new Promise(resolve => {
          modal.addEventListener('close', () => {
            consentRequest = null;
            resolve(modal.returnValue === 'accepted');
          }, { once: true });
          modal.showModal();
        });
      }
      if (!await consentRequest) {
        syncProfileChoice();
        refreshSettings();
        return false;
      }
    }
    rememberProfileUse(true);
    byId('ciUseLocalProfile').checked = localProfileConsent().includeLegacy === true;
    refreshSettings();
    persistSession();
    return true;
  }

  function hasProfileAnswer(field) {
    const saved = window.CareerProfile.readFields()[field];
    return saved?.value_state === 'known' && (saved.source_type !== 'ai_inference' || saved.confirmation_state !== 'unconfirmed');
  }

  function pendingProfileField() {
    const last = session?.messages.at(-1);
    const field = last?.metadata?.record?.result?.profileField;
    if (last?.role !== 'assistant' || last.status !== 'completed' || last.metadata?.profileReplySkipped ||
        !Object.hasOwn(profileLabels, field)) return null;
    return hasProfileAnswer(field) ? null : field;
  }

  function showProfileReply() {
    const field = pendingProfileField();
    byId('ciProfileReply').hidden = !field;
    byId('ciProfileReplyHint').textContent = field ? `下一条回答将保存为「${profileLabels[field]}」，供以后问答参考。` : '';
  }

  function historyContext(local) {
    const saved = records().slice(0, 5).reverse().flatMap(record => record.note
      ? [{ role: 'user', content: `我确认保存的经历或偏好：${record.note}` }]
      : [
          { role: 'user', content: record.question },
          { role: 'assistant', content: record.result.summary },
          ...(record.treeDecision ? [{ role: 'user', content: record.treeDecision }] : []),
          ...(record.excludedBranches?.length ? [{ role: 'user', content: `我暂时排除的路线：${record.result.branches.filter(branch => record.excludedBranches.includes(branch.id)).map(branch => branch.title).join('、')}` }] : []),
        ]);
    const previous = Array.isArray(local.chatHistory) ? local.chatHistory.slice(-6).map(item => {
      if (typeof item?.content !== 'string') return null;
      if (item.role === 'user') return { role: 'user', content: item.content };
      const template = document.createElement('template');
      template.innerHTML = item.content;
      return { role: 'assistant', content: template.content.textContent };
    }).filter(Boolean) : [];
    const otherConversations = sessions.list().filter(item => item.id !== session?.id).slice(0, 2).reverse().flatMap(item => {
      const answer = item.messages.findLast(candidate => candidate.status === 'completed' && candidate.metadata?.replyTo);
      const question = item.messages.find(candidate => candidate.id === answer?.metadata.replyTo);
      return answer && question ? [{ role: 'user', content: question.content }, { role: 'assistant', content: answer.content }] : [];
    });
    return [...previous, ...otherConversations, ...saved].filter(item => item.content).slice(-8).map(item => ({ ...item, content: item.content.slice(0, 1400) }));
  }

  function inferTask(question) {
    if (/比较|对比|权衡|犹豫|怎么选|如何选|应该.*还是|读研还是|就业还是/.test(question)) return 'compare';
    if (/制定.*(?:计划|路线)|阶段.*(?:计划|路线)|成长路线|阶段性里程碑|成长规划|未来.*年.*(?:规划|路线)/.test(question)) return 'plan';
    if (/探索.*方向|发现.*方向|哪些.*方向|不同.*方向|不知道.*(?:做什么|方向)|适合.*方向/.test(question)) return 'explore';
    if (/成长建议|接下来.*行动|下一步.*行动|调整.*计划|优先级|最应该做什么|现在.*(?:应该|适合).*做什么/.test(question)) return 'growth';
    if (/个人画像|能力画像|梳理.*优势|可迁移能力/.test(question)) return 'profile';
    return task;
  }

  function answerText(record) {
    const { result } = record;
    const parts = [result.summary];
    for (const [key, label] of [['coreStrengths', '核心优势'], ['transferableSkills', '可迁移能力'], ['potentialDirections', '潜在发展方向'], ['skillGaps', '值得提升的能力']]) {
      if (result.profileInsights?.[key]?.length) parts.push(`${label} ${result.profileInsights[key].join('、')}`);
    }
    if (result.assumptions?.length) parts.push(`关键假设 ${result.assumptions.join('；')}`);
    for (const branch of result.branches || []) {
      parts.push(`## ${branch.title}`, branch.description, `推荐依据 ${branch.reason}`,
        `能力缺口 ${branch.skillGaps.join('、')}`, `下一步 ${branch.nextActions.join('、')}`);
      for (const stage of branch.stages || []) parts.push(`${stage.title} ${stage.actions.join('、')}`);
    }
    for (const item of result.comparison || []) parts.push(`${item.routeTitle} ${item.tradeoff}`,
      ...item.dimensions.map(dimension => `${dimensions[dimension.dimension]} ${dimension.assessment}`));
    if (result.priorityIssue) parts.push(result.priorityIssue);
    for (const item of result.actions || []) parts.push(`${item.action}（${item.purpose}）`);
    if (result.nextActions?.length) parts.push('下一步行动', ...result.nextActions.map(item => `- ${item}`));
    if (result.firstAction) parts.push(`现在最值得做的第一件事 ${result.firstAction}`);
    if (result.immediateTask && result.immediateTask !== result.firstAction) parts.push(`现在就能完成 ${result.immediateTask}`);
    if (result.followUpQuestion) parts.push(result.followUpQuestion);
    return parts.filter(Boolean).join('\n\n');
  }

  function conversationHistory(beforeIndex) {
    const messages = (session?.messages || []).slice(0, beforeIndex);
    const history = [];
    for (const item of messages) {
      if (item.role !== 'user') continue;
      const answer = messages.findLast(candidate => candidate.role === 'assistant' && candidate.status === 'completed' && candidate.metadata?.replyTo === item.id);
      if (!answer) continue;
      const followUp = answer.metadata?.record?.result?.followUpQuestion;
      const content = followUp && answer.content.length > 1200
        ? answer.content.slice(0, 1198 - followUp.length) + '\n\n' + followUp : answer.content.slice(0, 1200);
      history.push({ role: 'user', content: item.content.slice(0, 1200) }, { role: 'assistant', content });
    }
    return history.slice(-8);
  }

  async function run({ opportunityMode = false, explicitQuestion, regenerate, retry, forceTask } = {}) {
    if (request || importing) return;
    const question = explicitQuestion || message.value.trim();
    if (!question) return message.focus();
    if (!session && !createSession({ prompt: question, nextTask: task, inheritContext: true })) return;
    const skipReply = /^(?:跳过(?:这题|这个问题)?|不想(?:说|回答|透露)|暂不(?:提供|回答|透露)|不方便(?:回答|透露)|以后再说)[。！!]?$/u.test(question);
    const newTaskRequest = /(?:请|帮我|直接|先给|不必|不用|不要).*(?:规划|计划|路线|分析|比较|建议|方向|画像|提问|反问)|(?:不必|不用|不要).*(?:问|填)/.test(question);
    const profileReply = !explicitQuestion && !regenerate && !retry && !skipReply && !newTaskRequest ? pendingProfileField() : null;
    const saveProfileReply = profileReply && (profileReply === 'experience.text' || question.length <= 2000);
    const nextTask = forceTask || (regenerate ? regenerate.metadata.record.result.task : retry?.metadata.task || (profileReply ? task : inferTask(question)));
    if (nextTask !== task) selectTask(nextTask);
    let routes = ['compare', 'plan', 'growth'].includes(task) ? [...selectedRoutes.values()] : [];
    if (regenerate) routes = regenerate.metadata.record.routes || [];
    if (retry) routes = retry.metadata.routes || [];
    if (opportunityMode && byId('ciUseHistory').checked) {
      const savedPlan = records().find(record => record.result?.task === 'plan' && record.result.branches?.some(branch => !record.excludedBranches?.includes(branch.id)));
      const branch = savedPlan?.result.branches.find(item => !savedPlan.excludedBranches?.includes(item.id));
      if (branch) routes = [branchContext(`${savedPlan.id}_${branch.id}`, branch)];
    }
    if (task === 'plan') routes = routes.slice(0, 1);
    const singleComparison = task === 'compare' && routes.length === 1 ? routes[0] : null;
    if (singleComparison) routes = [];
    const liveSearchRequested = byId('ciLive').checked;
    const publicSearchQuery = byId('ciPublicQuery').value.trim();
    const liveSearch = liveSearchRequested && Boolean(publicSearchQuery);
    const local = localData();
    const previous = regenerate || retry;
    const oldUser = previous && session.messages.find(item => item.id === previous.metadata.replyTo);
    const beforeIndex = oldUser ? session.messages.indexOf(oldUser) : session.messages.length;
    const currentHistory = conversationHistory(beforeIndex);
    const externalHistory = byId('ciUseHistory').checked ? historyContext(local) : [];
    const history = externalHistory.length
      ? [...externalHistory.slice(-2), ...currentHistory.slice(-6)] : currentHistory;
    const node = previous ? previous.metadata.focusNode || null : focusNode;
    const analysisFocus = node || singleComparison;
    const body = {
      task, message: question, routes,
      history, researchEnabled: byId('ciResearch').checked || liveSearchRequested, liveSearch,
      publicSearchQuery: liveSearch ? publicSearchQuery : undefined,
      documents: byId('ciResearch').checked ? documents.filter(item => item.text.trim()).map(({ title, text, kind, locator }) => ({ title, text, kind, locator })) : undefined,
      focusNode: analysisFocus ? { title: analysisFocus.title, description: analysisFocus.description, parentTitle: analysisFocus.parentTitle || '' } : undefined,
      challengeMode: byId('ciChallenge').checked, opportunityMode,
    };
    const createdAt = new Date().toISOString();
    const user = oldUser || { id: crypto.randomUUID(), role: 'user', content: question, status: 'completed', createdAt,
      ...(saveProfileReply ? { metadata: { profileReply } } : {}),
      attachments: documents.map(({ id, title }) => ({ id, title })) };
    const submitted = { id: crypto.randomUUID(), question, createdAt, routes };
    const assistant = { id: submitted.id, role: 'assistant', content: '', status: 'generating', createdAt,
      metadata: { replyTo: user.id, focusNode: analysisFocus || null, task, routes, ...(regenerate ? { regeneratedFrom: regenerate.id } : {}) } };
    if (!oldUser) session.messages.push(user);
    session.messages.push(assistant);
    if (!persistSession()) {
      session.messages = session.messages.filter(item => item.id !== assistant.id && (oldUser || item.id !== user.id));
      return;
    }
    const sessionId = session.id;
    const controller = new AbortController();
    request = { controller, sessionId, assistantId: assistant.id };
    if (!explicitQuestion && !regenerate) message.value = '';
    persistSession();
    renderThread(true);
    resizeComposer();
    byId('ciContext').open = false;
    status('ciStatus', window.CareerProfile.state === 'loading' ? '正在读取已保存资料…' : '正在梳理你的问题…');
    let profileSaveWarning = liveSearchRequested && !liveSearch ? '本次先用已有资料分析。填写公开搜索词后可继续核实实时信息。' : '';
    try {
      const field = user.metadata?.profileReply;
      await window.CareerProfile.ready;
      if (controller.signal.aborted) return;
      if (field && !regenerate && !user.metadata.profileSaved && !hasProfileAnswer(field)) {
        try {
          const { storage } = await window.CareerProfile.saveField(field, question);
          if (controller.signal.aborted || session?.id !== sessionId) return;
          session.messages.find(item => item.id === user.id).metadata.profileSaved = storage;
          persistSession();
          renderThread();
        } catch {
          profileSaveWarning = '这项资料暂未保存，本次仍会根据你刚提供的信息给出建议。';
        }
      }
      if (controller.signal.aborted || session?.id !== sessionId) return;
      syncProfileChoice();
      refreshSettings();
      const useProfile = byId('ciUseProfile').checked;
      const localConsent = useProfile && localProfileConsent().granted === true;
      body.profileUsage = { enabled: useProfile, localConsent };
      if (localConsent) {
        const localProfile = profileContext();
        if (Object.keys(localProfile.fields).length) body.profile = localProfile;
      }
      const response = await fetch('/api/journey/career-intelligence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted || session?.id !== sessionId) return;
      if (!response.ok || !data?.summary || data.task !== body.task) {
        const error = typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw Object.assign(new Error(error || data?.message || '职业规划 AI 暂不可用，请稍后重试。'),
          { profileDiagnostics: data?.profileDiagnostics });
      }
      const target = session.messages.find(item => item.id === assistant.id);
      if (!target || target.status !== 'generating') return;
      turn = { ...submitted, result: data };
      target.status = 'completed';
      target.content = answerText(turn);
      target.metadata.record = turn;
      const saved = persistSession();
      renderThread(true);
      renderRouteInput();
      if (saved) status('ciStatus', profileSaveWarning, Boolean(profileSaveWarning));
    } catch (error) {
      if (!controller.signal.aborted && session?.id === sessionId) {
        const target = session.messages.find(item => item.id === assistant.id);
        target.status = 'failed';
        target.error = error instanceof TypeError ? '连接失败，请稍后重试。' : error.message;
        if (error.profileDiagnostics) target.metadata.profileDiagnostics = error.profileDiagnostics;
        const saved = persistSession();
        renderThread(true);
        if (saved) status('ciStatus', target.error, true);
      }
    } finally {
      if (request?.controller === controller) request = null;
      resizeComposer();
    }
  }

  function detail(parent, label, value) {
    if (!value?.length) return;
    const section = add(parent, 'div', '', 'ci-detail');
    add(section, 'h4', label);
    if (!Array.isArray(value)) return add(section, 'p', value);
    const list = add(section, 'ul');
    for (const item of value) add(list, 'li', item);
  }

  function renderProfileDiagnostics(parent, diagnostics) {
    if (!diagnostics) return;
    const section = add(parent, 'details', '', 'ci-profile-diagnostics');
    add(section, 'summary', '本次个人资料引用');
    const labels = {
      available: '已成功读取个人资料',
      empty: '当前资料库没有可用资料',
      not_requested: '本次未引用个人资料',
      not_authorized: '尚未授权在线 AI 使用个人资料',
      not_connected: '尚未连接统一资料',
      session_expired: '访客身份已失效',
      storage_unavailable: '统一资料服务暂不可用',
      load_failed: '个人资料读取失败',
    };
    const connectionLabels = {
      connected: '已连接统一资料数据库',
      not_connected: '尚未连接统一资料数据库',
      session_expired: '访客身份已失效，统一资料数据库未连接',
      storage_unavailable: '统一资料存储暂不可用',
      load_failed: '统一资料数据库读取失败',
    };
    const failedConnection = ['not_connected', 'session_expired', 'storage_unavailable', 'load_failed'].includes(diagnostics.connectionStatus);
    const stateLabel = diagnostics.status === 'empty' && failedConnection ? connectionLabels[diagnostics.connectionStatus] :
      labels[diagnostics.status] || '已记录本次资料读取状态';
    add(section, 'p', stateLabel);
    if (diagnostics.connectionStatus && diagnostics.connectionStatus !== 'connected') {
      add(section, 'p', '统一资料连接 · ' + (connectionLabels[diagnostics.connectionStatus] || '未连接'));
    }
    const list = add(section, 'dl');
    for (const [label, key] of [['教育背景', 'educationCount'], ['项目与科研经历', 'experienceCount'],
      ['技能信息', 'skillCount'], ['职业偏好', 'preferenceCount'], ['资料字段', 'fieldCount'],
      ['历史消息', 'historyCount'], ['上下文字符', 'totalCharacters']]) {
      if (!Number.isFinite(diagnostics[key])) continue;
      const row = add(list, 'div');
      add(row, 'dt', label);
      add(row, 'dd', String(diagnostics[key]));
    }
    const sources = { sqlite: '统一资料数据库', browser: '获准的本浏览器资料', mixed: '统一资料数据库与获准的本机资料', none: '本次未引用' };
    add(section, 'p', '资料来源 · ' + (sources[diagnostics.source] || '已授权资料'));
    const delivery = diagnostics.usedByModel ? '资料已随本次请求发送给 AI' :
      diagnostics.profileAvailable && diagnostics.modelRequestSent ? '已尝试携带资料发送，尚未收到模型响应' :
      diagnostics.modelRequestSent ? '已请求 AI，本次未引用个人资料' : '尚未发出模型请求';
    add(section, 'p', '资料状态 · ' + delivery);
    if (diagnostics.truncatedFields?.length) {
      const fields = [...new Set(diagnostics.truncatedFields.map(item => typeof item === 'string' ? item : item.field))];
      add(section, 'p', '长文本已按上下文预算选取相关片段 · ' + fields.map(field => profileLabels[field] || '经历资料').join('、'));
    }
    if (diagnostics.conflictCount > 0) add(section, 'p', '检测到 ' + diagnostics.conflictCount + ' 项来源差异，已优先采用本人确认或纠正的资料。');
    if (diagnostics.requestId) add(section, 'p', '请求编号 · ' + diagnostics.requestId);
    if (diagnostics.usedByModel) add(section, 'p', '这些统计说明资料已发送。若回答仍未体现，可用请求编号定位本次处理。');
  }

  function evidenceRefs(parent, ids, evidence) {
    const matched = [...new Set(ids || [])].map(id => evidence.findIndex(source => source.sourceId === id)).filter(index => index >= 0);
    if (!matched.length) return;
    const refs = add(parent, 'span', ' · 依据 ', 'ci-muted');
    for (const index of matched) button(refs, `[${index + 1}] `, () => {
      const article = parent.closest('.ci-message-assistant');
      article.querySelector('.ci-sources').open = true;
      const source = article.querySelector(`[data-source-index="${index}"]`);
      source.focus();
      source.scrollIntoView({ block: 'nearest' });
    });
  }

  function pickBranch(record, branch, nextTask) {
    const id = `${record.id}_${branch.id}`;
    selectTask(nextTask);
    if (nextTask !== 'compare') selectedRoutes.clear();
    if (!selectedRoutes.has(id) && selectedRoutes.size >= 5) return status('ciStatus', '一次最多比较 5 条路线。', true);
    selectedRoutes.set(id, branchContext(id, branch));
    renderRouteInput();
    if (!message.value.trim() && nextTask !== 'growth') message.value = nextTask === 'plan' ? `请为「${branch.title}」制定阶段计划。` : '请比较已选路线的取舍、能力缺口和转向成本。';
    if (nextTask !== 'compare' || selectedRoutes.size > 1) message.focus();
    resizeComposer();
    persistSession();
    status('ciStatus', nextTask === 'compare' ? `已选 ${selectedRoutes.size} 条路线。` : '已选定路线。');
  }

  function renderBranch(parent, branch, record, evidence) {
    const article = add(parent, 'article', '', 'ci-branch');
    add(article, 'p', [kinds[branch.type], confidence[branch.confidence] && `置信度 ${confidence[branch.confidence]}`].filter(Boolean).join(' · '), 'ci-branch-kind');
    add(article, 'h3', branch.title);
    add(article, 'p', branch.description);
    const reason = detail(article, '推荐依据', branch.reason);
    if (reason) evidenceRefs(reason, branch.evidenceIds, evidence);
    detail(article, '怎样验证', branch.verification);
    detail(article, '下一步行动', branch.nextActions);
    const extra = add(article, 'details');
    add(extra, 'summary', '查看能力、成本和阶段');
    for (const [label, value] of [
      ['发展目标', branch.goal], ['当前起点', branch.startingPoint], ['已有优势', branch.advantages],
      ['能力缺口', branch.skillGaps], ['所需知识', branch.knowledge], ['学历或证书', branch.credentials], ['建议实践', branch.practice],
      ['主要风险', branch.risks], ['预计时间', branch.timeCost], ['经济成本', branch.economicCost],
      ['机会成本', branch.opportunityCost], ['转向灵活性', branch.flexibility],
    ]) detail(extra, label, value);
    const stageLabels = branch.planningHorizon === 'three_year' ? threeYearStages : stages;
    for (const stage of branch.stages || []) detail(record.result.task === 'plan' ? article : extra,
      [stageLabels[stage.timeframe], stage.title].filter(Boolean).join(' · '), stage.actions);
    const actions = add(article, 'div', '', 'ci-inline-actions');
    const excluded = record.excludedBranches?.includes(branch.id);
    if (!excluded) {
      if (record.result.task !== 'plan') button(actions, '制定阶段计划', () => pickBranch(record, branch, 'plan'));
      else button(actions, '调整此计划', () => pickBranch(record, branch, 'growth'));
      button(actions, '选来比较', () => pickBranch(record, branch, 'compare'));
    }
    button(actions, excluded ? '恢复此方向' : '记录为暂不考虑', () => {
      const previous = record.excludedBranches || [];
      const excludedBranches = excluded ? previous.filter(id => id !== branch.id) : [...previous, branch.id];
      try {
        writeRecord({ ...record, excludedBranches });
        record.excludedBranches = excludedBranches;
        if (!excluded) selectedRoutes.delete(`${record.id}_${branch.id}`);
        renderRouteInput();
        const current = session?.messages.find(item => item.id === record.id);
        if (current) { current.metadata.record = record; persistSession(); }
        renderThread();
        recordStatus(record, excluded ? '已恢复此方向。' : '已记录为暂不考虑。');
      } catch { recordStatus(record, '当前浏览器无法保存记录。', true); }
    });
  }

  function renderComparison(parent, items, evidence) {
    if (!items?.length) return;
    add(parent, 'h3', '各条路线的取舍');
    const wrapper = add(parent, 'div', '', 'ci-table-scroll');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('aria-label', '路线比较表，可横向滚动');
    const table = add(wrapper, 'table', '', 'ci-comparison');
    const head = add(add(table, 'thead'), 'tr');
    add(head, 'th', '维度').scope = 'col';
    for (const item of items) add(head, 'th', item.routeTitle || routePool().find(route => route.id === item.routeId)?.title || item.routeId).scope = 'col';
    const tbody = add(table, 'tbody');
    for (const [key, label] of Object.entries(dimensions)) {
      const row = add(tbody, 'tr');
      add(row, 'th', label).scope = 'row';
      for (const item of items) {
        const cell = item.dimensions?.find(entry => entry.dimension === key);
        const element = add(row, 'td', cell?.assessment || '未知');
        evidenceRefs(element, cell?.evidenceIds, evidence);
      }
    }
    const row = add(tbody, 'tr');
    add(row, 'th', '主要取舍').scope = 'row';
    for (const item of items) add(row, 'td', item.tradeoff || '未知');
    if (items.some(item => item.riskAssessment)) {
      const riskRow = add(tbody, 'tr');
      add(riskRow, 'th', '风险与适用情景').scope = 'row';
      for (const item of items) add(riskRow, 'td', item.riskAssessment || '待验证');
    }
  }

  function renderSources(parent, evidence, research) {
    const section = add(parent, 'details', '', 'ci-sources');
    section.dataset.sourceList = '';
    if (evidence.length) button(parent, '查看资料来源', () => { section.open = !section.open; });
    add(section, 'summary', `依据与检索状态${evidence.length ? `（${evidence.length}）` : ''}`);
    const researchMessages = Array.isArray(research?.warnings) ? research.warnings : [];
    if (research?.message) add(section, 'p', research.message, 'ci-muted');
    for (const warning of researchMessages) add(section, 'p', warning, 'ci-muted');
    if (!evidence.length) return add(section, 'p', '本次没有可引用的外部来源或文件片段。', 'ci-muted');
    const list = add(section, 'ol');
    for (const [index, source] of evidence.entries()) {
      const item = add(list, 'li');
      item.dataset.sourceIndex = String(index);
      item.tabIndex = -1;
      if (/^https:\/\//i.test(source.url || '')) {
        const link = add(item, 'a', source.title || '查看来源');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else add(item, 'strong', source.title || '用户资料');
      add(item, 'p', [source.publisher, source.locator, source.checkedAt && `检索或校验 ${dateLabel(source.checkedAt)}`, source.stale && '资料可能已过时'].filter(Boolean).join(' · '), 'ci-muted');
      const labels = { user_provided_unverified: '用户资料，未经独立核实', official_search_excerpt_unverified: '公开搜索片段，待核对原文', official_snapshot_checked: '官方来源快照', official_snapshot_stale: '官方来源快照，可能已过时' };
      if (labels[source.verificationStatus]) add(item, 'p', labels[source.verificationStatus], 'ci-muted');
      if (source.region || source.applicability) add(item, 'p', [source.region, source.applicability].filter(Boolean).join(' · '), 'ci-muted');
      if (source.excerpt) add(item, 'p', source.excerpt);
    }
  }

  function renderInline(parent, content) {
    const expression = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
    let position = 0;
    for (const match of content.matchAll(expression)) {
      parent.append(document.createTextNode(content.slice(position, match.index)));
      const token = match[0];
      if (token.startsWith('`')) add(parent, 'code', token.slice(1, -1));
      else if (token.startsWith('**')) add(parent, 'strong', token.slice(2, -2));
      else if (token.startsWith('*')) add(parent, 'em', token.slice(1, -1));
      else {
        const parts = token.match(/^\[([^\]]+)\]\((.+)\)$/);
        const link = add(parent, 'a', parts[1]);
        link.href = parts[2];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      position = match.index + token.length;
    }
    parent.append(document.createTextNode(content.slice(position)));
  }

  function renderMarkdown(parent, content) {
    const lines = String(content || '').split('\n');
    let list = null;
    let code = null;
    let table = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        list = table = null;
        code = code ? null : add(add(parent, 'pre'), 'code');
        continue;
      }
      if (code) { code.append(document.createTextNode(`${line}\n`)); continue; }
      if (!line.trim()) { list = table = null; continue; }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { renderInline(add(parent, `h${Math.min(6, heading[1].length + 2)}`), heading[2]); list = table = null; continue; }
      const isTableHeader = line.includes('|') && /^\s*\|?\s*:?-+:?\s*\|/.test(lines[index + 1] || '');
      if (isTableHeader || (table && line.includes('|'))) {
        if (isTableHeader) {
          table = add(add(parent, 'div', '', 'ci-table-scroll'), 'table', '', 'ci-comparison');
          list = null;
        }
        const row = add(table, 'tr');
        for (const cell of line.trim().replace(/^\||\|$/g, '').split('|')) renderInline(add(row, isTableHeader ? 'th' : 'td'), cell.trim());
        if (isTableHeader) index += 1;
        continue;
      }
      table = null;
      const item = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (item) {
        const tag = item[2] ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) list = add(parent, tag.toLowerCase());
        renderInline(add(list, 'li'), item[3]);
        continue;
      }
      list = null;
      renderInline(add(parent, line.startsWith('> ') ? 'blockquote' : 'p'), line.replace(/^> /, ''));
    }
  }

  function recordStatus(record, text, error = false) {
    const node = byId(`ciTurn-${record.id}`)?.querySelector('[data-result-status]');
    if (!node) return status('ciStatus', text, error);
    node.textContent = text;
    node.dataset.error = String(error);
  }

  function renderResult(record, parent) {
    const { result } = record;
    const evidence = result.evidence || [];
    const actions = add(parent, 'div', '', 'ci-message-actions');
    button(actions, '复制', async () => {
      try { await navigator.clipboard.writeText(answerText(record)); recordStatus(record, '已复制'); }
      catch { recordStatus(record, '复制失败，可选中文字复制。', true); }
    });
    const sourceMessage = session?.messages.find(item => item.id === record.id);
    if (sourceMessage) button(actions, '重新生成', () => {
      if (request) return status('ciStatus', '请先停止当前生成。', true);
      run({ explicitQuestion: record.question, regenerate: sourceMessage });
    });
    button(actions, '保存为规划记录', () => {
      try { writeRecord(record); recordStatus(record, '已保存到我的规划记录'); }
      catch { recordStatus(record, '当前浏览器无法保存分析。', true); }
    });
    const resultStatus = add(parent, 'p', '', 'ci-status');
    resultStatus.dataset.resultStatus = '';
    resultStatus.setAttribute('role', 'status');
    const answer = add(parent, 'div', '', 'ci-message-content');
    const contextUsed = result.contextAvailability;
    const labels = [];
    if (contextUsed?.profile?.status === 'available') labels.push('已参考个人画像');
    if (contextUsed?.history?.status === 'available') labels.push('已参考当前资料与对话');
    if (contextUsed?.documents?.status === 'available') labels.push('已参考上传资料');
    if (labels.length) add(answer, 'p', labels.join(' · '), 'ci-muted');
    renderMarkdown(add(answer, 'div', '', 'ci-answer'), result.summary);
    const insights = result.profileInsights || {};
    detail(answer, '关键假设', result.assumptions);
    for (const [label, key] of [['核心优势', 'coreStrengths'], ['可迁移能力', 'transferableSkills'], ['潜在发展方向', 'potentialDirections'], ['值得提升的能力', 'skillGaps']]) detail(answer, label, insights[key]);
    if (Object.values(insights).some(items => items?.length)) {
      const profile = add(answer, 'details', '', 'ci-detail');
      add(profile, 'summary', '画像依据与待确认信息');
      detail(profile, '用户自述', insights.selfReported);
      detail(profile, 'AI 推断', insights.inferred);
      detail(profile, '待确认', insights.missing);
      for (const entry of insights.documented || []) {
        const line = detail(profile, '资料所载', entry.statement);
        if (line) evidenceRefs(line, entry.evidenceIds, evidence);
      }
      if (insights.selfReported?.length || insights.documented?.length) button(profile, '编辑个人资料', () => openDialog('ciProfileDialog'));
    }
    if (result.branches?.length) {
      const grid = add(answer, 'div', '', 'ci-branches');
      for (const branch of result.branches) renderBranch(grid, branch, record, evidence);
    }
    renderComparison(answer, result.comparison, evidence);
    if (result.actions?.length) {
      detail(answer, '当前最值得优先解决的问题', result.priorityIssue);
      detail(answer, '接下来可以做什么', result.actions.map(item => `${item.action}（${item.purpose}）`));
    } else detail(answer, '下一步行动', result.nextActions);
    detail(answer, '现在最值得做的第一件事', result.firstAction);
    if (result.immediateTask !== result.firstAction) detail(answer, '现在就能完成的小任务', result.immediateTask);
    if (result.followUpQuestion) {
      const next = add(answer, 'div', '', 'ci-follow-up');
      const isLatest = session?.messages.at(-1)?.id === record.id;
      if (isLatest && Object.hasOwn(profileLabels, result.profileField) && hasProfileAnswer(result.profileField)) {
        add(next, 'p', `你的个人资料中已有「${profileLabels[result.profileField]}」。`);
        button(next, '参考已保存的资料继续', async () => {
          if (request) return;
          if (!await enableProfileUse()) return;
          run({ explicitQuestion: '请参考我已保存的个人资料，继续分析刚才的问题。', forceTask: result.task });
        });
      } else {
        add(next, 'p', result.followUpQuestion);
        button(next, '继续回答', () => {
          if (!isLatest && pendingProfileField()) byId('ciSkipProfileReply').click();
          selectTask(result.task);
          selectedRoutes.clear();
          for (const route of record.routes || []) selectedRoutes.set(route.id, route);
          renderRouteInput();
          message.placeholder = result.followUpQuestion;
          message.focus();
        });
      }
    }
    renderSources(answer, evidence, result.researchStatus);
    renderProfileDiagnostics(answer, result.profileDiagnostics);
    parent.append(actions, resultStatus);
  }

  function renderThread(scroll = false) {
    showProfileReply();
    const parent = byId('ciMessages');
    const scroller = byId('ciThread');
    const previousTop = scroller.scrollTop;
    parent.replaceChildren();
    const items = session?.messages || [];
    byId('ciWelcome').hidden = items.length > 0;
    parent.hidden = !items.length;
    byId('ciChatMain').classList.toggle('is-chat', items.length > 0);
    if (items.length) byId('ciChatMain').append(byId('ciComposeArea'));
    else byId('ciWelcome').querySelector('.ci-suggestions-section').before(byId('ciComposeArea'));
    byId('ciChatTitle').textContent = session?.title || '新对话';
    for (const item of items) {
      const article = add(parent, 'article', '', `ci-message ci-message-${item.role}`);
      article.id = `ciTurn-${item.id}`;
      article.tabIndex = -1;
      article.setAttribute('aria-label', item.role === 'user' ? '你的消息' : 'AI 回答');
      add(article, 'span', item.role === 'user' ? '你' : '星轨', 'ci-message-author');
      if (item.role === 'user') {
        add(article, 'div', item.content, 'ci-message-content');
        if (item.metadata?.profileSaved && Object.hasOwn(profileLabels, item.metadata.profileReply)) {
          const where = item.metadata.profileSaved === 'cloud' ? '统一资料' : '本浏览器';
          add(article, 'small', `${profileLabels[item.metadata.profileReply]}已保存到${where}`, 'ci-muted');
        }
        if (item.attachments?.length) {
          const files = add(article, 'div', '', 'ci-message-attachments');
          for (const attachment of item.attachments) add(files, 'span', attachment.title, 'ci-source-tag');
        }
      } else if (item.status === 'completed' && item.metadata?.record) renderResult(item.metadata.record, article);
      else {
        const text = item.status === 'generating' ? '正在结合你的问题梳理思路…' : item.error || (item.status === 'interrupted' ? '上次生成已中断，可以重试。' : '已停止生成。');
        add(article, 'p', text, item.status === 'generating' ? 'ci-message-pending' : 'ci-muted');
        if (item.status !== 'generating') button(article, '重试', () => {
          const user = session.messages.find(candidate => candidate.id === item.metadata?.replyTo);
          if (user) run({ explicitQuestion: user.content, retry: item });
        });
        renderProfileDiagnostics(article, item.metadata?.profileDiagnostics);
      }
    }
    requestAnimationFrame(() => { scroller.scrollTop = scroll ? scroller.scrollHeight : previousTop; });
  }

  function renderDocuments() {
    const parent = byId('ciDocuments');
    parent.replaceChildren();
    for (const entry of documents) {
      const card = add(parent, 'details', '', 'ci-document');
      add(card, 'summary', entry.title);
      const text = add(card, 'textarea');
      text.value = entry.text;
      text.maxLength = 20000;
      text.rows = 4;
      text.setAttribute('aria-label', `${entry.title} 提取的文字`);
      text.addEventListener('input', () => { entry.text = text.value; persistSession(); });
      const controls = add(card, 'div', '', 'ci-inline-actions');
      button(controls, '保存至此浏览器', () => {
        if (!entry.text.trim()) return status('ciStatus', '请先填写要保存的资料内容。', true);
        try {
          const saved = readArray(documentKey, true).filter(item => item.id !== entry.id);
          if (saved.length >= 3) return status('ciStatus', '已保存 3 份资料。请先移除一份。', true);
          localStorage.setItem(documentKey, JSON.stringify([...saved, entry]));
          status('ciStatus', '已保存这份资料的文字。');
        } catch { status('ciStatus', '当前浏览器无法保存资料。', true); }
      });
      button(controls, '移除', () => {
        try {
          const saved = readArray(documentKey, true);
          if (saved.some(item => item.id === entry.id)) localStorage.setItem(documentKey, JSON.stringify(saved.filter(item => item.id !== entry.id)));
          documents = documents.filter(item => item.id !== entry.id);
          persistSession();
          renderDocuments();
          status('ciStatus', '已移除资料。');
        } catch { status('ciStatus', '当前浏览器无法移除资料。', true); }
      });
    }
    for (const saved of readArray(documentKey).filter(item => !documents.some(entry => entry.id === item.id))) {
      button(parent, `使用已保存资料 · ${saved.title}`, () => {
        if (importing) return status('ciStatus', '请等当前文件解析完成后再添加资料。', true);
        if (documents.length >= 3) return status('ciStatus', '一次最多使用 3 份个人资料。', true);
        if (!session && !createSession({ prompt: message.value, nextTask: task, inheritContext: true })) return;
        documents.push(saved);
        persistSession();
        renderDocuments();
      });
    }
  }

  async function importFiles(event) {
    const input = event.currentTarget;
    const files = [...input.files];
    if (!files.length || importing) return;
    if (documents.length + files.length > 3) {
      input.value = '';
      return status('ciStatus', '一次最多使用 3 份个人资料，请先移除不需要的资料。', true);
    }
    if (!session && !createSession({ prompt: message.value, nextTask: task, inheritContext: true })) return;
    if (!persistSession()) return;
    const targetId = session.id;
    importing = true;
    input.disabled = true;
    status('ciStatus', '正在提取文件文字。');
    try {
      const { parseDocumentFile } = await import('/journey/documents.js');
      const failures = [];
      const imported = [];
      for (const file of files) {
        try {
          const { id, title, text, kind, locator } = await parseDocumentFile(file, progress => status('ciStatus', progress));
          imported.push({ id, title, text, kind, locator });
        } catch (error) { failures.push(`${file.name} · ${error.message}`); }
      }
      const target = session?.id === targetId ? session : sessions.get(targetId);
      if (!target) return;
      if ((target.attachments || []).length + imported.length > 3) throw new Error('资料数量已变化，请移除不需要的资料后重新导入。');
      target.attachments = [...(target.attachments || []), ...imported];
      if (session?.id === targetId) {
        documents = target.attachments;
        persistSession();
        renderDocuments();
        status('ciStatus', failures.length ? failures.join('；') : '已提取文件文字。可展开核对，勾选资料检索后用于分析。', failures.length > 0);
      } else { sessions.save(target); renderSessions(); }
    } catch { status('ciStatus', '文件解析暂不可用。可以把相关文字粘贴到问题里。', true); }
    finally {
      importing = false;
      input.disabled = false;
      input.value = '';
      resizeComposer();
    }
  }

  function cancelRequest() {
    if (!request) return;
    const active = request;
    request = null;
    active.controller.abort();
    if (session?.id === active.sessionId) {
      const item = session.messages.find(candidate => candidate.id === active.assistantId);
      if (item) item.status = 'stopped';
      persistSession();
      renderThread();
    }
    resizeComposer();
    status('ciStatus', '已停止生成。');
  }

  function deactivate() {
    closeSettings();
    activeRoute = '';
    activation += 1;
    cancelRequest();
    persistSession();
    closeSidebar();
  }

  function resumeRecord(record) {
    const existing = sessions.list().find(item => item.messages.some(message => message.metadata?.record?.id === record.id));
    if (existing) { openSession(existing.id); focusRecord(record.id); return; }
    if (!createSession({ nextTask: record.result.task })) return;
    const user = { id: crypto.randomUUID(), role: 'user', content: record.question, status: 'completed', createdAt: record.createdAt };
    session.title = record.question.trim().slice(0, 36) || '继续我的规划';
    session.messages = [user, { id: record.id, role: 'assistant', content: answerText(record), status: 'completed', createdAt: record.createdAt,
      metadata: { replyTo: user.id, record } }];
    selectedRoutes.clear();
    for (const route of record.routes || []) selectedRoutes.set(route.id, route);
    if (persistSession()) applySession();
    focusRecord(record.id);
  }

  function focusRecord(id) {
    requestAnimationFrame(() => {
      const answer = byId(`ciTurn-${id}`);
      answer?.focus({ preventScroll: true });
      answer?.scrollIntoView({ block: 'start' });
    });
  }

  async function activate(detail, position, identifier) {
    const route = [detail, position, identifier].join('/');
    if (route === activeRoute) { renderMemory(); return; }
    const current = ++activation;
    cancelRequest();
    if (session && !persistSession()) return;
    activeRoute = route;
    renderMemory();
    if (detail === 'chat' && position) {
      const saved = sessions.get(decodeURIComponent(position));
      if (!saved) {
        session = null;
        applySession();
        history.replaceState(null, '', '/index.html#intelligence');
        activeRoute = '//';
        return status('ciStatus', '这条对话已删除或无法读取。', true);
      }
      session = saved;
      applySession();
    } else if (detail === 'turn') {
      const record = records().find(item => item.id === decodeURIComponent(position || '') && item.result);
      if (record) resumeRecord(record);
      else {
        session = null;
        applySession();
        status('ciStatus', '此浏览器没有保存这条规划分析。', true);
      }
    } else if (['tree', 'compare-tree'].includes(detail) && position && identifier) {
      const comparing = detail === 'compare-tree';
      if (!createSession({ nextTask: comparing ? 'compare' : 'explore' })) return;
      try {
        const { getCareerNodeContext } = await import('/journey/career-intelligence-tree.js');
        if (current !== activation || !byId('step8').classList.contains('active')) return;
        const treeId = decodeURIComponent(position);
        const nodeIds = [...new Set(identifier.split(',').map(id => decodeURIComponent(id)))];
        if (comparing ? nodeIds.length < 2 || nodeIds.length > 5 : nodeIds.length !== 1) throw new Error('请选择要分析的发展方向。');
        const nodes = nodeIds.map(id => ({ id, ...getCareerNodeContext(treeId, id) }));
        if (comparing) {
          for (const [index, node] of nodes.entries()) {
            const id = `tree-route-${index + 1}`;
            selectedRoutes.set(id, { id, title: node.title, description: node.description });
          }
          renderRouteInput();
        } else focusNode = { ...nodes[0], treeId, nodeId: nodes[0].id };
        renderFocus();
        message.value = comparing ? '请比较这些发展路线，说明主要取舍和能否并行推进。' : '基于这个方向和我的情况，有哪些值得验证的后续方向？';
        resizeComposer();
        persistSession();
      } catch (error) { status('ciStatus', error.message, true); }
    } else {
      session = null;
      applySession();
      if (Object.hasOwn(tasks, detail)) createSession({ prompt: prompts[detail], nextTask: detail });
    }
    const storage = sessions.state();
    if (storage.error) status('ciStatus', storage.error.message || '聊天记录暂时无法保存。', true);
  }

  function fillProfileEditor() {
    const field = byId('ciProfileField').value;
    const editor = byId('ciProfileValue');
    editor.value = window.CareerProfile.readFields()[field]?.value || '';
    editor.maxLength = field === 'experience.text' ? 20000 : 2000;
    byId('ciProfileValueLabel').textContent = profileLabels[field];
  }

  async function openDialog(id) {
    closeSettings();
    renderMemory();
    closeSidebar();
    const target = byId(id);
    if (!target.open) target.showModal();
    if (id === 'ciProfileDialog') {
      const editor = byId('ciProfileValue');
      editor.disabled = true;
      byId('ciProfileSave').disabled = true;
      status('ciProfileStatus', '正在读取资料…');
      try {
        await window.CareerProfile.ready;
        fillProfileEditor();
        status('ciProfileStatus', '');
        editor.disabled = false;
        byId('ciProfileSave').disabled = false;
      } catch (error) { status('ciProfileStatus', error.message, true); }
    }
  }

  function choosePrompt(nextTask) {
    createSession({ prompt: prompts[nextTask], nextTask });
  }

  byId('ciNewChat').onclick = () => createSession();
  byId('ciHeaderNewChat').onclick = () => createSession();
  byId('ciShowAssistant').onclick = () => { closeSidebar(); message.focus(); };
  byId('ciSessionSearch').addEventListener('input', renderSessions);
  for (const control of byId('ciSuggestions').querySelectorAll('[data-ci-prompt]')) control.onclick = () => choosePrompt(control.dataset.ciPrompt);
  byId('ciStop').onclick = cancelRequest;
  for (const id of ['ciAttach', 'ciQuickUpload']) byId(id).onclick = () => byId('ciFile').click();
  for (const id of ['ciShowRecords', 'ciContinuePlan']) byId(id).onclick = () => openDialog('ciRecordsDialog');
  byId('ciShowProfile').onclick = () => openDialog('ciProfileDialog');
  for (const [field, label] of Object.entries(profileLabels)) {
    byId('ciProfileField').add(new Option(label, field));
  }
  byId('ciProfileField').onchange = () => { fillProfileEditor(); status('ciProfileStatus', ''); };
  byId('ciProfileForm').onsubmit = async event => {
    event.preventDefault();
    const select = byId('ciProfileField'), editor = byId('ciProfileValue'), save = byId('ciProfileSave');
    if (save.disabled) return;
    select.disabled = editor.disabled = save.disabled = true;
    try {
      const { storage } = await window.CareerProfile.saveField(select.value, editor.value.trim() || null);
      showProfileReply();
      const where = storage === 'cloud' ? '统一资料' : '本浏览器';
      status('ciProfileStatus', `已${editor.value.trim() ? '保存到' + where : '清除此项'}。`);
    } catch (error) { status('ciProfileStatus', error.message, true); }
    finally { select.disabled = editor.disabled = save.disabled = false; }
  };
  byId('ciSkipProfileReply').onclick = () => {
    const last = session?.messages.at(-1);
    if (!last?.metadata?.record?.result?.profileField) return;
    last.metadata.profileReplySkipped = true;
    persistSession();
    showProfileReply();
    message.focus();
  };
  window.addEventListener('career-profile-updated', () => { syncProfileChoice(); refreshSettings(); renderThread(); });
  byId('ciProfileUse').onclick = async () => {
    if (window.CareerProfile.state === 'load_failed') {
      await window.CareerProfile.refresh();
      syncProfileChoice();
      refreshSettings();
      return;
    }
    if (byId('ciUseProfile').checked) {
      rememberProfileUse(false);
      persistSession();
    } else await enableProfileUse();
  };
  byId('ciProfileConsentCancel').onclick = () => byId('ciProfileConsentDialog').close('cancelled');
  byId('ciProfileConsentAccept').onclick = async () => {
    const accept = byId('ciProfileConsentAccept');
    accept.disabled = true;
    try {
      await window.CareerProfile.ready;
      if (window.CareerProfile.profile) await window.CareerProfile.saveAIConsent(true);
      localStorage.setItem(profileConsentKey, JSON.stringify({
        granted: true, notice_version: profileConsentVersion,
        includeLegacy: byId('ciConsentIncludeLocal').checked, updated_at: new Date().toISOString(),
      }));
      byId('ciProfileConsentDialog').close('accepted');
    } catch (error) {
      status('ciProfileConsentStatus', error.message || '授权偏好未能保存，请重试。', true);
    } finally { accept.disabled = false; }
  };
  byId('ciUseLocalProfile').addEventListener('change', async () => {
    if (byId('ciUseLocalProfile').checked && !localProfileConsent().includeLegacy) {
      await enableProfileUse(true);
      byId('ciUseLocalProfile').checked = localProfileConsent().includeLegacy === true;
    }
    refreshSettings();
    persistSession();
  });
  const settings = byId('ciContext');
  function syncSettingsExpanded() {
    for(const id of ['ciShowSettings','ciSettingsButton'])byId(id).setAttribute('aria-expanded',String(settings.open));
  }
  function closeSettings(focus=false) {
    settings.open=false;syncSettingsExpanded();
    if(focus)byId('ciSettingsButton').focus({preventScroll:true});
  }
  settings.addEventListener('toggle',syncSettingsExpanded);
  syncSettingsExpanded();
  byId('ciShowSettings').onclick = () => {
    const open=!settings.open;closeSidebar();settings.open=open;syncSettingsExpanded();
    if(open)byId('ciSettingsButton').focus({preventScroll:true});
  };
  byId('ciCloseSettings').onclick=()=>closeSettings(true);
  document.addEventListener('click',event=>{
    if(settings.open&&!settings.contains(event.target)&&!byId('ciShowSettings').contains(event.target))closeSettings();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&settings.open&&!document.querySelector('dialog[open]')){
      event.preventDefault();closeSettings(true);
    }
  });
  for (const close of document.querySelectorAll('[data-ci-close]')) close.onclick = () => close.closest('dialog').close();
  for (const modal of [byId('ciRecordsDialog'), byId('ciProfileDialog')]) {
    modal.addEventListener('click', event => { if (event.target.closest('a[href]')) modal.close(); });
  }
  byId('ciSidebarToggle').onclick = () => {
    if (matchMedia('(max-width: 850px)').matches) {
      const open = document.body.classList.toggle('ci-sidebar-open');
      byId('ciSidebarToggle').setAttribute('aria-expanded', String(open));
      byId('ciSidebarBackdrop').hidden = !open;
      byId('ciChatMain').inert = open;
      document.querySelector('.career-nav').inert = open;
      document.querySelector('.career-top').inert = open;
      byId('ciSidebar').inert = !open;
      byId('ciSidebar').setAttribute('role', 'dialog');
      byId('ciSidebar').setAttribute('aria-modal', String(open));
      if (open) byId('ciSidebarClose').focus();
    } else {
      const collapsed = document.body.classList.toggle('ci-sidebar-collapsed');
      byId('ciSidebarToggle').setAttribute('aria-expanded', String(!collapsed));
      byId('ciSidebar').inert = collapsed;
    }
  };
  byId('ciSidebarClose').onclick = () => { closeSidebar(); byId('ciSidebarToggle').focus(); };
  byId('ciSidebarBackdrop').onclick = closeSidebar;
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('ci-sidebar-open')) return;
    if (event.key === 'Escape') { closeSidebar(); byId('ciSidebarToggle').focus(); }
    if (event.key === 'Tab') {
      const controls = [...byId('ciSidebar').querySelectorAll('a[href],button,input,summary')].filter(element => element.getClientRects().length && !element.disabled);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  for (const id of Object.values(optionIds)) byId(id).addEventListener('change', async () => {
    if (id === 'ciUseProfile') {
      if (byId(id).checked) await enableProfileUse();
      else rememberProfileUse(false);
    }
    refreshSettings();
    if (session) persistSession();
  });
  byId('ciPublicQuery').addEventListener('input', () => { refreshSettings(); if (session) scheduleDraft(); });
  message.addEventListener('input', scheduleDraft);
  message.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      run();
    }
  });
  byId('ciFile').addEventListener('change', importFiles);
  byId('ciForm').addEventListener('submit', event => { event.preventDefault(); run(); });
  byId('ciNoteForm').addEventListener('submit', event => {
    event.preventDefault();
    const field = byId('ciNote');
    const note = field.value.trim();
    if (!note) return field.focus();
    const discover = event.submitter?.value === 'discover';
    if (discover && request) return status('ciMemoryStatus', '请等当前分析完成后再探索。', true);
    try {
      writeRecord({ id: crypto.randomUUID(), note, createdAt: new Date().toISOString() });
      field.value = '';
      status('ciMemoryStatus', '已保存记录。');
      if (discover) {
        byId('ciProfileDialog').close();
        if (!session && !createSession()) return;
        selectTask('explore');
        run({ opportunityMode: true, forceTask: 'explore', explicitQuestion: `这是我新增的经历或偏好：${note}\n它会带来哪些可验证的新方向？` });
      }
    } catch { status('ciMemoryStatus', '当前浏览器无法保存记录。', true); }
  });
  window.addEventListener('storage', event => {
    if (event.key === profileConsentKey) {
      syncProfileChoice();
      refreshSettings();
    }
    if (event.key === storageKey) { renderMemory(); renderRouteInput(); }
    if (event.key === sessions.key) { sessions.reload(); renderSessions(); }
  });
  window.addEventListener('pagehide', () => { cancelRequest(); persistSession(); });
  matchMedia('(max-width: 850px)').addEventListener('change', closeSidebar);
  applySession();
  window.CareerProfile.ready.then(() => { syncProfileChoice(); refreshSettings(); });
  closeSidebar();
  window.CareerIntelligence = { activate, deactivate };
})();
