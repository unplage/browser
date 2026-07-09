export function $(id) { return document.getElementById(id); }

export function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^-{3,}$/gm, '<hr>');
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre><code${langClass}>${escapeHtml(code.trim())}</code></pre>`;
  });
  html = html.split(/\n\n+/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<h[1-4]/.test(t) || /^<hr/.test(t) || /^<pre/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

export function showView(viewId) {
  ['gridView', 'chatView', 'searchView', 'browserView'].forEach(id => {
    $(id).style.display = id === viewId ? '' : 'none';
  });
}

/* ─── Sidebar ─── */
export function renderSidebar(modules, activeId, onModuleClick, onModuleToggle) {
  const nav = $('moduleNav');
  nav.innerHTML = '';
  modules.forEach(m => {
    const item = document.createElement('div');
    const isActive = m.id === activeId;
    const disabled = !m.enabled;
    item.className = `nav-item${isActive ? ' active' : ''}${disabled ? ' disabled' : ''}`;
    if (disabled) {
      item.innerHTML = `<span class="icon">${m.icon}</span><span class="title">${escapeHtml(m.title)}</span><button class="nav-show-btn" data-id="${m.id}">👁️</button>`;
      item.querySelector('.nav-show-btn').onclick = e => {
        e.stopPropagation();
        if (onModuleToggle) onModuleToggle(m.id);
      };
    } else {
      item.innerHTML = `<span class="icon">${m.icon}</span><span class="title">${escapeHtml(m.title)}</span>`;
    }
    item.addEventListener('click', () => {
      if (disabled && onModuleToggle) {
        onModuleToggle(m.id);
      } else if (!disabled) {
        onModuleClick(m.id);
      }
    });
    nav.appendChild(item);
  });
}

/* ─── Theme ─── */
export function applyTheme(mode) {
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (mode === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    // system
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }
}

/* ─── Quick Search Bar ─── */
const SEARCH_ENGINES = [
  { label: 'Bing', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { label: 'Yandex', url: q => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
  { label: '百度', url: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { label: 'Google', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { label: 'DuckDuckGo', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
];

export function renderQuickSearchBar(grid, callbacks) {
  const bar = document.createElement('div');
  bar.className = 'quick-search';
  const sel = document.createElement('select');
  sel.id = 'qsEngine';
  SEARCH_ENGINES.forEach((eng, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `🌐 ${eng.label}`;
    sel.appendChild(opt);
  });

  const input = document.createElement('input');
  input.id = 'qsInput';
  input.type = 'text';
  input.placeholder = '输入网址或搜索词...';

  const goBtn = document.createElement('button');
  goBtn.id = 'qsGo';
  goBtn.className = 'qs-btn';
  goBtn.textContent = '🚀';

  const bmBtn = document.createElement('button');
  bmBtn.id = 'qsBookmarkBtn';
  bmBtn.className = 'qs-bookmark-btn';
  bmBtn.title = '书签管理';
  bmBtn.setAttribute('aria-label', '书签管理');
  bmBtn.textContent = '📑';
  bmBtn.onclick = () => {
    if (callbacks.onBookmark) callbacks.onBookmark();
  };

  bar.appendChild(sel);
  bar.appendChild(input);
  bar.appendChild(goBtn);
  bar.appendChild(bmBtn);
  grid.insertBefore(bar, grid.firstChild);

  goBtn.onclick = () => handleQuickSearch(input, sel);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleQuickSearch(input, sel);
  });
}

function handleQuickSearch(input, sel) {
  const text = input.value.trim();
  if (!text) return;
  const idx = parseInt(sel.value, 10);
  // detect URL
  if (/^https?:\/\/./i.test(text) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/|$)/.test(text)) {
    const url = text.startsWith('http') ? text : `https://${text}`;
    showBrowserView(url, () => showView('gridView'));
  } else {
    const engine = SEARCH_ENGINES[idx];
    window.open(engine.url(text), '_blank');
  }
  input.value = '';
}

