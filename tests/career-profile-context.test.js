import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCareerProfileContext, PROFILE_CONTEXT_LIMITS, redactProfileText } from '../journey/career-profile-context.js';

const field = (value, extra = {}) => ({
  value, value_state: value === null ? 'unknown' : 'known', source_type: 'user_form', confirmation_state: 'corrected', ...extra,
});
const connected = fields => ({ authenticated: true, status: 'connected', consent: true, profile: { fields } });
const local = fields => ({ consent: true, fields });

test('authorized SQLite fields load without client supplied profile and preserve their provenance', () => {
  const output = buildCareerProfileContext({ body: { message: '制定近期中期远期成长路线' }, resolvedProfile: connected({
    'education.stage': field('大三'), 'education.major': field('可持续能源'),
    'skills.self_report': field('MATLAB、Python、建模分析'),
    'preferences.long_term_goal': field('能源技术与 AI 交叉方向'),
    'experience.text': field('【项目】仿真研究\n我负责拟合电池模型参数，使用 Python 检查模型残差。'),
  }) });
  assert.equal(output.profileDiagnostics.source, 'sqlite');
  assert.equal(output.profileDiagnostics.sourceCount, 1);
  assert.equal(output.profileDiagnostics.fieldCount, 5);
  assert.equal(output.profileDiagnostics.experienceCount, 1);
  assert.equal(output.profileDiagnostics.educationCount, 2);
  assert.equal(output.profileDiagnostics.skillCount, 3);
  assert.equal(output.profileDiagnostics.usedByModel, false);
  assert.equal(output.structuredProfile.education.stage, '大三');
  assert.equal(output.structuredProfile.education.school, null);
  assert.ok(output.structuredProfile.unknownFields.includes('education.school'));
  assert.ok(output.profile.every(fact => fact.source === 'sqlite' && fact.confirmation === 'corrected'));
});

test('cloud storage permission and online AI profile permission remain independent, with explicit per-request opt out', () => {
  const database = { ...connected({ 'education.major': field('数据库专业') }), consent: false };
  const denied = buildCareerProfileContext({ body: { profileUsage: { enabled: true } }, resolvedProfile: database });
  assert.equal(denied.profileDiagnostics.status, 'not_authorized');
  assert.deepEqual(denied.profile, []);
  const permittedLocal = buildCareerProfileContext({
    body: { profileUsage: { enabled: true, localConsent: true }, profile: local({ 'education.major': field('本地专业') }) },
    resolvedProfile: database,
  });
  assert.deepEqual(permittedLocal.profile.map(item => item.value), ['本地专业']);
  assert.equal(permittedLocal.profileDiagnostics.source, 'browser');
  const excludedLocal = buildCareerProfileContext({
    body: { profileUsage: { enabled: true, localConsent: false }, profile: local({ 'education.major': field('旧本地专业') }) },
    resolvedProfile: connected({ 'education.major': field('数据库专业') }),
  });
  assert.doesNotMatch(JSON.stringify(excludedLocal), /旧本地专业/);
  const disabled = buildCareerProfileContext({
    body: { profileUsage: { enabled: false, localConsent: true }, profile: local({ 'education.major': field('本地专业') }) },
    resolvedProfile: connected({ 'education.major': field('数据库专业') }),
  });
  assert.deepEqual(disabled.profile, []);
  assert.equal(disabled.profileDiagnostics.status, 'not_requested');
  assert.equal(disabled.profileDiagnostics.totalCharacters, 0);
});

test('confirmed SQLite values win conflicts and explicitly cleared fields cannot be resurrected by old local records', () => {
  const output = buildCareerProfileContext({
    body: { profile: local({ 'education.major': field('旧专业'), 'experience.text': field('曾在旧项目中做过任务') }) },
    resolvedProfile: connected({ 'education.major': field('本人确认的专业'), 'experience.text': field(null) }),
  });
  const major = output.profile.find(fact => fact.field === 'education.major');
  assert.equal(major.value, '本人确认的专业');
  assert.equal(major.conflict.requiresConfirmation, true);
  assert.equal(major.conflict.alternatives[0].source, 'browser');
  assert.equal(output.profileDiagnostics.conflictCount, 1);
  assert.ok(output.structuredProfile.clearedFields.includes('experience.text'));
  assert.doesNotMatch(JSON.stringify(output), /曾在旧项目/);
});

