import {
  addDocument, addChunks, clearChunks, deleteDocument, getChunks, getDocument,
  getDocuments, saveVectors, updateDocument, getAllChunks,
} from '../db.js';
import { chunkText } from './chunk.js';
import { embedTexts, getRagSettings } from './embed.js';
import { buildVectorRecords } from './embed.js';
import { invalidateIndex } from './retrieve.js';

/* ─── 知识库入库流水线 ─── */

const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|c|cpp|h|hpp|sh|bash|zsh|sql|ini|cfg|conf|toml|log|txt|rst|tex|vue|svelte|php|rb|kt|swift|sql|graphql)$/i;

export function isTextFile(name, mime) {
  if (mime && (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')) return true;
  return TEXT_EXT.test(name || '');
}

export function detectKind(name, mime) {
  if (!name) return 'text';
  const ext = name.split('.').pop()?.toLowerCase();
  if (['md', 'markdown', 'txt', 'rst'].includes(ext)) return 'markdown';
  if (['json', 'jsonl', 'csv', 'tsv', 'xml', 'yaml', 'yml'].includes(ext)) return 'data';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'sh', 'sql'].includes(ext)) return 'code';
  return 'text';
}

/**
 * 清洗原始文本：去 HTML 标签、去多余空行、保留代码块结构
 */
export function cleanText(text, kind) {
  let s = String(text || '');
  if (kind === 'html') {
    s = s
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }
  return s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 入库一段文本
 * @param {object} opts
 *   title, text, kind, source, url, providerId, embeddingModel, embed (是否生成向量)
 * @returns {Promise<{document:object, chunks:number, vectors:number, note:string|null}>}
 */
export async function ingestText(opts = {}) {
  const title = (opts.title || '未命名文档').trim();
  const kind = opts.kind || detectKind(title, opts.mime);
  const text = cleanText(opts.text, kind);

  if (!text) {
    return { document: null, chunks: 0, vectors: 0, note: '内容为空，未入库' };
  }

  const settings = await getRagSettings();
  const doc = await addDocument({
    title,
    kind,
    source: opts.source || 'manual',
    url: opts.url || '',
    chars: text.length,
    mime: opts.mime || '',
    meta: opts.meta || null,
    status: 'indexing',
  });

  const chunks = chunkText(text, {
    targetTokens: settings.chunkTarget,
    overlapTokens: settings.chunkOverlap,
  });

  const records = await addChunks(doc.id, chunks);
  let vectorCount = 0;
  let note = null;

  const embeddingModel = opts.embeddingModel || settings.embeddingModel;
  if (opts.embed !== false && embeddingModel) {
    try {
      const emb = await embedTexts(records.map(r => r.text), {
        providerId: opts.providerId || settings.providerId || null,
        model: embeddingModel,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (emb.vectors.every(v => v?.length)) {
        const vecRecords = buildVectorRecords(records.map(r => r.id), emb.vectors, embeddingModel);
        await saveVectors(vecRecords);
        vectorCount = vecRecords.length;
      } else {
        note = '向量生成不完整，已仅建立词法索引';
      }
    } catch (e) {
      note = `向量生成失败（${e.message}），已仅建立词法索引`;
      console.warn('[rag] embedding 失败:', e.message);
    }
  } else {
    note = '未配置 Embedding 模型，已仅建立词法索引（BM25 仍可用）';
  }

  await dbUpdateDoc(doc.id, { status: 'ready', chunkCount: records.length, vectorCount, note });
  invalidateIndex();

  const updated = await getDocument(doc.id);
  return { document: updated, chunks: records.length, vectors: vectorCount, note };
}

async function dbUpdateDoc(id, changes) {
  return updateDocument(id, changes);
}

/**
 * 从 File 对象入库
 */
export async function ingestFile(file, opts = {}) {
  if (!file) return { document: null, chunks: 0, vectors: 0, note: '无文件' };
  if (!isTextFile(file.name, file.type)) {
    return {
      document: null, chunks: 0, vectors: 0,
      note: `不支持的文件类型：${file.name}。请上传文本类文件（md/txt/json/csv/code 等）。`,
    };
  }
  const maxBytes = opts.maxBytes || 8 * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      document: null, chunks: 0, vectors: 0,
      note: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB`,
    };
  }
  const text = await file.text();
  return ingestText({
    ...opts,
    title: opts.title || file.name,
    text,
    kind: detectKind(file.name, file.type),
    mime: file.type,
    source: opts.source || 'upload',
  });
}

/** 从 URL 入库（抓取正文） */
export async function ingestUrl(url, opts = {}) {
  const { fetchReadable } = await import('../agent/webfetch.js');
  const res = await fetchReadable(url, opts);
  if (!res.ok) {
    return { document: null, chunks: 0, vectors: 0, note: res.error || '抓取失败' };
  }
  return ingestText({
    ...opts,
    title: opts.title || res.title || url,
    text: res.text,
    kind: 'html',
    source: 'url',
    url,
  });
}

/** 重建某个文档的索引 */
export async function reindexDocument(id, opts = {}) {
  const doc = await getDocument(id);
  if (!doc) return { ok: false, note: '文档不存在' };
  const chunks = await getChunks(id);
  const settings = await getRagSettings();

  await clearChunks(id);
  const text = opts.text || doc.rawText || '';
  if (!text) return { ok: false, note: '文档缺少原文，无法重建' };

  const newChunks = chunkText(text, { targetTokens: settings.chunkTarget, overlapTokens: settings.chunkOverlap });
  const records = await addChunks(id, newChunks);

  const embeddingModel = opts.embeddingModel || settings.embeddingModel;
  let vectors = 0;
  if (embeddingModel) {
    try {
      const emb = await embedTexts(records.map(r => r.text), {
        providerId: opts.providerId || settings.providerId || null,
        model: embeddingModel,
      });
      if (emb.vectors.every(v => v?.length)) {
        await saveVectors(buildVectorRecords(records.map(r => r.id), emb.vectors, embeddingModel));
        vectors = records.length;
      }
    } catch (e) {
      console.warn('[rag] 重建向量失败:', e.message);
    }
  }
  await dbUpdateDoc(id, { chunkCount: records.length, vectorCount: vectors, status: 'ready' });
  invalidateIndex();
  return { ok: true, chunks: records.length, vectors };
}

/** 删除文档及其索引 */
export async function removeDocument(id) {
  await deleteDocument(id);
  invalidateIndex();
  return { ok: true };
}

/** 知识库统计 */
export async function knowledgeStats() {
  const docs = await getDocuments();
  const chunks = await getChunksOfAll();
  const settings = await getRagSettings();
  const byKind = {};
  docs.forEach(d => { byKind[d.kind] = (byKind[d.kind] || 0) + 1; });
  return {
    documents: docs.length,
    chunks: chunks.length,
    chars: docs.reduce((s, d) => s + (d.chars || 0), 0),
    byKind,
    vectorEnabled: !!settings.embeddingModel,
    embeddingModel: settings.embeddingModel,
  };
}

async function getChunksOfAll() {
  return getAllChunks();
}
