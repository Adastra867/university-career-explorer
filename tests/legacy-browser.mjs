import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = resolve(ROOT, 'artifacts', 'journey');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const results = { baseUrl: BASE_URL, startedAt: new Date().toISOString(), tests: [], screenshots: [], dialogs: [], browserErrors: [], externalFailures: [], limitations: [] };
const experience = '【教育】本科计算机科学，2027年毕业。【项目】负责校园数据分析项目，使用 Python、SQL 和 Excel 清洗数据，设计用户调研并完成可视化报告，协调团队完成项目交付，分析报名流程，优化效率并提升满意度15%。【技能】Python、SQL、Excel、数据分析、沟通、项目管理。';
const jd = '数据分析师岗位职责：使用 Python、SQL、Excel 完成数据分析与可视化；负责用户调研，协调团队，优化项目流程。任职要求：本科计算机科学，良好沟通与问题解决能力，了解统计和机器学习。';

await mkdir(ARTIFACTS, { recursive: true });

async function test(name, fn, category = 'real-local-ui') {
  const started = Date.now();
  try {
    const detail = await fn();
    results.tests.push({ name, category, status: 'passed', durationMs: Date.now() - started, ...(detail === undefined ? {} : { detail }) });
    console.log(`PASS ${name}`);
    return detail;
  } catch (error) {
    results.tests.push({ name, category, status: 'failed', durationMs: Date.now() - started, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}

const browser = await launchBrowser();
// This disposable context never accesses the user's existing Chrome profile.
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true });
context.setDefaultTimeout(15000);
let phase = 'assessment';
let dialogExpectation = null;
const page = await context.newPage();
page.on('dialog', async dialog => {
  const item = { phase, type: dialog.type(), message: dialog.message(), expected: Boolean(dialogExpectation?.test(dialog.message())) };
  results.dialogs.push(item);
  await dialog.accept();
});
page.on('pageerror', error => results.browserErrors.push({ phase, message: error.message }));
page.on('requestfailed', request => {
  if (!request.url().startsWith(BASE_URL)) results.externalFailures.push({ phase, url: request.url(), error: request.failure()?.errorText });
});
const saved = key => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const active = step => page.waitForSelector(`#step${step}.active`);
const nav = async step => {
  const href = ['/index.html', '#direction', '#ability', '#ability/experience', '#jobs', '#reports', '#history'][step];
  const selector = step === 3 ? '#step2 a[href$="#ability/experience"]' : '.career-nav [href$="' + href + '"]:visible';
  await page.locator(selector).first().click();
  await active(step);
};
const buttonCall = (call, scope = page) => scope.locator(`button[onclick="${call}"]`);
const screenshot = async name => {
  const path = resolve(ARTIFACTS, name);
  // Reload preserves scroll; reset it so sticky navigation stays at the top in
  // a full-page capture. Allow the original canvas chart animation to finish.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  results.screenshots.push(path);
};

try {
  try {
    await test('Original homepage and assessment entry', async () => {
      const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
      assert.equal(response.status(), 200);
      await active(0);
      assert.equal(await saved('careerPredictorPrep'), null);
      await page.locator('#continueTestButton').click();
      await active(1);
      const dependencies = await page.evaluate(() => ({ chart: typeof window.Chart === 'function', pdf: typeof window.html2pdf === 'function' }));
      assert.equal(dependencies.chart, true, 'The local chart script should load');
      assert.equal(await page.getByRole('navigation', { name: '主导航' }).count(), 1);
      return dependencies;
    });

    await test('Four direct task entries, browser history, and reduced-motion mobile navigation', async () => {
      await page.goto(BASE_URL + '/index.html');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fit = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      const cards = page.locator('.career-task-card');
      assert.equal(await cards.count(), 4);
      assert.equal(await page.locator('.career-welcome img, .career-task-card img').evaluateAll(async images => {
        await Promise.all(images.map(image => image.decode()));
        return images.filter(image => image.naturalWidth > 0).length;
      }), 5);
      const lastCard = await cards.last().boundingBox();
      assert.ok(lastCard.y + lastCard.height < 780);
      await cards.nth(1).click();
      await active(3);
      const draft = '浏览器历史中的经历草稿';
      await page.locator('#experienceInput').fill(draft);
      await page.locator('.career-nav [data-career-nav="jobs"]').click();
      await active(4);
      await page.goBack();
      await active(3);
      assert.equal(await page.locator('#experienceInput').inputValue(), draft);
      await page.goForward();
      await active(4);
      await page.reload();
      await active(4);
      assert.ok(await fit());
      await page.locator('.career-more').click();
      await page.locator('.career-mobile-link[data-career-nav="sprint"]').click();
      await page.locator('#sprintNext').waitFor();
      assert.ok(await fit());
      await page.locator('#floatingAssistant').click();
      assert.equal(await page.locator('#assistantPanel').getAttribute('aria-modal'), 'true');
      assert.match(await page.locator('#assistantContext').innerText(), /求职冲刺/);
      await page.keyboard.press('Escape');
      await page.goto(BASE_URL + '/index.html');
      await cards.last().click();
      await page.getByRole('heading', { name: '方向对比', exact: true }).waitFor();
      assert.ok(await page.locator('#consentBtn').isVisible());
      assert.ok(await fit());
      await page.evaluate(() => {
        localStorage.removeItem('careerPredictor');
        localStorage.removeItem('careerWorkspaceRecent');
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(BASE_URL + '/index.html#direction');
      await active(1);
    });

    await test('Direction profile, three choices and ordering', async () => {
      await page.locator('[data-profile-field="education"][data-profile-value="undergraduate"]').click();
      await page.locator('#directionNext').click();
      await page.locator('#majorInput').fill('计算机科学');
      await page.locator('#directionNext').click();
      await page.locator('[data-profile-field="employmentChoice"][data-profile-value="unsure"]').click();
      await page.locator('#directionNext').click();
      assert.ok(await page.locator('#directionCards .direction-card').count() >= 3);
      for (let i = 0; i < 3; i++) await page.locator('#directionCards .direction-card').nth(i).getByRole('button', { name: '加入意向', exact: true }).click();
      const before = (await saved('careerPredictor')).directionRanking;
      await page.locator('#directionRanking .rank-item').nth(1).getByRole('button', { name: '上移', exact: true }).click();
      const after = (await saved('careerPredictor')).directionRanking;
      assert.equal(after.length, 3);
      assert.equal(after[0], before[1]);
      await page.locator('#saveStep1Button').click();
      const history = await saved('careerPredictorHistory');
      assert.equal(history.records.length, 1);
      assert.equal(history.records[0].status, 'draft');
      await nav(6);
      await page.getByRole('button', { name: '继续填写', exact: true }).click();
      await active(1);
      assert.equal(await page.locator('#majorInput').inputValue(), '计算机科学');
      await page.locator('#directionNext').click();
      await active(2);
    });

    await test('All 25 questionnaire answers and six scenario choices', async () => {
      const questions = page.locator('#questionnaireContainer > .card');
      await page.goto(BASE_URL + '/index.html#ability/questionnaire/9');
      await active(2);
      assert.equal(await page.locator('#questionnaireContainer > .card:visible').count(), 25);
      assert.match(page.url(), /#ability\/questionnaire$/);
      for (let i = 0; i < 25; i++) {
        await questions.nth(i).locator('.radio-card[data-val="4"]').click();
        if (i === 7) {
          await page.reload();
          await active(2);
          assert.equal(await questions.locator('[aria-pressed="true"]').count(), 8);
        }
      }
      assert.equal(await questions.locator('[aria-pressed="true"]').count(), 25);
      await page.locator('#softNext').click();
      await page.waitForFunction(() => document.getElementById('mbtiType').textContent.includes('MBTI'));
      await page.locator('#tabScenario').click();
      const scenarios = page.locator('#scenarioContainer > .card');
      assert.equal(await scenarios.count(), 6);
      for (let i = 0; i < 6; i++) {
        await scenarios.nth(i).locator('.scenario-card').first().click();
        await page.locator('#softNext').click();
      }
      const data = await saved('careerPredictor');
      assert.equal(Object.keys(data.questionnaireAnswers).length, 25);
      assert.equal(Object.keys(data.scenarioAnswers).length, 6);
      assert.match(data.mbtiResult.type, /^[EI][SN][TF][JP]$/);
      assert.ok(Object.keys(data.softSkills).length >= 9);
      await page.locator('#saveStep2Button').click();
      return { questionnaireAnswers: 25, scenarios: 6, mbti: data.mbtiResult.type };
    });

    await test('Experience analysis extracts actual entered skills', async () => {
      await nav(3);
      await page.locator('#experienceInput').fill(experience);
      await buttonCall('analyzeExperience()').click();
      const data = await saved('careerPredictor');
      assert.ok(data.experienceAnalysis.keywords.includes('Python'));
      assert.ok(data.experienceAnalysis.tools.includes('Excel'));
      assert.ok((await page.locator('#experienceResult').innerText()).includes('Python'));
      await page.locator('#saveStep3Button').click();
    });

    await test('Manual JD matching and saved step restoration after refresh', async () => {
      await nav(4);
      await page.locator('#jdManualTab').click();
      await page.locator('#jdInput').fill(jd);
      await buttonCall('matchJD()').click();
      const data = await saved('careerPredictor');
      assert.equal(data.jdMatchResult.source, 'manual');
      assert.ok(data.jdMatchResult.matchScore > 0);
      assert.ok(data.jdMatchResult.matched.some(item => item.word === 'Python'));
      await page.locator('#saveStep4Button').click();
      await page.reload({ waitUntil: 'load' });
      await active(4);
      assert.match(page.url(), /#jobs\/manual$/);
      assert.equal(await page.locator('#jdInput').inputValue(), jd);
      assert.ok((await page.locator('#matchResultContent').innerText()).includes('Python'));
      return { matchScore: data.jdMatchResult.matchScore };
    });

    await test('Real automatic job API produces results or honest guided fallback', async () => {
      await page.locator('#jdAutoTab').click();
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/recommend-jobs') && r.request().method() === 'POST', { timeout: 30000 });
      await page.locator('#recommendJobsBtn').click();
      const response = await responsePromise;
      const body = await response.json();
      await page.waitForFunction(() => !document.getElementById('recommendJobsBtn').disabled, null, { timeout: 30000 });
      const data = await saved('careerPredictor');
      assert.ok([200, 503].includes(response.status()), `Unexpected API status ${response.status()}`);
      assert.ok(['live', 'guided'].includes(data.jobSearchMeta?.mode));
      if (data.jobSearchMeta.mode === 'guided') {
        assert.equal(data.recommendedJobs.length, 0);
        assert.ok(data.jobSearchMeta.guides.length > 0);
        results.limitations.push({ area: 'legacy-job-recommendation', status: response.status(), code: body.code || body.reasonCode, note: 'Live job search is unavailable or has no verified results; the UI presents search guidance.' });
      }
      // Restore manual matching using the UI so the final report has that input.
      await page.locator('#jdManualTab').click();
      await buttonCall('matchJD()').click();
      return { status: response.status(), mode: data.jobSearchMeta.mode, resultCount: data.recommendedJobs.length };
    }, 'real-network-ui');

    await test('Comprehensive report persists and history reopens the same result', async () => {
      await buttonCall('generateCurrentReport()', page.locator('#step4')).click();
      await active(5);
      assert.notEqual(await page.locator('#reportMBTI').innerText(), '--');
      const score = await page.locator('#reportMatchScore').innerText();
      assert.match(score, /^\d+%$/);
      assert.ok((await page.locator('#reportProfile').innerText()).includes('计算机科学'));
      await page.locator('#saveReportButton').click();
      const history = await saved('careerPredictorHistory');
      assert.equal(history.records.length, 1);
      assert.equal(history.records[0].status, 'completed');
      await screenshot('legacy-report.png');
      await nav(6);
      await page.reload({ waitUntil: 'load' });
      assert.equal(await page.locator('#historyList .history-record').count(), 1);
      await page.getByRole('button', { name: '查看结果', exact: true }).click();
      await active(5);
      assert.equal(await page.locator('#reportMatchScore').innerText(), score);
      assert.ok(await page.locator('#historyViewBanner').isVisible());
      const historyURL = page.url();
      await page.reload();
      assert.equal(page.url(), historyURL);
      assert.ok(await page.locator('#historyViewBanner').isVisible());
      await nav(4);
      assert.equal(await page.locator('#jdInput').inputValue(), jd);
      await page.goBack();
      assert.ok(await page.locator('#historyViewBanner').isVisible());
      await buttonCall('exitHistoryView()').click();
      await active(6);
      return { historyCount: history.records.length, score };
    });

    await test('Original star assistant answers locally and saves its conversation', async () => {
      await page.locator('#floatingAssistant').click();
      await page.locator('#chatInput').fill('数据分析师的日常工作是什么？');
      await buttonCall('sendChat()').click();
      await page.waitForFunction(() => !document.getElementById('typingInd'));
      const data = await saved('careerPredictor');
      assert.equal(data.chatHistory.length, 2);
      assert.ok((await page.locator('#chatArea').innerText()).includes('日常工作'));
      await page.keyboard.press('Escape');
      assert.ok(await page.locator('#assistantPanel').isHidden());
    });
  } catch (_) { /* Recorded above; independent legacy modules still run. */ }

  phase = 'job-search';
  try {
    await test('Standalone job search imports assessment without changing it', async () => {
      const currentBefore = await saved('careerPredictor');
      const historyBefore = await saved('careerPredictorHistory');
      const response = await page.goto(`${BASE_URL}/job-search.html`, { waitUntil: 'load' });
      assert.equal(response.status(), 200);
      assert.ok(await page.locator('#profileBadge').isVisible());
      assert.ok((await page.locator('#importedTags').innerText()).includes('Python'));
      assert.deepEqual(await saved('careerPredictor'), currentBefore);
      assert.deepEqual(await saved('careerPredictorHistory'), historyBefore);
    });

    await test('Standalone job search actual service response is explicit', async () => {
      await page.locator('#searchQuery').fill('数据分析师');
      await page.locator('#searchLocation').fill('上海');
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/search-jobs') && r.request().method() === 'POST', { timeout: 30000 });
      await page.locator('#searchBtn').click();
      const response = await responsePromise;
      const body = await response.json();
      await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 30000 });
      assert.ok([200, 503].includes(response.status()), `Unexpected API status ${response.status()}`);
      if (response.status() === 503) {
        assert.equal(body.success, false);
        assert.match(await page.locator('#jobList').innerText(), /搜索入口，不是真实在招岗位/);
        assert.ok(await page.locator('#jobList a[href^="https://www.zhipin.com/"]').isVisible());
        results.limitations.push({ area: 'legacy-job-search', status: 503, code: body.code, note: 'The standalone page preserves the query and displays an explicitly labelled search plan; this is not a live job result.' });
      } else {
        assert.equal(body.success, true);
        assert.equal(await page.locator('#jobList .job-card').count(), body.jobs.length);
      }
      dialogExpectation = null;
      return { status: response.status(), success: body.success, count: body.jobs?.length || 0, code: body.code };
    }, 'real-network-ui');

    await test('Controlled job fixture: cards, sorting, detail, manual JD matching', async () => {
      await page.route('**/api/search-jobs', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, jobs: [
        { title: '测试岗位 A · 数据分析师', company: '受控测试公司', snippet: 'Python SQL Excel 数据分析 可视化', url: 'https://example.com/fixture-a', platform: '受控fixture', publishTime: '2026-01-02' },
        { title: '测试岗位 B · 用户运营', company: '受控测试公司', snippet: '运营 用户 沟通 活动策划', url: 'https://example.com/fixture-b', platform: '受控fixture', publishTime: '2026-01-01' },
      ] }) }));
      await page.locator('#searchBtn').click();
      await page.waitForSelector('#jobList .job-card');
      assert.equal(await page.locator('#jobList .job-card').count(), 2);
      await page.locator('#sortLatest').click();
      await page.locator('#sortMatch').click();
      await page.locator('#jobList .job-card').first().click();
      assert.ok(await page.locator('#jobModal').isVisible());
      assert.ok((await page.locator('#modalContent').innerText()).includes('Python'));
      await page.keyboard.press('Escape');
      assert.ok(await page.locator('#jobModal').isHidden());
      await page.locator('#manualJD').fill(jd);
      await buttonCall('analyzeManualJD()').click();
      assert.ok((await page.locator('#manualResult').innerText()).includes('关键词对应程度'));
      await page.unroute('**/api/search-jobs');
    }, 'controlled-fixture-ui');
  } catch (_) { /* Keep testing the independent preparation page. */ }

  phase = 'career-preparation';
  try {
    const currentBefore = await saved('careerPredictor');
    const historyBefore = await saved('careerPredictorHistory');
    await test('Preparation imports saved assessment and diagnoses the entered resume', async () => {
      const response = await page.goto(`${BASE_URL}/career-prep.html`, { waitUntil: 'load' });
      assert.equal(response.status(), 200);
      await page.locator('#importBtn').click();
      assert.equal(await page.locator('#resume').inputValue(), experience);
      assert.equal(await page.locator('#jd').inputValue(), jd);
      await page.locator('#stage').selectOption('senior');
      await page.locator('#role').fill('数据分析师');
      await page.locator('#industry').selectOption('internet');
      await page.locator('#confirmed').check();
      await page.locator('[data-sprint-step="resume"]').click();
      await page.locator('#analyzeBtn').click();
      assert.ok((await page.locator('#diagnosis').innerText()).includes('本次目标：数据分析师'));
      assert.ok((await page.locator('#diagnosis').innerText()).includes('JD 字面覆盖'));
    });

    await test('Preparation generates three relevant written questions and reviews actual answers', async () => {
      await page.locator('[data-sprint-step="practice"]').click();
      await page.locator('#generateWrittenBtn').click();
      assert.equal(await page.locator('#writtenQuestions .written-item').count(), 3);
      assert.ok((await page.locator('#writtenQuestions').innerText()).includes('SQL'));
      for (let i = 0; i < 3; i++) await page.locator(`#writtenAnswer${i}`).fill('首先确认业务目标和指标口径，检查数据质量与重复记录，使用SQL按用户和日期分组统计，分析原因后提出方案并复盘验证结果。');
      await page.locator('#reviewWrittenBtn').click();
      assert.equal(await page.locator('#writtenQuestions .review').count(), 3);
    });

    await test('Preparation runs four actual interview exchanges and exports a record', async () => {
      await page.locator('#startBtn').click();
      const answer = '我申请数据分析师，曾负责校园数据分析项目。我先确认需求、目标和指标，再使用Python和SQL清洗数据，设计对照分析并协调团队完成报告。项目交付后收集反馈，验证结果显示效率提升15%，随后复盘数据质量与方案风险。希望了解团队业务目标、协作方式和岗位成长要求。';
      await page.locator('#answer').fill(answer);
      await page.locator('[data-sprint-step="resume"]').click();
      await page.goBack();
      await page.reload();
      assert.equal(await page.locator('#answer').inputValue(), answer);
      for (let i = 0; i < 4; i++) {
        assert.ok(await page.locator('#answerWrap').isVisible());
        await page.locator('#answer').fill(answer);
        await page.locator('#submitBtn').click();
      }
      assert.equal(await page.locator('#transcript .turn').count(), 4);
      assert.ok((await page.locator('#interviewStatus').innerText()).includes('四轮练习已完成'));
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#exportBtn').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), '求职练习记录.txt');
      await download.saveAs(resolve(ARTIFACTS, 'legacy-practice-record.txt'));
      const record = await readFile(resolve(ARTIFACTS, 'legacy-practice-record.txt'), 'utf8');
      assert.ok(record.includes('数据分析师'));
      assert.ok(record.includes('SQL'));
    });

    await test('Preparation refresh restores answers without mutating assessment or history', async () => {
      await page.reload({ waitUntil: 'load' });
      assert.equal(await page.locator('#role').inputValue(), '数据分析师');
      assert.equal(await page.locator('#transcript .turn').count(), 4);
      assert.equal(await page.locator('#writtenQuestions .written-item').count(), 3);
      assert.equal(await page.locator('#writtenQuestions .review').count(), 3);
      assert.ok((await page.locator('#writtenAnswer0').inputValue()).includes('SQL'));
      assert.deepEqual(await saved('careerPredictor'), currentBefore);
      assert.deepEqual(await saved('careerPredictorHistory'), historyBefore);
      assert.ok(await saved('careerPredictorPrep'));
      // Diagnosis is intentionally computed per visit, so rerun its real UI
      // action after checking restoration to include it in the screenshot.
      await page.locator('[data-sprint-step="resume"]').click();
      await page.locator('#analyzeBtn').click();
      await screenshot('legacy-prep.png');
    });
  } catch (_) { /* Detailed failure is retained in the report. */ }

  const unexpectedDialogs = results.dialogs.filter(item => !item.expected);
  if (unexpectedDialogs.length) results.tests.push({ name: 'No unexpected browser dialogs', category: 'runtime', status: 'failed', detail: unexpectedDialogs });
  if (results.browserErrors.length) results.tests.push({ name: 'No uncaught browser errors', category: 'runtime', status: 'failed', detail: results.browserErrors });
} finally {
  results.completedAt = new Date().toISOString();
  results.summary = { passed: results.tests.filter(t => t.status === 'passed').length, failed: results.tests.filter(t => t.status === 'failed').length };
  await writeFile(resolve(ARTIFACTS, 'legacy-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  await context.close();
  await browser.close();
  console.log(JSON.stringify(results.summary));
  process.exitCode = results.summary.failed ? 1 : 0;
}
