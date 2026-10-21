import { $, el, clear, scrollToBottom, iconBtn, showView } from './dom.js';
import { renderInto, createStreamRenderer } from './markdown-view.js';

/* ─── 对话面板 ─── */

let currentModule = null;
let callbacks = {};
let streamRenderer = null;
let abortBtnVisible = false;

const TOGGLE_DEFS = [
  { id: 'chatWebToggle', key: 'web', glyph: '🌐', label: '联网搜索', hint: '调用搜索工具获取实时信息' },
  { id: 'chatKnowledgeToggle', key: 'knowledge', glyph: '📚', label: '知识库', hint: '基于你上传的资料作答并标注引用' },
  { id: 'chatAgentToggle', key: 'agent', glyph: '🤖', label: 'Agent', hint: '允许模型自主调用工具链' },
];

export function getChatState() {
  const out = { web: false, knowledge: false, agent: false };
  TOGGLE_DEFS.forEach(t => {
    const node = $(t.id);
    out[t.key] = node?.classList.contains('active') || false;
  });
  return out;
}

export function setToggleEnabled(key, enabled, reason = '') {
  const def = TOGGLE_DEFS.find(t => t.key === key);
  if (!def) return;
  const node = $(def.id);
  if (!node) return;
  node.disabled = !enabled;
  node.classList.toggle('disabled', !enabled);
  node.title = enabled ? `${def.label} —— ${def.hint}` : `${def.label} —— ${reason || '当前配置不可用'}`;
}

/**
 * 渲染对话面板
 * @param {object} module { title, icon, systemPrompt }
 * @param {Array} messages [{role, content, reasoning, createdAt, sources}]
 * @param {object} cb 回调集合
 */
export function showChat(module, messages, cb = {}) {
  currentModule = module;
  callbacks = cb;
  const view = $('#chatView');
  if (!view) return;
  showView('chatView');

  $('#chatTitle').textContent = `${module.icon || '🤖'} ${module.title || ''}`;
  $('#chatSubtitle').textContent = module.subtitle || '';

  const container = $('#chatMessages');
  clear(container);

  if (!messages || !messages.length) {
    container.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'icon', text: module.icon || '🤖' }),
      el('div', { class: 'text', text: `开始与「${module.title}」对话` }),
      el('div', { class: 'hint', text: 'Enter 发送 · Shift+Enter 换行 · Ctrl+Enter 强制发送' }),
    ]));
  } else {
    messages.forEach(m => appendMessage(m.role, m.content, {
      reasoning: m.reasoning,
      createdAt: m.createdAt,
      sources: m.sources,
      meta: m.meta,
    }));
  }

  bindInput();
  bindToggles();
  updateActionButtons();
  scrollToBottom(container);
}

function updateActionButtons() {
  const has = (id) => !!$(id);
  if (has('chatNewBtn')) $('#chatNewBtn').style.display = callbacks.onNewChat ? '' : 'none';
  if (has('chatHistoryBtn')) $('#chatHistoryBtn').style.display = callbacks.onHistory ? '' : 'none';
  if (has('chatMenuBtn')) $('#chatMenuBtn').style.display = callbacks.onMenu ? '' : 'none';
  if (has('chatStopBtn')) $('#chatStopBtn').style.display = abortBtnVisible ? '' : 'none';
}

function bindToggles() {
  TOGGLE_DEFS.forEach(def => {
    const node = $(def.id);
    if (!node) return;
    node.onclick = () => {
      if (node.disabled) return;
      node.classList.toggle('active');
      callbacks.onToggle?.(def.key, node.classList.contains('active'));
    };
  });
}

function bindInput() {
  const input = $('#chatInput');
  const sendBtn = $('#chatSend');
  if (!input) return;

  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  };
  input.oninput = autoGrow;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn?.click();
    }
  };

  if (sendBtn) {
    sendBtn.onclick = () => {
      const text = input.value.trim();
      const img = pendingImageData;
      if (!text && !img) return;
      const state = getChatState();
      input.value = '';
      input.style.height = 'auto';
      clearPendingImage();
      callbacks.onSend?.(text, { ...state, imageData: img });
    };
  }

  const uploadBtn = $('#chatUploadBtn');
  const fileInput = $('#chatFileInput');
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => setPendingImage(reader.result, file.name);
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const text = `请分析文件「${file.name}」的内容：\n\n\`\`\`\n${String(reader.result).slice(0, 20000)}\n\`\`\``;
          callbacks.onSend?.(text, { ...getChatState() });
        };
        reader.readAsText(file);
      }
    };
  }

  const stopBtn = $('#chatStopBtn');
  if (stopBtn) stopBtn.onclick = () => callbacks.onStop?.();

  const newBtn = $('#chatNewBtn');
  if (newBtn) newBtn.onclick = () => callbacks.onNewChat?.();
  const histBtn = $('#chatHistoryBtn');
  if (histBtn) histBtn.onclick = () => callbacks.onHistory?.();
  const clearBtn = $('#clearChatBtn');
  if (clearBtn) clearBtn.onclick = () => callbacks.onClearChat?.();
  const menuBtn = $('#chatMenuBtn');
  if (menuBtn) menuBtn.onclick = () => callbacks.onMenu?.();
  const backBtn = $('#backToGrid');
  if (backBtn) backBtn.onclick = () => callbacks.onBack?.();
}

