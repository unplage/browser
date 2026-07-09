let db;
export let dbReady = false;

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
  }).upgrade(async tx => {
    // v1→v2: presets table added, no data migration needed
    console.log('[DB] migrated to v2');
  });
  dbReady = true;
} catch (e) {
  console.error('[DB] failed to initialize:', e);
  dbReady = false;
}

function dbGuard() {
  if (!dbReady) throw new Error('IndexedDB 不可用，请检查浏览器隐私设置');
}

export async function getModules() {
  return (await db.modules.toArray()).sort((a, b) => a.position - b.position);
}

export async function saveModule(mod) {
  await db.modules.put(mod);
}

export async function saveModules(mods) {
  await db.modules.bulkPut(mods);
}

export async function deleteModule(id) {
  await db.modules.delete(id);
}

export async function getLayout() {
  return await db.layout.get('main') || { cols: 3, moduleOrder: [] };
}

export async function saveLayout(layout) {
  await db.layout.put({ id: 'main', ...layout });
}

export async function getBookmarks() {
  return await db.bookmarks.orderBy('createdAt').reverse().toArray();
}

export async function addBookmark(bm) {
  bm.createdAt = Date.now();
  return await db.bookmarks.add(bm);
}

export async function deleteBookmark(id) {
  await db.bookmarks.delete(id);
}

export async function getSearchResults() {
  return await db.searchResults.orderBy('savedAt').reverse().toArray();
}

export async function saveSearchResult(r) {
  r.savedAt = Date.now();
  return await db.searchResults.add(r);
}

export async function deleteSearchResult(id) {
  await db.searchResults.delete(id);
}

export async function getChatHistory(moduleId) {
  const list = await db.chatHistory.where('moduleId').equals(moduleId).reverse().toArray();
  return list.length > 0 ? list[0] : null;
}

export async function getAllChatHistories(moduleId) {
  return await db.chatHistory.where('moduleId').equals(moduleId).reverse().toArray();
}

export async function getChatHistoryById(id) {
  return await db.chatHistory.get(id);
}

export async function createChatHistory(moduleId) {
  const id = await db.chatHistory.add({ moduleId, messages: [], createdAt: Date.now() });
  return id;
}

export async function saveChatHistoryById(id, messages) {
  const existing = await db.chatHistory.get(id);
  if (existing) {
    existing.messages = messages;
    existing.createdAt = Date.now();
    await db.chatHistory.put(existing);
  }
}

export async function saveChatHistory(moduleId, messages) {
  const existing = await getChatHistory(moduleId);
  if (existing) {
    existing.messages = messages;
    existing.createdAt = Date.now();
    await db.chatHistory.put(existing);
  } else {
    await db.chatHistory.add({ moduleId, messages, createdAt: Date.now() });
  }
}

export async function deleteChatHistory(id) {
  await db.chatHistory.delete(id);
}

export async function renameChatHistory(id, title) {
  const rec = await db.chatHistory.get(id);
  if (rec) {
    rec.title = title;
    await db.chatHistory.put(rec);
  }
}

export async function getFiles() {
  return await db.files.orderBy('createdAt').reverse().toArray();
}

export async function deleteFile(id) {
  await db.files.delete(id);
}

export async function saveFileRecord(rec) {
  rec.createdAt = Date.now();
  return await db.files.add(rec);
}

export async function getSetting(key) {
  const s = await db.settings.get(key);
  return s ? s.value : null;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

export async function getPresets() {
  return await db.presets.orderBy('createdAt').reverse().toArray();
}

export async function savePreset(preset) {
  preset.createdAt = Date.now();
  return await db.presets.add(preset);
}

export async function deletePreset(id) {
  await db.presets.delete(id);
}
