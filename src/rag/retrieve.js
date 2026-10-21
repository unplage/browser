import { getAllChunks, getDocuments, getVectors } from '../db.js';
import { buildBm25Index, bm25Search, rrfFuse } from './bm25.js';
import { topKSimilar } from './vector.js';
import { embedTexts, getRagSettings } from './embed.js';

/* ─── 混合检索 ───
 * 词法（BM25）+ 向量（Embedding）双路召回，RRF 融合。
 * 没有配置 embedding Provider 时自动退化为纯词法检索，功能不中断。
 */

let indexCache = { key: null, index: null, chunks: null, docs: null };
let vectorCache = { key: null, vectors: null };

async function loadCorpus() {
  const [chunks, docs] = await Promise.all([getAllChunks(), getDocuments()]);
  const key = `${chunks.length}:${docs.map(d => `${d.id}@${d.updatedAt}`).join(',')}`;
  if (indexCache.key === key) return indexCache;
  const index = buildBm25Index(chunks.map(c => ({ id: c.id, text: c.text, heading: c.heading })));
  indexCache = { key, index, chunks, docs };
  return indexCache;
}

export function invalidateIndex() {
  indexCache = { key: null, index: null, chunks: null, docs: null };
  vectorCache = { key: null, vectors: null };
}

async function loadVectors(model) {
  const rows = await getVectors(model);
  const key = `${model}:${rows.length}:${rows[0]?.chunkId ?? 0}`;
  if (vectorCache.key === key) return vectorCache.vectors;
  vectorCache = { key, vectors: rows };
  return rows;
}

/**
 * 检索知识库
 * @param {string} query
 * @param {object} opts { topK, providerId, model, signal, useVector, useLexical }
 * @returns {Promise<{results:Array, mode:string, note:string|null}>}
 */
export async function retrieve(query, opts = {}) {
  const settings = { ...(await getRagSettings()), ...opts };
  const q = String(query || '').trim();
  if (!q) return { results: [], mode: 'empty', note: null };

  const corpus = await loadCorpus();
  if (!corpus.chunks.length) {
    return { results: [], mode: 'empty', note: '知识库为空' };
  }

  const candidateK = settings.candidateK || 40;
  const topK = settings.topK || 8;
  const rankings = [];
  let mode = 'lexical';
  let note = null;

  /* 词法召回 */
  if (settings.useLexical !== false) {
    const hits = bm25Search(corpus.index, q, candidateK);
    if (hits.length) rankings.push(hits);
  }

  /* 向量召回 */
  const vectorModel = settings.embeddingModel || null;
  const canVector = settings.useVector !== false && vectorModel;
  if (canVector) {
    try {
      const emb = await embedTexts([q], {
        providerId: settings.providerId || null,
        model: vectorModel,
        signal: opts.signal,
      });
      const vectors = await loadVectors(vectorModel);
      if (emb.vectors[0]?.length) {
        const hits = topKSimilar(vectors, emb.vectors[0], candidateK);
        if (hits.length) {
          rankings.push(hits);
          mode = rankings.length > 1 ? 'hybrid' : 'vector';
        }
      }
    } catch (e) {
      note = `向量检索不可用，已退化为词法检索：${e.message}`;
      console.warn('[rag] 向量检索失败:', e.message);
    }
  }

  if (!rankings.length) {
    return { results: [], mode: 'none', note: note || '未命中任何内容' };
  }

  const fused = rrfFuse(rankings, settings.rrfK || 60);
  const chunkById = new Map(corpus.chunks.map(c => [c.id, c]));
  const docById = new Map(corpus.docs.map(d => [d.id, d]));

  const results = [];
  for (const item of fused) {
    const chunk = chunkById.get(item.id);
    if (!chunk) continue;
    const doc = docById.get(chunk.docId);
    results.push({
      chunkId: chunk.id,
      docId: chunk.docId,
      text: chunk.text,
      heading: chunk.heading || '',
      score: item.score,
      docTitle: doc?.title || '未知文档',
      docKind: doc?.kind || 'text',
      source: doc?.source || '',
      docUrl: doc?.url || '',
    });
    if (results.length >= topK) break;
  }

  return { results, mode, note };
}

/**
 * 把检索结果格式化为可注入提示词的上下文块
 * @param {Array} results
 */
export function formatContext(results) {
  if (!results?.length) return '';
  return results.map((r, i) => {
    const title = r.docTitle + (r.heading ? ` › ${r.heading}` : '');
    const loc = r.docUrl ? `\n来源URL: ${r.docUrl}` : '';
    return `[S${i + 1}] 文档：${title}${loc}\n内容：\n${r.text}`;
  }).join('\n\n');
}

/**
 * 构造带引用的检索增强系统提示
 */
export function buildGroundedPrompt(context, opts = {}) {
  const citationRule = opts.requireCitation === false
    ? '请基于上述资料回答。'
    : '请基于上述资料回答，并在每个关键结论后用 [S1]、[S2] 形式标注信息来源编号；资料不足以支撑的内容请明确说明"资料未覆盖"。';
  return `你是一个严谨的知识库问答助手。你可以检索到用户私有的知识库资料。

使用规则：
1. 只依据【参考资料】中的内容回答，不要编造。
2. ${citationRule}
3. 参考资料之外的知识可以作为补充说明，但必须标注为"补充知识"而非资料结论。
4. 如果参考资料与问题无关，直接说明资料未覆盖该问题。

【参考资料】
${context}`;
}

/** 检索 + 生成上下文 的一站式封装 */
export async function retrieveContext(query, opts = {}) {
  const res = await retrieve(query, opts);
  return {
    ...res,
    context: formatContext(res.results),
    systemPrompt: res.results.length ? buildGroundedPrompt(formatContext(res.results), opts) : null,
  };
}
