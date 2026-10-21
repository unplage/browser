/* ─── DOM 基础工具 ─── */

/** 按 id 取元素，兼容 '#id' 与 'id' 两种写法 */
export const $ = (sel) => {
  if (typeof sel !== 'string' || !sel) return null;
  const id = sel.charCodeAt(0) === 35 ? sel.slice(1) : sel;
  return document.getElementById(id);
};

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(node, evt, fn, opts) {
  if (!node) return () => {};
  node.addEventListener(evt, fn, opts);
  return () => node.removeEventListener(evt, fn, opts);
}

export function delegate(root, selector, evt, fn) {
  if (!root) return () => {};
  const handler = (e) => {
    const target = e.target.closest?.(selector);
    if (target && root.contains(target)) fn(e, target);
  };
  root.addEventListener(evt, handler);
  return () => root.removeEventListener(evt, handler);
}

/** 切换主视图（grid / chat / search） */
export function showView(viewId) {
  ['gridView', 'chatView', 'searchView'].forEach(id => {
    const node = $(id);
    if (node) node.style.display = id === viewId ? '' : 'none';
  });
}

export function setDisplay(node, visible) {
  if (!node) return;
  node.style.display = visible ? '' : 'none';
}

export function toggleClass(node, cls, force) {
  if (!node) return;
  node.classList.toggle(cls, force);
}

export function setText(node, text) {
  if (node) node.textContent = text ?? '';
}

export function setHtml(node, html) {
  if (node) node.innerHTML = html ?? '';
}

/** 滚动到底部（下一帧执行，避免布局抖动） */
export function scrollToBottom(node, smooth = false) {
  if (!node) return;
  requestAnimationFrame(() => {
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

export function btn(text, opts = {}) {
  return el('button', {
    class: opts.class || 'ui-btn',
    title: opts.title || '',
    'aria-label': opts.title || '',
    onclick: opts.onClick || null,
    disabled: !!opts.disabled,
    type: opts.type || 'button',
  }, text);
}

export function iconBtn(glyph, opts = {}) {
  return el('button', {
    class: `ui-icon-btn ${opts.class || ''}`,
    title: opts.title || '',
    'aria-label': opts.title || '',
    onclick: opts.onClick || null,
    disabled: !!opts.disabled,
    type: 'button',
  }, glyph);
}

export function field(label, control, hint) {
  return el('label', { class: 'ui-field' }, [
    el('span', { class: 'ui-field-label', text: label }),
    control,
    hint ? el('span', { class: 'ui-field-hint', text: hint }) : null,
  ]);
}

export function select(options, value, onChange, attrs = {}) {
  const s = el('select', { class: 'ui-select', ...attrs });
  options.forEach(o => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    s.appendChild(el('option', { value: opt.value, selected: opt.value === value }, opt.label));
  });
  s.value = value ?? '';
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function input(value, onChange, attrs = {}) {
  const i = el('input', { class: 'ui-input', value: value ?? '', ...attrs });
  if (onChange) {
    i.addEventListener('input', () => onChange(i.value));
    i.addEventListener('change', () => onChange(i.value));
  }
  return i;
}

export function textarea(value, onChange, attrs = {}) {
  const t = el('textarea', { class: 'ui-textarea', ...attrs }, value ?? '');
  if (onChange) t.addEventListener('input', () => onChange(t.value));
  return t;
}

export function checkbox(checked, onChange, attrs = {}) {
  const c = el('input', { type: 'checkbox', class: 'ui-checkbox', checked: !!checked, ...attrs });
  if (onChange) c.addEventListener('change', () => onChange(c.checked));
  return c;
}

export function emptyState(text, hint, action) {
  return el('div', { class: 'ui-empty' }, [
    el('div', { class: 'ui-empty-text', text }),
    hint ? el('div', { class: 'ui-empty-hint', text: hint }) : null,
    action || null,
  ]);
}

export function spinner(text = '') {
  return el('div', { class: 'ui-spinner-wrap' }, [
    el('span', { class: 'spinner' }),
    text ? el('span', { class: 'ui-spinner-text', text }) : null,
  ]);
}
