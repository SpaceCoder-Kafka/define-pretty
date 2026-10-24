import type { ModelConfig, ReferenceAsset, Usage } from './types.ts';

/** Normalized coordinates relative to the original image, not the displayed canvas. */
export interface FeatureRegion { x: number; y: number; width: number; height: number }
export interface FeatureCard {
  id: string; title: string; description: string; instruction: string;
  region: FeatureRegion; selected: boolean; application: string;
}
export interface FeatureBoard {
  id: string; title: string; reference: ReferenceAsset; cards: FeatureCard[]; config: ModelConfig;
  revision: number; createdAt: string; updatedAt: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string; usage?: Usage; exitCode?: number | null;
}
export function selectedFeatures(board: FeatureBoard): FeatureCard[] { return board.cards.filter(card => card.selected); }
export function featureInstruction(board: FeatureBoard): string {
  const cards = selectedFeatures(board);
  if (!cards.length) return '';
  return `请参考所附视觉特征卡片中的 ${cards.map((_, i) => i + 1).join('、')} 号特征润色现有界面。\n图片中的编号与引线定位的是参考图中的出处，不是目标网页中的修改位置。未标注部分仅供理解上下文，不作为主动迁移目标。\n保留现有业务内容、数据和交互功能，允许为可读性和布局完整做必要的协调调整。\n\n${cards.map((card, index) => `${index + 1}. ${card.title}\n${card.instruction}${card.application.trim() ? `\n应用对象：${card.application.trim()}` : '\n应用对象：请结合现有界面的组件角色选择适合的位置。'}`).join('\n\n')}`;
}
