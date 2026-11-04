/**
 * P0 material/JD correspondence. Browser and server use this exact implementation.
 * The numeric result is explicit keyword coverage, never an ability rating or
 * a hiring probability. Preferences, school prestige and inferred scores add no points.
 */
export const RULE_VERSION = 'career-material-jd-v1';
const DICTIONARY = [
  'Python','JavaScript','TypeScript','Java','C++','C#','Go','Rust','React','Vue','Node.js',
  'SQL','HTML','CSS','Spring','Django','Flask','Excel','PPT','Figma','Sketch','Photoshop',
  'SPSS','MATLAB','Tableau','Power BI','Jira','Confluence','Git','Docker','AWS','Azure',
  'Axure','R','机器学习','深度学习','人工智能','数据库','数据结构','算法','数据分析',
  '可视化','统计','用户调研','竞品分析','需求分析','原型','用户运营','内容运营',
  '活动策划','项目管理','沟通','协调','团队协作','写作','翻译','问题解决','财务分析',
  '实验设计','实验方法','数据记录','质量工具','工程制图','文献检索','建模','测试',
  '电路','设计工具','商务写作','市场研究','供应链','会计准则','报告写作',
];
const ACCEPTED_SOURCES = new Set(['user_form','user_text','document_extract','legacy_import']);
const clean = value => typeof value === 'string' ? value.trim().slice(0, 30000) : '';
const canonical = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const unique = items => [...new Map(items.map(item => [canonical(item), clean(item)])).values()].filter(Boolean).sort((a,b) => canonical(a).localeCompare(canonical(b), 'en'));
const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function positions(text, term) {
  const literal = escapeRE(clean(term)).replace(/\s+/g, '\\s*');
  // Latin identifiers require word boundaries (Java != JavaScript, R != report).
  const latin = /^[\x00-\x7F ]+$/.test(term);
  const re = new RegExp((latin ? '(^|[^a-z0-9_])' : '') + '(' + literal + ')' + (latin ? '(?![a-z0-9_])' : ''), 'gi');
  return [...text.matchAll(re)].map(match => ({ at: match.index + (latin ? match[1].length : 0), word: latin ? match[2] : match[1] }));
}

function evidenceFor(text, term) {
  for (const hit of positions(text, term)) {
    const before = text.slice(Math.max(0, hit.at - 18), hit.at);
    // Neither a negation nor a future learning plan demonstrates an existing skill.
    if (/(?:不会|不懂|未学过|没有学过|没有使用过|尚未掌握|没用过|不熟悉|不具备|没接触过|不掌握|零基础|待学习|想学|计划学习|准备学|打算学)[^，。；\n]{0,10}$/i.test(before)) continue;
    const quote = text.slice(Math.max(0, hit.at - 22), Math.min(text.length, hit.at + term.length + 24));
    const clause = before.split(/[，,。；;\n]/).at(-1) + text.slice(hit.at, hit.at + term.length + 6).split(/[，,。；;\n]/)[0];
    return { quote, strength: /会一点|入门|初学|略懂|了解|基础|接触过|不熟练/.test(clause) ? 'self_reported_basic' : 'mentioned', verified: false };
  }
  return null;
}

function valueText(value) {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join('\n').slice(0,30000);
  if (value && typeof value === 'object') {
    // Preserve entry-level source exclusions. No arbitrary AI metadata becomes evidence.
    if (value.source_type && !ACCEPTED_SOURCES.has(value.source_type)) return '';
    if (value.text != null) return valueText(value.text);
    const name = valueText(value.name ?? value.value ?? '');
    const strength = typeof (value.strength ?? value.level) === 'string' ? clean(value.strength ?? value.level) : '';
    return [strength, name].filter(Boolean).join(' ');
  }
  return '';
}

