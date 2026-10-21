import { estimateTokens } from './core/tokens.js';

/* ─── IndexedDB (Dexie) 封装 ─── */

export let db;
export let dbReady = false;
export let dbError = null;

try {
  db = new Dexie('AIBrowser');
  db.version(1).stores({
    modules: 'id, title, enabled, position',
    layout: 'id',
    bookmarks: '++id, url, title, tags, createdAt',
    searchResults: '++id, query, savedAt',
    chatHistory: '++id, moduleId, createdAt',
    files: '++id, fileName, fileType, createdAt',
    settings: 'key'
  });
  db.version(2).stores({
    modules: 'id, title, enabled, position',
    layout: 'id',
    bookmarks: '++id, url, title, tags, createdAt',
    searchResults: '++id, query, savedAt',
    chatHistory: '++id, moduleId, createdAt',
    files: '++id, fileName, fileType, createdAt',
    settings: 'key',
    presets: '++id, createdAt',
  });
  db.version(3).stores({
    modules: 'id, title, enabled, position',
    layout: 'id',
    bookmarks: '++id, url, title, tags, folder, createdAt',
    searchResults: '++id, query, savedAt',
    chatHistory: '++id, moduleId, createdAt',
    files: '++id, fileName, fileType, createdAt',
    settings: 'key',
    presets: '++id, createdAt',
  });
  db.version(4).stores({
    modules: 'id, title, enabled, position',
    layout: 'id',
    bookmarks: '++id, url, title, tags, folder, createdAt',
    searchResults: '++id, query, savedAt',
    chatHistory: '++id, moduleId, createdAt',
    files: '++id, fileName, fileType, createdAt',
    settings: 'key',
    presets: '++id, createdAt',
    sessions: '++id, moduleId, updatedAt, createdAt, archived',
    messages: '++id, sessionId, createdAt, role',
    documents: '++id, title, kind, createdAt, updatedAt, status',
    chunks: '++id, docId, ord',
    vectors: '++id, chunkId, model',
    toolRuns: '++id, sessionId, createdAt',
    usage: '++id, sessionId, providerId, createdAt',
  }).upgrade(async tx => {
    console.log('[DB] migrated to v4');
    await migrateLegacyChats(tx);
  });
  dbReady = true;
} catch (e) {
  console.error('[DB] failed to initialize:', e);
  dbError = e;
  dbReady = false;
}

/**
 * v3 → v4：旧 chatHistory（每模块一条，含 messages 数组）迁移为 sessions + messages。
 * 保留旧表不动，便于回退。
 */
async function migrateLegacyChats(tx) {
  const legacy = tx.table('chatHistory');
  if (!legacy) return;
  const rows = await legacy.toArray();
  if (!rows.length) return;
  const sessions = tx.table('sessions');
  const messages = tx.table('messages');
  for (const row of rows) {
    const sid = await sessions.add({
      moduleId: row.moduleId,
      title: row.title || '历史对话',
      createdAt: row.createdAt || Date.now(),
      updatedAt: row.createdAt || Date.now(),
      archived: 0,
    });
    const msgs = Array.isArray(row.messages) ? row.messages : [];
    for (const m of msgs) {
      await messages.add({
        sessionId: sid,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        reasoning: m.reasoning || '',
        createdAt: m.timestamp || row.createdAt || Date.now(),
        meta: m.meta ? JSON.stringify(m.meta) : null,
      });
    }
  }
  console.log(`[DB] migrated ${rows.length} legacy chats into sessions/messages`);
}

/* ─── 通用 ─── */
function assertDb() {
  if (!dbReady || !db) throw new Error('IndexedDB 不可用，请检查浏览器隐私设置');
}

