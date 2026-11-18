import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function unusedPort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, wait(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}

function plan() {
  return {
    status: 'ready', summary: '从已保存的科研和建模经历出发，先完成可验证的能源数据作品。',
    profileInsights: { selfReported: ['MATLAB、Python 和建模分析经历'], inferred: [], missing: ['可投入时间待确认'] },
    branches: [{
      title: '能源技术与 AI 交叉实践', type: 'cross_field',
      description: '逐步完成建模、验证和作品整理。', reason: '可迁移既有科研方法和技术任务。',
      advantages: ['已有建模实践'], skillGaps: ['模型验证'], risks: ['具体岗位门槛待核实'],
      nextActions: ['整理已有项目的任务和结果'], verification: '请从业者反馈作品。',
      timeCost: '先投入两周', economicCost: '使用公开资料', opportunityCost: '占用其他准备时间',
      flexibility: '分析方法可以迁移', confidence: 'medium', evidenceIds: [],
      goal: '形成可展示的能源建模作品', startingPoint: '已有项目和技能自述',
      knowledge: ['验证方法'], credentials: ['岗位条件待核实'], practice: ['完成公开数据复现'],
      stages: ['near', 'mid', 'long'].map(timeframe => ({
        timeframe, title: '积累可验证成果', actions: ['完成阶段作品', '记录验证结果'],
      })),
    }],
    comparison: [], nextActions: ['整理已有项目的任务和结果'], followUpQuestion: '',
  };
}

