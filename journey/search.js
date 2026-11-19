import { isIP } from 'node:net';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const failure = (code, message) => Object.assign(new Error(message), { code });
const characters = value => Array.from(String(value));
const shorten = (value, limit) => characters(value).slice(0, limit).join('');

export function searchConfigured(env = process.env) {
  return env.DEEPSEEK_SEARCH_ENABLED !== 'false' &&
    !!searchKey(env);
}

function searchKey(env) {
  return [env.DEEPSEEK_SEARCH_API_KEY, env.JOURNEY_AI_API_KEY, env.DEEPSEEK_API_KEY, env.LLM_API_KEY].find(value => value?.trim())?.trim();
}

// The provider accepts at most 128 Unicode characters, including search operators.
// Keep a useful role query and append as many requested domains as will fit.
export function buildSearchQueries(query, sites = '') {
  const domains = [...new Set(sites.split(',').map(x => x.trim()).filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x)))];
  const base = shorten(String(query).trim(), domains.length ? 64 : 128);
  if (!base) throw failure('SEARCH_INVALID_QUERY', '搜索词不能为空');
  if (!domains.length) return [base];
  const queries = []; let group = [];
  for (const domain of domains) {
    const clause = `site:${domain}`;
    if (characters(`${base} ${clause}`).length > 128) throw failure('SEARCH_INVALID_QUERY', '搜索域名过长');
    if (characters(`${base} ${[...group, clause].join(' OR ')}`).length > 128) {
      queries.push(`${base} ${group.join(' OR ')}`); group = [];
    }
    group.push(clause);
  }
  if (group.length) queries.push(`${base} ${group.join(' OR ')}`);
  return queries;
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export class DeepSeekSearchClient {
  constructor({
    env = process.env,
    apiKey = searchKey(env),
    baseUrl = env.DEEPSEEK_TOOLS_BASE_URL || DEFAULT_BASE_URL,
    timeout = 9000,
    fetchTimeout = 20000,
    enabled = env.DEEPSEEK_SEARCH_ENABLED !== 'false',
    fetch: fetcher = globalThis.fetch,
  } = {}) {
    if (!enabled || !apiKey?.trim()) throw failure('SEARCH_NOT_CONFIGURED', 'DeepSeek搜索尚未配置');
    this.fetch = fetcher;
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = timeout;
    this.fetchTimeout = fetchTimeout;
  }

  async request(path, body, timeout = this.timeout) {
    try {
      const response = await this.fetch(`${this.baseUrl}/v1/tools/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const code = { 401: 'SEARCH_AUTH_FAILED', 402: 'SEARCH_BALANCE_REQUIRED', 429: 'SEARCH_RATE_LIMITED', 404: 'SEARCH_CONTENT_UNAVAILABLE' }[response.status] || 'SEARCH_UNAVAILABLE';
        throw failure(code, 'DeepSeek搜索或正文读取暂不可用');
      }
      return await response.json();
    } catch (error) {
      if (typeof error.code === 'string' && error.code.startsWith('SEARCH_')) throw error;
      throw failure('SEARCH_UNAVAILABLE', 'DeepSeek搜索连接超时或返回无效数据');
    }
  }

  async advancedSearch(query, options = {}) {
    const count = Math.max(1, Math.min(50, Number.parseInt(options.count, 10) || 10));
    const queries = buildSearchQueries(query, options.sites);
    const results = await Promise.allSettled(queries.map(query => this.request('search', {
      query, count, need_content: options.needContent === true,
    }).then(data => {
      if (!Array.isArray(data.results)) throw failure('SEARCH_INVALID_OUTPUT', 'DeepSeek搜索返回格式无效');
      return data.results;
    })));
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    const data = { results: results.flatMap(result => result.status === 'fulfilled' ? result.value : []) };
    const domains = (options.sites || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const seen = new Set();

    return {
      web_items: data.results.filter(item => item && typeof item === 'object').map(item => ({
        title: typeof item.title === 'string' ? item.title : '',
        url: safeWebUrl(item.url),
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
        summary: typeof item.summary === 'string' ? item.summary : '',
        content: typeof item.content === 'string' ? item.content : '',
        site_name: typeof item.site_name === 'string' ? item.site_name : '',
        publish_time: typeof item.date === 'string' ? item.date : '',
        auth_info_level: Number.isInteger(item.authority) ? item.authority : -1,
      })).filter(item => {
        if (!item.url || seen.has(item.url)) return false;
        const host = new URL(item.url).hostname.toLowerCase();
        if (domains.length && !domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return false;
        seen.add(item.url); return true;
      }).slice(0, count),
    };
  }

  async webSearch(query, count = 10) {
    return this.advancedSearch(query, { count });
  }

  async fetchPage(url) {
    const safe = safeWebUrl(url);
    const host = safe ? new URL(safe).hostname.replace(/^\[|\]$/g, '') : '';
    if (!safe || !host.includes('.') || isIP(host) || /(^|\.)(localhost|local|internal)$/.test(host)) throw failure('SEARCH_INVALID_URL', '只支持不含账号密码的HTTP或HTTPS网页');
    const data = await this.request('fetch', { url }, this.fetchTimeout);
    if (typeof data.content !== 'string' || !data.content.trim()) throw failure('SEARCH_CONTENT_UNAVAILABLE', '该页面暂无可读取正文，请打开原始页面复制JD');
    return { content: data.content, title: typeof data.title === 'string' ? data.title : '' };
  }
}
