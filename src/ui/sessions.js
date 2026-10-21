import { el, clear, emptyState } from './dom.js';
import { openModal, confirmDialog, promptDialog } from './modal.js';
import { notify } from './toast.js';
import { formatTime } from '../core/utils.js';

/* ─── 会话（线程）列表 ─── */

export function openSessionsPanel(sessions, currentId, callbacks = {}) {
  const body = el('div', { class: 'sessions-panel' });
  const searchInput = el('input', { class: 'ui-input', placeholder: '🔍 搜索会话…' });
  const list = el('div', { class: 'sessions-list' });

  const render = (filter = '') => {
    clear(list);
    const filtered = sessions.filter(s => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (s.title || '').toLowerCase().includes(q) || (s.preview || '').toLowerCase().includes(q);
    });
    if (!filtered.length) {
      list.appendChild(emptyState(filter ? '无匹配会话' : '还没有会话', filter ? '' : '发送第一条消息即可自动创建'));
      return;
    }
    filtered.forEach(s => {
      const item = el('div', { class: `session-item${s.id === currentId ? ' active' : ''}` });
      item.appendChild(el('div', { class: 'session-main' }, [
        el('div', { class: 'session-title', text: s.title || '未命名会话' }),
        el('div', { class: 'session-meta', text: `${s.messageCount || 0} 条消息 · ${formatTime(s.updatedAt)}` }),
        s.preview ? el('div', { class: 'session-preview', text: s.preview }) : null,
      ]));
      const actions = el('div', { class: 'session-actions' }, [
        el('button', {
          class: 'ui-btn ui-btn-xs', title: '重命名',
          onclick: async (e) => {
            e.stopPropagation();
            const t = await promptDialog('重命名会话', { defaultValue: s.title || '' });
            if (!t) return;
            await callbacks.onRename?.(s.id, t);
            s.title = t;
            render(searchInput.value);
          },
        }, '✏️'),
        el('button', {
          class: 'ui-btn ui-btn-xs ui-btn-danger', title: '删除',
          onclick: async (e) => {
            e.stopPropagation();
            if (s.id === currentId) { notify.warning('不能删除当前会话'); return; }
            const ok = await confirmDialog(`删除会话「${s.title || '未命名'}」？此操作不可恢复。`, { danger: true, okText: '删除' });
            if (!ok) return;
            await callbacks.onDelete?.(s.id);
            const idx = sessions.findIndex(x => x.id === s.id);
            if (idx >= 0) sessions.splice(idx, 1);
            render(searchInput.value);
          },
        }, '🗑️'),
      ]);
      item.appendChild(actions);
      item.addEventListener('click', () => {
        if (s.id === currentId) return;
        callbacks.onSelect?.(s.id);
        m.close();
      });
      list.appendChild(item);
    });
  };

  searchInput.oninput = () => render(searchInput.value);
  body.appendChild(searchInput);
  body.appendChild(list);

  const footer = el('div', { class: 'modal-footer-row' }, [
    el('button', {
      class: 'ui-btn', onclick: () => {
        const json = JSON.stringify(sessions.map(s => ({ title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sessions-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
    }, '📤 导出会话索引'),
    el('button', { class: 'ui-btn ui-btn-primary', onclick: () => m.close() }, '关闭'),
  ]);

  const m = openModal({ title: '💬 会话列表', body, footer, size: 'md' });
  render();
  return m;
}