/* ─── Grid ─── */
export function renderGrid(modules, callbacks, hideAll = false) {
  const grid = $('gridView');
  if (hideAll) {
    grid.innerHTML = `<div class="grid-view-title" style="border:none;margin:0">
      <span style="color:var(--text-tertiary)">👁️ 所有模块已隐藏</span>
      <button class="restore-btn" id="gridRestoreAllBtn">🔁 全部显示</button>
    </div>`;
    const restoreBtn = grid.querySelector('#gridRestoreAllBtn');
    if (restoreBtn) restoreBtn.onclick = () => {
      const btn = $('hideAllBtn');
      if (btn) btn.click();
    };
    renderQuickSearchBar(grid, callbacks);
    return;
  }
  grid.innerHTML = `<div class="grid-view-title">
    <span>🧩 模块工作室 <span class="sort-hint">（拖拽卡片排序）</span></span>
    <div style="display:flex;gap:6px">
      <button class="btn-presets" id="gridPresetsBtn">📋</button>
      <button class="btn-create" id="gridCreateBtn">➕ 创建模块</button>
    </div>
  </div>`;
  renderQuickSearchBar(grid, callbacks);
  modules.filter(m => m.enabled).forEach(m => {
    const card = document.createElement('div');
    card.className = 'module-card';
    card.dataset.id = m.id;
    card.innerHTML = `
      <div class="module-card-header">
        <span class="drag-handle">⠿</span>
        <span class="icon">${m.icon}</span>
        <span class="title">${escapeHtml(m.title)}</span>
      </div>
      <div class="module-card-preview">${escapeHtml(m.systemPrompt.slice(0, 80))}…</div>
      <div class="module-card-actions">
        <button class="edit-btn" data-action="edit">✏️ 编辑</button>
        <button class="toggle-btn" data-action="disable">${m.enabled ? '🔇' : '🔊'}</button>
        <button class="del-btn" data-action="delete">🗑️</button>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.module-card-actions')) return;
      callbacks.onOpen(m.id);
    });
    card.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      callbacks.onEdit(m.id);
    });
    card.querySelector('[data-action="disable"]').addEventListener('click', e => {
      e.stopPropagation();
      callbacks.onToggle(m.id);
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await showConfirm(`确认删除模块「${m.title}」？此操作不可恢复。`);
      if (ok) callbacks.onDelete(m.id);
    });
    grid.appendChild(card);
  });

  $('gridCreateBtn').onclick = () => callbacks.onCreate();
  const presetsBtn = $('gridPresetsBtn');
  if (presetsBtn) presetsBtn.onclick = () => { if (callbacks.onPreset) callbacks.onPreset(); };

  if (window.Sortable) {
    Sortable.create(grid, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      filter: '.grid-view-title, #gridCreateBtn, .module-card-actions, .module-card-header .icon, .module-card-header .title',
      delay: 200,
      delayOnTouchOnly: true,
      onEnd: e => {
        const ids = [...grid.querySelectorAll('.module-card')].map(c => c.dataset.id);
        callbacks.onReorder(ids);
      }
    });
  }
}

export function updateModuleCount(count, defaultCount = 12) {
  $('moduleCount').textContent = `模块: ${count}/${defaultCount}`;
}

/* ─── Chat ─── */
let currentChatModule = null;

export function showChatSkeleton() {
  const container = $('chatMessages');
  container.innerHTML = `<div class="chat-skeleton">
    <div class="sk-msg assistant"><div class="sk-avatar skeleton"></div><div class="sk-bubble skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
    <div class="sk-msg user"><div class="sk-avatar skeleton"></div><div class="sk-bubble skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
  </div>`;
}

export function showChat(module, messages, callbacks = {}) {
  currentChatModule = module;
  showView('chatView');
  $('chatTitle').textContent = `${module.icon} ${escapeHtml(module.title)}`;
  const container = $('chatMessages');
  container.innerHTML = '';

  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">${module.icon}</div><div class="text">开始与「${escapeHtml(module.title)}」对话</div><div class="hint">输入消息后按 Enter 发送，或输入 / 搜索历史对话</div></div>`;
  } else {
    messages.forEach(msg => appendMessage(msg.role, msg.content));
  }

  const sendBtn = $('chatSend');
  const input = $('chatInput');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });
  const webToggle = $('chatWebToggle');
  const uploadBtn = $('chatUploadBtn');
  const fileInput = $('chatFileInput');
  let previewContainer = $('chatImagePreview');
  if (!previewContainer) {
    previewContainer = document.createElement('div');
    previewContainer.id = 'chatImagePreview';
    previewContainer.style.display = 'none';
    $('chatInputArea').insertBefore(previewContainer, $('chatInput'));
  }
  previewContainer.style.display = 'none';
  previewContainer.innerHTML = '';
  webToggle.classList.remove('active');
  sendBtn.onclick = () => {
    const text = input.value.trim();
    if (!text && !previewContainer.querySelector('img')) return;
    const useWeb = webToggle.classList.contains('active');
    input.value = '';
    input.style.height = 'auto';
    if (callbacks.onSend) callbacks.onSend(text || '请分析这张图片', useWeb);
  };
  webToggle.onclick = () => {
    webToggle.classList.toggle('active');
  };
  uploadBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        previewContainer.innerHTML = `<div class="image-preview"><img src="${reader.result}" alt="preview"><button class="remove-image-btn" id="removeImageBtn">✕</button></div>`;
        previewContainer.style.display = 'block';
        $('removeImageBtn').onclick = () => { previewContainer.style.display = 'none'; previewContainer.innerHTML = ''; if (callbacks.onImage) callbacks.onImage(null); };
        if (callbacks.onImage) callbacks.onImage(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result;
        const text = `请分析以下文件内容：\n\n文件名: ${file.name}\n\n\`\`\`\n${content}\n\`\`\``;
        if (callbacks.onSend) callbacks.onSend(text, false);
      };
      reader.readAsText(file);
    }
  };
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.focus();

  $('chatNewBtn').style.display = callbacks.onNewChat ? '' : 'none';
  $('chatHistoryBtn').style.display = callbacks.onHistory ? '' : 'none';
  $('backToGrid').onclick = () => {
    if (callbacks.onBack) callbacks.onBack();
    else showView('gridView');
  };
  $('chatMenuBtn').onclick = () => {
    if (callbacks.onMenu) callbacks.onMenu();
  };
  $('clearChatBtn').onclick = () => {
    if (callbacks.onClearChat) callbacks.onClearChat();
  };
  $('chatStopBtn').onclick = () => {
    if (callbacks.onStop) callbacks.onStop();
  };
  $('chatNewBtn').onclick = () => {
    if (callbacks.onNewChat) callbacks.onNewChat();
  };
  $('chatHistoryBtn').onclick = () => {
    if (callbacks.onHistory) callbacks.onHistory();
  };
  $('chatStopBtn').style.display = 'none';
}

