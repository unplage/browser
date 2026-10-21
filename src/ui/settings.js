import { el, clear, field, select, input, checkbox } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { notify } from './toast.js';
import { PROTOCOL_LIST } from '../llm/protocols.js';
import { PARAM_SCHEMA } from '../llm/params.js';
import { resolveModel } from '../llm/catalog.js';
import { createProviderFromTemplate, isBuiltinProvider } from '../llm/providers.js';
import { testProvider, listModels } from '../llm/index.js';

/* ─── 设置面板 ─── */

const TABS = [
  { id: 'providers', label: '🤖 模型服务商' },
  { id: 'agent', label: '🧠 Agent' },
  { id: 'rag', label: '📚 知识库 / RAG' },
  { id: 'search', label: '🔍 搜索与抓取' },
  { id: 'appearance', label: '🎨 外观' },
  { id: 'data', label: '💾 数据' },
];

export async function openSettings(opts = {}) {
  const providers = opts.providers || [];
  const settings = opts.settings || {};
  const body = el('div', { class: 'settings-panel' });
  const tabsBar = el('div', { class: 'settings-tabs' });

  const panels = {};
  const show = (id) => {
    Object.entries(panels).forEach(([k, node]) => { node.style.display = k === id ? '' : 'none'; });
    tabsBar.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  };

  TABS.forEach(t => {
    const b = el('button', { class: 'settings-tab', dataset: { id: t.id }, onclick: () => show(t.id) }, t.label);
    tabsBar.appendChild(b);
  });

  panels.providers = buildProvidersPanel(providers, opts);
  panels.agent = buildAgentPanel(opts.agentSettings || {});
  panels.rag = buildRagPanel(opts.ragSettings || {});
  panels.search = buildSearchPanel(opts.searchConfig || {});
  panels.appearance = buildAppearancePanel(opts.theme || 'light', opts.fontSize || 14);
  panels.data = buildDataPanel(opts);

  body.appendChild(tabsBar);
  const content = el('div', { class: 'settings-content' });
  Object.values(panels).forEach(p => content.appendChild(p));
  body.appendChild(content);

  const footer = el('div', { class: 'modal-footer-row' });
  const saveBtn = el('button', { class: 'ui-btn ui-btn-primary' }, '保存设置');
  footer.appendChild(saveBtn);

  const modal = openModal({ title: '⚙️ 设置', body, footer, size: 'xl' });

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await opts.onSave?.({
        providers: panels.providers.__collect(),
        agent: panels.agent.__collect(),
        rag: panels.rag.__collect(),
        search: panels.search.__collect(),
        theme: panels.appearance.__collect().theme,
        fontSize: panels.appearance.__collect().fontSize,
      });
      notify.success('设置已保存');
      modal.close();
    } catch (e) {
      notify.error(`保存失败：${e.message}`);
    } finally {
      saveBtn.disabled = false;
    }
  };

  show('providers');
  return modal;
}

/* ─── Provider 面板 ─── */
function buildProvidersPanel(providers, opts) {
  const wrap = el('div', { class: 'settings-providers' });
  const list = el('div', { class: 'provider-list' });
  wrap.appendChild(list);

  const cards = [];

  const render = () => {
    clear(list);
    cards.length = 0;
    providers.forEach((p, i) => {
      const card = buildProviderCard(p, providers, {
        onDelete: async () => {
          const ok = await confirmDialog(`确认删除 Provider「${p.name}」？`, { danger: true, okText: '删除' });
          if (!ok) return;
          providers.splice(providers.findIndex(x => x.id === p.id), 1);
          render();
        },
        onChanged: () => opts.onProviderChanged?.(),
      });
      cards.push(card);
      list.appendChild(card);
    });
  };
  render();

  const addBtn = el('button', { class: 'ui-btn ui-btn-primary', onclick: () => {
    const tpl = createProviderFromTemplate('zhipu');
    if (!tpl) return;
    tpl.id = `custom_${Date.now().toString(36)}`;
    tpl.name = '自定义 Provider';
    tpl.apiBase = 'https://';
    tpl.defaultModel = '';
    tpl.models = [];
    providers.push(tpl);
    render();
  } }, '➕ 添加 Provider');
  wrap.appendChild(addBtn);

  const tmplWrap = el('div', { class: 'provider-templates' }, [el('span', { class: 'pt-label', text: '从模板添加：' })]);
  ['zhipu', 'deepseek', 'openai', 'anthropic', 'gemini', 'moonshot', 'dashscope', 'siliconflow', 'groq', 'ollama', 'lmstudio'].forEach(id => {
    tmplWrap.appendChild(el('button', {
      class: 'ui-chip',
      onclick: () => {
        const t = createProviderFromTemplate(id);
        if (!t) return;
        t.id = `${id}_${Date.now().toString(36)}`;
        providers.push(t);
        render();
      },
    }, id));
  });
  wrap.appendChild(tmplWrap);

  wrap.__collect = () => cards.map(c => c.__collect());
  return wrap;
}