test('separate projects retain more than 2000 characters and deduplicate identical cloud and local experiences', () => {
  const first = '【项目】电池仿真\n' + '负责参数拟合与误差分析。'.repeat(220) + '最终交付电池模型校准工具。';
  const second = '【科研】光伏稳定性\n' + '通过对照实验记录材料退化。'.repeat(210) + '最后完成退化曲线和研究报告。';
  const text = first + '\n' + second;
  const output = buildCareerProfileContext({
    body: { message: '结合光伏科研制定计划', profile: local({ 'experience.text': field(text) }) },
    resolvedProfile: connected({ 'experience.text': field(text) }),
  });
  assert.equal(output.profileDiagnostics.experienceCount, 2);
  assert.equal(output.profileDiagnostics.sourceCount, 2);
  assert.equal(output.profileDiagnostics.truncatedFields.length, 0);
  const experience = output.profile.filter(fact => fact.field === 'experience.text');
  assert.equal(experience.length, 2);
  assert.ok(experience.every(fact => fact.value.length > 2000));
  assert.match(experience.find(fact => fact.value.includes('光伏稳定性')).value, /最后完成退化曲线/);
});

test('numbered and Markdown experience headings split projects while keeping their internal tasks and outcomes together', () => {
  const text = [
    '我目前大三，以下是本人的经历。',
    '【项目经历】',
    '## 电池仿真项目',
    '负责电池参数拟合。',
    '### 项目任务',
    '使用 Python 处理原始数据。',
    '### 研究成果',
    '交付校准工具。',
    '## 光伏稳定性研究',
    '采用对照实验记录器件退化。',
    '### 研究方法',
    '复核基线与湿度控制。',
    '1. 储能企业实习',
    '参与测试流程，整理结果。',
  ].join('\n');
  const output = buildCareerProfileContext({ resolvedProfile: connected({ 'experience.text': field(text) }) });
  const experiences = output.structuredProfile.experiences;
  assert.equal(experiences.length, 3);
  assert.deepEqual(experiences.map(item => item.title), ['电池仿真项目', '光伏稳定性研究', '储能企业实习']);
  assert.match(experiences[0].description, /我目前大三/);
  assert.match(experiences[0].description, /项目任务[\s\S]*研究成果[\s\S]*交付校准工具/);
  assert.match(experiences[1].description, /研究方法[\s\S]*复核基线/);
  assert.equal(new Set(experiences.map(item => item.sourceId)).size, 3);
  for (const item of experiences) {
    assert.equal(item.sourceLocator.coordinateSpace, 'redacted_normalized_text');
    assert.equal(redactProfileText(text).slice(item.sourceLocator.start, item.sourceLocator.end).trim(), item.description);
    assert.doesNotMatch(item.sourceId, /电池|光伏|储能/);
  }
});

test('ordinary paragraphs and numbered responsibilities remain one experience without invented project titles', () => {
  const text = '参与某能源项目。\n\n1. 负责项目数据清洗。\n2. 使用 MATLAB 建模分析。\n3. 完成研究成果报告。';
  const output = buildCareerProfileContext({ resolvedProfile: connected({ 'experience.text': field(text) }) });
  assert.equal(output.structuredProfile.experiences.length, 1);
  assert.equal(output.structuredProfile.experiences[0].description, text);
  assert.equal(output.structuredProfile.experiences[0].title, '');
});

