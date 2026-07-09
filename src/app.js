import * as db from './db.js';
import * as api from './api.js';
import * as mods from './modules.js';
import * as ui from './ui.js';

function updateOnlineStatus() {
  const online = navigator.onLine;
  const btn = ui.$('searchBtn');
  if (btn) {
    btn.textContent = online ? '搜索' : '离线';
    btn.style.opacity = online ? '1' : '0.5';
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const VERSION = 'v10';

const state = {
  modules: [],
  currentModuleId: null,
  currentChatId: null,
  currentMessages: [],
  abortController: null,
  hideAll: false,
  pendingImage: null,
};

(async function init() {
  if (!db.dbReady) {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:system-ui,sans-serif;color:var(--text-secondary);background:var(--bg);padding:20px;text-align:center"><span style="font-size:48px">⚠️</span><h2 style="font-weight:600;font-size:18px;color:var(--text)">IndexedDB 不可用</h2><p style="font-size:14px;max-width:400px;line-height:1.6">请确保浏览器未启用隐私模式，且未禁用 IndexedDB。<br>如果问题持续，请尝试更新浏览器。</p></div>`;
    return;
  }

  try {
    state.modules = await mods.getModuleList();
  } catch (e) {
    state.modules = [];
  }

  const DEFAULT_COUNT = 13;
  ui.updateModuleCount(state.modules.length, DEFAULT_COUNT);
  ui.updateSidebarVersion(VERSION);

  const savedTheme = await db.getSetting('theme') || 'light';
  ui.applyTheme(savedTheme);
  if (savedTheme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      ui.applyTheme('system');
    });
  }

  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW] 注册失败:', e));
  }

  window.addEventListener('beforeunload', () => {
    if (state.currentChatId && state.currentMessages.length > 0) {
      db.saveChatHistoryById(state.currentChatId, state.currentMessages);
    }
  });

  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  bindKeyboardShortcuts();
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
    onBookmark: openBookmarks,
    onPreset: openPresets,
  }, state.hideAll);
  if (state.currentModuleId && active) {
    loadAndShowChat(active.id);
  } else {
    ui.showView('gridView');
  }
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') {
      const sendBtn = ui.$('chatSend');
      if (sendBtn && ui.$('chatView').style.display !== 'none') {
        e.preventDefault();
        sendBtn.click();
      }
    }
    if (e.key === 'Escape') {
      const overlay = ui.$('modalOverlay');
      if (overlay.style.display === 'flex') {
        overlay.style.display = 'none';
      } else if (state.abortController) {
        state.abortController.abort();
      }
    }
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      ui.$('searchInput').focus();
    }
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      const input = ui.$('chatInput');
      if (input) input.focus();
    }
  });
}

function bindGlobalEvents() {
  ui.$('searchBtn').addEventListener('click', onSearch);
  ui.$('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSearch();
  });

  function toggleSidebar() {
    const sidebar = ui.$('sidebar');
    const btn = ui.$('toggleSidebar');
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-overlay');
      document.body.classList.toggle('sidebar-open');
    } else {
      sidebar.classList.toggle('collapsed');
      btn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
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
      ui.showToast('保存失败: ' + e.message, 'error');
    }
  });
}

/* ─── Module Interactions ─── */
async function onModuleClick(id) {
  state.currentModuleId = id;
  state.currentChatId = null;
  await loadAndShowChat(id);
  ui.renderSidebar(state.modules, id, onModuleClick, onModuleToggle);
  if (window.innerWidth <= 768) {
    ui.$('sidebar').classList.remove('mobile-overlay');
    document.body.classList.remove('sidebar-open');
  }
}

async function loadAndShowChat(id, chatId = null) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;

  if (chatId) {
    const chat = await db.getChatHistoryById(chatId);
    state.currentChatId = chatId;
    state.currentMessages = chat ? chat.messages : [];
  } else {
    const chat = await db.getChatHistory(id);
    state.currentChatId = chat ? chat.id : await db.createChatHistory(id);
    state.currentMessages = chat ? chat.messages : [];
  }
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
    onHistory: () => showChatHistory(id),
    onNewChat: () => handleNewChat(id),
  });
}

async function handleSend(text, useWeb) {
  const sendBtn = ui.$('chatSend');
  if (sendBtn.disabled) return;

  const mod = state.modules.find(m => m.id === state.currentModuleId);
  if (!mod) return;

  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();
  sendBtn.disabled = true;
  sendBtn.textContent = '发送中…';

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
  sendBtn.disabled = false;
  sendBtn.textContent = '发送';
  debouncedSaveChatHistory(state.currentChatId, state.currentMessages);
}