function buildProviderCard(p, allProviders, cb = {}) {
  const card = el('div', { class: 'provider-card' });
  const header = el('div', { class: 'provider-card-header' }, [
    el('span', { class: 'pc-dot', text: p.apiKey ? '🟢' : '⚪' }),
    el('strong', { class: 'pc-name', text: p.name || p.id }),
    el('span', { class: 'pc-protocol', text: p.protocol || 'openai' }),
    el('span', { class: 'pc-spacer' }),
  ]);
  const toggle = el('button', { class: 'pc-toggle', title: '展开/收起' }, '▾');
  header.appendChild(toggle);
  card.appendChild(header);

  const body = el('div', { class: 'provider-card-body' });
  card.appendChild(body);

  const state = {
    id: p.id,
    name: p.name,
    protocol: p.protocol || 'openai',
    apiBase: p.apiBase,
    apiKey: p.apiKey || '',
    defaultModel: p.defaultModel || '',
    models: [...(p.models || [])],
    capabilities: { ...(p.capabilities || { vision: false, tools: true, webSearch: false }) },
    search: p.search ? { ...p.search } : null,
    headers: { ...(p.headers || {}) },
    params: JSON.parse(JSON.stringify(p.params || {})),
  };

  /* 名称 / 协议 */
  const nameInput = input(state.name, v => { state.name = v; });
  const protocolSel = select(
    PROTOCOL_LIST.map(pr => ({ value: pr.id, label: pr.label })),
    state.protocol,
    v => {
      state.protocol = v;
      body.appendChild(buildFields());
      renderCapabilityHint();
    },
  );

  body.appendChild(field('名称', nameInput));
  body.appendChild(field('协议', protocolSel, 'OpenAI 兼容 / Anthropic / Gemini 三种协议，决定请求格式与流式解析方式'));

  /* 动态字段 */
  let fieldsHost = el('div', { class: 'provider-fields' });
  body.appendChild(fieldsHost);
  let capabilityHint = el('div', { class: 'provider-hint' });
  body.appendChild(capabilityHint);

  const buildFields = () => {
    clear(fieldsHost);
    const baseInput = input(state.apiBase, v => { state.apiBase = v; });
    const keyInput = el('input', { class: 'ui-input', type: 'password', value: state.apiKey, placeholder: 'sk-…' });
    keyInput.addEventListener('input', () => { state.apiKey = keyInput.value; });

    const modelInput = input(state.defaultModel, v => { state.defaultModel = v; });
    const modelListInput = input(state.models.join(', '), v => {
      state.models = v.split(',').map(s => s.trim()).filter(Boolean);
    });

    fieldsHost.appendChild(field('API 地址', baseInput));
    fieldsHost.appendChild(field('API Key', keyInput));
    fieldsHost.appendChild(field('默认模型', modelInput));
    fieldsHost.appendChild(field('模型列表（逗号分隔）', modelListInput));

    /* 模型能力提示 */
    const caps = el('div', { class: 'model-cap-box' });
    fieldsHost.appendChild(caps);
    const updateCaps = () => {
      clear(caps);
      const m = resolveModel(state.defaultModel || state.models[0] || '');
      caps.appendChild(el('div', { class: 'mc-line', text: `能力：上下文 ${m.context} · 最大输出 ${m.maxOutput}${m.source === 'inferred' ? '（推断值）' : ''}` }));
      caps.appendChild(el('div', { class: 'mc-line', text: `视觉：${m.vision ? '✅' : '❌'}　工具调用：${m.tools ? '✅' : '❌'}　思考：${m.reasoning ? '✅' : '❌'}` }));
      if (m.paramStyle === 'openai-reasoning') {
        caps.appendChild(el('div', { class: 'mc-line mc-warn', text: '⚠️ 推理模型将自动使用 max_completion_tokens' }));
      }
      if (state.defaultModel && m.maxOutput < 32768) {
        caps.appendChild(el('div', { class: 'mc-line mc-warn', text: `⚠️ 该模型最大输出 ${m.maxOutput}，「最大输出」会被自动夹取` }));
      }
    };
    modelInput.addEventListener('input', updateCaps);
    updateCaps();

    /* 拉取远端模型 */
    const fetchRow = el('div', { class: 'provider-row' }, [
      el('button', { class: 'ui-btn ui-btn-ghost', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '拉取中…';
        try {
          const models = await listModels(state.id);
          if (!models.length) throw new Error('未返回模型');
          state.models = [...new Set([...state.models, ...models])];
          modelListInput.value = state.models.join(', ');
          notify.success(`已拉取 ${models.length} 个模型`);
        } catch (err) {
          notify.warning(`拉取模型失败：${err.message}`);
        } finally {
          b.disabled = false;
          b.textContent = '🔄 拉取模型列表';
        }
      } }, '🔄 拉取模型列表'),
    ]);
    fieldsHost.appendChild(fetchRow);

    /* 连通性测试 */
    const testRow = el('div', { class: 'provider-row' }, [
      el('button', { class: 'ui-btn ui-btn-ghost', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '测试中…';
        const res = await testProvider(state.id, { model: state.defaultModel });
        b.disabled = false;
        b.textContent = '🩺 测试连接';
        if (res.ok) notify.success(`${p.name}：${res.message}${res.reply ? ` — ${res.reply}` : ''}`);
        else notify.error(`${p.name}：${res.message}${res.hint ? `\n${res.hint}` : ''}`);
      } }, '🩺 测试连接'),
    ]);
    fieldsHost.appendChild(testRow);

    /* 能力开关 */
    const capsRow = el('div', { class: 'cap-toggles' }, [
      el('label', {}, [checkbox(state.capabilities.vision, v => { state.capabilities.vision = v; }), el('span', { text: '视觉' })]),
      el('label', {}, [checkbox(state.capabilities.tools, v => { state.capabilities.tools = v; }), el('span', { text: '工具调用' })]),
      el('label', {}, [checkbox(state.capabilities.webSearch, v => { state.capabilities.webSearch = v; }), el('span', { text: '联网搜索' })]),
    ]);
    fieldsHost.appendChild(field('能力标记', capsRow, '影响 UI 中联网/Agent 开关的可用性与提示'));

    /* 参数配置 */
    fieldsHost.appendChild(buildParamsSection(state));

    /* 搜索配置 */
    fieldsHost.appendChild(buildProviderSearchSection(state));
  };

  const renderCapabilityHint = () => {
    clear(capabilityHint);
    const proto = PROTOCOL_LIST.find(x => x.id === state.protocol);
    capabilityHint.appendChild(el('div', { class: 'ph-line', text: `协议：${proto?.label || state.protocol}` }));
    if (state.protocol === 'anthropic') {
      capabilityHint.appendChild(el('div', { class: 'ph-line', text: '· system 单独作为顶层字段；工具结果以 tool_result 块回传' }));
    } else if (state.protocol === 'gemini') {
      capabilityHint.appendChild(el('div', { class: 'ph-line', text: '· 使用 x-goog-api-key 鉴权；输出上限走 generationConfig' }));
    } else {
      capabilityHint.appendChild(el('div', { class: 'ph-line', text: '· Bearer 鉴权；兼容绝大多数第三方 OpenAI 格式服务' }));
    }
  };

  buildFields();
  renderCapabilityHint();

  toggle.onclick = () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    toggle.textContent = open ? '▾' : '▴';
  };

  if (!isBuiltinProvider(p.id)) {
    header.appendChild(el('button', { class: 'ui-btn ui-btn-danger ui-btn-xs', onclick: () => cb.onDelete?.() }, '删除'));
  }

  card.__collect = () => ({ ...state });
  return card;
}

