import { embed } from '../llm/index.js';
import { getSetting, setSetting } from '../db.js';
import { toQuantizedRecords } from './vector.js';

/* ─── Embedding 生成与缓存 ─── */

const memCache = new Map();

function hashKey(text, model) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2246822519) >>> 0;
  }
  return `${model}:${h1.toString(36)}${h2.toString(36)}:${text.length}`;
}

/**
 * 批量生成 embedding，带内存缓存（相同文本不重复请求）
 * @param {string[]} texts
 * @param {object} opts { providerId, model, batchSize, signal, onProgress }
 * @returns {Promise<{vectors: number[][], model: string, providerId: string, cached: number}>}
 */
export async function embedTexts(texts, opts = {}) {
  const list = (texts || []).filter(t => t && t.trim());
  if (!list.length) return { vectors: [], model: opts.model || '', providerId: opts.providerId || '', cached: 0 };

  const providerId = opts.providerId || (await getSetting('ragProviderId')) || null;
  const model = opts.model || (await getSetting('ragEmbeddingModel')) || null;

  const results = new Array(list.length).fill(null);
  const pending = [];
  let cached = 0;

  list.forEach((t, i) => {
    const key = hashKey(t, model || 'default');
    if (memCache.has(key)) { results[i] = memCache.get(key); cached++; }
    else pending.push({ i, text: t, key });
  });

  if (!pending.length) {
    return { vectors: results, model, providerId, cached };
  }

  const batchSize = opts.batchSize || 16;
  let done = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const out = await embed(batch.map(b => b.text), { providerId, model, signal: opts.signal });
    batch.forEach((b, j) => {
      const vec = out.vectors[j] || [];
      results[b.i] = vec;
      memCache.set(b.key, vec);
    });
    done += batch.length;
    opts.onProgress?.(done, pending.length);
  }

  return { vectors: results, model: out?.model || model, providerId, cached };
}

export function clearEmbedCache() {
  memCache.clear();
}

/** RAG 相关设置 */
export async function getRagSettings() {
  const raw = await getSetting('ragSettings');
  const base = {
    enabled: true,
    providerId: null,
    embeddingModel: '',
    topK: 8,
    candidateK: 40,
    useVector: true,
    useLexical: true,
    rrfK: 60,
    chunkTarget: 400,
    chunkOverlap: 60,
    minScore: 0,
  };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
}

export async function saveRagSettings(patch) {
  const cur = await getRagSettings();
  const next = { ...cur, ...patch };
  await setSetting('ragSettings', JSON.stringify(next));
  return next;
}

/** 生成入库用的量化向量记录 */
export function buildVectorRecords(chunkIds, vectors, model) {
  return toQuantizedRecords(chunkIds, vectors, model || 'default');
}
