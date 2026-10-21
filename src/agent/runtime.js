import { streamChat } from '../llm/index.js';
import { getToolDefinitions, executeTool } from './tools.js';
import { isAbortError } from '../llm/errors.js';

/* ─── Agent 运行时 ───
 * 循环：模型 → (工具调用) → 执行 → 回灌 → 模型 → … → 最终回答
 *
 * 兼容两种工具协议：
 *   1. 原生 function calling（OpenAI / Anthropic / Gemini）
 *   2. 文本回退协议 ```tool {"name":..., "arguments":{...}} ```
 */

export const DEFAULT_AGENT_SETTINGS = {
  enabled: false,
  maxSteps: 6,
  maxToolCalls: 12,
  toolNames: ['knowledge_search', 'knowledge_list', 'web_search', 'web_fetch', 'calculator', 'current_time', 'search_history'],
  temperature: null,
};

export async function getAgentSettings() {
  const { getSetting } = await import('../db.js');
  const raw = await getSetting('agentSettings');
  if (!raw) return { ...DEFAULT_AGENT_SETTINGS };
  try { return { ...DEFAULT_AGENT_SETTINGS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_AGENT_SETTINGS }; }
}

export async function saveAgentSettings(patch) {
  const { setSetting } = await import('../db.js');
  const cur = await getAgentSettings();
  const next = { ...cur, ...patch };
  await setSetting('agentSettings', JSON.stringify(next));
  return next;
}

/* ─── 文本回退协议解析 ─── */
export function parseTextToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const re = /```(?:tool|tool_call|function)\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].trim();
    try {
      const obj = JSON.parse(body);
      const name = obj.name || obj.tool || obj.function?.name;
      if (!name) continue;
      const args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? {};
      calls.push({
        id: obj.id || `textcall_${calls.length}_${Date.now().toString(36)}`,
        name,
        args: typeof args === 'string' ? safeParse(args) : args,
        raw: body,
      });
    } catch { /* 忽略无法解析的块 */ }
  }
  return calls;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * 运行 Agent
 * @param {object} opts
 *   messages      初始消息数组（会被复制，不修改入参）
 *   providerId, model
 *   toolNames     启用的工具名数组
 *   maxSteps      最大循环轮数
 *   maxToolCalls  工具调用总数上限
 *   signal
 *   onEvent(e)
 * @returns {Promise<{content, reasoning, steps, toolCalls, usage, messages}>}
 */
export async function runAgent(opts = {}) {
  const emit = opts.onEvent || (() => {});
  const settings = { ...(await getAgentSettings()), ...opts };
  const maxSteps = settings.maxSteps ?? DEFAULT_AGENT_SETTINGS.maxSteps;
  const maxToolCalls = settings.maxToolCalls ?? DEFAULT_AGENT_SETTINGS.maxToolCalls;
  const toolNames = settings.toolNames?.length ? settings.toolNames : DEFAULT_AGENT_SETTINGS.toolNames;
  const toolDefs = getToolDefinitions(toolNames);

  const messages = [...(opts.messages || [])];
  const steps = [];
  const executedCalls = [];
  let toolCallCount = 0;
  let totalUsage = { prompt: 0, completion: 0, total: 0, reasoning: 0 };
  let finalContent = '';
  let finalReasoning = '';

  for (let step = 0; step < maxSteps; step++) {
    emit({ type: 'step_start', index: step });

    let callResult;
    try {
      callResult = await streamChat(messages, {
        providerId: opts.providerId,
        model: opts.model,
        signal: opts.signal,
        tools: toolDefs,
        temperature: settings.temperature ?? undefined,
        onText: (t, full) => { finalContent = full; emit({ type: 'text', text: t, full }); },
        onReasoning: (t, full) => { finalReasoning = full; emit({ type: 'reasoning', text: t, full }); },
        onUsage: (u) => {
          totalUsage.prompt += u.prompt || 0;
          totalUsage.completion += u.completion || 0;
          totalUsage.total += u.total || 0;
          totalUsage.reasoning += u.reasoning || 0;
          emit({ type: 'usage', usage: u });
        },
        onNote: (n) => emit({ type: 'note', text: n }),
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      emit({ type: 'error', error: e });
      throw e;
    }

    let calls = callResult.toolCalls || [];

    /* 原生工具调用不可用时的文本回退 */
    if (!calls.length && callResult.content) {
      const textCalls = parseTextToolCalls(callResult.content);
      if (textCalls.length) {
        calls = textCalls;
        emit({ type: 'note', text: '该模型不支持原生函数调用，已回退到文本工具协议' });
      }
    }

    if (!calls.length) {
      finalContent = callResult.content;
      finalReasoning = callResult.reasoning || finalReasoning;
      steps.push({ index: step, kind: 'answer', content: finalContent });
      emit({ type: 'done', content: finalContent });
      break;
    }

    /* 记录 assistant 的工具调用 */
    const assistantMsg = {
      role: 'assistant',
      content: callResult.content || '',
      tool_calls: calls.map(c => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      })),
    };
    messages.push(assistantMsg);

    for (const call of calls) {
      if (toolCallCount >= maxToolCalls) {
        emit({ type: 'note', text: `已达到工具调用上限（${maxToolCalls}），停止执行` });
        break;
      }
      toolCallCount++;
      emit({ type: 'tool_start', call, index: step });
      const res = await executeTool(call, {
        signal: opts.signal,
        sessionId: opts.sessionId,
        moduleId: opts.moduleId,
        providerId: opts.providerId,
      });
      executedCalls.push({ ...call, ok: res.ok, duration: res.duration, output: res.output, data: res.data });
      emit({ type: 'tool_end', call, result: res, index: step });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: res.output || '(无输出)',
      });
    }

    steps.push({
      index: step,
      kind: 'tool',
      calls: executedCalls.slice(-calls.length),
      content: callResult.content,
    });

    if (toolCallCount >= maxToolCalls) {
      emit({ type: 'note', text: `已达到工具调用上限（${maxToolCalls}）` });
      // 再跑一轮让模型收尾
      const tail = await streamChat(messages, {
        providerId: opts.providerId,
        model: opts.model,
        signal: opts.signal,
        tools: toolDefs,
        onText: (t, full) => { finalContent = full; emit({ type: 'text', text: t, full }); },
        onReasoning: (t, full) => { finalReasoning = full; emit({ type: 'reasoning', text: t, full }); },
        onUsage: (u) => {
          totalUsage.prompt += u.prompt || 0;
          totalUsage.completion += u.completion || 0;
          totalUsage.total += u.total || 0;
          emit({ type: 'usage', usage: u });
        },
      });
      finalContent = tail.content;
      break;
    }
  }

  return {
    content: finalContent,
    reasoning: finalReasoning,
    steps,
    toolCalls: executedCalls,
    usage: totalUsage,
    messages,
  };
}
