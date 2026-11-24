import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'career-account-browser-'));
const processes = [];
const errors = [];
const password = 'account-browser-fixture-2026';
const major = '合成资料：测绘工程';
let browser;

async function port() {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const chosen = listener.address().port;
  await new Promise(resolveClose => listener.close(resolveClose));
  return chosen;
}

function start(portNumber, config) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CAREER_|JOURNEY_|DEEPSEEK_|COZE_|RENDER)/i.test(name)));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, NODE_ENV: 'test', JOURNEY_LOAD_ENV: 'false', CAREER_AI_ENABLED: 'false', JOURNEY_AI_ENABLED: 'false', PORT: String(portNumber), ...config },
  });
  const fixture = { child, output: '' };
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { fixture.output = (fixture.output + chunk).slice(-2000); });
  processes.push(fixture);
  return fixture;
}

async function ready(url, process) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    assert.equal(process.child.exitCode, null, process.output);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Wait for the process to accept HTTP connections. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.fail(`Fixture server did not become ready. ${process.output}`);
}

async function open(origin) {
  const context = await browser.newContext({ baseURL: origin, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/start#profileCard`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function signIn(page, username, register) {
  if (register) await page.locator('#accountToggle').click();
  await page.locator('#accountUser').fill(username);
  await page.locator('#accountPassword').fill(password);
  if (register) await page.locator('#accountConsent').check();
  await page.locator('#accountSubmit').click();
  await page.locator('#profileCard').waitFor({ state: 'visible' });
}

async function profileResponse(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/me/profile');
    return { status: response.status, body: await response.json() };
  });
}

async function studentProfile(page) {
  const response = await profileResponse(page);
  assert.equal(response.status, 200, response.body.error?.code);
  return response.body;
}

try {
  const backendPort = await port();
  const frontendPort = await port();
  const upstream = `http://127.0.0.1:${backendPort}`;
  const origin = `http://127.0.0.1:${frontendPort}`;
  const gatewayKey = randomBytes(32).toString('hex');
  const backend = start(backendPort, {
    CAREER_DATA_MODE: 'origin', CAREER_DATA_GATEWAY_KEY: gatewayKey,
    CAREER_DB_PATH: join(scratch, 'account-fixture.sqlite'), CAREER_PUBLIC_URL: origin, CAREER_ALLOW_SELF_REGISTRATION: 'true',
  });
  await ready(`${upstream}/healthz`, backend);
  const frontend = start(frontendPort, {
    CAREER_DATA_UPSTREAM: upstream, CAREER_DATA_GATEWAY_KEY: gatewayKey, CAREER_PUBLIC_URL: origin,
  });
  await ready(`${origin}/api/career/status`, frontend);
  assert.equal((await fetch(`${upstream}/api/career/status`)).ok, false);
  browser = await launchBrowser();
  const first = await open(origin);
  await signIn(first, 'fixture-student-alpha', true);
  const row = first.locator('#profilePrimary .profile-row').filter({ has: first.locator('strong', { hasText: /^专业$/ }) });
  await row.locator('summary').click();
  await row.locator('textarea').fill(major);
  await row.getByRole('button', { name: '保存这一项', exact: true }).click();
  await row.getByText(major, { exact: true }).waitFor();
  const firstAccount = await studentProfile(first);
  assert.equal(firstAccount.fields['education.major'].value, major);

  const second = await open(origin);
  await signIn(second, 'fixture-student-beta', true);
  const secondAccount = await studentProfile(second);
  assert.notEqual(secondAccount.account.id, firstAccount.account.id);
  assert.equal(secondAccount.fields['education.major'].value_state, 'unknown');

  const freshBrowser = await open(origin);
  await signIn(freshBrowser, 'fixture-student-alpha', false);
  const restored = await studentProfile(freshBrowser);
  assert.equal(restored.account.id, firstAccount.account.id);
  assert.equal(restored.fields['education.major'].value, major);
  await freshBrowser.locator('#accountLogout').click();
  await freshBrowser.locator('#profileCard').waitFor({ state: 'hidden' });
  assert.equal((await profileResponse(freshBrowser)).status, 401);
  await signIn(freshBrowser, 'fixture-student-beta', false);
  assert.equal((await studentProfile(freshBrowser)).account.id, secondAccount.account.id);
  assert.equal(await freshBrowser.getByText(major, { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS registration, account isolation and cross-browser profile recovery through the administrator data service');
} finally {
  await browser?.close();
  for (const { child } of processes.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exit = once(child, 'exit');
    child.kill();
    await exit;
  }
  assert.equal(dirname(resolve(scratch)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(scratch).startsWith('career-account-browser-'));
  await rm(scratch, { recursive: true, force: true });
}
