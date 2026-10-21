/* ─── 向量存储与相似度 ───
 * 采用 int8 量化存储，体积约为 float32 的 1/4，且余弦相似度计算结果等价
 * （缩放因子在归一化时约掉）。
 */

export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return s / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 量化 float 向量 → {q: Int8Array, scale} */
export function quantize(vec) {
  let max = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]);
    if (a > max) max = a;
  }
  const scale = max / 127 || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
  }
  return { q, scale };
}

/** 反量化 */
export function dequantize(q, scale) {
  const out = new Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
  return out;
}

/** 量化向量的余弦相似度（scale 自动约掉） */
export function cosineQuantized(qa, qb) {
  const n = Math.min(qa.length, qb.length);
  if (!n) return 0;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    s += qa[i] * qb[i];
    na += qa[i] * qa[i];
    nb += qb[i] * qb[i];
  }
  if (!na || !nb) return 0;
  return s / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 在候选集合中做 TopK 余弦检索
 * @param {Array<{chunkId:number, q:Int8Array}>} vectors
 * @param {number[]} queryVec
 * @param {number} topK
 */
export function topKSimilar(vectors, queryVec, topK = 20) {
  const qn = norm(queryVec);
  if (!qn) return [];
  const results = [];
  for (const v of vectors) {
    if (!v.q) continue;
    const s = cosineQuantized(v.q, queryVec) / qn;
    results.push({ id: v.chunkId, score: s });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 把 float 向量数组转成量化记录 */
export function toQuantizedRecords(chunkIds, vectors, model) {
  return chunkIds.map((chunkId, i) => {
    const v = vectors[i] || [];
    const { q, scale } = quantize(v);
    return { chunkId, model, dim: v.length, q, scale };
  });
}
