import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createCareerRouter } from '../p0/api.js';
import { openCareerStore, digest } from '../p0/store.js';

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'career-audit-'));
  const store = openCareerStore(join(directory, 'audit.sqlite'));
  const captures = [];
  const router = createCareerRouter({ store, env: {}, analyze: async input => {
    captures.push(structuredClone(input));
    return { profile_patch: [], result: { summary: '使用已保存回答生成建议', options: [{ title: '短期探索', reason: '按自述提供行动', source_refs: [], unknowns: [], next_action: '核实一份实际岗位描述' }] },
      next_question: input.asked_fields.length ? null : { field_path: 'education.major', question: '你学的专业是什么？', reason: '用于调整建议', options: [], allow_skip: true }, mode: 'rules', provenance: { rule_version: 'audit-fixture' } };
  } });
  const app = express(); app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '', csrf = '';
  async function call(method, path, body) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json(); if (result.csrf_token) csrf = result.csrf_token;
    return { status: response.status, body: result };
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); router.locals.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const guest = (await call('POST', '/guest-session', { consent: true, notice_version: 'p0-v1' })).body;
  let intake = (await call('POST', '/intakes', { task_type: 'explore_direction', input: '' })).body;
  intake = (await call('POST', `/intakes/${intake.id}/turns`, { action: 'generate', expected_revision: 0, idempotency_key: randomUUID() })).body;
  function interruptedAnswer() {
    const request = { action: 'answer', expected_revision: intake.input_revision, question_id: intake.question.question_id, answer: '能源专业', idempotency_key: randomUUID() };
    const prepared = structuredClone(intake);
    prepared.answers.push({ question_id: prepared.question.question_id, field_path: prepared.question.field_path, question: prepared.question.question, answer: request.answer });
    prepared.question = null; prepared.input_revision++;
    store.run('UPDATE intakes SET data=? WHERE id=?', JSON.stringify(prepared), intake.id);
    // The first half of the endpoint committed, then the process stopped before
    // the model response. A fresh router has no activeTurns promise for this row.
    store.run('INSERT INTO turn_requests(owner_id,idempotency_key,intake_id,fingerprint,response,created_at,prepared_data) VALUES(?,?,?,?,?,?,?)', guest.guest_id, request.idempotency_key, intake.id, digest({ intake_id: intake.id, ...request }), null, new Date().toISOString(), JSON.stringify(prepared));
    return { request, prepared };
  }
  return { store, call, intake, captures, interruptedAnswer };
}

test('answer retry after a persisted interruption resumes without reapplying its answer or question budget', async t => {
  const s = await setup(t);
  const { request, prepared } = s.interruptedAnswer();
  const result = await s.call('POST', `/intakes/${s.intake.id}/turns`, request);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.input_revision, prepared.input_revision);
  assert.equal(result.body.answers.length, 1);
  assert.equal(result.body.answers[0].answer, '能源专业');
  assert.equal(result.body.question_count, 1);
  assert.equal(s.captures.at(-1).sources.filter(source => source.field_path === 'education.major').length, 1);
  const replay = await s.call('POST', `/intakes/${s.intake.id}/turns`, request);
  assert.deepEqual(replay.body, result.body);
});

test('resumed interrupted work cannot overwrite a draft edited after its prepared snapshot', async t => {
  const s = await setup(t);
  const { request, prepared } = s.interruptedAnswer();
  await s.call('PATCH', `/intakes/${s.intake.id}/draft`, { expected_revision: prepared.input_revision, input: '用户在中断后补充的新材料' });
  const result = await s.call('POST', `/intakes/${s.intake.id}/turns`, request);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.error.code, 'STALE_ANALYSIS');
  assert.equal(result.body.input, '用户在中断后补充的新材料');
  const current = (await s.call('GET', `/intakes/${s.intake.id}`)).body;
  assert.equal(current.input, result.body.input);
  assert.equal(current.answers.length, 1);
  assert.equal(current.result_stale, true);
});
