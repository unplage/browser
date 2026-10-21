/* ─── LLM 协议适配层 ───
 * 每种协议实现 4 件事：
 *   1. buildRequest  —— 拼 URL / headers / body
 *   2. parseResponse —— 解析非流式响应
 *   3. createParser  —— 解析流式 SSE，产出统一事件
 *   4. parseError    —— 归一化错误
 *
 * 统一流式事件：
 *   {type:'text', text}
 *   {type:'reasoning', text}
 *   {type:'tool_call', index, id, name, args}
 *   {type:'tool_call_delta', index, id, name, argsText}
 *   {type:'usage', usage}
 *   {type:'done', finishReason}
 */

/* ─── SSE 基础解析 ─── */
function createSseSplitter(onEvent) {
  let buf = '';
  let eventName = '';
  return {
    push(text) {
      buf += text;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line) { eventName = ''; continue; }
        if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue; }
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          onEvent(data, eventName);
        }
      }
    },
    flush() {
      if (buf.trim()) {
        const line = buf.trim().replace(/\r$/, '');
        if (line.startsWith('data:')) onEvent(line.slice(5).trim(), eventName);
      }
      buf = '';
      eventName = '';
    },
  };
}

function parseJsonSafe(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function normUsage(u) {
  if (!u) return null;
  return {
    prompt: u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0,
    completion: u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0,
    total: u.total_tokens ?? u.totalTokenCount ?? ((u.prompt_tokens || u.input_tokens || 0) + (u.completion_tokens || u.output_tokens || 0)),
    cached: u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? 0,
  };
}

function normToolCalls(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t, i) => ({
    id: t.id || `call_${i}_${Date.now().toString(36)}`,
    name: t.function?.name || t.name || 'unknown',
    args: t.function?.arguments ?? t.arguments ?? t.input ?? {},
  }));
}

function safeParseArgs(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  const parsed = parseJsonSafe(raw);
  if (parsed && typeof parsed === 'object') return parsed;
  return { _raw: String(raw) };
}

/* ─── OpenAI 兼容协议 ─── */
const openai = {
  id: 'openai',
  label: 'OpenAI 兼容',
  supportsNativeTools: true,
  supportsImages: true,
  defaultBase: 'https://api.openai.com/v1',
  buildRequest({ provider, model, params, messages, tools, stream }) {
    const url = `${provider.apiBase.replace(/\/+$/, '')}/chat/completions`;
    const body = { model, messages, stream: !!stream, ...params };
    if (tools?.length) {
      body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    return {
      url,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
      body,
    };
  },
  parseResponse(json) {
    const choice = json?.choices?.[0];
    const msg = choice?.message || {};
    const reasoning = msg.reasoning_content || msg.reasoning || choice?.delta?.reasoning_content || '';
    return {
      content: typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : ''),
      reasoning,
      toolCalls: normToolCalls(msg.tool_calls),
      usage: normUsage(json?.usage),
      finishReason: choice?.finish_reason || 'stop',
      raw: json,
    };
  },
  createParser() {
    const acc = new Map();
    const splitter = createSseSplitter((data) => {
      if (!data || data === '[DONE]') return;
      const json = parseJsonSafe(data);
      if (!json) return;
      const choice = json.choices?.[0];
      const delta = choice?.delta || {};
      if (delta.reasoning_content || delta.reasoning) {
        splitter.events.push({ type: 'reasoning', text: delta.reasoning_content || delta.reasoning });
      }
      if (delta.content) {
        const t = typeof delta.content === 'string' ? delta.content : (Array.isArray(delta.content) ? delta.content.map(p => p.text || '').join('') : '');
        if (t) splitter.events.push({ type: 'text', text: t });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = acc.get(idx) || { index: idx, id: '', name: '', argsText: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.argsText += tc.function.arguments;
          acc.set(idx, cur);
          splitter.events.push({
            type: 'tool_call_delta', index: idx, id: cur.id, name: cur.name, argsText: cur.argsText,
          });
        }
      }
      if (json.usage) splitter.events.push({ type: 'usage', usage: normUsage(json.usage) });
      if (choice?.finish_reason) splitter.events.push({ type: 'done', finishReason: choice.finish_reason });
    });
    splitter.events = [];
    splitter.flushEvents = () => {
      for (const [index, cur] of acc) {
        splitter.events.push({
          type: 'tool_call', index, id: cur.id || `call_${index}`,
          name: cur.name, args: safeParseArgs(cur.argsText),
        });
      }
      acc.clear();
      return splitter.events;
    };
    return splitter;
  },
  parseError(status, text) {
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const e = json?.error || json;
    return {
      message: e?.message || text?.slice(0, 500) || `HTTP ${status}`,
      code: e?.code || e?.type || json?.code || null,
      param: e?.param || null,
      status,
    };
  },
};

