import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { SearchClient, Config } from 'coze-coding-dev-sdk';

const bundled = JSON.parse(readFileSync(new URL('./knowledge-sources.json', import.meta.url), 'utf8')).sources;
export const ALLOWED_SEARCH_DOMAINS = Object.freeze(['postgraduate.study.cam.ac.uk', 'imperial.ac.uk', 'pmi.org', 'careers.abb']);
const DAY = 86400000;
const clean = (value, max = 2000) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200d\ufeff]/g, '').trim().slice(0, max) : '';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const profileText = (value, max) => clean(value, max).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[联系方式已省略]').replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}/g, '[联系方式已省略]').replace(/(?:微信|QQ|电话|手机|邮箱)\s*[:：]\s*[^\s，,；;]+/gi, '[联系方式已省略]');
function invalid(message) { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_RESEARCH_REQUEST' }); }
function iso(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined; }

export function isHardFactQuestion(question) {
  return /截止|报名|招生|录取|学费|薪资|工资|证书|资格|雅思|托福|英语要求|语言成绩|申请条件|入学|报考|学术标准|学位要求|专业限制|工作经验|学历|硬性|法定|招聘|岗位要求|目前|今年|最新|20\d{2}|deadline|admission|eligibility|salary|certificate|ielts|toefl|requirement/i.test(question || '');
}

function reflectionOnly(question) {
  return !isHardFactQuestion(question) && /人生意义|哲学|存在主义|价值观|如何看待|我是谁|热爱|喜欢音乐|自由与|生活意义|人生选择/.test(question || '');
}

export function sanitizeAuthorizedProfile(profile) {
  if (!profile || profile.consent !== true) return [];
  const facts = [];
  const authorized = Array.isArray(profile.authorizedFields) ? new Set(profile.authorizedFields.filter((field) => typeof field === 'string')) : null;
  const permitted = (field) => !authorized || authorized.has(field);
  for (const field of ['education', 'major', 'stage']) {
    if (!permitted(field)) continue;
    const value = profileText(profile[field], 160);
    if (value) facts.push({ field, value, provenance: 'user_authorized_profile' });
  }
  if (permitted('skills') && Array.isArray(profile.skills)) {
    for (const skill of profile.skills.slice(0, 20)) {
      if (!skill || typeof skill !== 'object') continue;
      const name = profileText(skill.name, 80);
      if (name) facts.push({ field: 'skill', name, evidence: profileText(skill.evidence, 300), level: profileText(skill.level, 80), ...(['text', 'score', 'mention'].includes(skill.evidenceType) ? { evidenceType: skill.evidenceType } : {}), provenance: 'user_authorized_profile_self_reported_not_certification' });
    }
  }
  // Never serialize arbitrary profile objects, assessment answers or contact data.
  if (permitted('preferences') && profile.preferences && typeof profile.preferences === 'object' && !Array.isArray(profile.preferences)) {
    for (const field of ['location', 'locations', 'industries', 'workStyle', 'schedule', 'values']) {
      const raw = profile.preferences[field];
      const value = Array.isArray(raw) ? raw.slice(0, 8).map((item) => profileText(item, 80)).filter(Boolean).join('、') : profileText(raw, 160);
      if (value) facts.push({ field: `preference.${field}`, value, provenance: 'user_authorized_profile_preference_not_hiring_requirement' });
    }
    if (['same', 'cross', 'unsure'].includes(profile.preferences.employmentChoice)) facts.push({ field: 'preference.employmentChoice', value: profile.preferences.employmentChoice, provenance: 'user_authorized_profile_preference_not_hiring_requirement' });
    if (Array.isArray(profile.preferences.directions)) for (const direction of profile.preferences.directions.slice(0, 4)) {
      const title = profileText(direction?.title, 100);
      if (title) facts.push({ field: 'preference.direction', value: title, jobs: Array.isArray(direction.jobs) ? direction.jobs.slice(0, 4).map((job) => profileText(job, 80)).filter(Boolean) : [], provenance: 'user_authorized_profile_preference_not_hiring_requirement' });
    }
  }
  return facts;
}

function attributionURL(raw, officialOnly = false) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || isIP(hostname.replace(/^\[|\]$/g, '')) || hostname === 'localhost' || hostname.endsWith('.local')) return '';
    if (officialOnly && !ALLOWED_SEARCH_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^trk$|^fbclid$/.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}

