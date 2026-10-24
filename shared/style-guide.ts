import type { DimensionRule, StyleGuide } from './types.ts';

// An exact source snapshot, not a security hash. IDs may change when adopting generated rules.
export function styleGuideKey(direction: string, dimensions: DimensionRule[]): string {
  return JSON.stringify({ direction, dimensions: dimensions.map(({ title, scope, instructions }) => ({ title, scope, instructions })) });
}
export function hasCurrentGuide(value: { dimensions: DimensionRule[]; styleGuide?: StyleGuide; referenceId?: string }): boolean {
  const guide = value.styleGuide;
  return Boolean(value.dimensions.length && guide?.direction.trim() && guide.synthesis.trim() && (!value.referenceId || guide.referenceId === value.referenceId) && guide.sourceKey === styleGuideKey(guide.direction, value.dimensions));
}