/* ─── Anthropic 协议 ─── */
const anthropic = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  supportsNativeTools: true,
  supportsImages: true,
  defaultBase: 'https://api.anthropic.com/v1',
  buildRequest({ provider, model, params, messages, tools, stream }) {
    const url = `${provider.apiBase.replace(/\/+$/, '')}/messages`;
    const systemParts = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');

    const conv = [];
    for (const m of rest) {
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
        const last = conv[conv.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
        else conv.push({ role: 'user', content: [block] });
        continue;
      }
      let content;
      if (m.role === 'assistant' && m.tool_calls?.length) {
        content = m.tool_calls.map(tc => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input: safeParseArgs(tc.function?.arguments ?? tc.args),
        }));
      } else if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content.map(p => {
          if (p.type === 'text') return { type: 'text', text: p.text || '' };
          if (p.type === 'image_url') {
            const url = String(p.image_url?.url || '');
            const m2 = url.match(/^data:([^;]+);base64,(.*)$/);
            if (m2) return { type: 'image', source: { type: 'base64', media_type: m2[1], data: m2[2] } };
            return { type: 'image', source: { type: 'url', url } };
          }
          if (p.type === 'thinking') return { type: 'thinking', thinking: p.thinking || '' };
          return { type: 'text', text: String(p.text || '') };
        });
      } else content = '';
      conv.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
    }

    const body = {
      model,
      messages: conv,
      max_tokens: params.max_tokens ?? params.maxOutputTokens ?? 4096,
      stream: !!stream,
    };
    delete body.maxOutputTokens;
    if (systemParts.length) {
      body.system = systemParts.map(s => (typeof s.content === 'string' ? s.content : JSON.stringify(s.content))).join('\n\n');
    }
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.top_p !== undefined) body.top_p = params.top_p;
    if (params.thinking) body.thinking = params.thinking;
    if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort;
    if (params.stop_sequences) body.stop_sequences = params.stop_sequences;
    if (tools?.length) {
      body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        ...(provider.headers || {}),
      },
      body,
    };
  },
  parseResponse(json) {
    const blocks = json?.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
    const reasoning = blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('');
    const toolCalls = blocks
      .filter(b => b.type === 'tool_use')
      .map((b, i) => ({ id: b.id || `call_${i}`, name: b.name, args: b.input || {} }));
    return {
      content: text,
      reasoning,
      toolCalls,
      usage: normUsage(json?.usage),
      finishReason: json?.stop_reason || 'stop',
      raw: json,
    };
  },
  createParser() {
    const blocks = new Map();
    const splitter = createSseSplitter((data, evName) => {
      const json = parseJsonSafe(data);
      if (!json) return;
      const type = json.type || evName;
      if (type === 'content_block_start') {
        const cb = json.content_block || {};
        if (cb.type === 'tool_use') {
          blocks.set(json.index, { id: cb.id, name: cb.name, argsText: '' });
        }
      } else if (type === 'content_block_delta') {
        const d = json.delta || {};
        if (d.type === 'text_delta' && d.text) splitter.events.push({ type: 'text', text: d.text });
        else if (d.type === 'thinking_delta' && d.thinking) splitter.events.push({ type: 'reasoning', text: d.thinking });
        else if (d.type === 'input_json_delta' && d.partial_json !== undefined) {
          const cur = blocks.get(json.index) || { id: `call_${json.index}`, name: '', argsText: '' };
          cur.argsText += d.partial_json;
          blocks.set(json.index, cur);
          splitter.events.push({ type: 'tool_call_delta', index: json.index, id: cur.id, name: cur.name, argsText: cur.argsText });
        }
      } else if (type === 'message_start') {
        const u = json.message?.usage;
        if (u) splitter.events.push({ type: 'usage', usage: normUsage(u) });
      } else if (type === 'message_delta') {
        if (json.usage) splitter.events.push({ type: 'usage', usage: normUsage(json.usage) });
        if (json.delta?.stop_reason) splitter.events.push({ type: 'done', finishReason: json.delta.stop_reason });
      } else if (type === 'error') {
        splitter.events.push({ type: 'error', error: { message: json.error?.message || 'unknown error', code: json.error?.type } });
      }
    });
    splitter.events = [];
    splitter.flushEvents = () => {
      for (const [index, cur] of blocks) {
        splitter.events.push({ type: 'tool_call', index, id: cur.id || `call_${index}`, name: cur.name, args: safeParseArgs(cur.argsText) });
      }
      blocks.clear();
      return splitter.events;
    };
    return splitter;
  },
  parseError(status, text) {
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const e = json?.error || json;
    return {
      message: e?.message || text?.slice(0, 500) || `HTTP ${status}`,
      code: e?.type || e?.code || null,
      status,
    };
  },
};

