import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJourneyRouter } from '../journey/server.js';
import { launchBrowser } from './browser-runtime.mjs';

// Isolated production page/router/provider with a controlled model HTTP endpoint.
// This test never reads credentials or calls the existing localhost service.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT_KEY = 'careerChatSessionsV1';
const RECORD_KEY = 'careerIntelligenceV1';
const dimensions = ['interest_fit', 'ability_fit', 'transition_cost', 'time_cost', 'economic_cost', 'market_demand', 'competition', 'growth', 'flexibility', 'lifestyle_fit'];
const fixtureLabel = '受控 HTTP 模型测试';
const calls = [];
const providerCalls = [];
const errors = [];
const checks = [];
const servers = [];
let mode = 'normal';
let heldRequest;
let resolveArrival;
let browser;
let context;
let page;
let origin;
let fixtureProfile = null;
let fixtureConnectionStatus = 'not_connected';

function branch(title, type, evidenceIds = []) {
  return {
    title, type, description: '通过可展示的小项目，验证这一方向。',
    reason: '已有仿真经历可以作为起点。', advantages: ['仿真项目经历'], skillGaps: ['统计验证'],
    risks: ['具体岗位要求待核实'], nextActions: ['完成一个公开数据复现项目'],
    verification: '请从业者反馈项目结果。', timeCost: '先投入两周试做', economicCost: '可先使用公开数据',
    opportunityCost: '占用其他方向的准备时间', flexibility: '数据分析方法可迁移', confidence: 'medium',
    stages: [], evidenceIds,
  };
}

function fixtureResult(task, input) {
  const personalSource = input.evidence?.find(source => source.category === 'user_document');
  const evidenceIds = personalSource ? [personalSource.sourceId] : [];
  const result = {
    status: 'ready', summary: `${fixtureLabel}：可以先通过小项目验证兴趣和能力。`,
    profileInsights: { selfReported: [], inferred: [], missing: [] }, branches: [], comparison: [],
    nextActions: ['与一位从业者做信息访谈'], followUpQuestion: '你更喜欢产业实践还是学术研究？',
  };
  if (task === 'explore') result.branches = [
    branch('电池仿真工程', 'steady', evidenceIds), branch('电池数字孪生', 'advanced'), branch('材料信息学', 'cross_field'),
  ];
  if (task === 'plan') result.branches = [{
    ...branch('电池数字孪生', 'advanced', evidenceIds), goal: '做出可展示的预测作品', startingPoint: '有仿真项目经历',
    knowledge: ['电池建模'], credentials: ['目标岗位学历要求待核实'], practice: ['完成公开数据复现'],
    stages: ['near', 'mid', 'long'].map(timeframe => ({ timeframe, title: '积累项目证据', actions: ['记录项目与验证结果', '根据反馈修订下一阶段任务'] })),
  }];
  if (task === 'compare') {
    const routes = input.routes?.length ? input.routes : [{ id: '', title: '先就业' }, { id: '', title: '读研' }];
    result.comparison = routes.map(route => ({
      routeId: route.id, routeTitle: route.title, tradeoff: '前期投入时间与未来转向成本需要结合个人约束。',
      dimensions: dimensions.map(dimension => ({ dimension, assessment: '需结合本人偏好和实践证据核实。', evidenceIds: [] })),
    }));
  }
  if (mode === 'routine-question') {
    return { ...result, profileField: 'education.stage', followUpQuestion: '你目前处于哪个学习或求职阶段？' };
  }
  if (mode === 'profile-question') {
    const field = 'education.major';
    const major = input.profile.find(fact => fact.field === field);
    const question = input.availableProfileQuestions[field];
    if (!major && question) {
      return { ...result, status: 'ready', summary: '先整理一项做过的项目，并用实际任务检验可迁移能力。之后可以结合专业进一步调整。',
        nextActions: ['整理一个项目的任务、产出和反馈'], profileField: field, followUpQuestion: question };
    }
    result.summary = major ? `参考你的专业（${major.value}），可以先探索三个方向。` : '可以先从感兴趣的项目开始。';
    result.followUpQuestion = '';
  }
  return result;
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function reply(res, value) {
  if (res.destroyed) return;
  res.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
}

async function setup() {
  const provider = express();
  provider.use(express.json({ limit: '2mb' }));
  provider.post('/chat/completions', async (req, res) => {
    const input = JSON.parse(req.body.messages.at(-1).content);
    const task = calls.at(-1).task;
    providerCalls.push({ input, task });
    if (mode === 'hold') {
      await new Promise(resolve => {
        heldRequest = resolve;
        resolveArrival?.();
      });
    }
    if (mode === 'failure') return res.status(503).json({ error: 'Controlled upstream failure' });
    reply(res, fixtureResult(task, input));
  });
  const providerOrigin = await listen(provider);
  const app = express();
  app.use('/api', express.json({ limit: '256kb' }));
  app.use('/api/journey', express.json({ limit: '256kb' }), (req, _res, next) => {
    if (req.path === '/career-intelligence') calls.push(structuredClone(req.body));
    next();
  });
  app.use('/api/journey', createJourneyRouter({
    env: { JOURNEY_AI_PROVIDER: 'openai-compatible', JOURNEY_AI_API_KEY: 'controlled-http-fixture', JOURNEY_AI_MODEL: 'fixture-model', JOURNEY_AI_BASE_URL: providerOrigin },
    rateLimitMs: 0, maxRetries: 0, timeoutMs: 20000,
    logger: () => {},
    resolveCareerProfile: () => fixtureProfile ? {
      authenticated:true, status:'connected', profile:structuredClone(fixtureProfile), source:'sqlite',
      consent:fixtureProfile.ai_profile_consent?.granted === true,
    } : { authenticated:false, status:fixtureConnectionStatus, profile:null, consent:false, source:'sqlite' },
  }));
  app.get('/api/me/profile', (_req, res) => {
    if (fixtureProfile) res.json(fixtureProfile);
    else res.status(401).json({ error: { code: fixtureConnectionStatus === 'session_expired' ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED', message: 'No fixture cloud profile' } });
  });
  app.post('/api/guest-session', (req,res) => {
    assert.equal(req.body.existing_only, true);
    if (!fixtureProfile) return res.status(401).json({error:{code:'UNAUTHENTICATED'}});
    res.json({csrf_token:'controlled-fixture-csrf',profile:fixtureProfile});
  });
  app.post('/api/me/profile/ai-consent', (req,res) => {
    assert.equal(req.headers['x-csrf-token'],'controlled-fixture-csrf');
    assert.equal(req.body.notice_version,'career-ai-profile-v1');
    fixtureProfile.ai_profile_consent={granted:req.body.consent,notice_version:req.body.notice_version,updated_at:new Date().toISOString()};
    res.json(fixtureProfile);
  });
  app.use('/p0', express.static(resolve(ROOT, 'p0/public')));
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(resolve(ROOT, 'index.html')));
  app.get('/start', (_req, res) => res.sendFile(resolve(ROOT, 'p0/public/start.html')));
  app.get(['/trees', '/trees/:id'], (_req, res) => res.sendFile(resolve(ROOT, 'journey/index.html')));
  app.use(express.static(ROOT));
  origin = await listen(app);
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'zh-CN' });
  context.setDefaultTimeout(10000);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(`${origin}/index.html#intelligence`);
  await page.locator('#ciWelcome').waitFor({ state: 'visible' });
}

async function test(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function send(question, target = page) {
  const count = calls.length;
  await target.locator('#ciMessage').fill(question);
  await target.locator('#ciSubmit').click();
  await target.waitForFunction(() => document.getElementById('ciStop').hidden);
  assert.equal(calls.length, count + 1);
  return calls.at(-1);
}

async function sessionData() {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), CHAT_KEY);
}

