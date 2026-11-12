const workspaceRoutes = [
  ['home', '', '我的首页'],
  ['direction', 'direction', '方向探索'],
  ['ability', 'ability', '软实力测评'],
  ['ability', 'ability/experience', '硬实力解析'],
  ['jobs', 'jobs', '岗位匹配'],
  ['reports', 'reports', '我的报告'],
  ['history', 'history', '历史记录'],
  ['roadmap', 'roadmap', '我的职业路线'],
  ['intelligence', 'intelligence', '职业规划 AI'],
];
const directionQuestions = ['education', 'major', 'employment', 'choices'];
const directionLabels = ['当前学历', '所学专业', '就业倾向', '选择并排序方向'];
let directionQuestion = 0;
let softTab = 'questionnaire';
let softQuestion = 0;
let workspaceReady = false;

function workspaceHref(step, suffix = '') {
  const path = workspaceRoutes[step][1];
  return '/index.html' + (path ? '#' + path + suffix : '');
}

function activeTaskHref() {
  return '/index.html' + location.hash;
}

function readWorkspaceRoute() {
  return parseWorkspaceHash(location.hash);
}

function parseWorkspaceHash(hash) {
  const [module, detail, position, identifier] = hash.slice(1).split('/');
  if (module === 'ability') return { step: detail === 'experience' ? 3 : 2, detail, position };
  const step = workspaceRoutes.findIndex(([, path]) => path === module);
  return { step: Math.max(0, step), detail, position, identifier };
}

function goToStep(step, suffix = '') {
  const href = workspaceHref(step, suffix);
  if (activeTaskHref() !== href) history.pushState(null, '', href);
  renderWorkspace(readWorkspaceRoute(), true);
}

function renderWorkspace({ step, detail, position, identifier }, focus = false) {
  const record = step === 5 && detail ? getHistoryRecord(detail) : null;
  if (record?.status === 'completed') {
    const working = historyViewReturnData || appData;
    if (!historyViewMode) historyViewReturnData = deepClone(working);
    historyViewMode = true;
    historyViewRecordId = record.id;
    applyHistoryRecord(record, working);
  } else if (historyViewMode) {
    const { knowledgeBase, chatHistory } = appData;
    appData = { ...historyViewReturnData, knowledgeBase, chatHistory };
    historyViewMode = false;
    historyViewRecordId = null;
    historyViewReturnData = null;
  }
  if (currentStep === 8 && step !== 8) window.CareerIntelligence?.deactivate();
  currentStep = step;
  const section = document.getElementById('step' + step);
  document.querySelectorAll('.step-section').forEach(node => {
    node.classList.toggle('active', node === section);
  });
  const [key, , title] = workspaceRoutes[step];
  CareerShell.setPage(key, title, '', focus);
  document.getElementById('careerProfileHost').hidden = ![1, 3, 4].includes(step);

  if (step === 0) renderHomeState();
  if (step === 1) {
    showDirectionQuestion(detail);
    const href = workspaceHref(step, '/' + directionQuestions[directionQuestion]);
    if (!directionQuestions.includes(detail)) history.replaceState(null, '', href);
  }
  if (step === 2) {
    initSoftSkillsStep(detail, position);
    const href = workspaceHref(step, '/' + softTab + (softTab === 'scenario' ? '/' + (softQuestion + 1) : ''));
    if (activeTaskHref() !== href) history.replaceState(null, '', href);
  }
  if (step === 3) initExperienceStep();
  if (step === 4) {
    initJDStep();
    if (detail === 'manual' || detail === 'auto') switchJDMode(detail, false);
    const href = workspaceHref(step, '/' + currentJDMode);
    if (activeTaskHref() !== href) history.replaceState(null, '', href);
  }
  if (step === 5) {
    const hasContent = hasMeaningfulTestData(appData);
    document.getElementById('reportEmpty').hidden = hasContent;
    document.getElementById('reportDetails').hidden = !hasContent;
    if (hasContent) buildReport();
  }
  if (step === 6) renderHistoryList();
  if (step === 7) renderRoadmap();
  if (step === 8) window.CareerIntelligence?.activate(detail, position, identifier);
  updateWorkspaceProgress();
  window.refreshAssistantContext?.();
  CareerShell.animate(section);
  const oldQuestion = step === 2 && detail === 'questionnaire' && position &&
    document.getElementById('soft-question-' + position);
  if (oldQuestion) oldQuestion.scrollIntoView({ block: 'start', behavior: 'instant' });
  else if (focus) window.scrollTo({ top: 0, behavior: 'instant' });
}

function initializeWorkspace() {
  workspaceReady = true;
  renderWorkspace(readWorkspaceRoute());
  window.addEventListener('popstate', () => renderWorkspace(readWorkspaceRoute(), true));
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    historyViewMode = false;
    historyViewReturnData = null;
    loadFromLocalStorage();
    loadHistoryRecords();
    renderWorkspace(readWorkspaceRoute());
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (link.origin !== location.origin || link.pathname !== '/index.html' || link.search || link.target || link.hasAttribute('download')) return;
    event.preventDefault();
    const href = link.pathname + link.hash;
    if (activeTaskHref() !== href) history.pushState(null, '', href);
    renderWorkspace(readWorkspaceRoute(), true);
  });
}