function buildParamsSection(state) {
  const wrap = el('div', { class: 'params-section' });
  wrap.appendChild(el('div', { class: 'section-title', text: '参数配置' }));

  Object.entries(PARAM_SCHEMA).forEach(([key, def]) => {
    if (!state.params[key]) {
      state.params[key] = { ...def, supported: false };
      return;
    }
    const cfg = state.params[key];
    cfg.type = cfg.type || def.type;
    if (def.min !== undefined && cfg.min === undefined) cfg.min = def.min;
    if (def.max !== undefined && cfg.max === undefined) cfg.max = def.max;
    if (def.step !== undefined && cfg.step === undefined) cfg.step = def.step;
    if (def.options && !cfg.options) cfg.options = def.options;

    const row = el('div', { class: 'param-row' });
    const enable = checkbox(cfg.supported !== false, v => {
      cfg.supported = v;
      ctrl.disabled = !v;
      row.classList.toggle('param-off', !v);
    });
    row.appendChild(el('span', { class: 'param-name', text: def.label || key }));
    row.appendChild(enable);

    let ctrl;
    if (def.type === 'range') {
      const span = el('span', { class: 'param-val', text: String(cfg.stored ?? cfg.default ?? def.default) });
      ctrl = el('input', {
        type: 'range', class: 'param-range',
        min: def.min ?? 0, max: def.max ?? 1, step: def.step ?? 0.05,
        value: cfg.stored ?? cfg.default ?? def.default,
      });
      ctrl.oninput = () => {
        span.textContent = ctrl.value;
        cfg.stored = parseFloat(ctrl.value);
      };
      row.appendChild(ctrl);
      row.appendChild(span);
    } else if (def.type === 'number') {
      ctrl = el('input', { type: 'number', class: 'ui-input param-number', value: cfg.stored ?? cfg.default ?? def.default });
      ctrl.oninput = () => { cfg.stored = parseInt(ctrl.value, 10); };
      row.appendChild(ctrl);
    } else if (def.type === 'boolean') {
      ctrl = checkbox(cfg.stored ?? cfg.default ?? false, v => { cfg.stored = v; });
      row.appendChild(el('span', { class: 'param-lbl', text: cfg.stored ?? cfg.default ? '启用' : '关闭' }));
      row.appendChild(ctrl);
    } else if (def.type === 'select') {
      ctrl = select(def.options || [], cfg.stored ?? cfg.default ?? '', v => { cfg.stored = v; });
      row.appendChild(ctrl);
    } else {
      ctrl = el('input', { class: 'ui-input', value: cfg.stored ?? cfg.default ?? '' });
      ctrl.oninput = () => { cfg.stored = ctrl.value; };
      row.appendChild(ctrl);
    }
    if (cfg.supported === false) { ctrl.disabled = true; row.classList.add('param-off'); }
    wrap.appendChild(row);
  });

  wrap.appendChild(el('div', { class: 'section-hint', text: '· 参数仅在该 Provider 支持时才会随请求发送；输出长度会自动夹取到模型上限' }));
  return wrap;
}

