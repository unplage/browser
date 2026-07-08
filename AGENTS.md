# AGENTS.md — AI Browser (GLM-4.7-Flash PWA)

## Quick start

```bash
python3 -m http.server 8080
# Open http://localhost:8080
# Then: Settings → enter Zhipu API Key (free at https://open.bigmodel.cn)
```

## Architecture

Pure HTML/CSS/JS PWA — no build step. All data stored in browser IndexedDB via Dexie.js. GLM-4 API calls go directly to `open.bigmodel.cn` (CORS verified, GitHub Pages compatible).

## File layout

| File | Responsibility |
|------|---------------|
| `index.html` | App shell, CDN links (Dexie, SortableJS), PWA meta tags |
| `manifest.json` | PWA manifest (`display: standalone`) |
| `sw.js` | Service worker — cache-first for static assets |
| `src/app.js` | Coordinator: init, event binding, state machine |
| `src/ui.js` | All DOM rendering: sidebar, grid, chat, modals, bookmarks, file upload |
| `src/db.js` | Dexie wrapper — 6 tables (modules, bookmarks, searchResults, chatHistory, files, settings) |
| `src/api.js` | GLM-4 API: streaming SSE, web_search, file analysis |
| `src/modules.js` | 12 module definitions with system prompts, layout persistence |
| `src/styles.css` | Minimalist design — CSS variables, system font, macOS aesthetic |

## Key commands

| Action | How |
|--------|-----|
| Dev server | `python3 -m http.server 8080` |
| Test | `npm install && npx playwright install firefox && node run-test.cjs` |
| Deploy | Push to GitHub Pages (`gh-pages` or `main` root) |
| PWA test | Chrome DevTools → Application → Manifest / Service Workers |

## GLM-4 API

- **Base**: `https://open.bigmodel.cn/api/paas/v4`
- **Model**: `glm-4-flash` (free tier, 128K context, ~200K for 4.7 Flash)
- **Auth**: Bearer token in `Authorization` header
- **Streaming**: SSE via `response.body.getReader()`
- **Web search**: `web_search: true` in request body — built-in, no extra API key
- **CORS**: Verified — returns `Access-Control-Allow-Origin: <origin>` dynamically. Works from any domain including GitHub Pages.
- **Rate limit**: ~1 req/s, 1 concurrent (free tier)

## Module system

12 modules in `src/modules.js`. Each has `{ id, title, icon, systemPrompt, enabled, position }`. Users can:
- Edit prompts via UI (saved to IndexedDB)
- Drag to reorder (SortableJS)
- Enable/disable
- Reset to default prompts

All modules share the same `ChatPanel` component — only the systemPrompt differs.

## IndexedDB tables (Dexie)

| Table | Key | Value shape |
|-------|-----|-------------|
| `modules` | `id` | `{ id, title, icon, systemPrompt, enabled, position }` |
| `layout` | `'main'` | `{ cols, moduleOrder }` |
| `bookmarks` | autoIncr | `{ url, title, tags, createdAt }` |
| `searchResults` | autoIncr | `{ query, content, result, savedAt }` |
| `chatHistory` | autoIncr | `{ moduleId, messages[], createdAt }` |
| `files` | autoIncr | `{ fileName, fileType, content, analysis, createdAt }` |
| `settings` | key | `{ key, value }` |

## Coding conventions

- No frameworks — vanilla JS with ES modules (`type="module"`)
- `export function` not classes, no `this` binding issues
- All callbacks flow: ui renders → app.js handles → api/db does work → ui updates
- Markdown rendered client-side with simple regex (`renderMarkdown` in ui.js)
- No comments beyond section headers

## GitHub Pages deployment

1. Push files to repository root
2. GitHub repo Settings → Pages → deploy from `main` / (root)
3. No build step needed. SW will register automatically on HTTPS.
4. CORS confirmed working — no proxy required.
