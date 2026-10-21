import { getSearchConfig, getProvider } from './providers.js';
import { LLMError } from './errors.js';

/* ─── 联网搜索 ───
 * 统一的后端调度：把不同厂商的搜索接口归一化为
 *   { title, link, snippet, source, date }
 *
 * 后端：
 *   zhipu    —— 智谱独立 Web Search API（结构化，质量高）
 *   searxng  —— 自建 SearXNG（JSON 格式）
 *   external —— 任意兼容搜索 HTTP API（Serper / Brave / Tavily / Bing 等）
 *   none     —— 未配置
 */

function pickPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return null;
    if (/^\d+$/.test(key)) return acc[Number(key)];
    return acc[key];
  }, obj);
}

function normalizeRows(rows, cfg) {
  if (!Array.isArray(rows)) return [];
  const titleF = cfg.titleField || 'title';
  const linkF = cfg.linkField || 'link';
  const snippetF = cfg.snippetField || 'snippet';
  const dateF = cfg.dateField || 'date';
  return rows.map(r => ({
    title: pickPath(r, titleF) || '',
    link: pickPath(r, linkF) || pickPath(r, 'url') || pickPath(r, 'link') || '',
    snippet: pickPath(r, snippetF) || pickPath(r, 'content') || pickPath(r, 'description') || '',
    source: pickPath(r, 'source') || pickPath(r, 'media') || pickPath(r, 'siteName') || '',
    date: pickPath(r, dateF) || pickPath(r, 'publish_date') || pickPath(r, 'published') || '',
  })).filter(r => r.link || r.title);
}

/* ── 智谱独立搜索 API ── */
async function zhipuSearch(provider, query, opts) {
  const cfg = provider.search || {};
  const url = `${provider.apiBase.replace(/\/+$/, '')}/web_search`;
  const body = {
    search_engine: cfg.engine || 'search_std',
    search_query: String(query).slice(0, 70),
    search_intent: false,
    count: opts.count || cfg.count || 5,
    content_size: 'medium',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new LLMError(`智谱搜索失败: HTTP ${res.status}`, { status: res.status, providerId: provider.id });
  }
  const json = await res.json();
  const rows = json?.search_result || [];
  return rows.map(r => ({
    title: r.title || '', link: r.link || '', snippet: r.content || '',
    source: r.media || '', date: r.publish_date || '',
  }));
}

/* ── SearXNG ── */
async function searxngSearch(cfg, query, opts) {
  const base = (cfg.endpoint || '').replace(/\/+$/, '');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
  const headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers[cfg.keyHeader || 'Authorization'] = cfg.apiKey;
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok) throw new LLMError(`SearXNG 搜索失败: HTTP ${res.status}`, { status: res.status });
  const json = await res.json();
  return normalizeRows(json?.results || [], {
    titleField: 'title', linkField: 'url', snippetField: 'content', dateField: 'publishedDate',
  });
}

/* ── 通用外部搜索 API ── */
async function externalSearch(cfg, query, opts) {
  const tpl = cfg.endpoint || '';
  if (!tpl) throw new LLMError('未配置搜索 API 地址');
  const url = tpl.includes('{query}')
    ? tpl.replace('{query}', encodeURIComponent(query))
    : `${tpl}${tpl.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`;
  const headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers[cfg.keyHeader || 'Authorization'] = cfg.apiKey;
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok) throw new LLMError(`搜索 API 失败: HTTP ${res.status}`, { status: res.status });
  const json = await res.json();
  const rows = pickPath(json, cfg.resultsPath || 'results') || pickPath(json, 'organic') || [];
  return normalizeRows(rows, cfg).slice(0, opts.count || cfg.maxResults || 8);
}

/**
 * 执行一次联网搜索。
 * @param {string} query
 * @param {object} opts { providerId, count, signal, backend }
 */
export async function searchWeb(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], backend: 'none' };

  const globalCfg = await getSearchConfig();
  const backend = opts.backend || globalCfg.mode || 'auto';

  const attempts = [];

  if (backend === 'none') attempts.push('none');
  else if (backend !== 'auto') attempts.push(backend);
  else {
    attempts.push('zhipu', 'external', 'searxng');
  }

  const errors = [];
  for (const be of attempts) {
    try {
      if (be === 'none') break;
      if (be === 'zhipu') {
        const provider = opts.providerId ? await getProvider(opts.providerId) : null;
        if (!provider || !provider.apiKey) continue;
        const results = await zhipuSearch(provider, q, opts);
        if (results.length) return { results, backend: 'zhipu' };
      } else if (be === 'searxng') {
        const results = await searxngSearch(globalCfg, q, opts);
        if (results.length) return { results, backend: 'searxng' };
      } else if (be === 'external') {
        const results = await externalSearch(globalCfg, q, opts);
        if (results.length) return { results, backend: 'external' };
      }
    } catch (e) {
      errors.push(`${be}: ${e.message}`);
    }
  }

  return {
    results: [],
    backend: 'none',
    error: errors.length ? errors.join('; ') : '未配置可用的搜索后端',
  };
}

/** 把搜索结果格式化为给模型看的文本块 */
export function formatSearchResults(results, query) {
  if (!results?.length) return `未搜索到「${query}」的可用结果。`;
  return results.map((r, i) => {
    const meta = [r.source, r.date].filter(Boolean).join(' · ');
    return `[${i + 1}] ${r.title}${meta ? `（${meta}）` : ''}\nURL: ${r.link}\n摘要: ${r.snippet || '（无摘要）'}`;
  }).join('\n\n');
}
