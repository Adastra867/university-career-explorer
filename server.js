import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { SearchClient, Config } from 'coze-coding-dev-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || process.env.DEPLOY_RUN_PORT || 5000;
const JOB_RECOMMENDATION_CACHE_TTL = 10 * 60 * 1000;
const JOB_RECOMMENDATION_RATE_LIMIT = 8 * 1000;
const JOB_SEARCH_TIMEOUT_MS = 9 * 1000;
const jobRecommendationCache = new Map();
const jobRecommendationRequestTimes = new Map();

app.use(express.json());
app.use(express.static(__dirname));

const JOB_PLATFORM_SITES = 'zhipin.com,zhaopin.com,51job.com,liepin.com,lagou.com,intern.supply';

const INDUSTRY_LEADERS = [
  {
    match: /互联网|软件|人工智能|数据|电子|智能硬件|游戏|科技/,
    companies: ['华为', '字节跳动', '腾讯', '阿里巴巴', '京东'],
    domains: ['career.huawei.com', 'jobs.bytedance.com', 'careers.tencent.com', 'jobs.tencent.com', 'join.qq.com', 'talent.alibaba.com', 'alibabagroup.com', 'careers.aliyun.com', 'campus.jd.com'],
  },
  {
    match: /制造|新能源|汽车|能源|装备|供应链|工业/,
    companies: ['华为', '比亚迪', '宁德时代', '美的'],
    domains: ['career.huawei.com', 'job.byd.com', 'talent.catl.com', 'career.catl.com', 'careers.midea.com', 'recruit.midea.com'],
  },
  {
    match: /金融|银行|证券|财务|保险|审计/,
    companies: ['招商银行', '中国工商银行', '中国平安', '中信证券'],
    domains: ['career.cmbchina.com', 'job.icbc.com.cn', 'campus.pingan.com', 'careers.citics.com'],
  },
  {
    match: /消费|零售|品牌|广告|电商|食品/,
    companies: ['宝洁', '联合利华', '京东', '美的'],
    domains: ['pgcareers.com', 'careers.unilever.com', 'campus.jd.com', 'careers.midea.com'],
  },
  {
    match: /医药|医疗|生物|健康|器械/,
    companies: ['迈瑞医疗', '恒瑞医药', '药明康德'],
    domains: ['career.mindray.com', 'hr.hrs.com.cn', 'careers.wuxiapptec.com'],
  },
  {
    match: /建筑|基础设施|地产|工程|园区/,
    companies: ['中国建筑', '中国中铁', '万科'],
    domains: ['job.cscec.com', 'hr.crcc.cn', 'vanke.com', 'career.vanke.com'],
  },
];

const DEFAULT_LEADERS = {
  companies: ['华为', '字节跳动', '腾讯', '京东'],
  domains: ['career.huawei.com', 'jobs.bytedance.com', 'careers.tencent.com', 'jobs.tencent.com', 'join.qq.com', 'campus.jd.com'],
};

const DOMAIN_COMPANIES = {
  'career.huawei.com': '华为',
  'jobs.bytedance.com': '字节跳动',
  'careers.tencent.com': '腾讯',
  'jobs.tencent.com': '腾讯',
  'join.qq.com': '腾讯',
  'alibabagroup.com': '阿里巴巴',
  'talent.alibaba.com': '阿里巴巴',
  'careers.aliyun.com': '阿里云',
  'campus.jd.com': '京东',
  'job.byd.com': '比亚迪',
  'career.catl.com': '宁德时代',
  'talent.catl.com': '宁德时代',
  'careers.midea.com': '美的',
  'recruit.midea.com': '美的',
  'career.cmbchina.com': '招商银行',
  'job.icbc.com.cn': '中国工商银行',
  'campus.pingan.com': '中国平安',
  'careers.citics.com': '中信证券',
  'pgcareers.com': '宝洁',
  'careers.unilever.com': '联合利华',
  'career.mindray.com': '迈瑞医疗',
  'hr.hrs.com.cn': '恒瑞医药',
  'careers.wuxiapptec.com': '药明康德',
  'job.cscec.com': '中国建筑',
  'hr.crcc.cn': '中国中铁',
  'career.vanke.com': '万科',
  'vanke.com': '万科',
};