export function showStreaming(active) {
  const btn = $('chatStopBtn');
  if (btn) btn.style.display = active ? '' : 'none';
}

export function appendMessage(role, content, streaming = false, imageData = null) {
  const container = $('chatMessages');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `msg ${role}${streaming ? ' streaming' : ''}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const avatar = role === 'user' ? '👤' : currentChatModule?.icon || '🤖';
  let body = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
  if (imageData && role === 'user') {
    body = `<img src="${imageData}" class="msg-image" alt="用户上传的图片">${body ? '<br>' + body : ''}`;
  }
  msg.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${streaming && !content && !imageData ? '<span class="thinking-text">思考中...</span>' : body}</div>
    <div class="msg-time">${time}</div>`;
  if (role === 'assistant' && content) {
    const bubble = msg.querySelector('.msg-bubble');
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = '复制';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.textContent = '✅';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
      });
    };
    bubble.appendChild(copyBtn);
  }
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  if (role === 'assistant' && content) applyHighlighting(msg);
  return msg;
}

function applyHighlighting(container) {
  if (window.hljs) {
    container.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  }
}

export function updateStreamingMessage(msgEl, fullContent) {
  const bubble = msgEl.querySelector('.msg-bubble');
  if (bubble) {
    bubble.innerHTML = renderMarkdown(fullContent);
    applyHighlighting(bubble);
  }
}

export function stopStreaming(msgEl) {
  msgEl.classList.remove('streaming');
}

export function clearPendingImage() {
  const prev = $('chatImagePreview');
  if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
}

/* ─── Search Results ─── */
export function showSearchLoading() {
  showView('searchView');
  $('searchViewTitle').textContent = '搜索分析中…';
  $('searchResultContent').innerHTML = '<div class="search-loading"><span class="spinner"></span>正在联网搜索并分析…</div>';
  $('saveSearchBtn').style.display = 'none';
  $('searchBackBtn').onclick = () => showView('gridView');
  $('searchBtn').classList.add('loading');
  $('searchBtn').textContent = '搜索中…';
}

export function showSearchResult(query, content) {
  $('searchViewTitle').textContent = `🔍 ${query}`;
  $('searchResultContent').innerHTML = renderMarkdown(content);
  const saveBtn = $('saveSearchBtn');
  saveBtn.style.display = '';
  saveBtn._query = query;
  saveBtn._content = content;
  saveBtn._resultText = $('searchResultContent').innerText;
  $('searchBtn').classList.remove('loading');
  $('searchBtn').textContent = '搜索';
}

export function getSavedSearchData() {
  const btn = $('saveSearchBtn');
  return { query: btn._query, content: btn._content, result: btn._resultText || $('searchResultContent').innerText };
}

