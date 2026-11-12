import { FIELD_PATHS } from '../p0/analysis.js';
import { ALLOWED_SEARCH_DOMAINS, sanitizeAuthorizedProfile } from './research.js';
import { careerOccupationSources } from './career-occupations.js';

const SEARCH_DOMAINS = [
  ...ALLOWED_SEARCH_DOMAINS, 'onetonline.org', 'career.huawei.com', 'talent.baidu.com',
  'job.byd.com', 'talent.catl.com', 'yz.tsinghua.edu.cn', 'admission.pku.edu.cn',
];
const PROFILE_SOURCE_TYPES = new Set(['user_form', 'user_text', 'document_extract', 'legacy_import', 'ai_inference']);
const LOCAL_PROFILE_FIELDS = ['experience', 'interests', 'values', 'goals', 'constraints'];
const RESEARCH_MESSAGES = {
  OFFLINE_KB: '已在职业知识库和本次提供的资料中检索。',
  LIVE_AND_LOCAL: '已查询公开信息和本次可用资料。公开搜索片段需核对原文。',
  SEARCH_NOT_CONFIGURED: '实时检索服务尚未配置，已查询本次可用的离线资料。',
  SEARCH_NO_VERIFIABLE_RESULTS: '实时检索未返回可用的官方来源，已查询本次可用的离线资料。',
  SEARCH_UNAVAILABLE: '实时检索暂不可用，已查询本次可用的离线资料。',
};

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_CAREER_INTELLIGENCE_REQUEST' });
}

function redact(value, max) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200d\ufeff]/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已省略]')
    .replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, '[联系电话已省略]')
    .replace(/\d{17}[\dXx](?!\d)/g, '[证件号已省略]')
    .replace(/(?:微信(?:号)?|QQ|学号|电话|手机|联系(?:方式|人))\s*[:：]\s*[^\s，,。；;]+/gi, '[联系资料已省略]')
    .trim().slice(0, max);
}

export { redact as redactCareerText };

function profileFacts(profile) {
  if (profile?.consent !== true) return [];
  const fields = Array.isArray(profile.authorizedFields) ? new Set(profile.authorizedFields) : null;
  const facts = new Map();
  for (const fact of sanitizeAuthorizedProfile(profile)) {
    const normalizedField = { education: 'education.degree', major: 'education.major', stage: 'education.stage' }[fact.field] || fact.field;
    const cleaned = Object.fromEntries(Object.entries(fact).map(([key, value]) => [key, redactProfileValue(value)]));
    const key = ['skill', 'preference.direction'].includes(fact.field) ? `${normalizedField}:${cleaned.name || cleaned.value}` : normalizedField;
    facts.set(key, {
      ...cleaned, field: normalizedField,
      verificationStatus: fact.evidenceType === 'score' || fact.level === 'score_only' ? 'inference' : 'self_reported',
    });
  }
  for (const field of LOCAL_PROFILE_FIELDS) {
    if (fields && !fields.has(field)) continue;
    const value = redact(profile[field], 1500);
    if (value) facts.set(field, { field, value, provenance: 'user_authorized_profile', verificationStatus: 'self_reported' });
  }
  for (const field of FIELD_PATHS) {
    if (fields && !fields.has(field) && !fields.has('fields')) continue;
    const record = profile.fields?.[field];
    if (record?.value_state !== 'known') continue;
    const value = redact(record.value, 2000);
    if (!value) continue;
    const sourceType = PROFILE_SOURCE_TYPES.has(record.source_type) ? record.source_type : 'user_authorized_profile';
    const confirmation = ['confirmed', 'corrected'].includes(record.confirmation_state) ? record.confirmation_state : 'unconfirmed';
    const verificationStatus = sourceType === 'ai_inference' && confirmation === 'unconfirmed' ? 'inference' : 'self_reported';
    const targetField = field === 'experience.text' ? 'experience' : field;
    if (verificationStatus === 'inference' && facts.has(targetField)) continue;
    facts.set(targetField, { field, value, provenance: sourceType, confirmation, verificationStatus });
  }
  return [...facts.values()];
}

function redactProfileValue(value) {
  if (Array.isArray(value)) return value.map((item) => redact(item, 120)).filter(Boolean);
  return redact(value, 300);
}