function buildProviderSearchSection(state) {
  const wrap = el('div', { class: 'params-section' });
  wrap.appendChild(el('div', { class: 'section-title', text: '搜索配置' }));

  const modeSel = select([
    { value: 'none', label: '不使用该 Provider 的原生搜索' },
    { value: 'native', label: '使用该 Provider 的原生搜索' },
  ], state.search?.mode || 'none', v => {
    if (v === 'none') state.search = null;
    else state.search = { ...(state.search || {}), mode: v, engine: state.search?.engine || 'search_std', count: state.search?.count || 5 };
    renderBody();
  });

  wrap.appendChild(field('模式', modeSel));

  if (state.search) {
    const engineInput = input(state.search.engine || '', v => { state.search.engine = v; });
    const countInput = el('input', { type: 'number', class: 'ui-input param-number', value: state.search.count || 5, min: 1, max: 20 });
    countInput.oninput = () => { state.search.count = parseInt(countInput.value, 10); };
    wrap.appendChild(field('搜索引擎标识', engineInput, '智谱：search_std / search_pro / search_pro_sogou / search_pro_quark'));
    wrap.appendChild(field('返回条数', countInput));
  }

  function renderBody() {
    const parent = wrap.parentNode;
    if (!parent) return;
    const idx = [...parent.children].indexOf(wrap);
    const fresh = buildProviderSearchSection(state);
    parent.replaceChild(fresh, wrap);
  }
  return wrap;
}

