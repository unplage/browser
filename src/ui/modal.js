import { $, el, clear } from './dom.js';

/* ─── 模态栈 ───
 * 支持嵌套：打开新模态不会销毁下层（修复旧版 showModal 互相覆盖的问题）。
 */

const stack = [];

function overlay() {
  let ov = $('#modalOverlay');
  if (!ov) {
    ov = el('div', { id: 'modalOverlay', class: 'modal-overlay' });
    ov.appendChild(el('div', { id: 'modalStack', class: 'modal-stack' }));
    document.body.appendChild(ov);
  }
  return ov;
}

function stackNode() {
  return $('#modalStack');
}

function trapFocus(layer, e) {
  if (e.key !== 'Tab') return;
  const focusables = layer.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * 打开一个模态框
 * @param {object} opts
 *   title, body (Node), footer (Node), size ('sm'|'md'|'lg'|'xl'), onClose
 * @returns {{close: Function, layer: HTMLElement, body: HTMLElement, footer: HTMLElement, setTitle: Function}}
 */
export function openModal(opts = {}) {
  const ov = overlay();
  const layer = el('div', { class: `modal-layer modal-${opts.size || 'md'}` });

  const header = el('div', { class: 'modal-header' }, [
    el('h3', { class: 'modal-title', text: opts.title || '' }),
    el('button', { class: 'modal-close', 'aria-label': '关闭', onclick: () => close() }, '✕'),
  ]);
  const body = el('div', { class: 'modal-body' });
  const footer = el('div', { class: 'modal-footer' });

  layer.appendChild(header);
  layer.appendChild(body);
  if (opts.footer) {
    layer.appendChild(footer);
    footer.appendChild(opts.footer);
  } else {
    footer.remove();
  }

  if (opts.body) body.appendChild(opts.body);

  const prevFocus = document.activeElement;
  const entry = { layer, body, footer, prevFocus, onClose: opts.onClose, closed: false };

  const close = () => {
    if (entry.closed) return;
    entry.closed = true;
    const idx = stack.indexOf(entry);
    if (idx >= 0) stack.splice(idx, 1);
    layer.remove();
    if (!stack.length) ov.style.display = 'none';
    else {
      const top = stack[stack.length - 1];
      top.layer.focus?.();
    }
    entry.prevFocus?.focus?.();
    opts.onClose?.();
  };

  entry.close = close;
  stack.push(entry);
  stackNode().appendChild(layer);
  ov.style.display = 'flex';

  layer.addEventListener('keydown', (e) => trapFocus(layer, e));

  requestAnimationFrame(() => {
    const target = layer.querySelector('[autofocus]') || layer.querySelector('input, textarea, select, button');
    target?.focus();
  });

  return {
    close,
    layer,
    body,
    footer,
    setTitle: (t) => { header.querySelector('.modal-title').textContent = t; },
    setBody: (node) => { clear(body); body.appendChild(node); },
  };
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top) top.close();
  return !!top;
}

export function closeAllModals() {
  while (stack.length) stack[stack.length - 1].close();
}

export function modalDepth() {
  return stack.length;
}

/** 确认框 */
export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'confirm-body' }, [
      el('p', { class: 'confirm-text', text: message }),
      opts.detail ? el('p', { class: 'confirm-detail', text: opts.detail }) : null,
    ]);
    const footer = el('div', { class: 'modal-footer-row' });
    const cancelBtn = el('button', { class: 'ui-btn', onclick: () => { m.close(); resolve(false); } }, opts.cancelText || '取消');
    const okBtn = el('button', { class: `ui-btn ${opts.danger ? 'ui-btn-danger' : 'ui-btn-primary'}`, onclick: () => { m.close(); resolve(true); } }, opts.okText || '确认');
    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    const m = openModal({ title: opts.title || '请确认', body, footer, size: 'sm' });
    okBtn.focus();
  });
}

/** 输入框弹窗 */
export function promptDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const inputEl = el('input', {
      class: 'ui-input', value: opts.defaultValue || '', placeholder: opts.placeholder || '', autofocus: 'autofocus',
    });
    const body = el('div', { class: 'confirm-body' }, [
      el('p', { class: 'confirm-text', text: message }),
      inputEl,
    ]);
    const footer = el('div', { class: 'modal-footer-row' });
    const cancelBtn = el('button', { class: 'ui-btn', onclick: () => { m.close(); resolve(null); } }, '取消');
    const okBtn = el('button', { class: 'ui-btn ui-btn-primary', onclick: () => { const v = inputEl.value.trim(); m.close(); resolve(v || null); } }, opts.okText || '确定');
    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    const m = openModal({ title: opts.title || '输入', body, footer, size: 'sm' });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = inputEl.value.trim(); m.close(); resolve(v || null); }
    });
  });
}
