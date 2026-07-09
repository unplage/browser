import * as db from './db.js';
import * as api from './api.js';
import * as mods from './modules.js';
import * as ui from './ui.js';

const state = {
  modules: [],
  currentModuleId: null,
  currentMessages: [],
  abortController: null,
  hideAll: false,
  pendingImage: null,
};

(async function init() {
  try {
    state.modules = await mods.getModuleList();
  } catch (e) {
    state.modules = [];
  }

  const DEFAULT_COUNT = 13;
  ui.updateModuleCount(state.modules.length, DEFAULT_COUNT);
  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  bindGlobalEvents();
})();

function renderAll() {
  const active = state.modules.find(m => m.id === state.currentModuleId);
  const displayedModules = state.hideAll ? [] : state.modules;
  ui.renderSidebar(displayedModules, state.currentModuleId, onModuleClick, onModuleToggle);
  ui.renderGrid(state.modules, {
    onOpen: onModuleClick,
    onEdit: onModuleEdit,
    onToggle: onModuleToggle,
    onReorder: onModuleReorder,
    onCreate: onModuleCreate,
    onDelete: onModuleDelete,
  }, state.hideAll);
  if (state.currentModuleId && active) {
    loadAndShowChat(active.id);
  } else {
    ui.showView('gridView');
  }
}

function bindGlobalEvents() {
  ui.$('searchBtn').addEventListener('click', onSearch);
  ui.$('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSearch();
  });

  function toggleSidebar() {
    const sidebar = ui.$('sidebar');
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-overlay');
      document.body.classList.toggle('sidebar-open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  }
  ui.$('toggleSidebar').addEventListener('click', toggleSidebar);
  ui.$('mobileMenuBtn').addEventListener('click', toggleSidebar);
  document.addEventListener('click', e => {
    if (window.innerWidth > 768) return;
    const sidebar = ui.$('sidebar');
    if (!sidebar.classList.contains('mobile-overlay')) return;
    if (!sidebar.contains(e.target) && e.target !== ui.$('mobileMenuBtn')) {
      sidebar.classList.remove('mobile-overlay');
      document.body.classList.remove('sidebar-open');
    }
  });

  ui.$('hideAllBtn').addEventListener('click', () => {
    state.hideAll = !state.hideAll;
    ui.$('hideAllBtn').classList.toggle('active');
    renderAll();
  });

  ui.$('bookmarkBtn').addEventListener('click', openBookmarks);
  ui.$('savedResultsBtn').addEventListener('click', openSavedResults);
  ui.$('uploadBtn').addEventListener('click', openFileUpload);
  ui.$('settingsBtn').addEventListener('click', openSettings);

  ui.$('saveSearchBtn').addEventListener('click', async () => {
    const data = ui.getSavedSearchData();
    if (!data.query) return;
    try {
      await db.saveSearchResult({
        query: data.query,
        content: data.content,
        result: data.result,
      });
      ui.$('saveSearchBtn').textContent = '✅ 已保存';
      setTimeout(() => { ui.$('saveSearchBtn').textContent = '💾 保存'; }, 2000);
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  });
}

/* ─── Module Interactions ─── */
async function onModuleClick(id) {
  state.currentModuleId = id;
  await loadAndShowChat(id);
  ui.renderSidebar(state.modules, id, onModuleClick, onModuleToggle);
  if (window.innerWidth <= 768) {
    ui.$('sidebar').classList.remove('mobile-overlay');
    document.body.classList.remove('sidebar-open');
  }
}

async function loadAndShowChat(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;

  const chat = await db.getChatHistory(id);
  state.currentMessages = chat ? chat.messages : [];
  state.pendingImage = null;

  ui.showChat(mod, state.currentMessages, {
    onSend: (text, useWeb) => handleSend(text, useWeb),
    onBack: handleChatBack,
    onMenu: () => onModuleEdit(id),
    onClearChat: () => handleClearChat(id),
    onStop: () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    },
    onImage: (dataUrl) => {
      state.pendingImage = dataUrl;
    },
  });
}

async function handleSend(text, useWeb) {
  const mod = state.modules.find(m => m.id === state.currentModuleId);
  if (!mod) return;

  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  const userMsg = useWeb ? `【需要联网搜索最新信息】${text}` : text;
  state.currentMessages.push({ role: 'user', content: userMsg });
  ui.appendMessage('user', text, false, state.pendingImage);
  ui.clearPendingImage();

  ui.showStreaming(true);

  const msgEl = ui.appendMessage('assistant', '', true);
  let full = '';

  try {
    const result = await api.chatWithModule(mod.systemPrompt, state.currentMessages, (chunk, fullContent) => {
      full = fullContent;
      ui.updateStreamingMessage(msgEl, fullContent);
    }, {
      model: mod.model,
      webSearch: useWeb,
      searchQuery: useWeb ? text : undefined,
      imageData: state.pendingImage,
      signal: state.abortController.signal,
    });
    ui.stopStreaming(msgEl);
    ui.showStreaming(false);
    state.currentMessages.push({ role: 'assistant', content: result });
    state.pendingImage = null;
  } catch (e) {
    ui.stopStreaming(msgEl);
    ui.showStreaming(false);
    if (e.name === 'AbortError') {
      ui.updateStreamingMessage(msgEl, `\n\n*⏹️ 已停止生成*`);
    } else {
      ui.updateStreamingMessage(msgEl, `\n\n**错误**: ${e.message}`);
    }
    state.pendingImage = null;
  }

  state.abortController = null;
  await db.saveChatHistory(mod.id, state.currentMessages);
}

async function handleClearChat(moduleId) {
  if (!confirm('确认清空此模块的对话记录？')) return;
  await db.saveChatHistory(moduleId, state.currentMessages);
  state.currentMessages = [];
  await db.saveChatHistory(moduleId, []);
  const mod = state.modules.find(m => m.id === moduleId);
  if (mod) {
    ui.showChat(mod, state.currentMessages, {
      onSend: (text, useWeb) => handleSend(text, useWeb),
      onBack: handleChatBack,
      onMenu: () => onModuleEdit(moduleId),
      onClearChat: () => handleClearChat(moduleId),
    });
  }
}

async function handleChatBack() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  if (state.currentModuleId) {
    await db.saveChatHistory(state.currentModuleId, state.currentMessages);
  }
  state.currentModuleId = null;
  state.currentMessages = [];
  ui.showView('gridView');
  ui.renderSidebar(state.modules, null, onModuleClick, onModuleToggle);
}

