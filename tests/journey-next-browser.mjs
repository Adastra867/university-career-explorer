import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { launchBrowser } from './browser-runtime.mjs';
import { createGraph, applyOperations } from '../journey/graph.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'artifacts', 'journey-next');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
// The embedded bytes are the visually checked one-page ReportLab fixture, so
// a fresh checkout does not depend on an externally supplied PDF or Python.
const PDF_FIXTURE_BASE64 = 'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDU5NS4yNzU2IDg0MS44ODk4IF0gL1BhcmVudCA3IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNyAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMDEzMjAzMDE2KzA4JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYxMDEzMjAzMDE2KzA4JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKEpvdXJuZXkgZG9jdW1lbnQgcGFyc2luZyBmaXh0dXJlKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA0ODUKPj4Kc3RyZWFtCkdhczJGaCtsdWEmO0JUTSdeJ0wmQzVDPlRKUjBPKEJiPmkoJT4oWSczMFZwMEBMKFhyMmZISHBaa1hdW1BwZlBNVVtzSmspMWUibzBtbipRUzRPXFAiQE5HczZLQ11KSCY5J08tIVglOlNSaDVqZEVuLiU5RGJsLmY+Q1VuUTJAITBwbT1pbXI0JF5KXCglKmpcdWooRDFzLSY1PSIpPi5mUW9UL0kiPUU4JDRMbC5eYUlBJzxrJkM/bkYrWkIyKz05OzNOWGMhJExzWkJMMzQqTl9OZ3RGTDxpanNSaDFPYm5GWUVROk9RVUApPzBebjRlMycia28tPTBcNUpHT2I2MikrWSJhVlw+dWA1UWQ8T1hZV1E7WXRbJiw0P09dQzQ6ZTUmT2k0S3IvRjYrPl9GIjFRam8mTl5aPE83Tk47O3M/RDEyLDJXK0QwbUUkYGMvSUhAOnE0IlpWX1NaUiMtUlpTUmovVSdic3FPb0wyUFxCWThbSiJhT2NXIl1QO0ZtSyoiOF80XGM1JmAiUDcxTC9famhkK1IjUUZIJThqbDRtZV1ZQnBoWlNcLy88KHQjXEhvYmYuLTdAXF9TOFw8PDM5J3JtY0ZqI25hSCY4R21oVFJCcjlHLCxvSDJISWNtU34+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMjA5IDAwMDAwIG4gCjAwMDAwMDAzMjEgMDAwMDAgbiAKMDAwMDAwMDUyNCAwMDAwMCBuIAowMDAwMDAwNTkyIDAwMDAwIG4gCjAwMDAwMDA4NzcgMDAwMDAgbiAKMDAwMDAwMDkzNiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzwxMWExYmI5ZWI2ZmYyODkxYzMyNjA0MWUwZTkxOWJiMj48MTFhMWJiOWViNmZmMjg5MWMzMjYwNDFlMGU5MTliYjI+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDYgMCBSCi9Sb290IDUgMCBSCi9TaXplIDkKPj4Kc3RhcnR4cmVmCjE1MTEKJSVFT0YK';
const GRAPH_KEY = 'shiyu-zuxia.graph.v1';
// Valid synthetic PDF with 19,999 page-text characters. Its page marker makes
// the imported text 20,005 characters, so the final-text contract must reject it.
const PDF_BOUNDARY_COMPRESSED = 'eJzt3M9q20AQx/G7nuJ3MbSHdnf1xyQQArUbU2hDg6NbyEGJ166CKxVpXdI+fVhZNKbqA/Tw/SCENDszO08ws5uPq3fufZ44WbUPT8nFhUz564eXWVah2rc7mZtq53ulslrr8jLxzSYmppOCY575XG963WUx/V5m2R6aIHdSmP2zML4734TxHnPtN3W1aJ91Z2WVWWutUmvvZda+bw/do+8VO6zaJhw/nPJxxPiYZdsE34RexV+D55P7hx7m9vAQht8YdDKLqvfHk09+/9OH+rE66VKcdPnim134FsdLz2JKHzpffU8W5TCVU7mVlbNW5UZvPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gdvVT7pqoxr5sY1cuPCuefObxOreWL/0LwoskJbvcbOdTxpXmPF2STmXDGJpXk2iWXuJBa6qt77bth4d1v/9prLrNs2LvcbF+z1oerCMGdqs/M8mc2uvq5eAFrrbSk=';
const WORKSPACE_KEY = 'shiyu-zuxia.workspace.v1';
const SECRET = '合成私密家庭计划不可外传';
const REFLECTION = '合成私密反思：我在研究如何安排家庭与旅行，这不是人格结论。';
const results = { baseUrl: BASE, startedAt: new Date().toISOString(), tests: [], screenshots: [], browserErrors: [], networkFailures: [], limitations: [], syntheticDataOnly: true };
await mkdir(OUT, { recursive: true });
const hash = text => createHash('sha256').update(text).digest('hex');

