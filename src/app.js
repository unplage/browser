import * as db from './db.js';
import * as mods from './modules.js';
import * as llm from './llm/index.js';
import { respond } from './core/engine.js';
import { estimateMessagesTokens } from './core/tokens.js';
import { renderMarkdown } from './core/markdown.js';
import { downloadJson } from './core/utils.js';

import { $, el, clear, showView } from './ui/dom.js';
import { notify } from './ui/toast.js';
import { openModal, confirmDialog, promptDialog, closeTopModal } from './ui/modal.js';
import { renderSidebar, renderGrid } from './ui/grid.js';
import * as chatUI from './ui/chat.js';
import * as searchUI from './ui/search.js';
import { openSettings } from './ui/settings.js';
import { openKnowledgePanel, openIngestDialog } from './ui/knowledge.js';
import { openSessionsPanel } from './ui/sessions.js';
import { openModuleEditor, openCreateModule } from './ui/module-editor.js';
import { openBookmarkPanel } from './ui/bookmarks.js';
import { ensureHighlightTheme } from './ui/markdown-view.js';
import { getRagSettings, saveRagSettings } from './rag/embed.js';
import { getAgentSettings, saveAgentSettings } from './agent/runtime.js';
import { getSearchConfig, saveSearchConfig, getProviders, saveProviders } from './llm/providers.js';

/* ─── 应用状态 ─── */

const state = {
  modules: [],
  providers: [],
  currentModuleId: null,
  currentSessionId: null,
  messages: [],
  abortController: null,
  busy: false,
  hideAll: false,
};

const APP_VERSION = '2.0.0';

