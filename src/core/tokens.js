/* ─── Token 估算与上下文预算管理 ─── */

/**
 * 轻量 token 估算器。
 * 对中日韩字符按 ~1.5 字符/token，其余按 ~4 字符/token 估算。
 * 相比真实 tokenizer 有偏差，但足以驱动上下文预算策略，且零依赖、零网络。
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x3000 && c <= 0x9fff) cjk++;
    else if (c >= 0xac00 && c <= 0xd7af) cjk++;
    else if (c >= 0xf900 && c <= 0xfaff) cjk++;
  }
  const other = s.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (typeof m.content === 'string') total += estimateTokens(m.content);
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') total += estimateTokens(part.text || '');
        else if (part.type === 'image_url') total += 800;
        else if (part.type === 'image') total += 800;
      }
    }
    if (m.reasoning) total += estimateTokens(m.reasoning);
    if (m.tool_calls) total += 200;
  }
  return total;
}

export const DEFAULT_CONTEXT_BUDGET = {
  system: 2000,
  tools: 1000,
  history: 24000,
  reserve: 1500,
};

/**
 * 将消息数组裁剪到预算内。
 * 策略：保留 system / tool 定义 / 最近的历史轮次，中间的旧轮次由 summarizer 压缩。
 *
 * @param {Array} messages  完整消息数组
 * @param {object} opts
 *   - budget: 预算 token 数
 *   - keepRecent: 至少保留的最近消息条数
 *   - summarizer: async (messages) => summaryString，用于压缩被裁掉的部分
 * @returns {Promise<{messages: Array, summary: string|null, dropped: number, tokens: number}>}
 */
export async function compressToBudget(messages, opts = {}) {
  const budget = opts.budget ?? DEFAULT_CONTEXT_BUDGET.history;
  const keepRecent = opts.keepRecent ?? 6;
  const list = Array.isArray(messages) ? messages : [];

  const system = list.filter(m => m.role === 'system');
  const body = list.filter(m => m.role !== 'system');

  if (estimateMessagesTokens(list) <= budget) {
    return { messages: list, summary: null, dropped: 0, tokens: estimateMessagesTokens(list) };
  }

  const head = body.slice(0, Math.max(0, body.length - keepRecent));
  const tail = body.slice(Math.max(0, body.length - keepRecent));

  if (head.length === 0) {
    return { messages: list, summary: null, dropped: 0, tokens: estimateMessagesTokens(list) };
  }

  let summary = null;
  if (typeof opts.summarizer === 'function') {
    try {
      summary = await opts.summarizer(head);
    } catch (e) {
      console.warn('[context] 摘要生成失败，退化为直接裁剪:', e.message);
      summary = null;
    }
  }

  const out = [...system];
  if (summary) {
    out.push({
      role: 'system',
      content: `【历史对话摘要】\n${summary}`,
      _synthetic: true,
    });
  }
  out.push(...tail);

  let tokens = estimateMessagesTokens(out);
  let trimmed = 0;
  while (tokens > budget && out.length > system.length + 1) {
    const idx = system.length + (summary ? 1 : 0);
    if (idx >= out.length) break;
    out.splice(idx, 1);
    trimmed++;
    tokens = estimateMessagesTokens(out);
  }

  return {
    messages: out,
    summary,
    dropped: head.length + trimmed,
    tokens,
  };
}

/** 生成用于压缩历史的事实性摘要提示词 */
export function buildSummaryPrompt(messages) {
  const transcript = messages.map(m => {
    const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
    let c = typeof m.content === 'string' ? m.content : '';
    if (Array.isArray(m.content)) {
      c = m.content.map(p => p.text || (p.type === 'image_url' ? '[图片]' : '')).join(' ');
    }
    if (m.tool_calls?.length) c += `\n[调用工具: ${m.tool_calls.map(t => t.function?.name || t.name).join(', ')}]`;
    return `${role}: ${c}`;
  }).join('\n');

  return `请把以下对话压缩为不超过 300 字的事实性摘要，保留关键结论、数据、用户偏好和未完成事项，丢弃寒暄与冗余。\n\n${transcript}`;
}
