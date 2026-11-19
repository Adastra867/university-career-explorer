// Local interaction regressions; no real model calls or existing browser data.
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-runtime.mjs';

const base = process.env.CAREER_TEST_BASE_URL || 'http://localhost:5174';
const browser = await launchBrowser();
const checks = [];
try {
  for (const viewport of [{ width: 1360, height: 850 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/journey/career-prep/analyze', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled offline' }) }));
    await page.goto(base + '/career-prep.html#resume', { waitUntil: 'domcontentloaded' });
    const resume = '本科阶段参加电商课程项目，使用 SQL 按日汇总订单并核对数据，完成课程报告。现在希望申请数据分析相关岗位。';
    await page.fill('#resume', resume);
    await page.click('#analyzeBtn');
    assert.ok(page.url().endsWith('#resume'), 'Missing target must not silently switch steps');
    assert.equal(await page.locator('#sprintValidation').isVisible(), true);
    assert.match(await page.locator('#sprintValidationText').innerText(), /当前阶段.*目标岗位.*方向确认/);
    assert.equal(await page.inputValue('#resume'), resume);
    await page.locator('[data-sprint-step="practice"]').click();
    await page.click('#startBtn');assert.ok(page.url().endsWith('#practice'));
    assert.equal(await page.locator('#sprintValidation').isVisible(),true);
    await page.click('#generateWrittenBtn');assert.ok(page.url().endsWith('#practice'));
    await page.click('#sprintFixTarget');
    assert.ok(page.url().endsWith('#target'));
    await page.click('#sprintNext'); assert.ok(page.url().endsWith('#target'));
    await page.selectOption('#stage', 'senior'); await page.fill('#role', '数据分析师'); await page.check('#confirmed');
    await page.click('#sprintNext'); assert.ok(page.url().endsWith('#resume'));
    await page.check('#prepAIEnabled'); await page.click('#analyzeBtn');
    await page.waitForFunction(() => document.querySelector('#sprintAIStatus').textContent.includes('保留规则诊断'));
    assert.ok(page.url().endsWith('#resume'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(page.url().endsWith('#resume')); assert.equal(await page.inputValue('#resume'), resume);
    await page.locator('[data-sprint-step="practice"]').click(); await page.goBack();
    assert.ok(page.url().endsWith('#resume'));
    await page.goto(base + '/index.html#intelligence', { waitUntil: 'domcontentloaded' });
    const mobile = viewport.width < 850;
    async function sidebarSettings() {
      if (mobile) await page.click('#ciSidebarToggle');
      await page.click('#ciShowSettings');
    }
    const isOpen = () => page.locator('#ciContext').evaluate(e => e.open);
    await sidebarSettings(); assert.equal(await isOpen(), true);
    if(!mobile){await sidebarSettings();assert.equal(await isOpen(),false,'Sidebar settings is a toggle');}
    else{await page.click('#ciCloseSettings');assert.equal(await isOpen(),false);}
    await page.click('#ciSettingsButton'); assert.equal(await isOpen(), true);
    await page.click('#ciSettingsButton'); assert.equal(await isOpen(), false);
    await sidebarSettings(); await page.keyboard.press('Escape'); assert.equal(await isOpen(), false);
    await sidebarSettings(); await page.click('#ciMessage'); assert.equal(await isOpen(), false);
    await sidebarSettings(); await page.click('#ciCloseSettings'); assert.equal(await isOpen(), false);
    await page.focus('#ciSettingsButton'); await page.keyboard.press('Enter'); assert.equal(await isOpen(), true);
    await page.keyboard.press('Escape'); assert.equal(await isOpen(), false);
    await page.waitForFunction(() => document.querySelector('#ciShowSettings').getAttribute('aria-expanded') === 'false');
    // Use real navigation to ensure settings and CI scroll locking do not leak to other pages.
    await page.locator('.career-nav [data-career-nav="direction"]').first().click();
    assert.equal(await isOpen(), false);
    assert.equal(await page.locator('body').evaluate(e => e.classList.contains('ci-active')), false);
    assert.equal(await page.evaluate(() => document.querySelector('.career-nav').inert), false);
    assert.deepEqual(errors, []);
    checks.push({ viewport, passed: true });
    await context.close();
  }
  console.log(JSON.stringify({ checks, realModelCalls: 0 }));
} finally { await browser.close(); }
