/** Read-only bridge to the actual legacy browser stores. No legacy writes. */
export const LegacyFieldOptions = Object.freeze([
  { id: 'education', label: '学历阶段（不代表已取得学位）' },
  { id: 'major', label: '专业' },
  { id: 'stage', label: '求职阶段' },
  { id: 'skills', label: '技能标签、相关经历摘录与规则评分' },
  { id: 'preferences', label: '已填写的求职偏好与意向方向' },
].map(Object.freeze));
const ALLOWED_FIELDS = new Set(LegacyFieldOptions.map(field => field.id));
const SOFT_NAMES = { communication: '沟通能力', leadership: '领导力', collaboration: '协作能力', analysis: '分析能力', execution: '执行力', stress: '抗压能力', learning: '学习能力', adaptability: '适应能力', empathy: '共情能力' };
const ABILITY_NAMES = { technicalSkill: '技术能力', domainKnowledge: '领域知识', execution: '执行力', achievement: '成果导向', communication: '沟通能力', leadership: '领导力' };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value, max = 80) => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, max) : [];
const clean = (value, max = 120) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const redact = value => clean(value, 260).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已省略]').replace(/\b1[3-9]\d{9}\b/g, '[电话已省略]').replace(/\b\d{17}[\dXx]\b/g, '[身份信息已省略]');

function fieldsToImport(fields) {
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > LegacyFieldOptions.length || fields.some(field => !ALLOWED_FIELDS.has(field))) throw new Error('请选择明确允许导入的资料字段。');
  return [...new Set(fields)];
}
function sources(raw) {
  const assessment = plain(raw?.assessment) ? raw.assessment : plain(raw) ? raw : {};
  const preparation = plain(raw?.preparation) ? raw.preparation : {};
  return { assessment, preparation };
}
function skillsFrom(assessment) {
  const analysis = plain(assessment.experienceAnalysis) ? assessment.experienceAnalysis : {};
  const narrative = typeof assessment.experienceText === 'string' ? assessment.experienceText.slice(0, 50000) : '';
  const result = [];
  const seen = new Set();
  for (const value of [...strings(analysis.skills), ...strings(analysis.tools)]) {
    const name = clean(value, 80);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    // A keyword extracted by a rule is a mention, never a qualification or a
    // proficiency score. Import only a small relevant excerpt when one exists.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = /[A-Za-z]/.test(name) ? new RegExp(`(?:^|[^A-Za-z0-9_])(${escaped})(?=$|[^A-Za-z0-9_])`, 'i').exec(narrative) : null;
    const at = /[A-Za-z]/.test(name) ? (match ? match.index + match[0].length - match[1].length : -1) : narrative.toLocaleLowerCase().indexOf(key);
    const evidence = at < 0 ? '' : redact(narrative.slice(Math.max(0, at - 35), Math.min(narrative.length, at + name.length + 85)));
    const explicitlyNegative = at >= 0 && /不会|不能|未掌握|尚未|没有.{0,8}(?:使用|学习|接触)|未曾|不懂/.test(narrative.slice(Math.max(0, at - 18), at));
    result.push({ name, evidence, level: evidence && !explicitlyNegative ? 'self_reported' : 'score_only', evidenceType: evidence && !explicitlyNegative ? 'text' : 'mention' });
  }
  for (const [scores, names] of [[assessment.softSkills, SOFT_NAMES], [analysis.abilityScores, ABILITY_NAMES]]) {
    if (!plain(scores)) continue;
    for (const [key, name] of Object.entries(names)) {
      const score = scores[key];
      if (!Number.isFinite(score) || score < 0 || score > 100 || seen.has(name)) continue;
      seen.add(name);
      result.push({ name, score, evidence: '旧模块本地规则评分，不能证明能力达标或个人成绩。', level: 'score_only', evidenceType: 'score' });
    }
  }
  return result.slice(0, 80);
}
function preferencesFrom(assessment) {
  const preferences = {};
  const choice = assessment.studentProfile?.employmentChoice;
  if (['same', 'cross', 'unsure'].includes(choice)) preferences.employmentChoice = choice;
  const location = clean(assessment.jobSearchPreferences?.location, 80);
  if (location) preferences.location = location;
  const snapshots = Array.isArray(assessment.directionSnapshots) ? assessment.directionSnapshots.filter(plain) : [];
  preferences.directions = strings(assessment.directionRanking, 5).map(id => snapshots.find(item => item.id === id)).filter(Boolean).map(item => ({ title: clean(item.direction), jobs: strings(item.jobs, 8).map(job => clean(job, 80)).filter(Boolean) })).filter(item => item.title);
  return preferences;
}
function available(raw) {
  const { assessment, preparation } = sources(raw);
  const profile = plain(assessment.studentProfile) ? assessment.studentProfile : {};
  const preferences = preferencesFrom(assessment);
  return {
    education: ['undergraduate', 'graduate'].includes(profile.education) ? 1 : 0,
    major: clean(profile.major) ? 1 : 0,
    stage: ['junior', 'senior', 'other'].includes(preparation.stage) ? 1 : 0,
    skills: skillsFrom(assessment).length,
    preferences: Number(Boolean(preferences.employmentChoice)) + Number(Boolean(preferences.location)) + preferences.directions.length,
  };
}

