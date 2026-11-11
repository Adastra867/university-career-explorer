import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTestDatabase, sanitizedEnvironment, prepareDatabase } from './helpers/environment.js';
test('test database guard rejects application databases, invalid schemes and same target', () => {
  assert.throws(() => assertTestDatabase('postgres://u:p@localhost/career'));
  assert.throws(() => assertTestDatabase('https://localhost/career_test'));
  assert.throws(() => assertTestDatabase('postgres://u:p@localhost/career_test', 'postgres://u:p@localhost/career_test'));
  assert.throws(() => assertTestDatabase('postgres://u:p@127.0.0.1/career_test', 'postgres://u:p@localhost/career_test'));
  assert.equal(assertTestDatabase('postgres://u:p@localhost/career_e2e_test').pathname, '/career_e2e_test');
});
test('test subprocesses cannot inherit real model keys, endpoints or application database URLs', () => {
  const clean = sanitizedEnvironment({ PATH: '/bin', HOME: '/test-home', CI: 'true', DATABASE_URL: 'private', LLM_API_KEY: 'real-secret', DEEPSEEK_SEARCH_API_KEY: 'real-secret', DEEPSEEK_TOOLS_BASE_URL: 'https://api.deepseek.com', AWS_SECRET_ACCESS_KEY: 'secret', GITHUB_TOKEN: 'secret' });
  assert.deepEqual(clean, { PATH: '/bin', HOME: '/test-home', CI: 'true' });
});

test('database-dependent suites fail explicitly when no database is configured', async () => {
  await assert.rejects(prepareDatabase('integration', {}), /Configure DATABASE_URL/);
  await assert.rejects(prepareDatabase('unknown', {}), /Unknown test suite/);
});
