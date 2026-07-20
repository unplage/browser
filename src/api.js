import { getSetting, setSetting } from './db.js';

const DEFAULT_PROVIDERS = [
  {
    id: 'zhipu', name: '智谱 GLM',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '',
    defaultModel: 'glm-4.7-flash',
    models: ['glm-4.7-flash', 'glm-4.6v-flash'],
    params: {
      temperature: { supported: true, default: 1.0, type: 'range', min: 0, max: 2, step: 0.1 },
      top_p: { supported: true, default: 0.95, type: 'range', min: 0.01, max: 1, step: 0.05 },
      max_tokens: { supported: true, default: 131072, type: 'number' },
      thinking: { supported: true, default: true, type: 'boolean' },
      do_sample: { supported: true, default: true, type: 'boolean' },
    }, order: 0,
  },
  {
    id: 'deepseek', name: 'DeepSeek',
    apiBase: 'https://api.deepseek.com', apiKey: '',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    params: {
      temperature: { supported: true, default: 1.0, type: 'range', min: 0, max: 2, step: 0.1 },
      top_p: { supported: true, default: 1, type: 'range', min: 0.01, max: 1, step: 0.05 },
      max_tokens: { supported: true, default: 8192, type: 'number' },
      thinking: { supported: true, default: true, type: 'boolean' },
      reasoning_effort: { supported: true, default: 'high', type: 'select', options: ['high', 'max'] },
    }, order: 1,
  },
  {
    id: 'openai', name: 'OpenAI',
    apiBase: 'https://api.openai.com/v1', apiKey: '',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini'],
    params: {
      temperature: { supported: true, default: 1.0, type: 'range', min: 0, max: 2, step: 0.1 },
      top_p: { supported: true, default: 1, type: 'range', min: 0.01, max: 1, step: 0.05 },
      max_tokens: { supported: true, default: 4096, type: 'number' },
    }, order: 2,
  },
];

const BUILTIN_IDS = ['zhipu', 'deepseek', 'openai'];

/* ─── Provider management ─── */
export async function getProviders() {
  let stored = await getSetting('providers');
  if (stored) {
    return JSON.parse(stored);
  }
  const providers = DEFAULT_PROVIDERS.map(p => JSON.parse(JSON.stringify(p)));
  const oldKey = await getSetting('apiKey');
  if (oldKey) {
    const z = providers.find(p => p.id === 'zhipu');
    if (z) {
      z.apiKey = oldKey;
      const oldBase = await getSetting('apiBase');
      const oldModel = await getSetting('defaultModel');
      if (oldBase) z.apiBase = oldBase;
      if (oldModel) z.defaultModel = oldModel;
      const oldTemp = await getSetting('temperature');
      const oldTopP = await getSetting('topP');
      const oldDoSample = await getSetting('doSample');
      if (oldTemp !== null) z.params.temperature.stored = parseFloat(oldTemp);
      if (oldTopP !== null) z.params.top_p.stored = parseFloat(oldTopP);
      if (oldDoSample !== null) z.params.do_sample.stored = oldDoSample === 'true';
    }
  }
  await setSetting('providers', JSON.stringify(providers));
  return providers;
}

export async function saveProviders(providers) {
  await setSetting('providers', JSON.stringify(providers));
}

export async function getProvider(id) {
  const providers = await getProviders();
  return providers.find(p => p.id === id) || providers[0];
}

export function isBuiltinProvider(id) {
  return BUILTIN_IDS.includes(id);
}

export function getBuiltinProviders() {
  return DEFAULT_PROVIDERS;
}

async function getApiKey() {
  const providers = await getProviders();
  const first = providers.find(p => p.apiKey);
  return first?.apiKey || null;
}

export async function checkApiKey() {
  return !!(await getApiKey());
}

function nowContext() {
  const d = new Date();
  return `当前日期和时间: ${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}（${d.toLocaleDateString('zh-CN', {weekday:'long'})}）。`;
}

/* ─── Request body builder ─── */
function buildRequestBody(provider, opts = {}) {
  const model = opts.model || provider.defaultModel;
  const body = {
    model,
    messages: opts.messages,
    stream: !!opts.stream,
  };
  for (const [key, config] of Object.entries(provider.params)) {
    if (!config.supported) continue;
    let value;
    if (opts[key] !== undefined) {
      value = opts[key];
    } else if (config.stored !== undefined) {
      value = config.stored;
    } else {
      value = config.default;
    }
    if (value === null || value === undefined) continue;
    if (key === 'thinking') {
      if (provider.id === 'zhipu') {
        body.thinking = value ? { type: 'enabled' } : { type: 'disabled' };
      } else {
        body.thinking = !!value;
      }
    } else {
      body[key] = value;
    }
  }
  if (opts.webSearch) {
    body.tools = [{
      type: 'web_search',
      web_search: { enable: true, search_query: opts.searchQuery || '' },
    }];
  }
  return body;
}

