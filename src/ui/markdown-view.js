import { renderMarkdown } from '../core/markdown.js';
import { throttle } from '../core/utils.js';

/* ─── Markdown 渲染视图 ───
 * 负责：Markdown → HTML、代码高亮、引用角标点击、增量流式更新。
 */

const HLJS_THEMES = {
  light: './vendor/hljs-light.css',
  dark: './vendor/hljs-dark.css',
};

let themeLoaded = null;
let currentTheme = null;

/**
 * 注入 highlight.js 主题样式。
 * 不能用 index.html 里的 media="print" + onload 技巧 —— CSP 的 script-src-attr
 * 会拦截内联 onload，导致主题永远停在 print 媒体、代码不着色。
 * 这里改为脚本内创建 <link> 并直接设置 media 属性，不触发内联事件。
 */
export function ensureHighlightTheme(theme = 'light') {
  if (themeLoaded === theme) return themeLoaded;
  currentTheme = theme;
  let link = document.getElementById('hljsTheme');
  if (!link) {
    link = document.createElement('link');
    link.id = 'hljsTheme';
    link.rel = 'stylesheet';
    link.href = HLJS_THEMES[theme] || HLJS_THEMES.light;
    document.head.appendChild(link);
  } else {
    link.href = HLJS_THEMES[theme] || HLJS_THEMES.light;
  }
  link.media = 'all';
  themeLoaded = theme;
  return link;
}

export function highlightAll(container) {
  if (!container || !window.hljs) return;
  const blocks = container.querySelectorAll('pre code:not(.hljs)');
  blocks.forEach((block) => {
    try {
      window.hljs.highlightElement(block);
    } catch (e) {
      console.warn('[md] 高亮失败', e);
    }
  });
}

/**
 * 渲染 Markdown 到容器
 */
export function renderInto(container, text, opts = {}) {
  if (!container) return;
  container.innerHTML = renderMarkdown(text, opts);
  if (opts.highlight !== false) highlightAll(container);
  if (opts.onCitation) {
    container.querySelectorAll('.md-cite').forEach(node => {
      node.addEventListener('click', () => opts.onCitation(node.dataset.cite, node));
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onCitation(node.dataset.cite, node); }
      });
    });
  }
}

/**
 * 创建带节流的流式渲染器。
 * @param {HTMLElement} container
 * @param {object} opts { highlight, onCitation }
 */
export function createStreamRenderer(container, opts = {}) {
  const doRender = throttle(() => {
    renderInto(container, currentText, opts);
  }, 80);

  let currentText = '';

  return {
    append(chunk) {
      currentText += chunk;
      doRender();
    },
    set(text) {
      currentText = text;
      doRender();
    },
    flush() {
      renderInto(container, currentText, opts);
    },
    get text() { return currentText; },
  };
}

/**
 * 提取正文中出现的引用编号
 */
export function extractCitations(text) {
  const out = new Set();
  const re = /\[(S\d{1,3})\]/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.add(m[1].toUpperCase());
  return [...out];
}
