import type { DimensionRule, ExperimentGroup, ExperimentVersion } from './types.ts';

export function experimentGroups(version: Pick<ExperimentVersion, 'dimensions' | 'groups'>): ExperimentGroup[] {
  return [
    { id: 'baseline', title: '原始网页', dimensionIds: [] },
    { id: 'direct', title: '直接参考图', dimensionIds: [] },
    { id: 'all-rules', title: '参考图+文字规范', dimensionIds: version.dimensions.map(rule => rule.id) },
    ...version.dimensions.map(rule => ({ id: rule.id, title: rule.title, dimensionIds: [rule.id] })),
    ...(version.groups ?? []),
  ];
}
export function groupRules(version: Pick<ExperimentVersion, 'dimensions' | 'groups'>, groupId: string): DimensionRule[] {
  const group = experimentGroups(version).find(item => item.id === groupId);
  if (!group) throw new Error('实验组不存在。');
  return group.dimensionIds.map(id => {
    const rule = version.dimensions.find(item => item.id === id);
    if (!rule) throw new Error('实验组引用的维度不存在。');
    return rule;
  });
}
