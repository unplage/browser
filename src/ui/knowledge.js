import { el, clear, field, input, textarea, emptyState, spinner } from './dom.js';
import { openModal, confirmDialog, promptDialog } from './modal.js';
import { notify } from './toast.js';
import { getDocuments, updateDocument } from '../db.js';
import { knowledgeStats, removeDocument, ingestText, ingestFile, ingestUrl } from '../rag/ingest.js';
import { retrieve } from '../rag/retrieve.js';

/* ─── 知识库面板 ─── */

export async function openKnowledgePanel(opts = {}) {
  const body = el('div', { class: 'kb-panel' });
  const listHost = el('div', { class: 'kb-list' });
  const statsHost = el('div', { class: 'kb-stats' });

  const searchInput = el('input', { class: 'ui-input', placeholder: '🔍 试检索（验证召回质量）' });
  const searchResult = el('div', { class: 'kb-search-result' });

  const doSearch = async () => {
    const q = searchInput.value.trim();
    clear(searchResult);
    if (!q) return;
    searchResult.appendChild(spinner('检索中…'));
    try {
      const res = await retrieve(q, { topK: 6 });
      clear(searchResult);
      if (!res.results.length) {
        searchResult.appendChild(el('div', { class: 'kb-empty', text: res.note || '未命中任何内容' }));
        return;
      }
      searchResult.appendChild(el('div', { class: 'kb-search-mode', text: `检索模式：${res.mode} · 命中 ${res.results.length} 条` }));
      res.results.forEach((r, i) => {
        searchResult.appendChild(el('div', { class: 'kb-hit' }, [
          el('div', { class: 'kb-hit-head' }, [
            el('span', { class: 'kb-hit-id', text: `S${i + 1}` }),
            el('span', { class: 'kb-hit-title', text: r.docTitle }),
            el('span', { class: 'kb-hit-heading', text: r.heading || '' }),
            el('span', { class: 'kb-hit-score', text: r.score.toFixed(4) }),
          ]),
          el('div', { class: 'kb-hit-text', text: r.text.slice(0, 260) + (r.text.length > 260 ? '…' : '') }),
        ]));
      });
    } catch (e) {
      clear(searchResult);
      searchResult.appendChild(el('div', { class: 'kb-empty', text: `检索失败：${e.message}` }));
    }
  };
  searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };

  body.appendChild(statsHost);
  body.appendChild(el('div', { class: 'kb-toolbar' }, [
    searchInput,
    el('button', { class: 'ui-btn', onclick: doSearch }, '检索'),
    el('button', { class: 'ui-btn ui-btn-primary', onclick: () => openIngestDialog(refresh) }, '➕ 添加资料'),
  ]));
  body.appendChild(searchResult);
  body.appendChild(listHost);

  const refresh = async () => {
    clear(listHost);
    listHost.appendChild(spinner('加载中…'));
    try {
      const [docs, stats] = await Promise.all([getDocuments(), knowledgeStats()]);
      clear(statsHost);
      statsHost.appendChild(el('span', { text: `📄 ${stats.documents} 篇` }));
      statsHost.appendChild(el('span', { text: `🧩 ${stats.chunks} 片段` }));
      statsHost.appendChild(el('span', { text: `📝 ${stats.chars.toLocaleString()} 字` }));
      statsHost.appendChild(el('span', {
        class: stats.vectorEnabled ? 'kb-stat-ok' : 'kb-stat-warn',
        text: stats.vectorEnabled ? `🧮 向量检索：${stats.embeddingModel}` : '🧮 向量检索：未配置（仅 BM25）',
      }));

      clear(listHost);
      if (!docs.length) {
        listHost.appendChild(emptyState('知识库为空', '上传文档、粘贴文本或导入网址后即可被检索'));
        return;
      }
      docs.forEach(d => listHost.appendChild(buildDocItem(d, refresh)));
    } catch (e) {
      clear(listHost);
      listHost.appendChild(emptyState(`加载失败：${e.message}`));
    }
  };

  const footer = el('div', { class: 'modal-footer-row' }, [
    el('button', { class: 'ui-btn ui-btn-primary', onclick: () => m.close() }, '完成'),
  ]);
  const m = openModal({ title: '📚 知识库', body, footer, size: 'lg' });
  refresh();
  return m;
}