/* ─── Modules ─── */
export async function getModules() {
  assertDb();
  return (await db.modules.toArray()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
export async function saveModule(mod) { assertDb(); await db.modules.put(mod); }
export async function saveModules(mods) { assertDb(); await db.modules.bulkPut(mods); }
export async function deleteModule(id) { assertDb(); await db.modules.delete(id); }

/* ─── Layout ─── */
export async function getLayout() {
  assertDb();
  return (await db.layout.get('main')) || { cols: 3, moduleOrder: [] };
}
export async function saveLayout(layout) {
  assertDb();
  await db.layout.put({ id: 'main', ...layout });
}

/* ─── Bookmarks ─── */
export async function getBookmarks() {
  assertDb();
  return db.bookmarks.orderBy('createdAt').reverse().toArray();
}
export async function addBookmark(bm) {
  assertDb();
  bm.createdAt = bm.createdAt || Date.now();
  return db.bookmarks.add(bm);
}
export async function updateBookmark(id, changes) {
  assertDb();
  const rec = await db.bookmarks.get(id);
  if (!rec) return null;
  Object.assign(rec, changes);
  await db.bookmarks.put(rec);
  return rec;
}
export async function deleteBookmark(id) { assertDb(); await db.bookmarks.delete(id); }

/* ─── Search results ─── */
export async function getSearchResults() {
  assertDb();
  return db.searchResults.orderBy('savedAt').reverse().toArray();
}
export async function saveSearchResult(r) {
  assertDb();
  r.savedAt = Date.now();
  return db.searchResults.add(r);
}
export async function deleteSearchResult(id) { assertDb(); await db.searchResults.delete(id); }

/* ─── Files (legacy 记录表) ─── */
export async function getFiles() {
  assertDb();
  return db.files.orderBy('createdAt').reverse().toArray();
}
export async function deleteFile(id) { assertDb(); await db.files.delete(id); }
export async function saveFileRecord(rec) {
  assertDb();
  rec.createdAt = Date.now();
  return db.files.add(rec);
}

/* ─── Settings ─── */
export async function getSetting(key) {
  assertDb();
  const s = await db.settings.get(key);
  return s ? s.value : null;
}
export async function setSetting(key, value) {
  assertDb();
  await db.settings.put({ key, value });
}
export async function getAllSettings() {
  assertDb();
  return db.settings.toArray();
}

/* ─── Presets ─── */
export async function getPresets() {
  assertDb();
  return db.presets.orderBy('createdAt').reverse().toArray();
}
export async function savePreset(preset) {
  assertDb();
  preset.createdAt = Date.now();
  return db.presets.add(preset);
}
export async function deletePreset(id) { assertDb(); await db.presets.delete(id); }

/* ─── Sessions (会话线程) ─── */
export async function getSessions(moduleId, opts = {}) {
  assertDb();
  const all = moduleId
    ? await db.sessions.where('moduleId').equals(moduleId).toArray()
    : await db.sessions.toArray();
  const filtered = opts.includeArchived ? all : all.filter(s => !s.archived);
  return filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getSession(id) {
  assertDb();
  return db.sessions.get(id);
}

export async function createSession(moduleId, title = '') {
  assertDb();
  const now = Date.now();
  const rec = {
    moduleId, title: title || '', createdAt: now, updatedAt: now, archived: 0,
  };
  const id = await db.sessions.add(rec);
  return { ...rec, id };
}

export async function updateSession(id, changes) {
  assertDb();
  const rec = await db.sessions.get(id);
  if (!rec) return null;
  Object.assign(rec, changes, { updatedAt: Date.now() });
  await db.sessions.put(rec);
  return rec;
}

export async function deleteSession(id) {
  assertDb();
  const msgs = await db.messages.where('sessionId').equals(id).toArray();
  await db.messages.bulkDelete(msgs.map(m => m.id));
  const runs = await db.toolRuns.where('sessionId').equals(id).toArray();
  await db.toolRuns.bulkDelete(runs.map(r => r.id));
  await db.sessions.delete(id);
}

/* ─── Messages ─── */
export async function getMessages(sessionId) {
  assertDb();
  const list = await db.messages.where('sessionId').equals(sessionId).toArray();
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function addMessage(sessionId, msg) {
  assertDb();
  const rec = {
    sessionId,
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : (msg.content ? JSON.stringify(msg.content) : ''),
    reasoning: msg.reasoning || '',
    createdAt: msg.createdAt || Date.now(),
    meta: msg.meta ? JSON.stringify(msg.meta) : null,
  };
  const id = await db.messages.add(rec);
  await db.sessions.update(sessionId, { updatedAt: rec.createdAt });
  return { ...rec, id };
}

export async function updateMessage(id, changes) {
  assertDb();
  const rec = await db.messages.get(id);
  if (!rec) return null;
  Object.assign(rec, changes);
  await db.messages.put(rec);
  return rec;
}

export async function deleteMessage(id) {
  assertDb();
  await db.messages.delete(id);
}

export async function deleteMessagesAfter(sessionId, createdAt) {
  assertDb();
  const list = await db.messages.where('sessionId').equals(sessionId).toArray();
  const targets = list.filter(m => (m.createdAt || 0) >= createdAt);
  await db.messages.bulkDelete(targets.map(m => m.id));
  return targets.length;
}

/* ─── Knowledge base ─── */
export async function getDocuments(opts = {}) {
  assertDb();
  let list = await db.documents.toArray();
  if (opts.kind) list = list.filter(d => d.kind === opts.kind);
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDocument(id) { assertDb(); return db.documents.get(id); }

export async function addDocument(doc) {
  assertDb();
  const now = Date.now();
  const rec = { createdAt: now, updatedAt: now, status: 'ready', chunkCount: 0, ...doc };
  const id = await db.documents.add(rec);
  return { ...rec, id };
}

export async function updateDocument(id, changes) {
  assertDb();
  const rec = await db.documents.get(id);
  if (!rec) return null;
  Object.assign(rec, changes, { updatedAt: Date.now() });
  await db.documents.put(rec);
  return rec;
}

export async function deleteDocument(id) {
  assertDb();
  const chunks = await db.chunks.where('docId').equals(id).toArray();
  const chunkIds = chunks.map(c => c.id);
  if (chunkIds.length) {
    const vectors = await db.vectors.where('chunkId').anyOf(chunkIds).toArray();
    await db.vectors.bulkDelete(vectors.map(v => v.id));
  }
  await db.chunks.bulkDelete(chunkIds);
  await db.documents.delete(id);
}

export async function getChunks(docId) {
  assertDb();
  return db.chunks.where('docId').equals(docId).sortBy('ord');
}

export async function addChunks(docId, chunks) {
  assertDb();
  const now = Date.now();
  const recs = chunks.map(c => ({
    docId,
    ord: c.ord,
    heading: c.heading || '',
    text: c.text,
    tokens: c.tokens ?? estimateTokens(c.text),
    createdAt: now,
  }));
  await db.chunks.bulkAdd(recs);
  return recs;
}

export async function clearChunks(docId) {
  assertDb();
  const chunks = await db.chunks.where('docId').equals(docId).toArray();
  const chunkIds = chunks.map(c => c.id);
  if (chunkIds.length) {
    const vectors = await db.vectors.where('chunkId').anyOf(chunkIds).toArray();
    await db.vectors.bulkDelete(vectors.map(v => v.id));
  }
  await db.chunks.bulkDelete(chunkIds);
}

export async function getAllChunks() {
  assertDb();
  return db.chunks.toArray();
}

export async function getChunk(id) { assertDb(); return db.chunks.get(id); }

export async function saveVectors(records) {
  assertDb();
  await db.vectors.bulkPut(records);
}

export async function getVectors(model) {
  assertDb();
  if (model) return db.vectors.where('model').equals(model).toArray();
  return db.vectors.toArray();
}

export async function deleteVectorsByModel(model) {
  assertDb();
  const rows = await db.vectors.where('model').equals(model).toArray();
  await db.vectors.bulkDelete(rows.map(r => r.id));
}

/* ─── Agent traces ─── */
export async function addToolRun(sessionId, run) {
  assertDb();
  const rec = { sessionId, createdAt: Date.now(), ...run };
  const id = await db.toolRuns.add(rec);
  return { ...rec, id };
}
export async function getToolRuns(sessionId) {
  assertDb();
  const list = await db.toolRuns.where('sessionId').equals(sessionId).toArray();
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export async function deleteToolRuns(sessionId) {
  assertDb();
  const rows = await db.toolRuns.where('sessionId').equals(sessionId).toArray();
  await db.toolRuns.bulkDelete(rows.map(r => r.id));
}

/* ─── Usage accounting ─── */
export async function addUsage(rec) {
  assertDb();
  const row = { createdAt: Date.now(), ...rec };
  const id = await db.usage.add(row);
  return { ...row, id };
}
export async function getUsage(opts = {}) {
  assertDb();
  let list = await db.usage.toArray();
  if (opts.sessionId) list = list.filter(u => u.sessionId === opts.sessionId);
  if (opts.since) list = list.filter(u => (u.createdAt || 0) >= opts.since);
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export async function clearUsage() {
  assertDb();
  await db.usage.clear();
}

/* ─── Backup ─── */
export async function exportAll() {
  assertDb();
  const [modules, bookmarks, searchResults, sessions, messages, documents, chunks, vectors, toolRuns, usage, settings, presets] = await Promise.all([
    db.modules.toArray(), db.bookmarks.toArray(), db.searchResults.toArray(),
    db.sessions.toArray(), db.messages.toArray(), db.documents.toArray(),
    db.chunks.toArray(), db.vectors.toArray(), db.toolRuns.toArray(), db.usage.toArray(),
    db.settings.toArray(), db.presets.toArray(),
  ]);
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    modules, bookmarks, searchResults, sessions, messages,
    documents, chunks, vectors, toolRuns, usage, settings, presets,
  };
}

/**
 * 导入备份。settings 中 providers 的 apiKey 会被脱敏（除非显式 allowSecrets）。
 */
export async function importAll(data, opts = {}) {
  assertDb();
  const allowSecrets = !!opts.allowSecrets;
  const report = { restored: [], skipped: [] };

  const restore = async (table, rows, transform) => {
    if (!Array.isArray(rows) || !rows.length) { report.skipped.push(table); return; }
    await db[table].clear();
    const prepared = transform ? rows.map(transform) : rows;
    await db[table].bulkPut(prepared);
    report.restored.push(table);
  };

  await restore('modules', data.modules);
  await restore('bookmarks', data.bookmarks);
  await restore('searchResults', data.searchResults);
  await restore('sessions', data.sessions);
  await restore('messages', data.messages);
  await restore('documents', data.documents);
  await restore('chunks', data.chunks);
  await restore('vectors', data.vectors);
  await restore('toolRuns', data.toolRuns);
  await restore('usage', data.usage);
  await restore('presets', data.presets);

  if (Array.isArray(data.settings) && data.settings.length) {
    await db.settings.clear();
    const settings = data.settings.map(s => {
      if (s.key === 'providers' && !allowSecrets && typeof s.value === 'string') {
        try {
          const parsed = JSON.parse(s.value);
          const masked = parsed.map(p => ({ ...p, apiKey: '' }));
          return { ...s, value: JSON.stringify(masked) };
        } catch { return s; }
      }
      return s;
    });
    await db.settings.bulkPut(settings);
    report.restored.push('settings');
  } else {
    report.skipped.push('settings');
  }

  return report;
}
