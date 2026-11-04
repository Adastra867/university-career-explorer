function problem(message, code = 'AI_INVALID_RESPONSE', status) {
  return Object.assign(new Error(message), { code, status });
}

// This parses the site's events, not DeepSeek's upstream SSE protocol.
export async function readAIResponse(response, { onDelta = () => {}, signal } = {}) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw problem(body.error || 'AI 请求失败，请稍后重试。', body.code || 'AI_REQUEST_FAILED', response.status);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const reader = response.body?.getReader();
  if (!reader) throw problem('模型服务没有返回可读取的回答。');
  const decoder = new TextDecoder();
  let buffer = '', event = '', data = [], result, total = 0, answer = '', finished = false;
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError'); };
  const dispatch = () => {
    if (!data.length) { event = ''; return; }
    let value;
    try { value = JSON.parse(data.join('\n')); } catch { throw problem('回答流格式无效，请重新询问。'); }
    data = [];
    if (finished) throw problem('回答结束后仍收到额外数据。');
    if (event === 'answer_delta') {
      if (typeof value.text !== 'string' || answer.length + value.text.length > 10000) throw problem('回答片段无效或超过长度限制。');
      answer += value.text; onDelta(value.text, answer);
    } else if (event === 'answer_completed') {
      if (typeof value.answer !== 'string' || value.answer.length > 10000 || !Array.isArray(value.proposedOperations)) throw problem('最终回答格式无效。');
      result = value; finished = true;
    } else if (event === 'answer_failed') {
      throw problem(value.error || '模型生成失败，已保留你的问题。', value.code || 'AI_PROVIDER_ERROR');
    } else if (!['question_saved', 'request_accepted', 'ping'].includes(event)) throw problem('回答流使用了不支持的事件协议。');
    event = '';
  };
  const line = value => {
    if (!value) return dispatch();
    if (value.startsWith(':')) return;
    if (value.startsWith('event:')) event = value.slice(6).trim();
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      checkAbort();
      const chunk = await reader.read();
      checkAbort();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 512 * 1024) throw problem('回答流超过长度限制。');
      buffer += decoder.decode(chunk.value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, index).replace(/\r$/, '')); buffer = buffer.slice(index + 1); }
    }
    buffer += decoder.decode();
    if (buffer) line(buffer.replace(/\r$/, ''));
    dispatch();
    if (!result) throw problem('回答流已中断，已保留问题及收到的部分回答。', 'AI_STREAM_INTERRUPTED');
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