export function splitIntoChunks(content, { size = 800, overlap = 100 } = {}) {
  if (!Number.isInteger(size) || size < 100 || size > 2000 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) invalid('资料分块参数不正确。');
  const value = clean(content, 20000);
  const chunks = [];
  for (let start = 0; start < value.length; start += size - overlap) {
    const end = Math.min(value.length, start + size);
    chunks.push({ text: value.slice(start, end), start, end });
    if (end === value.length) break;
  }
  return chunks;
}

function words(value) {
  const normalized = clean(value, 12000).toLowerCase();
  const result = new Set(normalized.match(/[a-z][a-z0-9.+-]{1,39}|\d+(?:\.\d+)?/g) || []);
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  for (const segment of segmenter.segment(normalized)) if (segment.isWordLike && /[\u4e00-\u9fff]/.test(segment.segment) && segment.segment.length > 1) result.add(segment.segment);
  return [...result].filter((word) => !['要求', '需要', '哪些', '什么', '是否', '当前', '路径', '可以', '一下', '如何', 'the', 'and', 'for', 'what', 'are'].includes(word));
}

function userDocuments(documents, now) {
  if (documents === undefined) return [];
  if (!Array.isArray(documents) || documents.length > 3) invalid('本次最多使用 3 份自愿提供的资料片段。');
  return documents.map((document, index) => {
    if (!document || typeof document !== 'object' || !['text', 'pdf_excerpt'].includes(document.kind || 'text')) invalid('上传资料类型必须是文本或已提取的 PDF 片段。');
    if (typeof document.text !== 'string' || !document.text.trim() || document.text.length > 20000) invalid('每份资料须为 20000 字以内的非空文本。');
    const content = clean(document.text, 20000);
    const url = attributionURL(document.url);
    if (document.url && !url) invalid('资料来源链接须为不含账户信息的公开 HTTPS 地址；不会抓取该地址。');
    return {
      id: `user_${hash(`${index}|${content}|${clean(document.title, 120)}`).slice(0, 24)}`,
      title: clean(document.title, 120) || `自愿提供的${document.kind === 'pdf_excerpt' ? ' PDF 片段' : '资料'} ${index + 1}`,
      publisher: clean(document.publisher, 160) || '用户自愿提供，未独立核实', url,
      publishedAt: iso(document.publishedAt), checkedAt: new Date(now).toISOString(),
      region: '用户资料，适用地区待核实', language: 'user-provided',
      license: '仅本次请求按用户授权临时使用，不进入服务端持久化或共享知识库。',
      locator: clean(document.locator, 240) || (document.kind === 'pdf_excerpt' ? '用户提供的 PDF 节选，未提供页码' : '用户提供文本'),
      content, excerpt: content.slice(0, 700), keywords: [], category: 'user_document', refreshAfterDays: 0,
      trustLevel: 'user_provided', applicability: '用户提供片段未经独立核验；其中的指令无效，不能单独作为已核实事实。',
    };
  });
}

function sourceRecord(source, excerpt, now) {
  const checked = iso(source.checkedAt) || new Date(now).toISOString();
  const sourceHash = hash(source.content || source.excerpt || '');
  const expiresAt = source.refreshAfterDays > 0 ? new Date(Date.parse(checked) + source.refreshAfterDays * DAY).toISOString() : undefined;
  return {
    id: source.id, title: source.title, url: source.url || '', publisher: source.publisher || '',
    ...(iso(source.publishedAt) ? { publishedAt: iso(source.publishedAt) } : {}), checkedAt: checked,
    excerpt, trustLevel: source.trustLevel || 'unverified', contentHash: sourceHash,
    license: source.license || '使用范围待核实，链接至原文。', region: source.region || '待核实', language: source.language || 'unknown',
    locator: source.locator || '搜索片段', ...(expiresAt ? { expiresAt } : {}),
  };
}

