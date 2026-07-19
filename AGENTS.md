# AI Browser (Multi-Provider PWA)

## Quick start

```bash
python3 -m http.server 8080
# Open http://localhost:8080 → ⚙️ → configure API Key(s) in Provider settings
```

No build step. Pure HTML/CSS/JS — ES modules on the client, all dependencies loaded via CDN (Dexie.js 3.2.6, SortableJS 1.15.0, highlight.js 11.9.0). No bundler, no npm for the app itself (npm is only for Playwright tests).

## Commands

| Action | How |
|--------|-----|
| Dev server | `python3 -m http.server 8080` |
| Test | Start dev server first, then `npm install && npx playwright install firefox && node run-test.cjs` |
| Deploy | Push to GitHub Pages root (`master` branch, any domain works) |

## Architecture

- `/index.html` — app shell, CDN deps, CSP, PWA meta. **Entrypoint** for the app.
- `src/app.js` — coordinator: init (check IndexedDB → load modules → apply theme/font → render → register SW → update CSP → bind events)
- `src/ui.js` — all DOM rendering (sidebar/grid/chat/modals/bookmarks/files/settings/provider-cards)
- `src/db.js` — Dexie wrapper with 8 tables: `modules`, `layout`, `bookmarks`, `searchResults`, `chatHistory`, `files`, `settings`, `presets`
- `src/api.js` — multi-Provider API wrapper (dynamic param negotiation, streaming SSE, web_search, file analysis, image multi-modal). 3 built-in presets: Zhipu / DeepSeek / OpenAI.
- `src/modules.js` — 13 default modules + custom module CRUD (each module stores `providerId` + `model`)
- `src/styles.css` — glassmorphism UI with CSS variables, light/dark/system themes, `--font-size` variable

State machine lives in `app.js` (`state` object). Callback flow: ui → app → api/db → ui.

## Test quirks

- Playwright with **Firefox only** (not Chromium).
- `run-test.cjs` and `package-lock.json` are `.gitignore`'d — they exist locally but are **not committed**.
- 17 test cases — DOM rendering, IndexedDB table count, modal open/close. No API key required.
- Dev server must be running at `localhost:8080` before running tests.

## API (`src/api.js`) — Multi-Provider Architecture

3 built-in provider presets, stored in `DEFAULT_PROVIDERS`:

| Provider | ID | Default model | Models |
|----------|----|---------------|--------|
| 智谱 GLM | `zhipu` | `glm-4.7-flash` | `glm-4.7-flash`, `glm-4.6v-flash` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` | `deepseek-v4-flash`, `deepseek-v4-pro` |
| OpenAI | `openai` | `gpt-4o` | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o3`, `o4-mini` |

Providers stored in `db.settings` key `providers` as JSON array. Old `apiKey`/`apiBase`/`defaultModel`/`temperature`/`topP`/`doSample` settings auto-migrate to `zhipu` provider on first load.

### Param negotiation (`buildRequestBody()`)

Each provider declares supported params in its `params` map. `buildRequestBody()` only sends params that the provider supports, with values from: opts arg → stored user override → default.

| Param | Zhipu | DeepSeek | OpenAI |
|-------|-------|----------|--------|
| `temperature` | ✅ range 0-2 | ✅ range 0-2 | ✅ range 0-2 |
| `top_p` | ✅ range 0.01-1 | ✅ range 0.01-1 | ✅ range 0.01-1 |
| `max_tokens` | ✅ number | ✅ number | ✅ number |
| `thinking` | ✅ `{type: "enabled"}` | ✅ boolean | ❌ |
| `do_sample` | ✅ boolean | ❌ | ❌ |
| `reasoning_effort` | ❌ | ✅ select: `high`/`max` | ❌ |
| `web_search` | ✅ via `tools` | ❌ | ❌ |

- **Auth**: Bearer token per provider (API key stored in IndexedDB settings, no env var)
- **Streaming**: SSE via `response.body.getReader()`
- **Web search**: Zhipu-only via `tools: [{type: 'web_search', ...}]`
- **Image support**: When model name contains `'v'` (e.g. `glm-4.6v-flash`), last user message content becomes a multi-modal array with `image_url` + text
- **Rate limit**: Depends on provider's free tier

## CSP constraints (`index.html` line 8)

- `connect-src` is **dynamically updated** by `app.js` `updateCSP()` at init and on settings save — collects all provider API base hosts + `open.bigmodel.cn`. No manual CSP edit needed when adding providers.
- `img-src: 'self' data: https://www.google.com` — favicons come from `google.com/s2/favicons`
- `script-src: 'self' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`

## Service Worker (`sw.js`)

Dynamic `BASE_PATH` computed from SW URL (supports sub-path deployment). Cache version suffix is `v20` (line 9). Navigation (HTML): **network-first** → fallback to cache. Static resources (js/css/png/etc): **cache-first**. **Bump the `v20` suffix on any static asset change** to force re-cache.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Enter | Send message |
| Escape | Close modal / Abort streaming |
| Ctrl+K | Focus search input |
| Ctrl+N | Focus chat input |

## Module system

13 default modules (ids: `poetry`, `drug`, `english`, `reading`, `programming`, `leisure`, `baby`, `philosophy`, `tech`, `news`, `finance`, `futures`, `vision`). The `vision` module uses `glm-4.6v-flash` model. Custom modules use `custom_N` IDs. Default modules cannot be deleted (tracked in `deletedDefaults` setting — "deletion" just hides them). All modules share same ChatPanel — only `systemPrompt`, `providerId`, and `model` differ.

## File analysis

Supported text types: `.txt .md .json .csv .js .py .html .ts .jsx .tsx .css .xml .yaml .yml .log .ini .cfg`. Image files (`image/*`) are supported for vision model analysis. Binary files are not supported.

## Font size

Global font size adjustable via Settings → 字体大小 slider (10–24px). Stored in `db.settings` key `fontSize`. Applied via `--font-size` CSS custom property on `<html>`.

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
- `$()` helper = `document.getElementById`; use `element.querySelector()` when element is not yet in DOM
- Event binding on form elements before `showModal()` must use `form.querySelector()`, not `$()`