function historyMessages(history) {
  if (history === undefined) return [];
  if (!Array.isArray(history) || history.length > 40) invalid('历史问答格式不正确或条目过多。');
  function message(role, value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 12000) invalid('历史问答内容格式不正确。');
    return { role, content: redact(value, 1200), verificationStatus: role === 'user' ? 'self_reported' : 'inference' };
  }
  return history.slice(-8).flatMap((item) => {
    if (['user', 'assistant'].includes(item?.role)) return [message(item.role, item.content)];
    if (typeof item?.question !== 'string') invalid('历史问答角色格式不正确。');
    return [message('user', item.question), ...(item.answer ? [message('assistant', item.answer)] : [])];
  }).slice(-8);
}

function requestDocuments(documents) {
  if (documents === undefined) return undefined;
  if (!Array.isArray(documents) || documents.length > 3) invalid('本次最多使用 3 份资料。');
  return documents.map((document) => {
    if (!document || !['text', 'pdf_excerpt'].includes(document.kind ?? 'text') ||
        typeof document.text !== 'string' || !document.text.trim() || document.text.length > 20000) {
      invalid('每份资料须为 20,000 字以内的文本或已提取的 PDF 片段。');
    }
    return { kind: document.kind ?? 'text', title: redact(document.title, 120), text: redact(document.text, 20000), locator: redact(document.locator, 240) };
  });
}

function evidenceSummary(entry) {
  return {
    sourceId: entry.sourceId, title: entry.title, url: entry.url || null,
    excerpt: entry.excerpt, locator: entry.locator, publisher: entry.publisher,
    checkedAt: entry.checkedAt, publishedAt: entry.publishedAt ?? null, stale: entry.stale,
    trustLevel: entry.trustLevel, verificationStatus: entry.verificationStatus,
    origin: entry.origin, category: entry.category, applicability: entry.applicability, region: entry.region,
  };
}

export async function buildCareerIntelligenceContext(body, { research, signal }) {
  const message = redact(body.message ?? body.question, 4000);
  if (!message) invalid('请输入要分析的职业规划问题。');
  const knownProfile = profileFacts(body.profile);
  const history = historyMessages(body.history);
  const modelContext = { message, profile: knownProfile, history, evidence: [] };
  const liveSearch = body.liveSearch === true;
  if (body.researchEnabled !== true) {
    if (liveSearch) invalid('开启联网查询前，请允许资料检索。');
    return {
      modelContext, sources: [],
      retrieval: { enabled: false, liveSearchPerformed: false, reasonCode: 'RESEARCH_DISABLED', message: '本次未启用资料检索。' },
    };
  }

  let publicSearchQuery;
  if (liveSearch) {
    if (typeof body.publicSearchQuery !== 'string' || !body.publicSearchQuery.trim() || body.publicSearchQuery.length > 320) invalid('请填写 320 字以内的公开查询词。');
    publicSearchQuery = redact(body.publicSearchQuery.replace(/https?:\/\/\S+/gi, ' '), 320);
    if (!publicSearchQuery || publicSearchQuery.includes('已省略]')) invalid('公开查询词请只填写岗位、机构、项目等公开信息。');
  }
  const profileKeywords = knownProfile.filter((fact) => fact.verificationStatus === 'self_reported' && ['education.major', 'skill', 'skills.self_report'].includes(fact.field))
    .map((fact) => (fact.name || fact.value).slice(0, 120));
  const routeTitles = (body.routes || []).map((route) => redact(route.title, 120));
  const focusTitles = [redact(body.focusNode?.title, 120), redact(body.focusNode?.parentTitle, 120)];
  const question = [message, ...new Set([...routeTitles, ...focusTitles, ...profileKeywords].filter(Boolean))].join('\n').slice(0, 4000);
  const result = await research.retrieve({
    question, documents: requestDocuments(body.documents), liveSearch,
  }, {
    signal, publicSearchQuery, searchDomains: SEARCH_DOMAINS,
    additionalSources: careerOccupationSources, includeDocumentFallback: true,
  });
  const evidence = result.evidence.map(evidenceSummary);
  modelContext.evidence = evidence;
  const sources = evidence.filter((entry, index) => evidence.findIndex((source) => source.sourceId === entry.sourceId) === index);
  return {
    modelContext, sources,
    retrieval: {
      enabled: true, checkedAt: result.checkedAt, ...result.status,
      message: RESEARCH_MESSAGES[result.status.reasonCode], warnings: result.caveats,
    },
  };
}