async function onModuleEdit(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  ui.showModuleEditor(mod, async (mid, changes) => {
    const updated = await mods.updateModule(mid, changes);
    if (updated) {
      state.currentModuleId = mid;
      renderAll();
    }
  });
}

async function onModuleToggle(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;
  await mods.updateModule(id, { enabled: !mod.enabled });
  renderAll();
}

async function onModuleReorder(ids) {
  await mods.reorderModules(ids);
  state.modules = await mods.getModuleList();
}

async function onModuleCreate(title, icon, prompt, model) {
  const mod = await mods.createModule(title, icon, prompt, model);
  mods.invalidateCache();
  state.modules = await mods.getModuleList();
  renderAll();
}

function showCreateModuleDialog() {
  ui.showCreateModule(async (title, icon, prompt, model) => {
    await onModuleCreate(title, icon, prompt, model);
  });
}

async function onModuleDelete(id) {
  try {
    await mods.deleteModule(id);
    mods.invalidateCache();
    state.modules = await mods.getModuleList();
    if (state.currentModuleId === id) {
      state.currentModuleId = null;
    }
    renderAll();
  } catch (e) {
    alert(e.message);
  }
}

/* ─── Search ─── */
async function onSearch() {
  const query = ui.$('searchInput').value.trim();
  if (!query) return;

  const keyOk = await api.checkApiKey();
  if (!keyOk) { alert('请先在设置中配置 API Key'); return; }

  ui.showSearchLoading();
  try {
    const result = await api.searchWithAnalysis(query);
    ui.showSearchResult(query, result);
  } catch (e) {
    ui.$('searchResultContent').innerHTML = `<div style="color:var(--danger);padding:20px">搜索分析失败: ${e.message}</div>`;
    ui.$('searchBtn').classList.remove('loading');
    ui.$('searchBtn').textContent = '搜索';
  }
}

/* ─── Saved Results ─── */
async function openSavedResults() {
  const results = await db.getSearchResults();
  ui.showSavedResults(results, async (id) => {
    await db.deleteSearchResult(id);
  });
}

/* ─── Bookmarks ─── */
async function openBookmarks() {
  let bookmarks = await db.getBookmarks();
  ui.showBookmarkPanel(bookmarks, {
    onAdd: async (bm) => {
      await db.addBookmark(bm);
      return await db.getBookmarks();
    },
    onDelete: async (id) => {
      await db.deleteBookmark(id);
      return await db.getBookmarks();
    },
    onRefresh: async () => await db.getBookmarks(),
    onOpenUrl: (url) => {
      ui.showBrowserView(url, () => {
        ui.showView('gridView');
      });
    },
  });
}

/* ─── File Upload ─── */
async function openFileUpload() {
  let files = await db.getFiles();
  ui.showFileUploader(files, async (rec) => {
    await db.saveFileRecord(rec);
    files = await db.getFiles();
  }, async (id) => {
    await db.deleteFile(id);
    files = await db.getFiles();
  });
}

/* ─── Settings ─── */
async function openSettings() {
  const key = await db.getSetting('apiKey');
  ui.showSettingsPanel(key, async (val) => {
    if (val) {
      await db.setSetting('apiKey', val);
      alert('API Key 已保存');
    }
  });
}
