import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

// Exercises only fictional accounts. No AI calls, database writes, or secret output.
// Usage: node scripts/verify-local-storage.mjs [--base https://site.example]
//        [--origin https://data.example] [--db D:/data/career-public.sqlite]
// The database defaults to CAREER_DB_PATH from the environment or .env.career-data.
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = {
  database_schema: false, public_api: false, registration: false,
  profile_saved: false, second_session_restored: false, account_isolation: false,
  local_sqlite_verified: false, logout_isolated: false,
  origin_check_requested: false, origin_unauthenticated_rejected: false,
  test_accounts_cleaned: false,
};
const accounts = [];
let database, base, phase = 'configuration', failed = false;
function requireCheck(condition) { if (!condition) throw new Error('Verification did not pass.'); }
function address(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireCheck(url.protocol === 'https:' || (url.protocol === 'http:' && local));
  requireCheck(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash);
  return url.origin;
}
function browser() {
  const cookies = new Map();
  let csrf = '';
  return {
    async call(method, path, body) {
      const response = await fetch(`${base}/api${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: {
          Origin: base, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';'), split = pair.indexOf('=');
        const name = pair.slice(0, split), value = pair.slice(split + 1);
        if (!/^career_(?:account|guest)$/.test(name)) continue;
        if (value) cookies.set(name, value); else cookies.delete(name);
      }
      const payload = await response.json();
      if (typeof payload.csrf_token === 'string') csrf = payload.csrf_token;
      return { status: response.status, payload };
    },
  };
}
async function register(suffix) {
  const account = {
    username: `storage-check-${randomBytes(10).toString('hex')}-${suffix}`,
    password: randomBytes(32).toString('base64url'),
    session: browser(), registered: false,
  };
  // Remember the credentials before sending: cleanup can recover a lost response.
  accounts.push(account);
  const response = await account.session.call('POST', '/accounts/register', {
    username: account.username, password: account.password, consent: true, notice_version: 'p0-v1',
  });
  requireCheck(response.status === 201 && response.payload.account?.id && response.payload.profile);
  account.registered = true;
  account.id = response.payload.account.id;
  account.profile = response.payload.profile;
  return account;
}
async function login(account) {
  const session = browser();
  const result = await session.call('POST', '/accounts/login', {
    username: account.username, password: account.password,
  });
  return { session, ...result };
}
function hasLocalAccount(username) {
  return Boolean(database.prepare('SELECT 1 FROM student_accounts WHERE username=?').get(username));
}

try {
  const { values } = parseArgs({ options: {
    base: { type: 'string', default: 'https://university-career-explorer.onrender.com' },
    origin: { type: 'string' }, db: { type: 'string' }, 'env-file': { type: 'string' },
  } });
  base = address(values.base);
  const origin = values.origin ? address(values.origin) : null;
  checks.origin_check_requested = Boolean(origin);
  const envFile = resolve(workspace, values['env-file'] || '.env.career-data');
  const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const configuredPath = values.db || process.env.CAREER_DB_PATH || env.CAREER_DB_PATH;
  requireCheck(typeof configuredPath === 'string' && configuredPath.trim() && configuredPath !== ':memory:');
  const path = isAbsolute(configuredPath) ? configuredPath : resolve(workspace, configuredPath);
  requireCheck(existsSync(path));
  database = new DatabaseSync(path, { readOnly: true });
  database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
  checks.database_schema = database.prepare(`SELECT name FROM sqlite_schema WHERE type='table'
    AND name IN ('guests','student_accounts','student_sessions','profiles','intakes')`).all().length === 5;
  requireCheck(checks.database_schema);

  phase = 'public_api';
  const status = await browser().call('GET', '/career/status');
  requireCheck(status.status === 200 && status.payload.storage === 'sqlite' && status.payload.account_registration === true);
  requireCheck((await browser().call('GET', '/me/profile')).status === 401);
  checks.public_api = true;

  if (origin) {
    phase = 'origin_access';
    for (const path of ['/api/career/status', '/api/me/profile', '/_internal/career-profile']) {
      const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      await response.body?.cancel();
      requireCheck(response.status === 404);
    }
    checks.origin_unauthenticated_rejected = true;
  }

  phase = 'registration';
  const a = await register('a'), b = await register('b');
  requireCheck(a.id !== b.id);
  checks.registration = true;

  phase = 'profile_save';
  const marker = `合成本地保存验收-${randomBytes(16).toString('hex')}`;
  const saved = await a.session.call('PATCH', '/me/profile', {
    expected_revision: a.profile.profile_revision,
    patch: [{ field_path: 'education.major', value: marker }],
  });
  requireCheck(saved.status === 200 && saved.payload.fields?.['education.major']?.value === marker);
  checks.profile_saved = true;

  phase = 'second_session';
  const second = await login(a);
  requireCheck(second.status === 200 && second.payload.account?.id === a.id);
  const restored = await second.session.call('GET', '/me/profile');
  requireCheck(restored.status === 200 && restored.payload.fields?.['education.major']?.value === marker);
  checks.second_session_restored = true;

  phase = 'account_isolation';
  const bProfile = await b.session.call('GET', '/me/profile');
  requireCheck(bProfile.status === 200 && bProfile.payload.account?.id === b.id
    && bProfile.payload.fields?.['education.major']?.value === null);
  const intake = await a.session.call('POST', '/intakes', {
    task_type: 'explore_direction', input: '仅用于服务器保存验收的合成任务，不调用 AI。',
  });
  requireCheck(intake.status === 201 && typeof intake.payload.id === 'string');
  requireCheck((await b.session.call('GET', `/intakes/${encodeURIComponent(intake.payload.id)}`)).status === 404);
  checks.account_isolation = true;

  phase = 'local_sqlite';
  const stored = database.prepare(`SELECT a.owner_id,p.data FROM student_accounts a
    JOIN profiles p ON p.owner_id=a.owner_id WHERE a.username=?`).get(a.username);
  requireCheck(stored?.owner_id === a.id && JSON.parse(stored.data).fields?.['education.major']?.value === marker);
  requireCheck(Boolean(database.prepare('SELECT 1 FROM intakes WHERE id=? AND owner_id=?').get(intake.payload.id, a.id)));
  checks.local_sqlite_verified = true;

  phase = 'logout';
  requireCheck((await a.session.call('POST', '/accounts/logout', {})).status === 200);
  requireCheck((await a.session.call('GET', '/account-session')).status === 401);
  requireCheck((await second.session.call('GET', '/account-session')).status === 200);
  checks.logout_isolated = true;
} catch {
  failed = true;
  // Do not emit upstream bodies, exception text, usernames, credentials or paths.
  console.error(`Verification failed during ${phase}.`);
} finally {
  let cleaned = true;
  for (const account of accounts) {
    try {
      const active = await login(account);
      if (active.status === 401 && active.payload.error?.code === 'INVALID_CREDENTIALS' && !account.registered) {
        requireCheck(!hasLocalAccount(account.username));
        continue;
      }
      requireCheck(active.status === 200 && active.payload.account?.username === account.username);
      const owner = active.payload.account.id;
      // /me/data deletes the authenticated guest owner; foreign-key cascades also
      // remove its student account, sessions, profile, tasks and submissions.
      const deleted = await active.session.call('DELETE', '/me/data', {});
      requireCheck(deleted.status === 200 && deleted.payload.deleted === true);
      requireCheck((await active.session.call('GET', '/account-session')).status === 401);
      requireCheck(!hasLocalAccount(account.username));
      for (const table of ['guests', 'profiles', 'student_sessions', 'intakes']) {
        const field = table === 'guests' ? 'id' : 'owner_id';
        requireCheck(!database.prepare(`SELECT 1 FROM ${table} WHERE ${field}=?`).get(owner));
      }
    } catch { cleaned = false; }
  }
  checks.test_accounts_cleaned = cleaned;
  try { database?.close(); } catch { cleaned = false; checks.test_accounts_cleaned = false; }
  if (!cleaned) console.error('Synthetic account cleanup did not complete; verification is not passed.');
  const passed = !failed && cleaned;
  console.log(JSON.stringify({ ...checks, passed }));
  console.log(passed ? 'PASS' : 'FAIL');
  if (!passed) process.exitCode = 1;
}
