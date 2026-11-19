import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createJourneyRouter } from '../journey/server.js';
import { validatePrepResult } from '../journey/career-prep-server.js';

const resume = '本科阶段参与电商数据项目，使用 SQL 汇总订单并用 Excel 检查统计结果，完成了一份课程报告。';
const valid = { summary: '补充数据口径和个人行动。', strengths: ['有相关工具实践'], issues: [{ quote: '使用 SQL 汇总订单', problem: '方法细节不清', suggestion: '解释统计口径', rewrite: '使用 SQL 完成订单汇总。' }], missingFacts: ['具体检查了哪些异常？'] };

async function fixture(t, respond, enabled = true) {
  const calls = [];
  const app = express();
  app.use('/api/journey', createJourneyRouter({
    rateLimitMs: 0,
    env: enabled ? { JOURNEY_AI_PROVIDER: 'deepseek', JOURNEY_AI_API_KEY: 'fixture', JOURNEY_AI_MODEL: 'fixture-model' } : {},
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      const output = await respond(calls.at(-1));
      if (output instanceof Response) return output;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { calls, post: async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/journey/career-prep/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } };
}
const request = extra => ({ task: 'resume', consent: true, role: '数据分析师', jd: '本科，SQL', resume, ...extra });

test('resume route uses model, validates literal quotes, redacts contacts and excludes unrelated data', async t => {
  const api = await fixture(t, () => valid);
  const result = await api.post(request({ resume: resume + ' 联系 person@example.com，13800138000，110101200001011234', otherSecret: 'must-not-forward' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'online_ai');
  assert.equal(result.body.result.issues[0].quote, valid.issues[0].quote);
  const input = api.calls[0].messages[1].content;
  assert.doesNotMatch(input, /person@example.com|13800138000|110101200001011234|must-not-forward/);
  assert.match(input, /已省略/);
});

test('consent, task and input validation reject requests before spending model calls', async t => {
  const api = await fixture(t, () => valid);
  for (const [extra, status] of [[{ consent: false }, 403], [{ task: 'unknown' }, 400], [{ resume: '短' }, 400], [{ role: 'x'.repeat(81) }, 400]]) {
    assert.equal((await api.post(request(extra))).status, status);
  }
  assert.equal(api.calls.length, 0);
});

test('unconfigured provider is explicit; invented quotes and malformed JSON cannot become successful analysis', async t => {
  const missing = await fixture(t, () => valid, false);
  assert.equal((await missing.post(request())).body.code, 'AI_NOT_CONFIGURED');
  const invalid = await fixture(t, () => ({ ...valid, issues: [{ ...valid.issues[0], quote: '独立负责百万元项目' }] }));
  assert.equal((await invalid.post(request())).status, 422);
  const malformed = await fixture(t, () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }] })));
  assert.equal((await malformed.post(request())).status, 422);
});

test('interview feedback follows the answer and suppresses a second follow-up', async t => {
  const api = await fixture(t, () => ({ strengths: ['解释了具体方法'], feedback: ['补充数据验证过程'], followUp: '你如何排除重复订单？' }));
  const body = request({ task: 'interview', question: '介绍你做过的 SQL 项目', answer: '我用 SQL 对订单去重，按日汇总成交额。', allowFollowUp: true });
  const first = await api.post(body);
  assert.equal(first.status, 200);
  assert.match(first.body.result.followUp, /重复订单/);
  const second = await api.post({ ...body, allowFollowUp: false });
  assert.equal(second.body.result.followUp, '');
  assert.equal(JSON.parse(api.calls[0].messages[1].content).resume, undefined, 'Interview does not silently upload the resume');
});

test('provider outage remains an explicit failure and releases the shared concurrency slot', async t => {
  let fail = true;
  const api = await fixture(t, () => fail ? new Response('', { status: 401 }) : valid);
  assert.equal((await api.post(request())).status, 503);
  fail = false;
  assert.equal((await api.post(request())).status, 200);
  assert.throws(() => validatePrepResult({ strengths: [], feedback: [], followUp: '' }, 'interview'), { code: 'AI_INVALID_RESPONSE' });
});
