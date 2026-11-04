import test from 'node:test';
import assert from 'node:assert/strict';
import { readAIResponse } from '../journey/ai-client.js';

function events(text, sizes = [1, 2, 5, 11]) {
  const bytes = new TextEncoder().encode(text); let index = 0, step = 0;
  return new Response(new ReadableStream({ pull(controller) { if (index >= bytes.length) return controller.close(); const end = Math.min(bytes.length, index + sizes[step++ % sizes.length]); controller.enqueue(bytes.slice(index, end)); index = end; } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const final = { answer: '关于科研\n与音乐', proposedOperations: [], usedGraphRevision: 4 };
test('site SSE survives split UTF-8, CRLF, comments, incremental deltas and a final validated answer', async () => {
  const parts = [];
  const response = events(`: heartbeat\r\n\r\nevent: answer_delta\r\ndata: ${JSON.stringify({ text: '关于科研\n' })}\r\n\r\nevent: answer_delta\ndata: ${JSON.stringify({ text: '与音乐' })}\n\nevent: answer_completed\ndata: ${JSON.stringify(final)}\n\n`);
  assert.deepEqual(await readAIResponse(response, { onDelta: text => parts.push(text) }), final);
  assert.equal(parts.join(''), final.answer);
});
test('partial streams, malformed events and provider protocols cannot be mistaken for completion', async () => {
  for (const value of ['event: answer_delta\ndata: {"text":"部分"}\n\n', 'event: answer_completed\ndata: nope\n\n', 'data: [DONE]\n\n', 'event: answer_completed\ndata: {"answer":"只有答案"}\n\n']) await assert.rejects(readAIResponse(events(value)));
});
test('HTTP and in-stream errors preserve their safe error categories', async () => {
  await assert.rejects(readAIResponse(new Response(JSON.stringify({ code: 'AI_NOT_CONFIGURED', error: 'AI 未配置' }), { status: 503 })), e => e.code === 'AI_NOT_CONFIGURED' && e.status === 503);
  await assert.rejects(readAIResponse(events('event: answer_failed\ndata: {"code":"AI_UNAUTHORIZED","error":"认证失败"}\n\n')), e => e.code === 'AI_UNAUTHORIZED');
});
test('non-stream compatibility and explicit cancellation keep distinct outcomes', async () => {
  assert.deepEqual(await readAIResponse(new Response(JSON.stringify(final), { headers: { 'Content-Type': 'application/json' } })), final);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readAIResponse(events(''), { signal: controller.signal }), e => e.name === 'AbortError');
});
