import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = ['server.js', ...['journey','p0','p0/public','scripts'].flatMap(dir=>readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(name=>/\.(js|mjs)$/.test(name)).map(name=>`${dir}/${name}`))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} application modules`);