const debouncedSaveChatHistory = debounce(async (chatId, messages) => {
  if (chatId) await db.saveChatHistoryById(chatId, messages);
}, 500);

async function handleClearChat(moduleId) {
  const ok = await ui.showConfirm('确认清空此模块的对话记录？');
  if (!ok) return;
  await db.saveChatHistoryById(state.currentChatId, state.currentMessages);
  state.currentMessages = [];
  const newId = await db.createChatHistory(moduleId);
  state.currentChatId = newId;
  const mod = state.modules.find(m => m.id === moduleId);
  if (mod) {
    ui.showChat(mod, state.currentMessages, {
      onSend: (text, useWeb) => handleSend(text, useWeb),
      onBack: handleChatBack,
      onMenu: () => onModuleEdit(moduleId),
      onClearChat: () => handleClearChat(moduleId),
      onHistory: () => showChatHistory(moduleId),
      onNewChat: () => handleNewChat(moduleId),
    });
  }
}

async function handleChatBack() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  if (state.currentChatId) {
    await db.saveChatHistoryById(state.currentChatId, state.currentMessages);
  }
  state.currentModuleId = null;
  state.currentChatId = null;
  state.currentMessages = [];
  ui.showView('gridView');
  ui.renderSidebar(state.modules, null, onModuleClick, onModuleToggle);
}

async function handleNewChat(moduleId) {
  if (state.currentChatId) {
    await db.saveChatHistoryById(state.currentChatId, state.currentMessages);
  }
  const newId = await db.createChatHistory(moduleId);
  state.currentChatId = newId;
  state.currentMessages = [];
  state.pendingImage = null;
  const mod = state.modules.find(m => m.id === moduleId);
  if (mod) {
    ui.showChat(mod, state.currentMessages, {
      onSend: (text, useWeb) => handleSend(text, useWeb),
      onBack: handleChatBack,
      onMenu: () => onModuleEdit(moduleId),
      onClearChat: () => handleClearChat(moduleId),
      onHistory: () => showChatHistory(moduleId),
      onNewChat: () => handleNewChat(moduleId),
    });
  }
}

async function showChatHistory(moduleId) {
  await db.saveChatHistoryById(state.currentChatId, state.currentMessages);
  const histories = await db.getAllChatHistories(moduleId);
  const mod = state.modules.find(m => m.id === moduleId);
  const currentId = state.currentChatId;
  ui.showChatHistoryPanel(histories, currentId, mod?.icon || '💬', {
    onSelect: async (chatId) => {
      await loadAndShowChat(moduleId, chatId);
    },
    onDelete: async (chatId) => {
      await db.deleteChatHistory(chatId);
      return await db.getAllChatHistories(moduleId);
    },
    onRename: async (chatId, title) => {
      await db.renameChatHistory(chatId, title);
      return await db.getAllChatHistories(moduleId);
    },
  });
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
  }, {
    onSavePreset: async (preset) => {
      await db.savePreset(preset);
    },
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

async function openPresets() {
  const presets = await db.getPresets();
  ui.showPresetPanel(presets, {
    onUse: async (preset) => {
      ui.showCreateModule(async (title, icon, prompt, model) => {
        await onModuleCreate(title || preset.title, icon || '📋', prompt || preset.prompt, model || preset.model);
      });
    },
    onDelete: async (id) => {
      await db.deletePreset(id);
    },
  });
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
    ui.showToast(e.message, 'error');
  }
}

/* ─── Search ─── */
async function onSearch() {
  const query = ui.$('searchInput').value.trim();
  if (!query) return;

  const keyOk = await api.checkApiKey();
  if (!keyOk) { ui.showToast('请先在设置中配置 API Key', 'error'); return; }

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
  const theme = await db.getSetting('theme') || 'light';
  const apiBase = await db.getSetting('apiBase');
  const defaultModel = await db.getSetting('defaultModel');
  ui.showSettingsPanel(key, async (val, themeVal, apiBaseVal, defaultModelVal) => {
    if (val) await db.setSetting('apiKey', val);
    if (themeVal) {
      await db.setSetting('theme', themeVal);
      ui.applyTheme(themeVal);
    }
    if (apiBaseVal) await db.setSetting('apiBase', apiBaseVal);
    if (defaultModelVal) await db.setSetting('defaultModel', defaultModelVal);
    ui.showToast('已保存', 'success');
  }, { apiBase, defaultModel, onOpenSavedResults: openSavedResults });
  setTimeout(() => {
    const sel = ui.$('themeSelect');
    if (sel) sel.value = theme;
  }, 50);
}
