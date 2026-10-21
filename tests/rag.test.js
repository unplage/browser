import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, outline } from '../src/rag/chunk.js';
import { tokenize, buildBm25Index, bm25Search, rrfFuse, similarity } from '../src/rag/bm25.js';
import { quantize, dequantize, cosine, cosineQuantized, topKSimilar } from '../src/rag/vector.js';
import { cleanText, detectKind, isTextFile } from '../src/rag/ingest.js';

test('分块保留标题路径', () => {
  const text = `# 第一章

内容一。

## 第二节

内容二，内容二，内容二，内容二，内容二，内容二，内容二。
`;
  const chunks = chunkText(text, { targetTokens: 30, overlapTokens: 0, minTokens: 1 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.some(c => c.heading.includes('第一章')), `实际标题: ${chunks.map(c => c.heading).join(' | ')}`);
  assert.ok(chunks.some(c => c.heading.includes('第二节')), `实际标题: ${chunks.map(c => c.heading).join(' | ')}`);
});

test('分块按长度切分且 ord 连续', () => {
  const long = '这是一段很长的测试文本。'.repeat(400);
  const chunks = chunkText(long, { targetTokens: 100, maxTokens: 200, overlapTokens: 20, minTokens: 1 });
  assert.ok(chunks.length > 1);
  chunks.forEach((c, i) => assert.equal(c.ord, i));
  assert.ok(chunks.every(c => c.text.length > 0));
});

test('超长单段会被切句', () => {
  const text = '句子一。句子二。句子三。'.repeat(300);
  const chunks = chunkText(text, { targetTokens: 80, maxTokens: 120, overlapTokens: 0, minTokens: 1 });
  assert.ok(chunks.length > 3);
});

test('空输入安全', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(null), []);
});

test('中文分词产出单字与二元组', () => {
  const t = tokenize('大分子药物');
  assert.ok(t.includes('大'));
  assert.ok(t.includes('分子'));
});

test('英文分词小写化', () => {
  assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
});

test('BM25 能召回相关文档', () => {
  const docs = [
    { id: 1, text: '单克隆抗体药物研发与临床试验', heading: '' },
    { id: 2, text: '巴赫的平均律与赋格曲式分析', heading: '' },
    { id: 3, text: '对抗体的 ADC 偶联工艺与 Payload 优化', heading: '' },
  ];
  const idx = buildBm25Index(docs);
  const hits = bm25Search(idx, '抗体 ADC 偶联', 5);
  assert.ok(hits.length > 0);
  assert.ok([1, 3].includes(hits[0].id), '应优先召回抗体相关文档');
});

test('BM25 无匹配时返回空', () => {
  const idx = buildBm25Index([{ id: 1, text: '完全无关内容' }]);
  assert.equal(bm25Search(idx, '量子纠缠 拓扑绝缘体').length, 0);
});

test('RRF 融合多路排序', () => {
  const fused = rrfFuse([
    [{ id: 1 }, { id: 2 }],
    [{ id: 2 }, { id: 3 }],
  ]);
  assert.equal(fused[0].id, 2, '两路都命中的应排第一');
  assert.ok(fused.length === 3);
});

test('向量量化与反量化保持近似', () => {
  const v = [0.1, -0.25, 0.9, 0.02];
  const { q, scale } = quantize(v);
  const back = dequantize(q, scale);
  assert.equal(back.length, v.length);
  back.forEach((x, i) => assert.ok(Math.abs(x - v[i]) < 0.02));
});

test('余弦相似度计算正确', () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-6);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-6);
  assert.ok(cosine([1, 0], [0.9, 0.1]) > 0.98);
});

test('量化向量余弦与原向量一致', () => {
  const a = [0.3, 0.4, 0.5];
  const b = [0.31, 0.39, 0.52];
  const qa = quantize(a); const qb = quantize(b);
  const d = Math.abs(cosine(a, b) - cosineQuantized(qa.q, qb.q));
  assert.ok(d < 0.02, `差异过大: ${d}`);
});

test('topK 相似检索排序正确', () => {
  const vectors = [
    { chunkId: 1, q: quantize([1, 0, 0]).q },
    { chunkId: 2, q: quantize([0, 1, 0]).q },
    { chunkId: 3, q: quantize([0.99, 0.05, 0]).q },
  ];
  const hits = topKSimilar(vectors, [1, 0, 0], 2);
  assert.equal(hits[0].id, 1);
  assert.equal(hits.length, 2);
});

test('HTML 清洗去标签保留段落', () => {
  const html = '<div><p>第一段</p><script>bad()</script><p>第二段</p></div>';
  const text = cleanText(html, 'html');
  assert.ok(text.includes('第一段'));
  assert.ok(text.includes('第二段'));
  assert.ok(!text.includes('bad()'));
});

test('文件类型识别', () => {
  assert.equal(detectKind('a.md'), 'markdown');
  assert.equal(detectKind('a.json'), 'data');
  assert.equal(detectKind('a.py'), 'code');
  assert.equal(detectKind('a.html'), 'html');
  assert.equal(isTextFile('a.txt'), true);
  assert.equal(isTextFile('a.exe'), false);
});

test('相似度计算', () => {
  assert.ok(similarity('大分子药物', '大分子药物研发') > 0.3);
  assert.ok(similarity('完全不同的内容', '毫无关系的东西') < 0.1);
});
