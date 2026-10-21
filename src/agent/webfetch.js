/* ─── 网页抓取与正文提取 ───
 * 直连优先（无 CORS 限制的站点），失败后依次回退到公共只读代理。
 */

const READER_PROXIES = [
  { id: 'jina', build: (url) => `https://r.jina.ai/${url}`, json: false },
  { id: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, json: false },
];

/** 从 HTML 提取可读正文 */
export function extractReadable(html, url = '') {
  let s = String(html || '');
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text, url };
}

function decodeEntities(s) {
  const map = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–',
  };
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : m;
    }
    return map[code] ?? m;
  });
}

/**
 * 抓取 URL 并返回可读正文
 * @param {string} url
 * @param {object} opts { signal, timeout, allowProxy }
 */
export async function fetchReadable(url, opts = {}) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    return { ok: false, error: '仅支持 http/https 链接', text: '', title: '' };
  }
  const timeout = opts.timeout || 20000;
  const allowProxy = opts.allowProxy !== false;

  const attempts = [
    { id: 'direct', url: raw, mode: 'html' },
    ...(allowProxy ? READER_PROXIES.map(p => ({ id: p.id, url: p.build(raw), mode: 'text' })) : []),
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const onAbort = () => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      let res;
      try {
        res = await fetch(attempt.url, {
          headers: {
            Accept: attempt.mode === 'html' ? 'text/html,application/xhtml+xml' : 'text/plain,text/markdown,*/*',
            'User-Agent': 'Mozilla/5.0 (compatible; AIBrowser/2.0)',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      if (!res.ok) {
        errors.push(`${attempt.id}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      if (attempt.mode === 'html') {
        const parsed = extractReadable(body, raw);
        if (parsed.text.length > 40) {
          return { ok: true, text: parsed.text, title: parsed.title, url: raw, via: attempt.id };
        }
        errors.push(`${attempt.id}: 正文过短`);
        continue;
      }
      if (body.trim().length > 40) {
        return { ok: true, text: body.trim(), title: '', url: raw, via: attempt.id };
      }
      errors.push(`${attempt.id}: 正文过短`);
    } catch (e) {
      errors.push(`${attempt.id}: ${e.message}`);
    }
  }

  return {
    ok: false,
    error: `抓取失败（${errors.join('；')}）`,
    text: '', title: '', url: raw,
  };
}
