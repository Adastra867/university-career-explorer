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
  assert.equal(unapproved.modelContext.contextAvailability.profile.status, 'not_requested');
  assert.equal(unapproved.modelContext.contextAvailability.documents.status, 'not_requested');
  assert.equal(unapproved.modelContext.contextAvailability.history.status, 'not_supplied');
  const { modelContext, retrieval } = await buildCareerIntelligenceContext(request({
    message: '帮我规划，电话：13800138000',
    profile: { ...sharedProfile, consent: true },
    history: [{ question: '我想做研发', answer: '可考虑材料研发' }],
  }), {});
  assert.equal(retrieval.enabled, false);
  const major = modelContext.profile.find((fact) => fact.field === 'education.major');
  assert.equal(major.value, '新能源材料');
  assert.equal(major.provenance, 'user_form');
  assert.equal(major.confirmation, 'corrected');
  assert.equal(major.verificationStatus, 'self_reported');
  assert.equal(major.source, 'browser');
  assert.equal(major.conflict.requiresConfirmation, true);
  assert.equal(major.conflict.alternatives[0].value, '能源工程');
  assert.equal(modelContext.profile.find((fact) => fact.name === 'Python').verificationStatus, 'inference');
  assert.equal(modelContext.profile.find((fact) => fact.field === 'preferences.long_term_goal').verificationStatus, 'inference');
  assert.equal(modelContext.profile.find((fact) => fact.field === 'experience.text').provenance, 'document_extract');
  assert.deepEqual(modelContext.history.map((message) => message.verificationStatus), ['self_reported', 'inference']);
  assert.deepEqual(modelContext.contextAvailability.profile, {
    status: 'available', factCount: 4, selfReportedFactCount: 2, inferredFactCount: 2,
  });
  assert.deepEqual(modelContext.contextAvailability.history, { status: 'available', messageCount: 2, userMessageCount: 1 });
  assert.doesNotMatch(JSON.stringify(modelContext), /person@example|13800138000|abc123|未授权学校/);
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
  assert.equal(output.modelContext.contextAvailability.documents.status, 'available');
  assert.equal(output.modelContext.contextAvailability.documents.documentCount, 1);
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

test('distinguishes empty supplied context from data that was not requested', async () => {
  const output = await buildCareerIntelligenceContext(request({ profile: { consent: true, fields: {} }, history: [] }), {});
  const availability = output.modelContext.contextAvailability;
  assert.equal(availability.profile.status, 'empty');
  assert.equal(availability.history.status, 'empty');
  assert.equal(availability.documents.status, 'not_requested');
  assert.equal(availability.research.status, 'not_requested');
});

test('model context distinguishes an expired or failed profile connection from an empty profile', async () => {
  for (const status of ['session_expired', 'storage_unavailable', 'load_failed']) {
    const resolvedProfile = { authenticated: false, consent: false, status };
    const body = request({ profileUsage: { enabled: true, localConsent: true }, profile: { consent: true, fields: {} } });
    const failed = await buildCareerIntelligenceContext(body, { resolvedProfile });
    assert.equal(failed.modelContext.contextAvailability.profile.status, status);
    assert.equal(failed.modelContext.profileDiagnostics.status, status);
    assert.deepEqual(failed.modelContext.profile, []);
    const disabled = await buildCareerIntelligenceContext({ ...body, profileUsage: { enabled: false, localConsent: true } }, { resolvedProfile });
    assert.equal(disabled.modelContext.contextAvailability.profile.status, 'not_requested');
    const local = await buildCareerIntelligenceContext({ ...body, profile: { consent: true, major: '本人已授权的本机专业' } }, { resolvedProfile });
    assert.equal(local.modelContext.contextAvailability.profile.status, 'available');
    assert.equal(local.modelContext.profileDiagnostics.connectionStatus, status);
  }
});

test('an unexpected retrieval failure keeps authorized personal context and retrieves only local fallback evidence', async () => {
  let called = 0;
  const research = { async retrieve() {
    called++;
    throw new Error('connector failed with private-debug-credential');
  } };
  const output = await buildCareerIntelligenceContext(request({
    message: '根据已有经历制定成长路线。',
    profile: { consent: true, major: '能源', experience: '参与了电池仿真实习' },
    history: [{ role: 'user', content: '我希望先积累项目经验' }, { role: 'assistant', content: '可先尝试一个小项目' }],
    researchEnabled: true, liveSearch: true, publicSearchQuery: '电池研发 校招',
    documents: [{ title: '科研记录', kind: 'text', text: '在实验中记录了电池性能和温度的关联。' }],
  }), { research, now });
  assert.equal(called, 1);
  assert.ok(output.modelContext.profile.some(fact => fact.value === '参与了电池仿真实习'));
  assert.ok(output.modelContext.history.some(turn => turn.content === '我希望先积累项目经验'));
  assert.ok(output.sources.some(source => source.origin === 'user_document' && /电池性能/.test(source.excerpt)));
  assert.ok(output.sources.some(source => source.origin === 'offline_kb'));
  assert.equal(output.sources.some(source => source.origin === 'live_search'), false);
  assert.equal(output.retrieval.reasonCode, 'RETRIEVAL_UNAVAILABLE');
  assert.equal(output.retrieval.degraded, true);
  assert.equal(output.retrieval.liveSearchPerformed, null);
  assert.equal(output.modelContext.contextAvailability.profile.status, 'available');
  assert.equal(output.modelContext.contextAvailability.history.status, 'available');
  assert.equal(output.modelContext.contextAvailability.documents.status, 'available');
  assert.equal(output.modelContext.contextAvailability.research.status, 'degraded');
  assert.equal(output.modelContext.contextAvailability.research.liveSourceCount, 0);
  assert.doesNotMatch(JSON.stringify(output), /private-debug-credential|已查询公开信息/);
});

test('a handled search failure remains distinct from missing data and retains its real attempt status', async () => {
  const research = createResearchService({ env: {}, now, searchClient: { async advancedSearch() { throw new Error('temporary failure'); } } });
  const output = await buildCareerIntelligenceContext(request({
    researchEnabled: true, liveSearch: true, publicSearchQuery: '能源研发岗位',
    profile: { consent: true, major: '能源' },
  }), { research });
  assert.equal(output.retrieval.reasonCode, 'SEARCH_UNAVAILABLE');
  assert.equal(output.retrieval.liveSearchPerformed, true);
  assert.equal(output.modelContext.contextAvailability.research.status, 'degraded');
  assert.equal(output.modelContext.contextAvailability.research.liveSourceCount, 0);
  assert.equal(output.modelContext.contextAvailability.profile.status, 'available');
  assert.equal(output.modelContext.contextAvailability.documents.status, 'empty');
});

test('invalid document requests and explicit cancellation still fail without a fallback search', async () => {
  let called = 0;
  const research = { async retrieve() { called++; throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); } };
  await assert.rejects(buildCareerIntelligenceContext(request({ researchEnabled: true, documents: [{ text: '' }] }), { research }), /20,000/);
  assert.equal(called, 0);
  await assert.rejects(buildCareerIntelligenceContext(request({ researchEnabled: true }), { research }), { name: 'AbortError' });
  assert.equal(called, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildCareerIntelligenceContext(request({ researchEnabled: true }), { research, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(called, 1);
});
