import { el, field, input, textarea, select } from './dom.js';
import { openModal } from './modal.js';
import { resolveModel } from '../llm/catalog.js';

/* ─── 模块编辑 / 创建 ─── */

export function openModuleEditor(module, providers, onSave, extra = {}) {
  const body = el('div', { class: 'module-editor' });
  const isCustom = !extra.defaultIds?.includes(module.id);

  const state = {
    title: module.title || '',
    icon: module.icon || '📦',
    group: module.group || '默认',
    providerId: module.providerId || providers[0]?.id || 'zhipu',
    model: module.model || '',
    systemPrompt: module.systemPrompt || '',
  };

  const providerSel = select(
    providers.map(p => ({ value: p.id, label: p.name + (p.apiKey ? '' : '（未配置 Key）') })),
    state.providerId,
    v => {
      state.providerId = v;
      const p = providers.find(x => x.id === v);
      const m = resolveModel(p?.defaultModel || '');
      state.model = p?.defaultModel || '';
      modelInput.value = state.model;
      renderModelHint(m);
    },
    { id: 'modProvider' },
  );

  const titleInput = input(state.title, v => { state.title = v; }, { id: 'modTitle' });
  const iconInput = el('input', { class: 'ui-input', value: state.icon, maxlength: 4, id: 'modIcon' });
  iconInput.addEventListener('input', () => { state.icon = iconInput.value; });
  const groupInput = input(state.group, v => { state.group = v; }, { id: 'modGroup' });
  const modelInput = el('input', { class: 'ui-input', value: state.model, placeholder: '留空则使用 Provider 默认模型', id: 'modModel' });
  modelInput.addEventListener('input', () => { state.model = modelInput.value; });

  const modelHint = el('div', { class: 'model-hint' });
  function renderModelHint(m) {
    clearHint();
    modelHint.appendChild(el('div', { text: `上下文 ${m.context} · 最大输出 ${m.maxOutput}${m.source === 'inferred' ? '（推断值）' : ''}` }));
    modelHint.appendChild(el('div', { text: `视觉 ${m.vision ? '✅' : '❌'}　工具 ${m.tools ? '✅' : '❌'}　思考 ${m.reasoning ? '✅' : '❌'}` }));
  }
  function clearHint() { while (modelHint.firstChild) modelHint.removeChild(modelHint.firstChild); }
  modelInput.addEventListener('input', () => renderModelHint(resolveModel(modelInput.value)));
  renderModelHint(resolveModel(state.model));

  const promptArea = textarea(state.systemPrompt, v => { state.systemPrompt = v; }, { rows: 12, id: 'modPrompt' });

  body.appendChild(el('div', { class: 'editor-grid' }, [
    field('模块名称', titleInput),
    field('图标', iconInput),
    field('分组', groupInput, '同组模块在侧边栏归拢显示'),
  ]));
  body.appendChild(field('API 服务商', providerSel));
  body.appendChild(field('模型', modelInput));
  body.appendChild(modelHint);
  body.appendChild(field('系统提示词', promptArea, '定义该模块的身份、专长与输出格式'));

  const footer = el('div', { class: 'modal-footer-row' });
  const cancel = el('button', { class: 'ui-btn', onclick: () => m.close() }, '取消');
  const preset = el('button', { class: 'ui-btn', onclick: () => extra.onSavePreset?.({ ...state }) }, '📋 存为预设');
  const reset = el('button', {
    class: 'ui-btn',
    onclick: () => {
      const p = extra.getDefaultPrompt?.(module.id);
      if (p) { promptArea.value = p; state.systemPrompt = p; }
    },
  }, '↺ 恢复默认');
  const save = el('button', { class: 'ui-btn ui-btn-primary' }, '保存');
  footer.appendChild(cancel);
  if (!isCustom) footer.appendChild(reset);
  footer.appendChild(preset);
  footer.appendChild(save);

  const m = openModal({ title: `✏️ 编辑模块：${module.title || ''}`, body, footer, size: 'lg' });

  save.onclick = async () => {
    if (!state.title.trim()) { m.close(); return; }
    await onSave(module.id, { ...state });
    m.close();
  };

  return m;
}

export function openCreateModule(providers, onCreate) {
  const body = el('div', { class: 'module-editor' });
  const state = {
    title: '', icon: '🤖', group: '默认',
    providerId: providers[0]?.id || 'zhipu', model: '', systemPrompt: '',
  };

  const providerSel = select(
    providers.map(p => ({ value: p.id, label: p.name + (p.apiKey ? '' : '（未配置 Key）') })),
    state.providerId,
    v => {
      state.providerId = v;
      const p = providers.find(x => x.id === v);
      state.model = p?.defaultModel || '';
      modelInput.value = state.model;
    },
    { id: 'newModProvider' },
  );
  const titleInput = input(state.title, v => { state.title = v; }, { id: 'newModTitle' });
  titleInput.setAttribute('autofocus', 'autofocus');
  const iconInput = el('input', { class: 'ui-input', value: state.icon, maxlength: 4, id: 'newModIcon' });
  iconInput.addEventListener('input', () => { state.icon = iconInput.value; });
  const groupInput = input(state.group, v => { state.group = v; }, { id: 'newModGroup' });
  const modelInput = el('input', { class: 'ui-input', value: '', id: 'newModModel' });
  modelInput.addEventListener('input', () => { state.model = modelInput.value; });
  const promptArea = textarea('', v => { state.systemPrompt = v; }, { rows: 12, id: 'newModPrompt', placeholder: '定义该模块的身份、专长与输出格式…' });

  body.appendChild(el('div', { class: 'editor-grid' }, [
    field('模块名称', titleInput),
    field('图标', iconInput),
    field('分组', groupInput),
  ]));
  body.appendChild(field('API 服务商', providerSel));
  body.appendChild(field('模型', modelInput));
  body.appendChild(field('系统提示词', promptArea));

  const footer = el('div', { class: 'modal-footer-row' }, [
    el('button', { class: 'ui-btn', onclick: () => m.close() }, '取消'),
    el('button', { class: 'ui-btn ui-btn-primary', onclick: () => {
      if (!state.title.trim()) { titleInput.focus(); return; }
      onCreate({ ...state });
      m.close();
    } }, '✨ 创建模块'),
  ]);

  const m = openModal({ title: '➕ 创建自定义模块', body, footer, size: 'lg' });
  return m;
}
