import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

// Inspect file names and contents without printing a credential or entered data.
// This is a guard against common mistakes, not a replacement for reviewing a diff.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').trim();
process.chdir(root);
const args = process.argv.slice(2);
const stagedOnly = args.includes('--staged');
const manifestIndex = args.indexOf('--manifest');
let validArguments = true;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--staged') continue;
  if (args[index] === '--manifest' && args[index + 1] && !args[index + 1].startsWith('--')) { index++; continue; }
  validArguments = false;
}
if (!validArguments) {
  console.error('Usage: node scripts/check-deploy.mjs [--staged] [--manifest <temporary-file>]');
  process.exit(2);
}
const splitPaths = value => value.split('\0').filter(Boolean);
// One index read supplies paths, modes and object IDs. File names remain literal
// even when they contain whitespace, tabs, newlines or non-ASCII characters.
const entries = splitPaths(git('ls-files', '--stage', '-z')).map(record => {
  const match = record.match(/^([0-7]{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/);
  if (!match) throw new Error('Git index could not be inspected.');
  return { mode: match[1], oid: match[2], stage: Number(match[3]), file: match[4] };
});
const tracked = [...new Set(entries.map(entry => entry.file))];
const indexByPath = new Map(entries.filter(entry => entry.stage === 0).map(entry => [entry.file, entry]));
const untracked = stagedOnly ? [] : splitPaths(git('ls-files', '-z', '--others', '--exclude-standard'));
const paths = [...new Set([...tracked, ...untracked])].sort();
const conflicts = splitPaths(git('diff', '--name-only', '--diff-filter=U', '-z'));
const findings = [];
const report = (file, reason) => {
  if (!findings.some(item => item.file === file && item.reason === reason)) findings.push({ file, reason });
};
for (const file of conflicts) report(file, 'unresolved merge conflict');

const exampleFile = file => /(?:^|\/)\.env(?:\.[^/]*)?\.example$/.test(file) || /(?:^|\/)\.env\.example$/.test(file);
const forbiddenDirectory = /(?:^|\/)(?:\.git|node_modules|artifacts|data|backups|exports|logs|dist|build|coverage|\.cache|\.pnpm-store|\.npm|\.venv|venv|__pycache__)(?:\/|$)/i;
const forbiddenFile = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.netrc|_netrc|credentials(?:\.[^/]*)?|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|log|pid)$/i;
const recordExport = /(?:^|\/)(?:student[-_]?records?|survey[-_]?results?|questionnaire[-_]?responses?|submissions[-_]?export)(?:[._/-]|$)/i;
const placeholder = value => /(?:example|placeholder|fixture|dummy|synthetic|not[-_ ]?(?:a[-_ ]?)?real|test[-_ ]|your[-_ ]|replace[-_ ]|changeme|^<.*>$|^\$\{|^process\.env\.|^env\.)/i.test(value);
const tokenPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g],
  ['Render credential', /\brnd_[A-Za-z0-9]{20,}\b/g],
  ['AWS credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Slack credential', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

// Git's batch protocol prefixes each blob with an ASCII header containing its
// byte length. Advance through the Buffer by bytes, never by decoded characters:
// a source file may contain multibyte Chinese text, newlines, or NUL bytes.
const blobIds = [...new Set([...indexByPath.values()]
  .filter(entry => entry.mode === '100644' || entry.mode === '100755')
  .map(entry => entry.oid))];
const indexContents = new Map();
let indexReadFailed = false;
if (blobIds.length) {
  try {
    const output = execFileSync('git', ['cat-file', '--batch'], {
      input: `${blobIds.join('\n')}\n`,
      maxBuffer: Math.max(32 * 1024 * 1024, blobIds.length * (10 * 1024 * 1024 + 256)),
    });
    let offset = 0;
    for (const oid of blobIds) {
      const end = output.indexOf(10, offset);
      if (end < 0) throw new Error('Incomplete Git batch header.');
      const header = output.subarray(offset, end).toString('ascii').match(/^([a-f0-9]+) blob ([0-9]+)$/);
      if (!header || header[1] !== oid) throw new Error('Unexpected Git batch object.');
      const size = Number(header[2]);
      const start = end + 1;
      const next = start + size;
      if (!Number.isSafeInteger(size) || next >= output.length || output[next] !== 10) throw new Error('Incomplete Git batch content.');
      indexContents.set(oid, output.subarray(start, next));
      offset = next + 1;
    }
    if (offset !== output.length) throw new Error('Unexpected Git batch output.');
  } catch {
    // Never include command output: a blob can contain a secret under review.
    indexReadFailed = true;
  }
}

function inspect(file, content) {
  if (content.includes(0)) return; // Credential-bearing binary containers are rejected by path above.
  const text = content.toString('utf8');
  for (const [label, regex] of tokenPatterns) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(new RegExp(regex.source, 'g'))) {
      if (!placeholder(match[0])) { report(file, label); break; }
    }
  }
  // Match only literal values: server-side environment lookups are safe to commit.
  const assignments = /\b(?:[A-Z_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|ADMIN_TOKEN|CLIENT_SECRET|PASSWORD|PROPOSAL_SECRET)|apiKey|accessToken|clientSecret|password)\b["']?\s*[:=]\s*(["'])([^\r\n]*?)\1/g;
  for (const match of text.matchAll(assignments)) {
    const value = match[2];
    if (value.length >= 20 && !placeholder(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value) && /^[A-Za-z0-9_+/=.!@#$%^&*-]+$/.test(value)) {
      report(file, 'possible hard-coded credential');
    }
  }
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?):\/\/[^\s/:'"`]+:[^\s/@'"`]+@/i.test(text) && !file.startsWith('tests/')) {
    report(file, 'credential embedded in connection URL');
  }
  if (exampleFile(file)) {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL))\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[1].replace(/^(["'])(.*)\1$/, '$2');
      if (value && !placeholder(value)) report(file, 'nonempty secret in environment example');
    }
  }
  // Keep synthetic privacy-test fixtures; reject obvious contact records in data exports.
  if (/\.(?:jsonl?|csv|tsv|txt)$/i.test(file) && !file.startsWith('tests/') && !file.endsWith('package.json') && !file.endsWith('knowledge-sources.json')) {
    if (/(?:"(?:phone|mobile|telephone|身份证|手机号)"\s*:\s*"(?:\+?86[- ]?)?1[3-9]\d{9}"|(?:^|[,\t])1[3-9]\d{9}(?:[,\t]|$))/m.test(text)) report(file, 'possible personal contact record');
  }
}

for (const file of paths) {
  if (forbiddenDirectory.test(file) || recordExport.test(file) || (forbiddenFile.test(file) && !exampleFile(file))) {
    report(file, 'private/runtime file must not be tracked or staged');
    continue;
  }
  const absolute = resolve(root, file);
  const local = relative(root, absolute);
  if (local.startsWith('..') || isAbsolute(local)) { report(file, 'path outside repository'); continue; }
  try {
    if (!stagedOnly) {
      let stat;
      try { stat = lstatSync(absolute); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat) {
        if (stat.isSymbolicLink() || !stat.isFile()) { report(file, 'symbolic link or unsupported file'); continue; }
        if (stat.size > 10 * 1024 * 1024) { report(file, 'file exceeds 10 MiB; review before publishing'); continue; }
        inspect(file, readFileSync(absolute));
      }
    }
    if (tracked.includes(file)) {
      const entry = indexByPath.get(file);
      if (!entry || (entry.mode !== '100644' && entry.mode !== '100755')) { report(file, 'symbolic link or unsupported index entry'); continue; }
      // Also inspect the index: ignored or staged credentials must not slip through.
      const content = indexContents.get(entry.oid);
      if (indexReadFailed || !content) { report(file, 'file could not be inspected'); continue; }
      if (content.length > 10 * 1024 * 1024) report(file, 'index file exceeds 10 MiB; review before publishing');
      else inspect(file, content);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') report(file, 'file could not be inspected');
  }
}

if (findings.length) {
  console.error('Deployment safety check refused these files (values are hidden):');
  for (const { file, reason } of findings) console.error(`- ${file}: ${reason}`);
  console.error('Keep secrets/student records outside Git. If a real secret was already tracked, stop publishing, rotate it and review repository history.');
  process.exit(1);
}
if (manifestIndex >= 0) writeFileSync(args[manifestIndex + 1], paths.length ? `${paths.join('\0')}\0` : '');
console.log(`Deployment safety check passed: ${paths.length} ${stagedOnly ? 'index' : 'working-tree/index'} files; ignored local files stay excluded.`);
