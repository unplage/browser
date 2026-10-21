/* ─── 错误归一化与重试策略 ─── */

export class LLMError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = meta.status ?? null;
    this.code = meta.code ?? null;
    this.param = meta.param ?? null;
    this.providerId = meta.providerId ?? null;
    this.model = meta.model ?? null;
    this.retryable = !!meta.retryable;
    this.hint = meta.hint ?? null;
    this.raw = meta.raw ?? null;
  }
}

const RETRYABLE_CODES = new Set([
  'rate_limit_exceeded', '429', 'insufficient_quota', 'server_error', '500', '502', '503', '504',
  'overloaded_error', 'timeout', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
]);

const AUTH_CODES = new Set(['invalid_api_key', 'authentication_error', '401', '403', 'invalid_request_error.unauthorized']);

export function normalizeError(status, body, ctx = {}) {
  const msg = body?.message || '请求失败';
  const code = body?.code ?? null;

  let retryable = status === 429 || status >= 500 || status === 408;
  if (code && RETRYABLE_CODES.has(String(code))) retryable = true;
  if (status === 401 || status === 403) retryable = false;

  let hint = null;
  if (status === 401 || (code && AUTH_CODES.has(String(code)))) {
    hint = 'API Key 无效或已过期，请在设置中检查该 Provider 的密钥。';
  } else if (status === 403) {
    hint = '无权访问该模型，可能是密钥权限不足或需要开通服务。';
  } else if (status === 404) {
    hint = '接口地址或模型名不存在，请检查 API 地址与模型列表。';
  } else if (status === 429) {
    hint = '触发限流，请降低频率或稍后重试。';
  } else if (status === 400 && /max_tokens|context|length/i.test(msg)) {
    hint = '请求参数超出模型限制（常见为输出长度或上下文超限），请在设置中调小「最大输出」。';
  } else if (status === 400 && /parameter|not supported|unsupported/i.test(msg)) {
    hint = '该模型不支持当前发送的某个参数，请在设置中关闭对应参数开关。';
  } else if (status === 400 && /tool/i.test(msg)) {
    hint = '模型拒绝了工具调用定义，请尝试切换模型或关闭 Agent 模式。';
  } else if (status >= 500) {
    hint = '服务端异常，通常是临时故障，可重试。';
  } else if (/network|fetch|load failed/i.test(msg)) {
    retryable = true;
    hint = '网络请求失败，请检查网络或 API 地址。';
  }

  return new LLMError(msg, { status, code, param: body?.param, retryable, hint, raw: body?.raw, ...ctx });
}

export function isAbortError(e) {
  return e?.name === 'AbortError' || e?.code === 20;
}

/** 指数退避 + 抖动 */
export function backoffDelay(attempt, base = 800, cap = 12000) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return exp * (0.7 + Math.random() * 0.6);
}

/**
 * 带重试的调用包装。
 * @param {Function} fn  (attempt) => Promise
 * @param {object} opts  {retries, signal, onRetry}
 */
export async function withRetry(fn, opts = {}) {
  const maxRetries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn(attempt);
    } catch (e) {
      if (isAbortError(e)) throw e;
      lastErr = e;
      if (!e.retryable || attempt === maxRetries) break;
      if (opts.onRetry) opts.onRetry(e, attempt + 1);
      await new Promise((res, rej) => {
        const t = setTimeout(res, backoffDelay(attempt));
        opts.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    }
  }
  throw lastErr;
}

/** 把错误转成用户可读文案 */
export function describeError(e) {
  if (!e) return '未知错误';
  if (isAbortError(e)) return '请求已中止';
  if (e instanceof LLMError) {
    return e.hint ? `${e.message}\n${e.hint}` : e.message;
  }
  return e.message || String(e);
}
