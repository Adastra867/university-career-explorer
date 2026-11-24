import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import express from 'express';
import { createCareerRouter } from '../p0/api.js';
import { careerDataSettings, createCareerDataGateway, mountCareerDataOrigin } from '../p0/data-gateway.js';

const fixtureKey = 'fixture_gateway_key_for_local_test_only';
const browserOrigin = 'https://workspace.example';
const keyHeader = 'x-career-data-gateway-key';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

test('a public deployment requires a fixed HTTPS origin and a separate storage mode', () => {
  const env = { RENDER: 'true', CAREER_DATA_GATEWAY_KEY: fixtureKey };
  for (const address of ['http://127.0.0.1:1234', 'https://data.example/path', 'https://user:fixture@data.example/', 'https://data.example/?q=1']) {
    assert.throws(() => careerDataSettings({ ...env, CAREER_DATA_UPSTREAM: address }), Error);
  }
  assert.throws(() => careerDataSettings({ CAREER_DATA_MODE: 'origin', CAREER_DATA_GATEWAY_KEY: fixtureKey }), Error);
  assert.throws(() => careerDataSettings({ ...env, CAREER_DB_PATH: 'fixture.sqlite', CAREER_DATA_UPSTREAM: 'https://data.example' }), Error);
  assert.equal(careerDataSettings({ ...env, CAREER_DATA_UPSTREAM: 'https://data.example' }).upstream, 'https://data.example');
});