/* ─── 图片预览 ─── */
let pendingImageData = null;

function previewHost() {
  let host = $('#chatImagePreview');
  if (!host) {
    host = el('div', { id: 'chatImagePreview', class: 'chat-image-preview' });
    $('#chatInputArea')?.insertBefore(host, $('#chatInput'));
  }
  return host;
}

export function setPendingImage(dataUrl, name = '') {
  pendingImageData = dataUrl;
  const host = previewHost();
  clear(host);
  host.style.display = 'block';
  host.appendChild(el('div', { class: 'image-preview' }, [
    el('img', { src: dataUrl, alt: name || '预览' }),
    el('button', { class: 'remove-image-btn', title: '移除', onclick: () => clearPendingImage() }, '✕'),
  ]));
}

export function clearPendingImage() {
  pendingImageData = null;
  const host = $('#chatImagePreview');
  if (host) { clear(host); host.style.display = 'none'; }
}

export function getPendingImage() {
  return pendingImageData;
}

/* ─── 消息渲染 ─── */
export function appendMessage(role, content, opts = {}) {
  const container = $('#chatMessages');
  if (!container) return null;
  container.querySelector('.empty-state')?.remove();

  const msg = el('div', { class: `msg ${role}` });
  const bodyWrap = el('div', { class: 'msg-body' });

  const bubble = el('div', { class: 'msg-bubble markdown' });
  if (role === 'assistant') {
    renderInto(bubble, content || '', { onCitation: (id) => callbacks.onCitation?.(id) });
  } else {
    bubble.textContent = content || '';
  }
  bodyWrap.appendChild(bubble);

  if (opts.reasoning) {
    bodyWrap.appendChild(buildReasoningBlock(opts.reasoning));
  }

  const sourcesHost = el('div', { class: 'msg-sources' });
  bodyWrap.appendChild(sourcesHost);
  if (opts.sources?.length) renderSources(sourcesHost, opts.sources);

  const traceHost = el('div', { class: 'msg-trace' });
  bodyWrap.appendChild(traceHost);

  bodyWrap.appendChild(buildActions(role, content, opts, bubble));

  msg.appendChild(el('div', { class: 'msg-avatar', text: role === 'user' ? '👤' : (currentModule?.icon || '🤖') }));
  msg.appendChild(bodyWrap);
  msg.appendChild(el('div', { class: 'msg-time', text: formatTime(opts.createdAt) }));

  container.appendChild(msg);
  scrollToBottom(container);
  return { msg, bubble, sourcesHost, traceHost, bodyWrap };
}

function buildReasoningBlock(text) {
  const details = el('details', { class: 'msg-reasoning' });
  details.appendChild(el('summary', { class: 'msg-reasoning-summary' }, [
    el('span', { class: 'mr-icon', text: '🧠' }),
    el('span', { text: '思考过程' }),
    el('span', { class: 'mr-count', text: `${text.length} 字` }),
  ]));
  const content = el('div', { class: 'msg-reasoning-content markdown' });
  renderInto(content, text);
  details.appendChild(content);
  return details;
}

function buildActions(role, content, opts, bubble) {
  const actions = el('div', { class: 'msg-actions' });
  /* 复制时读取气泡当前文本，保证流式结束后复制到的是最终内容 */
  const copyText = () => (bubble?.innerText || content || '').trim();
  const copyBtn = iconBtn('📋', {
    class: 'msg-copy-btn',
    title: '复制',
    onClick: (e) => {
      const text = copyText();
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        e.currentTarget.textContent = '✅';
        setTimeout(() => { e.currentTarget.textContent = '📋'; }, 1600);
      }).catch(() => {
        e.currentTarget.textContent = '⚠️';
        setTimeout(() => { e.currentTarget.textContent = '📋'; }, 1600);
      });
    },
  });
  if (role === 'assistant') {
    actions.appendChild(copyBtn);
    if (callbacks.onRegenerate) {
      actions.appendChild(iconBtn('🔄', { title: '重新生成', onClick: () => callbacks.onRegenerate?.(opts) }));
    }
  } else {
    actions.appendChild(copyBtn);
    if (callbacks.onEditMessage) {
      actions.appendChild(iconBtn('✏️', { title: '编辑并重新发送', onClick: () => callbacks.onEditMessage?.(opts) }));
    }
    if (callbacks.onDeleteMessage) {
      actions.appendChild(iconBtn('🗑️', { title: '删除这条消息', onClick: () => callbacks.onDeleteMessage?.(opts) }));
    }
  }
  return actions;
}

