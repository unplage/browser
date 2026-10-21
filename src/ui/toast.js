import { $, el } from './dom.js';

/* ─── 轻提示 ─── */

export function toast(message, type = 'info', duration = 3200) {
  const container = $('#toastContainer');
  if (!container) {
    console.log(`[toast:${type}]`, message);
    return;
  }
  const node = el('div', { class: `toast toast-${type}` }, [
    el('span', { class: 'toast-icon', text: iconOf(type) }),
    el('span', { class: 'toast-msg', text: message }),
  ]);
  container.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast-in'));
  const remove = () => {
    node.classList.remove('toast-in');
    node.classList.add('toast-hiding');
    setTimeout(() => node.remove(), 300);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return node;
}

function iconOf(type) {
  return { success: '✅', error: '⛔', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
}

export const notify = {
  success: (m, d) => toast(m, 'success', d),
  error: (m, d) => toast(m, 'error', d ?? 5000),
  warning: (m, d) => toast(m, 'warning', d ?? 4200),
  info: (m, d) => toast(m, 'info', d),
};