function seededGraph() {
  let graph = createGraph({ title: '合成双路线与人生选择' });
  const add = (tempId, title, kind, extra = {}) => ({ op: 'add_node', tempId, node: { title, kind, ...extra } });
  const link = (fromId, toId) => ({ op: 'add_edge', fromId, toId, relation: 'possible_path' });
  graph = applyOperations(graph, [
    add('major', '材料专业探索', 'major'), add('study', '剑桥材料硕士探索', 'education'), add('work', '本科就业探索', 'milestone'),
    add('research', '读研后研发', 'career'), add('industry', '企业研发实践', 'career'), add('secret', SECRET, 'lifestyle', { private: true }),
    link(graph.rootNodeId, 'major'), link('major', 'study'), link('major', 'work'), link('study', 'research'), link('work', 'industry'), link(graph.rootNodeId, 'secret'),
  ]);
  const [common, study, work, research, industry] = graph.edges;
  graph = applyOperations(graph, [
    { op: 'annotate_edge', edgeId: common.id, requirements: [{ kind: 'skill', label: 'SQL', detail: '用户想验证的数据项目能力', assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: study.id, requirements: [{ kind: 'time', label: '用户预估准备时间', detail: '仅是规划估计', durationMonths: { min: 12, max: 24 }, assessment: 'unknown' }, { kind: 'certificate', label: '目标项目英语要求', detail: '应查具体大学，不能假定已满足', assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: work.id, requirements: [{ kind: 'cost', label: '生活成本', detail: '尚未提供数额', assessment: 'missing' }] },
    { op: 'annotate_edge', edgeId: research.id, requirements: [{ kind: 'skill', label: 'Python', assessment: 'unknown' }] },
    { op: 'annotate_edge', edgeId: industry.id, requirements: [{ kind: 'skill', label: 'Python', assessment: 'unknown' }] },
    { op: 'save_path', title: '深造备选路线', edgeIds: [common.id, study.id, research.id] },
    { op: 'save_path', title: '就业备选路线', edgeIds: [common.id, work.id, industry.id] },
  ]);
  return graph;
}
const seed = seededGraph();
const legacy = {
  careerPredictor: JSON.stringify({ studentProfile: { education: 'undergraduate', major: '材料科学与工程', employmentChoice: 'unsure' }, experienceText: '合成测试经历：负责SQL和Python数据项目，使用Excel完成报告并整理作品，协调团队验证结果。', experienceAnalysis: { skills: ['SQL', 'Python'], tools: ['Excel'], domains: ['数据'], keywords: ['SQL', 'Python', 'Excel'], abilityScores: { technicalSkill: 85 } }, softSkills: { communication: 88 }, directionRanking: ['synthetic_data'], directionSnapshots: [{ id: 'synthetic_data', direction: '研发与数据实践', jobs: ['研发助理'] }], jobSearchPreferences: { location: '上海' }, chatHistory: [{ content: '合成旧聊天禁止导入' }] }),
  careerPredictorHistory: JSON.stringify({ schemaVersion: 1, legacyImported: true, records: [{ id: 'synthetic_preservation_record', synthetic: true }] }),
  careerPredictorPrep: JSON.stringify({ stage: 'senior', role: '合成研发助理', confirmed: true, resume: '合成简历禁止整份自动导入', transcript: [] }),
};
const baseline = Object.fromEntries(Object.entries(legacy).map(([key, value]) => [key, hash(value)]));
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true, reducedMotion: 'reduce' });
context.setDefaultTimeout(12000);
await context.addInitScript(({ keys, seed, graphKey }) => {
  for (const [key, value] of Object.entries(keys)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  if (localStorage.getItem(graphKey) === null) localStorage.setItem(graphKey, JSON.stringify({ storageVersion: 1, serial: 'synthetic-next-browser-seed', graph: seed, undo: [], redo: [], snapshots: [], ui: { entered: true, selected: [seed.rootNodeId], collapsed: [] } }));
}, { keys: legacy, seed, graphKey: GRAPH_KEY });
const page = await context.newPage();
const outgoing = [];
let controlledNetworkFailure = false;
page.on('pageerror', error => results.browserErrors.push(error.message));
page.on('requestfailed', request => results.networkFailures.push({ url: request.url(), error: request.failure()?.errorText, expected: controlledNetworkFailure }));
page.on('request', request => {
  if (request.method() === 'POST' && request.url().includes('/api/journey/')) {
    try { outgoing.push({ url: request.url(), body: JSON.parse(request.postData() || '{}') }); } catch (_) { /* Non-JSON uploads are not expected. */ }
  }
});
const scoped = async key => page.evaluate(async ({ key, id }) => {
  const { TreeLibrary } = await import('/journey/forest.js');
  return JSON.parse(new TreeLibrary(localStorage).scopedStorage(id).getItem(key) || 'null');
}, { key, id: new URL(page.url()).pathname.split('/')[2] });
const current = async () => (await scoped(GRAPH_KEY)).graph;
const workspace = async () => scoped(WORKSPACE_KEY);
const stored = async () => scoped(GRAPH_KEY);
const flush = async () => { await page.locator('#save').click(); assert(await stored()); };
async function waitForSaved(predicate, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await predicate()) return; await page.waitForTimeout(60); }
  assert.fail(`Timed out waiting for ${label}`);
}
async function check(name, fn, mode = 'real-ui-synthetic-data') {
  const at = Date.now();
  try { const detail = await fn(); results.tests.push({ name, mode, passed: true, durationMs: Date.now() - at, ...(detail === undefined ? {} : { detail }) }); console.log(`PASS ${name}`); return detail; }
  catch (error) { results.tests.push({ name, mode, passed: false, durationMs: Date.now() - at, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function tree() { if (!await page.locator('#mainpanel').isVisible()) await page.locator('#mobileTree').click(); }
async function tool(tab) { await tree(); await page.locator('#workspaceTool').selectOption(tab); await page.locator('#panelScroll').evaluate(element => { element.scrollTop = 0; }); }
async function find(title) { await tree(); await page.locator('#search').fill(title); await page.locator('#find').click(); }
async function confirm() { await page.locator('#confirmDialog').waitFor({ state: 'visible' }); await page.locator('#confirmAction').click(); await page.locator('#confirmDialog').waitFor({ state: 'hidden' }); }
async function screen(name, focusSelector) {
  if (focusSelector) await page.locator(focusSelector).first().evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  else await page.locator('#panelScroll').evaluate(element => { element.scrollTop = 0; });
  await page.waitForFunction(() => !document.getElementById('toast')?.classList.contains('visible'));
  await page.screenshot({ path: resolve(OUT, name), animations: 'disabled' }); results.screenshots.push(resolve(OUT, name));
}
async function downloadBy(selector, filename, withConfirmation = false) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  if (withConfirmation) await confirm();
  const item = await pending;
  await item.saveAs(resolve(OUT, filename));
  return await readFile(resolve(OUT, filename), 'utf8');
}
async function ask(question) {
  await page.locator('#chatTab').click();
  await page.locator('#question').fill(question);
  const pending = page.waitForResponse(response => /\/api\/journey\/ai\/chat$/.test(response.url()) && response.request().method() === 'POST');
  await page.locator('#send').click();
  const response = await pending;
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  assert.ok([200, 503].includes(response.status()));
  return { response, request: outgoing.filter(item => item.url.endsWith('/ai/chat')).at(-1).body };
}
async function addNode(title, kind) {
  await tree(); await page.locator('#add').click();
  await page.locator('#custom').fill(title); await page.locator('#newKind').selectOption(kind);
  await page.locator('#confirmGrow').click(); await page.locator('#growDialog').waitFor({ state: 'hidden' }); await flush();
  return (await current()).nodes.find(node => node.title === title);
}
const commonEdgeId = seed.edges[0].id;
const studyEdgeId = seed.edges[1].id;
let retainedTaskId;
let archiveText;

try {
  await check('P1-01 independent extended workspace loads the synthetic two-route graph', async () => {
    const response = await page.goto(`${BASE}/journey`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.locator('#start').click();
    await page.locator('#intro').waitFor({ state: 'hidden' });
    await page.locator('#savedTrees [data-act="open"]').first().click();
    await page.waitForURL(/\/trees\/[^/]+$/);
    await page.locator('#canvas').waitFor({ state: 'visible' });
    assert.equal((await current()).savedPaths.length, 2);
    assert.equal(await page.locator('#workspaceTool option').count(), 8);
    assert.equal((await current()).nodes.length, seed.nodes.length);
  });

  await check('P1-02 field import, preview, explicit AI use and major creation leave all legacy keys unchanged', async () => {
    await tool('profile');
    assert.ok((await page.locator('#profilePreview').innerText()).includes('还没有授权'));
    assert.ok(!(await page.locator('#panelScroll').innerText()).includes('合成旧聊天'));
    await page.locator('#profileForm').getByRole('button', { name: '读取所选资料', exact: true }).click();
    const imported = await workspace();
    assert.equal(imported.profile.major, '材料科学与工程');
    assert.equal(imported.profile.source, 'legacy-career');
    assert.equal(imported.useProfile, false);
    assert.doesNotMatch(JSON.stringify(imported.profile), /合成旧聊天|合成简历禁止整份/);
    const count = (await current()).nodes.length;
    await page.locator('#applyMajor').click(); await flush();
    assert.equal((await current()).nodes.length, count + 1);
    assert.ok((await current()).nodes.some(node => node.title === '材料科学与工程'));
    await tool('profile'); await page.locator('#profileUse').check();
    assert.equal((await workspace()).useProfile, true);
    const actualKeys = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(legacy));
    for (const [key, value] of Object.entries(actualKeys)) assert.equal(hash(value), baseline[key], key);
    await screen('profile-desktop.png');
  });

  await check('P1-03 actual AI payload follows profile authorization and stops after revocation', async () => {
    await find('读研后研发');
    const allowed = await ask('请根据当前规划提出一个开放问题，不推断我的能力或人格。');
    assert.equal(allowed.request.profile?.major, '材料科学与工程');
    assert.equal(allowed.request.profile?.consent, true);
    await tool('profile'); await page.locator('#revokeProfile').click();
    assert.equal((await workspace()).profile, null);
    assert.equal((await workspace()).useProfile, false);
    const revoked = await ask('只根据人生树的公开部分继续提问。');
    assert.equal(revoked.request.profile, undefined);
    assert.doesNotMatch(JSON.stringify(revoked.request.history || []), /材料科学与工程/);
    if (revoked.response.status() === 503) results.limitations.push('Actual AI requests return 503 because the provider is unconfigured; consent payloads and error recovery were exercised, not a live generated answer.');
    return { authorizedRequestStatus: allowed.response.status(), revokedRequestStatus: revoked.response.status(), profileRemoved: true };
  }, 'real-network-ui');

  await check('P1-04 a real one-page PDF parses locally and stays unshared until explicitly selected', async () => {
    const pdf = await readFile(resolve(OUT, 'document-fixture.pdf')).catch(async () => {
      const fixture = Buffer.from(PDF_FIXTURE_BASE64, 'base64');
      await writeFile(resolve(OUT, 'document-fixture.pdf'), fixture);
      return fixture;
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await tool('research');
    await page.locator('#documentFile').setInputFiles({ name: 'document-fixture.pdf', mimeType: 'application/pdf', buffer: pdf });
    await waitForSaved(async () => (await workspace())?.documents?.length === 1, 'local PDF parsing into this tree workspace');
    const before = await workspace();
    assert.equal(before.documents.length, 1, await page.locator('#documentProgress').innerText());
    assert.equal(before.documents[0].kind, 'pdf_excerpt');
    assert.match(before.documents[0].text, /JOURNEY_PDF_FIXTURE_20261013/);
    assert.match(before.documents[0].locator, /1/);
    assert.equal(before.documents[0].shareWithAI, false);
    assert.equal(before.useDocuments, false);
    await page.locator('[data-share-document]').check();
    const call = await ask('请仅说明这份合成文档提醒我核对哪些事情。');
    assert.equal(call.request.documents.length, 1);
    assert.match(call.request.documents[0].text, /JOURNEY_PDF_FIXTURE_20261013/);
    assert.equal(call.request.profile, undefined);
    return { pages: before.documents[0].pages.length, locator: before.documents[0].locator, localOnlyBeforeConsent: true };
  });

  await check('P1-04b PDF final-text limit includes page markers and preserves existing workspace on rejection', async () => {
    const pdf = await readFile(resolve(OUT, 'document-boundary.pdf')).catch(async () => {
      const fixture = inflateSync(Buffer.from(PDF_BOUNDARY_COMPRESSED, 'base64'));
      await writeFile(resolve(OUT, 'document-boundary.pdf'), fixture);
      return fixture;
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await tool('research');
    await flush();
    const graphBefore = await current(), workspaceBefore = await workspace(), requestsBefore = outgoing.length;
    await page.locator('#documentFile').setInputFiles({ name: 'document-boundary.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => document.getElementById('documentProgress')?.textContent.includes('超过 20,000 字'));
    assert.deepEqual(await current(), graphBefore);
    assert.deepEqual(await workspace(), workspaceBefore, 'a rejected PDF must not replace or add documents');
    assert.equal(outgoing.length, requestsBefore, 'oversized text must be rejected in the browser before sending');
    assert.equal((await workspace()).documents.length, 1);
    await page.reload({ waitUntil: 'networkidle' }); await page.locator('#intro').waitFor({ state: 'hidden' });
    await tool('research');
    assert.equal(await page.locator('.document-card').count(), 1, 'valid existing documents survive refresh');
    assert.match((await workspace()).documents[0].text, /JOURNEY_PDF_FIXTURE_20261013/);
    assert.ok((await workspace()).documents[0].text.length <= 20000);
    assert.equal(await page.locator('[data-share-document]').isChecked(), false, 'refresh does not silently restore permission');
    await page.locator('[data-share-document]').check();
    return { fixturePageTextCharacters: 19999, serializedTextCharactersWithoutFix: 20005, rejectedBeforePersistence: true, existingDocumentsPreserved: 1 };
  });

  await check('P1-05 actual local knowledge retrieval cites the Cambridge original and a check date', async () => {
    await find('剑桥材料硕士探索');
    await page.locator(`[data-edge="${studyEdgeId}"]`).click();
    await tool('research');
    await page.locator('#researchQuestion').fill('剑桥大学材料科学与冶金硕士 MPhil 的 IELTS 英语要求是什么？');
    const pending = page.waitForResponse(response => response.url().endsWith('/api/journey/research') && response.request().method() === 'POST');
    await page.locator('#runResearch').click();
    const response = await pending;
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => !document.getElementById('runResearch').disabled);
    const research = (await workspace()).research;
    const official = research.evidence.find(source => source.trustLevel === 'official' && source.url?.includes('postgraduate.study.cam.ac.uk'));
    assert.ok(official, 'Cambridge official evidence must be present');
    assert.ok(Number.isFinite(Date.parse(official.checkedAt)));
    assert.match(research.answer, /7\.0|雅思|IELTS/);
    const link = page.locator('.source-link').filter({ hasText: '打开原始来源' });
    assert.ok(await link.count() >= 1);
    assert.ok(await page.locator(`a[href="${official.url}"]`).count() >= 1);
    await screen('source-desktop.png', `.source-card:has(a[href="${official.url}"])`);
    return { title: official.title, url: official.url, checkedAt: official.checkedAt, mode: research.mode, liveSearch: false };
  }, 'real-local-knowledge-ui');

  await check('P1-06 saving and annotating an actual source require confirmation and never imply personal qualification', async () => {
    const research = (await workspace()).research;
    const index = research.evidence.findIndex(source => source.trustLevel === 'official' && source.url?.includes('postgraduate.study.cam.ac.uk'));
    const before = await current();
    await page.locator(`.save-source[data-index="${index}"]`).click();
    assert.deepEqual((await current()).sources || [], before.sources || []);
    await confirm(); await flush();
    assert.ok((await current()).sources.some(source => source.url.includes('postgraduate.study.cam.ac.uk')));
    await page.locator(`.annotate-source[data-index="${index}"]`).click();
    const count = (await current()).edges.find(edge => edge.id === studyEdgeId).requirements.length;
    await confirm(); await flush();
    const graph = await current();
    const requirements = graph.edges.find(edge => edge.id === studyEdgeId).requirements;
    assert.equal(requirements.length, count + 1);
    const annotation = requirements.at(-1);
    assert.equal(annotation.assessment, 'unknown');
    assert.equal(annotation.necessity, 'unknown');
    assert.ok(annotation.sourceIds.length > 0);
    return { sourceCount: graph.sources.length, annotationStatus: annotation.knowledgeStatus, personalAssessment: annotation.assessment };
  });

  await check('P1-06b controlled transport failure retains the previously retrieved source cache and editable graph', async () => {
    const before = await current();
    const previousEvidence = (await workspace()).research.evidence;
    controlledNetworkFailure = true;
    await page.route('**/api/journey/research', route => route.abort('failed'));
    try {
      await page.locator('#researchQuestion').fill('断网时再次核对剑桥材料硕士英语要求');
      await page.locator('#runResearch').click();
      await page.waitForFunction(() => document.getElementById('researchResults')?.textContent.includes('离线缓存'));
      assert.deepEqual((await current()).nodes, before.nodes);
      assert.deepEqual((await current()).edges, before.edges);
      assert.deepEqual((await workspace()).research.evidence, previousEvidence);
      assert.ok(await page.locator('.source-link').count() >= 1);
      await screen('source-offline-cache-desktop.png', '.source-card');
    } finally { await page.unroute('**/api/journey/research'); controlledNetworkFailure = false; }
  }, 'controlled-network-failure-ui');

  await check('P1-07 personal evidence status and a linked requirement task are real saved UI transactions', async () => {
    await find('材料专业探索');
    await page.locator(`[data-edge="${commonEdgeId}"]`).click();
    const requirement = (await current()).edges.find(edge => edge.id === commonEdgeId).requirements[0];
    await page.locator(`[data-assessment="${requirement.id}"]`).selectOption('evidenced');
    await page.locator(`[data-evidence="${requirement.id}"]`).fill('合成测试：用户已整理SQL项目作品，仍需人工核对适用性。');
    await page.locator(`.save-assessment[data-id="${requirement.id}"]`).click(); await flush();
    const saved = (await current()).edges.find(edge => edge.id === commonEdgeId).requirements[0];
    assert.equal(saved.assessment, 'evidenced');
    assert.match(saved.evidenceNote, /SQL项目作品/);
    await page.locator(`.requirement-task[data-id="${requirement.id}"]`).click(); await flush();
    const task = (await current()).tasks.find(task => task.requirementId === requirement.id);
    assert.equal(task.edgeId, commonEdgeId);
    assert.equal(task.status, 'todo');
    retainedTaskId = task.id;
  });

  await check('P1-08 two saved paths compare actual ranges/costs and export a readable report', async () => {
    await tool('compare'); await page.locator('#compareRoutes').click();
    assert.equal(await page.locator('#routeComparison .saved-path').count(), 2);
    const text = await page.locator('#routeComparison').innerText();
    assert.match(text, /12–24 个月/);
    assert.match(text, /尚未提供数额/);
    assert.match(text, /共同准备/);
    assert.match(text, /已有证据支持/);
    const report = await downloadBy('#exportReport', 'path-report.txt');
    assert.match(report, /主路线|备选路线/);
    assert.match(report, /postgraduate.study.cam.ac.uk/);
    assert.doesNotMatch(report, new RegExp(SECRET));
    assert.doesNotMatch(report, /合成旧聊天|合成简历禁止/);
    await screen('comparison-desktop.png');
    await screen('comparison-route2-desktop.png', '#routeComparison > .saved-path:nth-child(2)');
  });

  await check('P1-09 plan draft can be rejected and only explicit acceptance adds editable tasks', async () => {
    const before = (await current()).tasks.length;
    await page.locator('#createPlan').click();
    await page.locator('#acceptPlan').waitFor({ state: 'visible' });
    assert.equal((await current()).tasks.length, before);
    await page.locator('#rejectPlan').click(); assert.equal((await current()).tasks.length, before);
    await tool('compare'); await page.locator('#createPlan').click();
    await page.locator('#acceptPlan').click(); await flush();
    assert.ok((await current()).tasks.length > before);
    assert.ok((await current()).tasks.some(task => task.horizon === 'long'));
    await page.locator(`.task-edit[data-id="${retainedTaskId}"]`).click();
    await page.locator('#taskTitle').fill('合成测试：整理SQL项目作品');
    await page.locator('#taskDescription').fill('以自己完成的真实材料为准，不虚构成绩。');
    await page.locator('#taskDue').fill('2027-01-15');
    await page.locator('#taskForm').getByRole('button', { name: '保存任务', exact: true }).click(); await flush();
    assert.equal((await current()).tasks.find(task => task.id === retainedTaskId).dueDate, '2027-01-15');
    await page.locator(`.task-status[data-id="${retainedTaskId}"]`).click(); await flush();
    assert.equal((await current()).tasks.find(task => task.id === retainedTaskId).status, 'done');
    const removed = (await current()).tasks.find(task => task.id !== retainedTaskId).id;
    await page.locator(`.task-delete[data-id="${removed}"]`).click(); await flush();
    assert.ok(!(await current()).tasks.some(task => task.id === removed));
    await screen('tasks-desktop.png', '.plan-section');
  });

  await check('P2-01 four life categories are created through DIY and both support/conflict relationships are saved', async () => {
    await find('材料专业探索');
    for (const [title, kind] of [['喜欢音乐', 'passion'], ['追求自由', 'value'], ['家庭生活方式', 'lifestyle'], ['人生意义问题', 'philosophy']]) await addNode(title, kind);
    const graph = await current();
    for (const [title, kind] of [['喜欢音乐', 'passion'], ['追求自由', 'value'], ['家庭生活方式', 'lifestyle'], ['人生意义问题', 'philosophy']]) assert.equal(graph.nodes.find(node => node.title === title).kind, kind);
    await find('追求自由');
    const work = (await current()).nodes.find(node => node.title === '本科就业探索');
    await page.locator('#connectTarget').selectOption(work.id); await page.locator('#connectRelation').selectOption('conflicts_with'); await page.locator('#connectNode').click(); await flush();
    await find('喜欢音乐');
    const value = (await current()).nodes.find(node => node.title === '追求自由');
    await page.locator('#connectTarget').selectOption(value.id); await page.locator('#connectRelation').selectOption('supports'); await page.locator('#connectNode').click(); await flush();
    assert.ok((await current()).edges.some(edge => edge.relation === 'supports'));
    assert.ok((await current()).edges.some(edge => edge.relation === 'conflicts_with'));
  });

  await check('P2-02 career/value/all views filter the same graph without deleting data', async () => {
    await tree(); await page.locator('#fit').click(); await flush();
    const before = await current();
    await page.locator('#graphView').selectOption('career');
    assert.equal(await page.getByRole('button', { name: '喜欢音乐', exact: true }).count(), 0);
    assert.ok(await page.getByRole('button', { name: '本科就业探索', exact: true }).count());
    await page.locator('#graphView').selectOption('values');
    assert.ok(await page.getByRole('button', { name: '喜欢音乐', exact: true }).count());
    assert.equal(await page.getByRole('button', { name: '本科就业探索', exact: true }).count(), 0);
    await page.locator('#graphView').selectOption('all'); await flush();
    const after = await current();
    assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
    await page.locator('#search').fill('');
    await page.locator('#fit').click();
    // Fit intentionally keeps a readable minimum for long chains. A user can
    // choose a wider overview with the real zoom controls for this screenshot.
    for (let attempt = 0; attempt < 3; attempt++) {
      const fits = await page.evaluate(() => {
        const canvas = document.getElementById('canvas').getBoundingClientRect();
        return [...document.querySelectorAll('#nodes .node')].every(node => {
          const box = node.getBoundingClientRect();
          return box.left >= canvas.left + 8 && box.right <= canvas.right - 8 && box.top >= canvas.top + 8 && box.bottom <= canvas.bottom - 8;
        });
      });
      if (fits) break;
      await page.locator('#zoomOut').click();
    }
    await flush();
    await screen('life-tree-desktop.png');
  });

  await check('P2-03 reflections are private by default and never appear in real AI request payloads', async () => {
    await find('追求自由'); await tool('reflections');
    await page.locator('#reflectionText').fill(REFLECTION);
    await page.locator('#reflectionForm').getByRole('button', { name: '私密保存', exact: true }).click(); await flush();
    const reflection = (await current()).reflections.at(-1);
    assert.equal(reflection.private, true); assert.equal(reflection.text, REFLECTION);
    page.once('dialog', dialog => dialog.accept(`${REFLECTION}【本人已修改】`));
    await page.locator(`.edit-reflection[data-id="${reflection.id}"]`).click(); await flush();
    assert.ok((await current()).reflections.find(item => item.id === reflection.id).text.endsWith('【本人已修改】'));
    await page.locator('#reflectionText').fill('待删除的合成反思');
    await page.locator('#reflectionForm').getByRole('button', { name: '私密保存', exact: true }).click(); await flush();
    const temporary = (await current()).reflections.find(item => item.text === '待删除的合成反思');
    await page.locator(`.remove-reflection[data-id="${temporary.id}"]`).click(); await flush();
    assert.ok(!(await current()).reflections.some(item => item.id === temporary.id));
    const request = (await ask('请围绕自由和工作之间的选择提出开放问题。')).request;
    assert.doesNotMatch(JSON.stringify(request), new RegExp(REFLECTION));
    assert.doesNotMatch(JSON.stringify(request), new RegExp(SECRET));
    assert.equal(request.graph.reflections, undefined);
    assert.equal(request.graph.tasks, undefined);
    await tool('reflections'); await screen('reflections-desktop.png');
  }, 'real-network-privacy-ui');

  await check('P2-04 two named versions can be viewed/restored without losing later versions or conditions', async () => {
    await tool('history');
    await page.locator('#snapshotTitle').fill('合成版本 A：保留条件和任务');
    await page.locator('#snapshotNote').fill('这是合成版本记录。');
    await page.locator('#snapshotForm').getByRole('button', { name: '保存命名版本', exact: true }).click();
    const versionA = (await stored()).snapshots.find(snapshot => snapshot.title.startsWith('合成版本 A'));
    assert.ok(versionA);
    await page.locator(`.view-snapshot[data-id="${versionA.id}"]`).click();
    assert.match(await page.locator(`#snapshot-${versionA.id}`).innerText(), /SQL/);
    await find('读研后研发'); await page.locator('#editDescription').fill('在版本B中新增的节点说明');
    await page.getByRole('button', { name: '保存节点', exact: true }).click(); await flush();
    await tool('history'); await page.locator('#snapshotTitle').fill('合成版本 B：新增想法');
    await page.locator('#snapshotForm').getByRole('button', { name: '保存命名版本', exact: true }).click();
    assert.equal((await stored()).snapshots.length, 2);
    await page.locator(`.restore-snapshot[data-id="${versionA.id}"]`).click(); await confirm(); await flush();
    assert.equal((await stored()).snapshots.length, 2, 'later snapshots must remain');
    assert.notEqual((await current()).nodes.find(node => node.title === '读研后研发').description, '在版本B中新增的节点说明');
    assert.ok((await current()).edges.find(edge => edge.id === commonEdgeId).requirements.some(requirement => requirement.label === 'SQL' && requirement.evidenceNote));
    assert.ok((await current()).tasks.some(task => task.id === retainedTaskId));
    await tool('history'); await screen('history-desktop.png', '.snapshot-card');
  });

  await check('P2-05 public export requires node consent and excludes private nodes, reflections, tasks and profile', async () => {
    await tool('privacy'); assert.ok(await page.locator('#publicExport').isDisabled());
    const graph = await current();
    const publicNodes = graph.nodes.filter(node => ['self', 'major', 'education', 'career', 'milestone'].includes(node.kind) && !node.private);
    for (const node of publicNodes) await page.locator(`[data-share-node="${node.id}"]`).check();
    assert.ok(await page.locator(`[data-share-node="${graph.nodes.find(node => node.private).id}"]`).isDisabled());
    const content = await downloadBy('#publicExport', 'public-share.json');
    const exported = JSON.parse(content);
    assert.ok(exported.nodes.length >= publicNodes.length);
    assert.equal(exported.reflections, undefined); assert.equal(exported.tasks, undefined); assert.equal(exported.profile, undefined); assert.equal(exported.documents, undefined);
    assert.doesNotMatch(content, new RegExp(SECRET)); assert.doesNotMatch(content, new RegExp(REFLECTION));
    assert.ok(!exported.nodes.some(node => node.title === '喜欢音乐'));
    await screen('privacy-desktop.png', '.export-preview');
  });

  await check('P2-06 explicit complete archive previews before import and persists after confirmation and refresh', async () => {
    archiveText = await downloadBy('#archiveExport', 'complete-archive.json', true);
    const archive = JSON.parse(archiveText);
    assert.equal(archive.archiveVersion, 1);
    assert.ok(archive.graph.reflections.length > 0);
    assert.equal(archive.snapshots.length, 2);
    assert.equal(archive.workspace.documents.length, 1);
    await find('读研后研发'); await page.locator('#editDescription').fill('导入前临时修改，确认前不能消失');
    await page.getByRole('button', { name: '保存节点', exact: true }).click(); await flush();
    await tool('privacy');
    await page.locator('#importGraph').setInputFiles({ name: 'complete-archive.json', mimeType: 'application/json', buffer: Buffer.from(archiveText) });
    await page.locator('#confirmImport').waitFor({ state: 'visible' });
    assert.equal((await current()).nodes.find(node => node.title === '读研后研发').description, '导入前临时修改，确认前不能消失');
    await page.locator('#confirmImport').click(); await confirm(); await flush();
    assert.notEqual((await current()).nodes.find(node => node.title === '读研后研发').description, '导入前临时修改，确认前不能消失');
    assert.ok((await current()).sources.every(source => source.trustLevel === 'unverified'));
    assert.ok((await current()).nodes.every(node => !node.shareAllowed));
    assert.equal((await workspace()).useDocuments, false);
    assert.ok((await workspace()).documents.every(document => document.shareWithAI === false));
    await page.reload({ waitUntil: 'networkidle' }); await page.locator('#intro').waitFor({ state: 'hidden' });
    assert.ok((await stored()).snapshots.length >= 2);
    for (const snapshot of archive.snapshots) assert.ok((await stored()).snapshots.some(saved => saved.id === snapshot.id), 'all pre-import versions remain available');
    assert.ok((await current()).reflections.some(reflection => reflection.text.includes(REFLECTION)));
    assert.ok((await current()).tasks.some(task => task.id === retainedTaskId));
  });

  await check('P2-06b duplicate document IDs are rejected atomically and never acquire another document authorization', async () => {
    await tool('privacy');
    await flush();
    const graphBefore = await current(), workspaceBefore = await workspace();
    const malformed = JSON.parse(archiveText);
    const original = malformed.workspace.documents[0];
    const forbiddenText = 'DUPLICATE_DOCUMENT_CONTENT_MUST_NOT_SHARE';
    malformed.workspace.documents = [original, { ...original, title: '重复 ID 的第二份合成文档', text: forbiddenText, shareWithAI: true }];
    malformed.workspace.useDocuments = true;
    await page.locator('#importGraph').setInputFiles({ name: 'duplicate-document-archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malformed)) });
    await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('资料 ID 重复'));
    assert.equal(await page.locator('#confirmImport').count(), 0, 'malformed archive must not offer confirmation');
    assert.deepEqual(await current(), graphBefore, 'rejected import must not change graph data');
    assert.deepEqual(await workspace(), workspaceBefore, 'rejected import must not change local documents or authorization');
    await tool('research');
    assert.equal(await page.locator('.document-card').count(), 1);
    await page.locator('[data-share-document]').check();
    const request = (await ask('只说明我明确勾选的合成文档提醒核对哪些事项。')).request;
    assert.equal(request.documents.length, 1);
    assert.match(request.documents[0].text, /JOURNEY_PDF_FIXTURE_20261013/);
    assert.doesNotMatch(JSON.stringify(request), new RegExp(forbiddenText));
    return { importRejected: true, graphUnchanged: true, workspaceUnchanged: true, authorizedDocumentsSent: 1, duplicateContentSent: false };
  }, 'real-ui-malformed-archive');

  await check('P2-07 390px mobile view supports comparison, tasks and private reflection controls without overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tree(); await page.locator('#fit').click();
    await tool('compare'); await page.locator('#compareRoutes').click();
    assert.equal(await page.locator('#routeComparison .saved-path').count(), 2);
    assert.ok(await page.locator('#rightpanel').isVisible());
    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(width.document <= width.viewport + 2, `Mobile page overflow: ${JSON.stringify(width)}`);
    await screen('comparison-mobile.png');
    await tool('plan');
    await page.locator('#taskTitle').fill('手机创建的合成任务');
    await page.locator('#taskDescription').fill('仅用于验证触屏尺寸的流程。');
    await page.locator('#taskForm').getByRole('button', { name: '添加任务', exact: true }).click(); await flush();
    assert.ok((await current()).tasks.some(task => task.title === '手机创建的合成任务'));
    await screen('tasks-mobile.png', '.task-card:has-text("手机创建的合成任务")');
    await tool('reflections'); await page.locator('#reflectionText').fill('手机上的合成私密反思');
    await page.locator('#reflectionForm').getByRole('button', { name: '私密保存', exact: true }).click(); await flush();
    assert.equal((await current()).reflections.at(-1).private, true);
    await screen('reflections-mobile.png');
    await tree(); assert.ok(await page.locator('#canvas').isVisible());
  });

  await check('P1/P2 final legacy-key hashes remain identical after all new workflows', async () => {
    const actualKeys = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(legacy));
    for (const [key, value] of Object.entries(actualKeys)) assert.equal(hash(value), baseline[key], key);
    return baseline;
  }, 'data-preservation');
} catch (_) { /* Preserve genuine failure and screenshots for the developer. */ }
finally {
  if (results.tests.some(item => !item.passed)) {
    try { await screen('failure.png'); } catch (_) { /* Browser may already have failed. */ }
  }
  results.requests = outgoing.map(item => ({ path: new URL(item.url).pathname, profileUsed: Boolean(item.body.profile), documents: item.body.documents?.length || 0, privateReflectionsPresent: Boolean(item.body.graph?.reflections), graphNodes: item.body.graph?.nodes?.length || 0 }));
  if (results.browserErrors.length) results.tests.push({ name: 'No uncaught browser exceptions', mode: 'runtime', passed: false, errors: results.browserErrors });
  results.completedAt = new Date().toISOString();
  results.summary = { passed: results.tests.filter(item => item.passed).length, failed: results.tests.filter(item => !item.passed).length };
  if (results.summary.failed === 0) await unlink(resolve(OUT, 'failure.png')).catch(() => {});
  await writeFile(resolve(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  await context.close(); await browser.close();
  console.log(JSON.stringify(results.summary)); process.exitCode = results.summary.failed ? 1 : 0;
}
