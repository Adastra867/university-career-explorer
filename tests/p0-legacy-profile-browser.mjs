import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from './browser-runtime.mjs';

const origin = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/,'');
const browser = await launchBrowser();
const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
const result = {baseUrl:origin,mode:'real-local-browser-and-sqlite',checks:[],errors:[]};
const page = await context.newPage();
page.on('pageerror',error=>result.errors.push(error.message));
const request = async(path,method='GET',body,csrf='')=>{
  const response=await context.request.fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json','Origin':origin,...(csrf?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{data:body})});
  assert.ok(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
};
let csrf;
const jd='本科及以上，使用 Python、SQL、Excel、MATLAB 处理实验数据';
async function fit(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'main viewport must not overflow at 390px');}
try {
  const session=await request('/guest-session','POST',{consent:true,notice_version:'p0-v1'});csrf=session.csrf_token;
  await request('/me/profile','PATCH',{expected_revision:session.profile.profile_revision,patch:[{field_path:'education.degree',value:'本科'},{field_path:'education.major',value:'测试能源专业'},{field_path:'experience.text',value:'我会一点 Python，使用 SQL 与 Excel 记录太阳能电池实验数据。'}]},csrf);
  await page.goto(origin+'/index.html',{waitUntil:'load'});
  await page.waitForFunction(()=>window.CareerProfile?.profile?.fields?.['education.major']?.value==='测试能源专业');
  assert.equal(await page.locator('#majorInput').inputValue(),'测试能源专业');
  assert.match(await page.locator('#experienceInput').inputValue(),/会一点 Python/);
  assert.equal(await page.locator('#p0-entry-title').textContent(),'你现在最想解决哪件事？');
  assert.equal(await page.locator('.career-task-card').count(),4);
  await fit();result.checks.push('390px homepage, four tasks and canonical cloud fields');

  await page.goto(origin+'/index.html#direction/major');
  await page.reload();
  await page.waitForFunction(()=>window.CareerProfile?.profile);
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/me/profile')&&response.request().method()==='PATCH');
  await page.locator('#majorInput').fill('测试材料专业');
  assert.ok((await saved).ok());
  assert.equal((await request('/me/profile')).fields['education.major'].value,'测试材料专业');
  result.checks.push('homepage active edit persists to real SQLite profile');

  await page.evaluate(()=>goToStep(4));
  await page.locator('#jdManualTab').click();await page.locator('#jdInput').fill(jd);
  await page.locator('button[onclick="matchJD()"]').click();
  const homepageScore=await page.evaluate(()=>appData.jdMatchResult.matchScore);
  assert.equal(homepageScore,75);
  await page.evaluate(()=>goToStep(5));
  assert.equal(await page.locator('#reportMatchScore').textContent(),'75%');
  await fit();result.checks.push('homepage JD and report share canonical 75% result at 390px');

  await page.goto(origin+'/job-search.html',{waitUntil:'load'});
  await page.waitForFunction(()=>window.CareerProfile?.profile?.fields?.['education.major']?.value==='测试材料专业');
  await page.locator('#manualJD').fill(jd);await page.locator('button[onclick="analyzeManualJD()"]').click();
  assert.match(await page.locator('#manualResult').innerText(),/75%/);
  await fit();result.checks.push('standalone JD uses the same live profile and score at 390px');

  await page.goto(origin+'/career-prep.html',{waitUntil:'load'});
  await page.waitForFunction(()=>window.CareerProfile?.profile?.fields?.['education.major']?.value==='测试材料专业');
  assert.match(await page.locator('#resume').inputValue(),/会一点 Python/);
  await fit();result.checks.push('preparation reads the same original experience at 390px');

  // Clear a shared field and verify an existing page cannot keep presenting its old value.
  const profile=await request('/me/profile');
  await request('/me/profile','PATCH',{expected_revision:profile.profile_revision,patch:[{field_path:'experience.text',value:null}]},csrf);
  await page.evaluate(()=>window.CareerProfile.refresh());
  assert.equal(await page.locator('#resume').inputValue(),'');
  result.checks.push('explicit shared-field clearing reaches preparation');

  await page.goto(origin+'/index.html#direction/major');
  await page.waitForFunction(()=>window.CareerProfile?.profile);
  await page.locator('#majorInput').fill('切换页面后同步测试专业');
  await page.locator('.career-more').click();
  await page.locator('.career-mobile-link[data-career-nav="sprint"]').click();
  await page.waitForFunction(()=>window.CareerProfile?.profile?.fields?.['education.major']?.value==='切换页面后同步测试专业');
  await page.goBack();
  await page.locator('#majorInput').waitFor();
  assert.equal(await page.locator('#majorInput').inputValue(),'切换页面后同步测试专业');
  result.checks.push('shared-profile edit survives navigation before the save timer');
  assert.deepEqual(result.errors,[]);
} finally {
  // Only the synthetic identity created by this test is deleted.
  if(csrf)await request('/me/data','DELETE',{},csrf).catch(error=>result.errors.push(error.message));
  await mkdir(resolve('artifacts','p0'),{recursive:true});
  await writeFile(resolve('artifacts','p0','legacy-profile-browser.json'),JSON.stringify(result,null,2)+'\n');
  await context.close();await browser.close();
}
console.log(JSON.stringify(result,null,2));
