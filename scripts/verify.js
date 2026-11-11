import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const coverage = process.argv.includes('--coverage');
const results = [];
await mkdir('artifacts', { recursive: true });
if (coverage) await rm('.c8', { recursive: true, force: true });
async function run(name, args) {
  const started = Date.now();
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  const code = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1)); });
  results.push({ name, status: code === 0 ? 'passed' : 'failed', durationMs: Date.now() - started });
  await writeFile('artifacts/verification.json', JSON.stringify({ generatedAt: new Date().toISOString(), coverage, results }, null, 2));
  if (code) process.exit(code);
}
await run('syntax', ['scripts/check.js']);
await run('lint', [join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js'), 'src', 'scripts', 'tests', 'server.js', 'playwright.config.js', 'eslint.config.js']);
await run('build', ['scripts/build-assets.js']);
const unit = ['scripts/run-unit.js'];
const integration = ['--env-file-if-exists=.env', 'scripts/run-suite.js', 'integration'];
const c8 = require.resolve('c8/bin/c8.js');
const flags = ['--clean=false', '--temp-directory=.c8', '--reporter=text-summary', '--check-coverage=false'];
await run('unit', coverage ? [c8, ...flags, process.execPath, ...unit] : unit);
await run('integration', coverage ? [c8, ...flags, process.execPath, ...integration] : integration);
if (coverage) await run('coverage', [c8, 'report', '--temp-directory=.c8']);
await run('browser', ['--env-file-if-exists=.env', 'scripts/run-suite.js', 'e2e']);
console.log('All verification gates passed. Reports: artifacts/verification.json, coverage/, playwright-report/');
