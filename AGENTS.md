# AI Browser (Multi-Provider · RAG · Agent PWA)

## Quick start

```bash
python3 -m http.server 8080
# Open http://localhost:8080 → ⚙️ → configure an API Key in the provider panel
```

No build step. Pure HTML/CSS/JS — ES modules on the client. **All third-party deps are vendored in `vendor/`** (Dexie 3.2.6, SortableJS 1.15.0, highlight.js 11.9.0 + themes) — no CDN, fully offline-capable.

## Commands

| Action | How |
|--------|-----|
| Dev server | `python3 -m http.server 8080` |
| Unit tests | `npm test` (node:test, 62 cases) |
| E2E tests | start server first, then `npm run test:e2e` (Playwright + Firefox, 39 cases)) |
| Deploy | Push to GitHub Pages root (`master` branch) |

## Architecture

```
src/
├── app.js          # coordinator: init, state machine, event binding
├── db.js           # Dexie wrapper, 15 tables (v4), backup import/export
├── modules.js      # 14 default modules + custom module CRUD
├── core/
│   ├── engine.js   # conversation engine: LLM + RAG + Agent + context budget
│   ├── markdown.js # safe GFM renderer
│   ├── tokens.js   # token estimation + context compression/summarization
│   └── utils.js    # shared helpers
├── llm/
│   ├── index.js    # chat / streamChat / embed / listModels / testProvider
│   ├── protocols.js# openai | anthropic | gemini adapters
│   ├── params.js   # per-model param negotiation
│   ├── catalog.js  # known model capability table
│   ├── providers.js# provider presets + CRUD
│   ├── search.js   # web search backend dispatch
│   └── errors.js   # error normalization + retry/backoff
├── rag/            # chunk / bm25 / embed / vector / retrieve / ingest
├── agent/          # runtime (tool loop) / tools / webfetch / calc
└── ui/             # dom / modal / toast / grid / chat / search /
                    # settings / knowledge / sessions / bookmarks /
                    # module-editor / markdown-view
```

Callback flow: `ui → app → llm|rag|agent|db → ui`.
State machine lives in `app.js` (`state` object).

## Multi-protocol LLM layer

Three protocol adapters in `src/llm/protocols.js`:

| Protocol | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| `openai` | `{base}/chat/completions` | `Authorization: Bearer` | Covers Zhipu / DeepSeek / OpenAI / Kimi / Qwen / Groq / Ollama / LM Studio / any OpenAI-compatible API |
| `anthropic` | `{base}/messages` | `x-api-key` | system is top-level; tool results as `tool_result` blocks |
| `gemini` | `{base}/models/{model}:generateContent` | `x-goog-api-key` | `generationConfig`; tool results as `functionResponse` parts |

Unified streaming events: `text` / `reasoning` / `tool_call` / `tool_call_delta` / `usage` / `done` / `error`.

### Model capability catalog (`src/llm/catalog.js`)

Per-model: `context`, `maxOutput`, `vision`, `tools`, `reasoning`, `paramStyle`, `thinkingShape`, `effort[]`.

`paramStyle`:
- `standard` → `max_tokens`
- `openai-reasoning` → `max_completion_tokens` (o1/o3/o4-mini/gpt-5), drops `temperature`/`top_p`/penalties
- `anthropic` → `max_tokens` + `thinking.budget_tokens`
- `gemini` → `generationConfig.maxOutputTokens`

`thinkingShape`:
- `zhipu` → `{ type: 'enabled' | 'disabled' }` (Zhipu **and** DeepSeek both need the object form)
- `anthropic` → `{ type: 'enabled', budget_tokens }`

### Param negotiation rules (`src/llm/params.js`)

1. Only params the provider declares as `supported` are sent.
2. `max_tokens` is **clamped to the model's real max output** (e.g. `glm-4.6v-flash` → 32768).
3. Reasoning models switch to `max_completion_tokens` and ignore illegal sampling params.
4. `reasoning_effort` is only sent when the model supports it and the value is legal.
5. `thinking` is shaped per protocol; omitted entirely for models without reasoning.

## RAG pipeline

