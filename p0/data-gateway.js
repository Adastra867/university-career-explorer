import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const privateProfilePath = '/_internal/career-profile';
const keyHeader = 'x-career-data-gateway-key';
const ipHeader = 'x-career-data-client-ip';
const id = '[a-zA-Z0-9_-]{1,120}';
const dataRoutes = [
  ['GET', '/career/status'],
  ['POST', '/guest-session'],
  ['GET', '/account-session'],
  ['POST', '/accounts/(?:register|login|logout)'],
  ['GET', `/campaigns/${id}/public`],
  ['GET,PATCH', '/me/profile'],
  ['POST', '/me/profile/(?:ai-consent|import)'],
  ['GET', '/me/submissions'],
  ['POST', `/me/submissions/${id}/withdraw`],
  ['DELETE', '/me/data'],
  ['GET,POST', '/intakes'],
  ['GET', `/intakes/${id}`],
  ['PATCH', `/intakes/${id}/draft`],
  ['POST', `/intakes/${id}/(?:turns|submission-preview)`],
  ['POST', '/submissions'],
  ['POST', '/admin/(?:login|logout)'],
  ['GET', '/admin/session'],
  ['GET,POST', '/admin/campaigns'],
  ['PATCH', `/admin/campaigns/${id}`],
  ['GET', `/admin/campaigns/${id}/qr\\.svg`],
  ['GET', `/admin/submissions(?:/${id})?`],
].map(([methods, path]) => ({ methods: methods.split(','), path: new RegExp(`^/api${path}$`) }));

const digest = value => createHash('sha256').update(value).digest();
const readMethod = method => method === 'GET' || method === 'HEAD';
const browserHeaders = ['content-type', 'origin', 'sec-fetch-site', 'x-csrf-token'];
const accountCookies = /^career_(?:guest|account)=[\w-]{0,256}$/;
const adminCookies = /^career_admin=[\w-]{0,256}$/;
const offlineProfile = Object.freeze({ authenticated: false, consent: false, profile: null, source: 'sqlite', status: 'storage_unavailable' });

export function isCareerDataRequest(req) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  return dataRoutes.some(route => route.methods.includes(method) && route.path.test(req.path));
}

function serviceOrigin(value, production) {
  let url;
  try { url = new URL(value); } catch { throw new Error('资料服务必须配置有效的 HTTPS 地址。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:' || !loopback)) throw new Error('资料服务必须使用 HTTPS。');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('资料服务地址只能包含协议、主机和端口。');
  return url.origin;
}

export function careerDataSettings(env = process.env) {
  const origin = env.CAREER_DATA_MODE === 'origin';
  if (env.CAREER_DATA_MODE && !origin) throw new Error('CAREER_DATA_MODE 必须为 origin 或留空。');
  const production = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const upstream = env.CAREER_DATA_UPSTREAM ? serviceOrigin(env.CAREER_DATA_UPSTREAM, production) : null;
  if (!origin && !upstream) return { origin, upstream };
  const key = env.CAREER_DATA_GATEWAY_KEY;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) throw new Error('资料网关需要有效的服务密钥。');
  if (origin && (upstream || env.RENDER === 'true' || !env.CAREER_DB_PATH || !env.CAREER_PUBLIC_URL)) {
    throw new Error('本机资料服务需要本地数据库和网站地址，并须单独启动。');
  }
  if (upstream && env.CAREER_DB_PATH) throw new Error('使用本机资料网关时请移除 Render 上的 CAREER_DB_PATH。');
  return { origin, upstream, key, ...(origin ? { publicOrigin: serviceOrigin(env.CAREER_PUBLIC_URL, production) } : {}) };
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
}

function unavailable(res) {
  noStore(res);
  res.status(503).json({ error: { code: 'STORAGE_UNREACHABLE', message: '资料服务暂不可达，请保留当前输入并稍后重试。' } });
}

