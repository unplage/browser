export function $(id) { return document.getElementById(id); }

export function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^-{3,}$/gm, '<hr>');
  html = html.split(/\n\n+/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<h[1-4]/.test(t) || /^<hr/.test(t) || /^<ul/.test(t)) return t;
    if (/^<li>/.test(t)) return `<ul>${t}</ul>`;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

export function showView(viewId) {
  ['gridView', 'chatView', 'searchView'].forEach(id => {
    $(id).style.display = id === viewId ? '' : 'none';
  });
}

/* ─── Sidebar ─── */
export function renderSidebar(modules, activeId, onModuleClick) {
  const nav = $('moduleNav');
  nav.innerHTML = '';
  modules.forEach(m => {
    const item = document.createElement('div');
    item.className = `nav-item${m.id === activeId ? ' active' : ''}`;
    item.innerHTML = `<span class="icon">${m.icon}</span><span class="title">${m.title}</span>`;
    item.addEventListener('click', () => onModuleClick(m.id));
    nav.appendChild(item);
  });
}

/* ─── Grid ─── */
let gridCallbacks = {};

export function renderGrid(modules, callbacks) {
  gridCallbacks = callbacks;
  const grid = $('gridView');
  grid.innerHTML = '<div class="grid-view-title">🧩 模块工作室 — 点击打开，拖拽排序</div>';
  modules.filter(m => m.enabled).forEach(m => {
    const card = document.createElement('div');
    card.className = 'module-card';
    card.dataset.id = m.id;
    card.innerHTML = `
      <div class="module-card-header">
        <span class="icon">${m.icon}</span>
        <span class="title">${m.title}</span>
      </div>
      <div class="module-card-preview">${m.systemPrompt.slice(0, 80)}…</div>
      <div class="module-card-actions">
        <button class="edit-btn" data-action="edit">✏️ 编辑</button>
        <button data-action="disable">${m.enabled ? '🔇' : '🔊'}</button>
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
    grid.appendChild(card);
  });

  if (window.Sortable) {
    Sortable.create(grid, {
      animation: 200,
      handle: '.module-card',
      ghostClass: 'sortable-ghost',
      filter: '.grid-view-title',
      onEnd: e => {
        const ids = [...grid.querySelectorAll('.module-card')].map(c => c.dataset.id);
        callbacks.onReorder(ids);
      }
    });
  }
}

export function updateModuleCount(count) {
  $('moduleCount').textContent = `模块: ${count}/12`;
}

/* ─── Chat ─── */
let currentChatModule = null;

export function showChat(module, messages, callbacks = {}) {
  currentChatModule = module;
  showView('chatView');
  $('chatTitle').textContent = `${module.icon} ${module.title}`;
  const container = $('chatMessages');
  container.innerHTML = '';

  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">${module.icon}</div><div class="text">开始与「${module.title}」对话</div></div>`;
  } else {
    messages.forEach(msg => appendMessage(msg.role, msg.content));
  }

  const sendBtn = $('chatSend');
  const input = $('chatInput');
  sendBtn.onclick = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    if (callbacks.onSend) callbacks.onSend(text);
  };
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.focus();

  $('backToGrid').onclick = () => {
    if (callbacks.onBack) callbacks.onBack();
    else showView('gridView');
  };
  $('chatMenuBtn').onclick = () => {
    if (callbacks.onMenu) callbacks.onMenu();
  };
}

