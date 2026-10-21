import { escapeHtml, safeUrl } from './utils.js';

/* ─── Markdown v2 ───
 * 相比旧实现修复了：
 *   1. 代码块优先解析（原先行内 code 规则吃掉围栏，导致代码块永不生成 <pre>）
 *   2. 支持列表 / 表格 / 引用 / 分隔线 / 链接 / 图片 / 删除线
 *   3. 全部 HTML 转义，杜绝注入
 *   4. 引用标记 [S1] 渲染为可点击角标
 *   5. 链接 URL 经过协议白名单校验
 */

const PLACEHOLDER = '\u0000';

function makeStash() {
  const items = [];
  return {
    keep(html) {
      items.push(html);
      return `${PLACEHOLDER}${items.length - 1}${PLACEHOLDER}`;
    },
    restore(s) {
      return s.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (m, i) => items[Number(i)] ?? '');
    },
  };
}

/* ─── 行内解析 ─── */
function renderInline(raw, opts = {}) {
  const stash = makeStash();
  let s = escapeHtml(raw);

  /* 代码跨度 —— 最先处理，内容已转义 */
  s = s.replace(/(`+)([\s\S]*?)\1/g, (m, ticks, code) => {
    const lang = /^[^`]*$/.test(code) ? '' : '';
    return stash.keep(`<code${lang}>${code.replace(/^ | $/g, '')}</code>`);
  });

  /* 图片 */
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, url) => {
    const href = safeUrl(decodeURI(url));
    if (!href) return stash.keep(`<span class="md-broken-image">🖼 ${alt || '图片'}</span>`);
    return stash.keep(`<img class="md-img" src="${href}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`);
  });

  /* 显式链接 */
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, text, url) => {
    const href = safeUrl(decodeURI(url));
    if (!href) return text;
    const external = /^https?:/i.test(href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return stash.keep(`<a href="${href}"${attrs}>${text}</a>`);
  });

  /* 引用角标 [S1] / [1] */
  if (opts.citations !== false) {
    s = s.replace(/\[(S\d{1,3})\]/gi, (m, id) => stash.keep(
      `<span class="md-cite" data-cite="${id}" role="button" tabindex="0" title="查看引用来源">${id}</span>`,
    ));
  }

  /* 尖括号自动链接 */
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (m, url) => {
    const href = safeUrl(url);
    return href ? stash.keep(`<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`) : m;
  });

  /* 裸链接 */
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<>"'）]+[^\s<>"'）.,;:!?，。；：！？])/g, (m, pre, url) =>
    `${pre}${stash.keep(`<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`);

  /* 粗体 / 斜体 / 删除线 */
  s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');

  /* 硬换行 */
  s = s.replace(/ {2,}\n/g, '<br>\n');

  return stash.restore(s);
}

/* ─── 块级解析 ─── */
function parseBlocks(lines, opts) {
  const html = [];
  let i = 0;

  const isBlank = (l) => !l || !l.trim();

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    /* 围栏代码块 */
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (fence) {
      const marker = fence[1][0];
      const len = fence[1].length;
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === marker && close[1].length >= len) { i++; break; }
        buf.push(lines[i]);
        i++;
      }
      const code = buf.join('\n');
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      html.push(`<pre class="md-code"><code${cls}>${escapeHtml(code)}</code></pre>`);
      continue;
    }

    /* 缩进代码块（4 空格） */
    if (/^ {4}\S/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || isBlank(lines[i]))) {
        buf.push(lines[i].replace(/^ {4}/, ''));
        i++;
      }
      html.push(`<pre class="md-code"><code>${escapeHtml(buf.join('\n').replace(/\n+$/, ''))}</code></pre>`);
      continue;
    }

    /* 分隔线 */
    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      html.push('<hr class="md-hr">');
      i++;
      continue;
    }

    /* ATX 标题 */
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level} class="md-h md-h${level}">${renderInline(heading[2], opts)}</h${level}>`);
      i++;
      continue;
    }

    /* Setext 标题 */
    if (i + 1 < lines.length && !isBlank(line) && /^\s{0,3}(=+|-{2,})\s*$/.test(lines[i + 1]) && !/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
      const level = lines[i + 1].trim().startsWith('=') ? 1 : 2;
      html.push(`<h${level} class="md-h md-h${level}">${renderInline(line.trim(), opts)}</h${level}>`);
      i += 2;
      continue;
    }

    /* 引用块 */
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (!isBlank(lines[i]) && buf.length))) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      html.push(`<blockquote class="md-quote">${parseBlocks(buf, opts)}</blockquote>`);
      continue;
    }

    /* 表格 */
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c => {
        const t = c.trim();
        if (/^:.*:$/.test(t)) return 'center';
        if (/:$/.test(t)) return 'right';
        if (/^:/.test(t)) return 'left';
        return '';
      });
      i += 2;
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        body.push(splitRow(lines[i]));
        i++;
      }
      const th = header.map((c, ci) => `<th${aligns[ci] ? ` style="text-align:${aligns[ci]}"` : ''}>${renderInline(c.trim(), opts)}</th>`).join('');
      const rows = body.map(r => {
        const tds = header.map((_, ci) => `<td${aligns[ci] ? ` style="text-align:${aligns[ci]}"` : ''}>${renderInline((r[ci] || '').trim(), opts)}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      html.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }

    /* 列表 */
    if (/^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(line)) {
      const { html: listHtml, next } = parseList(lines, i, opts);
      html.push(listHtml);
      i = next;
      continue;
    }

    /* 段落 */
    const buf = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const l = lines[i];
      if (/^\s{0,3}(#{1,6})\s/.test(l)) break;
      if (/^\s{0,3}>/.test(l)) break;
      if (/^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(l)) break;
      if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) break;
      buf.push(l);
      i++;
    }
    if (buf.length) {
      html.push(`<p class="md-p">${renderInline(buf.join('\n'), opts)}</p>`);
    }
  }

  return html.join('\n');
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let escaped = false;
  for (const ch of s) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\') { cur += ch; escaped = true; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function parseList(lines, start, opts) {
  const baseIndent = (lines[start].match(/^\s*/) || [''])[0].length;
  let ordered = /^\s{0,3}\d{1,9}[.)]\s/.test(lines[start]);
  const items = [];
  let i = start;
  let cur = null;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      /* 空行：若下一行仍是同级列表则继续，否则结束 */
      const next = lines[i + 1];
      if (next && /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(next)) { i++; continue; }
      break;
    }
    const m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
    const indent = (line.match(/^\s*/) || [''])[0].length;

    if (m && indent <= baseIndent + 1) {
      if (cur) items.push(cur);
      const isOrdered = /\d/.test(m[2]);
      if (isOrdered !== ordered && items.length === 0) ordered = isOrdered;
      cur = { lines: [m[3]], indent };
    } else if (cur) {
      cur.lines.push(line.slice(Math.min(indent, cur.indent + 2)));
    }
    i++;
  }
  if (cur) items.push(cur);

  const tag = ordered ? 'ol' : 'ul';
  const rendered = items.map(it => {
    const inner = parseBlocks(it.lines, opts);
    return `<li>${inner}</li>`;
  }).join('');
  return { html: `<${tag} class="md-list md-list-${ordered ? 'ol' : 'ul'}">${rendered}</${tag}>`, next: i };
}

/**
 * 渲染 Markdown → HTML
 * @param {string} text
 * @param {object} opts { citations: boolean }
 */
export function renderMarkdown(text, opts = {}) {
  if (!text) return '';
  const normalized = String(text).replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  return parseBlocks(lines, opts);
}

/** 提取纯文本（用于摘要、搜索结果、token 估算） */
export function markdownToText(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 检测 markdown 是否包含代码块（用于决定是否启用高亮） */
export function hasCodeBlock(text) {
  return /```/.test(String(text || ''));
}
