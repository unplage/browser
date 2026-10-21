import { resolveModel } from './catalog.js';
import { clamp } from '../core/utils.js';

/* ─── 参数协商 ───
 * 输入：provider 声明的 params 配置 + 用户覆盖 + 模型能力
 * 输出：可直接放进请求体的参数对象
 *
 * 修复的核心问题：
 *   - max_tokens 夹取到模型真实上限（原先固定 131072，glm-4.6v-flash 会 400）
 *   - OpenAI 推理模型改用 max_completion_tokens（原先 max_tokens 必然 400）
 *   - thinking 按协议整形（Zhipu/DeepSeek 需 {type:'enabled'}，Anthropic 需 budget_tokens）
 *   - reasoning_effort 仅在模型支持且取值合法时发送
 */

export const PARAM_SCHEMA = {
  temperature: { type: 'range', min: 0, max: 2, step: 0.1, default: 1.0, label: '温度' },
  top_p: { type: 'range', min: 0.01, max: 1, step: 0.01, default: 1, label: 'Top P' },
  max_tokens: { type: 'number', min: 1, default: 4096, label: '最大输出' },
  thinking: { type: 'boolean', default: false, label: '深度思考' },
  reasoning_effort: { type: 'select', options: ['low', 'medium', 'high', 'max'], default: null, label: '思考强度' },
  frequency_penalty: { type: 'range', min: -2, max: 2, step: 0.1, default: 0, label: '频率惩罚' },
  presence_penalty: { type: 'range', min: -2, max: 2, step: 0.1, default: 0, label: '存在惩罚' },
  stop: { type: 'text', default: '', label: '停止序列' },
  seed: { type: 'number', default: null, label: '随机种子' },
};

/** 从 provider.params 中取出最终生效值（用户覆盖 > 已存值 > 默认值） */
export function resolveParamValue(config, override) {
  if (override !== undefined && override !== null && override !== '') return override;
  if (config?.stored !== undefined && config.stored !== null && config.stored !== '') return config.stored;
  if (config?.default !== undefined && config.default !== null) return config.default;
  return undefined;
}

/**
 * 协商出最终请求参数。
 * @param {object} provider
 * @param {string} modelId
 * @param {object} overrides  请求级覆盖，如 {temperature: 0.2}
 * @returns {{params: object, notes: string[], model: object}}
 */
export function negotiateParams(provider, modelId, overrides = {}) {
  const model = resolveModel(modelId, provider.modelHints?.[modelId]);
  const notes = [];
  const params = {};
  const declared = provider.params || {};

  const value = (key) => {
    if (!(key in declared)) return undefined;
    const cfg = declared[key];
    if (cfg.supported === false) return undefined;
    return resolveParamValue(cfg, overrides[key]);
  };

  /* ── 采样参数 ── */
  const temperature = value('temperature');
  if (temperature !== undefined) {
    params.temperature = clamp(Number(temperature), 0, 2);
  }
  const topP = value('top_p');
  if (topP !== undefined) {
    params.top_p = clamp(Number(topP), 0.01, 1);
  }
  if (temperature !== undefined && topP !== undefined && params.temperature !== 1 && params.top_p !== 1) {
    notes.push('同时设置了 temperature 与 top_p，建议只调节其中之一以获得稳定输出');
  }

  /* ── 惩罚 / 种子 / 停止序列 ── */
  const freq = value('frequency_penalty');
  if (freq !== undefined) params.frequency_penalty = clamp(Number(freq), -2, 2);
  const pres = value('presence_penalty');
  if (pres !== undefined) params.presence_penalty = clamp(Number(pres), -2, 2);
  const seed = value('seed');
  if (seed !== undefined && seed !== null && seed !== '') params.seed = Number(seed);
  const stop = value('stop');
  if (stop !== undefined && stop !== '') {
    params.stop = Array.isArray(stop) ? stop : String(stop).split('\n').map(s => s.trim()).filter(Boolean);
  }

  /* ── 输出长度：按模型上限夹取 ── */
  let maxTokens = value('max_tokens');
  const cap = model.maxOutput || 4096;
  if (maxTokens !== undefined) {
    maxTokens = Math.max(1, Math.floor(Number(maxTokens)));
    if (maxTokens > cap) {
      notes.push(`max_tokens 已从 ${maxTokens} 调整为模型上限 ${cap}`);
      maxTokens = cap;
    }
  } else {
    maxTokens = Math.min(cap, 4096);
  }

  /* ── 深度思考 ── */
  const thinkingEnabled = value('thinking');
  let thinking = undefined;
  if (thinkingEnabled !== undefined && model.thinkingShape !== 'none') {
    if (model.thinkingShape === 'zhipu') {
      thinking = { type: thinkingEnabled ? 'enabled' : 'disabled' };
    } else if (model.thinkingShape === 'anthropic') {
      thinking = thinkingEnabled
        ? { type: 'enabled', budget_tokens: Math.min(Math.max(1024, Math.floor(maxTokens / 2)), 32000) }
        : { type: 'disabled' };
    }
  }

  /* ── 思考强度 ── */
  let effort = value('reasoning_effort');
  if (effort && (!model.effort || !model.effort.length)) {
    effort = undefined;
  } else if (effort && model.effort?.length && !model.effort.includes(effort)) {
    notes.push(`reasoning_effort=${effort} 不被模型支持，可选：${model.effort.join('/')}`);
    effort = undefined;
  }

  /* ── 按参数风格落位 ── */
  const style = model.paramStyle || 'standard';
  if (style === 'openai-reasoning') {
    params.max_completion_tokens = maxTokens;
    delete params.max_tokens;
    if (params.temperature !== undefined && params.temperature !== 1) {
      notes.push('推理模型（o 系列 / gpt-5）仅支持 temperature=1，已忽略自定义温度');
      delete params.temperature;
    }
    if (params.top_p !== undefined && params.top_p !== 1) {
      delete params.top_p;
    }
    if (params.frequency_penalty !== undefined) delete params.frequency_penalty;
    if (params.presence_penalty !== undefined) delete params.presence_penalty;
  } else {
    params.max_tokens = maxTokens;
  }

  if (thinking) params.thinking = thinking;
  if (effort) params.reasoning_effort = effort;

  return { params, notes, model };
}

/** 估算某 provider+model 组合的上下文窗口 */
export function contextWindow(provider, modelId) {
  const model = resolveModel(modelId, provider?.modelHints?.[modelId]);
  return model.context || 32768;
}

/** 供设置页展示：模型实际可用的最大输出 */
export function effectiveMaxOutput(modelId) {
  return resolveModel(modelId).maxOutput;
}