export function appendMessage(role, content, streaming = false) {
  const container = $('chatMessages');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `msg ${role}${streaming ? ' streaming' : ''}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const avatar = role === 'user' ? '👤' : currentChatModule?.icon || '🤖';
  msg.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${role === 'assistant' ? renderMarkdown(content) : escapeHtml(content)}</div>
    <div class="msg-time">${time}</div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

export function updateStreamingMessage(msgEl, fullContent) {
  const bubble = msgEl.querySelector('.msg-bubble');
  if (bubble) bubble.innerHTML = renderMarkdown(fullContent);
}

export function stopStreaming(msgEl) {
  msgEl.classList.remove('streaming');
}

/* ─── Search Results ─── */
export function showSearchLoading() {
  showView('searchView');
  $('searchViewTitle').textContent = '搜索分析中…';
  $('searchResultContent').innerHTML = '<div class="search-loading"><span class="spinner"></span>正在联网搜索并分析…</div>';
  $('saveSearchBtn').style.display = 'none';
  $('searchBackBtn').onclick = () => showView('gridView');
}

export function showSearchResult(query, content) {
  $('searchViewTitle').textContent = `🔍 ${query}`;
  $('searchResultContent').innerHTML = renderMarkdown(content);
  const saveBtn = $('saveSearchBtn');
  saveBtn.style.display = '';
  saveBtn._query = query;
  saveBtn._content = content;
}

export function getSavedSearchData() {
  const btn = $('saveSearchBtn');
  return { query: btn._query, content: btn._content, result: $('searchResultContent').innerText };
}

/* ─── Modals ─── */
export function showModal(title, bodyEl, footerEl) {
  const overlay = $('modalOverlay');
  const content = $('modalContent');
  content.innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <div class="modal-body"></div>
    ${footerEl ? '<div class="modal-footer"></div>' : ''}`;
  content.querySelector('.modal-body').appendChild(bodyEl);
  if (footerEl) content.querySelector('.modal-footer').appendChild(footerEl);
  const close = () => { overlay.style.display = 'none'; };
  $('modalCloseBtn').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.style.display = 'flex';
  return { close, body: content.querySelector('.modal-body'), footer: content.querySelector('.modal-footer') };
}

/* ─── Settings ─── */
export function showSettingsPanel(apiKey, onSave) {
  const form = document.createElement('div');
  form.className = 'settings-form';
  form.innerHTML = `
    <label>智谱 API Key
      <small style="color:var(--text-tertiary);font-weight:400"> — 从 <a href="https://open.bigmodel.cn" target="_blank" style="color:var(--accent)">bigmodel.cn</a> 获取</small>
    </label>
    <input type="password" id="apiKeyInput" value="${apiKey || ''}" placeholder="输入你的 GLM API Key">
    <div class="hint">API Key 仅保存在本地浏览器 IndexedDB 中，每次请求直接发送至 open.bigmodel.cn</div>`;
  const footer = document.createElement('div');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'padding:8px 20px;background:var(--accent);color:#fff;border-radius:16px;font-size:13px;';
  footer.appendChild(saveBtn);
  const modal = showModal('⚙️ 设置', form, footer);
  saveBtn.onclick = async () => {
    const val = $('apiKeyInput').value.trim();
    await onSave(val);
    modal.close();
  };
}

/* ─── Bookmarks ─── */
export function showBookmarkPanel(bookmarks, callbacks) {
  const container = document.createElement('div');
  renderBookmarks(container, bookmarks, callbacks);
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;';
  const addBtn = mkBtn('➕ 添加');
  const importBtn = mkBtn('📥 导入 HTML');
  const exportBtn = mkBtn('📤 导出 JSON');
  const saveResultBtn = mkBtn('💾 保存当前搜索结果');
  [addBtn, importBtn, exportBtn, saveResultBtn].forEach(b => footer.appendChild(b));

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
    input.accept = '.html';
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
      const updated = await callbacks.onRefresh ? await callbacks.onRefresh() : bookmarks;
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

function renderBookmarks(container, bookmarks, callbacks) {
  container.innerHTML = '';
  if (bookmarks.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无书签</div></div>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'bookmark-list';
  bookmarks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    const favicon = b.url ? `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32` : '';
    item.innerHTML = `
      <span class="favicon">${favicon ? `<img src="${favicon}" width="16" height="16" onerror="this.style.display='none'">` : '📌'}</span>
      <div class="info">
        <div>${escapeHtml(b.title)}</div>
        <div class="url">${escapeHtml(b.url || '本地记录')}</div>
      </div>
      <button class="del-btn" data-id="${b.id}">✕</button>`;
    item.querySelector('.del-btn').onclick = async () => {
      const updated = await callbacks.onDelete(b.id);
      renderBookmarks(container, updated, callbacks);
    };
    if (b.url) {
      item.style.cursor = 'pointer';
      item.onclick = e => {
        if (e.target.closest('.del-btn')) return;
        window.open(b.url, '_blank');
      };
    }
    list.appendChild(item);
  });
  container.appendChild(list);
}

