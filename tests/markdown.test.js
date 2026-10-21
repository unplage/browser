import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, markdownToText, hasCodeBlock } from '../src/core/markdown.js';

test('代码块生成 pre/code 且保留原始字符', () => {
  const html = renderMarkdown('```js\nif (a < b && c > d) { return "x"; }\n```');
  assert.match(html, /<pre class="md-code">/);
  assert.match(html, /<code class="language-js">/);
  assert.match(html, /a &lt; b &amp;&amp; c &gt; d/);
  assert.doesNotMatch(html, /&amp;lt;/, '不应发生二次转义');
});

test('代码块内的 ** 不会被解析为粗体', () => {
  const html = renderMarkdown('```py\nx = **kwargs\n```');
  assert.match(html, /x = \*\*kwargs/);
  assert.doesNotMatch(html, /<strong>/);
});

test('无语言围栏也能解析', () => {
  const html = renderMarkdown('```\nplain\n```');
  assert.match(html, /<pre class="md-code"><code>plain/);
});

test('支持无序列表与嵌套', () => {
  const html = renderMarkdown('- 第一项\n- 第二项\n  - 嵌套项\n- 第三项');
  assert.match(html, /<ul class="md-list md-list-ul">/);
  assert.match(html, /<li>/);
  assert.match(html, /嵌套项/);
});

test('支持有序列表', () => {
  const html = renderMarkdown('1. 第一步\n2. 第二步');
  assert.match(html, /<ol class="md-list md-list-ol">/);
  assert.match(html, /第一步/);
});

test('支持 GFM 表格', () => {
  const html = renderMarkdown('| 列A | 列B |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th[^>]*>列A<\/th>/);
  assert.match(html, /<td[^>]*>1<\/td>/);
});

test('支持标题、引用、分隔线', () => {
  assert.match(renderMarkdown('## 标题'), /<h2 class="md-h md-h2">标题<\/h2>/);
  assert.match(renderMarkdown('> 引用内容'), /<blockquote class="md-quote">/);
  assert.match(renderMarkdown('---'), /<hr class="md-hr">/);
});

test('链接渲染为可点击且新窗口打开', () => {
  const html = renderMarkdown('[示例](https://example.com/a?x=1&y=2)');
  assert.match(html, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">示例<\/a>/);
});

test('裸 URL 自动链接', () => {
  const html = renderMarkdown('访问 https://example.com/page 看看');
  assert.match(html, /<a href="https:\/\/example\.com\/page"/);
});

test('危险协议被拒绝', () => {
  const html = renderMarkdown('[点我](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/i);
});

test('原始 HTML 被转义', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test('引用角标 [S1] 渲染为 cite 元素', () => {
  const html = renderMarkdown('结论如 [S1] 所示');
  assert.match(html, /<span class="md-cite" data-cite="S1"/);
});

test('粗体 / 斜体 / 删除线', () => {
  assert.match(renderMarkdown('**粗**'), /<strong>粗<\/strong>/);
  assert.match(renderMarkdown('*斜*'), /<em>斜<\/em>/);
  assert.match(renderMarkdown('~~删~~'), /<del>删<\/del>/);
});

test('行内代码不被强调规则破坏', () => {
  const html = renderMarkdown('使用 `a * b` 计算');
  assert.match(html, /<code>a \* b<\/code>/);
  assert.doesNotMatch(html, /<em>/);
});

test('markdownToText 提取纯文本', () => {
  const t = markdownToText('# 标题\n\n**粗体** 与 [链接](https://a.com)');
  assert.match(t, /标题/);
  assert.match(t, /粗体/);
  assert.match(t, /链接/);
  assert.doesNotMatch(t, /#/);
});

test('hasCodeBlock 判定', () => {
  assert.equal(hasCodeBlock('```\nx\n```'), true);
  assert.equal(hasCodeBlock('没有代码'), false);
});

test('空输入安全', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});