/* ─── Agent 面板 ─── */
function buildAgentPanel(cfg) {
  const wrap = el('div', { class: 'settings-block' });
  const state = {
    enabled: !!cfg.enabled,
    maxSteps: cfg.maxSteps ?? 6,
    maxToolCalls: cfg.maxToolCalls ?? 12,
    toolNames: [...(cfg.toolNames || [])],
  };

  wrap.appendChild(el('div', { class: 'section-title', text: '🧠 Agent 运行参数' }));
  wrap.appendChild(field('最大循环轮数', el('input', {
    type: 'number', class: 'ui-input param-number', min: 1, max: 20,
    value: state.maxSteps, oninput: (e) => { state.maxSteps = parseInt(e.target.value, 10); },
  }), '模型可以连续多轮调用工具直到得出答案'));

  wrap.appendChild(field('最大工具调用数', el('input', {
    type: 'number', class: 'ui-input param-number', min: 1, max: 50,
    value: state.maxToolCalls, oninput: (e) => { state.maxToolCalls = parseInt(e.target.value, 10); },
  })));

  const TOOL_LABELS = {
    knowledge_search: '📚 知识库检索',
    knowledge_list: '🗂 列出知识库文档',
    web_search: '🔍 联网搜索',
    web_fetch: '🌐 抓取网页',
    calculator: '🧮 计算器',
    current_time: '🕒 当前时间',
    search_history: '🔎 检索历史对话',
  };
  const toolBox = el('div', { class: 'tool-toggles' });
  Object.entries(TOOL_LABELS).forEach(([name, label]) => {
    toolBox.appendChild(el('label', { class: 'tool-toggle' }, [
      checkbox(state.toolNames.includes(name), v => {
        if (v) state.toolNames.push(name);
        else state.toolNames = state.toolNames.filter(x => x !== name);
      }),
      el('span', { text: label }),
    ]));
  });
  wrap.appendChild(field('可用工具', toolBox));

  wrap.appendChild(el('div', { class: 'section-hint', text: '· 原生支持 function calling 的模型体验最佳；不支持的模型会自动回退到文本工具协议' }));
  wrap.__collect = () => ({ ...state });
  return wrap;
}

/* ─── RAG 面板 ─── */
function buildRagPanel(cfg) {
  const wrap = el('div', { class: 'settings-block' });
  const state = {
    enabled: cfg.enabled !== false,
    providerId: cfg.providerId || '',
    embeddingModel: cfg.embeddingModel || '',
    topK: cfg.topK ?? 8,
    candidateK: cfg.candidateK ?? 40,
    useVector: cfg.useVector !== false,
    useLexical: cfg.useLexical !== false,
  };

  wrap.appendChild(el('div', { class: 'section-title', text: '📚 检索配置' }));
  wrap.appendChild(field('Embedding Provider', input(state.providerId, v => { state.providerId = v; }), '留空则使用第一个已配置 Key 的 Provider'));
  wrap.appendChild(field('Embedding 模型', input(state.embeddingModel, v => { state.embeddingModel = v; }), '如 text-embedding-3-small / embedding-3 / BAAI/bge-m3；留空则只用 BM25 词法检索'));

  wrap.appendChild(field('返回片段数 topK', el('input', {
    type: 'number', class: 'ui-input param-number', min: 1, max: 30,
    value: state.topK, oninput: (e) => { state.topK = parseInt(e.target.value, 10); },
  })));
  wrap.appendChild(field('召回数 candidateK', el('input', {
    type: 'number', class: 'ui-input param-number', min: 5, max: 200,
    value: state.candidateK, oninput: (e) => { state.candidateK = parseInt(e.target.value, 10); },
  })));

  wrap.appendChild(field('向量检索', checkbox(state.useVector, v => { state.useVector = v; })));
  wrap.appendChild(field('词法检索 (BM25)', checkbox(state.useLexical, v => { state.useLexical = v; })));
  wrap.appendChild(el('div', { class: 'section-hint', text: '· 混合检索使用 RRF 融合两路排序；没有 Embedding 时自动退化为纯 BM25，功能不会中断' }));

  wrap.__collect = () => ({ ...state });
  return wrap;
}