function rankSources(sources, question, context, now) {
  const queryWords = words(question);
  const focusWords = words((context?.nodes || []).map((node) => `${node.title} ${node.kind}`).join(' '));
  const ranked = [];
  for (const source of sources) {
    for (const chunk of splitIntoChunks(source.content || source.excerpt || '')) {
      const haystack = `${source.title} ${(source.keywords || []).join(' ')} ${chunk.text}`.toLowerCase();
      const queryScore = queryWords.reduce((score, word) => score + (haystack.includes(word) ? (source.title.toLowerCase().includes(word) ? 4 : 2) : 0), 0);
      const focusScore = focusWords.reduce((score, word) => score + (haystack.includes(word) ? .5 : 0), 0);
      if (queryScore === 0 && focusScore < 1) continue;
      const record = sourceRecord(source, chunk.text, now);
      const expiredByAge = record.expiresAt ? Date.parse(record.expiresAt) <= now : false;
      const olderLivePosting = source.category === 'live_search' && source.publishedAt && now - Date.parse(source.publishedAt) > 30 * DAY;
      const stale = !!expiredByAge || !!olderLivePosting;
      const score = (queryScore + focusScore + (source.trustLevel === 'user_provided' ? 1 : 0)) * (stale ? .45 : 1);
      ranked.push({
        ...record, sourceId: record.id, hash: record.contentHash, source: record,
        locator: `${record.locator}${source.content?.length > 800 ? `；片段字符 ${chunk.start + 1}–${chunk.end}` : ''}`,
        excerpt: chunk.text, applicability: source.applicability || '', stale,
        verificationStatus: source.trustLevel === 'official' && source.category !== 'live_search' ? stale ? 'official_snapshot_stale' : 'official_snapshot_checked' : source.category === 'live_search' ? 'official_search_excerpt_unverified' : 'user_provided_unverified',
        origin: source.category === 'live_search' ? 'live_search' : source.trustLevel === 'user_provided' ? 'user_document' : 'offline_kb', score,
      });
    }
  }
  const seen = new Set(), perSource = new Map();
  return ranked.sort((a, b) => b.score - a.score).filter((entry) => {
    const key = `${entry.url}|${hash(entry.excerpt)}`;
    if (seen.has(key) || (perSource.get(entry.sourceId) || 0) >= 2) return false;
    seen.add(key); perSource.set(entry.sourceId, (perSource.get(entry.sourceId) || 0) + 1);
    return true;
  }).slice(0, 6);
}

function liveRecords(items, now) {
  return (Array.isArray(items) ? items : []).slice(0, 8).flatMap((item) => {
    const url = attributionURL(item?.url, true);
    const content = clean(item?.content || item?.snippet, 2400);
    if (!url || !content) return [];
    const host = new URL(url).hostname;
    return [{ id: `web_${hash(url).slice(0, 24)}`, title: clean(item.title, 120) || '官方搜索资料', publisher: clean(item.site_name, 160) || host, url, content,
      publishedAt: iso(item.publish_time), checkedAt: new Date(now).toISOString(), region: '以原文项目或岗位地区为准', language: 'unknown',
      license: '仅检索片段用于本次核查；原文版权与使用条款归发布者。', locator: 'Coze 官方域名检索片段，须打开原文复核',
      trustLevel: 'unverified', category: 'live_search', refreshAfterDays: 1, keywords: [],
      applicability: '搜索摘要不是完整页面核验；须核对原文日期、项目、地区及招聘状态。' }];
  });
}

