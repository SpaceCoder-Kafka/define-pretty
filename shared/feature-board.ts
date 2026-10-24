import type { ModelConfig, ReferenceAsset, Usage } from './types.ts';

/** Normalized coordinates relative to the original image, not the displayed canvas. */
export interface FeatureRegion { x: number; y: number; width: number; height: number }
export interface FeatureCard {
  id: string; title: string; description: string; instruction: string;
  /** Optional for legacy cards; new generations supply all three fields. */
  effect?: string; adaptation?: string; applicability?: string;
  region: FeatureRegion; selected: boolean; application: string;
}
export interface FeatureBoard {
  id: string; title: string; reference: ReferenceAsset; cards: FeatureCard[]; config: ModelConfig;
  revision: number; createdAt: string; updatedAt: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string; usage?: Usage; exitCode?: number | null;
}
export function selectedFeatures(board: FeatureBoard): FeatureCard[] { return board.cards.filter(card => card.selected); }
export function featureSections(card: FeatureCard): { label: string; text: string }[] {
  return [
    { label: '视觉效果', text: card.effect || '' },
    { label: '保留关系', text: card.instruction },
    { label: '适配方式', text: card.adaptation || '' },
    { label: '适用对象', text: card.applicability || '' },
  ].filter(section => section.text.trim());
}
export function featureInstruction(board: FeatureBoard): string {
  const cards = selectedFeatures(board);
  if (!cards.length) return '';
  return `请参考所附视觉特征卡片中的 ${cards.map((_, i) => i + 1).join('、')} 号特征润色现有界面。
图片中的编号与引线定位的是参考图中的出处，不是目标网页中的修改位置。未标注部分仅供理解上下文，不作为主动迁移目标。
先根据适用对象和现有组件的用途匹配应用位置，再保留所选特征的关键视觉关系，按适配方式调整。找不到合适对象时说明原因，不为套用特征新增业务模块。
卡片中的观察估计不是设计稿测量值；迁移建议范围是可调整的起点。保留现有业务内容、数据和交互功能，允许为可读性和布局完整做必要的协调调整。

${cards.map((card, index) => `${index + 1}. ${card.title}
${featureSections(card).map(section => `${section.label}：${section.text}`).join('\n')}${card.application.trim() ? `\n指定应用区域：${card.application.trim()}` : '\n应用区域：请按上述适用对象匹配现有界面。'}`).join('\n\n')}`;
}
