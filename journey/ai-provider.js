/** Server-only OpenAI-compatible transport. No configuration is accepted from HTTP clients. */
function fail(code, message, status = 503) { return Object.assign(new Error(message), { code, status }); }
function number(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback; }

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    const aborted = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function providerError(status) {
  if (status === 401 || status === 403) return fail('AI_UNAUTHORIZED', '模型服务认证失败，请由管理员检查配置。');
  if (status === 402) return fail('AI_INSUFFICIENT_BALANCE', '模型账户余额不足，请由管理员检查。');
  if (status === 429) return fail('AI_PROVIDER_RATE_LIMITED', '模型服务请求受限，请稍后重试。');
  return fail('AI_PROVIDER_UNAVAILABLE', '模型服务暂不可用，请稍后重试；你仍然可以手动编辑人生树。');
}

export function createAIProvider(options = {}) {
  const env = options.env || process.env, fetcher = options.fetch || globalThis.fetch, now = options.now || Date.now;
  let connection = { fingerprint: '', state: 'configured', lastErrorCode: null, lastCheckedAt: null };
  function config() {
    const declared = (env.JOURNEY_AI_PROVIDER || '').trim().toLowerCase();
    const deepseek = declared === 'deepseek' || (!declared && (!!env.DEEPSEEK_API_KEY || !!env.DEEPSEEK_BASE_URL || /api\.deepseek\.com/i.test(env.JOURNEY_AI_BASE_URL || '')));
    const provider = deepseek ? 'deepseek' : 'openai-compatible';
    const key = (env.JOURNEY_AI_API_KEY || (deepseek ? env.DEEPSEEK_API_KEY : '') || '').trim();
    const model = (env.JOURNEY_AI_MODEL || (deepseek ? env.DEEPSEEK_MODEL || 'deepseek-flash' : '') || '').trim();
    const base = (env.JOURNEY_AI_BASE_URL || (deepseek ? env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' : 'https://api.openai.com/v1')).trim().replace(/\/+$/, '');
    const enabled = !['false', '0', 'off'].includes(String(env.JOURNEY_AI_ENABLED ?? 'true').toLowerCase());
    let validUrl = false;
    try {
      const url = new URL(base);
      validUrl = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
      if (deepseek) {
        const official = url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && !url.port && ['', '/', '/v1', '/v1/'].includes(url.pathname);
        // Exact deployment-owned base URLs only; never a client-supplied URL or wildcard.
        const allowed = String(env.JOURNEY_AI_ALLOWED_BASE_URLS || '').split(',').map(v => v.trim().replace(/\/+$/, '')).filter(Boolean);
        validUrl = validUrl && (official || allowed.includes(base));
      }
    } catch { /* Unavailable configuration is never echoed to clients. */ }
    return { provider, deepseek, key, model, base, endpoint: `${base}/chat/completions`, enabled,
      configured: enabled && !!key && !!model && validUrl && (!declared || ['deepseek', 'openai-compatible'].includes(declared)),
      maxTokens: number(env.JOURNEY_AI_MAX_OUTPUT_TOKENS, 3000, 16, 8000),
      timeoutMs: options.timeoutMs ?? number(env.JOURNEY_AI_TIMEOUT_MS, 45000, 50, 120000) };
  }
  function fingerprint(c) { return `${c.endpoint}\0${c.model}\0${c.key}\0${c.enabled}`; }
  function status() {
    const c = config();
    if (connection.fingerprint !== fingerprint(c)) connection = { fingerprint: fingerprint(c), state: 'configured', lastErrorCode: null, lastCheckedAt: null };
    return { configured: c.configured, enabled: c.enabled, provider: c.provider, model: c.model || null, modelConfigured: !!c.model, baseUrl: c.deepseek ? 'https://api.deepseek.com' : null,
      state: c.configured ? connection.state : 'unconfigured', lastErrorCode: connection.lastErrorCode, lastCheckedAt: connection.lastCheckedAt };
  }
  function mark(error) {
    const c = config(); connection = { fingerprint: fingerprint(c), state: error ? 'error' : 'connected', lastErrorCode: error?.code || null, lastCheckedAt: new Date(now()).toISOString() };
  }
  async function request(messages, { signal, stream = false, test = false, maxOutputTokens } = {}) {
    const c = config();
    if (!c.enabled) throw fail('AI_DISABLED', '管理员已停用 AI，你仍然可以手动编辑人生树。');
    if (!c.configured) throw fail('AI_NOT_CONFIGURED', 'AI 未配置，你仍然可以手动编辑人生树。');
    const maxTokens = test ? 16 : number(maxOutputTokens, c.maxTokens, 16, 8000);
    const body = { model: c.model, stream, ...(c.deepseek ? { max_tokens: maxTokens, thinking: { type: 'disabled' } } : { max_completion_tokens: maxTokens }),
      ...(test ? {} : { response_format: { type: 'json_object' } }), messages };
    const retries = test ? 0 : number(options.maxRetries, 1, 0, 2);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const response = await fetcher(c.endpoint, { method: 'POST', signal, redirect: 'error', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (response.ok) return response;
      await response.body?.cancel().catch(() => {});
      if (attempt < retries && (response.status === 429 || response.status >= 500)) {
        await delay(options.retryDelayMs ?? Math.min(1000, Math.max(200, Number(response.headers.get('retry-after') || 0) * 1000)), signal);
        continue;
      }
      throw providerError(response.status);
    }
  }
  async function readJson(response) {
    const reader = response.body?.getReader();
    if (!reader) throw fail('AI_INVALID_RESPONSE', '模型服务返回空响应。', 422);
    let size = 0; const chunks = [];
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 128 * 1024) throw fail('AI_INVALID_RESPONSE', '模型响应过大。', 422); chunks.push(Buffer.from(value)); }
      let envelope; try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('AI_INVALID_RESPONSE', '模型服务返回了非法 JSON。', 422); }
      const choice = envelope?.choices?.[0];
      if (!choice || (choice.finish_reason != null && choice.finish_reason !== 'stop') || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw fail('AI_INVALID_RESPONSE', '模型回答未完整生成，请重试。', 422);
      return choice.message.content;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function json(messages, { signal, test = false, maxOutputTokens } = {}) { return readJson(await request(messages, { signal, test, maxOutputTokens })); }
  async function stream(messages, { signal, onContent } = {}) {
    const response = await request(messages, { signal, stream: true });
    if ((response.headers.get('content-type') || '').includes('application/json')) { const content = await readJson(response); onContent?.(content); return content; }
    const reader = response.body?.getReader();
    if (!reader) throw fail('AI_INVALID_RESPONSE', '模型服务返回空流。', 422);
    const decoder = new TextDecoder(); let buffer = '', content = '', bytes = 0, finished = false, sawDone = false;
    function event(block) {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
      if (!data) return;
      if (data === '[DONE]') { sawDone = true; return; }
      if (sawDone) throw fail('AI_INVALID_RESPONSE', '模型流在结束后继续返回数据。', 422);
      let chunk; try { chunk = JSON.parse(data); } catch { throw fail('AI_INVALID_RESPONSE', '模型流包含非法 JSON。', 422); }
      if (chunk.error) throw fail('AI_PROVIDER_UNAVAILABLE', '模型流返回错误。');
      const choice = chunk.choices?.[0];
      if (!choice) return; // Optional usage-only chunks carry no answer.
      if (choice.finish_reason) { if (choice.finish_reason !== 'stop') throw fail('AI_INVALID_RESPONSE', '模型回答未完整生成，请重试。', 422); finished = true; }
      const delta = choice.delta?.content;
      if (delta != null) { if (typeof delta !== 'string') throw fail('AI_INVALID_RESPONSE', '模型流格式不正确。', 422); content += delta; onContent?.(content); }
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) { buffer += decoder.decode(); break; }
        bytes += value.byteLength; if (bytes > 128 * 1024) throw fail('AI_INVALID_RESPONSE', '模型响应过大。', 422);
        buffer += decoder.decode(value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
        let at; while ((at = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, at)); buffer = buffer.slice(at + 2); }
      }
      if (buffer.trim()) event(buffer);
      if (!sawDone || !finished || !content.trim()) throw fail('AI_INVALID_RESPONSE', '模型流被截断，回答尚未完成，请重试。', 422);
      return content;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function testConnection(signal) {
    const c = config(); if (!c.configured) return { status: 'not_configured', model: c.model || null, ...status() };
    try { await json([{ role: 'user', content: 'Reply OK.' }], { signal, test: true }); mark(); return { ...status(), status: 'connected' }; }
    catch (error) { mark(error); return { ...status(), status: ({ AI_UNAUTHORIZED: 'unauthorized', AI_INSUFFICIENT_BALANCE: 'insufficient_balance', AI_PROVIDER_RATE_LIMITED: 'rate_limited' })[error.code] || 'provider_error' }; }
  }
  return { config, status, mark, json, stream, testConnection };
}

/** Decode only the top-level answer string while the surrounding JSON is incomplete. */
export function partialAnswer(json) {
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === '{' || c === '[') { depth++; continue; }
    if (c === '}' || c === ']') { depth--; continue; }
    if (c !== '"') continue;
    let end = i + 1;
    for (; end < json.length; end++) { if (json[end] === '\\') end++; else if (json[end] === '"') break; }
    if (end >= json.length) return '';
    let key; try { key = JSON.parse(json.slice(i, end + 1)); } catch { return ''; }
    let valueStart = end + 1; while (/\s/.test(json[valueStart] || '') && valueStart < json.length) valueStart++;
    if (depth !== 1 || key !== 'answer' || json[valueStart] !== ':') { i = end; continue; }
    valueStart++; while (/\s/.test(json[valueStart] || '') && valueStart < json.length) valueStart++;
    if (json[valueStart] !== '"') return '';
    let result = '';
    for (let j = valueStart + 1; j < json.length; j++) {
      if (json[j] === '"') break;
      if (json[j] !== '\\') { result += json[j]; continue; }
      if (++j >= json.length) break;
      if (json[j] === 'u') { const hex = json.slice(j + 1, j + 5); if (!/^[\da-fA-F]{4}$/.test(hex)) break; result += String.fromCharCode(parseInt(hex, 16)); j += 4; }
      else { const escaped = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[json[j]]; if (escaped === undefined) break; result += escaped; }
    }
    return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
  }
  return '';
}