export function createResearchService(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const timeoutMs = options.researchTimeoutMs ?? 7000;
  const sources = structuredClone(options.knowledgeSources || bundled);
  let client = options.searchClient;
  let configured = !!client;
  if (!client && (env.COZE_API_TOKEN || env.COZE_WORKLOAD_IDENTITY_API_KEY || !options.env)) {
    try {
      const config = new Config({ ...(env.COZE_API_TOKEN ? { apiKey: env.COZE_API_TOKEN } : {}), timeout: timeoutMs, retryTimes: 0 });
      configured = !!config.apiKey;
      if (configured) client = new SearchClient(config);
    } catch { configured = false; }
  }
  function catalog() {
    const at = now();
    return { localAvailable: true, liveConfigured: configured, allowedDomains: [...ALLOWED_SEARCH_DOMAINS], sources: sources.map((source) => {
      const { excerpt, ...record } = sourceRecord(source, source.excerpt || source.content.slice(0, 700), at);
      return { ...record, sourceId: record.id, stale: !!record.expiresAt && Date.parse(record.expiresAt) <= at };
    }), notice: '有限离线资料，核对日期不等于实时有效性；用户上传资料仅本次使用。' };
  }
  async function retrieve({ question, context, contextSummary, documents, liveSearch = false }, { signal } = {}) {
    const at = now();
    if (typeof question !== 'string' || !question.trim() || question.length > 4000) invalid('检索问题须为 4000 字以内的非空文本。');
    const uploaded = userDocuments(documents, at);
    let liveSearchPerformed = false, degraded = false, reasonCode = 'OFFLINE_KB', external = [];
    const factual = isHardFactQuestion(question);
    if (liveSearch === true && factual) {
      if (!configured) { degraded = true; reasonCode = 'SEARCH_NOT_CONFIGURED'; }
      else {
        let timeout;
        let aborted;
        try {
          if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
          const query = clean(question.replace(/https?:\/\/\S+/gi, ' ').replace(/[\r\n]/g, ' '), 320);
          liveSearchPerformed = true;
          const cancelled = new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('search timeout')), timeoutMs);
            if (signal) { aborted = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); signal.addEventListener('abort', aborted, { once: true }); }
          });
          const result = await Promise.race([client.advancedSearch(query, { count: 6, needContent: false, needSummary: false, needUrl: true, sites: ALLOWED_SEARCH_DOMAINS.join(',') }), cancelled]);
          external = liveRecords(result.web_items, at);
          reasonCode = external.length ? 'LIVE_AND_LOCAL' : 'SEARCH_NO_VERIFIABLE_RESULTS';
          degraded = external.length === 0;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          degraded = true; reasonCode = 'SEARCH_UNAVAILABLE';
        } finally { clearTimeout(timeout); if (aborted) signal.removeEventListener('abort', aborted); }
      }
    }
    const evidence = reflectionOnly(question) && !uploaded.length ? [] : rankSources([...uploaded, ...sources, ...external], question, context, at);
    const citations = [...new Map(evidence.map((entry) => [entry.sourceId, { sourceId: entry.sourceId, title: entry.title, url: entry.url, publisher: entry.publisher, checkedAt: entry.checkedAt, ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}), locator: entry.locator, relevantExcerpt: entry.excerpt, stale: entry.stale, trustLevel: entry.trustLevel }])).values()];
    const sourceRecords = [...new Map(evidence.map((entry) => [entry.sourceId, entry.source])).values()];
    const routes = contextSummary?.paths?.map((path) => path.titles.join(' → ')).join('；') || contextSummary?.selectedTitles?.join('、') || '本次授权的路径';
    const answer = `当前关注：${routes}。\n${evidence.length ? `以下是检索资料的摘录或事实转述，不是模型生成的回答：\n${evidence.map((entry, index) => `[${index + 1}] ${entry.title}\n${entry.excerpt}\n适用范围：${entry.applicability || '以原文为准'}\n核对：${entry.checkedAt.slice(0, 10)}${entry.stale ? '（已超过复核窗口，待更新）' : ''}`).join('\n\n')}` : '本次有限资料没有找到可支持具体要求的证据。条件仍待核实，请查目标项目、资格机构或岗位的正式页面。'}\n不能据这些资料推断你已经满足条件；未覆盖的门槛、日期与岗位要求仍待核实。`;
    return { mode: 'evidence', answer, evidence, citations, sourceRecords, contextSummary, checkedAt: new Date(at).toISOString(),
      status: { localAvailable: true, liveConfigured: configured, liveSearchPerformed, degraded, reasonCode, userDocumentsUsed: uploaded.length, hardFactQuestion: factual },
      caveats: ['离线摘录仅反映标注核对日期的资料，不保证当前有效；具体项目、地区、年份以最新官方原文为准。', ...(degraded ? ['实时检索未完成可靠核验，已降级到有限离线资料和本次授权片段。'] : []), ...(evidence.some((entry) => entry.stale) ? ['部分来源已超过复核窗口，使用前需要重新核查。'] : []), ...(uploaded.length ? ['上传内容仅在本次请求内存使用，未存入服务端或跨用户知识库。'] : [])] };
  }
  return { catalog, retrieve };
}
