import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekSearchClient, buildSearchQueries, searchConfigured } from '../journey/search.js';
import { createResearchService } from '../journey/research.js';

const row = url => ({ title: '校招岗位', url, snippet: '数据分析 SQL', content: '本科及以上 SQL', date: '2026-11-19', authority: 2 });
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('long Unicode queries cover every requested domain in bounded search batches', () => {
  const domains = ['career.huawei.com', 'jobs.bytedance.com', 'careers.tencent.com', 'jobs.tencent.com', 'talent.alibaba.com'];
  const queries = buildSearchQueries('数据分析😀'.repeat(40), domains.join(','));
  assert.ok(queries.length > 1);
  for (const query of queries) assert.ok(Array.from(query).length <= 128);
  for (const domain of domains) assert.ok(queries.some(query => query.includes(`site:${domain}`)));
  assert.throws(() => buildSearchQueries('  '), { code: 'SEARCH_INVALID_QUERY' });
});

test('key precedence, opt-out and missing configuration are explicit', () => {
  assert.equal(searchConfigured({}), false);
  assert.equal(searchConfigured({ JOURNEY_AI_API_KEY: 'key' }), true);
  assert.equal(searchConfigured({ JOURNEY_AI_API_KEY: 'key', DEEPSEEK_SEARCH_ENABLED: 'false' }), false);
  assert.throws(() => new DeepSeekSearchClient({ env: {} }), { code: 'SEARCH_NOT_CONFIGURED' });
  const client = new DeepSeekSearchClient({ env: { DEEPSEEK_SEARCH_API_KEY: 'search', JOURNEY_AI_API_KEY: 'model' } });
  assert.equal(client.apiKey, 'search');
});

test('adapter maps actual provider schema and rejects unsafe/off-domain URLs and duplicates', async () => {
  const calls = [];
  const client = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async (url, options) => {
    calls.push({ url, options });
    return reply({ results: [row('https://career.huawei.com/jobs/1'), row('https://career.huawei.com/jobs/1'), row('https://unrelated.example/'), row('javascript:alert(1)'), row('https://name:password@career.huawei.com/')] });
  } });
  const data = await client.advancedSearch('校招', { sites: 'career.huawei.com', count: 3, needContent: true });
  assert.equal(data.web_items.length, 1);
  assert.equal(data.web_items[0].publish_time, '2026-11-19');
  assert.equal(data.web_items[0].content, '本科及以上 SQL');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture');
  assert.equal(JSON.parse(calls[0].options.body).need_content, true);
});

test('partial domain failure retains successful results; total failure and malformed output are explicit', async () => {
  let call = 0;
  const client = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async () => ++call === 1
    ? new Response('', { status: 503 }) : reply({ results: [row('https://careers.tencent.com/')] }) });
  const data = await client.advancedSearch('校招'.repeat(30), { sites: 'career.huawei.com,jobs.bytedance.com,careers.tencent.com' });
  assert.equal(data.web_items.length, 1);
  for (const [status, code] of [[401, 'SEARCH_AUTH_FAILED'], [402, 'SEARCH_BALANCE_REQUIRED'], [429, 'SEARCH_RATE_LIMITED']]) {
    const broken = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async () => new Response('', { status }) });
    await assert.rejects(broken.webSearch('岗位'), { code });
  }
  const malformed = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async () => reply({}) });
  await assert.rejects(malformed.webSearch('岗位'), { code: 'SEARCH_INVALID_OUTPUT' });
});

test('JD Fetch uses URL reading rather than URL search and blocks local/credentialed inputs', async () => {
  const client = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/fetch');
    assert.equal(JSON.parse(options.body).url, 'https://career.huawei.com/jobs/1');
    return reply({ title: 'JD', content: '# 岗位要求\nSQL' });
  } });
  assert.equal((await client.fetchPage('https://career.huawei.com/jobs/1')).title, 'JD');
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///etc/passwd', 'https://name:password@example.com/']) {
    await assert.rejects(client.fetchPage(url), { code: 'SEARCH_INVALID_URL' });
  }
});

test('DeepSeek results flow through research attribution; disabled search keeps offline fallback', async () => {
  const client = new DeepSeekSearchClient({ apiKey: 'fixture', fetch: async () => reply({ results: [row('https://www.pmi.org/certifications/project-management-pmp')] }) });
  const query = { question: 'PMP SQL 资格要求', liveSearch: true };
  const result = await createResearchService({ env: {}, searchClient: client }).retrieve(query);
  assert.equal(result.status.liveSearchPerformed, true);
  assert.ok(result.evidence.some(item => item.origin === 'live_search' && item.url.includes('pmi.org')));
  const offline = await createResearchService({ env: { JOURNEY_AI_API_KEY: 'unused', DEEPSEEK_SEARCH_ENABLED: 'false' } }).retrieve(query);
  assert.equal(offline.status.reasonCode, 'SEARCH_NOT_CONFIGURED');
});
