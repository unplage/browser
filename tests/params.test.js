import { test } from 'node:test';
import assert from 'node:assert/strict';
import { negotiateParams, contextWindow, effectiveMaxOutput } from '../src/llm/params.js';
import { resolveModel } from '../src/llm/catalog.js';
import { DEFAULT_PROVIDERS } from '../src/llm/providers.js';

const zhipu = DEFAULT_PROVIDERS.find(p => p.id === 'zhipu');
const openai = DEFAULT_PROVIDERS.find(p => p.id === 'openai');
const deepseek = DEFAULT_PROVIDERS.find(p => p.id === 'deepseek');

test('max_tokens 被夹取到模型真实上限（修复 glm-4.6v-flash 400）', () => {
  const { params, notes } = negotiateParams(zhipu, 'glm-4.6v-flash', { max_tokens: 131072 });
  assert.equal(params.max_tokens, 32768, '应从 131072 夹取到 32768');
  assert.ok(notes.some(n => n.includes('max_tokens')));
});

test('默认 max_tokens 不超过模型上限', () => {
  for (const model of ['glm-4.7-flash', 'glm-4.6v-flash', 'glm-5.3']) {
    const { params } = negotiateParams(zhipu, model);
    assert.ok(params.max_tokens <= effectiveMaxOutput(model), `${model} 的 max_tokens 超出上限`);
  }
});

test('OpenAI 推理模型改用 max_completion_tokens（修复 o3 400）', () => {
  const { params } = negotiateParams(openai, 'o3');
  assert.equal(params.max_completion_tokens, 4096);
  assert.equal(params.max_tokens, undefined);
});

test('OpenAI 推理模型忽略自定义 temperature / top_p', () => {
  const { params, notes } = negotiateParams(openai, 'o4-mini', { temperature: 0.3, top_p: 0.5 });
  assert.equal(params.temperature, undefined);
  assert.equal(params.top_p, undefined);
  assert.ok(notes.some(n => n.includes('temperature')));
});

test('thinking 按协议整形：Zhipu/DeepSeek 用 {type:enabled}', () => {
  const z = negotiateParams(zhipu, 'glm-4.7-flash');
  assert.deepEqual(z.params.thinking, { type: 'enabled' });
  const d = negotiateParams(deepseek, 'deepseek-v4-pro');
  assert.deepEqual(d.params.thinking, { type: 'enabled' }, 'DeepSeek 同样需要对象形式');
});

test('thinking 关闭时为 {type:disabled}', () => {
  const z = negotiateParams(zhipu, 'glm-4.7-flash', { thinking: false });
  assert.deepEqual(z.params.thinking, { type: 'disabled' });
});

test('不支持思考的模型不发送 thinking', () => {
  const { params } = negotiateParams(openai, 'gpt-4o');
  assert.equal(params.thinking, undefined);
});

test('Anthropic 协议使用 budget_tokens', () => {
  const anthropic = { ...DEFAULT_PROVIDERS.find(p => p.id === 'anthropic') };
  const { params } = negotiateParams(anthropic, 'claude-sonnet-4-5', { thinking: true });
  assert.equal(params.thinking.type, 'enabled');
  assert.ok(params.thinking.budget_tokens > 0);
});

test('reasoning_effort 仅在模型支持时发送', () => {
  const { params } = negotiateParams(deepseek, 'deepseek-v4-pro');
  assert.equal(params.reasoning_effort, 'high');
  const z = negotiateParams(zhipu, 'glm-4.7-flash');
  assert.equal(z.params.reasoning_effort, undefined, 'glm-4.7 不支持 reasoning_effort');
});

test('不支持的参数不会被发送', () => {
  const { params } = negotiateParams(openai, 'gpt-4o');
  assert.equal(params.do_sample, undefined);
  assert.equal(params.frequency_penalty, undefined);
});

test('上下文窗口解析', () => {
  assert.equal(contextWindow(zhipu, 'glm-4.7-flash'), 200000);
  assert.ok(contextWindow(openai, 'gpt-4o') > 100000);
});

test('最大输出查询', () => {
  assert.equal(effectiveMaxOutput('glm-4.6v-flash'), 32768);
  assert.equal(effectiveMaxOutput('gpt-4o'), 16384);
});

test('模型能力目录：视觉 / 工具 / 思考', () => {
  assert.equal(resolveModel('glm-4.6v-flash').vision, true);
  assert.equal(resolveModel('glm-4.7-flash').vision, false);
  assert.equal(resolveModel('gpt-4o').vision, true);
  assert.equal(resolveModel('o3').reasoning, true);
  assert.equal(resolveModel('unknown-model-x').vision, false);
});

test('未知模型走保守默认值', () => {
  const m = resolveModel('some-random-model');
  assert.equal(m.source, 'inferred');
  assert.ok(m.maxOutput > 0);
  assert.ok(m.context > 0);
});