/* ─── Modals ─── */
export function showModal(title, bodyEl, footerEl) {
  const overlay = $('modalOverlay');
  const content = $('modalContent');
  const lastFocusedEl = document.activeElement;
  content.innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <div class="modal-body"></div>
    ${footerEl ? '<div class="modal-footer"></div>' : ''}`;
  content.querySelector('.modal-body').appendChild(bodyEl);
  if (footerEl) content.querySelector('.modal-footer').appendChild(footerEl);
  const close = () => {
    overlay.style.display = 'none';
    if (lastFocusedEl) lastFocusedEl.focus();
  };
  $('modalCloseBtn').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };

  const focusableEls = content.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
  const firstFocusable = focusableEls[0];
  const lastFocusable = focusableEls[focusableEls.length - 1];

  if (firstFocusable) firstFocusable.focus();

  content.addEventListener('keydown', function trap(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        if (lastFocusable) lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        if (firstFocusable) firstFocusable.focus();
      }
    }
  });

  overlay.style.display = 'flex';
  return { close, body: content.querySelector('.modal-body'), footer: content.querySelector('.modal-footer') };
}

/* ─── Settings ─── */
export function showSettingsPanel(apiKey, onSave, extra = {}) {
  const form = document.createElement('div');
  form.className = 'settings-form';
  form.innerHTML = `
    <label>API Key
      <small style="color:var(--text-tertiary);font-weight:400"> — 从 <a href="https://open.bigmodel.cn" target="_blank" style="color:var(--accent)">bigmodel.cn</a> 获取</small>
    </label>
    <input type="password" id="apiKeyInput" value="${escapeHtml(apiKey || '')}" placeholder="输入你的 API Key">
    <label>API 地址
      <small style="color:var(--text-tertiary);font-weight:400"> — 默认智谱 GLM</small>
    </label>
    <input type="text" id="apiBaseInput" value="${escapeHtml(extra.apiBase || 'https://open.bigmodel.cn/api/paas/v4')}" placeholder="https://open.bigmodel.cn/api/paas/v4">
    <label>默认模型
      <small style="color:var(--text-tertiary);font-weight:400"> — 用于未指定模型的模块</small>
    </label>
    <input type="text" id="defaultModelInput" value="${escapeHtml(extra.defaultModel || 'glm-4.7-flash')}" placeholder="glm-4.7-flash">
    <div class="hint">修改 API 地址可接入其他兼容 OpenAI 协议的推理服务</div>
    <label>主题模式</label>
    <select id="themeSelect" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface-secondary);font-size:13px;color:var(--text)">
      <option value="light">☀️ 亮色</option>
      <option value="dark">🌙 暗色</option>
      <option value="system">💻 跟随系统</option>
    </select>`;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const saveBtn = mkPrimaryBtn('保存');
  const exportAllBtn = mkBtn('📤 导出全部数据');
  const importAllBtn = mkBtn('📥 导入数据');
  footer.appendChild(saveBtn);
  footer.appendChild(exportAllBtn);
  footer.appendChild(importAllBtn);
  const modal = showModal('⚙️ 设置', form, footer);
  saveBtn.onclick = async () => {
    const val = $('apiKeyInput').value.trim();
    const theme = $('themeSelect').value;
    const apiBase = $('apiBaseInput').value.trim();
    const defaultModel = $('defaultModelInput').value.trim();
    await onSave(val, theme, apiBase, defaultModel);
    modal.close();
  };
  exportAllBtn.onclick = () => {
    import('../src/db.js').then(async db => {
      const data = {
        modules: await db.getModules(),
        bookmarks: await db.getBookmarks(),
        searchResults: await db.getSearchResults(),
        chatHistory: await db.db.chatHistory.toArray(),
        files: await db.getFiles(),
        settings: await db.db.settings.toArray(),
        exportedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `ai-browser-backup-${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
      showToast('数据已导出', 'success');
    });
  };
  importAllBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.modules && !data.bookmarks) { showToast('无效的备份文件', 'error'); return; }
        const ok = await showConfirm('导入将覆盖现有数据，确认继续？');
        if (!ok) return;
        import('../src/db.js').then(async db => {
          if (data.modules?.length) {
            await db.db.modules.clear();
            await db.saveModules(data.modules);
          }
          if (data.bookmarks?.length) {
            await db.db.bookmarks.clear();
            for (const b of data.bookmarks) await db.addBookmark(b);
          }
          if (data.settings?.length) {
            await db.db.settings.clear();
            for (const s of data.settings) await db.db.settings.put(s);
          }
          showToast('数据已导入，请刷新页面', 'success');
        });
      } catch (err) { showToast('导入失败: ' + err.message, 'error'); }
    };
    input.click();
  };
}

/* ─── Bookmarks ─── */
export function showBookmarkPanel(bookmarks, callbacks) {
  const container = document.createElement('div');
  renderBookmarks(container, bookmarks, callbacks, false);
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const addBtn = mkBtn('➕ 添加');
  const importBtn = mkBtn('📥 导入 HTML');
  const exportBtn = mkBtn('📤 导出 JSON');
  const saveResultBtn = mkBtn('💾 保存当前搜索结果');
  const batchBtn = mkBtn('☑️ 批量操作');
  [addBtn, importBtn, exportBtn, saveResultBtn, batchBtn].forEach(b => footer.appendChild(b));

  let batchMode = false;
  batchBtn.onclick = () => {
    batchMode = !batchMode;
    renderBookmarks(container, bookmarks, callbacks, batchMode);
    batchBtn.textContent = batchMode ? '✅ 完成' : '☑️ 批量操作';
  };

  const modal = showModal('📑 书签管理', container, footer);

  addBtn.onclick = async () => {
    const url = prompt('输入网址:');
    if (!url) return;
    let host = '';
    try { host = new URL(url).hostname; } catch { host = url; }
    const title = prompt('输入标题:', host);
    const updated = await callbacks.onAdd({ url, title: title || url, tags: '' });
    renderBookmarks(container, updated, callbacks);
  };
  importBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const links = doc.querySelectorAll('a[href]');
      for (const a of links) {
        if (a.href.startsWith('http')) {
          await callbacks.onAdd({ url: a.href, title: a.textContent || a.href, tags: '' });
        }
      }
      const updated = await (callbacks.onRefresh ? callbacks.onRefresh() : Promise.resolve(bookmarks));
      renderBookmarks(container, updated, callbacks);
    };
    input.click();
  };
  exportBtn.onclick = () => {
    const data = JSON.stringify(bookmarks, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ai-browser-bookmarks.json'; a.click();
    URL.revokeObjectURL(url);
  };
  saveResultBtn.onclick = async () => {
    const data = getSavedSearchData();
    if (data.query) {
      const updated = await callbacks.onAdd({ url: '', title: `[搜索] ${data.query}`, tags: 'search-result' });
      renderBookmarks(container, updated, callbacks);
    }
  };
}