async function request(messages, opts = {}) {
  let providerId = opts.providerId;
  if (!providerId) {
    const all = await getProviders();
    const firstWithKey = all.find(p => p.apiKey);
    providerId = firstWithKey?.id || 'zhipu';
  }
  const provider = await getProvider(providerId);
  if (!provider.apiKey) throw new Error('请在设置中配置 API Key');
  const body = buildRequestBody(provider, { ...opts, messages });
  const res = await fetch(`${provider.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    let msg = `API ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

export async function callGLM(messages, opts = {}) {
  if (opts.stream) {
    const res = await request(messages, { ...opts });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    const onChunk = opts.onChunk || (() => {});
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            full += content;
            onChunk(content, full);
          }
        } catch {}
      }
    }
    return full;
  }
  const res = await request(messages, opts);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const SEARCH_SYSTEM_PROMPT = () =>
`${nowContext()}

你是一位深度分析专家，擅长结合 web_search 的实时信息与自身的知识库进行综合分析。

回答策略：
1. **综合结论** — 融合网络最新信息与自身知识储备，给出最全面准确的回答，标注可信度（高/中/低）
2. **关键发现** — 分点列出，每点标注：该信息来自网络搜索结果还是模型知识库
3. **知识对比** — 如果网络信息与模型训练知识存在差异，分析差异原因（时间差、视角不同等）
4. **分歧与争议** — 列出不同观点并分析各方依据
5. **信息来源** — 列出参考来源及可信度评估

要求：
- 网络搜索结果作为最新事实依据，模型知识库提供背景和上下文
- 明确标注信息来源类型：「网络搜索」或「知识库」
- 当网络信息覆盖不全面时，主动调用知识库补充
- 区分确凿事实、合理推断与有待验证的信息
- 不确定的内容明确说明`;

export async function searchWithAnalysis(query) {
  return await callGLM(
    [
      { role: 'system', content: SEARCH_SYSTEM_PROMPT() },
      { role: 'user', content: `【需要联网搜索】请搜索以下内容并提供分析：${query}` },
    ],
    { webSearch: true, searchQuery: query }
  );
}

const FILE_ANALYSIS_PROMPT = () =>
`${nowContext()}

你是一位多学科分析专家。

请按以下结构分析文件内容：
1. **核心摘要** — 用 100-200 字概括核心内容
2. **关键信息** — 提取重要数据、事实和观点
3. **结构分析** — 分析逻辑结构和论证方式
4. **亮点与局限** — 指出优点和可能的局限性
5. **延伸思考** — 提供相关背景知识或扩展观点`;

export async function analyzeFile(content, fileName) {
  return await callGLM([
    { role: 'system', content: FILE_ANALYSIS_PROMPT() },
    { role: 'user', content: `文件名: ${fileName}\n\n内容:\n${content}` },
  ]);
}

export async function chatWithModule(systemPrompt, messages, onChunk, opts = {}) {
  const dateContext = nowContext();
  let finalMessages = [{ role: 'system', content: `${dateContext}\n\n${systemPrompt}` }];
  let msgCopy = messages;
  if (opts.imageData && opts.model?.toLowerCase().includes('v')) {
    const last = msgCopy[msgCopy.length - 1];
    if (last && last.role === 'user') {
      msgCopy = msgCopy.slice(0, -1);
      msgCopy.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: opts.imageData } },
          { type: 'text', text: last.content },
        ],
      });
    }
  }
  if (opts.webSearch) {
    const enhancedSystemPrompt = `${dateContext}\n\n${systemPrompt}\n\n你已经通过 web_search 工具获取了最新的联网搜索结果。请将网络搜索到的实时信息与你的训练知识相结合来回答用户的问题。对于时效性强的内容优先采用网络搜索结果，对于背景知识和理论分析可以充分运用你的知识库。请在回答中适当标注信息来源是「网络搜索」还是「知识库」。`;
    finalMessages = [{ role: 'system', content: enhancedSystemPrompt }, ...msgCopy];
  } else {
    finalMessages = [{ role: 'system', content: `${dateContext}\n\n${systemPrompt}` }, ...msgCopy];
  }
  return await callGLM(
    finalMessages,
    { stream: true, onChunk, model: opts.model, signal: opts.signal, webSearch: opts.webSearch, searchQuery: opts.searchQuery, providerId: opts.providerId }
  );
}