// Job search API - searches for job postings from the web
app.post('/api/search-jobs', async (req, res) => {
  try {
    const { query, location, count } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Please provide a search query' });
    }

    const client = createSearchClient();

    // Build search query targeting job postings
    let searchQuery = `${query} 招聘 职位描述 JD`;
    if (location) searchQuery += ` ${location}`;

    const response = await withTimeout(client.advancedSearch(searchQuery, {
      count: count || 10,
      needSummary: false,
      needContent: false,
      sites: 'zhipin.com,lagou.com,liepin.com,51job.com,zhaopin.com,intern.supply',
    }), JOB_SEARCH_TIMEOUT_MS);

    // If site-specific search returns few results, do a broader search
    let items = response.web_items || [];
    if (items.length < 3) {
      const broadResponse = await withTimeout(client.webSearch(searchQuery, count || 10, false), JOB_SEARCH_TIMEOUT_MS);
      items = broadResponse.web_items || [];
    }

    // Filter and enrich results
    const jobs = items.map((item, idx) => ({
      id: idx + 1,
      title: extractJobTitle(item.title, query),
      company: extractCompany(item.title),
      source: item.site_name || 'Unknown',
      url: item.url || '',
      snippet: item.snippet || '',
      publishTime: item.publish_time || '',
      authLevel: item.auth_info_level || 0,
    }));

    res.json({ success: true, jobs, total: jobs.length });
  } catch (error) {
    console.error('Search error:', error);
    res.status(503).json({ success: false, code: isSearchConfigurationError(error) ? 'SEARCH_NOT_CONFIGURED' : 'SEARCH_UNAVAILABLE', error: '联网岗位搜索暂不可用，请稍后重试。' });
  }
});

