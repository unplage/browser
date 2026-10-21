import { retrieve, formatContext } from '../rag/retrieve.js';
import { searchWeb, formatSearchResults } from '../llm/search.js';
import { fetchReadable } from './webfetch.js';
import { evaluateExpression } from './calc.js';
import { getDocuments, getMessages, getSessions } from '../db.js';

/* ─── Agent 内置工具 ───
 * 每个工具：
 *   name        模型可见的函数名
 *   description 给模型的说明
 *   parameters  JSON Schema
 *   execute(args, ctx) -> { ok, output, data }
 *     output 是回灌给模型的文本（必须是自包含的、紧凑的）
 */

const TOOLS = [
  {
    name: 'knowledge_search',
    label: '知识库检索',
    group: 'knowledge',
    description: '在用户的私有知识库（已上传的文档/资料）中做语义+关键词混合检索，返回带编号的资料片段。回答涉及用户自有资料时必须先调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询，尽量使用与用户问题相同的术语' },
        topK: { type: 'integer', description: '返回片段数量（1-15，默认 6）' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      const res = await retrieve(args.query, {
        topK: Math.min(15, Math.max(1, Number(args.topK) || 6)),
        signal: ctx?.signal,
      });
      if (!res.results.length) {
        return { ok: true, output: `知识库中未检索到与「${args.query}」相关的内容。`, data: { count: 0, note: res.note } };
      }
      return {
        ok: true,
        output: formatContext(res.results),
        data: {
          count: res.results.length,
          mode: res.mode,
          sources: res.results.map(r => ({ title: r.docTitle, heading: r.heading, url: r.docUrl })),
        },
      };
    },
  },
  {
    name: 'knowledge_list',
    label: '列出知识库文档',
    group: 'knowledge',
    description: '列出用户知识库中的所有文档（标题、类型、来源）。用于了解可用资料范围。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const docs = await getDocuments();
      if (!docs.length) return { ok: true, output: '知识库为空。', data: { count: 0 } };
      const lines = docs.map(d => `- [${d.id}] ${d.title}（${d.kind}${d.source ? ` / ${d.source}` : ''}，${d.chunkCount || 0} 片段）`);
      return { ok: true, output: `知识库共 ${docs.length} 篇文档：\n${lines.join('\n')}`, data: { count: docs.length } };
    },
  },
  {
    name: 'web_search',
    label: '联网搜索',
    group: 'web',
    description: '调用搜索引擎检索实时信息，返回标题、URL、摘要与日期。需要最新资讯、事实核查或外部资料时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        count: { type: 'integer', description: '返回结果数（1-10，默认 5）' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      const res = await searchWeb(args.query, {
        count: Math.min(10, Math.max(1, Number(args.count) || 5)),
        signal: ctx?.signal,
        providerId: ctx?.providerId,
      });
      if (!res.results.length) {
        return { ok: false, output: `搜索未获得结果（${res.error || '无可用搜索后端'}）。`, data: { count: 0 } };
      }
      return {
        ok: true,
        output: formatSearchResults(res.results, args.query),
        data: { count: res.results.length, backend: res.backend, sources: res.results.map(r => ({ title: r.title, url: r.link, date: r.date })) },
      };
    },
  },
  {
    name: 'web_fetch',
    label: '抓取网页',
    group: 'web',
    description: '抓取指定 URL 的网页正文（自动提取可读文本）。用于深入阅读搜索结果中的具体页面。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的 http/https 链接' },
      },
      required: ['url'],
    },
    async execute(args, ctx) {
      const res = await fetchReadable(args.url, { signal: ctx?.signal });
      if (!res.ok) return { ok: false, output: res.error || '抓取失败', data: { url: args.url } };
      const text = res.text.slice(0, 12000);
      return {
        ok: true,
        output: `标题: ${res.title || '(无)'}\nURL: ${res.url}\n\n${text}`,
        data: { url: res.url, title: res.title, chars: res.text.length, via: res.via },
      };
    },
  },
  {
    name: 'calculator',
    label: '计算器',
    group: 'utility',
    description: '计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/log/sin/cos/min/max/pow 等函数与 pi/e 常量。',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: '数学表达式，如 (1+2)*3^2' } },
      required: ['expression'],
    },
    async execute(args) {
      try {
        const value = evaluateExpression(args.expression);
        return { ok: true, output: `${args.expression} = ${value}`, data: { expression: args.expression, value } };
      } catch (e) {
        return { ok: false, output: `计算失败：${e.message}`, data: { expression: args.expression } };
      }
    },
  },
  {
    name: 'current_time',
    label: '当前时间',
    group: 'utility',
    description: '获取当前日期与时间（可指定时区）。涉及"今天/现在/最新"时使用以确保时效准确。',
    parameters: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'IANA 时区名，如 Asia/Shanghai；默认本地时区' } },
      required: [],
    },
    async execute(args) {
      const now = new Date();
      let text;
      try {
        text = now.toLocaleString('zh-CN', {
          timeZone: args.timezone || undefined,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long',
        });
      } catch {
        text = now.toLocaleString('zh-CN');
      }
      return { ok: true, output: `当前时间：${text}${args.timezone ? `（${args.timezone}）` : ''}`, data: { iso: now.toISOString() } };
    },
  },
  {
    name: 'search_history',
    label: '检索历史对话',
    group: 'utility',
    description: '在用户过往对话记录中按关键词检索，找出相关的历史讨论内容。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
        limit: { type: 'integer', description: '返回条数（1-20，默认 8）' },
      },
      required: ['query'],
    },
    async execute(args) {
      const sessions = await getSessions();
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
      const q = String(args.query || '').toLowerCase();
      const hits = [];
      for (const s of sessions.slice(0, 80)) {
        const msgs = await getMessages(s.id);
        for (const m of msgs) {
          if (m.role !== 'user' && m.role !== 'assistant') continue;
          const c = String(m.content || '');
          if (!q || c.toLowerCase().includes(q)) {
            hits.push({ sessionId: s.id, moduleId: s.moduleId, role: m.role, text: c.slice(0, 400), at: m.createdAt });
            if (hits.length >= limit) break;
          }
        }
        if (hits.length >= limit) break;
      }
      if (!hits.length) return { ok: true, output: `历史对话中未找到包含「${args.query}」的内容。`, data: { count: 0 } };
      const lines = hits.map((h, i) => `[${i + 1}] (${h.role}) ${h.text}`);
      return { ok: true, output: lines.join('\n\n'), data: { count: hits.length } };
    },
  },
];

export const BUILTIN_TOOLS = TOOLS;
export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

export function getTool(name) {
  return TOOL_MAP.get(name);
}

export function getToolDefinitions(names) {
  const list = names && names.length ? names : TOOLS.map(t => t.name);
  return list.map(n => TOOL_MAP.get(n)).filter(Boolean).map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * 执行一个工具调用
 * @param {object} call { id, name, args }
 * @param {object} ctx  { signal, sessionId, providerId, onStep }
 */
export async function executeTool(call, ctx = {}) {
  const tool = TOOL_MAP.get(call.name);
  const started = Date.now();
  if (!tool) {
    return {
      ok: false,
      output: `未知工具：${call.name}`,
      data: { name: call.name },
      duration: 0,
    };
  }
  try {
    const res = await tool.execute(call.args || {}, ctx);
    return {
      ...res,
      duration: Date.now() - started,
      name: call.name,
    };
  } catch (e) {
    return {
      ok: false,
      output: `工具 ${call.name} 执行失败：${e.message}`,
      data: { name: call.name },
      duration: Date.now() - started,
    };
  }
}