/* ─── Gemini 协议 ─── */
const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  supportsNativeTools: true,
  supportsImages: true,
  defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
  buildRequest({ provider, model, messages, tools, stream }) {
    const base = provider.apiBase.replace(/\/+$/, '');
    const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${base}/models/${encodeURIComponent(model)}:${action}`;
    const sys = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');
    const contents = [];
    for (const m of rest) {
      let parts;
      let role = m.role === 'assistant' ? 'model' : 'user';
      if (m.role === 'tool') {
        parts = [{ functionResponse: { name: m.name || 'tool', response: { result: String(m.content ?? '') } } }];
        role = 'user';
      } else if (m.role === 'assistant' && m.tool_calls?.length) {
        parts = m.tool_calls.map(tc => ({
          functionCall: { name: tc.function?.name || tc.name, args: safeParseArgs(tc.function?.arguments ?? tc.args) },
        }));
      } else if (typeof m.content === 'string') {
        parts = [{ text: m.content }];
      } else if (Array.isArray(m.content)) {
        parts = m.content.map(p => {
          if (p.type === 'text') return { text: p.text || '' };
          if (p.type === 'image_url') {
            const url2 = String(p.image_url?.url || '');
            const m3 = url2.match(/^data:([^;]+);base64,(.*)$/);
            if (m3) return { inline_data: { mime_type: m3[1], data: m3[2] } };
            return { file_data: { file_uri: url2 } };
          }
          return { text: String(p.text || '') };
        });
      } else parts = [{ text: '' }];
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    const body = { contents };
    if (sys.length) body.systemInstruction = { parts: [{ text: sys.map(s => s.content).join('\n\n') }] };
    const gc = {};
    if (params.temperature !== undefined) gc.temperature = params.temperature;
    if (params.top_p !== undefined) gc.topP = params.top_p;
    if (params.max_tokens !== undefined) gc.maxOutputTokens = params.max_tokens;
    if (params.thinking) gc.thinkingConfig = { includeThoughts: true };
    if (Object.keys(gc).length) body.generationConfig = gc;
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    return {
      url,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey, ...(provider.headers || {}) },
      body,
    };
  },
  parseResponse(json) {
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter(p => p.text).map(p => p.text).join('');
    const reasoning = parts.filter(p => p.thought).map(p => p.text).join('');
    const toolCalls = parts
      .filter(p => p.functionCall)
      .map((p, i) => ({ id: `call_${i}_${Date.now().toString(36)}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
    return {
      content: text,
      reasoning,
      toolCalls,
      usage: normUsage(json?.usageMetadata),
      finishReason: json?.candidates?.[0]?.finishReason || 'stop',
      raw: json,
    };
  },
  createParser() {
    const splitter = createSseSplitter((data) => {
      if (!data || data === '[DONE]') return;
      const json = parseJsonSafe(data);
      if (!json) return;
      const parts = json?.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.functionCall) {
          splitter.events.push({
            type: 'tool_call', index: splitter.events.length,
            id: `call_${Date.now().toString(36)}`, name: p.functionCall.name, args: p.functionCall.args || {},
          });
        } else if (p.thought && p.text) {
          splitter.events.push({ type: 'reasoning', text: p.text });
        } else if (p.text) {
          splitter.events.push({ type: 'text', text: p.text });
        }
      }
      if (json?.usageMetadata) splitter.events.push({ type: 'usage', usage: normUsage(json.usageMetadata) });
    });
    splitter.events = [];
    splitter.flushEvents = () => splitter.events;
    return splitter;
  },
  parseError(status, text) {
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const e = json?.error || json;
    return {
      message: e?.message || text?.slice(0, 500) || `HTTP ${status}`,
      code: e?.code || e?.status || null,
      status,
    };
  },
};

export const PROTOCOLS = { openai, anthropic, gemini };
export const PROTOCOL_LIST = Object.values(PROTOCOLS);

export function getProtocol(id) {
  return PROTOCOLS[id] || openai;
}

export { normUsage, safeParseArgs, createSseSplitter, parseJsonSafe };
