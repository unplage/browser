/* ─── 文本分块 ───
 * 目标：语义完整（保留标题路径）、长度可控、带重叠，且对中文友好。
 */

import { estimateTokens } from '../core/tokens.js';

const DEFAULT_OPTS = {
  targetTokens: 400,
  maxTokens: 700,
  overlapTokens: 60,
  minTokens: 40,
};

/** 按标题层级切分，保留当前标题路径 */
function splitByHeadings(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let stack = [];
  let buf = [];
  let heading = '';

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || heading) {
      sections.push({ heading: stack.length ? stack.join(' › ') : heading, text: body });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      flush();
      const level = m[1].length;
      stack = stack.slice(0, level - 1);
      stack.push(m[2].trim());
      heading = m[2].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections.filter(s => s.text);
}

/** 把超长文本按句子切开 */
function splitLongText(text, maxTokens) {
  const sentences = text.match(/[^。！？!?\n；;]+[。！？!?；;]?/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && estimateTokens(cur + s) > maxTokens) {
      out.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * @param {string} text
 * @param {object} opts { targetTokens, maxTokens, overlapTokens, minTokens }
 * @returns {Array<{ord:number, heading:string, text:string, tokens:number}>}
 */
export function chunkText(text, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const src = String(text || '').trim();
  if (!src) return [];

  const sections = splitByHeadings(src);
  const chunks = [];

  for (const section of sections) {
    const blocks = section.text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    let cur = '';
    const pieces = [];

    for (const block of blocks) {
      if (estimateTokens(block) > o.maxTokens) {
        if (cur) { pieces.push(cur); cur = ''; }
        for (const part of splitLongText(block, o.maxTokens)) pieces.push(part);
        continue;
      }
      const candidate = cur ? `${cur}\n\n${block}` : block;
      if (estimateTokens(candidate) > o.targetTokens && cur) {
        pieces.push(cur);
        cur = block;
      } else {
        cur = candidate;
      }
    }
    if (cur) pieces.push(cur);

    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const tokens = estimateTokens(trimmed);
      if (tokens < o.minTokens && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        if (prev.heading === section.heading) {
          prev.text = `${prev.text}\n\n${trimmed}`;
          prev.tokens = estimateTokens(prev.text);
          continue;
        }
      }
      chunks.push({ ord: 0, heading: section.heading || '', text: trimmed, tokens });
    }
  }

  /* 重叠：把上一块尾部片段带到下一块开头 */
  if (o.overlapTokens > 0) {
    for (let i = 0; i < chunks.length - 1; i++) {
      const cur = chunks[i];
      const next = chunks[i + 1];
      if (cur.heading !== next.heading) continue;
      const tail = takeTail(cur.text, o.overlapTokens);
      if (tail && !next.text.startsWith(tail)) {
        next.text = `${tail}\n${next.text}`;
        next.tokens = estimateTokens(next.text);
      }
    }
  }

  return chunks.map((c, i) => ({ ...c, ord: i }));
}

function takeTail(text, tokens) {
  const chars = Math.max(40, Math.round(tokens * 2.2));
  if (text.length <= chars) return '';
  const tail = text.slice(-chars);
  const nl = tail.indexOf('\n');
  return nl >= 0 && nl < chars / 2 ? '' : tail;
}

/** 预览用：返回文档的章节结构 */
export function outline(text) {
  return splitByHeadings(text).map(s => ({ heading: s.heading, chars: s.text.length }));
}