/* ─── 启动 ─── */
(async function init() {
  if (!db.dbReady) {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:system-ui,sans-serif;color:#666;background:#f5f5f5;padding:20px;text-align:center">
      <span style="font-size:48px">⚠️</span><h2 style="font-weight:600;font-size:18px;color:#333">IndexedDB 不可用</h2>
      <p style="font-size:14px;max-width:400px;line-height:1.6">请确保浏览器未启用隐私模式，且未禁用 IndexedDB。<br>如果问题持续，请尝试更新浏览器或更换浏览器。</p></div>`;
    return;
  }

  try {
    state.modules = await mods.getModuleList();
  } catch (e) {
    console.error(e);
    state.modules = [];
  }
  state.providers = await getProviders();

  const theme = await db.getSetting('theme') || 'light';
  applyTheme(theme);
  if (theme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme('system'));
  }
  const fontSize = await db.getSetting('fontSize') || 14;
  applyFontSize(fontSize);
  ensureHighlightTheme(theme === 'dark' ? 'dark' : 'light');

  renderAll();
  updateStatusBar();
  bindGlobalEvents();
  bindKeyboardShortcuts();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('[SW] 注册失败:', e));
  }

  window.addEventListener('beforeunload', () => {
    if (state.busy) {
      state.abortController?.abort();
    }
  });

  if (!state.providers.some(p => p.apiKey)) {
    setTimeout(() => {
      notify.warning('尚未配置任何 API Key，点击右上角 ⚙️ 添加服务商后即可开始使用', 6000);
    }, 800);
  }
})();

/* ─── 渲染 ─── */
/** 给模块补上服务商名称，便于界面展示 */
function decorateModules() {
  return state.modules.map(m => {
    const provider = state.providers.find(p => p.id === m.providerId);
    return {
      ...m,
      providerName: provider?.name || m.providerId || '默认',
      providerMissing: !provider?.apiKey,
    };
  });
}

function renderAll() {
  const active = state.modules.find(m => m.id === state.currentModuleId);
  renderSidebar(state.hideAll ? [] : state.modules, state.currentModuleId, {
    onOpen: openModule,
    onToggle: toggleModule,
  });
  renderGrid(decorateModules(), {
    onOpen: openModule,
    onEdit: editModule,
    onToggle: toggleModule,
    onDelete: deleteModule,
    onCreate: createModule,
    onReorder: reorderModules,
    onBookmark: openBookmarks,
    onKnowledge: openKnowledge,
    onOpenUrl: openUrl,
    onMove: moveModule,
  });
  updateStatusBar();
  if (state.currentModuleId && active) loadModule(active.id);
  else showView('gridView');
}

function updateStatusBar() {
  const count = $('#moduleCount');
  if (count) {
    const enabled = state.modules.filter(m => m.enabled).length;
    count.textContent = `模块 ${enabled}/${state.modules.length}`;
  }
  const providerNode = $('#statusProvider');
  if (providerNode) {
    const configured = state.providers.filter(p => p.apiKey);
    const mod = state.modules.find(m => m.id === state.currentModuleId);
    const pid = mod?.providerId || configured[0]?.id;
    const provider = state.providers.find(p => p.id === pid) || configured[0];
    if (!provider) {
      providerNode.textContent = '未配置服务商';
      providerNode.className = 'status-warn';
    } else {
      providerNode.textContent = `${provider.name} · ${mod?.model || provider.defaultModel || '未选模型'}`;
      providerNode.className = '';
    }
  }
  const dot = $('#statusDot');
  if (dot) {
    dot.className = `status-dot ${state.providers.some(p => p.apiKey) ? 'ok' : 'warn'}`;
  }
}

/* ─── 模块交互 ─── */
async function openModule(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  if (!mod.enabled) { await toggleModule(id); return; }

  state.currentModuleId = id;
  await loadModule(id);
  renderSidebar(state.hideAll ? [] : state.modules, id, {
    onOpen: openModule,
    onToggle: toggleModule,
  });
  if (window.innerWidth <= 768) closeMobileSidebar();
}

async function loadModule(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  const provider = state.providers.find(p => p.id === mod.providerId);
  const model = resolveModuleModel(mod);

  const sessions = await db.getSessions(id);
  let session = sessions[0];
  if (!session) session = await db.createSession(id, '');

  state.currentSessionId = session.id;
  const stored = await db.getMessages(session.id);
  state.messages = stored.map(m => ({
    role: m.role,
    content: m.content,
    reasoning: m.reasoning || '',
    createdAt: m.createdAt,
    sources: m.meta ? safeParseMeta(m.meta) : null,
  }));

  chatUI.showChat({
    ...mod,
    subtitle: `${provider?.name || '默认'} · ${model || ''}`,
  }, state.messages, {
    onSend: handleSend,
    onBack: backToGrid,
    onMenu: () => editModule(id),
    onClearChat: clearChat,
    onStop: stopGeneration,
    onHistory: openSessions,
    onNewChat: newSession,
    onRegenerate: regenerate,
    onEditMessage: editMessage,
    onDeleteMessage: deleteMessage,
    onCitation: jumpToCitation,
    onToggle: onToggleChange,
  });

  /* 能力提示 */
  const searchCfg = await getSearchConfig();
  const hasSearch = !!provider?.capabilities?.webSearch
    || (searchCfg.mode && searchCfg.mode !== 'none')
    || provider?.search?.mode === 'native';
  chatUI.setToggleEnabled('web', hasSearch, '当前没有可用的搜索后端，请检查服务商能力标记或搜索设置');
  chatUI.setToggleEnabled('knowledge', true);
  chatUI.setToggleEnabled('agent', provider?.capabilities?.tools !== false, '该服务商未声明支持工具调用');
  if (mod.knowledge) {
    const node = $('#chatKnowledgeToggle');
    if (node && !node.classList.contains('active')) node.classList.add('active');
  }
  updateStatusBar();
}

function resolveModuleModel(mod) {
  if (mod.model) return mod.model;
  const provider = state.providers.find(p => p.id === mod.providerId);
  return provider?.defaultModel || '';
}

async function editModule(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  openModuleEditor(mod, state.providers, async (mid, changes) => {
    await mods.updateModule(mid, changes);
    mods.invalidateCache();
    state.modules = await mods.getModuleList();
    renderAll();
    notify.success('模块已更新');
  }, {
    defaultIds: mods.DEFAULT_MODULE_IDS,
    getDefaultPrompt: mods.getDefaultPrompt,
    onSavePreset: async (preset) => {
      await db.savePreset({ title: preset.title, prompt: preset.systemPrompt, model: preset.model, providerId: preset.providerId });
      notify.success('已保存为预设');
    },
  });
}

async function createModule() {
  openCreateModule(state.providers, async (data) => {
    await mods.createModule(data);
    state.modules = await mods.getModuleList();
    renderAll();
    notify.success(`模块「${data.title}」已创建`);
  });
}

async function toggleModule(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  await mods.updateModule(id, { enabled: !mod.enabled });
  mods.invalidateCache();
  state.modules = await mods.getModuleList();
  renderAll();
}

async function deleteModule(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  const ok = await confirmDialog(`确认删除模块「${mod.title}」？`, { detail: '此操作不可恢复，相关会话会保留但不再显示。', danger: true, okText: '删除' });
  if (!ok) return;
  await mods.deleteModule(id);
  state.modules = await mods.getModuleList();
  if (state.currentModuleId === id) {
    state.currentModuleId = null;
    state.currentSessionId = null;
  }
  renderAll();
  notify.success('模块已删除');
}

async function reorderModules(ids) {
  await mods.reorderModules(ids);
  state.modules = await mods.getModuleList();
  updateStatusBar();
}

async function moveModule(id, dir) {
  const ids = state.modules.filter(m => m.enabled).map(m => m.id);
  const idx = ids.indexOf(id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  await mods.reorderModules(ids);
  state.modules = await mods.getModuleList();
  renderAll();
}

function backToGrid() {
  state.abortController?.abort();
  state.currentModuleId = null;
  state.currentSessionId = null;
  state.messages = [];
  showView('gridView');
  renderSidebar(state.hideAll ? [] : state.modules, null, {
    onOpen: openModule,
    onToggle: toggleModule,
  });
  updateStatusBar();
}

/* ─── 会话 ─── */
async function newSession() {
  if (!state.currentModuleId) return;
  const session = await db.createSession(state.currentModuleId, '');
  state.currentSessionId = session.id;
  state.messages = [];
  const mod = state.modules.find(m => m.id === state.currentModuleId);
  await loadModule(state.currentModuleId);
  notify.info('已新建会话');
}

async function openSessions() {
  const moduleId = state.currentModuleId;
  const sessions = await db.getSessions(moduleId, { includeArchived: true });
  const enriched = [];
  for (const s of sessions) {
    const msgs = await db.getMessages(s.id);
    const firstUser = msgs.find(m => m.role === 'user');
    enriched.push({
      ...s,
      title: s.title || (firstUser ? String(firstUser.content).slice(0, 30) : ''),
      messageCount: msgs.length,
      preview: firstUser ? String(firstUser.content).slice(0, 80) : '',
    });
  }
  openSessionsPanel(enriched, state.currentSessionId, {
    onSelect: async (sid) => {
      state.currentSessionId = sid;
      await loadModule(moduleId);
    },
    onRename: async (sid, title) => {
      await db.updateSession(sid, { title });
    },
    onDelete: async (sid) => {
      await db.deleteSession(sid);
    },
  });
}

async function clearChat() {
  const ok = await confirmDialog('确认清空当前会话的对话记录？');
  if (!ok) return;
  if (state.currentSessionId) {
    const msgs = await db.getMessages(state.currentSessionId);
    for (const m of msgs) await db.deleteMessage(m.id);
  }
  state.messages = [];
  chatUI.clearMessages();
  notify.success('已清空');
}

/* ─── 发送 ─── */
async function handleSend(text, opts = {}) {
  if (state.busy) return;
  if (!state.currentModuleId) return;

  const mod = state.modules.find(m => m.id === state.currentModuleId);
  if (!mod) return;

  const provider = state.providers.find(p => p.id === mod.providerId);
  if (!provider?.apiKey) {
    notify.error(`请先在设置中为「${provider?.name || '该服务商'}」配置 API Key`);
    return;
  }

  /* 图片需要视觉模型，否则明确告知而不是静默丢弃 */
  if (opts.imageData) {
    const caps = resolveModel(mod.model || provider.defaultModel, provider.modelHints?.[mod.model]);
    const canSee = caps.vision || provider.capabilities?.vision;
    if (!canSee) {
      notify.error(`当前模型「${mod.model || provider.defaultModel}」不支持图像输入，请在模块编辑器中切换到视觉模型（如 glm-4.6v-flash、gpt-4o 等）`);
      return;
    }
  }

  state.busy = true;
  state.abortController = new AbortController();

  const userContent = text;
  chatUI.appendMessage('user', userContent, {
    createdAt: Date.now(),
  });
  await db.addMessage(state.currentSessionId, { role: 'user', content: userContent });

  const handle = chatUI.beginAssistant();
  let sources = [];
  let reasoning = '';

  try {
    const res = await respond({
      module: { ...mod, providerId: mod.providerId, model: mod.model },
      sessionId: state.currentSessionId,
      userText: userContent,
      imageData: opts.imageData || null,
      useKnowledge: !!opts.knowledge,
      useAgent: !!opts.agent,
      useWeb: !!opts.web,
      signal: state.abortController.signal,
      onEvent: (e) => {
        if (e.type === 'text') chatUI.updateAssistant(handle, { text: e.full });
        else if (e.type === 'reasoning') { reasoning = e.full; chatUI.updateAssistant(handle, { reasoning: e.full }); }
        else if (e.type === 'note') chatUI.addTraceEvent(handle, { type: 'note', text: e.text });
        else if (e.type === 'agent') {
          const ev = e.event;
          if (ev.type === 'tool_start' || ev.type === 'tool_end' || ev.type === 'note' || ev.type === 'step_start') {
            chatUI.addTraceEvent(handle, ev);
          }
        } else if (e.type === 'retrieval_done') {
          chatUI.addTraceEvent(handle, { type: 'note', text: `知识库检索命中 ${e.count} 条（${e.mode}）` });
        } else if (e.type === 'context_compressed') {
          chatUI.addTraceEvent(handle, { type: 'note', text: `上下文已压缩，节省 ${e.dropped} 条消息` });
        }
      },
    });

    sources = res.sources || [];
    reasoning = res.reasoning || reasoning;
    chatUI.updateAssistant(handle, { text: res.content, reasoning });
    chatUI.endAssistant(handle);
    if (sources.length) chatUI.renderSources(handle.sourcesHost, sources);

    await db.addMessage(state.currentSessionId, {
      role: 'assistant',
      content: res.content,
      reasoning,
      meta: sources?.length ? JSON.stringify({ sources }) : null,
    });
    if (res.usage?.total) {
      await db.addUsage({
        sessionId: state.currentSessionId,
        providerId: provider.id,
        model: res.usage,
        total: res.usage.total,
      });
    }
  } catch (e) {
    chatUI.endAssistant(handle);
    const msg = e.name === 'AbortError' ? '已停止生成' : (e.hint ? `${e.message}\n${e.hint}` : e.message);
    chatUI.updateAssistant(handle, { text: `\n\n> **${msg}**` });
    if (e.name !== 'AbortError') notify.error(msg);
  } finally {
    state.busy = false;
    state.abortController = null;
    updateContextInfo();
  }
}

function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    notify.info('已停止生成');
  }
}

async function regenerate(opts = {}) {
  const msgs = await db.getMessages(state.currentSessionId);
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  if (!lastUser) return;
  const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
  if (lastAssistant) await db.deleteMessage(lastAssistant.id);

  const nodes = $('#chatMessages')?.querySelectorAll('.msg.assistant');
  nodes?.[nodes.length - 1]?.remove();
  state.messages = state.messages.filter(m => !(m.role === 'assistant' && m.content === lastAssistant?.content));

  await handleSend(String(lastUser.content), {
    web: !!opts.web,
    knowledge: !!opts.knowledge,
    agent: !!opts.agent,
  });
}

async function editMessage(opts) {
  const newText = await promptDialog('编辑消息（将删除该消息之后的内容并重新生成）', { defaultValue: opts.content || '' });
  if (!newText || newText === opts.content) return;
  const msgs = await db.getMessages(state.currentSessionId);
  const target = msgs.find(m => m.content === opts.content && m.role === 'user');
  if (!target) return;
  await db.deleteMessage(target.id);
  const after = msgs.filter(m => m.createdAt >= target.createdAt && m.id !== target.id);
  for (const m of after) await db.deleteMessage(m.id);
  await db.addMessage(state.currentSessionId, { role: 'user', content: newText });
  await loadModule(state.currentModuleId);
  notify.info('已更新，请重新发送以获得新的回复');
}

async function deleteMessage(opts) {
  const ok = await confirmDialog('删除这条消息？');
  if (!ok) return;
  const msgs = await db.getMessages(state.currentSessionId);
  const target = msgs.find(m => m.content === opts.content && m.role === opts.role);
  if (target) await db.deleteMessage(target.id);
  await loadModule(state.currentModuleId);
}

function jumpToCitation(id) {
  const node = document.getElementById(`src-${id}`);
  if (!node) { notify.info('该引用未在来源列表中'); return; }
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1600);
}

function onToggleChange(key, active) {
  if (key === 'knowledge' && active) {
    notify.info('已启用知识库：回答将基于你的资料并标注引用');
  } else if (key === 'agent' && active) {
    notify.info('已启用 Agent：模型可自主调用搜索、计算等工具');
  } else if (key === 'web' && active) {
    notify.info('已启用联网：回答将结合实时检索结果');
  }
}

function updateContextInfo() {
  const tokens = estimateMessagesTokens(state.messages);
  chatUI.setContextInfo(state.messages.length ? `上下文约 ${tokens} tokens` : '');
}

/* ─── 顶栏联网搜索 ─── */
async function runSearch() {
  const query = $('#searchInput')?.value.trim();
  if (!query) return;

  const provider = state.providers.find(p => p.apiKey && p.capabilities?.webSearch)
    || state.providers.find(p => p.apiKey);
  if (!provider) { notify.error('请先配置 API Key'); return; }

  state.busy = true;
  state.abortController = new AbortController();
  searchUI.showSearchLoading(query);
  const handle = searchUI.beginSearchResult(query);

  const searchPrompt = `你是一位深度分析专家。请结合实时联网信息给出结构化分析报告。

要求：
1. **综合结论** —— 融合检索到的实时信息与你的知识储备，标注可信度（高/中/低）
2. **关键发现** —— 分点列出，标注该信息来自「网络检索」还是「模型知识」
3. **知识对比** —— 若网络信息与训练知识存在差异，分析差异原因
4. **分歧与争议** —— 列出不同观点及各方依据
5. **信息来源** —— 列出参考来源的标题与链接
不确定的内容必须明确说明，禁止编造来源链接。`;

  let sources = [];
  try {
    const res = await respond({
      module: { systemPrompt: searchPrompt, providerId: provider.id, model: provider.defaultModel },
      sessionId: null,
      userText: query,
      useWeb: true,
      useAgent: false,
      useKnowledge: false,
      signal: state.abortController.signal,
      onEvent: (e) => {
        if (e.type === 'text') searchUI.updateSearchResult(handle, e.full);
        else if (e.type === 'note') console.info('[search]', e.text);
      },
    });
    searchUI.endSearchResult(handle, res.sources);
    sources = res.sources;
    searchUI.setSearchPayload(query, res.content);
    searchUI.setSearchSaveEnabled(true);
  } catch (e) {
    searchUI.showSearchError(e.hint ? `${e.message}\n${e.hint}` : e.message);
  } finally {
    state.busy = false;
    state.abortController = null;
  }
}

/* ─── 设置 ─── */
async function openSettingsPanel() {
  const [theme, fontSize, agentSettings, ragSettings, searchConfig] = await Promise.all([
    db.getSetting('theme') || 'light',
    db.getSetting('fontSize') || 14,
    getAgentSettings(),
    getRagSettings(),
    getSearchConfig(),
  ]);

  openSettings({
    providers: state.providers,
    theme,
    fontSize,
    agentSettings,
    ragSettings,
    searchConfig,
    onSave: async (data) => {
      await saveProviders(data.providers);
      await saveAgentSettings(data.agent);
      await saveRagSettings(data.rag);
      await saveSearchConfig(data.search);
      if (data.theme) { await db.setSetting('theme', data.theme); applyTheme(data.theme); ensureHighlightTheme(data.theme === 'dark' ? 'dark' : 'light'); }
      if (data.fontSize) { await db.setSetting('fontSize', String(data.fontSize)); applyFontSize(data.fontSize); }
      state.providers = await getProviders();
      updateStatusBar();
    },
    onExport: exportData,
    onImport: importData,
    onOpenSavedResults: openSavedResults,
    onClearAll: clearAllData,
  });
}

async function exportData() {
  try {
    const data = await db.exportAll();
    downloadJson(data, `ai-browser-backup-${Date.now()}.json`);
    notify.success('数据已导出（API Key 已保留，请妥善保管）');
  } catch (e) {
    notify.error(`导出失败：${e.message}`);
  }
}

async function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.modules && !data.sessions) { notify.error('无效的备份文件'); return; }
      const ok = await confirmDialog('导入将覆盖现有数据，确认继续？', { detail: '建议先导出当前数据备份。', danger: true, okText: '导入并覆盖' });
      if (!ok) return;
      const report = await db.importAll(data, { allowSecrets: false });
      notify.success(`导入完成：${report.restored.join('、')}${report.skipped.length ? `（未包含：${report.skipped.join('、')}）` : ''}`);
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      notify.error(`导入失败：${err.message}`);
    }
  };
  input.click();
}

async function clearAllData() {
  const ok = await confirmDialog('确认清空全部数据？', { detail: '包括模块配置、会话、知识库、书签与设置，且不可恢复。', danger: true, okText: '全部清空' });
  if (!ok) return;
  await db.db.transaction('rw', db.db.tables, async () => {
    for (const t of db.db.tables) await t.clear();
  });
  notify.success('已清空，即将重新加载');
  setTimeout(() => location.reload(), 800);
}

async function openSavedResults() {
  const results = await db.getSearchResults();
  const body = el('div', { class: 'saved-results' });
  if (!results.length) {
    body.appendChild(el('div', { class: 'empty-state' }, el('div', { class: 'text', text: '暂无保存的搜索结果' })));
  } else {
    results.forEach(r => {
      const item = el('div', { class: 'saved-result-item' }, [
        el('div', { class: 'meta', text: new Date(r.savedAt).toLocaleString('zh-CN') }),
        el('div', { class: 'query', text: `🔍 ${r.query}` }),
        el('button', {
          class: 'del-btn', title: '删除',
          onclick: async (ev) => {
            ev.stopPropagation();
            await db.deleteSearchResult(r.id);
            item.remove();
          },
        }, '✕'),
      ]);
      item.addEventListener('click', () => {
        showView('searchView');
        $('#searchViewTitle').textContent = `🔍 ${r.query}`;
        $('#searchResultContent').innerHTML = renderMarkdown(r.content || r.result || '');
        searchUI.setSearchPayload(r.query, r.content || r.result || '');
        searchUI.setSearchSaveEnabled(true);
        closeTopModal();
      });
      body.appendChild(item);
    });
  }
  const footer = el('div', { class: 'modal-footer-row' }, [el('button', { class: 'ui-btn ui-btn-primary', onclick: () => m.close() }, '关闭')]);
  const m = openModal({ title: '💾 已保存的搜索结果', body, footer, size: 'md' });
}

/* ─── 知识库 ─── */
async function openKnowledge() {
  openKnowledgePanel({});
}

async function openBookmarks() {
  const bookmarks = await db.getBookmarks();
  openBookmarkPanel(bookmarks, {
    onAdd: async (bm) => { await db.addBookmark(bm); },
    onDelete: async (id) => { await db.deleteBookmark(id); },
  });
}

function openUrl(url) {
  window.open(url, '_blank', 'noopener');
}

/* ─── 全局事件 ─── */
function bindGlobalEvents() {
  $('#searchBtn')?.addEventListener('click', runSearch);
  $('#searchInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  $('#settingsBtn')?.addEventListener('click', openSettingsPanel);
  $('#kbBtn')?.addEventListener('click', openKnowledge);
  $('#uploadBtn')?.addEventListener('click', () => openIngestDialog(() => {}));

  $('#saveSearchBtn')?.addEventListener('click', async () => {
    const payload = searchUI.getSearchPayload();
    if (!payload.query) return;
    await db.saveSearchResult(payload);
    notify.success('已保存到本地');
  });

  $('#searchBackBtn')?.addEventListener('click', () => showView('gridView'));

  const toggleSidebar = () => {
    const sidebar = $('#sidebar');
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-overlay');
      document.body.classList.toggle('sidebar-open');
    } else {
      const collapsed = sidebar.classList.toggle('collapsed');
      $('#mobileMenuBtn').textContent = collapsed ? '▶' : '◀';
      $('#mobileMenuBtn').title = collapsed ? '展开侧边栏' : '收起侧边栏';
    }
  };
  $('#mobileMenuBtn')?.addEventListener('click', toggleSidebar);

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    const sidebar = $('#sidebar');
    if (!sidebar.classList.contains('mobile-overlay')) return;
    if (!sidebar.contains(e.target) && e.target !== $('#mobileMenuBtn')) closeMobileSidebar();
  });

  $('#hideAllBtn')?.addEventListener('click', () => {
    state.hideAll = !state.hideAll;
    $('#hideAllBtn').classList.toggle('active', state.hideAll);
    renderAll();
  });
}

function closeMobileSidebar() {
  $('#sidebar')?.classList.remove('mobile-overlay');
  document.body.classList.remove('sidebar-open');
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if (e.ctrlKey && e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      $('#chatSend')?.click();
      return;
    }
    if (e.key === 'Escape') {
      if (closeTopModal()) return;
      if (state.abortController) { stopGeneration(); return; }
      if (inInput) e.target.blur();
      return;
    }
    if (e.ctrlKey && e.metaKey && e.key === 'k') {
      e.preventDefault();
      $('#searchInput')?.focus();
      return;
    }
    if (e.ctrlKey && e.metaKey && e.key === 'j') {
      e.preventDefault();
      $('#chatInput')?.focus();
      return;
    }
    if (e.ctrlKey && e.metaKey && e.key === 'b') {
      e.preventDefault();
      openKnowledge();
    }
  });
}

/* ─── 主题 / 字号 ─── */
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

function safeParseMeta(meta) {
  try {
    const parsed = JSON.parse(meta);
    return parsed?.sources || null;
  } catch { return null; }
}
