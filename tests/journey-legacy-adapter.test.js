import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyCareerAdapter, LegacyFieldOptions, safeLegacyProfile, legacyLinks } from '../journey/legacy-adapter.js';

const AT = '2026-10-13T08:00:00.000Z';
const now = () => AT;
function assessment() {
  return {
    studentProfile: { education: 'undergraduate', major: '合成测试专业', employmentChoice: 'unsure', certificate: '不得导入的证书' },
    experienceText: '我负责 Python 数据分析项目并完成 SQL 报告。联系 test@example.com 或13800138000。',
    experienceAnalysis: { skills: ['Python', 'SQL', 'Python', '机器学习'], tools: ['Excel'], abilityScores: { technicalSkill: 90, communication: 85, inventedGrade: 100 } },
    softSkills: { communication: 88, leadership: 80, unknownScore: 100 },
    directionRanking: ['d2', 'd1'], directionSnapshots: [{ id: 'd1', direction: '软件开发', jobs: ['前端开发'] }, { id: 'd2', direction: '数据分析', jobs: ['数据分析师'] }],
    jobSearchPreferences: { location: '上海', hidden: '不得导入的偏好' },
    mbtiResult: { type: 'INTJ' }, manualJDText: '不允许自动携带的 JD', knowledgeBase: [{ content: '不允许携带的知识库' }], chatHistory: [{ content: '不允许携带的聊天' }],
  };
}
function storageFixture(data = assessment(), prep = { stage: 'senior', resume: '不得整份导入的简历', transcript: [{ answer: '私人面试回答' }] }) {
  const values = new Map([['careerPredictor', JSON.stringify(data)], ['careerPredictorPrep', JSON.stringify(prep)], ['careerPredictorHistory', '不得读取或改写的历史']]);
  const reads = [];
  return { values, reads, storage: { getItem(key) { reads.push(key); return values.get(key) ?? null; }, setItem() { throw new Error('adapter must be read-only'); }, removeItem() { throw new Error('adapter must be read-only'); } } };
}

test('inspection reports only field availability/counts and never imports values by default', () => {
  const fixture = storageFixture();
  const adapter = new LegacyCareerAdapter(fixture.storage, { now });
  assert.equal(adapter.snapshot(), null);
  assert.equal(fixture.reads.length, 0, 'constructing an adapter does not silently read old data');
  const result = adapter.inspect();
  assert.equal(result.available, true);
  assert.equal(result.fields.length, LegacyFieldOptions.length);
  assert.ok(result.fields.every(field => typeof field.available === 'boolean' && Number.isInteger(field.count)));
  assert.doesNotMatch(JSON.stringify(result), /合成测试专业|Python|13800138000|私人面试回答|不得读取或改写的历史/);
  assert.deepEqual(fixture.reads.sort(), ['careerPredictor', 'careerPredictorPrep']);
  assert.equal(adapter.snapshot(), null);
});

test('explicit field authorization imports only its allowlist and records its timestamp', () => {
  const raw = assessment();
  const before = JSON.stringify(raw);
  const profile = safeLegacyProfile(raw, ['major'], { now });
  assert.deepEqual(profile, { schemaVersion: 1, source: 'legacy-career', authorizedFields: ['major'], authorizedAt: AT, major: '合成测试专业' });
  assert.equal(JSON.stringify(raw), before);
  assert.throws(() => safeLegacyProfile(raw, [], { now }), /请选择/);
  assert.throws(() => safeLegacyProfile(raw, ['chatHistory'], { now }), /请选择/);
  assert.throws(() => safeLegacyProfile(raw, ['major'], { now: () => 'bad-time' }), /时间/);
});

test('skills retain text evidence or score-only status without implying certificates or grades', () => {
  const profile = safeLegacyProfile(assessment(), ['skills'], { now });
  const python = profile.skills.find(skill => skill.name === 'Python');
  assert.equal(python.level, 'self_reported');
  assert.equal(python.evidenceType, 'text');
  assert.match(python.evidence, /Python/);
  assert.doesNotMatch(python.evidence, /test@example.com|13800138000/);
  assert.equal(profile.skills.filter(skill => skill.name === 'Python').length, 1);
  assert.equal(profile.skills.find(skill => skill.name === '机器学习').evidenceType, 'mention');
  const communication = profile.skills.find(skill => skill.name === '沟通能力');
  assert.equal(communication.level, 'score_only');
  assert.equal(communication.score, 88);
  assert.match(communication.evidence, /不能证明/);
  assert.doesNotMatch(JSON.stringify(profile), /certificate|inventedGrade|INTJ|不得导入的证书|不允许携带的聊天|manualJDText/);
});