function buildDocItem(doc, refresh) {
  const item = el('div', { class: 'kb-item' });
  item.appendChild(el('div', { class: 'kb-item-head' }, [
    el('span', { class: 'kbi-icon', text: kindIcon(doc.kind) }),
    el('span', { class: 'kbi-title', text: doc.title }),
    el('span', { class: 'kbi-kind', text: doc.kind }),
  ]));
  const meta = el('div', { class: 'kb-item-meta' }, [
    el('span', { text: `${doc.chunkCount || 0} 片段` }),
    el('span', { text: `${(doc.chars || 0).toLocaleString()} 字` }),
    doc.vectorCount ? el('span', { class: 'kbi-vec', text: `🧮 ${doc.vectorCount} 向量` }) : null,
    doc.source === 'url' && doc.url ? el('a', { href: doc.url, target: '_blank', rel: 'noopener noreferrer', text: '🔗 原文' }) : null,
    doc.note ? el('span', { class: 'kbi-note', text: doc.note }) : null,
  ]);
  item.appendChild(meta);

  const actions = el('div', { class: 'kb-item-actions' }, [
    el('button', {
      class: 'ui-btn ui-btn-xs',
      onclick: async () => {
        const title = await promptDialog('重命名文档', { defaultValue: doc.title });
        if (!title) return;
        await updateDocument(doc.id, { title });
        refresh();
      },
    }, '✏️ 重命名'),
    el('button', {
      class: 'ui-btn ui-btn-xs',
      onclick: async () => {
        const ok = await confirmDialog(`删除「${doc.title}」及其全部索引？`, { danger: true, okText: '删除' });
        if (!ok) return;
        await removeDocument(doc.id);
        notify.success('已删除');
        refresh();
      },
    }, '🗑️ 删除'),
  ]);
  item.appendChild(actions);
  return item;
}

function kindIcon(kind) {
  return { markdown: '📝', html: '🌐', code: '💻', data: '🗃️', text: '📄' }[kind] || '📄';
}

/* ─── 添加资料对话框 ─── */
export function openIngestDialog(onDone) {
  const body = el('div', { class: 'ingest-panel' });
  let mode = 'file';

  const fileInput = el('input', { type: 'file', class: 'ui-input', accept: '.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.xml,.yaml,.yml,.html,.htm,.js,.ts,.tsx,.jsx,.py,.java,.go,.rs,.c,.cpp,.h,.sh,.sql,.log,.ini,.cfg,.toml' });
  const titleInput = el('input', { class: 'ui-input', placeholder: '文档标题（留空则用文件名）' });
  const urlInput = el('input', { class: 'ui-input', placeholder: 'https://example.com/article' });
  const textArea = el('textarea', { class: 'ui-textarea', placeholder: '粘贴要入库的文本…', rows: 8 });

  const filePane = el('div', { class: 'ingest-pane' }, [field('选择文件', fileInput), field('标题（可选）', titleInput)]);
  const urlPane = el('div', { class: 'ingest-pane', style: { display: 'none' } }, [field('网页地址', urlInput), field('标题（可选）', titleInput.cloneNode(true))]);
  const textPane = el('div', { class: 'ingest-pane', style: { display: 'none' } }, [field('标题', titleInput.cloneNode(true)), field('正文', textArea)]);

  body.appendChild(el('div', { class: 'ingest-tabs' }, [
    el('button', { class: 'ui-chip active', onclick: (e) => switchMode('file', e) }, '📁 上传文件'),
    el('button', { class: 'ui-chip', onclick: (e) => switchMode('url', e) }, '🌐 抓取网址'),
    el('button', { class: 'ui-chip', onclick: (e) => switchMode('text', e) }, '📝 粘贴文本'),
  ]));
  body.appendChild(filePane);
  body.appendChild(urlPane);
  body.appendChild(textPane);

  function switchMode(m, e) {
    mode = m;
    filePane.style.display = m === 'file' ? '' : 'none';
    urlPane.style.display = m === 'url' ? '' : 'none';
    textPane.style.display = m === 'text' ? '' : 'none';
    body.querySelectorAll('.ui-chip').forEach(c => c.classList.remove('active'));
    e.currentTarget.classList.add('active');
  }

  const status = el('div', { class: 'ingest-status' });
  body.appendChild(status);

  const footer = el('div', { class: 'modal-footer-row' });
  const cancel = el('button', { class: 'ui-btn', onclick: () => m.close() }, '取消');
  const ok = el('button', { class: 'ui-btn ui-btn-primary' }, '开始入库');
  footer.appendChild(cancel);
  footer.appendChild(ok);

  const m = openModal({ title: '➕ 添加知识库资料', body, footer, size: 'md' });

  ok.onclick = async () => {
    ok.disabled = true;
    status.textContent = '处理中…';
    try {
      let res;
      if (mode === 'file') {
        const f = fileInput.files?.[0];
        if (!f) throw new Error('请选择文件');
        res = await ingestFile(f, { title: titleInput.value.trim() });
      } else if (mode === 'url') {
        const u = urlInput.value.trim();
        if (!u) throw new Error('请输入网址');
        res = await ingestUrl(u, { title: titleInput.value.trim() });
      } else {
        const t = textArea.value;
        if (!t.trim()) throw new Error('请粘贴文本');
        res = await ingestText({ title: titleInput.value.trim() || '手动笔记', text: t, source: 'manual' });
      }
      if (!res.document) {
        throw new Error(res.note || '入库失败');
      }
      notify.success(`已入库「${res.document.title}」：${res.chunks} 个片段${res.vectors ? `，${res.vectors} 个向量` : ''}`);
      if (res.note) notify.warning(res.note);
      m.close();
      onDone?.();
    } catch (e) {
      status.textContent = `失败：${e.message}`;
      notify.error(e.message);
    } finally {
      ok.disabled = false;
    }
  };

  return m;
}
