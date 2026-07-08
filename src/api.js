import { getSetting } from './db.js';

const BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

async function getApiKey() {
  return await getSetting('apiKey');
}

export async function checkApiKey() {
  return !!(await getApiKey());
}

async function request(messages, opts = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('请先在设置中配置 API Key');

  const body = {
    model: 'glm-4-flash',
    messages,
    stream: !!opts.stream,
    do_sample: true,
    temperature: opts.temperature ?? 0.7,
    top_p: 0.9,
    max_tokens: opts.maxTokens ?? 8192,
  };

  if (opts.webSearch) {
    body.tools = [{
      type: 'web_search',
      web_search: { enable: true, search_query: opts.searchQuery || '' },
    }];
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
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
    const res = await request(messages, opts);
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

const SEARCH_SYSTEM_PROMPT =
`你已经通过 web_search 工具联网搜索到了最新信息。用户的问题需要你基于实时搜索结果回答，而不是依赖你的训练数据。

请按以下结构组织回答：
1. **综合结论** — 给出核心回答并标注可信度（高/中/低）
2. **关键发现** — 分点列出，每点标注来源
3. **分歧与争议** — 如果存在不同观点，列出并分析
4. **信息来源** — 列出参考来源及可信度评估

要求：
- 严格基于搜索结果回答，不要依赖训练数据中的过时信息
- 区分确凿事实与有待验证的信息
- 不确定的内容明确说明
- 所有重要观点标注信息来源`;

export async function searchWithAnalysis(query) {
  return await callGLM(
    [
      { role: 'system', content: SEARCH_SYSTEM_PROMPT },
      { role: 'user', content: `【需要联网搜索】请搜索以下内容并提供分析：${query}` },
    ],
    { webSearch: true, searchQuery: query }
  );
}

const FILE_ANALYSIS_PROMPT =
`你是一位多学科分析专家。

请按以下结构分析文件内容：
1. **核心摘要** — 用 100-200 字概括核心内容
2. **关键信息** — 提取重要数据、事实和观点
3. **结构分析** — 分析逻辑结构和论证方式
4. **亮点与局限** — 指出优点和可能的局限性
5. **延伸思考** — 提供相关背景知识或扩展观点`;

export async function analyzeFile(content, fileName) {
  return await callGLM([
    { role: 'system', content: FILE_ANALYSIS_PROMPT },
    { role: 'user', content: `文件名: ${fileName}\n\n内容:\n${content}` },
  ]);
}

export async function chatWithModule(systemPrompt, messages, onChunk, opts = {}) {
  return await callGLM(
    [{ role: 'system', content: systemPrompt }, ...messages],
    { stream: true, onChunk, webSearch: opts.webSearch, searchQuery: opts.searchQuery }
  );
}
