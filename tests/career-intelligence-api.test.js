import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createJourneyRouter } from '../journey/server.js';

const dimensions = ['interest_fit', 'ability_fit', 'transition_cost', 'time_cost', 'economic_cost', 'market_demand', 'competition', 'growth', 'flexibility', 'lifestyle_fit'];
const routes = [{ id: 'career', title: '先就业', description: '先积累研发实践' }, { id: 'degree', title: '读研', description: '训练跨学科方法' }];

function result(fields = {}) {
  return {
    status: 'ready', summary: '先确认感兴趣的日常工作。',
    profileInsights: { selfReported: [], inferred: [], missing: [] },
    branches: [], comparison: [], nextActions: ['访谈一位从业者'], followUpQuestion: '',
    ...fields,
  };
}

function branch(title, type) {
  return {
    title, type, description: '将已有实践迁移到具体任务。', reason: '可用实际项目检验适合程度。',
    advantages: ['材料实验经验'], skillGaps: ['统计验证'], risks: ['待核实目标岗位的实际任务'],
    nextActions: ['分析一个公开数据集'], verification: '请从业者评估作品。',
    timeCost: '先用两周试做', economicCost: '试做可用免费数据',
    opportunityCost: '减少准备其他方向的时间', flexibility: '统计能力可迁移',
    confidence: 'medium', stages: [], evidenceIds: [],
  };
}

function evaluated(routeTitle, routeId = '') {
  return {
    routeId, routeTitle, tradeoff: '前期需投入准备时间。',
    dimensions: dimensions.map(dimension => ({ dimension, assessment: '取决于用户提供的实践经历。', evidenceIds: [] })),
  };
}

function preliminaryPlan() {
  return result({
    assumptions: ['先用低成本探索确定一个方向，再按实际阶段调整投入。'],
    branches: [{
      ...branch('探索与能力积累', 'exploratory'),
      startingPoint: '当前阶段未知，可按在校、毕业前或已就业情景选用行动。',
      goal: '用实践验证方向并形成可展示的成果',
      knowledge: ['目标领域的基础概念与研究方法'],
      credentials: ['确定具体岗位或项目后再核实学历和资格要求'],
      practice: ['从公开数据或身边问题完成一个最小项目'],
      stages: ['near', 'mid', 'long'].map(timeframe => ({
        timeframe, title: '积累可验证产出',
        actions: ['整理一次既有经历中的具体任务和结果', '完成一个小型实践并记录反馈'],
      })),
    }],
    firstAction: '今天用 20 分钟列出三项做过的具体任务及各自产出。',
  });
}

async function api(t, provider, env = { JOURNEY_AI_API_KEY: 'fixture-key', JOURNEY_AI_MODEL: 'fixture-model' }, routerOptions = {}) {
  const app = express();
  const messages = [];
  const fetchFixture = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const [system, user] = payload.messages;
    const input = JSON.parse(user.content);
    messages.push({ system: system.content, input, maxOutputTokens: payload.max_completion_tokens });
    const reply = provider(input);
    if (reply instanceof Response) return reply;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] });
  };
  app.use('/api/journey', createJourneyRouter({ env, fetch: fetchFixture, rateLimitMs: 0, profileLogger: () => {}, ...routerOptions }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return {
    messages,
    async post(fields) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/journey/career-intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '我在做材料项目，想确定下一步。', ...fields }),
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, body: await response.json() };
    },
  };
}

