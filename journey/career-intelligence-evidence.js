import { ALLOWED_SEARCH_DOMAINS, createResearchService } from './research.js';
import { buildCareerProfileContext, redactProfileText } from './career-profile-context.js';
import { careerOccupationSources } from './career-occupations.js';

const SEARCH_DOMAINS = [
  ...ALLOWED_SEARCH_DOMAINS, 'onetonline.org', 'career.huawei.com', 'talent.baidu.com',
  'job.byd.com', 'talent.catl.com', 'yz.tsinghua.edu.cn', 'admission.pku.edu.cn',
];
const RESEARCH_MESSAGES = {
  OFFLINE_KB: '已在职业知识库和本次提供的资料中检索。',
  LIVE_AND_LOCAL: '已查询公开信息和本次可用资料。公开搜索片段需核对原文。',
  SEARCH_NOT_CONFIGURED: '实时检索服务尚未配置，已查询本次可用的离线资料。',
  SEARCH_NO_VERIFIABLE_RESULTS: '实时检索未返回可用的官方来源，已查询本次可用的离线资料。',
  SEARCH_UNAVAILABLE: '实时检索暂不可用，已查询本次可用的离线资料。',
  RETRIEVAL_UNAVAILABLE: '资料检索未完整完成，本次按实际可用资料继续分析。',
};

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_CAREER_INTELLIGENCE_REQUEST' });
}

function redact(value, max) {
  return redactProfileText(value).slice(0, max);
}

export { redact as redactCareerText };

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

async function retrieveWithFallback(research, input, options, now) {
  function preserveRequestFailure(error) {
    if (options.signal?.aborted || error?.name === 'AbortError' || error?.code === 'INVALID_RESEARCH_REQUEST') throw error;
  }
  try {
    const result = await research.retrieve(input, options);
    if (!Array.isArray(result?.evidence) || !result.status || typeof result.status !== 'object') throw new Error('Invalid research result');
    return result;
  } catch (error) {
    preserveRequestFailure(error);
  }

  // Keep supplied documents request-local, and never retry an external query here.
  let fallback = { evidence: [], caveats: [], status: { localAvailable: false, userDocumentsUsed: 0 } };
  try {
    fallback = await createResearchService({ env: {}, now }).retrieve({ ...input, liveSearch: false }, options);
  } catch (error) {
    preserveRequestFailure(error);
  }
  return {
    ...fallback,
    status: {
      ...fallback.status, degraded: true, reasonCode: 'RETRIEVAL_UNAVAILABLE', liveConfigured: null,
      liveSearchPerformed: input.liveSearch ? null : false,
    },
    caveats: [
      ...(fallback.caveats || []),
      ...(input.liveSearch ? ['原检索服务未返回完整结果，无法确认联网查询是否完成。'] : []),
    ],
  };
}

export async function buildCareerIntelligenceContext(body, { research, signal, now = Date.now, resolvedProfile, preparedProfileContext } = {}) {
  signal?.throwIfAborted();
  const message = redact(body.message ?? body.question, 4000);
  if (!message) invalid('请输入要分析的职业规划问题。');
  const prepared = preparedProfileContext || buildCareerProfileContext({ body, resolvedProfile });
  const knownProfile = prepared.profile;
  const profileDiagnostics = { ...prepared.profileDiagnostics };
  const history = historyMessages(body.history);
  profileDiagnostics.historyCount = history.length;
  let profileStatus = profileDiagnostics.authorized ? knownProfile.length ? 'available' : 'empty' : 'not_requested';
  if (!knownProfile.length && profileDiagnostics.status !== 'not_requested' &&
      ['session_expired', 'storage_unavailable', 'load_failed'].includes(profileDiagnostics.connectionStatus)) {
    profileStatus = profileDiagnostics.connectionStatus;
  }
  const contextAvailability = {
    profile: {
      status: profileStatus,
      factCount: knownProfile.length,
      selfReportedFactCount: knownProfile.filter(fact => fact.verificationStatus === 'self_reported').length,
      inferredFactCount: knownProfile.filter(fact => fact.verificationStatus === 'inference').length,
    },
    history: {
      status: body.history === undefined ? 'not_supplied' : history.length ? 'available' : 'empty',
      messageCount: history.length, userMessageCount: history.filter(turn => turn.role === 'user').length,
    },
    documents: { status: 'not_requested', documentCount: 0, passageCount: 0 },
    research: {
      status: 'not_requested', reasonCode: 'RESEARCH_DISABLED', evidenceCount: 0,
      liveSearchRequested: false, liveSearchPerformed: false, liveSourceCount: 0,
    },
  };
  const modelContext = { message, profile: knownProfile, history, evidence: [], contextAvailability, profileDiagnostics };
  const liveSearch = body.liveSearch === true;
  if (body.researchEnabled !== true) {
    if (liveSearch) invalid('开启联网查询前，请允许资料检索。');
    return {
      modelContext, profileDiagnostics, sources: [],
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
  const documents = requestDocuments(body.documents);
  const result = await retrieveWithFallback(research, {
    question, documents, liveSearch,
  }, {
    signal, publicSearchQuery, searchDomains: SEARCH_DOMAINS,
    additionalSources: careerOccupationSources, includeDocumentFallback: true,
  }, now);
  signal?.throwIfAborted();
  const evidence = result.evidence.map(evidenceSummary);
  modelContext.evidence = evidence;
  const sources = evidence.filter((entry, index) => evidence.findIndex((source) => source.sourceId === entry.sourceId) === index);
  const personalPassages = evidence.filter(entry => entry.origin === 'user_document');
  contextAvailability.documents = {
    status: documents?.length ? personalPassages.length ? 'available' : 'not_retrieved' : 'empty',
    documentCount: documents?.length || 0, passageCount: personalPassages.length,
  };
  contextAvailability.research = {
    status: result.status.degraded ? 'degraded' : 'completed', reasonCode: result.status.reasonCode,
    evidenceCount: evidence.length, liveSearchRequested: liveSearch,
    liveSearchPerformed: result.status.liveSearchPerformed,
    liveSourceCount: sources.filter(source => source.origin === 'live_search').length,
  };
  return {
    modelContext, profileDiagnostics, sources,
    retrieval: {
      enabled: true, checkedAt: result.checkedAt, ...result.status,
      message: RESEARCH_MESSAGES[result.status.reasonCode], warnings: result.caveats,
    },
  };
}