export function mountCareerDataOrigin(app, settings, router) {
  const expected = digest(settings.key);
  app.set('trust proxy', 'loopback');
  app.get('/healthz', (_req, res) => { noStore(res); res.json({ ready: true }); });
  app.use((req, res, next) => {
    const internal = req.method === 'GET' && req.path === privateProfilePath;
    const received = req.get(keyHeader) || '';
    if ((!internal && !isCareerDataRequest(req)) || !timingSafeEqual(digest(received), expected)) {
      noStore(res);
      return res.sendStatus(404);
    }
    // A tunnel can supply its own forwarding chain. Use only the gateway's client IP.
    const client = req.get(ipHeader);
    if (client && isIP(client)) req.headers['x-forwarded-for'] = client;
    else delete req.headers['x-forwarded-for'];
    delete req.headers['x-forwarded-proto'];
    delete req.headers['x-forwarded-host'];
    next();
  });
  app.get(privateProfilePath, async (req, res) => {
    noStore(res);
    try {
      const profile = await router.locals.resolveProfile(req);
      res.json({ ...profile, profile: profile.consent === true ? profile.profile : null });
    } catch { unavailable(res); }
  });
  app.use('/api', router);
  app.use((_req, res) => { noStore(res); res.sendStatus(404); });
}

function cookieHeader(req, admin = false) {
  const name = admin ? adminCookies : accountCookies;
  return (req.get('cookie') || '').split(';').map(cookie => cookie.trim()).filter(cookie => name.test(cookie) && !cookie.endsWith('=')).join('; ');
}

export function createCareerDataGateway(settings, fetcher = fetch) {
  const rawJson = express.raw({ type: 'application/json', limit: '256kb', inflate: false });

  function call(path, { cookie, method = 'GET', signal, headers, body, ip } = {}) {
    return fetcher(`${settings.upstream}${path}`, {
      method, redirect: 'error', signal, body,
      headers: { ...headers, [keyHeader]: settings.key, ...(cookie ? { cookie } : {}), ...(isIP(ip || '') ? { [ipHeader]: ip } : {}) },
    });
  }

  async function transfer(req, res) {
    const cancel = new AbortController();
    const abort = () => cancel.abort();
    res.once('close', abort);
    try {
      const query = req.originalUrl.indexOf('?');
      const suffix = query < 0 ? '' : req.originalUrl.slice(query);
      const headers = Object.fromEntries(browserHeaders.map(name => [name, req.get(name)]).filter(([, value]) => value));
      const admin = req.path.startsWith('/api/admin/');
      const response = await call(req.path + suffix, {
        cookie: cookieHeader(req, admin), ip: req.ip, method: req.method, headers,
        body: readMethod(req.method) ? undefined : req.body,
        // Intake turns call the model at the origin. Their existing timeout can be longer.
        signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(req.path.endsWith('/turns') ? 60000 : 8000)]),
      });
      const type = response.headers.get('content-type') || '';
      if (!/^(?:application\/json|image\/svg\+xml)(?:;|$)/.test(type)) {
        await response.body?.cancel();
        return unavailable(res);
      }
      res.status(response.status).set('Content-Type', type);
      for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(';', 1)[0];
        if ((admin ? adminCookies : accountCookies).test(first) && !/;\s*Domain=/i.test(cookie)) res.append('Set-Cookie', cookie);
      }
      if (!response.body) res.end();
      else await pipeline(Readable.fromWeb(response.body), res);
    } catch {
      if (!res.destroyed && !res.headersSent) unavailable(res);
    } finally { res.removeListener('close', abort); }
  }

  function middleware(req, res, next) {
    if (!isCareerDataRequest(req)) return next();
    noStore(res);
    if (readMethod(req.method)) return transfer(req, res);
    if (!req.is('application/json')) return res.status(415).json({ error: { code: 'JSON_REQUIRED', message: '请使用 JSON 提交。' } });
    rawJson(req, res, error => {
      if (!error) return transfer(req, res);
      if (error.status === 413) return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: '提交的资料超过大小限制。' } });
      res.status(error.status === 415 ? 415 : 400).json({ error: { code: 'INVALID_REQUEST', message: '资料请求格式无效。' } });
    });
  }

  async function resolveProfile(req) {
    const cookie = cookieHeader(req);
    if (!cookie || req.body?.profileUsage?.enabled === false) return { ...offlineProfile, status: 'not_connected' };
    try {
      const response = await call(privateProfilePath, { cookie, ip: req.ip, signal: AbortSignal.timeout(4000) });
      if (!response.ok) { await response.body?.cancel(); return offlineProfile; }
      const result = await response.json();
      if (!['connected', 'not_connected', 'session_expired'].includes(result.status)) return offlineProfile;
      const authenticated = result.status === 'connected' && result.authenticated === true;
      const consent = authenticated && result.consent === true;
      return { authenticated, consent, profile: consent ? result.profile : null, status: result.status, source: 'sqlite' };
    } catch { return offlineProfile; }
  }

  return { middleware, resolveProfile };
}