1. **Ingest** (`rag/ingest.js`): upload file / fetch URL / paste text → clean → store document
2. **Chunk** (`rag/chunk.js`): heading-aware, target 400 tokens, max 700, overlap 60, sentence splitting for oversized blocks
3. **Index**:
   - lexical: BM25 (`rag/bm25.js`) with CJK unigram+bigram tokenization and a small stopword list
   - vector: optional Embedding, stored int8-quantized (`rag/vector.js`) — ~4× smaller than float32
4. **Retrieve** (`rag/retrieve.js`): BM25 + vector → RRF fusion (k=60) → Top-K
5. **Ground** (`core/engine.js`): chunks injected as `[S1]`, `[S2]` … with a prompt that forbids fabrication and requires citation markers
6. **Degrade**: no Embedding configured → pure BM25, everything else unchanged

Sources are de-duplicated and rendered as a clickable list; clicking a `[S1]` badge scrolls to the source.

## Agent runtime

`src/agent/runtime.js` — loop: model → (tool calls) → execute → feed back → model → … until answer or budget exhausted.

- Native function calling for openai / anthropic / gemini
- Text fallback protocol for models without native tools:
  ```` ```tool {"name":"...","arguments":{...}} ``` ````
- Built-in tools: `knowledge_search`, `knowledge_list`, `web_search`, `web_fetch`, `calculator`, `current_time`, `search_history`
- Limits: `maxSteps` (default 6), `maxToolCalls` (default 12)
- Every call is recorded and rendered as an execution trace in the chat

## Context management

`core/tokens.js`:
- `estimateTokens` — CJK ~1.5 chars/token, ASCII ~4 chars/token
- `compressToBudget` — keeps system + recent turns, summarizes the dropped middle via the configured provider, then hard-truncates if still over budget

## Database (Dexie v4)

| Table | Purpose |
|-------|---------|
| `modules` | Module definitions (systemPrompt, providerId, model, group) |
| `sessions` | Conversation threads per module |
| `messages` | Individual messages (role, content, reasoning, meta) |
| `documents` | Knowledge base documents |
| `chunks` | Document chunks (docId, ord, heading, text) |
| `vectors` | int8-quantized embeddings (chunkId, model) |
| `toolRuns` | Agent execution traces |
| `usage` | Token accounting per session |
| `bookmarks` | Bookmarks (url, title, tags, folder) |
| `searchResults` | Saved search reports |
| `files` | Legacy upload records |
| `settings` | Key-value store (providers, theme, RAG/agent config) |
| `presets` | Module templates |
| `layout` | Reserved |
| `chatHistory` | Legacy (migrated to sessions/messages on v4 upgrade) |

Backup export/import covers all tables; API keys are masked on import by default.

## PWA

- `manifest.json` — real PNG icons (192 / 512 / maskable), `standalone`, shortcuts
- `sw.js` — version suffix `v3` (**bump it on any static asset change**)
  - install: precache app shell + every local ES module + vendored deps
  - navigate: network-first → cache fallback
  - static: cache-first with background revalidate
- CSP (`index.html`): `script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`; `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`

## Coding conventions

- Vanilla JS with ES modules, no classes, no `this` binding
- `export function` only, callback flow: ui → app → llm/rag/agent/db → ui
- Markdown rendered client-side by `core/markdown.js` (escape-first, allowlist)
- No comments beyond section headers
- UI labels, system prompts, and code comments are primarily Chinese
- Theme via CSS `[data-theme="dark"]`; themes: light, dark, system
- `$()` helper = `document.getElementById`, accepts `'id'` or `'#id'`
- Event binding on form elements before `showModal()` must use `form.querySelector()`, not `$()`

## Gotchas (fixed in v2 — keep them fixed)

- **Never send `max_tokens` blindly** — clamp to the model's `maxOutput`; reasoning models need `max_completion_tokens`
- **`thinking` is an object** for Zhipu/DeepSeek (`{type:'enabled'}`), not a boolean
- **Never let inline-code rules run before code-block rules** in the Markdown renderer — it eats the fence
- **Do not use `media="print" + onload=` for lazy CSS** — CSP `script-src-attr` blocks the inline handler and the stylesheet never applies
- **Do not let `innerHTML` overwrite a bubble that contains action buttons** — it destroys them
- **Sortable instances must be destroyed before re-creating** on the same element
- **Never put the sidebar collapse toggle inside the sidebar** — it slides out of reach when collapsed
- **Do not rely on a single global modal** — use the modal stack in `ui/modal.js`