function renderBookmarks(container, bookmarks, callbacks, batchMode) {
  container.innerHTML = '';
  if (bookmarks.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无书签</div></div>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'bookmark-list';
  const selected = new Set();
  bookmarks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    const favicon = (b.url && b.url.startsWith('http')) ? `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32` : '';
    item.innerHTML = `
      ${batchMode ? `<input type="checkbox" class="batch-check" data-id="${b.id}" style="flex-shrink:0;width:16px;height:16px">` : ''}
      <span class="favicon">${favicon ? `<img src="${favicon}" width="16" height="16" onerror="this.style.display='none'" style="border-radius:2px">` : '📌'}</span>
      <div class="info">
        <div class="title">${escapeHtml(b.title)}</div>
        <div class="url">${escapeHtml(b.url || '本地记录')}</div>
      </div>
      <button class="del-btn" data-id="${b.id}">✕</button>`;
    if (batchMode) {
      const cb = item.querySelector('.batch-check');
      cb.onchange = () => {
        if (cb.checked) selected.add(b.id);
        else selected.delete(b.id);
      };
    }
    item.querySelector('.del-btn').onclick = async e => {
      e.stopPropagation();
      if (!await showConfirm('确认删除此书签？')) return;
      const updated = await callbacks.onDelete(b.id);
      renderBookmarks(container, updated, callbacks, batchMode);
    };
    if (b.url && b.url.startsWith('http')) {
      item.style.cursor = 'pointer';
      item.onclick = e => {
        if (e.target.closest('.del-btn') || e.target.closest('.batch-check')) return;
        if (callbacks.onOpenUrl) {
          callbacks.onOpenUrl(b.url);
        } else {
          window.open(b.url, '_blank');
        }
      };
    }
    list.appendChild(item);
  });
  if (batchMode) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;padding:8px 0;flex-wrap:wrap;';
    const selectAllBtn = mkBtn('全选');
    const delSelectedBtn = mkBtn('🗑️ 删除选中');
    bar.appendChild(selectAllBtn);
    bar.appendChild(delSelectedBtn);
    selectAllBtn.onclick = () => {
      const cbs = list.querySelectorAll('.batch-check');
      const allChecked = [...cbs].every(cb => cb.checked);
      cbs.forEach(cb => { cb.checked = !allChecked; if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id); });
      selectAllBtn.textContent = allChecked ? '全选' : '取消全选';
    };
    delSelectedBtn.onclick = async () => {
      if (selected.size === 0) { showToast('请先选择书签', 'error'); return; }
      const ok = await showConfirm(`确认删除选中的 ${selected.size} 个书签？`);
      if (!ok) return;
      for (const id of selected) await callbacks.onDelete(id);
      selected.clear();
      const updated = await (callbacks.onRefresh ? callbacks.onRefresh() : Promise.resolve(bookmarks));
      renderBookmarks(container, updated, callbacks, batchMode);
    };
    list.insertBefore(bar, list.firstChild);
  }
  container.appendChild(list);
}

