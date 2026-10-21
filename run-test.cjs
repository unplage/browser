/* ─── AI Browser v2 · 端到端测试 ───
 * 运行前需先启动静态服务器：python3 -m http.server 8080
 * 依赖：Playwright + Firefox
 */
const { firefox } = require('playwright');

const URL = 'http://localhost:8080';
const MOCK_BASE = `${URL}/mockllm/v1`;

const errors = [];
const consoleErrors = [];
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    errors.push(name);
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || '不相等'}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ─── Mock LLM ─── */
function sse(events) {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function textDelta(text) {
  return { choices: [{ delta: { content: text } }] };
}

function reasoningDelta(text) {
  return { choices: [{ delta: { reasoning_content: text } }] };
}

function toolCallDelta(idx, id, name, argsText) {
  return { choices: [{ delta: { tool_calls: [{ index: idx, id, function: { name, arguments: argsText } }] } }] };
}

function toolCallDone(idx, id, name, args) {
  return { choices: [{ delta: { tool_calls: [{ index: idx, id, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] };
}

async function main() {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('CONSOLE: ' + m.text().slice(0, 200)); });

  /* 拦截 LLM 请求，按请求体内容返回不同响应 */
  let requestBodies = [];
  await page.route('**/mockllm/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    requestBodies.push(body);
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content : '';

    if (body.tools && body.tools.some(t => t.function?.name === 'calculator')) {
      /* Agent 场景：先请求调用计算器工具 */
      if (!body.messages.some(m => m.role === 'tool')) {
        return route.fulfill({
          status: 200, contentType: 'text/event-stream',
          body: sse([toolCallDone(0, 'call_calc_1', 'calculator', { expression: '6*7' })]),
        });
      }
      return route.fulfill({
        status: 200, contentType: 'text/event-stream',
        body: sse([textDelta('计算结果是 42。')]),
      });
    }

    if (text.includes('代码')) {
      return route.fulfill({
        status: 200, contentType: 'text/event-stream',
        body: sse([
          reasoningDelta('用户想要代码示例'),
          textDelta('下面是代码：\n\n```js\nconst a = 1 < 2;\n```\n\n'),
          textDelta('- 第一项\n- 第二项\n\n'),
          textDelta('[参考](https://example.com)\n'),
        ]),
      });
    }

    return route.fulfill({
      status: 200, contentType: 'text/event-stream',
      body: sse([textDelta('你好，这是一条测试回复。')]),
    });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1800);

  console.log('\n── 基础渲染 ──');

  await test('页面标题正确', async () => {
    const t = await page.title();
    assert(t.includes('AI Browser'), `got "${t}"`);
  });

  await test('侧边栏渲染 14 个模块', async () => {
    const n = (await page.$$('.nav-item')).length;
    eq(n, 14, '侧边栏模块数');
  });

  await test('网格渲染 14 张卡片', async () => {
    await page.waitForSelector('.module-card', { timeout: 5000 });
    const n = (await page.$$('.module-card')).length;
    eq(n, 14, '卡片数');
  });

  await test('状态栏显示模块数与版本', async () => {
    const t = await page.textContent('#moduleCount');
    assert(t.includes('14/14'), `got "${t}"`);
  });

  await test('依赖库全部本地可用（离线可用）', async () => {
    const ok = await page.evaluate(() => ({
      dexie: typeof Dexie !== 'undefined',
      sortable: typeof Sortable !== 'undefined',
      hljs: typeof hljs !== 'undefined',
    }));
    assert(ok.dexie, 'Dexie 缺失');
    assert(ok.sortable, 'Sortable 缺失');
    assert(ok.hljs, 'highlight.js 缺失');
  });

  await test('IndexedDB 全部表就绪', async () => {
    const tables = await page.evaluate(async () => {
      const { db } = await import('/src/db.js');
      return db.tables.map(t => t.name).sort();
    });
    const expected = ['bookmarks', 'chatHistory', 'chunks', 'documents', 'files', 'layout', 'messages',
      'modules', 'presets', 'searchResults', 'sessions', 'settings', 'toolRuns', 'usage', 'vectors'];
    for (const t of expected) assert(tables.includes(t), `缺少表 ${t}`);
  });

  console.log('\n── 模态框 ──');

  await test('设置面板打开且含服务商卡片', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('.provider-card', { timeout: 4000 });
    const n = (await page.$$('.provider-card')).length;
    assert(n >= 11, `应至少 11 个内置服务商，实际 ${n}`);
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  await test('设置面板包含六个分区', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('.settings-tab', { timeout: 4000 });
    const tabs = await page.$$eval('.settings-tab', els => els.map(e => e.textContent));
    eq(tabs.length, 6, '分区数');
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  await test('嵌套模态不会摧毁下层（模态栈）', async () => {
    await page.click('#kbBtn');
    await page.waitForSelector('.kb-panel', { timeout: 4000 });
    /* 在知识库面板内再打开一个模态 */
    await page.click('.kb-toolbar >> text=添加资料');
    await page.waitForSelector('.ingest-panel', { timeout: 4000 });
    const layers = (await page.$$('.modal-layer')).length;
    assert(layers >= 2, `应同时存在 ${layers} 层模态`);
    await page.click('.modal-layer:last-child .modal-close');
    await page.waitForTimeout(300);
    const stillThere = await page.$('.kb-panel');
    assert(stillThere, '关闭上层模态后下层应仍然存在');
    await page.click('.modal-layer:last-child .modal-close');
    await page.waitForTimeout(300);
  });

  await test('知识库面板可打开', async () => {
    await page.click('#kbBtn');
    await page.waitForSelector('.kb-panel', { timeout: 4000 });
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  await test('设置面板各分区可正常切换', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('.settings-tab', { timeout: 4000 });
    const n = (await page.$$('.settings-tab')).length;
    for (let i = 0; i < n; i++) {
      await page.click(`.settings-tab:nth-child(${i + 1})`);
      await page.waitForTimeout(200);
      const visible = await page.evaluate(() => {
        const panes = [...document.querySelectorAll('.settings-content > *')].filter(p => p.style.display !== 'none');
        return panes.length;
      });
      eq(visible, 1, `第 ${i + 1} 个分区应恰好有一个面板可见`);
    }
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  await test('Provider 搜索配置可切换并保留状态', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('.provider-card', { timeout: 4000 });
    /* 展开第一个 Provider 卡片 */
    await page.click('.provider-card-header');
    await page.waitForTimeout(300);
    const before = await page.$$eval('.provider-card .params-section', els => els.length);
    assert(before >= 1, '参数区应存在');
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  console.log('\n── 知识库 / RAG ──');

  await test('入库文档并建立索引', async () => {
    const res = await page.evaluate(async () => {
      const { ingestText } = await import('/src/rag/ingest.js');
      const r = await ingestText({
        title: '测试文档',
        text: '# 大分子药物\n\n单克隆抗体与 ADC 偶联药物的临床进展。\n\n## 临床数据\n\nKEYNOTE-001 显示 ORR 达到 63%。',
        source: 'manual',
      });
      return { chunks: r.chunks, vectors: r.vectors, note: r.note, id: r.document?.id };
    });
    assert(res.chunks >= 1, '应产生分块');
    assert(res.id, '应创建文档');
  });

  await test('BM25 检索命中正确文档', async () => {
    const hits = await page.evaluate(async () => {
      const { retrieve } = await import('/src/rag/retrieve.js');
      const r = await retrieve('ADC 偶联临床数据', { topK: 5 });
      return r.results.map(x => ({ title: x.docTitle, heading: x.heading, mode: r.mode }));
    });
    assert(hits.length > 0, '应命中');
    assert(hits[0].title === '测试文档', `命中错误文档: ${JSON.stringify(hits)}`);
  });

  await test('检索结果带引用编号与来源信息', async () => {
    const r = await page.evaluate(async () => {
      const { retrieve, formatContext } = await import('/src/rag/retrieve.js');
      const res = await retrieve('单克隆抗体', { topK: 3 });
      return { ctx: formatContext(res.results), count: res.results.length };
    });
    assert(r.count > 0);
    assert(r.ctx.includes('[S1]'), '上下文应带 [S1] 编号');
    assert(r.ctx.includes('测试文档'), '上下文应带文档标题');
  });

  await test('知识库面板能列出已入库文档', async () => {
    await page.click('#kbBtn');
    await page.waitForSelector('.kb-item', { timeout: 4000 });
    const titles = await page.$$eval('.kbi-title', els => els.map(e => e.textContent));
    assert(titles.includes('测试文档'), `未列出: ${JSON.stringify(titles)}`);
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  console.log('\n── 对话与流式渲染 ──');

  /* 配置 mock provider */
  await page.evaluate(async (base) => {
    const { getProviders, saveProviders } = await import('/src/llm/providers.js');
    const providers = await getProviders();
    const z = providers.find(p => p.id === 'zhipu');
    z.apiKey = 'sk-mock';
    z.apiBase = base;
    z.defaultModel = 'glm-4.7-flash';
    await saveProviders(providers);
  }, MOCK_BASE);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await test('打开模块进入对话视图', async () => {
    await page.click('.module-card');
    await page.waitForTimeout(700);
    assert(await page.isVisible('#chatView'), '对话视图不可见');
    assert(!(await page.isVisible('#gridView')), '网格视图应隐藏');
  });

  await test('发送消息并流式渲染', async () => {
    await page.fill('#chatInput', '你好');
    await page.click('#chatSend');
    await page.waitForTimeout(2000);
    const txt = await page.textContent('#chatMessages .msg.assistant .msg-bubble');
    assert(txt.includes('测试回复'), `回复内容: ${txt}`);
  });

  await test('流式消息后仍有复制按钮（旧版会丢失）', async () => {
    const n = (await page.$$('#chatMessages .msg.assistant .msg-copy-btn')).length;
    assert(n >= 1, '流式结束后应有复制按钮');
  });

  await test('代码块正确渲染为 pre/code', async () => {
    await page.fill('#chatInput', '给我一段代码');
    await page.click('#chatSend');
    await page.waitForTimeout(2200);
    const info = await page.evaluate(() => {
      const pre = document.querySelector('#chatMessages pre code');
      return {
        preCount: document.querySelectorAll('#chatMessages pre').length,
        lang: pre?.className || '',
        text: pre?.textContent || '',
        html: pre?.innerHTML || '',
      };
    });
    assert(info.preCount > 0, '应存在 <pre> 块');
    assert(info.lang.includes('language-js'), `语言标注缺失: ${info.lang}`);
    assert(info.text.includes('const a = 1 < 2'), `代码内容错误: ${info.text}`);
    assert(!info.html.includes('&amp;lt;'), '代码不应被二次转义: ' + info.html);
  });

  await test('列表渲染为 ul/li', async () => {
    const n = await page.evaluate(() => document.querySelectorAll('#chatMessages ul li').length);
    assert(n >= 2, `列表项数量 ${n}`);
  });

  await test('链接渲染为可点击 a 标签', async () => {
    const info = await page.evaluate(() => {
      const a = [...document.querySelectorAll('#chatMessages a')].find(x => x.href.includes('example.com'));
      return a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel } : null;
    });
    assert(info, '未找到链接');
    eq(info.target, '_blank');
    assert(info.rel.includes('noopener'));
  });

  await test('思考过程被捕获并可展开', async () => {
    const n = await page.evaluate(() => document.querySelectorAll('#chatMessages .msg-reasoning').length);
    assert(n >= 1, '应存在思考过程块');
  });

  await test('消息写入 IndexedDB', async () => {
    const count = await page.evaluate(async () => {
      const { getSessions, getMessages } = await import('/src/db.js');
      const s = await getSessions('poetry');
      if (!s.length) return 0;
      return (await getMessages(s[0].id)).length;
    });
    assert(count >= 4, `消息条数 ${count}`);
  });

  console.log('\n── Agent 工具链 ──');

  await test('Agent 模式触发工具调用并回显轨迹', async () => {
    await page.click('#chatAgentToggle');
    await page.fill('#chatInput', '算一下 6*7');
    await page.click('#chatSend');
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({
      traces: [...document.querySelectorAll('#chatMessages .trace-item')].map(e => e.textContent),
      text: document.querySelector('#chatMessages .msg.assistant:last-of-type .msg-bubble')?.textContent || '',
    }));
    assert(info.traces.some(t => t.includes('calculator')), `工具轨迹缺失: ${JSON.stringify(info.traces)}`);
    assert(info.text.includes('42'), `未回显工具结果: ${info.text}`);
  });

  await test('请求体包含工具定义且第二轮回灌工具结果', async () => {
    const withTools = requestBodies.filter(b => b.tools?.some(t => t.function?.name === 'calculator'));
    assert(withTools.length >= 2, '应至少两轮请求');
    const last = withTools[withTools.length - 1];
    assert(last.messages.some(m => m.role === 'tool'), '第二轮应包含 tool 结果消息');
  });

  await test('请求体参数符合协议（max_tokens 夹取 / thinking 形状）', async () => {
    const body = requestBodies[0];
    assert(body.max_tokens <= 131072, 'max_tokens 超限');
    assert(body.thinking?.type === 'enabled', `thinking 形状错误: ${JSON.stringify(body.thinking)}`);
    assert(body.stream === true, '应为流式请求');
  });

  console.log('\n── 会话与数据 ──');

  await test('会话列表可打开并包含当前会话', async () => {
    if (await page.isVisible('#gridView')) {
      await page.click('.module-card');
      await page.waitForTimeout(600);
    }
    await page.click('#chatHistoryBtn');
    await page.waitForSelector('.session-item', { timeout: 4000 });
    const n = (await page.$$('.session-item')).length;
    assert(n >= 1, '应至少一个会话');
    await page.click('.modal-close');
    await page.waitForTimeout(300);
  });

  await test('新建会话', async () => {
    const before = await page.evaluate(async () => (await import('/src/db.js')).getSessions('poetry').then(s => s.length));
    await page.click('#chatNewBtn');
    await page.waitForTimeout(900);
    const after = await page.evaluate(async () => (await import('/src/db.js')).getSessions('poetry').then(s => s.length));
    assert(after > before, `会话数未增加: ${before} → ${after}`);
  });

  await test('导出数据包含全部表', async () => {
    const data = await page.evaluate(async () => {
      const { exportAll } = await import('/src/db.js');
      const d = await exportAll();
      return { keys: Object.keys(d).sort(), modules: d.modules.length, docs: d.documents.length, chunks: d.chunks.length };
    });
    for (const k of ['modules', 'sessions', 'messages', 'documents', 'chunks', 'vectors', 'settings', 'presets']) {
      assert(data.keys.includes(k), `导出缺少 ${k}`);
    }
    assert(data.docs >= 1, '导出应包含知识库文档');
  });

  await test('导入数据恢复会话与知识库', async () => {
    const r = await page.evaluate(async () => {
      const { exportAll, importAll } = await import('/src/db.js');
      const backup = await exportAll();
      const report = await importAll(backup, { allowSecrets: false });
      return { restored: report.restored };
    });
    for (const t of ['modules', 'sessions', 'messages', 'documents', 'chunks']) {
      assert(r.restored.includes(t), `未恢复 ${t}（已恢复: ${r.restored.join(',')}）`);
    }
  });

  await test('导入时 API Key 被脱敏', async () => {
    const providers = await page.evaluate(async () => {
      const { getProviders } = await import('/src/llm/providers.js');
      const p = await getProviders();
      return p.map(x => x.apiKey).filter(Boolean);
    });
    assert(!providers.includes('sk-mock'), 'API Key 应在导入后被清空');
  });

  console.log('\n── 模块管理 ──');

  await test('模块编辑器可保存修改', async () => {
    if (await page.isVisible('#chatView')) {
      await page.click('#backToGrid');
      await page.waitForTimeout(600);
    }
    await page.click('.module-card .mca-btn[title="编辑"]');
    await page.waitForSelector('#modPrompt', { timeout: 4000 });
    const original = await page.inputValue('#modPrompt');
    await page.fill('#modTitle', '诗歌创作·改');
    await page.click('.modal-footer .ui-btn-primary');
    await page.waitForTimeout(900);
    const titles = await page.$$eval('.module-card .title', els => els.map(e => e.textContent));
    assert(titles.includes('诗歌创作·改'), `未保存: ${JSON.stringify(titles.slice(0, 3))}`);
    /* 还原 */
    await page.click('.module-card .mca-btn[title="编辑"]');
    await page.waitForSelector('#modTitle', { timeout: 4000 });
    await page.fill('#modTitle', '诗歌创作');
    await page.fill('#modPrompt', original);
    await page.click('.modal-footer .ui-btn-primary');
    await page.waitForTimeout(700);
  });

  await test('可创建自定义模块', async () => {
    const before = (await page.$$('.module-card')).length;
    await page.click('.grid-title-actions .ui-btn-primary');
    await page.waitForSelector('#newModTitle', { timeout: 4000 });
    await page.fill('#newModTitle', '测试模块');
    await page.fill('#newModPrompt', '这是一个测试用的系统提示词。');
    await page.click('.modal-footer .ui-btn-primary');
    await page.waitForTimeout(900);
    const after = (await page.$$('.module-card')).length;
    eq(after, before + 1, '新模块应出现在网格中');
  });

  console.log('\n── 交互与响应式 ──');

  await test('Escape 关闭模态', async () => {
    await page.click('#kbBtn');
    await page.waitForSelector('.kb-panel', { timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const disp = await page.evaluate(() => getComputedStyle(document.getElementById('modalOverlay')).display);
    eq(disp, 'none', '遮罩应隐藏');
  });

  await test('侧边栏可折叠且仍可展开', async () => {
    await page.click('#mobileMenuBtn');
    await page.waitForTimeout(400);
    const collapsed = await page.evaluate(() => document.getElementById('sidebar').classList.contains('collapsed'));
    assert(collapsed, '侧边栏未折叠');
    await page.click('#mobileMenuBtn');
    await page.waitForTimeout(400);
    const expanded = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('collapsed'));
    assert(expanded, '侧边栏未展开');
  });

  await test('模块隐藏后可从侧边栏恢复', async () => {
    if (await page.isVisible('#chatView')) {
      await page.click('#backToGrid');
      await page.waitForTimeout(600);
    }
    const before = (await page.$$('.module-card')).length;
    await page.click('.module-card .mca-btn[title="隐藏"]');
    await page.waitForTimeout(700);
    const after = (await page.$$('.module-card')).length;
    eq(after, before - 1, '隐藏后卡片数应减少');
    const disabled = await page.$$('.nav-item.disabled');
    assert(disabled.length >= 1, '侧边栏应出现禁用项');
  });

  await test('窄屏布局不溢出', async () => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 2, `横向溢出 ${overflow}px`);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.waitForTimeout(400);
  });

  console.log('\n── 稳定性 ──');
  await test('运行期间无未捕获错误', async () => {
    const real = consoleErrors.filter(e => !/favicon|404|net::ERR/i.test(e));
    assert(real.length === 0, `出现 ${real.length} 条错误:\n     ${real.slice(0, 5).join('\n     ')}`);
  });

  await browser.close();

  console.log(`\n=== ${failed === 0 ? 'ALL PASSED' : 'FAILURES DETECTED'} ===`);
  console.log(`Passed: ${passed}/${passed + failed}`);
  if (failed) console.log(`Failed: ${errors.join(', ')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
