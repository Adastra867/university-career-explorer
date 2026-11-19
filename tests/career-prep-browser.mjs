// Run against an already-started local server. Model requests are intercepted fixtures.
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-runtime.mjs';

const base = process.env.CAREER_TEST_BASE_URL || 'http://localhost:5174';
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [], requests = [];
  let mode = 'success', release;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/journey/career-prep/analyze', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (mode === 'delayed') await new Promise(resolve => { release = resolve; });
    const result = body.task === 'resume' ? {
      summary: 'AI检查了本次项目材料', strengths: ['有SQL实践'],
      issues: [{ quote: '使用 SQL', problem: '说明口径', suggestion: '补充验证方法', rewrite: '' }], missingFacts: ['你检查了哪些异常？'],
    } : { strengths: ['有明确行动'], feedback: ['解释验证方法'], followUp: body.allowFollowUp ? '你如何核对重复订单？' : '' };
    await route.fulfill({ status: mode === 'failure' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'failure' ? { error: 'fixture unavailable' } : { mode: 'online_ai', result }) }).catch(() => {});
  });
  await page.goto(base + '/career-prep.html', { waitUntil: 'domcontentloaded' });
  await page.selectOption('#stage', 'senior');
  await page.fill('#role', '数据分析师'); await page.check('#confirmed');
  await page.locator('[data-sprint-step="resume"]').click();
  await page.fill('#resume', '本科期间参与电商数据分析课程项目，使用 SQL 汇总订单并用 Excel 检查数据，完成课程报告并向同学解释统计方法。');
  await page.click('#analyzeBtn');
  assert.equal(requests.length, 0, 'Default rule mode never calls the model');
  await page.check('#prepAIEnabled'); await page.click('#analyzeBtn');
  await page.waitForFunction(() => document.querySelector('#sprintAIStatus').textContent.includes('AI 诊断完成'));
  assert.match(await page.locator('#diagnosis').innerText(), /AI检查了本次项目材料/);
  const beforeReload = requests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.isChecked('#prepAIEnabled'), false);
  assert.equal(requests.length, beforeReload, 'Refresh restores results without model calls');
  await page.check('#prepAIEnabled'); mode = 'failure'; await page.click('#analyzeBtn');
  await page.waitForFunction(() => document.querySelector('#sprintAIStatus').textContent.includes('保留规则诊断'));
  assert.match(await page.locator('#diagnosis').innerText(), /本次目标/);
  mode = 'delayed'; await page.click('#analyzeBtn');
  await page.waitForFunction(() => document.querySelector('#cancelPrepAI').hidden === false);
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  await page.fill('#resume', '修改后的简历材料：本科阶段完成订单分析课程项目，使用 SQL 和 Excel，验证了重复订单并提交课程报告。');
  release();
  await page.waitForFunction(() => !document.querySelector('#analyzeBtn').disabled);
  assert.doesNotMatch(await page.locator('#diagnosis').innerText(), /AI检查了本次项目材料/);
  assert.match(await page.inputValue('#resume'), /修改后的简历/);
  mode = 'success';
  await page.locator('[data-sprint-step="practice"]').click();
  await page.click('#startBtn'); await page.fill('#answer', '我通过课程项目学习了 SQL，曾整理订单并完成数据分析报告，想申请数据分析岗位。');
  mode='delayed';release=undefined;
  const retainedAnswer=await page.inputValue('#answer');
  await page.click('#submitBtn');
  while(!release)await new Promise(resolve=>setTimeout(resolve,10));
  await page.click('#cancelPrepAI');release();
  await page.waitForFunction(()=>!document.querySelector('#submitBtn').disabled);
  assert.equal(await page.inputValue('#answer'),retainedAnswer,'Cancel keeps the current answer without advancing');
  assert.doesNotMatch(await page.locator('#transcript').innerText(),/在线 AI/);
  mode='success';
  await page.click('#submitBtn');
  await page.waitForFunction(() => document.querySelector('#questionText').textContent === '你如何核对重复订单？');
  assert.match(await page.locator('#transcript').innerText(), /在线 AI/);
  const count = requests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#questionText').innerText(), '你如何核对重复订单？');
  assert.equal(requests.length, count);
  await page.check('#prepAIEnabled'); await page.fill('#answer', '我按订单号检查重复记录，再根据支付状态筛选，并抽样核对原始记录。'); await page.click('#submitBtn');
  await page.waitForFunction(() => document.querySelector('#roundLabel').textContent.includes('第 2 / 4 轮'));
  assert.equal(requests.at(-1).allowFollowUp, false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, modelRequests: requests.length, pageErrors: errors.length, checks: ['default opt-out', 'AI resume', 'refresh persistence', 'provider fallback', 'stale response rejection', 'contextual follow-up', 'follow-up restoration', 'one follow-up per round'] }));
} finally { await browser.close(); }
