/* ─── BM25 词法检索 ───
 * 中文用「单字 + 二元组」混合切分，兼顾召回与精度；英文按词切分。
 */

/* 高频中文虚词：单独出现时几乎不携带检索价值 */
const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '有', '就', '也', '与', '及', '对', '为', '而', '于',
  '这', '那', '我', '你', '他', '她', '它', '们', '个', '上', '下', '中', '之', '其',
  '并', '但', '或', '等', '被', '把', '给', '让', '从', '到', '要', '会', '能', '可',
  '不', '没', '很', '都', '再', '还', '又', '只', '更', '最', '很', '着', '过', '呢',
  '吗', '吧', '啊', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
]);

/** 分词：返回 token 数组 */
export function tokenize(text) {
  const tokens = [];
  const src = String(text || '').toLowerCase();
  const re = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[a-z0-9][a-z0-9_+#.-]*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const t = m[0];
    if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/.test(t)) {
      for (const ch of t) { if (!STOPWORDS.has(ch)) tokens.push(ch); }
      for (let i = 0; i < t.length - 1; i++) {
        const bg = t.slice(i, i + 2);
        if (!STOPWORDS.has(bg)) tokens.push(bg);
      }
    } else {
      if (t.length > 1 || /[a-z0-9]/.test(t)) tokens.push(t);
    }
  }
  return tokens;
}

/**
 * 构建 BM25 索引
 * @param {Array<{id:number, text:string, heading?:string}>} docs
 */
export function buildBm25Index(docs) {
  const postings = new Map();   // term -> Map(docId -> tf)
  const docLen = new Map();     // docId -> length
  let totalLen = 0;
  let df = 0;

  for (const doc of docs) {
    const tokens = tokenize(`${doc.heading || ''} ${doc.text}`);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [term, count] of tf) {
      if (!postings.has(term)) postings.set(term, new Map());
      postings.get(term).set(doc.id, count);
    }
    docLen.set(doc.id, tokens.length);
    totalLen += tokens.length;
    df++;
  }

  const avgdl = df ? totalLen / df : 0;
  const idf = new Map();
  for (const [term, map] of postings) {
    idf.set(term, Math.log(1 + (df - map.size + 0.5) / (map.size + 0.5)));
  }

  return { postings, docLen, avgdl, df, idf };
}

const K1 = 1.5;
const B = 0.75;

/**
 * BM25 检索
 * @param {object} index buildBm25Index 的结果
 * @param {string} query
 * @param {number} topK
 * @returns {Array<{id:number, score:number}>}
 */
export function bm25Search(index, query, topK = 20) {
  if (!index || !index.df) return [];
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const scores = new Map();
  const seen = new Set();
  for (const term of qTokens) {
    if (seen.has(term)) continue;
    seen.add(term);
    const map = index.postings.get(term);
    if (!map) continue;
    const idf = index.idf.get(term) || 0;
    for (const [docId, tf] of map) {
      const dl = index.docLen.get(docId) || 1;
      const denom = tf + K1 * (1 - B + (B * dl) / (index.avgdl || 1));
      const s = idf * ((tf * (K1 + 1)) / denom);
      scores.set(docId, (scores.get(docId) || 0) + s);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * RRF（Reciprocal Rank Fusion）融合多路排序
 * @param {Array<Array<{id:number, score?:number}>>} rankings
 * @param {number} k
 */
export function rrfFuse(rankings, k = 60) {
  const fused = new Map();
  rankings.forEach((list, rankIndex) => {
    list.forEach((item, pos) => {
      const key = item.id;
      const add = 1 / (k + pos + 1);
      fused.set(key, (fused.get(key) || 0) + add);
    });
  });
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/** 简单的字符级相似度（用于去重与近重复检测） */
export function similarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