/* ─── File Upload ─── */
export function showFileUploader(savedFiles, onUpload, onDelete) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="upload-zone" id="uploadZone">
      <span class="icon">📄</span>
      <span class="text">点击或拖拽文件到这里上传分析</span>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">支持 .txt .md .json .csv .js .py .html</div>
    </div>
    <div class="file-list" id="fileList"></div>`;
  const modal = showModal('📎 文件分析', container);
  const zone = $('uploadZone');
  const fileList = $('fileList');

  function renderFiles() {
    fileList.innerHTML = '';
    savedFiles.forEach(f => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span>📄</span>
        <span class="name">${escapeHtml(f.fileName)}</span>
        <span style="font-size:11px;color:var(--text-tertiary)">${new Date(f.createdAt).toLocaleDateString()}</span>
        <button class="del-btn" data-id="${f.id}">✕</button>`;
      item.querySelector('.del-btn').onclick = () => onDelete(f.id);
      item.onclick = e => {
        if (e.target.closest('.del-btn')) return;
        showModal('📄 ' + f.fileName, (() => {
          const d = document.createElement('div');
          d.innerHTML = renderMarkdown(f.analysis || f.content);
          return d;
        })());
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
    const text = await file.text();
    showSearchLoading();
    $('searchViewTitle').textContent = `分析中: ${file.name}`;
    try {
      const { analyzeFile } = await import('./api.js');
      const analysis = await analyzeFile(text, file.name);
      await onUpload({ fileName: file.name, fileType: file.name.split('.').pop(), content: text.slice(0, 5000), analysis });
      showSearchResult(file.name, analysis);
      $('saveSearchBtn').style.display = 'none';
      renderFiles();
    } catch (err) {
      $('searchResultContent').innerHTML = `<div style="color:var(--danger)">分析失败: ${escapeHtml(err.message)}</div>`;
    }
  }
}

/* ─── Module Editor ─── */
export function showModuleEditor(module, onSave) {
  const form = document.createElement('div');
  form.className = 'module-editor';
  form.innerHTML = `
    <label>模块名称</label>
    <input type="text" id="modTitle" value="${escapeHtml(module.title)}">
    <label>图标 (Emoji)</label>
    <input type="text" id="modIcon" value="${module.icon}" style="width:60px">
    <label>系统提示词 (System Prompt)</label>
    <textarea id="modPrompt">${escapeHtml(module.systemPrompt)}</textarea>
    <button class="reset-btn">↺ 恢复默认提示词</button>`;
  const footer = document.createElement('div');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'padding:8px 20px;background:var(--accent);color:#fff;border-radius:16px;font-size:13px;';
  footer.appendChild(saveBtn);
  const modal = showModal(`✏️ 编辑模块: ${module.title}`, form, footer);

  form.querySelector('.reset-btn').onclick = async () => {
    const { getDefaultPrompt } = await import('./modules.js');
    $('modPrompt').value = getDefaultPrompt(module.id);
  };
  saveBtn.onclick = async () => {
    await onSave(module.id, {
      title: $('modTitle').value,
      icon: $('modIcon').value,
      systemPrompt: $('modPrompt').value,
    });
    modal.close();
  };
}

/* ─── Saved Search Results ─── */
export function showSavedResults(results, onDelete) {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;';
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="text">暂无保存的搜索结果</div></div>';
  } else {
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'saved-result-item';
      item.innerHTML = `
        <button class="del-btn" data-id="${r.id}">✕</button>
        <div class="query">🔍 ${escapeHtml(r.query)}</div>
        <div class="meta">${new Date(r.savedAt).toLocaleString('zh-CN')}</div>`;
      item.querySelector('.del-btn').onclick = async e => {
        e.stopPropagation();
        await onDelete(r.id);
        item.remove();
      };
      item.onclick = () => {
        showSearchResult(r.query, r.result || r.content);
        $('saveSearchBtn').style.display = 'none';
      };
      container.appendChild(item);
    });
  }
  showModal('💾 已保存的搜索结果', container);
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
  b.style.cssText = 'padding:6px 14px;border-radius:16px;font-size:12px;border:1px solid var(--border);transition:var(--transition);';
  return b;
}