async function openSettings() {
  const details = page.locator('#ciContext');
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
}

async function closeSettings() {
  await page.locator('#ciContext').evaluate(element => { element.open = false; });
}

async function authorizeProfile(target, includeLegacy = false) {
  await target.locator('#ciProfileUse').click();
  await target.locator('#ciProfileConsentDialog').waitFor({ state:'visible' });
  if (includeLegacy) await target.locator('#ciConsentIncludeLocal').check();
  await target.locator('#ciProfileConsentAccept').click();
  await target.locator('#ciProfileConsentDialog').waitFor({ state:'hidden' });
  await target.waitForFunction(() => document.getElementById('ciUseProfile').checked);
}

try {
  await setup();

  await test('welcome cards prepare a prompt and blank Enter cannot send', async () => {
    const count = calls.length;
    await page.locator('#ciMessage').focus();
    await page.keyboard.press('Enter');
    assert.equal(calls.length, count);
    await page.locator('#ciSuggestions [data-ci-prompt="explore"]').click();
    assert.ok((await page.locator('#ciMessage').inputValue()).trim());
    assert.equal(calls.length, count);
  });

  let firstSessionId;
  let firstSessionHash;
  await test('ordinary follow-ups replay the same conversation while legacy records remain opt-in', async () => {
    const seed = [{ id: 'legacy-audit-turn', treeHref: '/trees/legacy-audit-tree', question: '旧规划里有一段禁止默认引用的原文', createdAt: new Date().toISOString(), result: {
      ...fixtureResult('profile', {}), task: 'profile', evidence: [],
    } }];
    await page.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key: RECORD_KEY, seed });
    const first = await send('我是能源专业本科生，有电池仿真实习经历，对 AI 感兴趣。请探索发展方向。');
    assert.deepEqual(first.history, []);
    assert.equal(first.profile, undefined);
    assert.equal(first.researchEnabled, false);
    const second = await send('我更希望留在上海，先积累产业实践。');
    assert.ok(second.history.some(message => message.role === 'user' && message.content.includes('电池仿真')));
    assert.ok(second.history.some(message => message.role === 'assistant' && message.content.includes(fixtureLabel)));
    assert.doesNotMatch(JSON.stringify(second), /禁止默认引用/);
    const saved = await sessionData();
    assert.equal(saved.sessions.length, 1);
    assert.equal(saved.sessions[0].messages.filter(message => message.role === 'user').length, 2);
    assert.equal(saved.sessions[0].messages.filter(message => message.role === 'assistant' && message.status === 'completed').length, 2);
    firstSessionId = saved.sessions[0].id;
    firstSessionHash = `#intelligence/chat/${encodeURIComponent(firstSessionId)}`;
    assert.equal(new URL(page.url()).hash, firstSessionHash);
  });

  await test('session drafts and source options restore independently after switching and refresh', async () => {
    await openSettings();
    await page.locator('#ciChallenge').check();
    await page.locator('#ciUseHistory').check();
    await page.locator('#ciLive').check();
    await page.locator('#ciPublicQuery').fill('电池研发 校招');
    await page.locator('#ciLive').uncheck();
    await closeSettings();
    await page.locator('#ciMessage').fill('第一条会话的未发送草稿');
    await page.locator('#ciNewChat').click();
    assert.equal(await page.locator('#ciMessage').inputValue(), '');
    await openSettings();
    assert.equal(await page.locator('#ciChallenge').isChecked(), false);
    assert.equal(await page.locator('#ciUseHistory').isChecked(), false);
    await closeSettings();
    await send('我是语言专业学生，希望梳理个人画像。');
    await page.locator('#ciMessage').fill('第二条会话的未发送草稿');
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    assert.equal(await page.locator('#ciMessage').inputValue(), '第一条会话的未发送草稿');
    await openSettings();
    assert.equal(await page.locator('#ciChallenge').isChecked(), true);
    assert.equal(await page.locator('#ciUseHistory').isChecked(), true);
    assert.equal(await page.locator('#ciPublicQuery').inputValue(), '电池研发 校招');
    await closeSettings();
    await page.reload();
    await page.locator('#ciMessage').waitFor();
    assert.equal(await page.locator('#ciMessage').inputValue(), '第一条会话的未发送草稿');
    assert.equal((await sessionData()).sessions.length, 2);
    const call = await send('请继续，给我一个近期行动。');
    assert.match(JSON.stringify(call.history), /禁止默认引用/);
    assert.doesNotMatch(JSON.stringify(call.history), /语言专业学生/);
    await openSettings();
    await page.locator('#ciUseHistory').uncheck();
    await closeSettings();
  });

  await test('stop retains the question and regenerating preserves prior messages', async () => {
    mode = 'hold';
    const arrival = new Promise(resolve => { resolveArrival = resolve; });
    await page.locator('#ciMessage').fill('请帮我检验是否适合材料科研。');
    await page.locator('#ciSubmit').click();
    await arrival;
    await page.locator('#ciStop').waitFor({ state: 'visible' });
    await page.locator('#ciStop').click();
    const before = await sessionData();
    const stopped = before.sessions.find(session => session.id === firstSessionId);
    assert.ok(stopped.messages.some(message => ['stopped', 'cancelled', 'interrupted'].includes(message.status)));
    mode = 'normal';
    heldRequest?.();
    const currentQuestion = calls.at(-1).message;
    const previousCount = stopped.messages.length;
    await page.getByRole('button', { name: '重试', exact: true }).last().click();
    await page.waitForFunction(() => document.getElementById('ciStop').hidden);
    assert.equal(calls.at(-1).message, currentQuestion);
    const after = (await sessionData()).sessions.find(session => session.id === firstSessionId);
    assert.ok(after.messages.length >= previousCount);
    assert.ok(after.messages.some(message => message.role === 'assistant' && message.status === 'completed'));
    const completedCount = after.messages.filter(message => message.role === 'assistant' && message.status === 'completed').length;
    await page.getByRole('button', { name: '重新生成', exact: true }).last().click();
    await page.waitForFunction(() => document.getElementById('ciStop').hidden);
    assert.equal(calls.at(-1).message, currentQuestion);
    const regenerated = (await sessionData()).sessions.find(session => session.id === firstSessionId);
    assert.equal(regenerated.messages.filter(message => message.role === 'assistant' && message.status === 'completed').length, completedCount + 1);
  });

  await test('session search, rename and deletion act on the selected conversation', async () => {
    const first = page.locator('#ciSessions .ci-session.is-active');
    await first.locator('summary').click();
    page.once('dialog', dialog => dialog.accept('电池方向持续对话'));
    await first.getByRole('button', { name: '重命名', exact: true }).click();
    assert.equal(await page.locator('#ciChatTitle').textContent(), '电池方向持续对话');
    await page.locator('#ciSessionSearch').fill('语言专业');
    assert.equal(await page.locator('#ciSessions .ci-session').count(), 1);
    const second = page.locator('#ciSessions .ci-session');
    await second.locator('.ci-session-open').click();
    assert.equal(await page.locator('#ciMessage').inputValue(), '第二条会话的未发送草稿');
    await second.locator('summary').click();
    page.once('dialog', dialog => dialog.accept());
    await second.getByRole('button', { name: '删除', exact: true }).click();
    assert.equal((await sessionData()).sessions.length, 1);
    await page.locator('#ciSessionSearch').fill('');
    await page.locator('#ciSessions .ci-session-open').click();
    assert.equal(new URL(page.url()).hash, firstSessionHash);
    assert.equal(await page.locator('#ciChatTitle').textContent(), '电池方向持续对话');
  });

  await test('a model failure preserves the question and retry does not duplicate its user message', async () => {
    mode = 'failure';
    const question = '请重新梳理我的科研选择。';
    await send(question);
    const failed = (await sessionData()).sessions.find(session => session.id === firstSessionId);
    assert.equal(failed.messages.at(-1).status, 'failed');
    assert.equal(failed.messages.filter(message => message.role === 'user' && message.content === question).length, 1);
    mode = 'normal';
    await page.getByRole('button', { name: '重试', exact: true }).last().click();
    await page.waitForFunction(() => document.getElementById('ciStop').hidden);
    assert.equal(calls.at(-1).message, question);
    const recovered = (await sessionData()).sessions.find(session => session.id === firstSessionId);
    assert.equal(recovered.messages.at(-1).status, 'completed');
    assert.equal(recovered.messages.filter(message => message.role === 'user' && message.content === question).length, 1);
    assert.ok(recovered.messages.some(message => message.status === 'failed'));
  });

  let savedAnswerId;
  await test('planning answers and saved records have no career tree actions', async () => {
    await page.goto(`${origin}/index.html#intelligence/turn/legacy-audit-turn`);
    await page.locator('#ciMessages').getByText('旧规划里有一段禁止默认引用的原文', { exact: true }).waitFor();
    assert.equal(await page.locator('#step8 a[href^="/trees"]').count(), 0);
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    const save = page.getByRole('button', { name: '保存为规划记录', exact: true }).first();
    await save.click();
    savedAnswerId = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0].id, RECORD_KEY);
    assert.equal(await page.locator('#step8').getByRole('button', { name: /职业树/ }).count(), 0);
    assert.equal(await page.locator('#ciTreeDialog').count(), 0);
  });

  await test('quota failures retain the existing session bytes and unsent text', async () => {
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    const before = await page.evaluate(key => localStorage.getItem(key), CHAT_KEY);
    const count = calls.length;
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      window.restoreChatStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Controlled quota failure', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }, CHAT_KEY);
    const draft = '即使保存失败，也必须保留我的问题。';
    await page.locator('#ciMessage').fill(draft);
    await page.locator('#ciSubmit').click();
    assert.equal(calls.length, count);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), CHAT_KEY), before);
    assert.equal(await page.locator('#ciStatus').getAttribute('data-error'), 'true');
    assert.match(await page.locator('#ciStatus').textContent(), /保存|存储|导出|复制/);
    const input = await page.locator('#ciMessage').inputValue();
    assert.ok(input === draft || (await page.locator('#ciMessages').textContent()).includes(draft));
    await page.evaluate(() => window.restoreChatStorage());
  });

  await test('an upload stays with its original session and file text is sent only when authorized', async () => {
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = function () {
        if (this.name !== 'slow-project.txt') return original.call(this);
        return new Promise(resolve => { window.releaseAuditFile = async () => resolve(await original.call(this)); });
      };
    });
    await page.locator('#ciFile').setInputFiles({ name: 'slow-project.txt', mimeType: 'text/plain', buffer: Buffer.from('电池材料仿真项目和统计检查的资料原文') });
    await page.waitForFunction(() => typeof window.releaseAuditFile === 'function');
    await page.locator('#ciNewChat').click();
    const nextHash = new URL(page.url()).hash;
    await page.evaluate(() => window.releaseAuditFile());
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).sessions.find(session => session.id === id).attachments.length === 1, { key: CHAT_KEY, id: firstSessionId });
    assert.equal(await page.locator('#ciDocuments .ci-document').count(), 0);
    assert.equal(new URL(page.url()).hash, nextHash);
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    await page.locator('#ciDocuments summary').getByText('slow-project.txt', { exact: true }).waitFor();
    const noFiles = await send('请继续梳理我接下来的行动。');
    assert.equal(noFiles.documents, undefined);
    await openSettings();
    await page.locator('#ciResearch').check();
    await closeSettings();
    const withFiles = await send('我想探索材料方向的新可能。');
    assert.equal(withFiles.documents.length, 1);
    assert.equal(withFiles.documents[0].text, '电池材料仿真项目和统计检查的资料原文');
    const saved = await sessionData();
    const evidence = saved.sessions.find(session => session.id === firstSessionId).messages
      .flatMap(message => message.metadata?.record?.result?.evidence || []).filter(source => source.origin === 'user_document');
    assert.ok(evidence.length);
    assert.ok(evidence.every(source => source.excerpt === ''));
  });

  await test('older records stay available with consent after the current conversation grows', async () => {
    const note = '合成长远目标：愿意投入两年探索材料研究';
    await page.evaluate(({ key, note }) => {
      const previous = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify([{ id: 'old-goal-audit', note, createdAt: new Date().toISOString() }, ...previous]));
    }, { key: RECORD_KEY, note });
    await openSettings();
    await page.locator('#ciUseHistory').check();
    await closeSettings();
    const request = await send('请结合我的长期目标调整近期行动。');
    assert.ok(request.history.some(message => message.content.includes(note)));
    assert.ok(request.history.some(message => message.content.includes('材料方向的新可能')));
    assert.ok(request.history.length <= 8);
    await openSettings();
    await page.locator('#ciUseHistory').uncheck();
    await closeSettings();
  });

  await test('a saved answer link focuses its original answer in an existing conversation', async () => {
    const id = savedAnswerId;
    await page.goto(`${origin}/index.html#intelligence/turn/${encodeURIComponent(id)}`);
    await page.waitForFunction(id => document.activeElement?.id === `ciTurn-${id}`, id);
    assert.equal(await page.locator('#ciChatTitle').textContent(), '电池方向持续对话');
  });

  await test('mobile conversations have a usable composer and no horizontal page overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    await page.locator('#ciMessage').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    const composer = await page.locator('#ciForm').boundingBox();
    assert.ok(composer && composer.x >= 0 && composer.x + composer.width <= 391);
    const mainNav = page.getByRole('navigation', { name: '主导航' });
    await mainNav.waitFor({ state: 'visible' });
    const bottomNav = await mainNav.boundingBox();
    assert.ok(composer.y + composer.height <= bottomNav.y, 'The composer stays above the shared mobile navigation');
    await page.locator('#ciSidebarToggle').click();
    await page.locator('#ciNewChat').waitFor({ state: 'visible' });
    await page.locator('#ciSidebarClose').click();
    await page.locator('#ciMessage').fill('手机端的草稿');
    await page.keyboard.press('Shift+Enter');
    assert.match(await page.locator('#ciMessage').inputValue(), /\n/);
  });

  await test('AI, Sprint and profile keep the shared navigation, style and conversation draft', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/index.html${firstSessionHash}`);
    const mainNav = page.getByRole('navigation', { name: '主导航' });
    await mainNav.waitFor({ state: 'visible' });
    assert.equal(await mainNav.count(), 1);
    const planning = mainNav.getByRole('group', { name: '职业规划', exact: true }).first();
    for (const key of ['intelligence', 'sprint', 'profile']) {
      assert.ok(await planning.locator(`[data-career-nav="${key}"]`).isVisible());
    }
    const style = selector => page.locator(selector).evaluate(element => {
      const css = getComputedStyle(element);
      return { font: css.fontFamily, size: css.fontSize, radius: css.borderRadius, background: css.backgroundImage };
    });
    const buttonStyle = await style('#ciNewChat');
    const draft = '切换到简历和统一资料后，继续完善这条职业规划。';
    await page.locator('#ciMessage').fill(draft);
    await mainNav.locator('[data-career-nav="sprint"]:visible').click();
    await page.locator('#sprintNext').waitFor({ state: 'visible' });
    assert.deepEqual(await style('#sprintNext'), buttonStyle);
    await mainNav.locator('[data-career-nav="profile"]:visible').click();
    await page.locator('#consentBtn').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#careerPageTitle').innerText(), '统一资料与提交');
    assert.ok(await mainNav.locator('[data-career-nav="profile"][aria-current="page"]:visible').isVisible());
    assert.deepEqual(await style('#consentBtn'), buttonStyle);
    await mainNav.locator('[data-career-nav="home"]').click();
    await page.locator('#step0.active').waitFor();
    await page.goBack();
    await page.locator('#consentBtn').waitFor({ state: 'visible' });
    await page.goBack();
    await page.locator('#sprintNext').waitFor({ state: 'visible' });
    await page.goBack();
    await page.locator('#ciMessage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ciMessage').inputValue(), draft);
    await page.reload();
    await mainNav.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ciMessage').inputValue(), draft);
    assert.ok(await mainNav.locator('[data-career-nav="intelligence"][aria-current="page"]:visible').isVisible());
  });

  await test('a missing conversation link cannot send into the previously open conversation', async () => {
    const before = (await sessionData()).sessions.find(session => session.id === firstSessionId).messages.length;
    await page.goto(`${origin}/index.html#intelligence/chat/nonexistent-audit-session`);
    await page.locator('#ciWelcome').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).hash, '#intelligence');
    await send('我是新来的学生，想梳理个人画像。');
    const after = await sessionData();
    assert.equal(after.sessions.find(session => session.id === firstSessionId).messages.length, before);
    assert.notEqual(new URL(page.url()).hash, firstSessionHash);
  });

  await test('quota failure after generation reports the unsaved answer and can recover it', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const quotaPage = await isolated.newPage();
      quotaPage.on('pageerror', error => errors.push(error.stack || error.message));
      await quotaPage.goto(`${origin}/index.html#intelligence`);
      mode = 'hold';
      const arrival = new Promise(resolve => { resolveArrival = resolve; });
      await quotaPage.locator('#ciMessage').fill('我想探索材料科研的发展方向。');
      await quotaPage.locator('#ciSubmit').click();
      await arrival;
      await quotaPage.evaluate(key => {
        const original = Storage.prototype.setItem;
        window.restoreChatStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException('Controlled answer quota failure', 'QuotaExceededError');
          return original.call(this, name, value);
        };
      }, CHAT_KEY);
      mode = 'normal';
      heldRequest();
      await quotaPage.waitForFunction(() => document.getElementById('ciStop').hidden);
      assert.equal(await quotaPage.locator('#ciStatus').getAttribute('data-error'), 'true');
      assert.match(await quotaPage.locator('#ciStatus').textContent(), /保存|存储|记录|复制/);
      assert.match(await quotaPage.locator('#ciMessages').textContent(), new RegExp(fixtureLabel));
      await quotaPage.evaluate(() => window.restoreChatStorage());
      await quotaPage.locator('#ciMessage').fill('恢复后还能继续规划');
      await quotaPage.waitForFunction(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1).status === 'completed', CHAT_KEY);
    } finally {
      mode = 'normal';
      heldRequest?.();
      await isolated.close();
    }
  });

  await test('corrupt chat storage blocks overwrites and leaves the question available', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await isolated.addInitScript(key => localStorage.setItem(key, '{controlled-corrupt-chat'), CHAT_KEY);
      const corruptPage = await isolated.newPage();
      corruptPage.on('pageerror', error => errors.push(error.stack || error.message));
      await corruptPage.goto(`${origin}/index.html#intelligence`);
      await corruptPage.locator('#ciMessage').fill('记录损坏时仍需保留我的问题');
      const count = calls.length;
      await corruptPage.locator('#ciSubmit').click();
      assert.equal(calls.length, count);
      assert.equal(await corruptPage.evaluate(key => localStorage.getItem(key), CHAT_KEY), '{controlled-corrupt-chat');
      assert.equal(await corruptPage.locator('#ciMessage').inputValue(), '记录损坏时仍需保留我的问题');
      assert.match(await corruptPage.locator('#ciStatus').textContent(), /记录|读取|保留|损坏/);
    } finally { await isolated.close(); }
  });

  await test('a missing personal field can be answered after refresh, reused in new chats, corrected, cleared, or skipped', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    isolated.setDefaultTimeout(10000);
    mode = 'profile-question';
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      const field = 'education.major';
      const question = '你学的是什么专业？';
      const skip = chat.locator('#ciSkipProfileReply');
      const major = () => providerCalls.at(-1).input.profile.find(fact => fact.field === field)?.value;

      await send('请帮我探索发展方向。给出建议后，请问我一个可选问题。', chat);
      await chat.locator('#ciMessages').getByText(question, { exact: true }).waitFor();
      await chat.reload();
      await skip.waitFor({ state: 'visible' });
      await send('地质工程', chat);
      assert.equal(major(), undefined);
      assert.equal(await chat.evaluate(() => window.CareerProfile.readFields()['education.major'].value), '地质工程');
      assert.equal(await skip.isVisible(), false);
      await authorizeProfile(chat);

      async function newChat() {
        await chat.locator('#ciNewChat').click();
        const request = await send('想按我的专业梳理发展方向。给出建议后，请问我一个可选问题。', chat);
        assert.deepEqual(request.history, []);
      }
      async function changeMajor(value) {
        await chat.locator('#ciShowProfile').click();
        await chat.locator('#ciProfileField').selectOption(field);
        await chat.locator('#ciProfileValue').fill(value);
        await chat.locator('#ciProfileSave').click();
        await chat.waitForFunction(({ field, value }) =>
          (window.CareerProfile.readFields()[field]?.value ?? '') === value, { field, value });
        await chat.reload();
      }

      await newChat();
      assert.equal(major(), '地质工程');
      assert.equal(await chat.locator('#ciMessages').getByText(question, { exact: true }).count(), 0);
      await changeMajor('地球物理学');
      await newChat();
      assert.equal(major(), '地球物理学');
      assert.doesNotMatch(JSON.stringify(providerCalls.at(-1).input.profile), /地质工程/);
      await changeMajor('');
      await newChat();
      assert.equal(major(), undefined);
      await skip.click();
      await send('我想先看看不同的选项。', chat);
      assert.equal(major(), undefined);
      await chat.reload();
      await newChat();
      assert.equal(major(), undefined);
      await skip.waitFor({ state: 'visible' });
    } finally { mode = 'normal'; await isolated.close(); }
  });

  await test('an existing profile can be reused from a follow-up without re-entering the value', async () => {
    const isolated = await browser.newContext();
    mode = 'profile-question';
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await isolated.addInitScript(() => localStorage.setItem('careerPredictor', JSON.stringify({ studentProfile: { major: '材料工程' } })));
      const chat = await isolated.newPage();
      await chat.goto(`${origin}/index.html#intelligence`);
      await chat.getByRole('button', { name: '参考已保存的个人资料' }).waitFor();
      const first = await send('按专业推荐实践项目。给出建议后，请问我一个可选问题。', chat);
      assert.equal(first.profile, undefined);
      const count = calls.length;
      await chat.getByRole('button', { name: '参考已保存的资料继续' }).click();
      await chat.locator('#ciProfileConsentDialog').waitFor({ state:'visible' });
      await chat.locator('#ciConsentIncludeLocal').check();
      await chat.locator('#ciProfileConsentAccept').click();
      await chat.waitForFunction(expected => document.getElementById('ciStop').hidden &&
        document.querySelectorAll('#ciMessages .ci-message-assistant').length >= expected, 2);
      assert.equal(calls.length, count+1);
      await chat.waitForFunction(() => document.getElementById('ciStop').hidden);
      assert.equal(providerCalls.at(-1).input.profile.find(fact => fact.field === 'education.major')?.value, '材料工程');
    } finally { mode = 'normal'; await isolated.close(); }
  });

  await test('a natural Chinese study-or-work question selects comparison and returns two freeform routes', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      const request = await send('我应该读研还是直接就业？', chat);
      assert.equal(request.task, 'compare');
      assert.deepEqual(request.routes, []);
      assert.equal(request.profile, undefined);
      const result = await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1).metadata.record.result, CHAT_KEY);
      assert.equal(result.status, 'ready');
      assert.deepEqual(result.comparison.map(route => route.routeTitle), ['先就业', '读研']);
      assert.ok(await chat.locator('#ciMessages .ci-comparison').isVisible());
      assert.equal(await chat.locator('dialog[open]').count(), 0);
    } finally { await isolated.close(); }
  });

  await test('an empty-profile three-year planning message produces every stage without a form', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      const request = await send('帮我制定未来三年的成长路线。', chat);
      assert.equal(request.task, 'plan');
      assert.equal(request.profile, undefined);
      assert.deepEqual(request.history, []);
      const result = await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1).metadata.record.result, CHAT_KEY);
      assert.equal(result.status, 'ready');
      assert.equal(result.branches.length, 1);
      assert.equal(result.branches[0].planningHorizon, 'three_year');
      assert.deepEqual(result.branches[0].stages.map(stage => stage.timeframe), ['near', 'mid', 'long']);
      assert.deepEqual(result.branches[0].stages.map(stage => stage.timeHorizon), ['0–3 个月', '3–12 个月', '1–3 年']);
      assert.ok(result.branches[0].stages.every(stage => stage.actions.length >= 2));
      assert.ok(result.firstAction);
      assert.equal(await chat.locator('dialog[open]').count(), 0);
    } finally { await isolated.close(); }
  });

  await test('an optional shared-profile save failure still sends the answer to the model', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    mode = 'profile-question';
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      await send('请帮我探索发展方向。给出建议后，请问我一个可选问题。', chat);
      await chat.locator('#ciSkipProfileReply').waitFor({ state: 'visible' });
      await chat.evaluate(() => {
        window.CareerProfile.saveField = async () => { throw new Error('Controlled optional profile save failure'); };
      });
      const count = providerCalls.length;
      const request = await send('能源与动力工程', chat);
      assert.equal(providerCalls.length, count + 1);
      assert.equal(request.message, '能源与动力工程');
      assert.equal(providerCalls.at(-1).input.message, '能源与动力工程');
      const last = await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1), CHAT_KEY);
      assert.equal(last.status, 'completed');
      assert.ok(last.metadata.record.result.nextActions.length);
      assert.match(await chat.locator('#ciStatus').textContent(), /资料暂未保存.*本次仍会/);
      assert.equal(await chat.locator('dialog[open]').count(), 0);
    } finally { mode = 'normal'; await isolated.close(); }
  });

  await test('ordinary planning suppresses a model-generated routine profile question without losing the plan', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    mode = 'routine-question';
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      const request = await send('请结合个人画像制定成长路线。', chat);
      assert.equal(request.task, 'plan');
      assert.deepEqual(providerCalls.at(-1).input.availableProfileQuestions, {});
      const result = await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1).metadata.record.result, CHAT_KEY);
      assert.equal(result.status, 'ready');
      assert.equal(result.followUpQuestion, '');
      assert.equal(result.profileField, '');
      assert.equal(result.branches[0].stages.length, 3);
      assert.equal(await chat.locator('#ciMessages').getByText('你目前处于哪个学习或求职阶段？', { exact: true }).count(), 0);
      assert.equal(await chat.locator('#ciProfileReply').isVisible(), false);
      assert.equal(await chat.locator('dialog[open]').count(), 0);
    } finally { mode = 'normal'; await isolated.close(); }
  });

  await test('a new planning instruction cannot become the answer to an older optional profile question', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    mode = 'profile-question';
    try {
      await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(`${origin}/index.html#intelligence`);
      await send('请帮我探索发展方向。给出建议后，请问我一个可选问题。', chat);
      await chat.locator('#ciSkipProfileReply').waitFor({ state: 'visible' });
      await chat.evaluate(() => {
        const original = window.CareerProfile.saveField.bind(window.CareerProfile);
        window.auditProfileSaves = [];
        window.CareerProfile.saveField = async (...args) => {
          window.auditProfileSaves.push(args);
          return original(...args);
        };
      });
      const instruction = '不要再问我，帮我制定未来三年的成长路线。';
      const request = await send(instruction, chat);
      assert.equal(request.task, 'plan');
      assert.equal(request.message, instruction);
      assert.deepEqual(await chat.evaluate(() => window.auditProfileSaves), []);
      assert.equal(await chat.evaluate(() => window.CareerProfile.readFields()['education.major']?.value), undefined);
      const last = await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].messages.at(-1), CHAT_KEY);
      assert.equal(last.status, 'completed');
      assert.equal(last.metadata.record.result.status, 'ready');
      assert.equal(last.metadata.record.result.branches[0].stages.length, 3);
      assert.equal(last.metadata.record.result.followUpQuestion, '');
      assert.equal(await chat.locator('#ciProfileReply').isVisible(), false);
      assert.equal(await chat.locator('dialog[open]').count(), 0);
    } finally { mode = 'normal'; await isolated.close(); }
  });

  await test('an authorized SQLite profile waits for the delayed load and sends long experience without a frontend profile copy', async () => {
    const isolated = await browser.newContext({ viewport:{width:1280,height:900} });
    const profileRead = Promise.withResolvers();
    await isolated.route('**/api/me/profile', async route => {
      await profileRead.promise;
      await route.continue();
    }, { times: 1 });
    const field = value => ({value,value_state:'known',source_type:'user_form',confirmation_state:'corrected'});
    const experience = '项目：能源系统建模。' + '负责仿真参数核对和实验数据整理。'.repeat(170) + '最终交付三组优化方案并完成不确定性分析。';
    fixtureProfile = {profile_revision:1,fields:{'education.stage':field('大三'),'education.major':field('可持续能源'),
      'experience.text':field(experience),'skills.self_report':field('MATLAB、Python、建模分析'),
      'preferences.long_term_goal':field('能源技术与 AI 交叉方向')},
      ai_profile_consent:{granted:true,notice_version:'career-ai-profile-v1'}};
    try {
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(origin+'/index.html#intelligence');
      await chat.locator('#ciProfileConnectionTitle').filter({ hasText: /^正在读取个人资料…$/ }).waitFor();
      const count=calls.length;
      await chat.locator('#ciMessage').fill('结合个人经历，制定近期、中期和远期成长路线。');
      await chat.locator('#ciSubmit').click();
      await chat.locator('#ciStatus').filter({ hasText: /^正在读取已保存资料…$/ }).waitFor();
      await chat.waitForTimeout(150);
      assert.equal(calls.length,count,'The AI request must wait for the profile load');
      profileRead.resolve();
      await chat.waitForFunction(()=>document.getElementById('ciStop').hidden);
      const sent=calls.at(-1);
      assert.equal(calls.length,count+1);
      assert.equal(sent.profile,undefined);
      assert.deepEqual(sent.profileUsage,{enabled:true,localConsent:false});
      const actual=providerCalls.at(-1).input.profile;
      assert.equal(actual.find(fact=>fact.field==='education.major').value,'可持续能源');
      assert.ok(actual.some(fact=>String(fact.value).includes('最终交付三组优化方案')));
      assert.ok(actual.find(fact=>fact.field==='experience.text').value.length>2000);
      await chat.locator('.ci-profile-diagnostics summary').click();
      assert.match(await chat.locator('.ci-profile-diagnostics').innerText(),/统一资料数据库/);
      assert.match(await chat.locator('.ci-profile-diagnostics').innerText(),/资料已随本次请求发送给 AI/);
      await chat.locator('#ciProfileUse').click();
      const without=await send('这次只给一个通用成长建议。',chat);
      assert.equal(without.profileUsage.enabled,false);
      assert.deepEqual(providerCalls.at(-1).input.profile,[]);
      assert.equal(fixtureProfile.fields['education.major'].value,'可持续能源');
      await chat.locator('#ciProfileUse').click();
      await chat.reload();
      await chat.waitForFunction(()=>document.getElementById('ciUseProfile').checked);
      assert.equal(await chat.locator('#ciProfileConsentDialog').isVisible(),false);
      mode='failure';
      await send('结合个人经历再次给出下一步。',chat);
      const failed=chat.locator('#ciMessages .ci-message-assistant').last();
      await failed.locator('.ci-profile-diagnostics summary').click();
      assert.match(await failed.locator('.ci-profile-diagnostics').innerText(),/已尝试携带资料发送，尚未收到模型响应/);
      assert.doesNotMatch(await failed.locator('.ci-profile-diagnostics').innerText(),/本次未发送个人资料/);
    } finally {
      profileRead.resolve();
      fixtureProfile=null; mode='normal';
      await isolated.close();
    }
  });

  await test('storage consent alone cannot authorize AI, and first AI consent persists without creating a guest', async () => {
    const isolated=await browser.newContext();
    const field=value=>({value,value_state:'known',source_type:'user_form',confirmation_state:'corrected'});
    fixtureProfile={profile_revision:1,fields:{'education.major':field('可持续能源'),'experience.text':field('负责风光储系统的 MATLAB 参数辨识。')}};
    try {
      const chat=await isolated.newPage();
      chat.on('pageerror',error=>errors.push(error.stack||error.message));
      await chat.goto(origin+'/index.html#intelligence');
      await chat.waitForFunction(()=>window.CareerProfile.state==='connected');
      assert.equal(await chat.locator('#ciUseProfile').isChecked(),false);
      const basic=await send('先给我一些职业探索建议。',chat);
      assert.equal(basic.profileUsage.enabled,false);
      assert.deepEqual(providerCalls.at(-1).input.profile,[]);
      await authorizeProfile(chat);
      assert.equal(fixtureProfile.ai_profile_consent.granted,true);
      const authorized=await send('结合已有经历再细化建议。',chat);
      assert.equal(authorized.profile,undefined);
      assert.equal(authorized.profileUsage.enabled,true);
      assert.equal(providerCalls.at(-1).input.profile.find(fact=>fact.field==='education.major').value,'可持续能源');
      await chat.reload();
      await chat.waitForFunction(()=>document.getElementById('ciUseProfile').checked);
      assert.equal(await chat.locator('#ciProfileConsentDialog').isVisible(),false);
    } finally {
      fixtureProfile=null;
      await isolated.close();
    }
  });

  await test('expired SQLite identity stays visible even when authorized browser data is usable', async () => {
    const isolated=await browser.newContext();
    fixtureConnectionStatus='session_expired';
    try {
      await isolated.addInitScript(() => {
        localStorage.setItem('careerP0Notice','p0-v1');
        localStorage.setItem('careerAIProfileConsentV1',JSON.stringify({granted:true,notice_version:'career-ai-profile-v1',includeLegacy:false}));
      });
      const chat=await isolated.newPage();
      chat.on('pageerror',error=>errors.push(error.stack||error.message));
      await chat.goto(origin+'/index.html#intelligence');
      await chat.waitForFunction(()=>window.CareerProfile.state==='session_expired');
      await send('请先给我一份初步成长路线。',chat);
      let details=chat.locator('#ciMessages .ci-message-assistant').last().locator('.ci-profile-diagnostics');
      await details.locator('summary').click();
      assert.match(await details.innerText(),/访客身份已失效/);
      assert.doesNotMatch(await details.innerText(),/当前资料库没有可用资料/);
      await chat.evaluate(()=>localStorage.setItem('careerPersonalField:education.major',JSON.stringify({value:'能源工程',cloud:false})));
      await send('请结合我获准使用的本机专业资料细化行动。',chat);
      details=chat.locator('#ciMessages .ci-message-assistant').last().locator('.ci-profile-diagnostics');
      await details.locator('summary').click();
      const diagnostic=await details.innerText();
      assert.match(diagnostic,/已成功读取个人资料/);
      assert.match(diagnostic,/统一资料连接 · 访客身份已失效/);
      assert.match(diagnostic,/获准的本浏览器资料/);
      assert.equal(providerCalls.at(-1).input.profile.find(fact=>fact.field==='education.major').value,'能源工程');
    } finally {
      fixtureConnectionStatus='not_connected';
      await isolated.close();
    }
  });

  await test('signed-in chat, notes and documents never load the guest or another account workspace', async () => {
    const isolated = await browser.newContext();
    const profileRead = Promise.withResolvers();
    const ids = ['student-fixture-alpha', 'student-fixture-beta'];
    const profile = id => ({ account: { id, username: id }, profile_revision: 0, fields: {} });
    fixtureProfile = profile(ids[0]);
    try {
      await isolated.addInitScript(({ ids, chatKey, recordKey }) => {
        if (localStorage.getItem('account-data-fixture')) return;
        localStorage.setItem('account-data-fixture', 'seeded');
        localStorage.setItem('careerP0AccountActive', 'yes');
        for (const [owner, label] of [[null, '访客私有'], [ids[0], '账号甲私有'], [ids[1], '账号乙私有']]) {
          const key = name => owner ? `careerAIAccount:${owner}:${name}` : name;
          const at = '2026-11-18T10:00:00.000Z';
          localStorage.setItem(key(chatKey), JSON.stringify({ version: 1, sessions: [{ id: owner || 'guest-fixture', title: label + '聊天', createdAt: at,
            revision: 1, messages: [], draft: label + '草稿' }] }));
          localStorage.setItem(key(recordKey), JSON.stringify([{ id: 'note', note: label + '笔记', createdAt: at }]));
          localStorage.setItem(key('careerIntelligenceDocumentsV1'), JSON.stringify([{ id: 'doc', title: label + '附件', kind: 'text', text: label + '附件正文' }]));
        }
        localStorage.setItem('careerPredictor', JSON.stringify({ chatHistory:[{ role: 'user', content: '访客私有旧问答' }] }));
      }, { ids, chatKey: CHAT_KEY, recordKey: RECORD_KEY });
      let holding = true;
      await isolated.route('**/api/me/profile', async route => {
        if (holding) { holding = false; await profileRead.promise; }
        await route.continue();
      });
      const chat = await isolated.newPage();
      chat.on('pageerror', error => errors.push(error.stack || error.message));
      await chat.goto(origin + '/index.html#intelligence', { waitUntil: 'domcontentloaded' });
      await chat.getByText('正在读取个人资料…', { exact: true }).waitFor();
      assert.equal(await chat.locator('.ci-session-title').count(), 0);
      profileRead.resolve();
      await chat.getByText('账号甲私有聊天', { exact: true }).click();
      assert.equal(await chat.locator('#ciMessage').inputValue(), '账号甲私有草稿');
      assert.match(await chat.locator('#ciDocuments').textContent(), /账号甲私有附件/);
      assert.doesNotMatch(await chat.locator('#ciDocuments').textContent(), /账号乙私有|访客私有/);

      const identityTab = await isolated.newPage();
      await identityTab.goto(origin + '/start', { waitUntil: 'domcontentloaded' });
      fixtureProfile = profile(ids[1]);
      const refreshed = chat.waitForNavigation({ waitUntil: 'domcontentloaded' });
      await identityTab.evaluate(() => localStorage.setItem('careerP0AuthChange', 'fixture-rotated'));
      await refreshed;
      await chat.getByText('账号乙私有聊天', { exact: true }).click();
      assert.equal(await chat.locator('#ciMessage').inputValue(), '账号乙私有草稿');
      assert.doesNotMatch(await chat.locator('#ciDocuments').textContent(), /账号甲私有|访客私有/);
      await chat.locator('#ciShowRecords').click();
      assert.match(await chat.locator('#ciMemoryList').textContent(), /账号乙私有笔记/);
      assert.doesNotMatch(await chat.locator('#ciMemoryList').textContent(), /账号甲私有|访客私有/);
      await chat.locator('#ciRecordsDialog [data-ci-close]').click();
      await chat.locator('#ciShowSettings').click();
      await chat.locator('#ciUseHistory').check();
      const call = await send('请给我一个适合新生的方向探索建议。', chat);
      const history = JSON.stringify(call.history);
      assert.match(history, /账号乙私有笔记/);
      assert.doesNotMatch(history, /账号甲私有|访客私有/);
      assert.equal(await chat.evaluate(key => JSON.parse(localStorage.getItem(key)).sessions[0].draft, CHAT_KEY), '访客私有草稿');
    } finally {
      profileRead.resolve();
      fixtureProfile = null;
      await isolated.close();
    }
  });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, browserErrors: errors, apiCalls: calls.length, providerCalls: providerCalls.length, model: 'controlled-http-fixture' }));
} finally {
  heldRequest?.();
  await context?.close();
  await browser?.close();
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