test('the data gateway preserves sessions and consent, hides private routes, and reports offline storage', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'career-data-gateway-'));
  const env = { NODE_ENV: 'production', CAREER_DB_PATH: join(directory, 'gateway.sqlite'), CAREER_PUBLIC_URL: browserOrigin,
    CAREER_DATA_MODE: 'origin', CAREER_DATA_GATEWAY_KEY: fixtureKey };
  const router = createCareerRouter({ env });
  const backend = express();
  mountCareerDataOrigin(backend, careerDataSettings(env), router);
  const local = await listen(backend);

  const calls = [];
  const gateway = createCareerDataGateway(careerDataSettings({ CAREER_DATA_UPSTREAM: local.url, CAREER_DATA_GATEWAY_KEY: fixtureKey }), (url, init) => {
    calls.push({ path: new URL(url).pathname, headers: init.headers });
    return fetch(url, init);
  });
  const publicApp = express();
  publicApp.use(gateway.middleware);
  publicApp.get('/', (_req, res) => res.send('public site'));
  publicApp.post('/fixture-profile-resolver', express.json(), async (req, res) => res.json(await gateway.resolveProfile(req)));
  const edge = await listen(publicApp);
  t.after(async () => {
    await edge.close();
    await local.close();
    router.locals.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^career-data-gateway-/);
    await rm(target, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${local.url}/healthz`)).status, 200);
  for (const path of ['/', '/api/career/status', '/api/me/profile', '/_internal/career-profile', '/p0/admin.js']) {
    assert.equal((await fetch(local.url + path)).status, 404, path);
  }
  assert.equal((await fetch(`${local.url}/api/career/status`, { headers: { [keyHeader]: 'wrong' } })).status, 404);
  assert.equal((await fetch(`${local.url}/api/journey/ai/status`, { headers: { [keyHeader]: fixtureKey } })).status, 404);
  assert.equal((await fetch(`${edge.url}/api/career/status`)).status, 200);
  for (const path of ['/api/journey/ai/status', '/_internal/career-profile', '/api/me/%70rofile', '/api/admin/campaigns/a%2Fb']) {
    const prior = calls.length;
    assert.equal((await fetch(edge.url + path)).status, 404, path);
    assert.equal(calls.length, prior);
  }

  const json = (path, method, body, headers = {}) => fetch(`${edge.url}/api${path}`, {
    method, headers: { Origin: browserOrigin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const newGuest = await json('/guest-session', 'POST', { consent: true, notice_version: 'p0-v1' }, { [keyHeader]: 'ignored' });
  const session = await newGuest.json();
  assert.equal(newGuest.status, 200);
  assert.equal(newGuest.headers.get('cache-control'), 'no-store');
  const [guestCookie] = newGuest.headers.getSetCookie();
  assert.match(guestCookie, /^career_guest=[\w-]+;.* HttpOnly; Secure; SameSite=Lax/i);
  assert.equal(calls.at(-1).headers[keyHeader], fixtureKey);
  assert.doesNotMatch(guestCookie, /Domain=/i);
  const account = { Cookie: `${guestCookie.split(';', 1)[0]}; unrelated=do-not-forward; career_admin=do-not-forward`, 'X-CSRF-Token': session.csrf_token };
  const patch = { expected_revision: session.profile.profile_revision, patch: [{ field_path: 'education.major', value: '合成材料测试专业' }] };
  assert.equal((await json('/me/profile', 'PATCH', patch, { ...account, Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await json('/me/profile', 'PATCH', patch, { ...account, 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await json('/me/profile', 'PATCH', patch, account)).status, 200);
  assert.doesNotMatch(calls.at(-1).headers.cookie, /unrelated|career_admin/);

  const fetchProfile = async flag => (await fetch(`${edge.url}/fixture-profile-resolver`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: account.Cookie }, body: JSON.stringify({ profileUsage: { enabled: flag } }),
  })).json();
  const unauthorized = await fetchProfile(true);
  assert.equal(unauthorized.authenticated, true);
  assert.equal(unauthorized.consent, false);
  assert.equal(unauthorized.profile, null);
  assert.equal((await json('/me/profile/ai-consent', 'POST', { consent: true, notice_version: 'career-ai-profile-v1' }, account)).status, 200);
  const authorized = await fetchProfile(true);
  assert.equal(authorized.consent, true);
  assert.equal(authorized.profile.fields['education.major'].value, '合成材料测试专业');
  const previousCalls = calls.length;
  assert.equal((await fetchProfile(false)).profile, null);
  assert.equal(calls.length, previousCalls);

  const deleted = await json('/me/data', 'DELETE', {}, account);
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get('set-cookie'), /^career_guest=;/);
  assert.equal((await json('/me/profile', 'GET', undefined, account)).status, 401);

  const credentials = { username: 'fixture-student', password: 'fixture-password-for-registration' };
  const signup = await json('/accounts/register', 'POST', { ...credentials, consent: true, notice_version: 'p0-v1' });
  assert.equal(signup.status, 201);
  const student = await signup.json();
  const firstDevice = { Cookie: signup.headers.getSetCookie()[0].split(';', 1)[0], 'X-CSRF-Token': student.csrf_token };
  assert.match(firstDevice.Cookie, /^career_account=/);
  assert.equal((await json('/me/profile', 'PATCH', patch, firstDevice)).status, 200);
  const signin = await json('/accounts/login', 'POST', credentials);
  assert.equal(signin.status, 200);
  const connected = await signin.json();
  assert.equal(connected.account.id, student.account.id);
  const secondDevice = { Cookie: signin.headers.getSetCookie()[0].split(';', 1)[0], 'X-CSRF-Token': connected.csrf_token };
  const sessionCheck = await json('/account-session', 'GET', undefined, secondDevice);
  assert.equal(sessionCheck.status, 200);
  assert.equal((await sessionCheck.json()).profile.fields['education.major'].value, patch.patch[0].value);
  const logout = await json('/accounts/logout', 'POST', {}, firstDevice);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /^career_account=;/);
  assert.equal((await json('/account-session', 'GET', undefined, firstDevice)).status, 401);
  assert.equal((await json('/account-session', 'GET', undefined, secondDevice)).status, 200);

  await local.close();
  const disconnected = await fetch(`${edge.url}/api/career/status`);
  assert.equal(disconnected.status, 503);
  assert.equal((await disconnected.json()).error.code, 'STORAGE_UNREACHABLE');
  assert.equal((await fetchProfile(true)).status, 'storage_unavailable');
  assert.equal((await fetch(`${edge.url}/`)).status, 200);
});
