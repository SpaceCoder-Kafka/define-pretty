import { styleGuideKey } from '../shared/style-guide.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import { DIMENSION_IDS, type ExperimentVersion, type ReferenceAsset } from '../shared/types.ts';
import { ADAPTATION_POLICY, COMMON_REFINEMENT, buildRunInput } from './prompts.ts';

const version: ExperimentVersion = {
  id: 'version', number: 1, createdAt: '2026-10-24', businessBrief: '固定业务需求 UNIQUE_BUSINESS_BRIEF', businessHash: 'business',
  config: { model: 'test-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'test-cli', concurrency: 2, timeoutMs: 1000 },
  dimensions: DEFAULT_DIMENSIONS.map(rule => ({ ...rule, instructions: `UNIQUE_RULE_${rule.id}` })), referenceId: 'reference',
};
const reference: ReferenceAsset = { id: 'reference', name: 'reference.png', mimeType: 'image/png', size: 1, sha256: 'hash', url: '/ref', createdAt: '2026-10-24' };

test('baseline sees only business requirements, never image metadata or design rules', () => {
  const input = buildRunInput(version, 'baseline', reference);
  assert.equal(input.reference, undefined);
  assert.equal(input.rules.length, 0);
  assert.match(input.prompt, /UNIQUE_BUSINESS_BRIEF/);
  for (const id of DIMENSION_IDS) assert.doesNotMatch(input.prompt, new RegExp(`UNIQUE_RULE_${id}`));
  assert.doesNotMatch(input.prompt, /reference\.png|referenceId|sha256/);
});

test('direct image control receives exactly the casual one-sentence prompt', () => {
  const input = buildRunInput(version, 'direct', reference, 'frozen-hash');
  assert.equal(input.reference?.id, reference.id);
  assert.equal(input.baselineHash, 'frozen-hash');
  assert.equal(input.prompt, 'website/ 中已有一份完整的项目管理网页。请参照所附参考图的风格润色这个网页。');
  assert.deepEqual(input.rules, []);
  for (const id of DIMENSION_IDS) assert.doesNotMatch(input.prompt, new RegExp(`UNIQUE_RULE_${id}`));
});

test('each experimental prompt carries exactly its selected rule and scope', () => {
  for (const selected of DIMENSION_IDS) {
    const input = buildRunInput(version, selected, reference, 'same-baseline');
    assert.deepEqual(input.rules.map(rule => rule.id), [selected]);
    assert.equal(input.reference?.id, reference.id);
    assert.equal(input.baselineHash, 'same-baseline');
    for (const id of DIMENSION_IDS) {
      if (id === selected) assert.match(input.prompt, new RegExp(`UNIQUE_RULE_${id}`));
      else assert.doesNotMatch(input.prompt, new RegExp(`UNIQUE_RULE_${id}`));
    }
  }
});

test('inputs are independent snapshots and reject missing references or empty rules', () => {
  const input = buildRunInput(version, 'color', reference);
  input.rules[0].instructions = 'changed';
  input.config.model = 'changed';
  assert.equal(version.dimensions.find(rule => rule.id === 'color')?.instructions, 'UNIQUE_RULE_color');
  assert.equal(version.config.model, 'test-model');
  assert.throws(() => buildRunInput(version, 'direct'), /参考/);
  const blank = structuredClone(version);
  blank.dimensions[0].instructions = '';
  assert.throws(() => buildRunInput(blank, 'layout', reference), /为空/);
});


test('all-rules sends all dimension text once; single and combination inputs never inherit legacy whole-page material', () => {
  const v = structuredClone(version);
  v.dimensions.unshift({ id: 'whole', title: '整页视觉重点', scope: 'GLOBAL_SCOPE', instructions: 'GLOBAL_ONLY_RULE' });
  v.styleGuide = { direction: 'LEGACY_DIRECTION', synthesis: 'LEGACY_SYNTHESIS', sourceKey: '', referenceId: reference.id };
  v.groups = [{ id: 'combo', title: '组合', dimensionIds: ['color', 'typography'] }];
  for (const group of ['color', 'typography', 'combo']) {
    const input = buildRunInput(v, group, reference);
    assert.doesNotMatch(input.prompt, /GLOBAL_ONLY_RULE|GLOBAL_SCOPE|LEGACY_DIRECTION|LEGACY_SYNTHESIS/);
    assert.equal(input.designBrief, undefined);
  }
  const full = buildRunInput(v, 'all-rules', reference, 'frozen-hash');
  assert.equal(full.rules.length, v.dimensions.length);
  assert.equal(full.designBrief, undefined);
  for (const rule of v.dimensions) assert.equal(full.prompt.split(rule.instructions).length - 1, 1);
  assert.equal(buildRunInput(v, 'whole', reference).rules.length, 1);
  assert.throws(() => buildRunInput(v, 'reference-constrained', reference), /不存在/);
});

test('new rule runs allow necessary adaptation even with legacy strict scopes, without rewriting saved rules or controls', () => {
  const legacy = structuredClone(version);
  legacy.dimensions[0].scope = '仅修改页面分区；不涉及区域内部组件。';
  legacy.dimensions[1].scope = '不改变导航栏背景。';
  legacy.groups = [{ id: 'combo', title: '组合', dimensionIds: legacy.dimensions.slice(0, 2).map(rule => rule.id) }];
  const before = structuredClone(legacy);
  for (const group of [legacy.dimensions[0].id, 'combo']) {
    const input = buildRunInput(legacy, group, reference, 'same-baseline');
    assert.ok(input.prompt.includes(ADAPTATION_POLICY));
    assert.ok(input.prompt.indexOf(ADAPTATION_POLICY) < input.prompt.indexOf('规范章节 1'));
    assert.doesNotMatch(input.prompt, /仅修改以上范围的并集|按以上顺序优先遵循前面的规范|不得主动重做范围外的设计/);
    assert.equal(input.rules[0].scope, before.dimensions[0].scope);
    assert.equal(input.baselineHash, 'same-baseline');
  }
  assert.deepEqual(legacy, before);
  for (const group of ['baseline', 'direct']) {
    assert.ok(!buildRunInput(legacy, group, reference).prompt.includes(ADAPTATION_POLICY));
  }
});
