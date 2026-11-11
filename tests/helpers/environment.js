import pg from 'pg';

export function assertTestDatabase(value, applicationDatabase) {
  if (!value) throw new Error('TEST_DATABASE_URL is required; use pnpm test:integration or pnpm test:e2e');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-zA-Z0-9_]+_test$/.test(url.pathname.slice(1))) throw new Error('Refusing a database without an explicit _test suffix');
  if (applicationDatabase) {
    const application = new URL(applicationDatabase);
    if (application.pathname === url.pathname) throw new Error('Test database must differ from the application database');
  }
  return url;
}

export function sanitizedEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => /^(PATH|HOME|USERPROFILE|SystemRoot|SYSTEMROOT|TMPDIR|TMP|TEMP|LANG|LC_.*|CI|GITHUB_ACTIONS|PLAYWRIGHT_.*|NODE_V8_COVERAGE|FORCE_COLOR|NO_COLOR|PNPM_HOME)$/.test(name)));
}

export async function prepareDatabase(suite, environment = process.env) {
  if (!['integration', 'e2e'].includes(suite)) throw new Error('Unknown test suite');
  let target;
  if (environment.TEST_DATABASE_URL) target = assertTestDatabase(environment.TEST_DATABASE_URL, environment.DATABASE_URL);
  else {
    if (!environment.DATABASE_URL) throw new Error('Configure DATABASE_URL or a dedicated TEST_DATABASE_URL; tests cannot silently skip');
    target = new URL(environment.DATABASE_URL);
    target.pathname = '/' + target.pathname.slice(1) + '_' + suite + '_test';
    assertTestDatabase(target.href, environment.DATABASE_URL);
  }
  const maintenance = new URL(target); maintenance.pathname = '/postgres';
  const admin = new pg.Pool({ connectionString: maintenance.href, connectionTimeoutMillis: 5000 });
  try {
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [target.pathname.slice(1)])).rowCount) {
      await admin.query(`CREATE DATABASE "${target.pathname.slice(1)}"`);
    }
  } catch (error) {
    // A pre-created dedicated database may be usable even without maintenance/CREATEDB access.
    const existing = new pg.Pool({ connectionString: target.href, connectionTimeoutMillis: 5000 });
    try { await existing.query('SELECT 1'); } catch { throw new Error(`Test database unavailable (${error.code || 'CONNECTION_FAILED'}); create the dedicated _test database first`); }
    finally { await existing.end(); }
  } finally { await admin.end(); }
  return target.href;
}