/* ─── File Upload ─── */
export function showFileUploader(savedFiles, onUpload, onDelete) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="upload-zone" id="uploadZone">
      <span class="icon">📄</span>
      <span class="text">点击或拖拽文件到这里上传分析</span>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">支持 .txt .md .json .csv .js .py .html</div>
    </div>
    <div class="file-list" id="fileList"></div>`;
  const modal = showModal('📎 文件分析', container);
  const zone = $('uploadZone');
  const fileList = $('fileList');

  function renderFiles() {
    fileList.innerHTML = '';
    if (savedFiles.length === 0) return;
    savedFiles.forEach(f => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span>📄</span>
        <span class="name">${escapeHtml(f.fileName)}</span>
        <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0">${new Date(f.createdAt).toLocaleDateString()}</span>
        <button class="del-btn" data-id="${f.id}">✕</button>`;
      item.querySelector('.del-btn').onclick = e => { e.stopPropagation(); onDelete(f.id).then(() => renderFiles()); };
      item.onclick = e => {
        if (e.target.closest('.del-btn')) return;
        const d = document.createElement('div');
        d.innerHTML = renderMarkdown(f.analysis || f.content);
        showModal('📄 ' + escapeHtml(f.fileName), d);
      };
      fileList.appendChild(item);
    });
  }
  renderFiles();

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.md,.json,.csv,.js,.py,.html,.ts,.jsx,.tsx,.css,.xml,.yaml,.yml,.log,.ini,.cfg';
  fileInput.style.display = 'none';
  container.appendChild(fileInput);

  zone.onclick = () => fileInput.click();
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  };
  fileInput.onchange = () => { if (fileInput.files.length) handleFile(fileInput.files[0]); };

  async function handleFile(file) {
    let text;
    try { text = await file.text(); } catch { showToast('无法读取文件', 'error'); return; }
    const loadingModal = showModal(`📄 分析中: ${file.name}`, (() => {
      const d = document.createElement('div');
      d.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span> 正在分析文件...</div>';
      return d;
    })());
    try {
      const { analyzeFile } = await import('./api.js');
      const analysis = await analyzeFile(text, file.name);
      loadingModal.close();
      await onUpload({ fileName: file.name, fileType: file.name.split('.').pop(), content: text.slice(0, 5000), analysis });
      const resultDiv = document.createElement('div');
      resultDiv.innerHTML = renderMarkdown(analysis);
      if (window.hljs) resultDiv.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
      showModal(`📄 ${escapeHtml(file.name)}`, resultDiv);
      renderFiles();
    } catch (err) {
      loadingModal.close();
      showToast('分析失败: ' + err.message, 'error');
    }
  }
}

/* ─── Module Editor ─── */
export function showModuleEditor(module, onSave, callbacks = {}) {
  const form = document.createElement('div');
  form.className = 'module-editor';
  const isCustom = !isDefaultModule(module.id);
  const row = isCustom ? `<label>模型</label>
    <select id="modModel" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface-secondary);font-size:13px">
      <option value="glm-4.7-flash" ${(!module.model || module.model === 'glm-4.7-flash') ? 'selected' : ''}>glm-4.7-flash（默认）</option>
      <option value="glm-4.6v-flash" ${module.model === 'glm-4.6v-flash' ? 'selected' : ''}>glm-4.6v-flash（视觉）</option>
    </select>` : '';
  form.innerHTML = `
    <label>模块名称</label>
    <input type="text" id="modTitle" value="${escapeHtml(module.title)}">
    <label>图标 (Emoji)</label>
    <input type="text" id="modIcon" value="${module.icon}" style="width:70px">
    ${row}
    <label>系统提示词 (System Prompt)</label>
    <textarea id="modPrompt">${escapeHtml(module.systemPrompt)}</textarea>
    ${isCustom ? '' : '<button class="reset-btn">↺ 恢复默认提示词</button>'}`;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const saveBtn = mkPrimaryBtn('保存');
  const savePresetBtn = mkBtn('📋 保存为预设');
  footer.appendChild(saveBtn);
  footer.appendChild(savePresetBtn);
  const modal = showModal(`✏️ 编辑模块: ${escapeHtml(module.title)}`, form, footer);

  savePresetBtn.onclick = async () => {
    const title = $('modTitle').value.trim() || module.title;
    const prompt = $('modPrompt').value.trim() || module.systemPrompt;
    const model = isCustom ? ($('modModel')?.value || module.model || 'glm-4.7-flash') : 'glm-4.7-flash';
    await callbacks.onSavePreset({ title, prompt, model });
    showToast('预设已保存', 'success');
  };

  if (!isCustom) {
    form.querySelector('.reset-btn').onclick = async () => {
      const { getDefaultPrompt } = await import('./modules.js');
      $('modPrompt').value = getDefaultPrompt(module.id);
    };
  }
  saveBtn.onclick = async () => {
    const changes = {
      title: $('modTitle').value.trim(),
      icon: $('modIcon').value.trim(),
      systemPrompt: $('modPrompt').value.trim(),
    };
    if (isCustom) {
      const model = $('modModel').value;
      if (model !== 'glm-4.7-flash') changes.model = model;
      else delete changes.model;
    }
    await onSave(module.id, changes);
    modal.close();
  };
}

