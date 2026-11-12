import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCareerIntelligenceContext } from '../journey/career-intelligence-evidence.js';
import { createResearchService } from '../journey/research.js';

const now = () => Date.parse('2026-11-12T03:00:00Z');
const request = (extra) => ({ message: '请帮我分析当前背景。', ...extra });

test('ignores unapproved profile and documents, and labels authorized facts by provenance', async () => {
  const sharedProfile = {
    education: '本科', major: '能源工程',
    skills: [{ name: 'Python', level: 'score_only' }],
    fields: {
      'education.major': { value_state: 'known', value: '新能源材料', source_type: 'user_form', confirmation_state: 'corrected' },
      'education.school': { value_state: 'known', value: '未授权学校', source_type: 'user_text' },
      'experience.text': { value_state: 'known', value: '参与材料科研，微信：abc123，person@example.com', source_type: 'document_extract' },
      'preferences.long_term_goal': { value_state: 'known', value: '从事科研', source_type: 'ai_inference' },
    },
    authorizedFields: ['major', 'skills', 'education.major', 'experience.text', 'preferences.long_term_goal'],
  };
  const unapproved = await buildCareerIntelligenceContext(request({ profile: sharedProfile, documents: 'ignored' }), {});
  assert.deepEqual(unapproved.modelContext.profile, []);
  assert.deepEqual(unapproved.sources, []);
  const { modelContext, retrieval } = await buildCareerIntelligenceContext(request({
    message: '帮我规划，电话：13800138000',
    profile: { ...sharedProfile, consent: true },
    history: [{ question: '我想做研发', answer: '可考虑材料研发' }],
  }), {});
  assert.equal(retrieval.enabled, false);
  assert.deepEqual(modelContext.profile.find((fact) => fact.field === 'education.major'), {
    field: 'education.major', value: '新能源材料', provenance: 'user_form', confirmation: 'corrected', verificationStatus: 'self_reported',
  });
  assert.equal(modelContext.profile.find((fact) => fact.name === 'Python').verificationStatus, 'inference');
  assert.equal(modelContext.profile.find((fact) => fact.field === 'preferences.long_term_goal').verificationStatus, 'inference');
  assert.equal(modelContext.profile.find((fact) => fact.field === 'experience.text').provenance, 'document_extract');
  assert.deepEqual(modelContext.history.map((message) => message.verificationStatus), ['self_reported', 'inference']);
  assert.doesNotMatch(JSON.stringify(modelContext), /person@example|13800138000|abc123|未授权学校|能源工程/);
});

test('retrieves career database facts from profile and includes authorized file passages even for a general question', async () => {
  const research = createResearchService({ env: {}, now });
  const output = await buildCareerIntelligenceContext(request({
    researchEnabled: true, profile: { consent: true, major: '能源' },
    documents: [{ title: '课程报告', kind: 'pdf_excerpt', locator: '第 2 页', text: '在课题中尝试了电极涂布工艺，联系人邮箱：private@example.com。' }],
  }), { research });
  const occupation = output.sources.find((item) => item.sourceId === 'onet_17-2199_03');
  assert.equal(occupation.verificationStatus, 'official_snapshot_checked');
  assert.equal(occupation.region, '美国职业分类');
  assert.match(occupation.url, /^https:\/\/www.onetonline.org\//);
  const document = output.sources.find((item) => item.origin === 'user_document');
  assert.equal(document.verificationStatus, 'user_provided_unverified');
  assert.equal(document.locator, '第 2 页');
  assert.match(document.excerpt, /电极涂布工艺/);
  assert.doesNotMatch(document.excerpt, /private@example.com/);
  const next = await buildCareerIntelligenceContext(request({ researchEnabled: true, message: '电极涂布' }), { research });
  assert.equal(next.sources.some((item) => item.origin === 'user_document'), false);
});

test('queries the web only with the separately authorized public query', async () => {
  const calls = [];
  const searchClient = { async advancedSearch(query, options) {
    calls.push({ query, options });
    return { web_items: [{ title: '华为校园招聘', url: 'https://career.huawei.com/cn/campus-recruitment', snippet: '华为校园招聘查询片段。' }] };
  } };
  const research = createResearchService({ env: {}, now, searchClient });
  const privateInput = request({ message: 'PRIVATE_RESUME_471', profile: { consent: true, major: 'PRIVATE_PROFILE_633' }, researchEnabled: true, liveSearch: true });
  await assert.rejects(buildCareerIntelligenceContext(privateInput, { research }), /公开查询词/);
  await assert.rejects(buildCareerIntelligenceContext({ ...privateInput, publicSearchQuery: '查 person@example.com 的申请' }, { research }), /公开信息/);
  assert.equal(calls.length, 0);
  const { sources, retrieval } = await buildCareerIntelligenceContext({ ...privateInput, publicSearchQuery: '华为校园招聘' }, { research });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, '华为校园招聘');
  assert.match(calls[0].options.sites, /career.huawei.com/);
  assert.equal(retrieval.liveSearchPerformed, true);
  assert.equal(sources.find((entry) => entry.origin === 'live_search').verificationStatus, 'official_search_excerpt_unverified');
});