export function renderSources(host, sources) {
  if (!host) return;
  clear(host);
  if (!sources?.length) { host.style.display = 'none'; return; }
  host.style.display = '';
  host.appendChild(el('div', { class: 'msg-sources-title', text: `引用来源 (${sources.length})` }));
  const list = el('div', { class: 'msg-sources-list' });
  sources.forEach(s => {
    const item = el('div', { class: 'msg-source', id: `src-${s.id}` }, [
      el('span', { class: 'ms-id', text: s.id }),
      el('span', { class: 'ms-title', text: s.title || s.url || '来源' }),
      s.url ? el('a', { class: 'ms-url', href: s.url, target: '_blank', rel: 'noopener noreferrer', text: shortUrl(s.url) }) : null,
    ]);
    if (s.heading) item.appendChild(el('span', { class: 'ms-heading', text: s.heading }));
    list.appendChild(item);
  });
  host.appendChild(list);
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname.slice(0, 24) : '');
  } catch { return url.slice(0, 40); }
}

/* ─── 流式输出 ─── */
export function beginAssistant() {
  const handle = appendMessage('assistant', '', {});
  const renderer = createStreamRenderer(handle.bubble, {
    onCitation: (id) => callbacks.onCitation?.(id),
  });
  handle.renderer = renderer;
  handle.bubble.classList.add('is-streaming');
  handle.bubble.appendChild(el('span', { class: 'thinking-dots' }, '···'));
  setStreaming(true);
  return handle;
}

export function updateAssistant(handle, { text, reasoning }) {
  if (!handle) return;
  if (reasoning !== undefined) {
    let block = handle.bodyWrap.querySelector('.msg-reasoning');
    if (!block && reasoning) {
      block = buildReasoningBlock(reasoning);
      handle.bodyWrap.insertBefore(block, handle.bubble);
    } else if (block) {
      const content = block.querySelector('.msg-reasoning-content');
      renderInto(content, reasoning);
      const count = block.querySelector('.mr-count');
      if (count) count.textContent = `${reasoning.length} 字`;
    }
  }
  if (text !== undefined) {
    handle.bubble.classList.remove('is-streaming');
    handle.bubble.querySelector('.thinking-dots')?.remove();
    handle.renderer.set(text);
  }
}

export function endAssistant(handle) {
  if (!handle) return;
  handle.bubble.classList.remove('is-streaming');
  handle.bubble.querySelector('.thinking-dots')?.remove();
  handle.renderer?.flush();
  setStreaming(false);
}

export function setStreaming(active) {
  abortBtnVisible = active;
  const btn = $('#chatStopBtn');
  if (btn) btn.style.display = active ? '' : 'none';
  const send = $('#chatSend');
  if (send) {
    send.disabled = active;
    send.textContent = active ? '生成中…' : '发送';
  }
  $('#chatMessages')?.classList.toggle('is-streaming', active);
}

export function addTraceEvent(handle, event) {
  if (!handle?.traceHost) return;
  const box = el('div', { class: `trace-item trace-${event.type}` });
  if (event.type === 'tool_start') {
    box.appendChild(el('span', { class: 'trace-icon', text: '🔧' }));
    box.appendChild(el('span', { class: 'trace-name', text: event.call?.name || 'tool' }));
    box.appendChild(el('span', { class: 'trace-args', text: JSON.stringify(event.call?.args || {}).slice(0, 120) }));
    box.appendChild(el('span', { class: 'trace-state', text: '执行中…' }));
  } else if (event.type === 'tool_end') {
    box.appendChild(el('span', { class: 'trace-icon', text: event.result?.ok ? '✅' : '⚠️' }));
    box.appendChild(el('span', { class: 'trace-name', text: event.call?.name || 'tool' }));
    box.appendChild(el('span', { class: 'trace-out', text: (event.result?.output || '').slice(0, 200) }));
    box.appendChild(el('span', { class: 'trace-state', text: `${event.result?.duration ?? 0}ms` }));
  } else if (event.type === 'note') {
    box.appendChild(el('span', { class: 'trace-icon', text: 'ℹ️' }));
    box.appendChild(el('span', { class: 'trace-note', text: event.text }));
  } else if (event.type === 'step_start') {
    box.appendChild(el('span', { class: 'trace-icon', text: '▶️' }));
    box.appendChild(el('span', { class: 'trace-note', text: `第 ${(event.index ?? 0) + 1} 步` }));
  }
  handle.traceHost.appendChild(box);
  scrollToBottom($('#chatMessages'));
}

export function clearMessages() {
  const container = $('#chatMessages');
  if (!container) return;
  clear(container);
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('div', { class: 'icon', text: currentModule?.icon || '🤖' }),
    el('div', { class: 'text', text: '对话已清空' }),
  ]));
}

export function setContextInfo(text) {
  const node = $('#chatContextInfo');
  if (node) node.textContent = text || '';
}

export function focusInput() {
  $('#chatInput')?.focus();
}

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