/* ─── 搜索面板 ─── */
function buildSearchPanel(cfg) {
  const wrap = el('div', { class: 'settings-block' });
  const state = {
    mode: cfg.mode || 'auto',
    endpoint: cfg.endpoint || '',
    apiKey: cfg.apiKey || '',
    keyHeader: cfg.keyHeader || 'X-API-Key',
    resultsPath: cfg.resultsPath || 'organic',
    titleField: cfg.titleField || 'title',
    linkField: cfg.linkField || 'link',
    snippetField: cfg.snippetField || 'snippet',
    maxResults: cfg.maxResults ?? 8,
  };

  wrap.appendChild(el('div', { class: 'section-title', text: '🔍 外部搜索 API' }));
  wrap.appendChild(field('模式', select([
    { value: 'auto', label: '自动（智谱 → 外部 API → SearXNG）' },
    { value: 'zhipu', label: '仅智谱搜索' },
    { value: 'external', label: '仅外部 API' },
    { value: 'searxng', label: '仅 SearXNG' },
    { value: 'none', label: '不启用外部搜索' },
  ], state.mode, v => { state.mode = v; })));
  wrap.appendChild(field('搜索接口地址', input(state.endpoint, v => { state.endpoint = v; }), '支持 {query} 占位符，如 https://api.serper.dev/search?q={query}'));
  wrap.appendChild(field('API Key', el('input', { class: 'ui-input', type: 'password', value: state.apiKey, oninput: (e) => { state.apiKey = e.target.value; } })));
  wrap.appendChild(field('Key 请求头', input(state.keyHeader, v => { state.keyHeader = v; })));
  wrap.appendChild(field('结果数组路径', input(state.resultsPath, v => { state.resultsPath = v; }), '如 organic / web.results / results'));
  wrap.appendChild(field('标题字段', input(state.titleField, v => { state.titleField = v; })));
  wrap.appendChild(field('链接字段', input(state.linkField, v => { state.linkField = v; })));
  wrap.appendChild(field('摘要字段', input(state.snippetField, v => { state.snippetField = v; })));
  wrap.appendChild(el('div', { class: 'section-hint', text: '· 适配 Serper / Brave / Tavily / Bing / SearXNG 等常见格式' }));

  wrap.__collect = () => ({ ...state });
  return wrap;
}

/* ─── 外观面板 ─── */
function buildAppearancePanel(theme, fontSize) {
  const wrap = el('div', { class: 'settings-block' });
  const state = { theme, fontSize };
  wrap.appendChild(el('div', { class: 'section-title', text: '🎨 外观' }));
  wrap.appendChild(field('主题', select([
    { value: 'light', label: '☀️ 亮色' },
    { value: 'dark', label: '🌙 暗色' },
    { value: 'system', label: '💻 跟随系统' },
  ], state.theme, v => { state.theme = v; applyTheme(v); })));
  const slider = el('input', { type: 'range', class: 'param-range', min: 11, max: 24, step: 1, value: state.fontSize });
  const label = el('span', { class: 'param-val', text: `${state.fontSize}px` });
  slider.oninput = () => { state.fontSize = parseInt(slider.value, 10); label.textContent = `${state.fontSize}px`; applyFontSize(state.fontSize); };
  wrap.appendChild(field('字体大小', el('div', { class: 'range-row' }, [slider, label])));
  wrap.__collect = () => ({ ...state });
  return wrap;
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.setAttribute('data-theme', 'dark');
  else if (mode === 'light') root.removeAttribute('data-theme');
  else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }
}

function applyFontSize(size) {
  const px = parseInt(size, 10);
  if (px && px >= 10 && px <= 32) document.documentElement.style.setProperty('--font-size', `${px}px`);
}

/* ─── 数据面板 ─── */
function buildDataPanel(opts) {
  const wrap = el('div', { class: 'settings-block' });
  wrap.appendChild(el('div', { class: 'section-title', text: '💾 数据管理' }));

  const row1 = el('div', { class: 'data-actions' }, [
    el('button', { class: 'ui-btn', onclick: () => opts.onExport?.() }, '📤 导出全部数据'),
    el('button', { class: 'ui-btn', onclick: () => opts.onImport?.() }, '📥 导入数据'),
  ]);
  wrap.appendChild(row1);

  const row2 = el('div', { class: 'data-actions' }, [
    el('button', { class: 'ui-btn', onclick: () => opts.onOpenSavedResults?.() }, '💾 已保存的搜索结果'),
    el('button', { class: 'ui-btn ui-btn-danger', onclick: () => opts.onClearAll?.() }, '🗑️ 清空全部数据'),
  ]);
  wrap.appendChild(row2);

  wrap.appendChild(el('div', { class: 'section-hint', text: '· 导出的 JSON 含全部表（模块/会话/消息/知识库/向量/用量）。API Key 默认脱敏，可在导入时选择保留' }));
  return wrap;
}
