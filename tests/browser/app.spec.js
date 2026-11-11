import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ context }) => {
 await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['127.0.0.1','localhost'].includes(url.hostname) || ['data:','blob:'].includes(url.protocol)) return route.continue();
  return route.abort('blockedbyclient');
 });
});
test.afterEach(async ({ page }) => {
 const me = await page.request.get('/api/auth/me');
 if (me.ok()) await page.request.delete('/api/auth/account', { data: { password: 'browser-test-password' } });
});
test('account, explicit cloud sync, local backup, persistent restoration and deletion',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('#account-open').click();
 await page.locator('#account-email').fill(`browser-${randomUUID()}@example.com`);
 await page.locator('#account-password').fill('browser-test-password');
 await page.getByRole('button',{name:'注册并登录',exact:true}).click();await expect(page.locator('#account-user')).toBeVisible();
 await page.evaluate(()=>localStorage.setItem('careerPredictor',JSON.stringify({studentProfile:{major:'测试专业',education:'undergraduate',employmentChoice:'same'},experienceText:'使用SQL完成分析'})));
 page.on('dialog',dialog=>{if(dialog.type()==='prompt')dialog.accept('browser-test-password');else dialog.accept();});
 await page.locator('#cloud-upload').click();await expect(page.locator('#cloud-status')).toHaveText('已保存到云端');
 const downloadPromise=page.waitForEvent('download');await page.locator('#cloud-export').click();expect((await downloadPromise).suggestedFilename()).toContain('云端备份');
 await page.evaluate(()=>localStorage.setItem('careerPredictor',JSON.stringify({studentProfile:{major:'错误本地值'}})));
 const load=page.waitForEvent('load');await page.locator('#cloud-load').click();await load;await expect(page.locator('#account-open')).toHaveText('账号与云端 · 已登录');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('careerPredictor')).studentProfile.major)).toBe('测试专业');
 await page.locator('#account-open').click();const deleted=page.waitForEvent('load');await page.locator('#account-delete').click();await deleted;
 await page.locator('#account-open').click();await expect(page.locator('#account-form')).toBeVisible();
 expect(errors).toEqual([]);
});

test('all pages load and local JD matching has no fabricated score',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 const result=await page.evaluate(async()=>{const {matchEvidence}=await import('/js/matching.js');return matchEvidence('需要SQL与Python','使用SQL完成分析',{tools:['SQL','Python']});});expect(result.matchScore).toBe(50);
 for(const url of ['/job-search.html','/career-prep.html']){await page.goto(url);await expect(page.locator('#account-open')).toBeVisible();}
 await expect(page.getByRole('heading',{name:'方向已定，开始准备投递'})).toBeVisible();expect(errors).toEqual([]);
});
test('mobile layout keeps account controls in viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/career-prep.html');await page.locator('#account-open').click();await expect(page.locator('#account-panel')).toBeVisible();
 expect(await page.locator('#account-panel').evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBeTruthy();
});
test('AI consent, evidence rendering, JD analysis and chat UI with controlled responses',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('#account-open').click();
 await page.locator('#account-email').fill(`browser-${randomUUID()}@example.com`);await page.locator('#account-password').fill('browser-test-password');await page.locator('#account-register').click();await expect(page.locator('#account-user')).toBeVisible();
 await page.locator('#cloud-ai-consent').check();await page.locator('#account-close').click();
 await page.evaluate(()=>{goToStep(3);document.getElementById('experienceInput').value='项目中使用SQL完成分析';analyzeExperience();});
 await expect(page.locator('#experienceResult')).toContainText('SQL：使用SQL完成分析');
 await page.evaluate(()=>{goToStep(4);switchJDMode('manual');document.getElementById('jdInput').value='要求熟悉SQL';matchJD();});
 await expect(page.locator('#matchResultContent')).toContainText('经历证据：使用SQL完成分析');
 await page.evaluate(()=>openCareerAssistant());await page.locator('#chatInput').fill('如何写简历？');await page.evaluate(()=>sendChat());await expect(page.locator('#chatArea')).toContainText('用真实经历说明行动与成果');await expect(page.locator('#chatArea a')).toHaveAttribute('href',/careerservices\.fas\.harvard\.edu/);
 await page.evaluate(()=>closeCareerAssistant());page.on('dialog',d=>d.type()==='prompt'?d.accept('browser-test-password'):d.accept());await page.locator('#account-open').click();const deleted=page.waitForEvent('load');await page.locator('#account-delete').click();await deleted;expect(errors).toEqual([]);
});
test('report restores saved evidence and exports PDF',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>{
  appData.studentProfile={major:'计算机科学',education:'undergraduate',employmentChoice:'same'};
  appData.experienceText='项目中使用SQL完成分析';
  appData.experienceAnalysis={...extractSkills(appData.experienceText),evidence:[{name:'SQL',evidence:'使用SQL完成分析'}],questions:['结果是什么？']};
  appData.softSkills={communication:60,leadership:50,collaboration:70,analysis:80,execution:70,stress:50,learning:80,adaptability:60,empathy:60};
  goToStep(5);
 });
 await expect(page.locator('#reportContent')).toBeVisible();await expect(page.locator('#reportContent')).toContainText('计算机科学');
 await expect.poll(()=>page.evaluate(()=>typeof window.html2pdf),{timeout:20000}).toBe('function');
 const file=page.waitForEvent('download',{timeout:45000});await page.locator('#exportPdfButton').click();const download=await file;expect(download.suggestedFilename()).toMatch(/\.pdf$/);
 const fs=await import('node:fs/promises');const bytes=await fs.readFile(await download.path());expect(bytes.subarray(0,4).toString()).toBe('%PDF');expect(bytes.length).toBeGreaterThan(10000);
});