test('exploration yields one structured result for advice and tree branches with bounded evidence', async t => {
  const client = await api(t, input => {
    const matched = input.evidence.find(item => item.origin === 'user_document');
    assert.ok(matched);
    return result({
      profileInsights: {
        selfReported: ['材料专业'], inferred: ['可能适合探索数据建模'], missing: [],
        documented: [{ statement: '项目报告提到材料实验', evidenceIds: [matched.sourceId] }],
      },
      branches: [
        { ...branch('材料测试', 'steady'), evidenceIds: [matched.sourceId] },
        branch('能源系统建模', 'advanced'),
        branch('材料信息学', 'cross_field'),
      ],
    });
  });
  const response = await client.post({
    task: 'explore', researchEnabled: true, challengeMode: true,
    profile: { consent: true, major: '材料专业' },
    history: [{ role: 'user', content: '我在比较跨学科方向。' }, { role: 'assistant', content: '可以试做公开项目。' }],
    documents: [{ title: '材料项目报告', text: '我在材料实验中负责拟合与重复性检查。' }],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.task, 'explore');
  assert.match(response.body.id, /^insight_/);
  assert.equal(new Set(response.body.branches.map(item => item.id)).size, 3);
  assert.equal(response.body.evidence.find(item => item.origin === 'user_document').sourceId, response.body.branches[0].evidenceIds[0]);
  assert.equal(response.body.researchStatus.liveSearchPerformed, false);
  assert.equal(response.body.contextAvailability.profile.status, 'available');
  assert.equal(response.body.contextAvailability.documents.status, 'available');
  assert.match(client.messages[0].system, /JSON Schema/);
  assert.equal(client.messages[0].input.challengeMode, true);
  assert.equal(client.messages[0].input.profile[0].verificationStatus, 'self_reported');
  assert.equal(client.messages[0].input.history[1].verificationStatus, 'inference');
});

test('server-owned authorized profile reaches the model without a client profile and diagnostics contain only statistics', async t => {
  const tail = '末尾关键成果使用 Python 建模，使验证误差降低。';
  const description = '本人参与能源科研项目，承担模型校准与实验分析。'.repeat(150) + tail;
  const fields = {
    'education.stage': { value_state: 'known', value: '大三', source_type: 'user_form', confirmation_state: 'corrected' },
    'education.major': { value_state: 'known', value: '可持续能源', source_type: 'user_form', confirmation_state: 'confirmed' },
    'experience.text': { value_state: 'known', value: description, source_type: 'user_form', confirmation_state: 'corrected' },
    'skills.self_report': { value_state: 'known', value: 'MATLAB、Python、建模分析', source_type: 'user_form', confirmation_state: 'corrected' },
  };
  const logs = [];
  const client = await api(t, input => {
    assert.ok(input.profile.some(fact => fact.field === 'education.stage' && fact.value === '大三'));
    assert.ok(input.profile.some(fact => fact.field === 'education.major' && fact.value === '可持续能源'));
    assert.ok(JSON.stringify(input.profile).includes(tail.normalize('NFKC')));
    assert.equal(input.availableProfileQuestions['education.stage'], undefined);
    assert.equal(input.availableProfileQuestions['education.major'], undefined);
    return preliminaryPlan();
  }, undefined, {
    resolveCareerProfile: () => ({ authenticated: true, status: 'connected', profile: { fields }, consent: true, source: 'sqlite' }),
    profileLogger: entry => logs.push(entry),
  });
  const response = await client.post({ task: 'plan', message: '结合个人经历，制定近期、中期和远期的成长路线。' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const diagnostics = response.body.profileDiagnostics;
  assert.equal(diagnostics.source, 'sqlite');
  assert.equal(diagnostics.authenticated, true);
  assert.equal(diagnostics.sqliteRead, true);
  assert.equal(diagnostics.profileAvailable, true);
  assert.equal(diagnostics.status, 'available');
  assert.equal(diagnostics.modelRequestSent, true);
  assert.equal(diagnostics.modelResponseReceived, true);
  assert.equal(diagnostics.usedByModel, true);
  assert.ok(diagnostics.fieldCount >= 4);
  assert.ok(diagnostics.totalCharacters > 2000);
  assert.equal(response.body.requestId, diagnostics.requestId);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, 'completed');
  assert.doesNotMatch(JSON.stringify(logs), /大三|可持续能源|能源科研|MATLAB|Python|关键成果/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /大三|可持续能源|能源科研|MATLAB|Python|关键成果/);
});

test('profile truncation diagnostics retain generated field, experience and metadata source identifiers without personal text', async t => {
  const logs = [];
  const client = await api(t, () => result(), undefined, {
    resolveCareerProfile: () => ({ authenticated: true, status: 'connected', consent: true, source: 'sqlite', profile: { fields: {
      'education.major': { value_state: 'known', value: '本人特殊专业'.repeat(500), source_type: 'user_form', confirmation_state: 'corrected' },
      'experience.text': { value_state: 'known', value: '本人特殊经历完成实验数据处理。'.repeat(700), source_type: 'user_form', confirmation_state: 'corrected' },
    } } }),
    profileLogger: entry => logs.push(entry),
  });
  const response = await client.post({
    task: 'profile', message: '结合经历分析可迁移能力。',
    profileUsage: { enabled: true, localConsent: true },
    profile: { consent: true,
      interests: '本人特殊兴趣'.repeat(500),
      skills: [{ name: '本人特殊技能', evidence: '本人特殊技能证据'.repeat(400), level: '本人特殊技能描述'.repeat(400) }],
      preferences: { directions: [{ title: '本人特殊方向', jobs: ['本人特殊岗位'.repeat(500)] }] },
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const truncated = response.body.profileDiagnostics.truncatedFields;
  for (const sourceId of ['sqlite:fields:education.major', 'sqlite:fields:experience.text:1', 'browser:local:interests',
    'browser:legacy:skill:0:evidence', 'browser:legacy:skill:0:level', 'browser:legacy:preference.direction:0:jobs']) {
    assert.ok(truncated.some(item => item.sourceId === sourceId), 'missing safe sourceId: ' + sourceId);
  }
  assert.ok(truncated.some(item => item.field === 'skill' && item.reason === 'metadata_budget'));
  assert.ok(truncated.some(item => item.field === 'preference.direction' && item.reason === 'metadata_budget'));
  assert.deepEqual(logs[0].truncatedFields, truncated);
  assert.doesNotMatch(JSON.stringify({ logs, diagnostics: response.body.profileDiagnostics }), /本人特殊/);
});

test('explicit profile opt-out omits both server and browser facts while preserving anonymous advice', async t => {
  const original = { fields: { 'education.major': { value_state: 'known', value: '服务器本人专业', source_type: 'user_form', confirmation_state: 'corrected' } } };
  const snapshot = structuredClone(original);
  const client = await api(t, input => {
    assert.deepEqual(input.profile, []);
    assert.doesNotMatch(JSON.stringify(input), /服务器本人专业|伪造本机专业/);
    return result();
  }, undefined, {
    resolveCareerProfile: () => ({ authenticated: true, status: 'connected', profile: original, consent: true, source: 'sqlite' }),
  });
  const response = await client.post({
    task: 'profile', profileUsage: { enabled: false, localConsent: true },
    profile: { consent: true, major: '伪造本机专业' },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.profileDiagnostics.status, 'not_requested');
  assert.equal(response.body.profileDiagnostics.usedByModel, false);
  assert.deepEqual(original, snapshot);
});

test('profile identity and connection failures remain distinct without leaking resolver errors or blocking advice', async t => {
  const scenarios = [
    { authenticated: false, status: 'not_connected', profile: null, consent: false },
    { authenticated: false, status: 'session_expired', profile: null, consent: false },
    { authenticated: false, status: 'storage_unavailable', profile: null, consent: false },
    { authenticated: true, status: 'connected', profile: { fields: {} }, consent: true },
    { authenticated: true, status: 'connected', profile: { fields: { 'education.major': { value_state: 'known', value: '未授权专业' } } }, consent: false },
  ];
  let current;
  const client = await api(t, input => {
    assert.deepEqual(input.profile, []);
    assert.doesNotMatch(JSON.stringify(input), /未授权专业|SQLite 私密报错/);
    return result();
  }, undefined, { resolveCareerProfile: () => {
    if (current instanceof Error) throw current;
    return current;
  } });
  const expectedStatuses = ['not_connected', 'session_expired', 'storage_unavailable', 'empty', 'not_authorized'];
  for (const [index, scenario] of scenarios.entries()) {
    current = scenario;
    const response = await client.post({ task: 'profile', guest_id: 'forged-other-visitor', owner_id: 'forged-owner' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.profileDiagnostics.status, expectedStatuses[index]);
    assert.equal(response.body.profileDiagnostics.usedByModel, false);
  }
  current = new Error('SQLite 私密报错 联系方式：private@example.com');
  const failedRead = await client.post({ task: 'profile' });
  assert.equal(failedRead.status, 200, JSON.stringify(failedRead.body));
  assert.equal(failedRead.body.profileDiagnostics.status, 'load_failed');
  assert.equal(failedRead.body.profileDiagnostics.sqliteRead, false);
  assert.doesNotMatch(JSON.stringify(failedRead.body), /SQLite 私密报错|private@example/);
});

test('unconfigured or failed models return profile delivery diagnostics and diagnostic logging cannot break a reply', async t => {
  const resolver = () => ({ authenticated: true, status: 'connected', profile: { fields: {
    'education.major': { value_state: 'known', value: '能源工程', source_type: 'user_form', confirmation_state: 'corrected' },
  } }, consent: true, source: 'sqlite' });
  const unconfigured = await api(t, () => { throw new Error('must not call'); }, {}, { resolveCareerProfile: resolver });
  const unavailable = await unconfigured.post({ task: 'profile' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.profileDiagnostics.status, 'available');
  assert.equal(unavailable.body.profileDiagnostics.modelRequestSent, false);
  assert.equal(unavailable.body.profileDiagnostics.usedByModel, false);
  const failing = await api(t, () => new Response(null, { status: 503 }), undefined, { resolveCareerProfile: resolver });
  const failed = await failing.post({ task: 'profile' });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.profileDiagnostics.modelRequestSent, true);
  assert.equal(failed.body.profileDiagnostics.modelResponseReceived, false);
  const noisyLogger = await api(t, () => result(), undefined, {
    resolveCareerProfile: resolver,
    profileLogger: () => { throw new Error('logger unavailable'); },
  });
  assert.equal((await noisyLogger.post({ task: 'profile' })).status, 200);
});

test('profile usage flags validate before resolver or provider execution', async t => {
  let resolutions = 0;
  const client = await api(t, () => { throw new Error('must not call'); }, undefined, {
    resolveCareerProfile: () => { resolutions += 1; return { status: 'not_connected', authenticated: false, profile: null, consent: false }; },
  });
  for (const profileUsage of [null, false, { enabled: 'yes' }, { localConsent: 'yes' }, { guest_id: 'other-user' }]) {
    assert.equal((await client.post({ task: 'profile', profileUsage })).status, 400);
  }
  assert.equal(resolutions, 0);
  assert.equal(client.messages.length, 0);
});

test('keeps optional follow-ups after useful answers and generates three-stage plans with an immediate first action', async t => {
  let reply = result({
    summary: '先用一次岗位访谈和一项小实验观察自己偏好的日常任务。',
    followUpQuestion: '你更重视研究还是早些积累工作经验？',
  });
  const client = await api(t, () => reply);
  const clarified = await client.post({ task: 'profile', message: '我有点迷茫。' });
  assert.equal(clarified.status, 200);
  assert.equal(clarified.body.status, 'ready');
  assert.deepEqual(clarified.body.branches, []);
  assert.match(clarified.body.followUpQuestion, /研究/);

  reply = preliminaryPlan();
  const planned = await client.post({ task: 'plan', routes: [routes[0]] });
  assert.equal(planned.status, 200);
  assert.deepEqual(planned.body.branches[0].stages.map(stage => stage.timeframe), ['near', 'mid', 'long']);
  assert.deepEqual(planned.body.branches[0].stages.map(stage => stage.timeHorizon), ['0–3 个月', '3–12 个月', '1–3 年']);
  assert.equal(planned.body.branches[0].planningHorizon, 'three_year');
  assert.equal(planned.body.firstAction, planned.body.nextActions[0]);

  reply = result({
    priorityIssue: '先验证一个感兴趣方向的真实任务。',
    actions: [
      { action: '读三条目标岗位的职责', purpose: '了解日常任务' },
      { action: '选一个任务做微型实践', purpose: '验证是否喜欢这个过程' },
      { action: '向一位从业者展示产出', purpose: '收集能力差距反馈' },
    ],
    immediateTask: '现在用 10 分钟记下一项想尝试的具体工作任务。',
  });
  const growth = await client.post({ task: 'growth', opportunityMode: true });
  assert.equal(growth.status, 200);
  assert.equal(client.messages.at(-1).input.opportunityMode, true);
  assert.deepEqual(growth.body.nextActions, reply.actions.map(item => item.action));
  assert.equal(growth.body.firstAction, reply.immediateTask);
});

test('profile follow-ups bind an available field and ordinary questions never acquire a write target', async t => {
  let reply = input => result({
    profileField: 'education.major', followUpQuestion: input.availableProfileQuestions['education.major'],
  });
  const client = await api(t, input => reply(input));
  const input = {
    task: 'profile', message: '请帮我了解跨专业就业的选择。给出建议后，请问我一个可选问题。',
    profile: { consent: true, fields: { 'education.stage': { value_state: 'known', value: '大三' } }, preferences: { location: '杭州' } },
  };
  const asked = await client.post(input);
  assert.equal(asked.status, 200);
  assert.equal(asked.body.profileField, 'education.major');
  const { availableProfileQuestions } = client.messages[0].input;
  assert.equal(asked.body.followUpQuestion, availableProfileQuestions['education.major']);
  assert.equal(availableProfileQuestions['education.stage'], undefined);
  assert.equal(availableProfileQuestions['preferences.city'], undefined);
  reply = () => result({ profileField: 'education.major', followUpQuestion: '你想先比较哪两条路线？' });
  const ordinary = await client.post(input);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.profileField, '');
  assert.equal(ordinary.body.followUpQuestion, '你想先比较哪两条路线？');
  reply = () => result({ profileField: 'other.field', followUpQuestion: '你的情况如何？' });
  assert.equal((await client.post(input)).status, 422);
});

test('routine profile questions are suppressed for all ordinary tasks without blocking useful results', async t => {
  let reply = result();
  const client = await api(t, input => {
    assert.deepEqual(input.availableProfileQuestions, {});
    return { ...reply, profileField: 'education.stage', followUpQuestion: '你目前处于哪个学习或求职阶段？' };
  });
  for (const task of ['profile', 'explore', 'plan', 'compare', 'growth']) {
    reply = task === 'plan' ? preliminaryPlan() : result();
    if (task === 'explore') reply.branches = [branch('研发试做', 'steady'), branch('数据实践', 'cross_field'), branch('行业调研', 'exploratory')];
    if (task === 'compare') reply.comparison = [evaluated('就业'), evaluated('读研')];
    const response = await client.post({ task, message: '请根据我的个人画像给出初步建议，也考虑未来申请读研的准备。' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.followUpQuestion, '');
    assert.equal(response.body.profileField, '');
    assert.ok(response.body.nextActions.length);
  }
  const noQuestions = await client.post({ task: 'profile', message: '请给出建议，不要先问我年级或专业。' });
  assert.equal(noQuestions.status, 200);
  assert.equal(noQuestions.body.followUpQuestion, '');
  assert.equal(client.messages.length, 6);
});

test('direct eligibility checks may retain one missing-field question after useful conditional advice', async t => {
  const client = await api(t, input => result({
    summary: '可以先核对该资格的正式报考条件，并整理你的经历证明；目前无法确认你已经符合资格。',
    profileField: 'education.degree',
    followUpQuestion: input.availableProfileQuestions['education.degree'],
  }));
  const response = await client.post({ task: 'profile', message: '请核实我是否满足 PMP 的报考条件。' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.profileField, 'education.degree');
  assert.equal(response.body.followUpQuestion, '你目前的学历是什么？');
  assert.ok(response.body.nextActions.length);
});

test('known or already asked fields cannot be requested again, including after a bare answer', async t => {
  const repeated = '你学的是什么专业？';
  let reply = () => result({ profileField: 'education.major', followUpQuestion: repeated });
  const client = await api(t, input => reply(input));
  const ready = await client.post({
    task: 'profile', message: '给出建议后，请问我一个可选问题。', profile: { consent: true, major: '自动化' },
  });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.profileField, '');
  assert.equal(ready.body.followUpQuestion, '');

  let attempts = 0;
  reply = input => {
    assert.equal(input.availableProfileQuestions['education.major'], undefined);
    return ++attempts === 1 ? result({ status: 'needs_input', followUpQuestion: repeated }) : result();
  };
  const repaired = await client.post({
    task: 'profile', history: [{ role: 'assistant', content: '结合专业可以缩小范围。\n\n' + repeated }], message: '自动化',
  });
  assert.equal(attempts, 2);
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.status, 'ready');
  assert.equal(repaired.body.profileField, '');
});

test('empty and partial profiles can receive a full three-year plan without a stage prerequisite', async t => {
  const client = await api(t, () => preliminaryPlan());
  for (const profile of [undefined, { consent: true, major: '能源', experience: '做过电池仿真实习。' }]) {
    const planned = await client.post({ task: 'plan', message: '请结合个人画像制定未来三年的成长路线。', profile });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    assert.equal(planned.body.status, 'ready');
    assert.equal(planned.body.followUpQuestion, '');
    assert.equal(planned.body.branches.length, 1);
    assert.equal(planned.body.branches[0].stages.length, 3);
    assert.ok(planned.body.assumptions.length);
    assert.ok(planned.body.branches[0].stages.every(stage => stage.actions.length >= 2 && stage.actions.length <= 3));
  }
  assert.equal(client.messages.length, 2);
  assert.deepEqual(client.messages[0].input.profile, []);
  assert.ok(client.messages[1].input.profile.some(fact => fact.field === 'education.major' && fact.value === '能源'));
  assert.match(client.messages[0].system, /Ask zero clarification questions by default/);
  assert.match(client.messages[0].system, /个人资料为空也必须完成规划/);
});

test('each model request carries one schema specialized to its task and a single-branch plan', async t => {
  const client = await api(t, input => {
    if (input.task === 'plan') return preliminaryPlan();
    if (input.task === 'explore') return result({
      branches: [branch('研发试做', 'steady'), branch('数据实践', 'cross_field'), branch('行业调研', 'exploratory')],
    });
    if (input.task === 'compare') return result({ comparison: [evaluated('就业'), evaluated('读研')] });
    return result();
  });
  for (const task of ['profile', 'explore', 'plan', 'compare', 'growth']) {
    const response = await client.post({ task });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const message = client.messages.at(-1);
    assert.equal(message.input.task, task);
    assert.equal(message.system.split('\nJSON Schema:\n').length, 2);
    const schema = JSON.parse(message.system.split('\nJSON Schema:\n')[1]);
    const fields = schema.properties;
    assert.deepEqual(fields.status.enum, ['ready']);
    assert.deepEqual(fields.profileField.enum, ['']);
    const limits = { profile: [0, 0], explore: [3, 5], plan: [1, 1], compare: [0, 0], growth: [0, 0] }[task];
    assert.deepEqual([fields.branches.minItems, fields.branches.maxItems], limits);
    if (task === 'plan') {
      const stages = fields.branches.items.properties.stages;
      assert.deepEqual([stages.minItems, stages.maxItems], [3, 3]);
      assert.deepEqual([stages.items.properties.actions.minItems, stages.items.properties.actions.maxItems], [2, 3]);
      assert.equal(stages.items.properties.actions.items.type, 'string');
      assert.match(message.system, /不把学生、毕业生或已就业情景拆成多个 branch/);
    }
    if (task === 'compare') assert.deepEqual([fields.comparison.minItems, fields.comparison.maxItems], [2, 5]);
    else assert.equal(fields.comparison.maxItems, 0);
    if (task === 'growth') {
      assert.equal(fields.actions.minItems, 3);
      assert.equal(fields.actions.items.properties.purpose.type, 'string');
    } else assert.equal(fields.actions, undefined);
  }
});

test('task-irrelevant optional arrays and strings can be empty in a valid plan response', async t => {
  const plan = preliminaryPlan();
  plan.profileInsights.potentialDirections = [];
  plan.actions = [];
  plan.priorityIssue = '';
  plan.immediateTask = '';
  const client = await api(t, () => plan);
  const response = await client.post({ task: 'plan', message: '帮我制定未来三年的成长路线。' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.profileInsights.potentialDirections, []);
  assert.deepEqual(response.body.actions, []);
  assert.equal(response.body.branches[0].stages.length, 3);
  assert.equal(client.messages.length, 1);
});

test('ordinary exploration and planning repair clarification-only outputs once instead of asking for mandatory context', async t => {
  for (const task of ['explore', 'plan']) {
    let attempts = 0;
    const ready = task === 'plan' ? preliminaryPlan() : result({
      assumptions: ['以下是尚未个性化的通用探索方向，先通过小项目验证。'],
      branches: [branch('理解与研究', 'exploratory'), branch('制作与解决实际问题', 'steady'), branch('组织与沟通', 'cross_field')],
    });
    const client = await api(t, () => ++attempts === 1 ? result({
      status: 'needs_input',
      summary: '缺少你的起点信息，先告诉我目前的学习阶段。',
      profileField: 'education.stage',
      followUpQuestion: '你目前处于哪个学习或求职阶段？',
      nextActions: [],
    }) : ready);
    const response = await client.post({
      task, message: task === 'plan' ? '帮我制定未来三年的成长路线。' : '我不知道未来做什么。',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.branches.length, task === 'plan' ? 1 : 3);
    assert.equal(response.body.followUpQuestion, '');
    assert.equal(response.body.profileField, '');
    assert.equal(attempts, 2);
    assert.match(client.messages[1].system, /不要再要求先填背景/);
  }
});

test('a persistently clarification-only model fails after a bounded repair without returning a questionnaire', async t => {
  const client = await api(t, () => result({
    status: 'needs_input', summary: '请先完善资料。', followUpQuestion: '你学的是什么专业？', nextActions: [],
  }));
  const response = await client.post({ task: 'explore', message: '我不知道未来做什么。' });
  assert.equal(response.status, 422);
  assert.equal(response.body.code, 'AI_ANSWER_REQUIRED');
  assert.equal(response.body.followUpQuestion, undefined);
  assert.equal(client.messages.length, 2);
});

test('malformed JSON and confused optional task fields receive one structural correction within the request', async t => {
  for (const malformed of ['json', 'actions']) {
    let attempts = 0;
    const client = await api(t, () => {
      if (++attempts > 1) return preliminaryPlan();
      if (malformed === 'actions') return { ...preliminaryPlan(), actions: ['整理项目证据', '做一次低成本验证'] };
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"status":"ready","summary":' } }] });
    });
    const response = await client.post({ task: 'plan', message: '帮我制定未来三年的成长路线。' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.branches[0].stages.length, 3);
    assert.equal(attempts, 2);
    assert.match(client.messages[1].system, /上次输出的结构未通过校验/);
    assert.match(client.messages[1].system, /阶段 actions 和 nextActions 只能包含文本字符串/);
  }
});

test('structural and answer-first corrections share one retry budget', async t => {
  let attempts = 0;
  const client = await api(t, () => ++attempts === 1
    ? Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'invalid json' } }] })
    : result({ status: 'needs_input', followUpQuestion: '你学的是什么专业？', nextActions: [] }));
  const response = await client.post({ task: 'plan', message: '帮我制定未来三年的成长路线。' });
  assert.equal(response.status, 422);
  assert.equal(response.body.code, 'AI_ANSWER_REQUIRED');
  assert.equal(attempts, 2);
});

test('profile summary additions preserve evidence classification and concise provisional directions', async t => {
  const reply = result({
    profileInsights: {
      selfReported: ['能源专业本科，做过电池仿真。'],
      inferred: ['仿真经历可能形成建模能力，需要用项目产出验证。'],
      missing: [],
      coreStrengths: ['已有一次电池仿真实践作为探索起点。'],
      transferableSkills: ['可用仿真项目检验数据分析与模型验证方法。'],
      potentialDirections: ['电池研发与测试', '能源系统建模', '材料数据研究'],
      skillGaps: ['选一份项目结果，检查自己的统计验证能力。'],
    },
  });
  const client = await api(t, () => reply);
  const response = await client.post({
    task: 'profile', message: '我是能源专业本科生，做过电池仿真实习。',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.profileInsights.potentialDirections.length, 3);
  assert.deepEqual(response.body.profileInsights.inferred, reply.profileInsights.inferred);
  assert.equal(response.body.followUpQuestion, '');
  assert.equal(client.messages.length, 1);
});

test('comparison keeps selected identities and accepts freeform options without unsupported market figures', async t => {
  let reply = result({ comparison: [evaluated('模型改写的标题', 'degree'), evaluated('', 'career')] });
  const client = await api(t, () => reply);
  const selected = await client.post({ task: 'compare', routes });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.body.comparison.map(({ routeId, routeTitle }) => [routeId, routeTitle]), [['career', '先就业'], ['degree', '读研']]);
  assert.match(selected.body.comparison[0].dimensions.find(item => item.dimension === 'market_demand').assessment, /^未知/);
  assert.equal((await client.post({ task: 'compare', routes: routes.slice(0, 1) })).status, 400);

  reply = result({ comparison: [evaluated('本科进入企业'), evaluated('读材料硕士')] });
  const freeform = await client.post({ task: 'compare', message: '比较本科毕业进企业和读材料硕士。' });
  assert.equal(freeform.status, 200);
  assert.deepEqual(freeform.body.comparison.map(route => route.routeTitle), ['本科进入企业', '读材料硕士']);
  assert.equal(new Set(freeform.body.comparison.map(route => route.routeId)).size, 2);
});

test('rejects fabricated citations and model attempts to return write operations', async t => {
  let reply = result({
    profileInsights: { selfReported: [], inferred: [], missing: [], documented: [{ statement: '不存在的证据', evidenceIds: ['forged'] }] },
  });
  const client = await api(t, () => reply);
  const bogusCitation = await client.post({ task: 'profile' });
  assert.equal(bogusCitation.status, 422);
  assert.equal(bogusCitation.body.code, 'AI_INVALID_RESPONSE');
  assert.equal(client.messages.length, 1);
  reply = { ...result(), operations: [{ op: 'delete_node' }] };
  assert.equal((await client.post({ task: 'growth' })).status, 422);
  assert.equal(client.messages.length, 2);
  reply = result({ summary: '<script>unsafe</script>' });
  assert.equal((await client.post({ task: 'profile' })).status, 422);
  assert.equal(client.messages.length, 3);
});

test('market judgments and documented personal facts reject evidence from the wrong source category', async t => {
  let comparing = true;
  const client = await api(t, input => {
    const personal = input.evidence.find(item => item.category === 'user_document');
    const offline = input.evidence.find(item => item.origin === 'offline_kb');
    assert.ok(personal);
    assert.ok(offline);
    if (!comparing) return result({
      profileInsights: { selfReported: [], inferred: [], missing: [], documented: [{ statement: '本人已获得学位', evidenceIds: [offline.sourceId] }] },
    });
    const comparison = [evaluated('', 'career'), evaluated('', 'degree')];
    for (const item of comparison) {
      for (const assessment of item.dimensions.filter(entry => ['market_demand', 'competition'].includes(entry.dimension))) {
        assessment.evidenceIds = [personal.sourceId, offline.sourceId];
        assessment.assessment = '市场需求很高，竞争低。';
      }
    }
    return result({ comparison });
  });
  const research = {
    message: '我做过材料项目，比较剑桥材料硕士申请和就业的市场需求与竞争。',
    researchEnabled: true, documents: [{ title: '材料项目记录', text: '我做过材料项目的数据拟合。' }],
  };
  const comparison = await client.post({ ...research, task: 'compare', routes });
  assert.equal(comparison.status, 200, JSON.stringify(comparison.body));
  for (const item of comparison.body.comparison) {
    for (const assessment of item.dimensions.filter(entry => ['market_demand', 'competition'].includes(entry.dimension))) {
      assert.match(assessment.assessment, /^未知/);
      assert.deepEqual(assessment.evidenceIds, []);
    }
  }
  comparing = false;
  const profile = await client.post({ ...research, task: 'profile' });
  assert.equal(profile.status, 422);
  assert.equal(profile.body.code, 'AI_INVALID_RESPONSE');
});

test('contact information in the prompt, selected routes and tree context is redacted before model transmission', async t => {
  const client = await api(t, () => result());
  const response = await client.post({
    task: 'growth', message: '我刚完成项目，联系方式 example@example.com。',
    routes: [{ id: 'career', title: '项目导师 teacher@example.com', description: '电话：13812345678' }],
    focusNode: { title: '毕业规划', description: '联系 team@example.com', parentTitle: '学号：12345678' },
  });
  assert.equal(response.status, 200);
  const { input } = client.messages[0];
  assert.match(input.message, /邮箱已省略/);
  assert.equal(input.routes[0].id, 'career');
  assert.doesNotMatch(JSON.stringify(input), /@example\.com|13812345678|12345678/);
});

test('an unconfigured provider reports unavailability without inventing advice', async t => {
  const client = await api(t, () => { throw new Error('provider must not run'); }, {});
  const response = await client.post({ task: 'explore' });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'AI_NOT_CONFIGURED');
  assert.equal(client.messages.length, 0);
});

test('chat reports upstream and connection failures in the chat context', async t => {
  let offline = false;
  const client = await api(t, () => {
    if (offline) throw new TypeError('network unavailable');
    return new Response(null, { status: 503 });
  });
  for (const code of ['AI_PROVIDER_UNAVAILABLE', 'AI_UNAVAILABLE']) {
    const failed = await client.post({ task: 'profile' });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, code);
    assert.match(failed.body.error, /职业规划 AI/);
    assert.doesNotMatch(failed.body.error, /树/);
    offline = true;
  }
});

test('structured planning has its own bounded, deployment-only output budget', async t => {
  const env = { JOURNEY_AI_API_KEY: 'fixture-key', JOURNEY_AI_MODEL: 'fixture-model', JOURNEY_AI_MAX_OUTPUT_TOKENS: '1500' };
  const scenarios = [[undefined, 6500], ['7200', 7200], ['9000', 6500]];
  for (const [configured, expected] of scenarios) {
    const client = await api(t, () => result(), { ...env, JOURNEY_CAREER_INTELLIGENCE_MAX_OUTPUT_TOKENS: configured });
    assert.equal((await client.post({ task: 'profile', maxOutputTokens: 8000 })).status, 200);
    assert.equal(client.messages[0].maxOutputTokens, expected);
  }
});