// Personalized campus-job recommendations from job platforms and official career sites.
app.post('/api/recommend-jobs', async (req, res) => {
  try {
    const rawDirections = Array.isArray(req.body?.directions) ? req.body.directions : [];
    const location = safeText(req.body?.location, 30);
    const requestedCount = Number.parseInt(req.body?.count, 10);
    const resultCount = Number.isFinite(requestedCount) ? Math.min(16, Math.max(6, requestedCount)) : 12;
    const directions = rawDirections.slice(0, 3).map((item, index) => ({
      id: safeText(item?.id, 80) || `direction_${index}`,
      industry: safeText(item?.industry, 80),
      direction: safeText(item?.direction, 80),
      jobs: Array.isArray(item?.jobs) ? item.jobs.map((job) => safeText(job, 60)).filter(Boolean).slice(0, 3) : [],
      skills: Array.isArray(item?.skills) ? item.skills.map((skill) => safeText(skill, 50)).filter(Boolean).slice(0, 8) : [],
      rank: index + 1,
    })).filter((item) => item.direction || item.jobs.length > 0);

    if (directions.length === 0) {
      return res.status(400).json({ error: '请先完成就业方向排序，再搜索推荐岗位。' });
    }

    const currentYear = new Date().getFullYear();
    const targetGraduationYear = currentYear + 1;
    const cacheKey = createHash('sha256').update(JSON.stringify({ directions, location, resultCount, targetGraduationYear })).digest('hex');
    pruneRecommendationState();
    const cached = jobRecommendationCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < JOB_RECOMMENDATION_CACHE_TTL) {
      return res.json({ ...cached.payload, cached: true });
    }

    let client;
    try {
      client = createSearchClient();
    } catch (error) {
      if (!isSearchConfigurationError(error)) throw error;
      const payload = buildGuidedSearchPayload({
        directions,
        location,
        reasonCode: 'SEARCH_NOT_CONFIGURED',
        warning: '当前未连接实时招聘数据源，已根据你的意向生成校招搜索方案。以下是岗位类型和检索入口，不是正在招聘的职位。',
      });
      return res.json(payload);
    }

    const requester = req.ip || req.socket?.remoteAddress || 'unknown';
    const lastRequestAt = jobRecommendationRequestTimes.get(requester) || 0;
    if (Date.now() - lastRequestAt < JOB_RECOMMENDATION_RATE_LIMIT) {
      const retryAfter = Math.ceil((JOB_RECOMMENDATION_RATE_LIMIT - (Date.now() - lastRequestAt)) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `搜索请求过于频繁，请在 ${retryAfter} 秒后重试。` });
    }
    jobRecommendationRequestTimes.set(requester, Date.now());

    const searchSpecs = [];

    directions.slice(0, 3).forEach((direction) => {
      const role = direction.jobs[0] || direction.direction;
      const leaderGroup = getLeaderGroup(direction.industry + ' ' + direction.direction);
      const locationHint = location ? ` ${location}` : '';
      searchSpecs.push({
        scope: 'platform',
        query: `${role} ${targetGraduationYear}届 校园招聘 应届生 岗位职责${locationHint}`.trim(),
        sites: JOB_PLATFORM_SITES,
        direction,
        domains: JOB_PLATFORM_SITES.split(','),
        companies: [],
        location,
        targetGraduationYear,
      });
      searchSpecs.push({
        scope: 'official',
        query: `${role} ${targetGraduationYear}届 校园招聘 应届生 职位描述${locationHint}`.trim(),
        sites: leaderGroup.domains.join(','),
        direction,
        domains: leaderGroup.domains,
        companies: leaderGroup.companies,
        location,
        targetGraduationYear,
      });
    });

    const settled = await Promise.allSettled(searchSpecs.map(async (spec) => {
      const response = await withTimeout(client.advancedSearch(spec.query, {
        count: Math.max(4, Math.ceil(resultCount / searchSpecs.length) + 1),
        needContent: true,
        needUrl: true,
        needSummary: false,
        sites: spec.sites,
      }), JOB_SEARCH_TIMEOUT_MS);
      return (response.web_items || []).map((item) => normalizeRecommendedJob(item, spec));
    }));

    let jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const failedSearches = settled.filter((result) => result.status === 'rejected').length;
    const failedSources = settled.map((result, index) => result.status === 'rejected' ? {
      source: searchSpecs[index].scope,
      direction: searchSpecs[index].direction.direction,
    } : null).filter(Boolean);

    let broadSearchFailed = false;
    // Keep the experience usable when one source family temporarily returns no data.
    if (jobs.length < 3) {
      const first = directions[0];
      const role = first.jobs[0] || first.direction;
      const broadQuery = `${role} ${targetGraduationYear}届 校园招聘 应届生 招聘 ${location || ''}`.trim();
      try {
        const broad = await withTimeout(client.advancedSearch(broadQuery, {
          count: resultCount,
          needContent: true,
          needUrl: true,
          needSummary: false,
        }), JOB_SEARCH_TIMEOUT_MS);
        jobs = jobs.concat((broad.web_items || []).map((item) => normalizeRecommendedJob(item, {
          scope: 'web',
          query: broadQuery,
          direction: first,
          domains: [],
          companies: [],
          location,
          targetGraduationYear,
        })));
      } catch (error) {
        broadSearchFailed = true;
        console.warn('Broad job search fallback failed:', error.message);
      }
    }

    if (jobs.length === 0) {
      const unavailable = failedSearches === searchSpecs.length && broadSearchFailed;
      const payload = buildGuidedSearchPayload({
        directions,
        location,
        reasonCode: unavailable ? 'SEARCH_UPSTREAM_UNAVAILABLE' : 'SEARCH_NO_RESULTS',
        warning: unavailable ? '实时招聘数据源暂时不可用，已先生成个性化校招搜索方案。以下内容不是正在招聘的职位。' : '本次实时检索暂未找到可核验岗位，已生成更宽泛的校招搜索方案。以下内容不是正在招聘的职位。',
        failedSearches,
        failedSources,
      });
      jobRecommendationCache.set(cacheKey, { createdAt: Date.now(), payload });
      return res.json(payload);
    }

    const seen = new Set();
    jobs = jobs.filter((job) => {
      const key = job.url || `${job.title}|${job.company}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    jobs = diversifyRecommendedJobs(jobs, resultCount).map((job) => ({ ...job, id: stableJobId(job) }));

    const payload = {
      success: true,
      jobs,
      total: jobs.length,
      searchedDirections: directions,
      targetGraduationYear,
      sourceStatus: {
        platform: jobs.some((job) => job.sourceType === '招聘平台'),
        official: jobs.some((job) => job.sourceType === '企业校招官网'),
        failedSearches,
        failedSources,
      },
      generatedAt: new Date().toISOString(),
    };
    jobRecommendationCache.set(cacheKey, { createdAt: Date.now(), payload });
    res.json(payload);
  } catch (error) {
    console.error('Recommendation search error:', error);
    res.status(503).json({ success: false, code: isSearchConfigurationError(error) ? 'SEARCH_NOT_CONFIGURED' : 'SEARCH_UNAVAILABLE', error: '岗位搜索服务暂不可用，请稍后重试。' });
  }
});

// Fetch full job description from URL
app.post('/api/fetch-jd', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Please provide a URL' });
    }

    const client = createSearchClient();

    const response = await withTimeout(client.advancedSearch(url, {
      count: 1,
      needContent: true,
      needSummary: false,
    }), JOB_SEARCH_TIMEOUT_MS);

    const items = response.web_items || [];
    if (items.length > 0 && items[0].content) {
      res.json({ success: true, content: items[0].content, title: items[0].title });
    } else {
      res.json({ success: true, content: items[0]?.snippet || '', title: items[0]?.title || '' });
    }
  } catch (error) {
    console.error('Fetch JD error:', error);
    res.status(503).json({ success: false, code: isSearchConfigurationError(error) ? 'SEARCH_NOT_CONFIGURED' : 'SEARCH_UNAVAILABLE', error: '暂时无法读取岗位详情，请打开原始页面复制 JD。' });
  }
});

// Extract job title from search result title
function extractJobTitle(title, query) {
  if (!title) return query;
  // Remove common suffixes
  let cleaned = title.replace(/[-_|].*$/, '').trim();
  // If too long, truncate
  if (cleaned.length > 30) cleaned = cleaned.substring(0, 30);
  return cleaned || query;
}

// Extract company name from title
function extractCompany(title) {
  if (!title) return '';
  const patterns = [
    /\[(.*?)\]/,
    /【(.*?)】/,
    /\((.*?)\)/,
    /(.*?)招聘/,
    /(.*?)公司/,
  ];
  for (const p of patterns) {
    const m = title.match(p);
    if (m && m[1] && m[1].length < 20) return m[1];
  }
  return '';
}

function safeText(value, maxLength = 200) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function safeContent(value, maxLength = 4000) {
  return typeof value === 'string' ? value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength) : '';
}

function createSearchClient() {
  const config = new Config({ timeout: JOB_SEARCH_TIMEOUT_MS, retryTimes: 0 });
  return new SearchClient(config);
}

function isSearchConfigurationError(error) {
  return /API key is required|COZE_API_TOKEN|apiKey/i.test(String(error?.message || ''));
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('岗位搜索请求超时')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function buildGuidedSearchPayload({ directions, location, reasonCode, warning, failedSearches = 0, failedSources = [] }) {
  const preparedAt = new Date().toISOString();
  const guides = directions.map((direction) => {
    const roles = direction.jobs.length ? direction.jobs.slice(0, 3) : [direction.direction];
    const querySuffix = location ? ` ${location}` : '';
    const queries = roles.map((role) => `${role} 校园招聘 应届生${querySuffix}`.trim());
    const leaderGroup = getLeaderGroup(`${direction.industry} ${direction.direction}`);
    const seenCompanies = new Set();
    const officialSites = leaderGroup.domains.map((domain, index) => {
      const company = getOfficialCompany(domain) || leaderGroup.companies[index] || '';
      return { company, label: company ? `${company}招聘官网` : '代表企业招聘官网', url: `https://${domain}` };
    }).filter((site) => {
      const key = site.company || site.url;
      if (seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    }).slice(0, 3);
    return {
      id: `guide_${createHash('sha256').update(`${direction.id}|${location}`).digest('hex').slice(0, 12)}`,
      directionId: direction.id,
      directionRank: direction.rank,
      industry: direction.industry,
      direction: direction.direction,
      roles,
      capabilityKeywords: direction.skills || [],
      queries,
      links: [{ type: 'platform_home', label: '打开 BOSS 校园招聘', url: 'https://www.zhipin.com/school/' }],
      officialSites,
      verifyChecklist: ['招聘状态与发布时间', '毕业届次和学历门槛', '专业限制', '完整 JD 与工作地点'],
    };
  });
  return {
    success: true,
    mode: 'guided',
    liveSearchPerformed: false,
    jobs: [],
    guides,
    total: 0,
    searchedDirections: directions,
    targetGraduationYear: null,
    warning,
    reasonCode,
    sourceStatus: {
      liveSearchAvailable: false,
      platform: false,
      official: false,
      guided: true,
      failedSearches,
      failedSources,
    },
    preparedAt,
  };
}

