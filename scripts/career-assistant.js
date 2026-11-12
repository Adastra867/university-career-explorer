(() => {
  const { shell } = window.CareerShell;
  shell.insertAdjacentHTML('beforeend', `
    <div class="career-assistant-backdrop hidden no-print"></div>
  <aside id="assistantPanel" class="career-assistant hidden no-print" aria-labelledby="assistantTitle">
    <div class="gradient-bg text-white px-5 py-4 flex items-center justify-between flex-shrink-0">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-5 4v-4z"/></svg>
          </span>
          <div><h2 id="assistantTitle" class="font-bold">星轨答疑</h2><p class="text-xs text-white/70">随时了解行业、岗位与求职路径</p></div>
        </div>
      </div>
      <button onclick="closeCareerAssistant()" class="w-9 h-9 rounded-lg hover:bg-white/15 text-2xl leading-none" aria-label="关闭星轨答疑">&times;</button>
    </div>

    <div class="px-4 pt-4 flex-shrink-0">
      <p id="assistantContext" class="text-xs text-slate-500 mb-2"></p>
      <div id="assistantProfile" class="rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm"></div>
      <div class="mt-3">
        <p class="text-xs font-semibold text-slate-500 mb-2">你可以先问</p>
        <div id="suggestedQuestions" class="flex gap-2 overflow-x-auto pb-2"></div>
      </div>
    </div>

    <div id="chatArea" role="log" aria-live="polite" class="assistant-chat-scroll flex-1 space-y-4 px-4 py-3">
      <div class="flex justify-start">
        <div class="chat-bubble chat-bot">
          <p>你好！我可以帮你比较本专业与跨专业就业，也可以解释不同岗位的日常工作、校招要求和入门准备。</p>
          <p class="mt-2 text-xs text-slate-400">告诉我一个专业、行业或岗位名称，我们从具体问题开始。</p>
        </div>
      </div>
    </div>

    <details class="mx-4 mb-3 rounded-xl border border-slate-200 bg-white flex-shrink-0">
      <summary class="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-500">查看或补充就业知识库</summary>
      <div class="px-4 pb-4 max-h-64 overflow-y-auto">
        <button onclick="toggleKBPanel()" class="text-xs text-primary-600 hover:underline mb-2">+ 添加自己的资料</button>
        <div id="kbPanel" class="hidden mb-3">
          <input type="text" id="kbTitle" placeholder="知识标题（如：数据分析师校招要求）" class="mb-2">
          <textarea id="kbContent" rows="3" placeholder="粘贴课程笔记、招聘信息或访谈内容..." class="mb-2"></textarea>
          <input type="text" id="kbTags" placeholder="标签（逗号分隔，如：数据分析,校招,岗位）" class="mb-2">
          <input type="text" id="kbSource" placeholder="来源（如：企业招聘宣讲会）" class="mb-2">
          <button onclick="addKnowledge()" class="btn-primary text-xs py-2 px-3">添加到知识库</button>
        </div>
        <div id="kbList" class="space-y-2"></div>
      </div>
    </details>

    <div class="border-t border-slate-200 bg-white p-4 flex-shrink-0">
      <div class="flex gap-2">
        <input type="text" id="chatInput" aria-label="向星轨答疑提问" placeholder="例如：产品运营每天具体做什么？" class="flex-1" onkeydown="if(event.key==='Enter')sendChat()">
        <button onclick="sendChat()" class="btn-primary py-2 px-5">发送</button>
      </div>
      <p class="text-[11px] text-slate-400 mt-2">回答基于内置知识库，仅作方向探索参考，请结合最新招聘信息核实。</p>
    </div>
  </aside>

`);
  const panel = document.getElementById('assistantPanel');
  const backdrop = shell.querySelector('.career-assistant-backdrop');
  const trigger = document.getElementById('floatingAssistant');
  let externalData;

  function readSharedData() {
    try { return JSON.parse(localStorage.getItem('careerPredictor')) || {}; } catch { return {}; }
  }

  function data() {
    if (typeof appData !== 'undefined') return appData;
    const profile = (window.CareerProfile?.profile || window.CareerIntakeProfile)?.fields || {};
    const student = externalData.studentProfile || {};
    const major = profile['education.major'];
    const degree = profile['education.degree'];
    return Object.assign(externalData, {
      studentProfile: {
        ...student,
        ...(major?.value_state === 'known' ? { major: major.value } : {}),
        ...(degree?.value_state === 'known' ? { education: /硕士|博士|研究生/.test(degree.value) ? 'graduate' : 'undergraduate' } : {}),
      },
      chatHistory: Array.isArray(externalData.chatHistory) ? externalData.chatHistory : [],
      knowledgeBase: Array.isArray(externalData.knowledgeBase) ? externalData.knowledgeBase : [],
    });
  }

  function saveAssistantData() {
    if (typeof saveToLocalStorage === 'function') return saveToLocalStorage();
    const { chatHistory, knowledgeBase } = data();
    try {
      localStorage.setItem('careerPredictor', JSON.stringify({ ...readSharedData(), chatHistory, knowledgeBase }));
    } catch {}
  }

  function directions() {
    if (typeof allDirectionItems === 'function') return allDirectionItems();
    return (Array.isArray(externalData.directionSnapshots) ? externalData.directionSnapshots : [])
      .filter(item => typeof item?.direction === 'string' && typeof item.route === 'string' && Array.isArray(item.jobs) && Array.isArray(item.skills));
  }

  const defaultKB = [
    { id:'kb1', title:'本专业就业还是跨专业就业', content:'不要只问“专业有没有前途”，而要比较两条具体路径。各选2个本专业岗位和2个跨专业岗位，从工作内容、校招门槛、已有证据、补课成本、地域与生活方式五项打分。专业对口不等于只能做一个岗位，跨专业也不等于从零开始；课程项目、研究方法、写作、数据和沟通能力都可能迁移。先用岗位访谈、小项目或实习体验验证，再决定主投方向。', tags:['本专业','跨专业','专业对口','就业方向','选择','迷茫'], source:'大学生职业探索方法库' },
    { id:'kb2', title:'本科生与研究生求职重点有什么不同', content:'本科生通常更适合优先建立可展示的实践证据，如实习、课程项目、竞赛和作品集，并关注校招中的助理、初级与执行型岗位。研究生除实践外，还可以突出研究方法、专业深度、论文课题和复杂问题分析能力，关注研发、研究、算法、专业分析等岗位。学历不是唯一标准，最终仍要回到具体JD逐条核对。', tags:['本科','本科生','研究生','学历','校招','求职准备'], source:'高校就业指导资料整理' },
    { id:'kb3', title:'产品、运营岗位的日常与就业去向', content:'产品岗位常做需求调研、方案设计、原型与跨团队推进，常见于互联网、软件服务、智能硬件和数字化部门；校招会看逻辑、用户意识、项目经历与表达。运营岗位常做内容、用户、活动或平台规则，通过数据复盘提升增长和留存，常见于互联网、电商、消费与文化传媒。两个方向都对专业相对开放，但需要用项目证明理解业务和推动落地。', tags:['产品经理','产品','运营','产品运营','用户运营','就业情形','岗位日常'], source:'校招岗位画像库' },
    { id:'kb4', title:'数据分析岗位的日常与入门门槛', content:'数据分析师通常负责取数、清洗、指标分析、可视化和业务建议，常见于互联网、金融、咨询、零售、制造等行业。本科生可从Excel、SQL、统计基础和一个完整业务分析项目开始；研究生还可突出建模、研究设计和复杂数据处理。判断岗位时要分清业务分析、数据开发和算法岗位，它们的技术门槛并不相同。', tags:['数据分析','商业分析','SQL','就业情形','岗位日常','跨专业'], source:'校招岗位画像库' },
    { id:'kb5', title:'市场、人力、客户成功等通用岗位怎么选', content:'市场岗位关注用户与品牌，常做调研、活动和内容传播；人力岗位围绕招聘、培训、员工关系与组织支持；客户成功连接产品与客户，负责使用落地、续约和问题协调。这些岗位分布在多数行业，对专业限制通常较少，但分别更看重洞察表达、沟通组织、服务意识与业务理解。选择时应同时看行业，因为同一岗位在科技、快消和制造企业中的工作方式会不同。', tags:['市场','品牌','人力资源','招聘','客户成功','通用岗位','跨专业'], source:'校招岗位画像库' },
    { id:'kb6', title:'如何判断一个行业或岗位的就业情况', content:'不要只看“热门”标签。建议收集20条目标岗位JD，记录招聘数量、常见城市、学历专业要求、技能高频词、实习要求与起薪区间；再比较至少3类雇主和2个招聘渠道。向学长学姐确认真实工作内容与流动方向。用连续两到四周的信息样本看趋势，避免被单条高薪招聘或短期新闻误导。', tags:['就业前景','就业情况','行业','岗位','招聘','JD','调研'], source:'职业信息调研方法库' },
    { id:'kb7', title:'两周低成本体验一个岗位', content:'第1至2天读10条JD并整理高频任务；第3至5天看从业者访谈并约一位学长学姐做20分钟信息访谈；第6至10天完成一个最小项目，如产品分析、运营方案、数据看板或行业研究简报；第11至14天请从业者反馈并复盘自己是否喜欢日常任务。体验的目标不是做得完美，而是获得继续或排除该方向的证据。', tags:['体验岗位','职业探索','信息访谈','项目','两周','迷茫'], source:'大学生职业探索方法库' },
    { id:'kb8', title:'没有相关实习如何开始跨专业求职', content:'先把目标岗位拆成3到5项核心任务，再盘点课程、社团、科研和兼职中可迁移的证据。缺少证据的部分，用课程项目、校园真实问题或公开数据完成一个可展示的小项目。简历要解释“为什么转向、已有何种证据、正在补什么”，并优先申请实习、助理和校招初级岗位。跨专业不是广撒网，而是围绕少数目标岗位持续积累同一组证据。', tags:['没有实习','跨专业','项目','简历','入门','校招'], source:'大学生求职行动指南' }
  ];

  function educationLabel(value) {
    return value === 'graduate' ? '研究生' : value === 'undergraduate' ? '本科生' : '未选择学历';
  }

  function employmentChoiceLabel(value) {
    return value === 'same' ? '倾向本专业就业' : value === 'cross' ? '倾向跨专业就业' : value === 'unsure' ? '本专业或跨专业尚不清楚' : '未选择就业倾向';
  }

  function profileIsComplete() {
    var p = data().studentProfile || {};
    return Boolean(p.education && p.major && p.employmentChoice);
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function toggleKBPanel() { document.getElementById('kbPanel').classList.toggle('hidden'); }

  function addKnowledge() {
    var t = document.getElementById('kbTitle').value.trim();
    var c = document.getElementById('kbContent').value.trim();
    var tg = document.getElementById('kbTags').value.split(',').map(function(x){return x.trim();}).filter(Boolean);
    var sr = document.getElementById('kbSource').value.trim();
    if (!t || !c) { alert('请填写标题和内容'); return; }
    data().knowledgeBase.push({ id:'kb_'+Date.now(), title:t, content:c, tags:tg, source: sr||'用户自定义' });
    saveAssistantData(); renderKBList();
    ['kbTitle','kbContent','kbTags','kbSource'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('kbPanel').classList.add('hidden');
  }

  function renderKBList() {
    var all = defaultKB.concat(data().knowledgeBase);
    var list = document.getElementById('kbList');
    if (!list) return;
    list.innerHTML = all.map(function(kb) {
      return '<div class="flex items-center justify-between p-2 rounded-lg bg-warm-50 hover:bg-primary-50 transition">' +
        '<div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">' + esc(kb.title) + '</p>' +
        '<div class="flex gap-1 mt-1 flex-wrap">' + kb.tags.map(function(t){return '<span class="tag tag-primary text-xs">'+esc(t)+'</span>';}).join('') + '</div></div>' +
        '<span class="text-xs text-slate-400 ml-2 flex-shrink-0">' + esc(kb.source) + '</span></div>';
    }).join('');
  }

  /* ============================================
     CHAT / RAG SIMULATION
     ============================================ */
  const mobile = matchMedia('(max-width: 1120px)');
  let previousFocus;

  function refreshAssistantContext() {
    document.getElementById('assistantContext').textContent = '当前页面 · ' + document.getElementById('careerPageTitle').textContent;
    renderAssistantProfile();
    renderSuggestedQuestions();
  }

  function applyDrawerMode() {
    if (panel.classList.contains('hidden')) return;
    panel.setAttribute('role', mobile.matches ? 'dialog' : 'complementary');
    panel.toggleAttribute('aria-modal', mobile.matches);
    if (mobile.matches) panel.setAttribute('aria-modal', 'true');
    backdrop.classList.toggle('hidden', !mobile.matches);
    shell.querySelector('.career-body').inert = mobile.matches;
    shell.querySelector('.career-nav').inert = mobile.matches;
    document.body.classList.toggle('career-drawer-open', mobile.matches);
  }

  function openCareerAssistant(prefillQuestion) {
    if (panel.classList.contains('hidden')) previousFocus = document.activeElement;
    externalData = readSharedData();
    panel.classList.remove('hidden');
    shell.classList.add('career-assistant-open');
    trigger.setAttribute('aria-expanded', 'true');
    applyDrawerMode();
    refreshAssistantContext();
    renderKBList();
    renderChatHistory();
    const input = document.getElementById('chatInput');
    if (prefillQuestion) {
      input.value = prefillQuestion;
      sendChat();
    }
    input.focus({ preventScroll: true });
  }

  function closeCareerAssistant() {
    panel.classList.add('hidden');
    backdrop.classList.add('hidden');
    shell.classList.remove('career-assistant-open');
    shell.querySelector('.career-body').inert = false;
    shell.querySelector('.career-nav').inert = false;
    document.body.classList.remove('career-drawer-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (previousFocus instanceof HTMLElement && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
  }

  function goToProfileFromAssistant() {
    closeCareerAssistant();
    if (typeof goToStep === 'function') goToStep(1);
    else location.href = '/index.html#direction';
  }

  function renderAssistantProfile() {
    var el = document.getElementById('assistantProfile');
    if (!el) return;
    var p = data().studentProfile || {};
    if (profileIsComplete()) {
      el.innerHTML = '<div class="flex items-start justify-between gap-3"><div><p class="text-xs font-semibold text-primary-600 mb-1">回答将参考你的求职画像</p><p class="text-slate-700">' + esc(educationLabel(p.education)) + ' · ' + esc(p.major) + ' · ' + esc(employmentChoiceLabel(p.employmentChoice)) + '</p></div><button onclick="goToProfileFromAssistant()" class="text-xs text-primary-600 hover:underline flex-shrink-0">修改</button></div>';
    } else {
      el.innerHTML = '<div class="flex items-start justify-between gap-3"><div><p class="text-xs font-semibold text-amber-600 mb-1">尚未填写基本信息</p><p class="text-slate-600">仍可直接提问；填写学历、专业与就业倾向后，回答会更有针对性。</p></div><button onclick="goToProfileFromAssistant()" class="text-xs text-primary-600 hover:underline flex-shrink-0">去填写</button></div>';
    }
  }

  function renderSuggestedQuestions() {
    var container = document.getElementById('suggestedQuestions');
    if (!container) return;
    var choice = (data().studentProfile || {}).employmentChoice;
    var questions = [];
    if (choice === 'same') {
      questions = ['我的专业常见就业方向有哪些？','如何判断我是否适合本专业就业？','本专业岗位对本科和研究生的要求有何不同？'];
    } else if (choice === 'cross') {
      questions = ['哪些跨专业岗位对大学生更友好？','跨专业求职需要补哪些能力？','没有相关实习，怎样做第一个岗位项目？'];
    } else if (choice === 'unsure') {
      questions = ['如何比较本专业和跨专业就业？','怎样低成本体验一个岗位？','该按兴趣、能力还是就业机会选方向？'];
    } else {
      questions = ['如何找到适合自己的就业方向？','本专业还是跨专业，该怎么判断？','怎样了解一个岗位的真实工作？'];
    }
    var top = data().directionRanking && data().directionRanking.length ? directions().find(item => item.id === data().directionRanking[0]) : null;
    if (top) questions.unshift(top.direction + '的日常工作和校招要求是什么？');
    container.innerHTML = questions.slice(0, 4).map(function(q) {
      return '<button data-question="' + esc(q) + '" onclick="askQuestion(this.dataset.question)" class="whitespace-nowrap rounded-full bg-white border border-primary-100 px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50">' + esc(q) + '</button>';
    }).join('');
  }

  function renderChatHistory() {
    var area = document.getElementById('chatArea');
    if (!area) return;
    var welcome = '<div class="flex justify-start"><div class="chat-bubble chat-bot"><p>你好！我可以帮你比较本专业与跨专业就业，也可以解释不同岗位的日常工作、校招要求和入门准备。</p><p class="mt-2 text-xs text-slate-400">告诉我一个专业、行业或岗位名称，我们从具体问题开始。</p></div></div>';
    area.innerHTML = welcome + data().chatHistory.map(function(item) {
      if (item.role === 'user') return '<div class="flex justify-end"><div class="chat-bubble chat-user">' + esc(item.content) + '</div></div>';
      return '<div class="flex justify-start"><div class="chat-bubble chat-bot">' + item.content + '</div></div>';
    }).join('');
    area.scrollTop = area.scrollHeight;
  }

  function askQuestion(q) { document.getElementById('chatInput').value = q; sendChat(); }

  function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    data().chatHistory.push({ role: 'user', content: message }, { role: 'bot', content: generateRAGResponse(message) });
    saveAssistantData();
    renderChatHistory();
  }

  function generateRAGResponse(query) {
    var all = defaultKB.concat(data().knowledgeBase);
    var qLower = query.toLowerCase();
    var mentionedDirection = directions().find(function(item) {
      return qLower.includes(item.direction.toLowerCase()) || item.jobs.some(function(job){ return qLower.includes(job.toLowerCase()); });
    });
    var p = data().studentProfile || {};
    var profileNote = profileIsComplete() ? '<div class="rounded-lg bg-primary-50 p-2.5 text-xs text-primary-700 mb-2">结合你的情况：' + esc(educationLabel(p.education)) + ' · ' + esc(p.major) + ' · ' + esc(employmentChoiceLabel(p.employmentChoice)) + '</div>' : '';
    if (mentionedDirection) {
      var workSummary = getDirectionWorkSummary(mentionedDirection);
      var majorLimit = mentionedDirection.route.indexOf('跨专业') >= 0 ? '通常更看重能力证据而非唯一专业背景，但仍要逐条核对具体JD。' : '专业背景通常能形成起点优势，但课程成绩不能替代项目、实习或作品证据。';
      return profileNote + '<p>你问到的方向是 <strong>' + esc(mentionedDirection.industry + '｜' + mentionedDirection.direction) + '</strong>。</p>' +
        '<p class="mt-2"><strong>日常工作：</strong>' + esc(workSummary) + '</p>' +
        '<p class="mt-2"><strong>常见岗位：</strong>' + esc(mentionedDirection.jobs.join('、')) + '</p>' +
        '<p class="mt-2"><strong>校招入门：</strong>重点准备 ' + esc(mentionedDirection.skills.join('、')) + '，并用至少一个可讲清过程与结果的项目证明。</p>' +
        '<p class="mt-2"><strong>专业限制：</strong>' + esc(majorLimit) + '</p>' +
        '<p class="mt-2"><strong>就业去向：</strong>可优先查看 ' + esc(mentionedDirection.industry) + ' 中的校招、实习与助理岗位，比较不同企业对同一岗位的要求。</p>' +
        '<div class="knowledge-source"><strong>下一步：</strong>收集 10 条真实JD，找 1 位学长学姐做信息访谈，再完成一个两周最小项目。</div>';
    }
    var contextTerms = profileIsComplete() ? ' ' + p.major + ' ' + employmentChoiceLabel(p.employmentChoice) + ' ' + educationLabel(p.education) : '';
    var searchText = qLower + contextTerms.toLowerCase();
    var scores = all.map(function(kb) {
      var score = 0;
      kb.tags.forEach(function(kw) { if (searchText.includes(kw.toLowerCase())) score += 5; });
      if (searchText.includes(kb.title.toLowerCase())) score += 8;
      kb.content.split('').forEach(function(ch, i) {
        if (i < kb.content.length - 1) {
          var bigram = kb.content.substring(i, i+2);
          if (qLower.includes(bigram)) score += 0.2;
        }
      });
      return { kb: kb, score: score };
    });
    scores.sort(function(a,b){ return b.score - a.score; });
    var topMatch = scores[0];
    var empathy = '';
    if (qLower.includes('迷茫') || qLower.includes('不知道')) empathy = '我理解你现在的感受，迷茫其实是自我探索的开始，说明你在认真思考自己的未来。';
    else if (qLower.includes('焦虑') || qLower.includes('紧张') || qLower.includes('害怕')) empathy = '你的感受完全可以理解，面对未知的紧张是人类的本能反应，重要的是学会和它相处。';
    else if (qLower.includes('失败') || qLower.includes('受挫')) empathy = '遇到挫折确实让人沮丧，但每一次经历都是成长的养分，你已经迈出了很重要的一步。';
    else if (qLower.includes('跨专业')) empathy = '跨专业求职并不等于从零开始，关键是找到可迁移能力并补足目标岗位所需的证据。';
    else if (qLower.includes('简历') || qLower.includes('求职')) empathy = '求职阶段确实需要很多准备工作，但好的准备会让你事半功倍。';
    else empathy = '感谢你的提问，这是一个很好的问题。';

    if (topMatch && topMatch.score > 2) {
      var kb = topMatch.kb;
      return profileNote + '<p>' + empathy + '</p>' +
        '<p class="mt-2 font-medium">根据知识库的分析：</p>' +
        '<p class="mt-1">' + esc(kb.content) + '</p>' +
        '<div class="knowledge-source"><strong>参考来源：</strong>' + esc(kb.title) + ' - ' + esc(kb.source) + '</div>' +
        '<p class="mt-2 text-xs text-slate-400">以上用于方向探索。具体专业限制、招聘数量和城市分布，请以近期真实JD与学校就业信息为准。</p>';
    }
    return profileNote + '<p>' + empathy + '</p>' +
      '<p class="mt-2">关于你的问题，知识库中暂无直接匹配的内容，但我可以提供一些通用建议：</p>' +
      '<p class="mt-1">1. 把问题改写成一个具体行业或岗位；<br>2. 收集至少 10 条校招JD，记录高频任务和门槛；<br>3. 找一位学长学姐做 20 分钟信息访谈；<br>4. 用一到两周做一个最小项目，记录喜欢与不喜欢的任务。</p>' +
      '<p class="mt-2 text-xs text-slate-400">你也可以直接问“某岗位每天做什么”或“本专业与跨专业如何比较”。</p>';
  }

  function getDirectionWorkSummary(item) {
    var text = item.direction + item.jobs.join('');
    if (/软件|算法|嵌入式|硬件/.test(text)) return '围绕需求进行开发、调试、测试和技术协作，持续阅读文档并解决具体问题。';
    if (/产品|用户研究/.test(text)) return '调研用户与业务需求，整理方案或原型，协调设计和研发推进，并根据反馈迭代。';
    if (/运营/.test(text)) return '策划并执行内容、用户或活动方案，跟踪关键数据，复盘并优化增长与留存。';
    if (/数据|商业|经营|分析/.test(text)) return '整理数据与业务问题，完成指标分析、可视化和报告，将发现转化为可执行建议。';
    if (/市场|品牌|传播|公关/.test(text)) return '开展市场调研、内容传播与活动执行，协同渠道并评估传播和转化效果。';
    if (/研发|实验|临床|检测/.test(text)) return '按照专业规范开展实验、研究或检测，记录与分析结果，并输出可追溯的报告。';
    if (/设计|视觉|体验|视频/.test(text)) return '理解目标用户与场景，产出设计方案或内容资产，接受反馈并持续迭代作品。';
    if (/人力|招聘/.test(text)) return '支持招聘、培训或员工服务，维护流程与信息，并与候选人和业务团队沟通。';
    if (/客户|商务|外贸/.test(text)) return '理解客户需求，推进方案、交付或合作流程，维护关系并跟进业务结果。';
    return '围绕专业任务进行资料分析、项目协作、方案执行与结果复盘，具体职责会随行业和企业而变化。';
  }


  window.openCareerAssistant = openCareerAssistant;
  window.closeCareerAssistant = closeCareerAssistant;
  window.goToProfileFromAssistant = goToProfileFromAssistant;
  window.toggleKBPanel = toggleKBPanel;
  window.addKnowledge = addKnowledge;
  window.askQuestion = askQuestion;
  window.sendChat = sendChat;
  window.refreshAssistantContext = () => {
    if (!panel.classList.contains('hidden')) refreshAssistantContext();
  };
  trigger.addEventListener('click', () => panel.classList.contains('hidden') ? openCareerAssistant() : closeCareerAssistant());
  backdrop.addEventListener('click', closeCareerAssistant);
  mobile.addEventListener('change', applyDrawerMode);
  window.addEventListener('career-profile-updated', window.refreshAssistantContext);
  document.addEventListener('keydown', event => {
    if (panel.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeCareerAssistant();
    if (event.key !== 'Tab' || !mobile.matches) return;
    const items = [...panel.querySelectorAll('button, input, textarea, summary')].filter(item => item.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
