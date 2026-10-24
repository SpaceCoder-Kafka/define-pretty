import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSpecification } from './spec-format.ts';
import { buildRunInput } from './prompts.ts';
import type { ExperimentVersion, ReferenceAsset } from '../shared/types.ts';

const dimension = {
  title: '文字层级', scope: '页面标题和正文，允许容器高度适配。', purpose: '区分页面标题与正文。',
  tokens: [{ name: 'type.body.size', value: '14px', usage: '正文' }],
  rules: ['正文必须使用 type.body.size。'], states: [],
  adaptations: ['当标题换行时，容器应增高以容纳完整标题。'], checks: ['长标题不与后续模块重叠。'],
  observations: 'OBSERVATION_ONLY：截图中的原始字号无法确定，14px 是迁移决策。',
};
const parse = (value: unknown) => parseSpecification(JSON.stringify({ dimensions: [value] }), 'generation');

test('structured sections become executable rules; observation notes never enter saved or composed run inputs', () => {
  const result = parse(dimension);
  const rule = result.dimensions[0];
  for (const content of ['14px', '正文必须使用', '当标题换行时', '长标题不与后续模块重叠']) assert.ok(rule.instructions.includes(content));
  assert.match(rule.instructions, /不适用/);
  assert.match(result.observations[0].notes, /OBSERVATION_ONLY/);
  assert.equal(result.observations[0].dimensionId, rule.id);
  const config = { model: 'test', reasoningEffort: 'high', cliVersion: 'test', concurrency: 1, timeoutMs: 1000 };
  const other = { ...rule, id: 'other', title: '另一维度', instructions: 'OTHER_RULE' };
  const version: ExperimentVersion = { id: 'v', number: 1, createdAt: '', businessBrief: '', businessHash: '', config,
    dimensions: [rule, other], groups: [{ id: 'combo', title: '组合', dimensionIds: [rule.id, 'other'] }] };
  const ref: ReferenceAsset = { id: 'ref', name: 'ref.png', mimeType: 'image/png', size: 1, sha256: '', url: '', createdAt: '' };
  for (const group of [rule.id, 'combo']) {
    const input = buildRunInput(version, group, ref);
    assert.doesNotMatch(JSON.stringify(input), /OBSERVATION_ONLY/);
    assert.ok(input.prompt.includes(rule.instructions));
  }
  assert.doesNotMatch(buildRunInput(version, rule.id, ref).prompt, /OTHER_RULE/);
});

test('paragraph-only output and incomplete sections are rejected, not accepted as specifications', () => {
  assert.throws(() => parse({ title: '笔记', scope: '页面', instructions: '截图采用暖色，建议适当调整。' }), /无效/);
  for (const field of ['rules', 'adaptations', 'checks', 'tokens']) {
    assert.throws(() => parse({ ...dimension, [field]: [] }), /无效/);
  }
  assert.throws(() => parse({ ...dimension, rules: '一整段散文。' }), /分条规范/);
  assert.throws(() => parse({ ...dimension, tokens: [dimension.tokens[0], dimension.tokens[0]] }), /重复/);
  assert.throws(() => parse({ ...dimension, observations: null }), /observations 无效/);
  assert.throws(() => parse({ ...dimension, states: [null] }), /states 无效/);
});
