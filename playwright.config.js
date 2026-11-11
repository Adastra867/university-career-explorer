import { defineConfig } from '@playwright/test';
import { assertTestDatabase } from './tests/helpers/environment.js';
assertTestDatabase(process.env.TEST_DATABASE_URL);
export default defineConfig({
  testDir: 'tests/browser', fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  timeout: 45000,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'artifacts/e2e-junit.xml' }]],
  use: {
    baseURL: 'http://127.0.0.1:15382', headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure', screenshot: 'only-on-failure', video: process.env.PLAYWRIGHT_CHANNEL ? 'off' : 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/test-server.js', url: 'http://127.0.0.1:15382/api/health',
    env: { PORT: '15382', APP_ORIGIN: 'http://127.0.0.1:15382', TRUST_PROXY: 'false' },
    reuseExistingServer: false, timeout: 30000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
