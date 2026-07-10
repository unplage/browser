# AI Browser (GLM-4.7-Flash PWA)

## Quick start

```bash
python3 -m http.server 8080
# Open http://localhost:8080 → ⚙️ → enter Zhipu API Key
```

No build step. Pure HTML/CSS/JS — ES modules on the client, all dependencies loaded via CDN (Dexie.js 3.2.6, SortableJS 1.15.0, highlight.js 11.9.0). No bundler, no npm for the app itself (npm is only for Playwright tests).

## Commands

| Action | How |
|--------|-----|
| Dev server | `python3 -m http.server 8080` |
| Test | Start dev server first, then `npm install && npx playwright install firefox && node run-test.cjs` |
| Deploy | Push to GitHub Pages root (`main` branch, any domain works) |

## Architecture

- `/index.html` — app shell, CDN deps, CSP, PWA meta. **Entrypoint** for the app.
- `src/app.js` — coordinator: init (check IndexedDB → load modules → apply theme → render → register SW → bind events)
- `src/ui.js` — all DOM rendering (sidebar/grid/chat/modals/bookmarks/files/settings)
- `src/db.js` — Dexie wrapper with 8 tables: `modules`, `layout`, `bookmarks`, `searchResults`, `chatHistory`, `files`, `settings`, `presets`
- `src/api.js` — GLM-4 API wrapper (streaming SSE + web_search + file analysis + image multi-modal)
- `src/modules.js` — 13 default modules + custom module CRUD
- `src/styles.css` — glassmorphism UI with CSS variables, light/dark/system themes

State machine lives in `app.js` (`state` object). Callback flow: ui → app → api/db → ui.

## Test quirks

- Playwright with **Firefox only** (not Chromium).
- `run-test.cjs` and `package-lock.json` are `.gitignore`'d — they exist locally but are **not committed**.
- 17 test cases — DOM rendering, IndexedDB table count, modal open/close. No API key required.
- Dev server must be running at `localhost:8080` before running tests.

## GLM-4 API (`src/api.js`)

- **Base**: `https://open.bigmodel.cn/api/paas/v4/chat/completions` (configurable in settings)
- **Model**: `glm-4.7-flash` (default, free tier, 128K context); `glm-4.6v-flash` for vision
- **Auth**: Bearer token in `Authorization` header (API key stored in IndexedDB settings, no env var)
- **Streaming**: SSE via `response.body.getReader()`
- **Web search**: `tools: [{type: 'web_search', web_search: {enable: true, search_query: '...'}}]`
- **Rate limit**: ~1 req/s, 1 concurrent (free tier)
- **Parameters sent with every request**: `thinking: {type: 'enabled'}`, `do_sample: true`, `temperature: 1.0` (default), `top_p: 0.95` (default), `max_tokens: 131072`. All configurable in settings.
- **Image support**: When model name contains `'v'` (e.g. `glm-4.6v-flash`), last user message content becomes a multi-modal array with `image_url` + text.

## CSP constraints (`index.html` line 8)

- `connect-src: 'self' https://open.bigmodel.cn` — API base URL must be changed in both settings AND the CSP meta tag if using a different endpoint
- `img-src: 'self' data: https://www.google.com` — favicons come from `google.com/s2/favicons`
- `script-src: 'self' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`

## Service Worker (`sw.js`)

Dynamic `BASE_PATH` computed from SW URL (supports sub-path deployment). Cache version suffix is `v16` (line 9). Navigation (HTML): **network-first** → fallback to cache. Static resources (js/css/png/etc): **cache-first**. **Bump the `v16` suffix on any static asset change** to force re-cache.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Enter | Send message |
| Escape | Close modal / Abort streaming |
| Ctrl+K | Focus search input |
| Ctrl+N | Focus chat input |

## Module system

13 default modules (ids: `poetry`, `drug`, `english`, `reading`, `programming`, `leisure`, `baby`, `philosophy`, `tech`, `news`, `finance`, `futures`, `vision`). The `vision` module uses `glm-4.6v-flash` model. Custom modules use `custom_N` IDs. Default modules cannot be deleted (tracked in `deletedDefaults` setting — "deletion" just hides them). All modules share same ChatPanel — only `systemPrompt` differs. Model options: `['glm-4.7-flash', 'glm-4.6v-flash']`.

## File analysis

Supported text types: `.txt .md .json .csv .js .py .html .ts .jsx .tsx .css .xml .yaml .yml .log .ini .cfg`. Image files (`image/*`) are supported for vision model analysis. Binary files are not supported.

## IndexedDB (Dexie) — schema migrations

| Version | Changes |
|---------|---------|
| v1 | 7 tables: `modules`, `layout`, `bookmarks`, `searchResults`, `chatHistory`, `files`, `settings` |
| v2 | Added `presets` table |
| v3 | Added `folder` index to `bookmarks` |

Tables: `modules(id, title, enabled, position)`, `layout(id)`, `bookmarks(++id, url, title, tags, folder, createdAt)`, `searchResults(++id, query, savedAt)`, `chatHistory(++id, moduleId, createdAt)`, `files(++id, fileName, fileType, createdAt)`, `settings(key)`, `presets(++id, createdAt)`.

Data can be exported/imported via Settings panel (JSON backup covering modules, bookmarks, settings, search results, chat history, files).

## Coding conventions

- Vanilla JS with ES modules, no classes, no `this` binding
- `export function` only, callback flow: ui → app → api/db → ui
- Markdown rendered client-side with simple regex (`renderMarkdown` in `ui.js` — no link/table support)
- No comments beyond section headers
- UI labels, system prompts, and code comments are primarily Chinese
- Theme system via CSS `[data-theme="dark"]` attribute; themes: light, dark, system
