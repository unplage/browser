import * as db from './db.js';
import * as api from './api.js';
import * as mods from './modules.js';
import * as ui from './ui.js';

const state = {
  modules: [],
  currentModuleId: null,
  currentMessages: [],
  abortController: null,
};

(async function init() {
  try {
    state.modules = await mods.getModuleList();
  } catch (e) {
    state.modules = [];
  }

  ui.updateModuleCount(state.modules.length);
  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  bindGlobalEvents();
})();

function renderAll() {
  const active = state.modules.find(m => m.id === state.currentModuleId);
  ui.renderSidebar(state.modules, state.currentModuleId, onModuleClick);
  ui.renderGrid(state.modules, {
    onOpen: onModuleClick,
    onEdit: onModuleEdit,
    onToggle: onModuleToggle,
    onReorder: onModuleReorder,
  });
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

  ui.$('toggleSidebar').addEventListener('click', () => {
    ui.$('sidebar').classList.toggle('collapsed');
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
  ui.renderSidebar(state.modules, id, onModuleClick);
}

async function loadAndShowChat(id) {
  const mod = state.modules.find(m => m.id === id);
  if (!mod) return;

  const chat = await db.getChatHistory(id);
  state.currentMessages = chat ? chat.messages : [];

  ui.showChat(mod, state.currentMessages, {
    onSend: text => handleSend(mod, text),
    onBack: handleChatBack,
    onMenu: () => onModuleEdit(id),
  });
}

async function handleSend(mod, text) {
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  state.currentMessages.push({ role: 'user', content: text });
  ui.appendMessage('user', text);

  const msgEl = ui.appendMessage('assistant', '', true);
  let full = '';

  try {
    const result = await api.chatWithModule(mod.systemPrompt, state.currentMessages, (chunk, fullContent) => {
      full = fullContent;
      ui.updateStreamingMessage(msgEl, fullContent);
    });
    ui.stopStreaming(msgEl);
    state.currentMessages.push({ role: 'assistant', content: result });
  } catch (e) {
    ui.stopStreaming(msgEl);
    ui.updateStreamingMessage(msgEl, `\n\n**错误**: ${e.message}`);
  }

  state.abortController = null;
  await db.saveChatHistory(mod.id, state.currentMessages);
}

async function handleChatBack() {
  if (state.currentModuleId) {
    await db.saveChatHistory(state.currentModuleId, state.currentMessages);
  }
  state.currentModuleId = null;
  state.currentMessages = [];
  ui.showView('gridView');
  ui.renderSidebar(state.modules, null, onModuleClick);
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
