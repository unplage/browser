const { firefox } = require('playwright');

const URL = 'http://localhost:8080';
const errors = [];

async function test(desc, fn) {
  try { await fn(); console.log('  \u2705 ' + desc); }
  catch (e) { console.log('  \u274c ' + desc + ': ' + e.message); errors.push(desc); }
}

async function main() {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [CONSOLE ERROR] ' + msg.text());
  });
  page.on('pageerror', err => console.log('  [PAGE ERROR] ' + err.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  await test('Page title', async () => {
    const t = await page.title();
    if (t !== 'AI Browser') throw new Error('got "' + t + '"');
  });

  await test('Topbar renders', async () => {
    await page.waitForSelector('#topbar', { timeout: 3000 });
  });

  await test('Sidebar with 13 nav items', async () => {
    const n = (await page.$$('.nav-item')).length;
    if (n !== 13) throw new Error('got ' + n);
  });

  await test('Grid with 13 module cards', async () => {
    await page.waitForSelector('.module-card', { timeout: 5000 });
    const n = (await page.$$('.module-card')).length;
    if (n !== 13) throw new Error('got ' + n);
  });

  await test('Status bar shows 13/13', async () => {
    const t = await page.textContent('#moduleCount');
    if (!t.includes('13/13')) throw new Error('got "' + t + '"');
  });

  await test('Dexie.js loaded', async () => {
    const ok = await page.evaluate(() => typeof Dexie !== 'undefined');
    if (!ok) throw new Error('Dexie not found');
  });

  await test('SortableJS loaded', async () => {
    const ok = await page.evaluate(() => typeof Sortable !== 'undefined');
    if (!ok) throw new Error('Sortable not found');
  });

  await test('Settings modal', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('#apiKeyInput', { timeout: 3000 });
    await page.click('#modalCloseBtn');
  });

  await test('Bookmark modal', async () => {
    await page.click('#bookmarkBtn');
    await page.waitForSelector('#modalOverlay', { timeout: 3000 });
    await page.click('#modalCloseBtn');
  });

  await test('Upload modal', async () => {
    await page.click('#uploadBtn');
    await page.waitForSelector('.upload-zone', { timeout: 3000 });
    await page.click('#modalCloseBtn');
  });

  await test('Module click opens chat', async () => {
    await (await page.$('.module-card')).click();
    await page.waitForTimeout(500);
    const vis = await page.isVisible('#chatView');
    if (!vis) throw new Error('chat not visible');
    await page.click('#backToGrid');
  });

  await test('Chat input + send button', async () => {
    await (await page.$('.module-card')).click();
    await page.waitForTimeout(300);
    const inp = await page.$('#chatInput');
    const snd = await page.$('#chatSend');
    if (!inp || !snd) throw new Error('missing input or send');
    await page.click('#backToGrid');
  });

  await test('Module editor opens', async () => {
    await (await page.$('.edit-btn')).click();
    await page.waitForSelector('#modPrompt', { timeout: 3000 });
    const text = await (await page.$('#modPrompt')).inputValue();
    if (!text || text.length < 50) throw new Error('prompt short: ' + text.length + ' chars');
    await page.click('#modalCloseBtn');
  });

  await test('IndexedDB 7 tables', async () => {
    const tables = await page.evaluate(async () => {
      const db = new Dexie('AIBrowser');
      await db.open();
      return db.tables.map(function(t) { return t.name; }).sort();
    });
    var expected = ['bookmarks','chatHistory','files','layout','modules','searchResults','settings'];
    for (var t of expected) {
      if (tables.indexOf(t) === -1) throw new Error('table "' + t + '" missing');
    }
  });

  await test('Sidebar toggle', async () => {
    await page.click('#toggleSidebar', { force: true });
    await page.waitForTimeout(200);
    await page.click('#toggleSidebar', { force: true });
  });

  await test('Search input accepts text', async () => {
    var inp = await page.$('#searchInput');
    await inp.fill('test query');
    var val = await inp.inputValue();
    if (val !== 'test query') throw new Error('got "' + val + '"');
    await inp.fill('');
  });

  const total = 17;
  console.log('\n=== ' + (errors.length === 0 ? 'ALL PASSED' : 'FAILURES DETECTED') + ' ===');
  console.log('Passed: ' + (total - errors.length) + '/' + total);
  if (errors.length) console.log('Failed: ' + errors.join(', '));

  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch(function(err) {
  console.error('Fatal:', err.message);
  process.exit(1);
});