test('over-budget experiences keep relevant work and final outcomes with safe traceable truncation diagnostics', () => {
  const original = '【科研】材料长期研究\n' + '准备实验并整理记录。'.repeat(450) +
    '使用 MATLAB 与 Python 建模分析，负责电池数字孪生误差校正。' + '复核原始实验数据。'.repeat(500) +
    '最终交付数字孪生验证报告。联系：person@example.com，手机：13800138000';
  const output = buildCareerProfileContext({ body: { message: '如何继续验证数字孪生建模分析能力' },
    resolvedProfile: connected({ 'experience.text': field(original) }) });
  const fact = output.profile.find(item => item.field === 'experience.text');
  assert.ok(fact.value.length <= PROFILE_CONTEXT_LIMITS.experience);
  assert.match(fact.value, /MATLAB 与 Python/);
  assert.match(fact.value, /最终交付数字孪生验证报告/);
  assert.equal(fact.excerpt.strategy, 'relevance_excerpt');
  assert.ok(fact.excerpt.ranges.length > 1);
  const diagnostics = output.profileDiagnostics;
  assert.equal(diagnostics.truncatedFields.length, 1);
  assert.ok(diagnostics.truncatedFields[0].originalCharacters > 8000);
  assert.doesNotMatch(JSON.stringify(diagnostics), /person@example|13800138000|数字孪生|材料长期研究/);
  assert.doesNotMatch(JSON.stringify(output.profile), /person@example|13800138000/);
});

test('the total profile budget prioritizes relevant experience and records every omitted part', () => {
  const generic = '【项目】其他任务\n' + '整理普通记录。'.repeat(1100);
  const related = '【科研】电池数字孪生\n' + '使用 Python 设计数字孪生验证方案。'.repeat(650) + '最终交付建模报告。';
  const output = buildCareerProfileContext({
    body: { message: '验证电池数字孪生与 Python 建模能力' },
    resolvedProfile: connected({ 'education.stage': field('大三'), 'experience.text': field(generic + '\n' + related) }),
    limits: { ...PROFILE_CONTEXT_LIMITS, total: 10000 },
  });
  assert.ok(output.profileDiagnostics.totalCharacters <= 10000);
  assert.match(output.profile.find(fact => fact.field === 'experience.text').value, /电池数字孪生/);
  assert.equal(output.profile.find(fact => fact.field === 'education.stage').value, '大三');
  assert.ok(output.profileDiagnostics.truncatedFields.some(item => item.reason === 'total_budget'));
});

test('unconfirmed AI inference stays distinguishable from confirmed personal facts', () => {
  const output = buildCareerProfileContext({
    body: { profile: local({ 'education.major': field('模型猜测的专业', { source_type: 'ai_inference', confirmation_state: 'unconfirmed' }),
      'preferences.long_term_goal': field('推测的研究目标', { source_type: 'ai_inference', confirmation_state: 'unconfirmed' }) }) },
    resolvedProfile: connected({ 'education.major': field('本人专业') }),
  });
  assert.equal(output.profile.find(fact => fact.field === 'education.major').value, '本人专业');
  assert.equal(output.profile.find(fact => fact.field === 'preferences.long_term_goal').verificationStatus, 'inference');
});

test('missing, expired and failed profile connections are diagnosed without inventing empty personal facts', () => {
  for (const status of ['not_connected', 'session_expired', 'storage_unavailable', 'load_failed']) {
    const output = buildCareerProfileContext({ body: { profileUsage: { enabled: true } }, resolvedProfile: { status, authenticated: false } });
    assert.equal(output.profileDiagnostics.status, status);
    assert.deepEqual(output.profile, []);
    assert.equal(output.profileDiagnostics.sourceCount, 0);
  }
  const empty = buildCareerProfileContext({ resolvedProfile: connected({}) });
  assert.equal(empty.profileDiagnostics.status, 'empty');
  assert.equal(empty.structuredProfile.education.major, null);
});

