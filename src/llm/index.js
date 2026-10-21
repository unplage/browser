import { getProvider, getProviders } from './providers.js';
import { getProtocol } from './protocols.js';
import { negotiateParams, contextWindow } from './params.js';
import { normalizeError, withRetry, isAbortError, LLMError } from './errors.js';
import { resolveModel } from './catalog.js';

/* ─── LLM 统一入口 ─── */

function pickModel(provider, modelId) {
  if (modelId) return modelId;
  if (provider.defaultModel) return provider.defaultModel;
  return provider.models?.[0] || '';
}

/** 组装原生搜索工具（仅 OpenAI 协议族可携带智谱式 web_search 工具） */
function nativeSearchTool(provider, query) {
  const s = provider.search;
  if (!s || s.mode === 'none') return null;
  if (provider.protocol !== 'openai') return null;
  if (provider.id !== 'zhipu' && s.mode !== 'native') return null;
  return {
    type: 'web_search',
    web_search: {
      enable: true,
      search_engine: s.engine || 'search_std',
      search_result: true,
      count: s.count || 5,
      search_query: String(query || '').slice(0, 70),
    },
  };
}

/**
 * 非流式对话
 * @param {Array} messages 统一消息格式
 * @param {object} opts { providerId, model, signal, tools, temperature, max_tokens, webSearch, onNote }
 */
export async function chat(messages, opts = {}) {
  const provider = await getProvider(opts.providerId);
  if (!provider) throw new LLMError('未找到任何 Provider，请先在设置中配置。');
  if (!provider.apiKey && !opts.allowNoKey) {
    throw new LLMError(`Provider「${provider.name}」未配置 API Key。`, { providerId: provider.id });
  }
  const protocol = getProtocol(provider.protocol);
  const model = pickModel(provider, opts.model);
  const { params, notes } = negotiateParams(provider, model, opts);
  notes.forEach(n => opts.onNote?.(n));

  const extraTools = [];
  if (opts.webSearch) {
    const t = nativeSearchTool(provider, opts.searchQuery || messages[messages.length - 1]?.content);
    if (t) extraTools.push(t);
  }

  const req = protocol.buildRequest({
    provider, model, params, messages,
    tools: [...(opts.tools || []), ...extraTools.map(x => ({
      name: '__web_search__', description: 'search', parameters: { type: 'object', properties: {}, required: [] },
    }))].length ? (opts.tools || []) : [],
    stream: false,
  });
  if (extraTools.length) req.body.tools = [...(req.body.tools || []), ...extraTools];

  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const parsed = protocol.parseError(res.status, text);
    throw normalizeError(parsed.status, parsed, { providerId: provider.id, model });
  }
  const json = await res.json();
  const out = protocol.parseResponse(json);
  if (Array.isArray(json?.web_search)) {
    out.searchResults = json.web_search.map(r => ({
      title: r.title || '', link: r.link || '', snippet: r.content || '',
      source: r.media || '', date: r.publish_date || '',
    }));
  }
  return { ...out, providerId: provider.id, model, notes };
}

/**
 * 流式对话
 * @param {Array} messages
 * @param {object} opts
 *   onText(chunk, full) onReasoning(chunk, full) onToolCall(tc) onUsage(u) onNote(n)
 */
export async function streamChat(messages, opts = {}) {
  const provider = await getProvider(opts.providerId);
  if (!provider) throw new LLMError('未找到任何 Provider，请先在设置中配置。');
  if (!provider.apiKey) throw new LLMError(`Provider「${provider.name}」未配置 API Key。`, { providerId: provider.id });

  const protocol = getProtocol(provider.protocol);
  const model = pickModel(provider, opts.model);
  const { params, notes } = negotiateParams(provider, model, opts);
  notes.forEach(n => opts.onNote?.(n));

  const extraTools = [];
  if (opts.webSearch) {
    const t = nativeSearchTool(provider, opts.searchQuery || lastUserText(messages));
    if (t) extraTools.push(t);
  }

  const req = protocol.buildRequest({
    provider, model, params, messages,
    tools: opts.tools || [],
    stream: true,
  });
  if (extraTools.length) req.body.tools = [...(req.body.tools || []), ...extraTools];

  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const parsed = protocol.parseError(res.status, text);
    throw normalizeError(parsed.status, parsed, { providerId: provider.id, model });
  }
  if (!res.body) throw new LLMError('响应不支持流式读取。', { providerId: provider.id });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = protocol.createParser();

  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = 'stop';
  const toolCalls = new Map();

  const handle = (ev) => {
    if (ev.type === 'text') {
      content += ev.text;
      opts.onText?.(ev.text, content);
    } else if (ev.type === 'reasoning') {
      reasoning += ev.text;
      opts.onReasoning?.(ev.text, reasoning);
    } else if (ev.type === 'tool_call_delta') {
      toolCalls.set(ev.index, { index: ev.index, id: ev.id, name: ev.name, argsText: ev.argsText });
    } else if (ev.type === 'tool_call') {
      toolCalls.set(ev.index, { index: ev.index, id: ev.id, name: ev.name, args: ev.args });
      opts.onToolCall?.({ id: ev.id, name: ev.name, args: ev.args });
    } else if (ev.type === 'usage') {
      usage = ev.usage;
      opts.onUsage?.(ev.usage);
    } else if (ev.type === 'done') {
      finishReason = ev.finishReason;
    } else if (ev.type === 'error') {
      opts.onNote?.(`流式错误: ${ev.error?.message || 'unknown'}`);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (parser.events.length) {
        const evs = parser.events.splice(0, parser.events.length);
        evs.forEach(handle);
      }
    }
    parser.flush?.();
    const tail = parser.flushEvents?.() || [];
    tail.forEach(handle);
    const leftover = parser.events.splice(0, parser.events.length);
    leftover.forEach(handle);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw normalizeError(0, { message: e.message }, { providerId: provider.id, model });
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const calls = [...toolCalls.values()].map((t, i) => ({
    id: t.id || `call_${i}`,
    name: t.name,
    args: t.args ?? safeJson(t.argsText),
  })).filter(t => t.name);

  return {
    content, reasoning, toolCalls: calls, usage, finishReason,
    providerId: provider.id, model, notes,
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      const t = m.content.filter(p => p.type === 'text').map(p => p.text).join(' ');
      if (t) return t;
    }
  }
  return '';
}

