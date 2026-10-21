import { getSetting, setSetting } from '../db.js';
import { PARAM_SCHEMA } from './params.js';

/* ─── Provider 预设与管理 ─── */

function p(overrides) {
  return {
    id: 'custom',
    name: '自定义 Provider',
    protocol: 'openai',
    apiBase: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: '',
    models: [],
    params: {},
    capabilities: { vision: false, tools: true, webSearch: false },
    search: null,
    headers: {},
    modelHints: {},
    order: 0,
    ...overrides,
  };
}

function defaultParams(spec = {}) {
  const out = {};
  for (const [key, def] of Object.entries(PARAM_SCHEMA)) {
    out[key] = {
      supported: spec[key]?.supported ?? false,
      default: spec[key]?.default ?? def.default,
      type: def.type,
      ...(def.min !== undefined ? { min: def.min } : {}),
      ...(def.max !== undefined ? { max: def.max } : {}),
      ...(def.step !== undefined ? { step: def.step } : {}),
      ...(def.options ? { options: def.options } : {}),
      label: def.label,
    };
  }
  return out;
}

export const DEFAULT_PROVIDERS = [
  p({
    id: 'zhipu', name: '智谱 GLM', protocol: 'openai',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7-flash',
    models: ['glm-4.7-flash', 'glm-4.7', 'glm-5.3', 'glm-5.2', 'glm-4.6v-flash', 'glm-4.6', 'glm-4.5-air'],
    capabilities: { vision: true, tools: true, webSearch: true },
    search: { mode: 'native', engine: 'search_std', count: 5, recency: 'noLimit' },
    params: defaultParams({
      temperature: { supported: true, default: 1.0 },
      top_p: { supported: true, default: 0.95 },
      max_tokens: { supported: true, default: 8192 },
      thinking: { supported: true, default: true },
      reasoning_effort: { supported: true, default: 'high' },
    }),
    order: 0,
  }),
  p({
    id: 'deepseek', name: 'DeepSeek', protocol: 'openai',
    apiBase: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 1.0 },
      top_p: { supported: true, default: 0.95 },
      max_tokens: { supported: true, default: 8192 },
      thinking: { supported: true, default: true },
      reasoning_effort: { supported: true, default: 'high' },
    }),
    order: 1,
  }),
  p({
    id: 'openai', name: 'OpenAI', protocol: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'o3', 'o3-mini', 'o4-mini'],
    capabilities: { vision: true, tools: true, webSearch: true },
    search: { mode: 'native', engine: 'web_search_preview', count: 5, recency: 'noLimit' },
    params: defaultParams({
      temperature: { supported: true, default: 1.0 },
      top_p: { supported: true, default: 1 },
      max_tokens: { supported: true, default: 4096 },
      reasoning_effort: { supported: true, default: 'medium' },
    }),
    order: 2,
  }),
  p({
    id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic',
    apiBase: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest'],
    capabilities: { vision: true, tools: true, webSearch: true },
    search: { mode: 'native', engine: 'web_search', count: 5, recency: 'noLimit' },
    params: defaultParams({
      temperature: { supported: true, default: 1.0 },
      top_p: { supported: true, default: 1 },
      max_tokens: { supported: true, default: 8192 },
      thinking: { supported: true, default: false },
    }),
    order: 3,
  }),
  p({
    id: 'gemini', name: 'Google Gemini', protocol: 'gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    capabilities: { vision: true, tools: true, webSearch: true },
    search: { mode: 'native', engine: 'google_search', count: 5, recency: 'noLimit' },
    params: defaultParams({
      temperature: { supported: true, default: 1.0 },
      top_p: { supported: true, default: 0.95 },
      max_tokens: { supported: true, default: 8192 },
    }),
    order: 4,
  }),
  p({
    id: 'moonshot', name: '月之暗面 Kimi', protocol: 'openai',
    apiBase: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-turbo-preview',
    models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'moonshot-v1-128k'],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 1 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 5,
  }),
  p({
    id: 'dashscope', name: '阿里百炼 Qwen', protocol: 'openai',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-max',
    models: ['qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen2.5-vl-72b-instruct'],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 0.8 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 6,
  }),
  p({
    id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'openai',
    apiBase: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen3-235B-A22B',
    models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat', 'BAAI/bge-m3'],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 0.8 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 7,
  }),
  p({
    id: 'groq', name: 'Groq', protocol: 'openai',
    apiBase: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    capabilities: { vision: false, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 1 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 8,
  }),
  p({
    id: 'ollama', name: '本地 Ollama', protocol: 'openai',
    apiBase: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:8b',
    models: [],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 0.9 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 9,
  }),
  p({
    id: 'lmstudio', name: '本地 LM Studio', protocol: 'openai',
    apiBase: 'http://localhost:1234/v1',
    defaultModel: '',
    models: [],
    capabilities: { vision: true, tools: true, webSearch: false },
    params: defaultParams({
      temperature: { supported: true, default: 0.7 },
      top_p: { supported: true, default: 0.9 },
      max_tokens: { supported: true, default: 4096 },
    }),
    order: 10,
  }),
];