test('building request context leaves original SQLite and local data intact', () => {
  const resolvedProfile = connected({ 'experience.text': field('本人的原始经历') });
  const body = { profile: local({ 'experience.text': field('本人的原始经历') }), history: [{ role: 'user', content: '过去的问题' }] };
  const before = JSON.stringify({ resolvedProfile, body });
  const output = buildCareerProfileContext({ body, resolvedProfile });
  assert.equal(JSON.stringify({ resolvedProfile, body }), before);
  assert.equal(output.profileDiagnostics.historyCount, 1);
});

test('legacy fields and secondary evidence share the documented budget without silent earlier truncation', () => {
  const stage = '已提供的学习阶段'.repeat(350);
  const evidence = '参与 Python 数据清洗并复核结果。'.repeat(500);
  const output = buildCareerProfileContext({ body: { profile: { consent: true, stage,
    skills: [{ name: 'Python', evidence, level: '会一点' }] } } });
  const stageFact = output.profile.find(fact => fact.field === 'education.stage');
  assert.ok(stageFact.value.length > 160);
  assert.ok(output.profileDiagnostics.truncatedFields.some(item => item.field === 'education.stage'));
  assert.ok(output.profileDiagnostics.truncatedFields.some(item => item.sourceId.endsWith(':evidence')));
  const included = output.profile.reduce((size, fact) => size + (fact.value || fact.name).length +
    (fact.evidence?.length || 0) + (fact.level?.length || 0), 0);
  assert.equal(output.profileDiagnostics.totalCharacters, included);
});

test('low-confidence legacy skill arrays cannot exhaust the budget before a corrected SQLite experience', () => {
  const experience = '【项目】本人确认的电池建模\n' + '我负责使用 Python 复核实验数据并校准电池模型。'.repeat(55) + '最终交付可复现的模型验证结果。';
  const skills = Array.from({ length: 25 }, (_, index) => ({ name: '推断技能' + index + '未知强度'.repeat(250), level: 'score_only' }));
  const output = buildCareerProfileContext({
    body: { profile: { consent: true, skills } },
    resolvedProfile: connected({ 'experience.text': field(experience) }),
  });
  const actual = output.profile.find(fact => fact.field === 'experience.text');
  assert.equal(actual.value, redactProfileText(experience));
  assert.equal(actual.confirmation, 'corrected');
  assert.ok(output.profileDiagnostics.totalCharacters <= PROFILE_CONTEXT_LIMITS.total);
  assert.ok(output.profileDiagnostics.truncatedFields.some(item => item.field === 'skill' && item.reason === 'total_budget'));
});

test('empty local authorization preserves an expired or unavailable server connection diagnostic', () => {
  for (const status of ['session_expired', 'storage_unavailable', 'load_failed']) {
    const output = buildCareerProfileContext({ body: {
      profileUsage: { enabled: true, localConsent: true }, profile: local({}),
    }, resolvedProfile: { authenticated: false, status } });
    assert.equal(output.profileDiagnostics.status, status);
    assert.equal(output.profileDiagnostics.connectionStatus, status);
    assert.equal(output.profileDiagnostics.profileAvailable, false);
  }
});

test('older conflicting scalar values are budgeted after the confirmed experience', () => {
  const paths = ['education.stage', 'education.degree', 'education.major', 'education.school',
    'skills.self_report', 'preferences.long_term_goal', 'preferences.city'];
  const database = Object.fromEntries(paths.map(path => [path, field('本人确认资料'.repeat(320))]));
  const older = Object.fromEntries(paths.map(path => [path, field('旧资料候选内容'.repeat(320))]));
  database['experience.text'] = field('【项目】本人已确认的实际经历\n' + '负责校验电池模型参数。'.repeat(600));
  const output = buildCareerProfileContext({ body: { profile: local(older) }, resolvedProfile: connected(database) });
  assert.match(output.profile.find(fact => fact.field === 'experience.text').value, /本人已确认的实际经历/);
  assert.ok(output.profileDiagnostics.truncatedFields.some(item => item.reason === 'conflict_budget'));
  assert.ok(output.profileDiagnostics.totalCharacters <= PROFILE_CONTEXT_LIMITS.total);
});