/**
 * 带重试的流式调用
 */
export async function streamChatWithRetry(messages, opts = {}) {
  return withRetry(() => streamChat(messages, opts), {
    retries: opts.retries ?? 2,
    signal: opts.signal,
    onRetry: (e, n) => opts.onNote?.(`第 ${n} 次重试：${e.message}`),
  });
}

/**
 * 生成 Embedding（用于 RAG 向量检索）
 */
export async function embed(texts, opts = {}) {
  const provider = await getProvider(opts.providerId);
  if (!provider) throw new LLMError('未找到 Provider，无法生成向量。');
  if (!provider.apiKey) throw new LLMError(`Provider「${provider.name}」未配置 API Key。`);
  const model = opts.model || provider.embeddingModel || defaultEmbeddingModel(provider);
  if (!model) throw new LLMError('未配置 Embedding 模型，可在设置中为该 Provider 指定。');

  if (provider.protocol === 'gemini') {
    const base = provider.apiBase.replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:batchEmbedContents`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey },
      body: JSON.stringify({ requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }),
      signal: opts.signal,
    });
    if (!res.ok) throw new LLMError(`Embedding 失败: HTTP ${res.status}`, { status: res.status });
    const json = await res.json();
    return { vectors: (json.embeddings || []).map(e => e.values || []), model, providerId: provider.id };
  }

  const url = `${provider.apiBase.replace(/\/+$/, '')}/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model, input: texts }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new LLMError(`Embedding 失败: ${t.slice(0, 300)}`, { status: res.status, providerId: provider.id });
  }
  const json = await res.json();
  return {
    vectors: (json.data || []).map(d => d.embedding || []),
    model,
    providerId: provider.id,
    usage: json.usage ? { prompt: json.usage.prompt_tokens, total: json.usage.total_tokens } : null,
  };
}

function defaultEmbeddingModel(provider) {
  const map = {
    openai: 'text-embedding-3-small',
    zhipu: 'embedding-3',
    gemini: 'text-embedding-004',
    siliconflow: 'BAAI/bge-m3',
    dashscope: 'text-embedding-v3',
    deepseek: null,
    ollama: 'nomic-embed-text',
  };
  return map[provider.id] ?? null;
}

/**
 * 列出远端模型（OpenAI 兼容接口）
 */
export async function listModels(providerId, opts = {}) {
  const provider = await getProvider(providerId);
  if (!provider) throw new LLMError('未找到 Provider');
  if (!provider.apiKey) throw new LLMError('该 Provider 未配置 API Key');
  if (provider.protocol === 'gemini') {
    const base = provider.apiBase.replace(/\/+$/, '');
    const res = await fetch(`${base}/models?pageSize=100`, {
      headers: { 'x-goog-api-key': provider.apiKey },
      signal: opts.signal,
    });
    if (!res.ok) throw new LLMError(`拉取模型失败: HTTP ${res.status}`, { status: res.status });
    const json = await res.json();
    return (json.models || []).map(m => m.name?.replace(/^models\//, '')).filter(Boolean);
  }
  const url = `${provider.apiBase.replace(/\/+$/, '')}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
    signal: opts.signal,
  });
  if (!res.ok) throw new LLMError(`拉取模型失败: HTTP ${res.status}`, { status: res.status });
  const json = await res.json();
  return (json.data || []).map(m => m.id).filter(Boolean);
}

/**
 * 连通性测试：发一个极短的请求，验证 Key / 地址 / 模型是否可用。
 */
export async function testProvider(providerId, opts = {}) {
  const provider = await getProvider(providerId);
  if (!provider) return { ok: false, message: '未找到 Provider' };
  if (!provider.apiKey) return { ok: false, message: '未配置 API Key' };
  const model = opts.model || pickModel(provider);
  if (!model) return { ok: false, message: '未指定模型' };
  const started = Date.now();
  try {
    const out = await chat(
      [{ role: 'user', content: 'ping' }],
      { providerId: provider.id, model, max_tokens: 16, allowNoKey: false, signal: opts.signal },
    );
    return {
      ok: true,
      message: `连接正常（${Date.now() - started}ms）`,
      model: out.model,
      reply: out.content?.slice(0, 120) || '(空回复)',
    };
  } catch (e) {
    return { ok: false, message: e.message, hint: e.hint || null, status: e.status || null };
  }
}

/** 供 UI 展示：某 provider+model 的能力摘要 */
export function describeModel(provider, modelId) {
  const m = resolveModel(modelId, provider?.modelHints?.[modelId]);
  const ctx = contextWindow(provider, modelId);
  return {
    id: m.id,
    context: ctx,
    maxOutput: m.maxOutput,
    vision: m.vision,
    tools: m.tools,
    reasoning: m.reasoning,
    paramStyle: m.paramStyle,
    known: m.source === 'catalog',
  };
}

export async function listAllProviders() {
  return getProviders();
}

export { getProvider, getProviders };