test('negative mentions and partial English keyword matches are not treated as practice evidence', () => {
  const raw = assessment();
  raw.experienceText = '我尚未掌握 Python。项目使用NoSQL数据库。';
  const profile = safeLegacyProfile(raw, ['skills'], { now });
  assert.notEqual(profile.skills.find(skill => skill.name === 'Python').level, 'self_reported');
  assert.notEqual(profile.skills.find(skill => skill.name === 'SQL').level, 'self_reported');
});

test('preferences use actual selected snapshots and stage comes only from the old prep state', () => {
  const profile = safeLegacyProfile({ assessment: assessment(), preparation: { stage: 'senior', role: '不得默认导入的目标' } }, ['education', 'stage', 'preferences'], { now });
  assert.equal(profile.education, 'undergraduate');
  assert.equal(profile.stage, 'senior');
  assert.equal(profile.preferences.location, '上海');
  assert.deepEqual(profile.preferences.directions.map(item => item.title), ['数据分析', '软件开发']);
  assert.equal(profile.preferences.employmentChoice, 'unsure');
  assert.doesNotMatch(JSON.stringify(profile), /hidden|不得默认导入的目标|合成测试专业/);
  assert.equal(safeLegacyProfile({ studentProfile: { education: 'doctoral', major: 123 }, stage: 'senior' }, ['education', 'stage', 'major'], { now }).stage, undefined);
});

test('revoking a snapshot clears adapter authorization and never changes legacy keys', () => {
  const fixture = storageFixture();
  const before = [...fixture.values];
  const adapter = new LegacyCareerAdapter(fixture.storage, { now });
  const profile = adapter.authorize(['major', 'skills']);
  profile.major = '外部修改';
  assert.equal(adapter.snapshot().major, '合成测试专业', 'returned snapshots are independent copies');
  assert.equal(adapter.revoke(), null);
  assert.equal(adapter.snapshot(), null);
  assert.deepEqual([...fixture.values], before);
  assert.ok(!fixture.reads.includes('careerPredictorHistory'));
});

test('malformed, unavailable and oversized old data remain unchanged with a generic warning', () => {
  for (const raw of ['{bad-json', '[]', 'x'.repeat(2000001)]) {
    const fixture = storageFixture();
    fixture.values.set('careerPredictor', raw);
    fixture.values.delete('careerPredictorPrep');
    const adapter = new LegacyCareerAdapter(fixture.storage, { now });
    const inspected = adapter.inspect();
    assert.equal(inspected.available, false);
    assert.equal(inspected.warnings.length, 1);
    assert.throws(() => adapter.authorize(['major']), /没有可导入/);
    assert.equal(fixture.values.get('careerPredictor'), raw);
  }
  const adapter = new LegacyCareerAdapter({ getItem() { throw new Error('storage disabled'); } });
  assert.equal(adapter.inspect().available, false);
});

test('bridge links honestly require copied keywords and never transmit private nodes', () => {
  const links = legacyLinks({ title: '数据分析师' });
  assert.equal(links.jobSearch.href, '/job-search.html');
  assert.equal(links.jobSearch.keyword, '数据分析师');
  assert.equal(links.jobSearch.requiresCopy, true);
  assert.ok(!links.jobSearch.href.includes('?'), 'the old page does not consume URL parameters');
  assert.equal(links.report.href, '/index.html');
  assert.equal(links.preparation.href, '/career-prep.html');
  const privateLinks = legacyLinks({ title: '私密财务路线', private: true });
  assert.equal(privateLinks.jobSearch.blocked, true);
  assert.equal(privateLinks.jobSearch.keyword, '');
  assert.doesNotMatch(JSON.stringify(privateLinks), /私密财务路线/);
});
