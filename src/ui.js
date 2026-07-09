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
  html = html.split(/\n\n+/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<h[1-4]/.test(t) || /^<hr/.test(t)) return t;
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
    return;
  }
  grid.innerHTML = `<div class="grid-view-title">
    <span>🧩 模块工作室 <span class="sort-hint">（拖拽卡片排序）</span></span>
    <button class="btn-create" id="gridCreateBtn">➕ 创建模块</button>
  </div>`;
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
    card.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`确认删除模块「${m.title}」？此操作不可恢复。`)) {
        callbacks.onDelete(m.id);
      }
    });
    grid.appendChild(card);
  });

  $('gridCreateBtn').onclick = () => callbacks.onCreate();

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

export function showChat(module, messages, callbacks = {}) {
  currentChatModule = module;
  showView('chatView');
  $('chatTitle').textContent = `${module.icon} ${escapeHtml(module.title)}`;
  const container = $('chatMessages');
  container.innerHTML = '';

  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">${module.icon}</div><div class="text">开始与「${escapeHtml(module.title)}」对话</div></div>`;
  } else {
    messages.forEach(msg => appendMessage(msg.role, msg.content));
  }

  const sendBtn = $('chatSend');
  const input = $('chatInput');
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
    <input type="password" id="apiKeyInput" value="${escapeHtml(apiKey || '')}" placeholder="输入你的 GLM API Key">
    <div class="hint">API Key 仅保存在本地浏览器 IndexedDB 中，每次请求直接发送至 open.bigmodel.cn</div>`;
  const footer = document.createElement('div');
  const saveBtn = mkPrimaryBtn('保存');
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
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
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
    const favicon = (b.url && b.url.startsWith('http')) ? `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32` : '';
    item.innerHTML = `
      <span class="favicon">${favicon ? `<img src="${favicon}" width="16" height="16" onerror="this.style.display='none'" style="border-radius:2px">` : '📌'}</span>
      <div class="info">
        <div class="title">${escapeHtml(b.title)}</div>
        <div class="url">${escapeHtml(b.url || '本地记录')}</div>
      </div>
      <button class="del-btn" data-id="${b.id}">✕</button>`;
    item.querySelector('.del-btn').onclick = async e => {
      e.stopPropagation();
      if (!confirm('确认删除此书签？')) return;
      const updated = await callbacks.onDelete(b.id);
      renderBookmarks(container, updated, callbacks);
    };
    if (b.url && b.url.startsWith('http')) {
      item.style.cursor = 'pointer';
      item.onclick = e => {
        if (e.target.closest('.del-btn')) return;
        if (callbacks.onOpenUrl) {
          callbacks.onOpenUrl(b.url);
        } else {
          window.open(b.url, '_blank');
        }
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
    try { text = await file.text(); } catch { alert('无法读取文件'); return; }
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
      $('searchResultContent').innerHTML = `<div style="color:var(--danger);padding:20px">分析失败: ${escapeHtml(err.message)}</div>`;
      $('searchBtn').classList.remove('loading');
      $('searchBtn').textContent = '搜索';
    }
  }
}

/* ─── Module Editor ─── */
export function showModuleEditor(module, onSave) {
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
  const saveBtn = mkPrimaryBtn('保存');
  footer.appendChild(saveBtn);
  const modal = showModal(`✏️ 编辑模块: ${escapeHtml(module.title)}`, form, footer);

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
    if (!title) { alert('请输入模块名称'); $('newModTitle').focus(); return; }
    if (!prompt) { alert('请输入系统提示词'); $('newModPrompt').focus(); return; }
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
