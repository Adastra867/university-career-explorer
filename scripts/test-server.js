import { assertTestDatabase } from '../tests/helpers/environment.js';
import { startProvider } from '../tests/helpers/provider.js';
assertTestDatabase(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
const provider = await startProvider();
Object.assign(process.env, {
  LLM_API_URL: provider.url, LLM_API_KEY: 'test-fixture-only', LLM_MODEL: 'fixture',
  DEEPSEEK_TOOLS_BASE_URL: provider.url, DEEPSEEK_SEARCH_API_KEY: 'test-fixture-only', DEEPSEEK_SEARCH_ENABLED: 'true',
  AUTO_MIGRATE: 'true', AI_DAILY_USER_LIMIT: '1000', AI_DAILY_TOTAL_LIMIT: '100000',
});
process.on('SIGTERM', () => { void provider.close(); });
process.on('SIGINT', () => { void provider.close(); });
await import('../server.js');