export function normalizeProfile(profile = {}) {
  if (profile?.normalized_by === RULE_VERSION) return profile;
  const fields = profile?.fields;
  const evidence = [];
  let degree = '', major = '';
  if (fields && typeof fields === 'object') {
    const usable = path => {
      const field = fields[path];
      return field && field.value_state === 'known' && ACCEPTED_SOURCES.has(field.source_type) ? field : null;
    };
    degree = valueText(usable('education.degree')?.value);
    major = valueText(usable('education.major')?.value);
    ['experience.text','skills.self_report'].forEach(path => {
      const field = usable(path);
      const text = valueText(field?.value);
      if (text) evidence.push({ text, field_path: path, source_type: field.source_type, source_refs: Array.isArray(field.source_refs) ? field.source_refs : [], confirmation_state: field.confirmation_state || 'unconfirmed' });
    });
  } else {
    // Legacy rules may have produced ability scores/tags. Only original input is evidence.
    degree = clean(profile.studentProfile?.education ?? profile.education?.degree ?? profile.degree);
    major = clean(profile.studentProfile?.major ?? profile.education?.major ?? profile.major);
    const original = valueText(profile.experienceText ?? profile.experience?.text ?? profile.resume ?? '');
    if (original) evidence.push({ text: original, field_path: 'experience.text', source_type: 'user_text', confirmation_state: 'unconfirmed' });
    const selfReport = valueText(profile.self_report ?? profile['skills.self_report'] ?? '');
    if (selfReport) evidence.push({ text: selfReport, field_path: 'skills.self_report', source_type: 'user_form', confirmation_state: 'unconfirmed' });
  }
  evidence.sort((a,b) => a.field_path.localeCompare(b.field_path) || a.text.localeCompare(b.text));
  return { normalized_by: RULE_VERSION, degree, major, evidence };
}

export function normalizeJD(jd = '') {
  if (jd?.normalized_by === RULE_VERSION) return jd;
  const text = typeof jd === 'string' ? clean(jd) : unique([jd.title, jd.snippet, jd.description].map(clean)).join('\n');
  const supplied = Array.isArray(jd?.requirements) ? jd.requirements.slice(0,60).map(item => clean(typeof item === 'string' ? item : item?.term)).filter(term => term.length <= 80) : [];
  const terms = unique(supplied.length ? supplied : DICTIONARY.filter(term => positions(text, term).length > 0));
  return { normalized_by: RULE_VERSION, text, terms };
}

function degreeLevel(text) {
  if (/博士|doctor|phd/i.test(text)) return 4;
  if (/硕士|研究生|graduate|master/i.test(text) && !/undergraduate/i.test(text)) return 3;
  if (/本科|学士|undergraduate|bachelor/i.test(text)) return 2;
  if (/大专|专科|associate/i.test(text)) return 1;
  return null;
}

function hardGates(profile, text) {
  const gates = [];
  const knownDegree = degreeLevel(profile.degree);
  const onlyBachelor = /(?:仅限|只招|仅面向)[^。；\n]{0,8}本科(?!\s*(?:及以上|或硕士|、硕士))/.test(text);
  // Lower allowed levels take precedence over a preferred higher qualification.
  // A degree mentioned as "优先" alone cannot reject a candidate.
  const required = /学历不限|不限学历/.test(text) ? 0 : onlyBachelor ? 2
    : /(?:大专|专科)(?:学历)?(?:及以上|以上)/.test(text) ? 1
    : /(?:本科|学士)(?:学历|学位)?(?:及以上|以上|或硕士|、硕士)/.test(text) ? 2
    : /(?:硕士|研究生)(?:学历|学位)?(?:及以上|以上|或博士|、博士)/.test(text) ? 3
    : /(?:博士)(?:研究生)?(?:学历|学位)?(?:及以上|以上)/.test(text) ? 4
    : /(?:学历要求|最低学历|仅限|要求)[^。；\n]{0,8}博士(?![^。；\n]{0,3}优先)/.test(text) ? 4
    : /(?:学历要求|最低学历|仅限|要求)[^。；\n]{0,8}(?:硕士|研究生)(?![^。；\n]{0,3}优先)/.test(text) ? 3
    : /(?:学历要求|最低学历|仅限|要求)[^。；\n]{0,8}(?:本科|学士)(?![^。；\n]{0,3}优先)/.test(text) ? 2
    : /(?:学历要求|最低学历|仅限|要求)[^。；\n]{0,8}(?:大专|专科)(?![^。；\n]{0,3}优先)/.test(text) ? 1 : null;
  if (required !== null) {
    const status = required === 0 ? 'supported' : knownDegree === null ? 'unknown' : (onlyBachelor ? knownDegree === 2 : knownDegree >= required) ? 'supported' : 'not_met';
    gates.push({ field_path: 'education.degree', requirement: onlyBachelor ? '仅限本科生' : ['学历不限','专科及以上','本科及以上','硕士/研究生及以上','博士'][required], value: profile.degree || null, status,
      explanation: status === 'unknown' ? '材料尚未明确学历，不能据此判定不符合。' : status === 'not_met' ? '已填写学历与公开要求不符，请核对原文。' : '填写信息与该项文字要求相符，仍需按招聘方标准核实。' });
  }
  if (/专业要求|相关专业|专业背景|限[^。；\n]{0,8}专业|不限专业|专业不限/.test(text)) {
    const unrestricted = /专业不限|不限专业/.test(text);
    const status = unrestricted || (profile.major && positions(text, profile.major).length > 0) ? 'supported' : 'unknown';
    gates.push({ field_path:'education.major', requirement: unrestricted ? '专业不限' : '具体专业范围见原文', value: profile.major || null, status,
      explanation: status === 'unknown' ? '无法仅凭摘要确认专业范围，需向招聘方核实。' : '公开文字包含该专业或明确不限专业。' });
  }
  return gates;
}

