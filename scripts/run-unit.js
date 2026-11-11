import { spawn } from 'node:child_process';
import { sanitizedEnvironment } from '../tests/helpers/environment.js';
const files = ['tests/core.test.js', 'tests/search.test.js', 'tests/environment.test.js', 'tests/assets.test.js'];
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...sanitizedEnvironment(), NODE_ENV: 'test' } });
child.on('error', () => process.exit(1));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
