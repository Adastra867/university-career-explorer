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

async function api(t, provider, env = { JOURNEY_AI_API_KEY: 'fixture-key', JOURNEY_AI_MODEL: 'fixture-model' }) {
  const app = express();
  const messages = [];
  const fetchFixture = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const [system, user] = payload.messages;
    const input = JSON.parse(user.content);
    messages.push({ system: system.content, input, maxOutputTokens: payload.max_completion_tokens });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(provider(input)) } }] });
  };
  app.use('/api/journey', createJourneyRouter({ env, fetch: fetchFixture, rateLimitMs: 0 }));
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
  assert.match(client.messages[0].system, /JSON Schema/);
  assert.equal(client.messages[0].input.challengeMode, true);
  assert.equal(client.messages[0].input.profile[0].verificationStatus, 'self_reported');
  assert.equal(client.messages[0].input.history[1].verificationStatus, 'inference');
});

test('supports a single follow-up, a three-stage plan and bounded growth advice', async t => {
  let reply = result({ status: 'needs_input', followUpQuestion: '你更重视研究还是早些积累工作经验？' });
  const client = await api(t, () => reply);
  const clarified = await client.post({ task: 'profile', message: '我有点迷茫。' });
  assert.equal(clarified.status, 200);
  assert.equal(clarified.body.status, 'needs_input');
  assert.deepEqual(clarified.body.branches, []);
  assert.match(clarified.body.followUpQuestion, /研究/);

  reply = result({
    branches: [{
      ...branch('材料信息学', 'cross_field'), goal: '完成材料性能预测作品',
      startingPoint: '曾做过材料项目', knowledge: ['材料表征'], credentials: ['具体学历门槛待核实'], practice: ['公开数据拟合'],
      stages: ['near', 'mid', 'long'].map(timeframe => ({ timeframe, title: '积累可验证产出', actions: ['整理复现实验记录'] })),
    }],
  });
  const planned = await client.post({ task: 'plan', routes: [routes[0]] });
  assert.equal(planned.status, 200);
  assert.deepEqual(planned.body.branches[0].stages.map(stage => stage.timeframe), ['near', 'mid', 'long']);

  reply = result({ branches: [branch('材料信息学', 'cross_field')] });
  const growth = await client.post({ task: 'growth', opportunityMode: true });
  assert.equal(growth.status, 200);
  assert.equal(client.messages.at(-1).input.opportunityMode, true);
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
  reply = { ...result(), operations: [{ op: 'delete_node' }] };
  assert.equal((await client.post({ task: 'growth' })).status, 422);
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

test('structured planning has its own bounded, deployment-only output budget', async t => {
  const env = { JOURNEY_AI_API_KEY: 'fixture-key', JOURNEY_AI_MODEL: 'fixture-model', JOURNEY_AI_MAX_OUTPUT_TOKENS: '1500' };
  const scenarios = [[undefined, 6500], ['7200', 7200], ['9000', 6500]];
  for (const [configured, expected] of scenarios) {
    const client = await api(t, () => result(), { ...env, JOURNEY_CAREER_INTELLIGENCE_MAX_OUTPUT_TOKENS: configured });
    assert.equal((await client.post({ task: 'profile', maxOutputTokens: 8000 })).status, 200);
    assert.equal(client.messages[0].maxOutputTokens, expected);
  }
});