/* ─── Create Module ─── */
export function showCreateModule(onCreate) {
  const form = document.createElement('div');
  form.className = 'module-editor';
  form.innerHTML = `
    <label>模块名称</label>
    <input type="text" id="newModTitle" placeholder="例如：AI 绘画助手" autofocus>
    <label>图标 (Emoji)</label>
    <input type="text" id="newModIcon" value="🤖" style="width:70px">
    <label>模型</label>
    <select id="newModModel" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface-secondary);font-size:13px">
      <option value="glm-4.7-flash">glm-4.7-flash（默认，文本）</option>
      <option value="glm-4.6v-flash">glm-4.6v-flash（视觉，支持图片）</option>
    </select>
    <label>系统提示词 (System Prompt)</label>
    <textarea id="newModPrompt" placeholder="输入模块的系统提示词，定义 AI 的行为和专业知识..." style="min-height:150px"></textarea>`;
  const footer = document.createElement('div');
  const createBtn = mkPrimaryBtn('✨ 创建模块');
  footer.appendChild(createBtn);
  const modal = showModal('➕ 创建自定义模块', form, footer);

  createBtn.onclick = async () => {
    const title = $('newModTitle').value.trim();
    const icon = $('newModIcon').value.trim() || '🤖';
    const prompt = $('newModPrompt').value.trim();
    const model = $('newModModel').value;
    if (!title) { showToast('请输入模块名称', 'error'); $('newModTitle').focus(); return; }
    if (!prompt) { showToast('请输入系统提示词', 'error'); $('newModPrompt').focus(); return; }
    await onCreate(title, icon, prompt, model);
    modal.close();
  };
}

function isDefaultModule(id) {
  const defaults = ['poetry','drug','english','reading','programming','leisure','baby','philosophy','tech','news','finance','futures','vision'];
  return defaults.includes(id);
}

/* ─── Saved Search Results ─── */
export function showSavedResults(results, onDelete) {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto;';
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无保存的搜索结果</div></div>';
  } else {
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'saved-result-item';
      item.innerHTML = `
        <div class="meta">${new Date(r.savedAt).toLocaleString('zh-CN')}</div>
        <div class="query">🔍 ${escapeHtml(r.query)}</div>
        <button class="del-btn" data-id="${r.id}">✕</button>`;
      item.querySelector('.del-btn').onclick = async e => {
        e.stopPropagation();
        await onDelete(r.id);
        item.remove();
        if (container.querySelectorAll('.saved-result-item').length === 0) {
          container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无保存的搜索结果</div></div>';
        }
      };
      item.addEventListener('click', e => {
        if (e.target.closest('.del-btn')) return;
        showSearchResult(r.query, r.result || r.content);
        $('saveSearchBtn').style.display = 'none';
      });
      container.appendChild(item);
    });
  }
  showModal('💾 已保存的搜索结果', container);
}

/* ─── Chat History Panel ─── */
export function showChatHistoryPanel(histories, currentId, icon, callbacks) {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '🔍 搜索对话...';
  searchInput.style.cssText = 'padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:13px;background:var(--surface-secondary);color:var(--text);outline:none;margin-bottom:4px;flex-shrink:0';
  container.appendChild(searchInput);

  function render(filter = '') {
    const itemsContainer = container.querySelector('.history-items') || (() => {
      const d = document.createElement('div');
      d.className = 'history-items';
      d.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      container.appendChild(d);
      return d;
    })();
    itemsContainer.innerHTML = '';
    const filtered = filter ? histories.filter(h => {
      const firstMsg = h.messages?.find(m => m.role === 'user')?.content || '';
      const title = h.title || '';
      return title.includes(filter) || firstMsg.includes(filter);
    }) : histories;
    if (filtered.length === 0) {
      itemsContainer.innerHTML = '<div class="empty-state" style="padding:16px"><div class="text">无匹配对话</div></div>';
      return;
    }
    filtered.forEach(h => {
      const item = document.createElement('div');
      item.className = `history-item${h.id === currentId ? ' active' : ''}`;
      const firstMsg = h.messages?.find(m => m.role === 'user')?.content || '';
      const title = h.title || firstMsg.slice(0, 50) || '新对话';
      const msgCount = h.messages?.length || 0;
      const date = new Date(h.createdAt).toLocaleDateString('zh-CN');
      item.innerHTML = `
        <div class="history-item-main">
          <div class="history-item-title">${escapeHtml(title)}</div>
          <div class="history-item-meta">${date} · ${msgCount} 条消息</div>
        </div>
        ${h.id === currentId ? '<span class="history-current-badge">当前</span>' : ''}
        <button class="history-rename-btn" data-id="${h.id}">✏️</button>
        <button class="history-del-btn" data-id="${h.id}">✕</button>`;
      item.querySelector('.history-rename-btn').onclick = async e => {
        e.stopPropagation();
        const newTitle = prompt('重命名对话：', h.title || title);
        if (newTitle && newTitle.trim()) {
          const updated = await callbacks.onRename(h.id, newTitle.trim());
          histories = updated;
          render(searchInput.value);
        }
      };
      item.querySelector('.history-del-btn').onclick = async e => {
        e.stopPropagation();
        if (h.id === currentId) { showToast('不能删除当前对话', 'error'); return; }
        const ok = await showConfirm('确认删除此对话？');
        if (!ok) return;
        const updated = await callbacks.onDelete(h.id);
        histories = updated;
        render(searchInput.value);
      };
      item.addEventListener('click', e => {
        if (e.target.closest('.history-del-btn') || e.target.closest('.history-rename-btn')) return;
        if (h.id === currentId) return;
        callbacks.onSelect(h.id);
        modal.close();
      });
      itemsContainer.appendChild(item);
    });
  }
  searchInput.addEventListener('input', () => render(searchInput.value));
  render();

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const exportBtn = mkBtn('📤 导出全部');
  footer.appendChild(exportBtn);
  exportBtn.onclick = () => {
    const data = histories.map(h => {
      const firstMsg = h.messages?.find(m => m.role === 'user')?.content || '';
      const title = h.title || firstMsg.slice(0, 50) || '新对话';
      return { title, createdAt: h.createdAt, messages: h.messages };
    });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-history-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const modal = showModal(`${icon} 对话历史`, container, footer);
}

/* ─── Presets ─── */
export function showPresetPanel(presets, callbacks) {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto;';

  function render() {
    container.innerHTML = '';
    if (presets.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无预设模板</div><div class="hint">在模块编辑器中可将模块保存为模板</div></div>';
      return;
    }
    presets.forEach(p => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.style.cursor = 'pointer';
      const preview = p.prompt?.slice(0, 80) || '';
      item.innerHTML = `
        <span style="font-size:18px;flex-shrink:0">📋</span>
        <div class="info">
          <div class="title">${escapeHtml(p.title)}</div>
          <div class="url" style="font-size:11px">${escapeHtml(preview)}${preview.length < (p.prompt?.length || 0) ? '…' : ''}</div>
        </div>
        <button class="preset-use-btn" data-id="${p.id}">使用</button>
        <button class="del-btn" data-id="${p.id}">✕</button>`;
      item.querySelector('.preset-use-btn').onclick = async e => {
        e.stopPropagation();
        if (callbacks.onUse) callbacks.onUse(p);
        modal.close();
      };
      item.querySelector('.del-btn').onclick = async e => {
        e.stopPropagation();
        const ok = await showConfirm('确认删除此预设？');
        if (!ok) return;
        await callbacks.onDelete(p.id);
        presets = presets.filter(x => x.id !== p.id);
        render();
      };
      item.addEventListener('click', e => {
        if (e.target.closest('.del-btn') || e.target.closest('.preset-use-btn')) return;
        if (callbacks.onUse) callbacks.onUse(p);
        modal.close();
      });
      container.appendChild(item);
    });
  }
  render();
  const modal = showModal('📋 预设模板', container);
}