function getLeaderGroup(text) {
  return INDUSTRY_LEADERS.find((group) => group.match.test(text || '')) || DEFAULT_LEADERS;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getPlatformName(hostname, fallback) {
  const platforms = {
    'zhipin.com': 'BOSS直聘',
    'zhaopin.com': '智联招聘',
    '51job.com': '前程无忧',
    'liepin.com': '猎聘',
    'lagou.com': '拉勾',
    'intern.supply': '实习信息平台',
  };
  const matched = Object.keys(platforms).find((domain) => hostMatches(hostname, domain));
  return matched ? platforms[matched] : safeText(fallback, 30) || hostname || '招聘信息来源';
}

function getOfficialCompany(hostname) {
  const matched = Object.keys(DOMAIN_COMPANIES).find((domain) => hostMatches(hostname, domain));
  return matched ? DOMAIN_COMPANIES[matched] : '';
}

function cleanJobTitle(title, fallback) {
  const cleaned = safeText(title, 120)
    .replace(/\s*[-_|｜]\s*(BOSS直聘|智联招聘|前程无忧|猎聘|拉勾).*$/i, '')
    .trim();
  return cleaned || fallback || '校招岗位';
}

function getFreshnessStatus(item, targetGraduationYear) {
  const currentYear = new Date().getFullYear();
  const text = `${item?.title || ''} ${item?.snippet || ''} ${item?.summary || ''} ${item?.content || ''}`;
  const graduationYears = [...text.matchAll(/(20\d{2})\s*届/g)].map((match) => Number(match[1]));
  if (graduationYears.includes(targetGraduationYear) || graduationYears.includes(currentYear)) return 'current';
  if (graduationYears.length > 0 && Math.max(...graduationYears) < currentYear) return 'possibly_stale';
  const publishYear = Number((safeText(item?.publish_time, 40).match(/20\d{2}/) || [])[0]);
  if (publishYear && publishYear < currentYear - 1) return 'possibly_stale';
  if (publishYear && publishYear >= currentYear - 1) return 'current';
  return 'unknown';
}

function stableJobId(job) {
  const identity = job.url || `${job.company}|${job.title}|${job.matchedDirectionId}`;
  return `recommended_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

function pruneRecommendationState() {
  const now = Date.now();
  for (const [key, entry] of jobRecommendationCache) {
    if (now - entry.createdAt >= JOB_RECOMMENDATION_CACHE_TTL) jobRecommendationCache.delete(key);
  }
  for (const [key, timestamp] of jobRecommendationRequestTimes) {
    if (now - timestamp >= JOB_RECOMMENDATION_CACHE_TTL) jobRecommendationRequestTimes.delete(key);
  }
  while (jobRecommendationCache.size > 100) jobRecommendationCache.delete(jobRecommendationCache.keys().next().value);
}

function normalizeRecommendedJob(item, spec) {
  const url = safeText(item?.url, 1000);
  const hostname = getHostname(url);
  const isPlatform = JOB_PLATFORM_SITES.split(',').some((domain) => hostMatches(hostname, domain));
  const officialCompany = getOfficialCompany(hostname);
  const isOfficial = Boolean(officialCompany) || (spec.scope === 'official' && spec.domains.some((domain) => hostMatches(hostname, domain)));
  const sourceType = isPlatform ? '招聘平台' : isOfficial ? '企业校招官网' : spec.scope === 'official' ? '企业校招线索' : '招聘信息来源';
  const description = safeContent(item?.content || item?.summary || item?.snippet, 4000);
  const snippet = safeText(item?.snippet || item?.summary || item?.content, 600);
  const fallbackRole = spec.direction.jobs[0] || spec.direction.direction;
  return {
    id: safeText(item?.id, 100),
    title: cleanJobTitle(item?.title, fallbackRole),
    company: officialCompany || extractCompany(item?.title || ''),
    source: isPlatform ? getPlatformName(hostname, item?.site_name) : officialCompany ? `${officialCompany}招聘官网` : safeText(item?.site_name, 40) || hostname || '网页搜索',
    sourceType,
    official: isOfficial,
    url,
    location: safeText(item?.location || item?.city, 60),
    locationFilter: safeText(spec.location, 30),
    salary: safeText(item?.salary, 60),
    snippet,
    description,
    descriptionType: item?.content ? '网页正文' : item?.summary ? '搜索摘要' : '搜索片段',
    publishTime: safeText(item?.publish_time, 40),
    freshnessStatus: getFreshnessStatus(item, spec.targetGraduationYear || new Date().getFullYear() + 1),
    matchedDirectionId: spec.direction.id,
    matchedDirection: spec.direction.direction,
    directionRank: spec.direction.rank,
    searchedRole: fallbackRole,
  };
}

function diversifyRecommendedJobs(jobs, limit) {
  const sourceOrder = { '企业校招官网': 0, '招聘平台': 1, '企业校招线索': 2, '招聘信息来源': 3 };
  const buckets = new Map();
  jobs.forEach((job) => {
    const key = `${job.directionRank || 9}|${job.sourceType || '招聘信息来源'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  });
  buckets.forEach((bucket) => bucket.sort((a, b) => {
    const freshnessOrder = { current: 0, unknown: 1, possibly_stale: 2 };
    return (freshnessOrder[a.freshnessStatus] ?? 1) - (freshnessOrder[b.freshnessStatus] ?? 1);
  }));
  const keys = [...buckets.keys()].sort((a, b) => {
    const [rankA, sourceA] = a.split('|');
    const [rankB, sourceB] = b.split('|');
    return Number(rankA) - Number(rankB) || (sourceOrder[sourceA] ?? 9) - (sourceOrder[sourceB] ?? 9);
  });
  const result = [];
  while (result.length < limit && keys.some((key) => buckets.get(key).length > 0)) {
    keys.forEach((key) => {
      if (result.length < limit && buckets.get(key).length > 0) result.push(buckets.get(key).shift());
    });
  }
  return result;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
