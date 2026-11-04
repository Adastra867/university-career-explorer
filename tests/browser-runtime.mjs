import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Prefer the project's dependency. The fallback reuses the desktop runtime and
// may be overridden without installing packages into the application.
export async function loadPlaywright() {
  const errors = [];
  try { return await import('playwright'); } catch (error) { errors.push(error.message); }
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright', 'index.mjs'),
  ].filter(Boolean);
  for (let candidate of candidates) {
    try {
      if (!candidate.startsWith('file:')) {
        candidate = resolve(candidate);
        if ((await stat(candidate)).isDirectory()) candidate = join(candidate, 'index.mjs');
        await access(candidate);
        candidate = pathToFileURL(candidate).href;
      }
      return await import(candidate);
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`Playwright is unavailable. Install it or set PLAYWRIGHT_MODULE_PATH. ${errors.join('; ')}`);
}

export async function launchBrowser(options = {}) {
  const { chromium } = await loadPlaywright();
  const errors = [];
  const attempts = process.env.BROWSER_EXECUTABLE_PATH
    ? [{ executablePath: process.env.BROWSER_EXECUTABLE_PATH }, { channel: 'chrome' }, {}]
    : [{ channel: 'chrome' }, {}];
  for (const attempt of attempts) {
    try { return await chromium.launch({ headless: true, ...attempt, ...options }); }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`No existing Chromium browser could launch. ${errors.join('; ')}`);
}
