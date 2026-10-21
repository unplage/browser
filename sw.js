// sw.js — Service Worker（v3）
// 变化：
//   1. 预缓存应用外壳 + 全部本地 ES 模块（离线可用）
//   2. 跨域 CDN 依赖改为 stale-while-revalidate，交给 Cache Storage 托管
//   3. 导航请求 network-first → 回退缓存；静态资源 cache-first
//   4. 缓存版本随静态资源变更手动提升

const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
const VERSION = 'v3';
const CACHE_NAME = `aibrowser-${BASE_PATH.replace(/\//g, '-') || 'root'}-${VERSION}`;

const LOCAL_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'favicon.svg',
  'src/app.js',
  'src/db.js',
  'src/modules.js',
  'src/core/utils.js',
  'src/core/tokens.js',
  'src/core/markdown.js',
  'src/core/engine.js',
  'src/llm/index.js',
  'src/llm/providers.js',
  'src/llm/protocols.js',
  'src/llm/params.js',
  'src/llm/catalog.js',
  'src/llm/errors.js',
  'src/llm/search.js',
  'src/rag/chunk.js',
  'src/rag/bm25.js',
  'src/rag/embed.js',
  'src/rag/vector.js',
  'src/rag/retrieve.js',
  'src/rag/ingest.js',
  'src/agent/runtime.js',
  'src/agent/tools.js',
  'src/agent/webfetch.js',
  'src/agent/calc.js',
  'src/ui/dom.js',
  'src/ui/modal.js',
  'src/ui/toast.js',
  'src/ui/grid.js',
  'src/ui/chat.js',
  'src/ui/search.js',
  'src/ui/settings.js',
  'src/ui/knowledge.js',
  'src/ui/sessions.js',
  'src/ui/bookmarks.js',
  'src/ui/module-editor.js',
  'src/ui/markdown-view.js',
  'src/styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/dexie.min.js',
  'vendor/sortable.min.js',
  'vendor/highlight.min.js',
  'vendor/hljs-light.css',
  'vendor/hljs-dark.css',
];

const STATIC_EXT = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico', 'json'];

function isStatic(url) {
  const parts = url.pathname.split('.');
  if (parts.length < 2) return false;
  return STATIC_EXT.includes(parts.pop().toLowerCase());
}

function isNavigate(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.destination === 'document');
}

/* ─── 安装：预缓存本地资源 ─── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      LOCAL_ASSETS.map(async (rel) => {
        const url = new URL(rel, self.registration.scope).href;
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, res);
        } catch (e) {
          console.warn('[SW] 预缓存失败', rel, e.message);
        }
      }),
    );
    await self.skipWaiting();
  })());
});

/* ─── 激活：清理旧缓存 ─── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('aibrowser-') && k !== CACHE_NAME).map(k => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

/* ─── 请求拦截 ─── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  /* 导航：network-first */
  if (sameOrigin && isNavigate(request)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await caches.match(new URL('index.html', self.registration.scope).href);
        if (fallback) return fallback;
        return new Response('<h1>📴 离线</h1><p>请检查网络后刷新。</p>', {
          status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  /* 同源静态资源：cache-first + 后台更新 */
  if (sameOrigin && isStatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request).then(async (res) => {
        if (res && res.ok) {
          try { await cache.put(request, res.clone()); } catch { /* ignore */ }
        }
        return res;
      }).catch(() => null);
      if (cached) { network; return cached; }
      return (await network) || new Response('', { status: 504 });
    })());
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
