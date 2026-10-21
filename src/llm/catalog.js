/* ─── 模型能力目录 ───
 * 依据各家官方文档整理，用于：
 *   - 夹取 max_tokens / maxOutputTokens 到模型真实上限（避免 400）
 *   - 判断视觉 / 工具调用 / 思考能力
 *   - 选择正确的参数风格（max_tokens vs max_completion_tokens vs maxOutputTokens）
 *   - 判断是否需要 reasoning_effort
 * 未知模型走保守默认值。
 */

/**
 * paramStyle:
 *   'standard'        —— max_tokens
 *   'openai-reasoning'—— max_completion_tokens（o1/o3/o4-mini/gpt-5 系列）
 *   'anthropic'       —— max_tokens（顶层，system 分离）
 *   'gemini'          —— generationConfig.maxOutputTokens
 * thinkingShape:
 *   'zhipu'           —— { type: 'enabled' | 'disabled' }
 *   'anthropic'       —— { type: 'enabled' | 'disabled', budget_tokens }
 *   'none'            —— 不支持
 */

const CATALOG = [
  /* ── OpenAI ── */
  { match: /^gpt-5(\.\d+)?(-mini|-nano)?/i, context: 400000, maxOutput: 128000, vision: true, tools: true, reasoning: true, paramStyle: 'openai-reasoning', thinkingShape: 'none', effort: ['none', 'minimal', 'low', 'medium', 'high'] },
  { match: /^o[34](-mini|-pro)?/i, context: 200000, maxOutput: 100000, vision: true, tools: true, reasoning: true, paramStyle: 'openai-reasoning', thinkingShape: 'none', effort: ['low', 'medium', 'high'] },
  { match: /^o1(-mini|-preview)?/i, context: 200000, maxOutput: 100000, vision: true, tools: true, reasoning: true, paramStyle: 'openai-reasoning', thinkingShape: 'none', effort: ['low', 'medium', 'high'] },
  { match: /^gpt-4\.1(-mini|-nano)?/i, context: 1047576, maxOutput: 32768, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^gpt-4o(-mini)?/i, context: 128000, maxOutput: 16384, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^gpt-4(-turbo)?/i, context: 128000, maxOutput: 4096, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^gpt-3\.5/i, context: 16385, maxOutput: 4096, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^text-embedding/i, context: 8191, maxOutput: 0, vision: false, tools: false, reasoning: false, paramStyle: 'standard', thinkingShape: 'none', embedding: true },

  /* ── Anthropic ── */
  { match: /^claude-(opus|sonnet|haiku)-4/i, context: 200000, maxOutput: 64000, vision: true, tools: true, reasoning: true, paramStyle: 'anthropic', thinkingShape: 'anthropic', effort: ['low', 'medium', 'high'] },
  { match: /^claude-3-7/i, context: 200000, maxOutput: 64000, vision: true, tools: true, reasoning: true, paramStyle: 'anthropic', thinkingShape: 'anthropic', effort: ['low', 'medium', 'high'] },
  { match: /^claude-3-5-(sonnet|haiku)/i, context: 200000, maxOutput: 8192, vision: true, tools: true, reasoning: false, paramStyle: 'anthropic', thinkingShape: 'none' },
  { match: /^claude-3/i, context: 200000, maxOutput: 4096, vision: true, tools: true, reasoning: false, paramStyle: 'anthropic', thinkingShape: 'none' },

  /* ── Google Gemini ── */
  { match: /^gemini-2\.5-(pro|flash)/i, context: 1048576, maxOutput: 65536, vision: true, tools: true, reasoning: true, paramStyle: 'gemini', thinkingShape: 'none', effort: ['none', 'low', 'medium', 'high'] },
  { match: /^gemini-2\.0/i, context: 1048576, maxOutput: 8192, vision: true, tools: true, reasoning: false, paramStyle: 'gemini', thinkingShape: 'none' },
  { match: /^gemini-1\.5/i, context: 2097152, maxOutput: 8192, vision: true, tools: true, reasoning: false, paramStyle: 'gemini', thinkingShape: 'none' },
  { match: /^text-embedding-004/i, context: 2048, maxOutput: 0, vision: false, tools: false, reasoning: false, paramStyle: 'gemini', thinkingShape: 'none', embedding: true },

  /* ── 智谱 GLM ── */
  { match: /^glm-5\.3/i, context: 1000000, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['low', 'high', 'max'] },
  { match: /^glm-5\.2/i, context: 202752, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] },
  { match: /^glm-5\.1/i, context: 202752, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] },
  { match: /^glm-5v/i, context: 202752, maxOutput: 131072, vision: true, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] },
  { match: /^glm-5/i, context: 202752, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] },
  { match: /^glm-4\.7/i, context: 200000, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: [] },
  { match: /^glm-4\.6v/i, context: 200000, maxOutput: 32768, vision: true, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: [] },
  { match: /^glm-4\.6/i, context: 200000, maxOutput: 131072, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: [] },
  { match: /^glm-4\.5v/i, context: 128000, maxOutput: 16384, vision: true, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: [] },
  { match: /^glm-4\.5/i, context: 128000, maxOutput: 98304, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: [] },
  { match: /^glm-4v/i, context: 8192, maxOutput: 8192, vision: true, tools: false, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^glm-4(-plus|-flash|-air)/i, context: 128000, maxOutput: 4095, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^glm-4/i, context: 128000, maxOutput: 4095, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^embedding-/i, context: 8192, maxOutput: 0, vision: false, tools: false, reasoning: false, paramStyle: 'standard', thinkingShape: 'none', embedding: true },

  /* ── DeepSeek ── */
  { match: /^deepseek-(v4|chat|reasoner|flash)/i, context: 1048576, maxOutput: 393216, vision: true, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'zhipu', effort: ['low', 'high', 'max'] },

  /* ── 月之暗面 Kimi ── */
  { match: /^kimi-k2/i, context: 256000, maxOutput: 32768, vision: false, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'none', effort: [] },
  { match: /^kimi/i, context: 200000, maxOutput: 32768, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },

  /* ── 阿里 Qwen ── */
  { match: /^qwen3(-vl)?/i, context: 262144, maxOutput: 32768, vision: true, tools: true, reasoning: true, paramStyle: 'standard', thinkingShape: 'none', effort: [] },
  { match: /^qwen/i, context: 131072, maxOutput: 32768, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },

  /* ── Mistral ── */
  { match: /^mistral-large/i, context: 131072, maxOutput: 32768, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^mistral/i, context: 131072, maxOutput: 8192, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },

  /* ── Meta Llama ── */
  { match: /^llama-?4/i, context: 10485760, maxOutput: 32768, vision: true, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
  { match: /^llama/i, context: 131072, maxOutput: 8192, vision: false, tools: true, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },

  /* ── 通义 / SiliconFlow 常见模型 ── */
  { match: /^(qwen|bge|gte|internlm)/i, context: 32768, maxOutput: 8192, vision: false, tools: false, reasoning: false, paramStyle: 'standard', thinkingShape: 'none' },
];

