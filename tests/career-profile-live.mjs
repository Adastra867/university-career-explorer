import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from './browser-runtime.mjs';

// Explicit real-provider acceptance with synthetic data. Never runs in npm test.
if (!process.argv.includes('--run')) {
  console.log('Usage: node tests/career-profile-live.mjs --run [http://localhost:5000]');
  process.exit(0);
}
const base = new URL(process.argv.find(value => /^https?:/.test(value)) || 'http://localhost:5000');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use the local application only.');
const outputDirectory = resolve('artifacts/career-profile-fix');
await mkdir(outputDirectory, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const errors = [];
let csrf;
let created = false;
const report = { startedAt: new Date().toISOString(), data: 'synthetic-only', base: base.origin, checks: [] };
async function api(method, path, data) {
  const response = await context.request.fetch(base.origin + '/api' + path, {
    method, headers: { Origin: base.origin, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(data === undefined ? {} : { data }), timeout: 180000,
  });
  const body = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(body));
  if (body.csrf_token) csrf = body.csrf_token;
  return body;
}
try {
  const session = await api('POST', '/guest-session', { consent: true, notice_version: 'p0-v1' });
  created = true;
  const experience = '项目：电池老化仿真与能源数据验证（合成测试资料）\n' +
    Array.from({ length: 58 }, (_, index) => `实验记录${index + 1}：我负责使用 MATLAB 比较电池在不同充放电工况下的仿真曲线，以 Python 清洗循环记录、核对单位并记录异常值；区分数据清洗、参数分析与结果解释，保留复核过程。`).join('\n') +
    '\n最终方法与成果：采用留一工况验证检验跨工况泛化，按时间切分训练与验证记录，避免相邻循环泄漏；发现低温工况容量衰减误差偏大，整理误差对照表和可复现实验说明。这是我的实际任务与产出。';
  assert.ok(experience.length > 2000 && experience.length < 8000);
  await api('PATCH', '/me/profile', { expected_revision: session.profile.profile_revision, patch: [
    { field_path: 'education.stage', value: '大三' },
    { field_path: 'education.degree', value: '本科' },
    { field_path: 'education.major', value: '可持续能源' },
    { field_path: 'experience.text', value: experience },
    { field_path: 'skills.self_report', value: 'MATLAB、Python、建模分析' },
    { field_path: 'preferences.long_term_goal', value: '探索能源技术与 AI 交叉方向' },
  ] });
  const granted = await api('POST', '/me/profile/ai-consent', { consent: true, notice_version: 'career-ai-profile-v1' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base.origin + '/index.html#intelligence');
  await page.waitForFunction(() => window.CareerProfile?.state === 'connected' && document.getElementById('ciUseProfile').checked);
  report.checks.push('Saved SQLite AI consent defaults on after real profile loading');
  await page.locator('#ciSuggestions [data-ci-prompt="plan"]').click();
  await page.locator('#ciMessage').fill('结合我的个人经历，制定可执行的近期、中期和远期成长路线。请说明你从已有项目中识别出的可迁移能力，以及最先要做的一项行动。');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/journey/career-intelligence') && response.request().method() === 'POST', { timeout: 180000 });
  await page.locator('#ciSubmit').click();
  const response = await responsePromise;
  const payload = response.request().postDataJSON();
  assert.equal(payload.profile, undefined);
  assert.equal(payload.profileUsage.enabled, true);
  assert.equal(response.status(), 200);
  const result = await response.json();
  report.result = result;
  report.experienceCharacters = experience.length;
  assert.equal(result.status, 'ready');
  assert.equal(result.profileDiagnostics.source, 'sqlite');
  assert.equal(result.profileDiagnostics.usedByModel, true);
  assert.ok(result.profileDiagnostics.totalCharacters > 2000);
  assert.equal(result.branches.length, 1);
  assert.deepEqual(result.branches[0].stages.map(stage => stage.timeframe), ['near', 'mid', 'long']);
  assert.ok(result.branches[0].stages.every(stage => stage.actions.length >= 2));
  const answer = JSON.stringify({ summary: result.summary, insights: result.profileInsights, branches: result.branches, nextActions: result.nextActions });
  assert.match(answer, /留一工况|跨工况|低温|时间切分|数据泄漏|循环泄漏|误差对照/);
  assert.match(answer, /MATLAB|Python/);
  assert.doesNotMatch(result.followUpQuestion || '', /几年级|什么专业|哪个专业|哪个年级/);
  assert.deepEqual((await api('GET', '/me/profile')).fields, granted.fields);
  report.checks.push('No browser profile payload; real model reads SQLite, uses long-experience tail and skills, returns three stages without repeating known fields');
  await page.locator('.ci-profile-diagnostics').last().waitFor();
  await page.locator('.ci-profile-diagnostics').last().evaluate(element => { element.open = true; });
  await page.screenshot({ path: resolve(outputDirectory, 'live-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.scroll <= width.viewport + 1);
  await page.screenshot({ path: resolve(outputDirectory, 'live-mobile.png'), fullPage: true });
  await page.reload();
  await page.waitForFunction(() => window.CareerProfile?.state === 'connected' && document.getElementById('ciUseProfile').checked);
  assert.equal((await api('GET', '/me/profile')).fields['experience.text'].value, experience);
  assert.deepEqual(errors, []);
  report.checks.push('Refresh restores consent, profile and answer; mobile has no horizontal overflow or page errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (created) {
    try { report.syntheticGuestDeleted = (await api('DELETE', '/me/data', {})).deleted === true; }
    catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  }
  report.browserErrors = errors;
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(outputDirectory, 'live-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, syntheticGuestDeleted: report.syntheticGuestDeleted, error: report.error, cleanupError: report.cleanupError, browserErrors: errors, artifact: resolve(outputDirectory, 'live-result.json') }));
  await context.close();
  await browser.close();
}
