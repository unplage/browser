import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../src/agent/calc.js';
import { parseTextToolCalls } from '../src/agent/runtime.js';
import { extractReadable } from '../src/agent/webfetch.js';
import { formatSearchResults } from '../src/llm/search.js';
import { estimateTokens, estimateMessagesTokens, compressToBudget, buildSummaryPrompt } from '../src/core/tokens.js';
import { buildGroundedPrompt, formatContext } from '../src/rag/retrieve.js';

test('计算器：四则运算', () => {
  assert.equal(evaluateExpression('1+2*3'), 7);
  assert.equal(evaluateExpression('(1+2)*3'), 9);
  assert.equal(evaluateExpression('10/4'), 2.5);
  assert.equal(evaluateExpression('2^10'), 1024);
  assert.equal(evaluateExpression('-5+3'), -2);
  assert.equal(evaluateExpression('7%3'), 1);
});

test('计算器：函数与常量', () => {
  assert.equal(evaluateExpression('sqrt(16)'), 4);
  assert.equal(evaluateExpression('max(1,5,3)'), 5);
  assert.equal(evaluateExpression('min(1,5,3)'), 1);
  assert.equal(evaluateExpression('pow(2,8)'), 256);
  assert.ok(Math.abs(evaluateExpression('pi') - Math.PI) < 1e-9);
  assert.ok(Math.abs(evaluateExpression('abs(-3.5)') - 3.5) < 1e-9);
});

test('计算器：拒绝危险输入', () => {
  assert.throws(() => evaluateExpression('alert(1)'));
  assert.throws(() => evaluateExpression('process.exit(1)'));
  assert.throws(() => evaluateExpression('1+'));
  assert.throws(() => evaluateExpression('(1+2'));
  assert.throws(() => evaluateExpression(''));
  assert.throws(() => evaluateExpression('1/0'));
});

test('文本工具协议解析', () => {
  const text = '我来查一下。\n```tool\n{"name":"web_search","arguments":{"query":"天气"}}\n```\n稍等。';
  const calls = parseTextToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'web_search');
  assert.deepEqual(calls[0].args, { query: '天气' });
});

test('文本工具协议支持多调用与字符串参数', () => {
  const text = '```tool\n{"name":"a","arguments":{"x":1}}\n```\n```tool\n{"name":"b","arguments":"{\\"y\\":2}"}\n```';
  const calls = parseTextToolCalls(text);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, { y: 2 });
});

test('文本工具协议忽略非法 JSON', () => {
  assert.equal(parseTextToolCalls('```tool\n{not json}\n```').length, 0);
  assert.equal(parseTextToolCalls('普通文本').length, 0);
});

test('正文提取：去脚本样式保留文本', () => {
  const html = `<html><head><title>标题A</title><style>x{}</style></head>
    <body><script>evil()</script><p>正文一</p><p>正文二</p></body></html>`;
  const r = extractReadable(html);
  assert.equal(r.title, '标题A');
  assert.ok(r.text.includes('正文一'));
  assert.ok(!r.text.includes('evil()'));
  assert.ok(!r.text.includes('x{}'));
});

test('正文提取：解码实体', () => {
  const r = extractReadable('<p>a &amp; b &lt;c&gt; &#65;</p>');
  assert.ok(r.text.includes('a & b <c> A'));
});

test('搜索结果格式化带编号', () => {
  const out = formatSearchResults([
    { title: '标题', link: 'https://a.com', snippet: '摘要', source: '站点', date: '2026-01-01' },
  ], 'q');
  assert.ok(out.includes('[1]'));
  assert.ok(out.includes('https://a.com'));
  assert.ok(out.includes('摘要'));
});

test('token 估算区分中英文', () => {
  assert.ok(estimateTokens('中文中文中文') >= 2);
  assert.ok(estimateTokens('a'.repeat(40)) <= 12);
  assert.ok(estimateTokens('') === 0);
});

test('消息 token 估算包含图片开销', () => {
  const a = estimateMessagesTokens([{ role: 'user', content: 'hi' }]);
  const b = estimateMessagesTokens([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }] }]);
  assert.ok(b > a);
});

test('上下文压缩保留最近轮次', async () => {
  const msgs = [
    { role: 'system', content: '系统提示' },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '内容'.repeat(200) })),
  ];
  const res = await compressToBudget(msgs, { budget: 800, keepRecent: 4 });
  assert.ok(res.messages[0].role === 'system', 'system 必须保留');
  assert.ok(res.messages.length < msgs.length, '应裁剪掉部分历史');
  assert.ok(res.dropped > 0);
});

test('上下文未超预算时不压缩', async () => {
  const msgs = [{ role: 'user', content: '短' }];
  const res = await compressToBudget(msgs, { budget: 10000 });
  assert.equal(res.dropped, 0);
  assert.equal(res.messages.length, 1);
});

test('摘要提示词包含角色标记', () => {
  const p = buildSummaryPrompt([{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }]);
  assert.ok(p.includes('用户'));
  assert.ok(p.includes('助手'));
});

test('RAG 上下文格式化与接地提示词', () => {
  const results = [{
    chunkId: 1, docId: 1, text: '正文内容', heading: '章节', score: 0.9,
    docTitle: '文档A', docKind: 'markdown', source: 'upload', docUrl: '',
  }];
  const ctx = formatContext(results);
  assert.ok(ctx.includes('[S1]'));
  assert.ok(ctx.includes('文档A'));
  const prompt = buildGroundedPrompt(ctx);
  assert.ok(prompt.includes('[S1]'));
  assert.ok(prompt.includes('不要编造'));
});
