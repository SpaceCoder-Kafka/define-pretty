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
    { label: '想借鉴什么', text: card.effect || '' },
    { label: '哪些设计关系要保留', text: card.instruction },
    { label: '什么情况下怎样调整', text: card.adaptation || '' },
    { label: '适合哪些组件和内容', text: card.applicability || '' },
  ].filter(section => section.text.trim());
}
export function featureInstruction(board: FeatureBoard): string {
  const cards = selectedFeatures(board);
  if (!cards.length) return '';
  return `请参考所附视觉特征卡片中的 ${cards.map((_, i) => i + 1).join('、')} 号特征润色现有界面。
图片中的编号与引线定位的是参考图中的出处，不是目标网页中的修改位置。未标注部分仅供理解上下文，不作为主动迁移目标。
先阅读“适合哪些组件和内容”，按现有组件的用途与内容结构匹配应用位置。以“想借鉴什么”为目标，保留“哪些设计关系要保留”中的要求，再按“什么情况下怎样调整”处理目标界面的差异。找不到合适对象时说明原因，不为套用特征新增业务模块。
卡片中的观察估计不是设计稿测量值；迁移建议范围是可调整的起点。保留现有业务内容、数据和交互功能，允许为可读性和布局完整做必要的协调调整。

${cards.map((card, index) => `${index + 1}. ${card.title}
${featureSections(card).map(section => `${section.label}：${section.text}`).join('\n')}${card.application.trim() ? `\n指定应用区域：${card.application.trim()}` : '\n应用区域：请根据上述组件用途与内容结构匹配现有界面。'}`).join('\n\n')}`;
}