export function evaluate(profile, jd) {
  const p = normalizeProfile(profile), j = normalizeJD(jd);
  const matches = [], missing = [];
  const evidence = [];
  for (const term of j.terms) {
    const support = p.evidence.map(item => ({ item, found: evidenceFor(item.text, term) })).find(item => item.found);
    if (support) {
      matches.push(term);
      evidence.push({ term, ...support.found, field_path: support.item.field_path, source_type: support.item.source_type, source_refs: support.item.source_refs || [], confirmation_state: support.item.confirmation_state,
        proficiency_note: /熟练|精通|掌握/.test(j.text.slice(Math.max(0, j.text.toLowerCase().indexOf(term.toLowerCase()) - 8), j.text.toLowerCase().indexOf(term.toLowerCase()) + term.length + 4)) ? 'JD 的熟练程度要求需要另行核实；提及关键词不代表达到要求。' : '仅表示材料提及，不作熟练等级认定。' });
    } else missing.push(term);
  }
  const hasEvidence = matches.length > 0 || p.evidence.some(item => DICTIONARY.some(term => evidenceFor(item.text, term)));
  const score = hasEvidence && j.terms.length ? Math.round(matches.length / j.terms.length * 100) : null;
  const gates = hardGates(p, j.text);
  const eligibility = gates.some(item => item.status === 'not_met') ? 'ineligible' : gates.length && gates.every(item => item.status === 'supported') ? 'eligible' : 'uncertain';
  const reasons = [];
  const gaps = [];
  if (matches.length) reasons.push('材料中提及：' + matches.join('、'));
  if (!hasEvidence) gaps.push('尚未提供可用于比较的经历或技能原文，暂不评分。');
  if (!j.terms.length) gaps.push('JD 没有可识别的要求词，暂不评分；请核对完整岗位描述。');
  if (missing.length) gaps.push('材料尚未体现：' + missing.join('、') + '；这不等于没有这些能力。');
  gates.forEach(gate => (gate.status === 'supported' ? reasons : gaps).push(gate.requirement + '：' + gate.explanation));
  return { rule_version: RULE_VERSION, status: score === null ? 'not_evaluated' : 'evaluated', score, matchScore: score,
    eligibility, matchedSkills: matches, gapSkills: missing, matchReasons: reasons, gapReasons: gaps,
    hard_gates: gates, evidence, keyword_coverage: { matched: matches.length, total: j.terms.length, percent: score },
    explanation: '匹配分是材料与 JD 的关键词对应程度；学历等硬门槛独立核对。关键词提及不证明熟练程度，不代表录用概率。' };
}

export const CareerScoring = Object.freeze({ RULE_VERSION, normalizeProfile, normalizeJD, evaluate });
if (typeof window !== 'undefined') window.CareerScoring = CareerScoring;
