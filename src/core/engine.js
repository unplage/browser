import { streamChat } from '../llm/index.js';
import { getProvider } from '../llm/providers.js';
import { getMessages } from '../db.js';
import { compressToBudget, estimateMessagesTokens, buildSummaryPrompt, estimateTokens } from './tokens.js';
import { retrieve, formatContext, buildGroundedPrompt } from '../rag/retrieve.js';
import { runAgent, getAgentSettings } from '../agent/runtime.js';

/* ─── 对话引擎 ───
 * 把 LLM / RAG / Agent / 上下文管理统一到一个入口。
 */

export function nowContext() {
  const d = new Date();
  const w = d.toLocaleDateString('zh-CN', { weekday: 'long' });
  return `当前日期时间：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}（${w}）。`;
}

/** 构造送入模型的最终消息数组 */
export function buildRequestMessages({ systemPrompt, history, userText, imageData, extraSystem }) {
  const msgs = [{ role: 'system', content: `${nowContext()}\n\n${systemPrompt}` }];
  if (extraSystem) msgs.push({ role: 'system', content: extraSystem });
  for (const m of history || []) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    msgs.push({ role: m.role, content: String(m.content || '') });
  }
  const userMsg = { role: 'user', content: userText || '' };
  if (imageData) {
    userMsg.content = [
      { type: 'image_url', image_url: { url: imageData } },
      { type: 'text', text: userText || '请分析这张图片' },
    ];
  }
  msgs.push(userMsg);
  return msgs;
}

/** 摘要历史（供上下文压缩使用） */
export async function summarizeHistory(messages, providerId, model) {
  const prompt = buildSummaryPrompt(messages);
  try {
    const out = await streamChat(
      [{ role: 'user', content: prompt }],
      { providerId, model, max_tokens: 600, allowNoKey: true },
    );
    return out.content?.trim() || null;
  } catch (e) {
    console.warn('[engine] 摘要生成失败:', e.message);
    return null;
  }
}

/**
 * 主入口：处理一轮对话
 *
 * @param {object} opts
 *   module        { systemPrompt, providerId, model, title }
 *   sessionId
 *   userText
 *   imageData     dataURL
 *   useKnowledge  是否走知识库检索（RAG）
 *   useAgent      是否走 Agent 工具循环
 *   useWeb        是否启用联网
 *   historyLimit  参与本次请求的历史条数
 *   signal
 *   onEvent(e)
 * @returns {Promise<{content, reasoning, usage, sources, steps, notes, messages}>}
 */
export async function respond(opts = {}) {
  const emit = opts.onEvent || (() => {});
  const notes = [];
  const sources = [];
  const seenSources = new Set();
  const pushSource = (s) => {
    const key = `${s.title || ''}|${s.heading || ''}|${s.url || ''}`;
    if (seenSources.has(key)) return;
    seenSources.add(key);
    sources.push(s);
  };
  let steps = [];
  let toolCalls = [];

  const provider = await getProvider(opts.module?.providerId);
  const providerId = opts.module?.providerId || provider?.id;
  const model = opts.module?.model || provider?.defaultModel;

  /* ── 1. 取历史 ── */
  let history = [];
  if (opts.sessionId) {
    const stored = await getMessages(opts.sessionId);
    history = stored
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }))
      .slice(-(opts.historyLimit || 24));
  }

  /* ── 2. 知识库检索（RAG） ── */
  let extraSystem = null;
  let retrieval = null;
  if (opts.useKnowledge) {
    emit({ type: 'retrieval_start' });
    retrieval = await retrieve(opts.userText, {
      topK: opts.topK || 6,
      signal: opts.signal,
    });
    if (retrieval.results.length) {
      const ctx = formatContext(retrieval.results);
      extraSystem = buildGroundedPrompt(ctx);
      retrieval.results.forEach((r) => {
        pushSource({
          id: '', title: r.docTitle, heading: r.heading, url: r.docUrl,
          score: r.score, text: r.text,
        });
      });
      emit({ type: 'retrieval_done', count: retrieval.results.length, mode: retrieval.mode });
    } else {
      if (retrieval.note) notes.push(retrieval.note);
      emit({ type: 'retrieval_done', count: 0, mode: retrieval.mode });
    }
  }

  /* ── 3. 上下文压缩 ── */
  let requestMessages = buildRequestMessages({
    systemPrompt: opts.module?.systemPrompt || '你是一个有帮助的助手。',
    history,
    userText: opts.userText,
    imageData: opts.imageData,
    extraSystem,
  });

  const budget = opts.contextBudget || 24000;
  if (estimateMessagesTokens(requestMessages) > budget) {
    const compressed = await compressToBudget(requestMessages, {
      budget,
      keepRecent: 6,
      summarizer: (dropped) => summarizeHistory(dropped, providerId, model),
    });
    requestMessages = compressed.messages;
    if (compressed.dropped > 0) {
      notes.push(`历史过长，已压缩 ${compressed.dropped} 条消息`);
      emit({ type: 'context_compressed', dropped: compressed.dropped, tokens: compressed.tokens });
    }
  }

  /* ── 4. 生成 ── */
  let content = '';
  let reasoning = '';
  let usage = null;

  if (opts.useAgent) {
    const agentSettings = await getAgentSettings();
    const res = await runAgent({
      messages: requestMessages,
      providerId,
      model,
      toolNames: opts.toolNames || agentSettings.toolNames,
      maxSteps: opts.maxSteps || agentSettings.maxSteps,
      signal: opts.signal,
      onEvent: (e) => {
        if (e.type === 'tool_end' && e.result?.data?.sources) {
          for (const s of e.result.data.sources) {
            pushSource({
              id: '', title: s.title || s.url || '来源',
              url: s.url || '', heading: s.heading || '', snippet: s.snippet || '',
            });
          }
        }
        emit({ type: 'agent', event: e });
      },
    });
    content = res.content;
    reasoning = res.reasoning;
    usage = res.usage;
    steps = res.steps;
    toolCalls = res.toolCalls;
    if (opts.useWeb && !toolCalls.length) {
      // Agent 模式下若模型未主动搜索，且用户勾选了联网，则补一次原生搜索
      notes.push('Agent 模式已启用，联网能力由 web_search 工具提供');
    }
  } else {
    const res = await streamChat(requestMessages, {
      providerId,
      model,
      signal: opts.signal,
      webSearch: !!opts.useWeb,
      searchQuery: opts.userText,
      onText: (t, full) => { content = full; emit({ type: 'text', text: t, full }); },
      onReasoning: (t, full) => { reasoning = full; emit({ type: 'reasoning', text: t, full }); },
      onUsage: (u) => { usage = u; emit({ type: 'usage', usage: u }); },
      onNote: (n) => { notes.push(n); emit({ type: 'note', text: n }); },
    });
    content = res.content;
    reasoning = res.reasoning;
    usage = res.usage;
    if (res.searchResults?.length) {
      res.searchResults.forEach((r) => {
        pushSource({ id: '', title: r.title, url: r.link, date: r.date, snippet: r.snippet });
      });
    }
  }

  sources.forEach((s, i) => { s.id = `S${i + 1}`; });

  return { content, reasoning, usage, sources, steps, toolCalls, notes, messages: requestMessages };
}

/** 估算一段对话的上下文占用 */
export function contextStats(messages) {
  const tokens = estimateMessagesTokens(messages);
  const chars = messages.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0);
  return { messages: messages.length, tokens, chars };
}