export const BUILTIN_IDS = DEFAULT_PROVIDERS.map(x => x.id);

export function isBuiltinProvider(id) {
  return BUILTIN_IDS.includes(id);
}

export function getBuiltinProviders() {
  return DEFAULT_PROVIDERS;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function normalizeProvider(raw) {
  const base = DEFAULT_PROVIDERS.find(x => x.id === raw.id);
  const p2 = {
    ...clone(base || DEFAULT_PROVIDERS[0]),
    ...raw,
    params: { ...clone((base || DEFAULT_PROVIDERS[0]).params), ...(raw.params || {}) },
    capabilities: { ...(base?.capabilities || { vision: false, tools: true, webSearch: false }), ...(raw.capabilities || {}) },
    headers: raw.headers || {},
    modelHints: raw.modelHints || {},
  };
  if (!p2.protocol) p2.protocol = 'openai';
  if (!Array.isArray(p2.models)) p2.models = [];
  for (const [key, def] of Object.entries(PARAM_SCHEMA)) {
    if (!p2.params[key]) {
      p2.params[key] = { ...clone(def), supported: false };
    }
    const cfg = p2.params[key];
    cfg.type = cfg.type || def.type;
    if (def.min !== undefined && cfg.min === undefined) cfg.min = def.min;
    if (def.max !== undefined && cfg.max === undefined) cfg.max = def.max;
    if (def.step !== undefined && cfg.step === undefined) cfg.step = def.step;
    if (def.options && !cfg.options) cfg.options = def.options;
  }
  delete p2.params.do_sample;
  return p2;
}

/** 读取全部 Provider（自动完成旧格式迁移） */
export async function getProviders() {
  const stored = await getSetting('providers');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) {
        const list = parsed.map(normalizeProvider);
        await setSetting('providers', JSON.stringify(list));
        return list;
      }
    } catch (e) {
      console.warn('[providers] 解析失败，回落到默认预设:', e.message);
    }
  }

  const providers = clone(DEFAULT_PROVIDERS);

  /* 旧版单 Key 设置迁移 */
  const oldKey = await getSetting('apiKey');
  if (oldKey) {
    const z = providers.find(x => x.id === 'zhipu');
    if (z) {
      z.apiKey = oldKey;
      const oldBase = await getSetting('apiBase');
      const oldModel = await getSetting('defaultModel');
      if (oldBase) z.apiBase = oldBase;
      if (oldModel) z.defaultModel = oldModel;
      const oldTemp = await getSetting('temperature');
      const oldTopP = await getSetting('topP');
      if (oldTemp !== null) z.params.temperature.stored = parseFloat(oldTemp);
      if (oldTopP !== null) z.params.top_p.stored = parseFloat(oldTopP);
    }
  }

  await setSetting('providers', JSON.stringify(providers));
  return providers;
}

export async function saveProviders(providers) {
  const list = providers.map(normalizeProvider);
  await setSetting('providers', JSON.stringify(list));
  return list;
}

export async function getProvider(id) {
  const providers = await getProviders();
  return providers.find(p => p.id === id) || providers.find(p => p.apiKey) || providers[0] || null;
}

export async function getConfiguredProviders() {
  const providers = await getProviders();
  return providers.filter(p => p.apiKey);
}

/** 找一个支持某能力的已配置 Provider */
export async function findProviderByCapability(capability) {
  const providers = await getProviders();
  return providers.find(p => p.apiKey && p.capabilities?.[capability]) || null;
}

export function createProviderFromTemplate(templateId) {
  const t = DEFAULT_PROVIDERS.find(x => x.id === templateId);
  if (!t) return null;
  const fresh = clone(t);
  fresh.id = `${t.id}_${Date.now().toString(36)}`;
  fresh.name = `${t.name} 副本`;
  fresh.apiKey = '';
  fresh.order = 999;
  return fresh;
}

/* ─── 搜索配置 ─── */
export async function getSearchConfig() {
  const raw = await getSetting('searchConfig');
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fallthrough */ }
  }
  return {
    mode: 'auto',
    endpoint: '',
    apiKey: '',
    keyHeader: 'X-API-Key',
    resultsPath: 'organic',
    titleField: 'title',
    linkField: 'link',
    snippetField: 'snippet',
    maxResults: 8,
  };
}

export async function saveSearchConfig(cfg) {
  await setSetting('searchConfig', JSON.stringify(cfg));
  return cfg;
}
