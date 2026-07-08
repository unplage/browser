# AI Browser (GLM-4.7-Flash PWA)

## Quick start

```bash
python3 -m http.server 8080
# Open http://localhost:8080 → Settings → enter Zhipu API Key
```

## Architecture

Pure HTML/CSS/JS PWA — no build step. All data in IndexedDB via Dexie.js (CDN). GLM-4 API calls go directly to `open.bigmodel.cn`.

## Key commands

| Action | How |
|--------|-----|
| Dev server | `python3 -m http.server 8080` |
| Test | Start dev server first, then `npm install && npx playwright install firefox && node run-test.cjs` |
| Deploy | Push to GitHub Pages (any domain, CORS pre-verified) |

## Test quirks

- Tests are Playwright with **Firefox only** (not Chromium).
- `run-test.cjs` and `package-lock.json` are in `.gitignore` — they exist locally but are **not committed**.
- Tests verify DOM rendering, IndexedDB table count (7), and modal open/close. No API key is needed.

## GLM-4 API

- **Base**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **Model**: `glm-4.7-flash` (free tier, 128K context)
- **Auth**: Bearer token in `Authorization` header (API key stored in IndexedDB, no env var)
- **Streaming**: SSE via `response.body.getReader()`
- **Web search**: `tools: [{type: 'web_search', web_search: {enable: true, search_query: '...'}}]` — not a flat boolean
- **Rate limit**: ~1 req/s, 1 concurrent (free tier)

## Module system

12 default modules + custom modules in `src/modules.js` (`modules/`). Custom IDs use `custom_N` prefix. Default modules cannot be deleted. All modules share the same `ChatPanel` — only `systemPrompt` differs.

## Service Worker

Cache-first for `index.html`, `manifest.json`, `favicon.svg`, and all `/src/*` paths. Cache key: `ai-browser-v5` (in `sw.js:1`) — **bump on static asset changes**.

## File analysis

Text-only file types: `.txt .md .json .csv .js .py .html .ts .jsx .tsx .css .xml .yaml .yml .log .ini .cfg`. Binary files are not supported.

## IndexedDB tables (Dexie)

| Table | Key | Notes |
|-------|-----|-------|
| `modules` | `id` | Also indexed: `title, enabled, position` |
| `layout` | `'main'` | Singleton (`{ cols, moduleOrder }`) |
| `bookmarks` | autoIncr | Indexed: `url, title, tags, createdAt` |
| `searchResults` | autoIncr | Indexed: `query, savedAt` |
| `chatHistory` | autoIncr | Indexed: `moduleId, createdAt` |
| `files` | autoIncr | Indexed: `fileName, fileType, createdAt` |
| `settings` | `key` | Key-value store |

## Coding conventions

- Vanilla JS with ES modules (`type="module"`), no classes, no `this` binding
- `export function`, callbacks flow: ui → app → api/db → ui
- Markdown rendered client-side with simple regex (`renderMarkdown` in `ui.js` — limited, no link/table support)
- No comments beyond section headers
- Language: primarily Chinese (UI labels, system prompts, code comments)
