import { $, el, clear, scrollToBottom, showView } from './dom.js';
import { createStreamRenderer } from './markdown-view.js';
import { renderSources } from './chat.js';

/* ─── 联网搜索视图 ─── */

let renderer = null;

export function showSearchLoading(query) {
  const view = $('#searchView');
  if (!view) return;
  showView('searchView');
  $('#searchViewTitle').textContent = query ? `🔍 ${query}` : '搜索分析中…';
  const content = $('#searchResultContent');
  clear(content);
  content.appendChild(el('div', { class: 'search-loading' }, [
    el('span', { class: 'spinner' }),
    el('span', { text: '正在联网检索并分析…' }),
  ]));
  $('#saveSearchBtn').style.display = 'none';
}

export function beginSearchResult(query) {
  const content = $('#searchResultContent');
  if (!content) return null;
  clear(content);
  const bubble = el('div', { class: 'search-bubble markdown' });
  content.appendChild(bubble);
  renderer = createStreamRenderer(bubble, {});
  $('#searchViewTitle').textContent = `🔍 ${query}`;
  return { bubble, renderer };
}

export function updateSearchResult(handle, text) {
  handle?.renderer?.set(text);
  scrollToBottom($('#searchResultContent'));
}

export function endSearchResult(handle, sources) {
  handle?.renderer?.flush();
  if (sources?.length) {
    const host = el('div', { class: 'search-sources' });
    renderSources(host, sources);
    $('#searchResultContent')?.appendChild(host);
  }
}

export function showSearchError(message) {
  const content = $('#searchResultContent');
  if (!content) return;
  clear(content);
  content.appendChild(el('div', { class: 'search-error' }, [
    el('div', { class: 'se-icon', text: '⛔' }),
    el('div', { class: 'se-msg', text: message }),
  ]));
}

export function setSearchSaveEnabled(enabled) {
  const btn = $('#saveSearchBtn');
  if (btn) btn.style.display = enabled ? '' : 'none';
}

export function getSearchPayload() {
  const btn = $('#saveSearchBtn');
  const content = $('#searchResultContent');
  return {
    query: btn?.dataset?.query || '',
    content: btn?.dataset?.content || '',
    result: content?.innerText || '',
  };
}

export function setSearchPayload(query, content) {
  const btn = $('#saveSearchBtn');
  if (!btn) return;
  btn.dataset.query = query;
  btn.dataset.content = content;
}