/* ─── In-App Browser ─── */
export function showBrowserView(url, onBack) {
  showView('browserView');
  $('browserUrl').textContent = url;
  const frame = $('browserFrame');
  frame.src = url;
  frame.onerror = () => {
    frame.style.display = 'none';
    frame.insertAdjacentHTML('afterend', '<div class="fallback" style="padding:40px;text-align:center;color:var(--text-tertiary)">⚠️ 此页面无法在应用内打开，请使用外部浏览器</div>');
  };
  $('browserBack').onclick = () => {
    frame.src = '';
    if (onBack) onBack();
    else showView('gridView');
  };
  $('browserOpenExternal').onclick = () => {
    window.open(url, '_blank');
  };
}

/* ─── Toast ─── */
export function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-hiding');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export function showConfirm(message) {
  return new Promise(resolve => {
    const body = document.createElement('div');
    body.textContent = message;
    body.style.cssText = 'font-size:14px;color:var(--text-secondary);padding:8px 0;line-height:1.6';
    const footer = document.createElement('div');
    const cancelBtn = mkBtn('取消');
    const okBtn = mkPrimaryBtn('确认');
    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    const modal = showModal('确认', body, footer);
    cancelBtn.onclick = () => { modal.close(); resolve(false); };
    okBtn.onclick = () => { modal.close(); resolve(true); };
  });
}

/* ─── Sidebar Footer ─── */
export function updateSidebarVersion(version) {
  const footer = $('sidebarFooter');
  if (footer) footer.textContent = `v${version}`;
}

/* ─── Utility ─── */
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function mkBtn(text) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'padding:7px 16px;border-radius:20px;font-size:12px;font-weight:500;border:1px solid var(--border);transition:var(--transition);background:var(--surface);';
  return b;
}

function mkPrimaryBtn(text) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'padding:9px 22px;background:var(--accent-gradient);color:#fff;border-radius:20px;font-size:13px;font-weight:600;transition:var(--transition);box-shadow:0 2px 8px rgba(37,99,235,0.2);';
  b.onmouseenter = () => { b.style.transform = 'translateY(-1px)'; b.style.boxShadow = '0 4px 14px rgba(37,99,235,0.3)'; };
  b.onmouseleave = () => { b.style.transform = ''; b.style.boxShadow = '0 2px 8px rgba(37,99,235,0.2)'; };
  return b;
}
