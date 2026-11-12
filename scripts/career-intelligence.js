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
  const dimensions = { interest_fit: '兴趣匹配', ability_fit: '能力匹配', transition_cost: '转型成本', time_cost: '时间成本', economic_cost: '经济成本', market_demand: '市场需求', competition: '竞争程度', growth: '长期发展', flexibility: '转向灵活性', lifestyle_fit: '生活方式' };
  const storageKey = 'careerIntelligenceV1';
  const documentKey = 'careerIntelligenceDocumentsV1';
  const message = byId('ciMessage');
  const results = byId('ciResults');
  const dialog = byId('ciTreeDialog');
  let task = 'explore';
  let turn = null;
  let request = null;
  let continuation = null;
  let focusNode = null;
  let activeRoute = '';
  let activation = 0;
  let documents = readArray(documentKey).filter(item => item?.id && typeof item.text === 'string').slice(0, 3);
  let importing = false;
  let treeBridge;
  let treeDraft;
  const selectedRoutes = new Map();

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function status(id, value, error = false) {
    const node = byId(id);
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

  function records() {
    return readArray(storageKey).filter(item => item?.id && (item.note || item.result?.task));
  }

  function writeRecord(record) {
    const previous = records();
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
      if (record.treeHref) add(actions, 'a', '查看职业树', 'ci-link').href = record.treeHref;
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
    for (const record of [turn, ...records()]) {
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
        if (!route.id) return;
        if (input.checked && selectedRoutes.size >= 5) {
          input.checked = false;
          return status('ciStatus', '一次最多比较 5 条路线。', true);
        }
        if (input.checked) selectedRoutes.set(route.id, route);
        else selectedRoutes.delete(route.id);
        status('ciStatus', '');
      });
    }
  }

  function selectTask(next) {
    if (!Object.hasOwn(tasks, next)) next = 'explore';
    if (task !== next) {
      selectedRoutes.clear();
      continuation = null;
    }
    task = next;
    const [, title, help, example] = tasks[task];
    for (const control of byId('ciTasks').children) control.setAttribute('aria-pressed', String(control.dataset.task === task));
    byId('ciTaskTitle').textContent = title;
    byId('ciTaskHelp').textContent = help;
    byId('ciSubmit').textContent = request ? '正在分析…' : title;
    message.placeholder = example;
    renderRouteInput();
  }

  function localData() {
    try { return JSON.parse(localStorage.getItem('careerPredictor')) || {}; }
    catch { return {}; }
  }

  function profileContext(local) {
    const profile = window.CareerProfile?.profile;
    const student = local.studentProfile || {};
    const locations = local.jobSearchPreferences?.location;
    const allowedFields = ['education.stage', 'education.degree', 'education.major', 'education.school', 'experience.text', 'skills.self_report', 'preferences.long_term_goal', 'preferences.city'];
    const fields = Object.fromEntries(allowedFields.filter(key => profile?.fields?.[key]?.value_state === 'known')
      .map(key => {
        const { value, source_type, confirmation_state } = profile.fields[key];
        return [key, { value_state: 'known', value: String(value).slice(0, 2000), source_type, confirmation_state }];
      }));
    if (!fields['experience.text'] && typeof local.experienceText === 'string' && local.experienceText.trim()) {
      fields['experience.text'] = { value_state: 'known', value: local.experienceText.slice(0, 2000), source_type: 'user_text' };
    }
    return {
      consent: true, fields, major: student.major,
      education: { undergraduate: '本科', graduate: '研究生' }[student.education],
      preferences: { employmentChoice: student.employmentChoice, location: locations },
    };
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
    return [...previous, ...saved].filter(item => item.content).slice(-8).map(item => ({ ...item, content: item.content.slice(0, 1400) }));
  }

  async function run({ opportunityMode = false, explicitQuestion } = {}) {
    if (request) return;
    const question = explicitQuestion || message.value.trim();
    if (!question) {
      message.focus();
      return status('ciStatus', '请写下想讨论的问题。', true);
    }
    let routes = ['compare', 'plan', 'growth'].includes(task) ? [...selectedRoutes.values()] : [];
    if (opportunityMode && byId('ciUseHistory').checked) {
      const savedPlan = records().find(record => record.result?.task === 'plan' && record.result.branches?.some(branch => !record.excludedBranches?.includes(branch.id)));
      const branch = savedPlan?.result.branches.find(item => !savedPlan.excludedBranches?.includes(item.id));
      if (branch) routes = [branchContext(`${savedPlan.id}_${branch.id}`, branch)];
    }
    if (task === 'compare' && routes.length === 1) return status('ciStatus', '请再选一条路线，或取消勾选后直接描述两个选项。', true);
    const liveSearch = byId('ciLive').checked;
    const publicSearchQuery = byId('ciPublicQuery').value.trim();
    if (liveSearch && !publicSearchQuery) {
      byId('ciPublicQuery').focus();
      return status('ciStatus', '请填写用于实时检索的公开搜索词。', true);
    }
    const local = localData();
    const history = byId('ciUseHistory').checked ? historyContext(local) : [];
    const clarification = continuation ? [
      ...(continuation.clarification || []),
      { role: 'user', content: continuation.question.slice(0, 1400) },
      { role: 'assistant', content: `${continuation.result.summary}\n${continuation.result.followUpQuestion}`.slice(0, 1400) },
    ].slice(-8) : [];
    history.push(...clarification);
    const researchEnabled = byId('ciResearch').checked || liveSearch;
    const nodeContext = focusNode && { title: focusNode.title, description: focusNode.description, parentTitle: focusNode.parentTitle };
    const body = {
      task, message: question, routes,
      profile: byId('ciUseProfile').checked ? profileContext(local) : undefined,
      history: history.slice(-8), researchEnabled, liveSearch,
      publicSearchQuery: liveSearch ? publicSearchQuery : undefined,
      documents: byId('ciResearch').checked ? documents.filter(item => item.text.trim()).map(({ title, text, kind, locator }) => ({ title, text, kind, locator })) : undefined,
      focusNode: nodeContext || undefined,
      challengeMode: byId('ciChallenge').checked, opportunityMode,
    };
    const submitted = { id: crypto.randomUUID(), question, createdAt: new Date().toISOString(), clarification, routes,
      ...(focusNode ? { treeTarget: { treeId: focusNode.treeId, nodeId: focusNode.nodeId } } : {}),
    };
    const controller = new AbortController();
    request = controller;
    byId('ciSubmit').disabled = true;
    byId('ciSubmit').textContent = '正在分析…';
    status('ciStatus', '正在整理分析，请稍候。');
    try {
      const response = await fetch('/api/journey/career-intelligence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok || !data?.summary || data.task !== body.task) {
        const error = typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw new Error(error || data?.message || '职业规划 AI 暂不可用，请稍后再试。');
      }
      turn = { ...submitted, result: data };
      if (task === body.task) {
        if (!explicitQuestion && message.value.trim() === question) message.value = '';
        continuation = null;
      }
      renderResult(true);
      renderRouteInput();
      status('ciStatus', '分析已生成。');
    } catch (error) {
      if (!controller.signal.aborted) status('ciStatus', error instanceof TypeError ? '连接失败，输入仍保留，可以重试。' : error.message, true);
    } finally {
      if (request === controller) {
        request = null;
        byId('ciSubmit').disabled = false;
        byId('ciSubmit').textContent = tasks[task][1];
      }
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

  function evidenceRefs(parent, ids, evidence) {
    const matched = [...new Set(ids || [])].map(id => evidence.findIndex(source => source.sourceId === id)).filter(index => index >= 0);
    if (!matched.length) return;
    const refs = add(parent, 'span', ' · 依据 ', 'ci-muted');
    for (const index of matched) button(refs, `[${index + 1}] `, () => {
      byId('ciSourceList').open = true;
      const source = byId(`ciSource${index}`);
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
    for (const stage of branch.stages || []) detail(extra, [stages[stage.timeframe], stage.title].filter(Boolean).join(' · '), stage.actions);
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
        renderResult();
        status('ciResultStatus', excluded ? '已恢复此方向。' : '已记录为暂不考虑。');
      } catch { status('ciResultStatus', '当前浏览器无法保存记录。', true); }
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
  }

  function renderSources(parent, evidence, research) {
    const section = add(parent, 'details', '', 'ci-sources');
    section.id = 'ciSourceList';
    add(section, 'summary', `依据与检索状态${evidence.length ? `（${evidence.length}）` : ''}`);
    const researchMessages = Array.isArray(research?.warnings) ? research.warnings : [];
    if (research?.message) add(section, 'p', research.message, 'ci-muted');
    for (const warning of researchMessages) add(section, 'p', warning, 'ci-muted');
    if (!evidence.length) return add(section, 'p', '本次没有可引用的外部来源或文件片段。', 'ci-muted');
    const list = add(section, 'ol');
    for (const [index, source] of evidence.entries()) {
      const item = add(list, 'li');
      item.id = `ciSource${index}`;
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

  function renderResult(focus = false) {
    if (!turn) return;
    const record = turn;
    const { result } = record;
    const evidence = result.evidence || [];
    results.replaceChildren();
    results.hidden = false;
    const header = add(results, 'div', '', 'ci-result-heading');
    const heading = add(header, 'h2', result.status === 'needs_input' ? '还需要确认一件事' : `${tasks[result.task][0]} · 分析结果`);
    heading.tabIndex = -1;
    const actions = add(header, 'div', '', 'ci-result-actions');
    button(actions, '保存分析', () => {
      try { writeRecord(record); status('ciResultStatus', '已保存到我的规划记录。'); }
      catch { status('ciResultStatus', '当前浏览器无法保存分析。', true); }
    }, 'ci-button ci-button-light');
    if (result.branches?.length) button(actions, '选择写入职业树', () => openTreeDialog(record), 'ci-button ci-button-primary');
    if (record.treeHref) add(actions, 'a', '查看职业树节点 ↗', 'ci-button ci-button-light').href = record.treeHref;
    const resultStatus = add(results, 'p', '', 'ci-status');
    resultStatus.id = 'ciResultStatus';
    resultStatus.setAttribute('role', 'status');
    add(results, 'p', record.question, 'ci-muted');
    add(results, 'p', result.summary, 'ci-answer');
    const insights = result.profileInsights || {};
    if (Object.values(insights).some(items => items?.length)) {
      const profile = add(results, 'details', '', 'ci-detail');
      add(profile, 'summary', '画像依据与待确认信息');
      detail(profile, '用户自述', insights.selfReported);
      detail(profile, 'AI 推断', insights.inferred);
      detail(profile, '待确认', insights.missing);
      for (const entry of insights.documented || []) {
        const line = detail(profile, '资料所载', entry.statement);
        if (line) evidenceRefs(line, entry.evidenceIds, evidence);
      }
    }
    if (result.branches?.length) {
      const grid = add(results, 'div', '', 'ci-branches');
      for (const branch of result.branches) renderBranch(grid, branch, record, evidence);
    }
    renderComparison(results, result.comparison, evidence);
    detail(results, '下一步行动', result.nextActions);
    if (result.followUpQuestion) {
      const next = add(results, 'div', '', 'ci-follow-up');
      add(next, 'strong', '继续想一想');
      add(next, 'p', result.followUpQuestion);
      button(next, '回答这个问题', () => {
        selectTask(result.task);
        continuation = record;
        selectedRoutes.clear();
        for (const route of record.routes || []) selectedRoutes.set(route.id, route);
        renderRouteInput();
        message.placeholder = result.followUpQuestion;
        message.focus();
        status('ciStatus', `继续回答：${result.followUpQuestion}`);
      });
    }
    renderSources(results, evidence, result.researchStatus);
    if (focus && byId('step8').classList.contains('active')) heading.focus();
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
      text.addEventListener('input', () => { entry.text = text.value; });
      const controls = add(card, 'div', '', 'ci-inline-actions');
      button(controls, '保存至此浏览器', () => {
        if (!entry.text.trim()) return status('ciStatus', '请先填写要保存的资料内容。', true);
        try {
          const saved = readArray(documentKey).filter(item => item.id !== entry.id);
          if (saved.length >= 3) return status('ciStatus', '已保存 3 份资料。请先移除一份。', true);
          localStorage.setItem(documentKey, JSON.stringify([...saved, entry]));
          status('ciStatus', '已保存这份资料的文字。');
        } catch { status('ciStatus', '当前浏览器无法保存资料。', true); }
      });
      button(controls, '移除', () => {
        try {
          const saved = readArray(documentKey);
          if (saved.some(item => item.id === entry.id)) localStorage.setItem(documentKey, JSON.stringify(saved.filter(item => item.id !== entry.id)));
          documents = documents.filter(item => item.id !== entry.id);
          renderDocuments();
          status('ciStatus', '已移除资料。');
        } catch { status('ciStatus', '当前浏览器无法移除资料。', true); }
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
    importing = true;
    input.disabled = true;
    status('ciStatus', '正在提取文件文字。');
    try {
      const { parseDocumentFile } = await import('/journey/documents.js');
      const failures = [];
      for (const file of files) {
        try {
          const { id, title, text, kind, locator } = await parseDocumentFile(file, progress => status('ciStatus', progress));
          documents.push({ id, title, text, kind, locator });
        } catch (error) { failures.push(`${file.name} · ${error.message}`); }
      }
      renderDocuments();
      status('ciStatus', failures.length ? failures.join('；') : '已提取文件文字。可展开核对，勾选资料检索后用于分析。', failures.length > 0);
    } catch { status('ciStatus', '文件解析暂不可用。可以把相关文字粘贴到问题里。', true); }
    finally {
      importing = false;
      input.disabled = false;
      input.value = '';
    }
  }

  function option(parent, value, label) {
    const element = add(parent, 'option', label);
    element.value = value;
    return element;
  }

  function configureTreeTarget() {
    const tree = treeDraft.trees.find(item => item.id === byId('ciTreeChoice').value);
    const mode = byId('ciTreeMode');
    const canUpdate = Boolean(tree?.nodes.some(node => node.id !== tree.rootNodeId));
    mode.hidden = byId('ciTreeModeLabel').hidden = !canUpdate;
    if (!canUpdate) mode.value = 'add';
    const update = mode.value === 'update';
    const select = byId('ciTreeNode');
    const label = byId('ciTreeNodeLabel');
    select.hidden = label.hidden = !tree;
    label.textContent = update ? '要更新的节点' : '接到哪个节点下';
    select.replaceChildren();
    for (const node of tree?.nodes || []) {
      if (update && node.id === tree.rootNodeId) continue;
      option(select, node.id, node.id === tree.rootNodeId ? `${node.title}（起点）` : node.title);
    }
    if (tree && !update) select.value = tree.rootNodeId;
    for (const { check } of treeDraft.fields) {
      if (update && check.type !== 'radio') check.checked = false;
      check.type = update ? 'radio' : 'checkbox';
    }
    if (update && !treeDraft.fields.some(({ check }) => check.checked)) treeDraft.fields[0].check.checked = true;
    status('ciTreeStatus', update ? '更新会替换节点的名称和说明，改动标为待核实，原有来源仍可查看。' : '确认后会写入所选节点，并保存对应的规划问答。');
  }

  async function openTreeDialog(record) {
    if (dialog.open) return;
    try {
      treeBridge ??= await import('/journey/career-intelligence-tree.js');
      if (dialog.open || !byId('step8').classList.contains('active')) return;
      const trees = treeBridge.listCareerTrees();
      const select = byId('ciTreeChoice');
      select.replaceChildren();
      option(select, '', '创建新的职业树');
      for (const tree of trees) option(select, tree.id, tree.title);
      const target = record.treeTarget;
      if (target && trees.some(tree => tree.id === target.treeId)) select.value = target.treeId;
      byId('ciTreeMode').value = 'add';
      const drafts = byId('ciDrafts');
      drafts.replaceChildren();
      const fields = record.result.branches.map((branch, index) => {
        const card = add(drafts, 'fieldset', '', 'ci-draft');
        const label = add(card, 'label');
        const check = add(label, 'input');
        check.type = 'checkbox';
        check.name = 'ciDraftBranch';
        label.append(document.createTextNode(`采用「${branch.title}」`));
        check.checked = !record.excludedBranches?.includes(branch.id);
        const title = add(card, 'input');
        title.type = 'text';
        title.value = branch.title;
        title.maxLength = 100;
        title.setAttribute('aria-label', `分支 ${index + 1} 名称`);
        const description = add(card, 'textarea');
        description.value = branch.description;
        description.maxLength = 600;
        description.rows = 2;
        description.setAttribute('aria-label', `分支 ${index + 1} 说明`);
        return { branch, check, title, description };
      });
      treeDraft = { record, trees, fields };
      configureTreeTarget();
      if (select.value && target?.nodeId) {
        const node = byId('ciTreeNode');
        if ([...node.options].some(item => item.value === target.nodeId)) node.value = target.nodeId;
      }
      dialog.showModal();
    } catch (error) { status('ciResultStatus', `无法打开职业树：${error.message}`, true); }
  }

  function saveTree(event) {
    event.preventDefault();
    if (!treeDraft) return;
    const selected = treeDraft.fields.filter(({ check }) => check.checked);
    if (!selected.length) return status('ciTreeStatus', '请至少选择一个分支。', true);
    if (selected.some(({ title }) => !title.value.trim())) return status('ciTreeStatus', '请填写所选分支的名称。', true);
    const branches = selected.map(({ branch, title, description }) => ({ ...branch, title: title.value.trim(), description: description.value.trim() }));
    const treeId = byId('ciTreeChoice').value;
    const node = byId('ciTreeNode').value;
    const update = Boolean(treeId && byId('ciTreeMode').value === 'update');
    const { record } = treeDraft;
    try {
      const saved = treeBridge.saveCareerBranches({
        treeId, parentNodeId: treeId && !update ? node : undefined, updateNodeId: update ? node : undefined, branches,
        turnId: record.id, question: record.question, summary: record.result.summary, evidence: record.result.evidence,
      });
      record.treeHref = saved.href;
      record.treeDecision = `我确认${update ? '更新' : '采用'}的路线：${branches.map(branch => branch.title).join('、')}`;
      let savedHistory = true;
      try { writeRecord(record); } catch { savedHistory = false; }
      dialog.close();
      renderResult();
      status('ciResultStatus', savedHistory ? '职业树已更新，规划问答已关联。' : '职业树已更新。当前浏览器无法另外保存完整分析。', !savedHistory);
    } catch (error) { status('ciTreeStatus', error.message, true); }
  }

  function cancelRequest() {
    if (request) {
      request.abort();
      request = null;
      byId('ciSubmit').disabled = false;
      byId('ciSubmit').textContent = tasks[task][1];
      status('ciStatus', '');
    }
  }

  function deactivate() {
    activeRoute = '';
    activation += 1;
    cancelRequest();
  }

  async function activate(detail, position, identifier) {
    const route = [detail, position, identifier].join('/');
    if (route === activeRoute) { renderMemory(); return; }
    activeRoute = route;
    const current = ++activation;
    cancelRequest();
    focusNode = null;
    continuation = null;
    selectedRoutes.clear();
    byId('ciFocusNode').hidden = true;
    renderMemory();
    if (detail === 'turn') {
      const saved = records().find(record => encodeURIComponent(record.id) === position && record.result);
      if (saved) {
        turn = saved;
        selectTask(saved.result.task);
        renderResult(true);
        status('ciStatus', '');
      } else {
        turn = null;
        results.hidden = true;
        status('ciStatus', '此浏览器没有保存这条规划分析。', true);
      }
    } else if (['tree', 'compare-tree'].includes(detail) && position && identifier) {
      const comparing = detail === 'compare-tree';
      selectTask(comparing ? 'compare' : 'explore');
      try {
        treeBridge ??= await import('/journey/career-intelligence-tree.js');
        if (current !== activation || !byId('step8').classList.contains('active')) return;
        const treeId = decodeURIComponent(position);
        const nodeIds = [...new Set(identifier.split(',').map(id => decodeURIComponent(id)))];
        if (comparing ? nodeIds.length < 2 || nodeIds.length > 5 : nodeIds.length !== 1) throw new Error('请选择要使用的职业树节点。');
        const nodes = nodeIds.map(id => ({ id, ...treeBridge.getCareerNodeContext(treeId, id) }));
        if (comparing) {
          for (const [index, node] of nodes.entries()) {
            const id = `tree-route-${index + 1}`;
            selectedRoutes.set(id, { id, title: node.title, description: node.description });
          }
          renderRouteInput();
        } else focusNode = { ...nodes[0], treeId, nodeId: nodes[0].id };
        const section = byId('ciFocusNode');
        section.replaceChildren();
        add(section, 'span', `来自职业树 · ${nodes.map(node => node.title).join('、')}`);
        button(section, '移除', () => {
          window.goToStep(8);
          status('ciStatus', '已移除职业树上下文。');
        });
        section.hidden = false;
        status('ciStatus', '');
        if (!message.value.trim()) message.value = comparing ? '请比较这些职业树节点对应的发展路线，说明主要取舍和能否并行推进。' : '基于这个节点和我的情况，有哪些值得验证的后续方向？';
      } catch (error) { status('ciStatus', error.message, true); }
    } else selectTask(Object.hasOwn(tasks, detail) ? detail : task);
  }

  for (const [key, [label]] of Object.entries(tasks)) {
    const control = button(byId('ciTasks'), label, () => {
      if (task !== key) cancelRequest();
      selectTask(key);
      status('ciStatus', '');
    }, '');
    control.dataset.task = key;
  }
  byId('ciExample').onclick = () => { message.value = tasks[task][3]; message.focus(); };
  byId('ciLive').onchange = event => { byId('ciSearchFields').hidden = !event.currentTarget.checked; };
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
        selectTask('explore');
        continuation = null;
        run({ opportunityMode: true, explicitQuestion: `这是我新增的经历或偏好：${note}\n它会带来哪些可验证的新方向？` });
      }
    } catch { status('ciMemoryStatus', '当前浏览器无法保存记录。', true); }
  });
  byId('ciTreeChoice').onchange = configureTreeTarget;
  byId('ciTreeMode').onchange = configureTreeTarget;
  byId('ciCancelTree').onclick = () => dialog.close();
  byId('ciTreeForm').addEventListener('submit', saveTree);
  dialog.addEventListener('close', () => { treeDraft = null; });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) { renderMemory(); renderRouteInput(); }
  });
  renderDocuments();
  selectTask(task);
  window.CareerIntelligence = { activate, deactivate };
})();