test('real application wiring reads authorized SQLite profiles and survives a process restart', { timeout: 65000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'career-profile-integration-'));
  const database = join(directory, 'profile.sqlite');
  const contexts = [];
  const providerApp = express();
  providerApp.use(express.json({ limit: '2mb' }));
  providerApp.post('/chat/completions', (req, res) => {
    contexts.push(JSON.parse(req.body.messages.at(-1).content));
    res.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan()) } }] });
  });
  const provider = providerApp.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerURL = 'http://127.0.0.1:' + provider.address().port;
  const port = await unusedPort();
  const base = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env, PORT: String(port), NODE_ENV: 'test', JOURNEY_LOAD_ENV: 'false',
    CAREER_DB_PATH: database, CAREER_PUBLIC_URL: '', CAREER_AI_ENABLED: 'false',
    JOURNEY_ENABLED: 'true', JOURNEY_AI_ENABLED: 'true', JOURNEY_AI_PROVIDER: 'openai-compatible',
    JOURNEY_AI_BASE_URL: providerURL, JOURNEY_AI_API_KEY: 'isolated-fixture-key', JOURNEY_AI_MODEL: 'fixture-model',
  };
  for (const name of Object.keys(env)) {
    if (/(?:DEEPSEEK|COZE|ADMIN_PASSWORD|ADMIN_USERNAME)/.test(name)) delete env[name];
  }
  let child;
  let output = '';
  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, output);
      try {
        if ((await fetch(base + '/api/career/status')).ok) return;
      } catch {}
      await wait(100);
    }
    throw new Error('The isolated server did not start. ' + output);
  }
  t.after(async () => {
    await stop(child);
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('career-profile-integration-'));
    rmSync(target, { recursive: true, force: true });
  });
  await start();

  function client() {
    const jar = new Map();
    let csrf;
    return {
      async call(method, path, body) {
        const response = await fetch(base + '/api' + path, {
          method, headers: {
            'Content-Type': 'application/json', Origin: base,
            Cookie: [...jar].map(([key, value]) => key + '=' + value).join('; '),
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0];
          const index = pair.indexOf('=');
          jar.set(pair.slice(0, index), pair.slice(index + 1));
        }
        const value = await response.json();
        if (value.csrf_token) csrf = value.csrf_token;
        return { status: response.status, body: value, headers: response.headers };
      },
      async ask(extra = {}) {
        await wait(1550);
        return this.call('POST', '/journey/career-intelligence', {
          task: 'plan', message: '结合我的个人经历制定近期、中期和远期成长路线，关注项目中的最终验证成果。', ...extra,
        });
      },
    };
  }
  const a = client(), b = client(), anonymous = client();
  const longExperience = '项目原文。我负责用 MATLAB 复核实验数据，使用 Python 整理测量记录与验证建模假设。'.repeat(75) +
    '最终验证成果 LONG_PROJECT_TAIL_7381：建立参数误差对照，完成技术报告并记录模型局限。';
  let originalProfile;
  let aGuestId;
  await t.test('storage consent alone does not grant online AI access', async () => {
    const created = await a.call('POST', '/guest-session', { consent:true, notice_version:'p0-v1' });
    assert.equal(created.status, 200);
    aGuestId = created.body.guest_id;
    const saved = await a.call('PATCH', '/me/profile', {
      expected_revision: created.body.profile.profile_revision,
      patch: [
        {field_path:'education.stage',value:'大三'}, {field_path:'education.major',value:'可持续能源'},
        {field_path:'experience.text',value:longExperience}, {field_path:'skills.self_report',value:'MATLAB、Python、建模分析'},
        {field_path:'preferences.long_term_goal',value:'能源技术与 AI 交叉方向'},
      ],
    });
    assert.equal(saved.status, 200);
    const reply = await a.ask();
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(contexts.at(-1).profile, []);
    assert.equal(reply.body.profileDiagnostics.usedByModel, false);
  });
  await t.test('authorized profiles are loaded from SQLite without a browser profile payload', async () => {
    const grant = await a.call('POST', '/me/profile/ai-consent', {consent:true,notice_version:'career-ai-profile-v1'});
    assert.equal(grant.status, 200);
    originalProfile = grant.body;
    const reply = await a.ask();
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const input = JSON.stringify(contexts.at(-1).profile);
    assert.match(input, /大三/);
    assert.match(input, /可持续能源/);
    assert.match(input, /LONG_PROJECT_TAIL_7381/);
    assert.match(input, /MATLAB/);
    assert.ok(reply.body.profileDiagnostics.fieldCount >= 5);
    assert.equal(reply.body.profileDiagnostics.source, 'sqlite');
    assert.equal(reply.body.profileDiagnostics.usedByModel, true);
    assert.deepEqual(reply.body.branches[0].stages.map(stage => stage.timeframe), ['near','mid','long']);
    assert.equal(reply.body.followUpQuestion, '');
  });
  await t.test('two guests and forged request identifiers cannot select another owner', async () => {
    await b.call('POST', '/guest-session', {consent:true,notice_version:'p0-v1'});
    await b.call('POST', '/me/profile/ai-consent', {consent:true,notice_version:'career-ai-profile-v1'});
    const reply = await b.ask({guest_id:aGuestId, owner_id:aGuestId});
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(contexts.at(-1).profile, []);
    const unauthenticated = await anonymous.ask();
    assert.equal(unauthenticated.status, 200);
    assert.deepEqual(contexts.at(-1).profile, []);
    assert.equal(unauthenticated.headers.get('set-cookie'), null);
  });
  await t.test('turning profile use off leaves stored personal data intact', async () => {
    const reply = await a.ask({profileUsage:{enabled:false}});
    assert.equal(reply.status, 200);
    assert.deepEqual(contexts.at(-1).profile, []);
    assert.equal(reply.body.profileDiagnostics.usedByModel, false);
    assert.deepEqual((await a.call('GET', '/me/profile')).body, originalProfile);
  });
  await t.test('long experiences keep their final result and truncation is explicit', async () => {
    const reply = await a.ask();
    assert.equal(reply.status, 200);
    assert.ok(longExperience.length > 2000);
    assert.match(JSON.stringify(contexts.at(-1).profile), /LONG_PROJECT_TAIL_7381/);
    assert.ok(reply.body.profileDiagnostics.totalCharacters > 2000);
    assert.ok(Array.isArray(reply.body.profileDiagnostics.truncatedFields));
    assert.equal((await a.call('GET', '/me/profile')).body.fields['experience.text'].value, longExperience);
  });
  await t.test('server logs contain diagnostic counts without private profile text', () => {
    assert.match(output, /"event":"career_ai_profile"/);
    assert.doesNotMatch(output, /LONG_PROJECT_TAIL_7381|可持续能源|MATLAB|isolated-fixture-key/);
  });
  await t.test('the same cookies, authorization and profile survive a real application restart', async () => {
    await stop(child);
    await start();
    assert.deepEqual((await a.call('GET', '/me/profile')).body, originalProfile);
    const reply = await a.ask();
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.match(JSON.stringify(contexts.at(-1).profile), /LONG_PROJECT_TAIL_7381/);
    const db = new DatabaseSync(database, {readOnly:true});
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM guests').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count, 2);
    db.close();
  });
});