/** 视觉模型额外特征：名称含 v 且非 v4/v3 等版本号 */
function guessVision(modelId) {
  return /(?:^|[-_.])v(?:ision)?\d|(?:-v|-vl\b)|multimodal|omni/i.test(modelId) ||
         /glm-4\.6v|glm-4\.5v|qwen.*-vl|kimi-v|llama-?4/i.test(modelId);
}

const DEFAULTS = {
  context: 32768,
  maxOutput: 4096,
  vision: false,
  tools: true,
  reasoning: false,
  paramStyle: 'standard',
  thinkingShape: 'none',
  effort: [],
  embedding: false,
};

const cache = new Map();

/**
 * 解析模型能力描述。
 * @param {string} modelId
 * @param {object} hints 来自 provider 的显式声明（优先级高于推断）
 */
export function resolveModel(modelId, hints = {}) {
  const id = String(modelId || '').trim();
  if (!id) return { ...DEFAULTS, id: '', name: id, source: 'default' };
  if (cache.has(id)) {
    const c = cache.get(id);
    return { ...c, ...hints, id };
  }
  let found = null;
  for (const entry of CATALOG) {
    if (entry.match.test(id)) { found = entry; break; }
  }
  const base = found ? { ...DEFAULTS, ...found } : { ...DEFAULTS };
  if (!found && guessVision(id)) base.vision = true;
  if (!found && /embed/i.test(id)) { base.embedding = true; base.tools = false; }

  const resolved = {
    ...base,
    id,
    name: id,
    source: found ? 'catalog' : 'inferred',
    match: found ? found.match.source : null,
  };
  cache.set(id, resolved);
  return { ...resolved, ...hints, id };
}

/** 视觉模型名启发式（供 UI 提示使用） */
export function isVisionModel(modelId) {
  return resolveModel(modelId).vision;
}

/** 列出目录中已知模型的能力（用于设置页提示） */
export function knownModels() {
  return CATALOG.map(e => ({ pattern: e.match.source, ...e }));
}

export function clearModelCache() {
  cache.clear();
}
