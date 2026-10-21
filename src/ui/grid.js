import { $, el, clear } from './dom.js';

/* ─── 侧边栏与模块网格 ─── */

export const SEARCH_ENGINES = [
  { label: 'Bing', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { label: '百度', url: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { label: 'Google', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { label: 'DuckDuckGo', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { label: '搜狗', url: q => `https://www.sogou.com/web?query=${encodeURIComponent(q)}` },
];

/**
 * 渲染侧边栏
 */
export function renderSidebar(modules, activeId, cb = {}) {
  const nav = $('#moduleNav');
  if (!nav) return;
  clear(nav);

  const groups = new Map();
  modules.forEach(m => {
    const g = m.group || '默认';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(m);
  });

  groups.forEach((items, groupName) => {
    if (groups.size > 1) {
      nav.appendChild(el('div', { class: 'nav-group-title', text: groupName }));
    }
    items.forEach(m => {
      const disabled = !m.enabled;
      const item = el('div', {
        class: `nav-item${m.id === activeId ? ' active' : ''}${disabled ? ' disabled' : ''}`,
        title: disabled ? `${m.title}（已隐藏，点击恢复）` : m.title,
        tabindex: '0',
        role: 'button',
      });
      item.appendChild(el('span', { class: 'icon', text: m.icon || '📦' }));
      item.appendChild(el('span', { class: 'title', text: m.title }));
      if (disabled) {
        item.appendChild(el('button', {
          class: 'nav-show-btn', title: '恢复显示',
          onclick: (e) => { e.stopPropagation(); cb.onToggle?.(m.id); },
        }, '👁️'));
      }
      const activate = () => {
        if (disabled) cb.onToggle?.(m.id);
        else cb.onOpen?.(m.id);
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
      nav.appendChild(item);
    });
  });
}

/**
 * 渲染模块网格
 */
export function renderGrid(modules, cb = {}) {
  const grid = $('#gridView');
  if (!grid) return;
  clear(grid);

  const title = el('div', { class: 'grid-view-title' }, [
    el('span', {}, [
      el('span', { text: '🧩 模块工作室' }),
      el('span', { class: 'sort-hint', text: '（拖拽 ⠿ 排序）' }),
    ]),
    el('div', { class: 'grid-title-actions' }, [
      el('button', { class: 'ui-btn ui-btn-ghost', title: '预设模板', onclick: () => cb.onPreset?.() }, '📋 预设'),
      el('button', { class: 'ui-btn ui-btn-primary', title: '创建模块', onclick: () => cb.onCreate?.() }, '➕ 创建模块'),
    ]),
  ]);
  grid.appendChild(title);

  renderQuickSearchBar(grid, cb);

  const list = el('div', { class: 'module-grid' });
  grid.appendChild(list);

  const enabled = modules.filter(m => m.enabled);
  enabled.forEach((m, idx) => {
    const card = el('div', { class: 'module-card', dataset: { id: m.id } });
    card.appendChild(el('div', { class: 'module-card-header' }, [
      el('span', { class: 'drag-handle', title: '拖拽排序', text: '⠿' }),
      el('span', { class: 'icon', text: m.icon || '📦' }),
      el('span', { class: 'title', text: m.title }),
    ]));
    card.appendChild(el('div', { class: 'module-card-preview', text: (m.systemPrompt || '').slice(0, 90) + '…' }));

    const meta = el('div', { class: 'module-card-meta' });
    if (m.providerName || m.providerId) {
      meta.appendChild(el('span', { class: 'mcm-provider', text: m.providerName || m.providerId }));
    }
    if (m.model) meta.appendChild(el('span', { class: 'mcm-model', text: m.model }));
    if (m.knowledge) meta.appendChild(el('span', { class: 'mcm-kb', title: '该模块默认使用知识库', text: '📚 RAG' }));
    if (meta.childNodes.length) card.appendChild(meta);

    const actions = el('div', { class: 'module-card-actions' }, [
      el('button', { class: 'mca-btn', title: '上移', onclick: (e) => { e.stopPropagation(); cb.onMove?.(m.id, -1); } }, '⬆'),
      el('button', { class: 'mca-btn', title: '下移', onclick: (e) => { e.stopPropagation(); cb.onMove?.(m.id, 1); } }, '⬇'),
      el('button', { class: 'mca-btn', title: '编辑', onclick: (e) => { e.stopPropagation(); cb.onEdit?.(m.id); } }, '✏️'),
      el('button', { class: 'mca-btn', title: '隐藏', onclick: (e) => { e.stopPropagation(); cb.onToggle?.(m.id); } }, '🔇'),
      el('button', { class: 'mca-btn mca-danger', title: '删除', onclick: (e) => { e.stopPropagation(); cb.onDelete?.(m.id); } }, '🗑️'),
    ]);
    card.appendChild(actions);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.module-card-actions')) return;
      cb.onOpen?.(m.id);
    });
    list.appendChild(card);
  });

  if (!enabled.length) {
    list.appendChild(el('div', { class: 'grid-empty', text: '所有模块都被隐藏了，点击侧边栏 👁️ 可恢复。' }));
  }

  /* 拖拽排序（先销毁旧实例，避免监听器累积） */
  if (window.Sortable) {
    if (window.Sortable.get(list)) window.Sortable.get(list).destroy();
    window.Sortable.create(list, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      filter: '.module-card-actions',
      delay: 180,
      delayOnTouchOnly: true,
      onEnd: () => {
        const ids = [...list.querySelectorAll('.module-card')].map(c => c.dataset.id);
        cb.onReorder?.(ids);
      },
    });
  }
}

/**
 * 网格顶部的快速搜索栏（网址跳转 / 搜索引擎）
 */
export function renderQuickSearchBar(grid, cb = {}) {
  const bar = el('div', { class: 'quick-search' });
  const sel = el('select', { class: 'ui-select qs-engine', title: '搜索引擎' });
  SEARCH_ENGINES.forEach((eng, i) => {
    sel.appendChild(el('option', { value: i }, `🌐 ${eng.label}`));
  });

  const input = el('input', { class: 'ui-input qs-input', type: 'text', placeholder: '输入网址或搜索词，回车直达…' });
  const go = el('button', { class: 'ui-btn ui-btn-primary qs-go', title: '前往' }, '🚀');
  const bm = el('button', { class: 'ui-btn ui-btn-ghost qs-bookmark', title: '书签', onclick: () => cb.onBookmark?.() }, '📑');
  const kb = el('button', { class: 'ui-btn ui-btn-ghost qs-kb', title: '知识库', onclick: () => cb.onKnowledge?.() }, '📚');

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (/^https?:\/\//i.test(text) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/|$)/.test(text)) {
      const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      cb.onOpenUrl?.(url);
    } else {
      const eng = SEARCH_ENGINES[Number(sel.value)] || SEARCH_ENGINES[0];
      window.open(eng.url(text), '_blank', 'noopener');
    }
  };
  go.onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

  bar.appendChild(sel);
  bar.appendChild(input);
  bar.appendChild(go);
  bar.appendChild(bm);
  bar.appendChild(kb);
  grid.appendChild(bar);
  return bar;
}
