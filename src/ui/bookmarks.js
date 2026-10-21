import { el, clear, emptyState } from './dom.js';
import { openModal, confirmDialog, promptDialog } from './modal.js';
import { notify } from './toast.js';

/* ─── 书签管理 ─── */

export function openBookmarkPanel(bookmarks, callbacks = {}) {
  const body = el('div', { class: 'bookmark-panel' });
  const toolbar = el('div', { class: 'bookmark-toolbar' });
  const searchInput = el('input', { class: 'ui-input', placeholder: '🔍 搜索书签…' });
  const sortSel = el('select', { class: 'ui-select' }, [
    el('option', { value: 'newest' }, '📅 最新优先'),
    el('option', { value: 'oldest' }, '📅 最早优先'),
    el('option', { value: 'alpha' }, '🔤 标题 A-Z'),
    el('option', { value: 'folder' }, '📁 按文件夹'),
  ]);
  toolbar.appendChild(searchInput);
  toolbar.appendChild(sortSel);
  body.appendChild(toolbar);

  const list = el('div', { class: 'bookmark-list' });
  body.appendChild(list);

  const render = () => {
    clear(list);
    const q = searchInput.value.trim().toLowerCase();
    let items = bookmarks.filter(b => !q ||
      (b.title || '').toLowerCase().includes(q) ||
      (b.url || '').toLowerCase().includes(q) ||
      (b.folder || '').toLowerCase().includes(q));
    const sort = sortSel.value;
    items = [...items].sort((a, b) => {
      if (sort === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      if (sort === 'alpha') return (a.title || '').localeCompare(b.title || '');
      if (sort === 'folder') return (a.folder || '').localeCompare(b.folder || '');
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!items.length) {
      list.appendChild(emptyState('暂无书签', '点击「添加」或导入浏览器书签 HTML'));
      return;
    }

    const groups = new Map();
    items.forEach(b => {
      const f = b.folder || '';
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(b);
    });

    [...groups.entries()].sort((a, b) => (a[0] ? 1 : -1) - (b[0] ? 1 : -1)).forEach(([folder, list2]) => {
      if (folder) {
        const g = el('details', { class: 'bookmark-group', open: true });
        g.appendChild(el('summary', { class: 'bookmark-group-header', text: `📁 ${folder}（${list2.length}）` }));
        list2.forEach(b => g.appendChild(buildItem(b, render, callbacks)));
        list.appendChild(g);
      } else {
        list2.forEach(b => list.appendChild(buildItem(b, render, callbacks)));
      }
    });
  };

  const addBtn = el('button', { class: 'ui-btn', onclick: async () => {
    const url = await promptDialog('输入网址', { placeholder: 'https://example.com' });
    if (!url) return;
    const title = await promptDialog('输入标题', { defaultValue: url });
    await callbacks.onAdd?.({ url, title: title || url, tags: '', folder: '' });
    render();
  } }, '➕ 添加');

  const importBtn = el('button', { class: 'ui-btn', onclick: () => importHtml(render, callbacks) }, '📥 导入 HTML');

  const exportBtn = el('button', { class: 'ui-btn', onclick: () => {
    const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookmarks-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } }, '📤 导出 JSON');

  const footer = el('div', { class: 'modal-footer-row' }, [
    addBtn, importBtn, exportBtn,
    el('button', { class: 'ui-btn ui-btn-primary', onclick: () => m.close() }, '关闭'),
  ]);

  const m = openModal({ title: '📑 书签管理', body, footer, size: 'lg' });
  searchInput.oninput = render;
  sortSel.onchange = render;
  render();
  return m;
}

function buildItem(b, refresh, callbacks = {}) {
  const item = el('div', { class: 'bookmark-item' });
  const favicon = b.url?.startsWith('http')
    ? `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32`
    : '';
  item.appendChild(el('span', { class: 'favicon' }, favicon
    ? el('img', { src: favicon, width: 16, height: 16, alt: '', loading: 'lazy', onerror: (e) => { e.currentTarget.style.display = 'none'; } })
    : '📌'));
  item.appendChild(el('div', { class: 'info' }, [
    el('div', { class: 'title', text: b.title || b.url }),
    el('div', { class: 'url', text: b.url || '本地记录' }),
  ]));
  item.appendChild(el('button', {
    class: 'del-btn', title: '删除',
    onclick: async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog(`删除书签「${b.title || b.url}」？`, { danger: true, okText: '删除' });
      if (!ok) return;
      await callbacks.onDelete?.(b.id);
      refresh();
    },
  }, '✕'));

  if (b.url?.startsWith('http')) {
    item.classList.add('clickable');
    item.onclick = () => { window.open(b.url, '_blank', 'noopener'); };
  }
  return item;
}

function importHtml(refresh, callbacks = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.html,.htm';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const results = [];
      function walk(dl, path) {
        let child = dl.firstElementChild;
        while (child) {
          if (child.tagName === 'DT') {
            const h3 = child.querySelector(':scope > H3');
            const a = child.querySelector(':scope > A');
            if (h3) {
              const name = (h3.textContent || '').trim();
              const newPath = path ? `${path}/${name}` : name;
              let next = child.nextElementSibling;
              while (next && next.tagName !== 'DL') next = next.nextElementSibling;
              if (next) walk(next, newPath);
            } else if (a?.href?.startsWith('http')) {
              results.push({
                url: a.href,
                title: (a.textContent || '').trim() || a.href,
                tags: a.getAttribute('tags') || '',
                folder: path,
              });
            }
          }
          child = child.nextElementSibling;
        }
      }
      const roots = [...doc.querySelectorAll('DL')].filter(d => !d.parentElement?.closest('DL'));
      roots.forEach(dl => walk(dl, ''));
      if (!results.length) { notify.warning('未在文件中找到书签'); return; }
      for (const r of results) await callbacks.onAdd?.(r);
      refresh();
      notify.success(`已导入 ${results.length} 个书签`);
    } catch (err) {
      notify.error(`导入失败：${err.message}`);
    }
  };
  input.click();
}