/** raw may be the legacy assessment or { assessment, preparation }. */
export function safeLegacyProfile(raw, selectedFields, { now = () => new Date().toISOString() } = {}) {
  const selected = fieldsToImport(selectedFields);
  const { assessment, preparation } = sources(raw);
  const profile = plain(assessment.studentProfile) ? assessment.studentProfile : {};
  const authorizedAt = now();
  if (typeof authorizedAt !== 'string' || !Number.isFinite(Date.parse(authorizedAt))) throw new Error('授权时间格式无效。');
  const result = { schemaVersion: 1, source: 'legacy-career', authorizedFields: selected, authorizedAt };
  if (selected.includes('education') && ['undergraduate', 'graduate'].includes(profile.education)) result.education = profile.education;
  if (selected.includes('major') && clean(profile.major)) result.major = clean(profile.major);
  if (selected.includes('stage') && ['junior', 'senior', 'other'].includes(preparation.stage)) result.stage = preparation.stage;
  if (selected.includes('skills')) result.skills = skillsFrom(assessment);
  if (selected.includes('preferences')) result.preferences = preferencesFrom(assessment);
  return result;
}

export function legacyLinks(node) {
  const blocked = node?.private === true;
  return {
    jobSearch: { href: '/job-search.html', keyword: blocked ? '' : clean(node?.title, 120), requiresCopy: true, blocked, note: blocked ? '私密节点不能带入岗位搜索。' : '旧搜索页不读取查询参数；复制关键词后前往粘贴。' },
    report: { href: '/index.html', note: '进入原测评首页，再查看当前或历史综合报告。' },
    preparation: { href: '/career-prep.html', note: '进入原求职冲刺页，由你决定是否导入测评资料。' },
  };
}

export class LegacyCareerAdapter {
  #profile = null;
  constructor(storage, options = {}) { this.storage = storage; this.options = options; }
  #read() {
    const warnings = [];
    const result = {};
    for (const [name, key] of [['assessment', 'careerPredictor'], ['preparation', 'careerPredictorPrep']]) {
      try {
        const raw = this.storage.getItem(key);
        if (raw === null) { result[name] = {}; continue; }
        if (typeof raw !== 'string' || raw.length > 2000000) throw new Error('invalid');
        const parsed = JSON.parse(raw);
        if (!plain(parsed)) throw new Error('invalid');
        result[name] = parsed;
      } catch { result[name] = {}; warnings.push('部分旧资料无法读取，原数据未改动。'); }
    }
    return { raw: result, warnings: [...new Set(warnings)] };
  }
  inspect() {
    const { raw, warnings } = this.#read();
    const counts = available(raw);
    return { available: Object.values(counts).some(Boolean), fields: LegacyFieldOptions.map(field => ({ ...field, available: counts[field.id] > 0, count: counts[field.id] })), warnings };
  }
  authorize(selectedFields) {
    const selected = fieldsToImport(selectedFields);
    const { raw } = this.#read();
    const counts = available(raw);
    if (!selected.some(field => counts[field] > 0)) throw new Error('所选字段暂时没有可导入的旧资料。');
    this.#profile = safeLegacyProfile(raw, selected, this.options);
    return this.snapshot();
  }
  snapshot() { return this.#profile ? structuredClone(this.#profile) : null; }
  revoke() { this.#profile = null; return null; }
  links(node) { return legacyLinks(node); }
}
