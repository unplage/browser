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
    model: 'glm-4.7-flash',
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
`你是一位深度分析专家，擅长结合 web_search 的实时信息与自身的知识库进行综合分析。

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
  let finalMessages = [{ role: 'system', content: systemPrompt }];

  if (opts.webSearch) {
    const enhancedSystemPrompt = systemPrompt + `\n\n你已经通过 web_search 工具获取了最新的联网搜索结果。请将网络搜索到的实时信息与你的训练知识相结合来回答用户的问题。对于时效性强的内容优先采用网络搜索结果，对于背景知识和理论分析可以充分运用你的知识库。请在回答中适当标注信息来源是「网络搜索」还是「知识库」。`;
    finalMessages = [{ role: 'system', content: enhancedSystemPrompt }, ...messages];
  } else {
    finalMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  }

  return await callGLM(
    finalMessages,
    { stream: true, onChunk, webSearch: opts.webSearch, searchQuery: opts.searchQuery }
  );
}