function rememberWorkspaceTask() {
  if (!workspaceReady || historyViewMode || currentStep < 1 || currentStep > 4) return;
  appData.lastStep = currentStep;
  CareerShell.remember(activeTaskHref(), workspaceRoutes[currentStep][2]);
}

function workspaceChanged(area, hadResult = false) {
  if (historyViewMode) return;
  rememberWorkspaceTask();
  if (hadResult) appData.workspaceUpdates[area] = true;
  if (appData.reportGenerated) appData.workspaceUpdates.report = true;
}

function renderHomeState() {
  const previous = CareerShell.recent();
  const localStep = Math.min(5, Math.max(1, appData.lastStep));
  const resume = previous && /^\/(?:index\.html#|start\?|career-prep\.html(?:#|$)|job-search\.html$)/.test(previous.href) ? previous :
    hasMeaningfulTestData(appData) ? { href: workspaceHref(localStep), label: workspaceRoutes[localStep][2] } : null;
  const button = document.getElementById('continueTestButton');
  const taskSummary = document.getElementById('homeTaskStatus');
  const resumeStatus = resume?.href.startsWith('/index.html#')
    ? workspaceStatus(parseWorkspaceHash(resume.href.slice(resume.href.indexOf('#'))).step)
    : '已保存进度';
  taskSummary.hidden = !resume;
  taskSummary.textContent = resume ? resume.label + ' · ' + resumeStatus : '';
  document.getElementById('homeResumeSummary').textContent = resume ? resume.label : '还没有草稿。';
  button.href = resume?.href || workspaceHref(1);
  button.textContent = resume ? '继续任务 →' : '开始方向探索 →';

  const latest = historyRecords.find(item => item.status === 'completed');
  const advice = CareerShell.recentAdvice();
  const reportTime = latest ? Date.parse(latest.updatedAt) : 0;
  const adviceIsLatest = advice?.href?.startsWith('/start?task=') && advice.time >= reportTime;
  const resultLink = document.getElementById('homeRecentLink');
  resultLink.hidden = !(latest || adviceIsLatest);
  if (!resultLink.hidden) resultLink.href = adviceIsLatest ? advice.href : workspaceHref(5, '/' + latest.id);
  document.getElementById('homeRecentSummary').textContent = adviceIsLatest ? advice.label :
    latest ? [latest.summary.firstDirection || '综合报告', formatHistoryDate(latest.updatedAt)].join(' · ') : '还没有生成的建议或报告。';
}

function showDirectionQuestion(detail) {
  const profile = appData.studentProfile;
  const firstMissing = [profile.education, profile.major, profile.employmentChoice].findIndex(value => !value);
  const requested = directionQuestions.indexOf(detail);
  if (requested >= 0 && requested < 3) directionQuestion = requested;
  else if (firstMissing >= 0) directionQuestion = firstMissing;
  else directionQuestion = requested === 3 || !appData.workspaceUpdates.direction ? 3 : 0;
  restoreProfileControls();
  document.getElementById('directionProfile').hidden = directionQuestion === 3;
  document.querySelectorAll('[data-direction-question]').forEach(node => {
    node.hidden = node.dataset.directionQuestion !== directionQuestions[directionQuestion];
  });
  const explorer = document.getElementById('directionExplorer');
  if (directionQuestion === 3 && !appData.workspaceUpdates.direction) {
    currentDirectionPool = buildDirectionPool();
    document.getElementById('directionBasis').textContent = [educationLabel(profile.education), profile.major, employmentChoiceLabel(profile.employmentChoice)].join(' · ');
    explorer.classList.remove('hidden');
    renderDirectionCards();
    renderDirectionRanking();
  } else {
    explorer.classList.add('hidden');
  }
}

function moveDirectionQuestion(delta) {
  if (delta < 0 && directionQuestion === 0) { goToStep(0); return; }
  if (delta > 0) {
    const value = [appData.studentProfile.education, appData.studentProfile.major, appData.studentProfile.employmentChoice][directionQuestion];
    if (directionQuestion < 3 && !value) {
      const status = document.getElementById('profileValidation');
      status.textContent = '请先完成「' + directionLabels[directionQuestion] + '」。';
      status.className = 'text-sm text-red-600 mt-3';
      return;
    }
    if (directionQuestion === 3 && !appData.workspaceUpdates.direction) {
      completeDirectionStep();
      return;
    }
    if (directionQuestion >= 2 && !profileIsComplete()) {
      const profile = appData.studentProfile;
      const missing = [profile.education, profile.major, profile.employmentChoice].findIndex(item => !item);
      goToStep(1, '/' + directionQuestions[missing]);
      document.getElementById('profileValidation').textContent = '请先完成「' + directionLabels[missing] + '」。';
      return;
    }
    if (directionQuestion >= 2 && !generateDirectionOptions(true)) return;
  }
  const next = directionQuestions[Math.min(directionQuestion + delta, 3)];
  goToStep(1, '/' + next);
  rememberWorkspaceTask();
  saveToLocalStorage();
}

function softStage(tab, index = 0) {
  goToStep(2, '/' + tab + (tab === 'scenario' ? '/' + (index + 1) : ''));
}

function moveSoftAssessment(delta) {
  if (softTab === 'result') {
    if (delta < 0) softStage('questionnaire');
    else goToStep(3);
    return;
  }
  if (softTab === 'questionnaire') {
    if (delta < 0) goToStep(0);
    else submitQuestionnaire();
    return;
  }
  const next = softQuestion + delta;
  if (next < 0) { softStage('questionnaire'); return; }
  if (next >= scenarioData.length) { submitScenario(); return; }
  softStage('scenario', next);
  rememberWorkspaceTask();
  saveToLocalStorage();
}

function workspaceStatus(step) {
  const p = appData.studentProfile;
  const answered = Object.keys(appData.questionnaireAnswers).length + Object.keys(appData.scenarioAnswers).length;
  const { direction, soft, hard, jobs, report } = appData.workspaceUpdates;
  if (step === 1 || step === 7) return direction ? '需要更新' : appData.directionRanking.length >= 3 ? '已完成' :
    p.education || p.major || p.employmentChoice || appData.directionRanking.length ? '进行中' : '未开始';
  if (step === 2 || step === 3) return soft || hard ? '需要更新' : appData.mbtiResult && appData.experienceAnalysis ? '已完成' :
    answered || appData.experienceText || appData.mbtiResult ? '进行中' : '未开始';
  if (step === 4) return jobs ? '需要更新' : appData.jdMatchResult || appData.recommendedJobs.length ? '已完成' :
    appData.manualJDText || appData.jobSearchPreferences.location || appData.jobSearchMeta ? '进行中' : '未开始';
  if (step === 5) return historyViewMode ? '已完成' : report ? '需要更新' :
    appData.reportGenerated ? '已完成' : hasMeaningfulTestData(appData) ? '进行中' : '未开始';
  return '';
}

function updateWorkspaceProgress() {
  if (!workspaceReady) return;
  CareerShell.setStatus(workspaceStatus(currentStep));
  const progress = document.querySelector('#step' + currentStep + ' [data-task-progress]');
  if (!progress) return;
  const p = appData.studentProfile;
  if (currentStep === 1) {
    const done = [p.education, p.major, p.employmentChoice, appData.directionRanking.length >= 3 && !appData.workspaceUpdates.direction].filter(Boolean).length;
    progress.textContent = '第 ' + (directionQuestion + 1) + ' / 4 步 · ' + directionLabels[directionQuestion] + ' · 已完成 ' + done + ' 项';
    document.getElementById('directionNext').textContent = directionQuestion === 3 && appData.workspaceUpdates.direction ? '更新方向清单' :
      directionQuestion === 3 ? '保存排序，查看能力画像 →' : directionQuestion === 2 ? '生成方向清单 →' : '继续 →';
  }
  if (currentStep === 2) {
    const scenario = softTab === 'scenario';
    const total = scenario ? scenarioData.length : questionnaireData.length;
    const answered = Object.keys(scenario ? appData.scenarioAnswers : appData.questionnaireAnswers).length;
    progress.hidden = softTab === 'result';
    progress.textContent = scenario ? '第 ' + (softQuestion + 1) + ' / ' + total + ' 题 · 已答 ' + answered + ' 题' :
      '已答 ' + answered + ' / ' + total + ' 题' + (answered < 20 ? ' · 至少作答 20 题' : '');
    document.getElementById('softBack').textContent = softTab === 'questionnaire' ? '返回首页' :
      scenario && softQuestion > 0 ? '上一题' : '返回问卷';
    document.getElementById('softNext').textContent = softTab === 'result' ? '继续解析经历 →' :
      scenario && softQuestion < total - 1 ? '下一题 →' : '查看测评结果 →';
  }
  if (currentStep === 3) progress.textContent = appData.experienceAnalysis ? '已生成技能与经历分析 · 可修改经历重新分析' :
    '第 1 / 2 步 · 填写经历并生成分析';
  if (currentStep === 4) progress.textContent = currentJDMode === 'manual'
    ? (appData.jdMatchResult?.source === 'manual' ? '已生成 JD 分析 · 可查看综合报告' : '第 1 / 2 步 · 粘贴 JD 并开始匹配')
    : (appData.jobSearchMeta ? '已完成搜索 · 查看岗位或搜索指引' : '第 1 / 2 步 · 核对方向与地区，搜索岗位');
}
