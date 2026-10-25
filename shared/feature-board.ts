import type { ModelConfig, ReferenceAsset, Usage } from './types.ts';

/** Normalized coordinates relative to the original image, not the displayed canvas. */
export interface FeatureRegion { x: number; y: number; width: number; height: number }
export interface FeatureCard {
  kind?: 'global' | 'local';
  discovery?: 'core' | 'detail';
  id: string; title: string; description: string; instruction: string;
  /** Optional for legacy cards. New generations include adaptation in instruction. */
  effect?: string; adaptation?: string; applicability?: string;
  region: FeatureRegion; selected: boolean; application: string;
}
export interface FeatureBoard {
  id: string; title: string; reference: ReferenceAsset; cards: FeatureCard[]; config: ModelConfig;
  revision: number; createdAt: string; updatedAt: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  generationMode?: 'core' | 'details'; parentBoardId?: string; addedDetails?: number;
  error?: string; usage?: Usage; exitCode?: number | null;
}
export const GLOBAL_STYLE_TITLE = '整体视觉风格';
export const FULL_IMAGE_REGION: FeatureRegion = { x: 0, y: 0, width: 1, height: 1 };
export function featureReady(card: FeatureCard): boolean {
  return card.kind !== 'global' || !!(card.effect?.trim() && card.instruction.trim() && card.applicability?.trim());
}
export function selectedFeatures(board: FeatureBoard): FeatureCard[] { return board.cards.filter(card => card.selected && featureReady(card)); }
export function featureApplication(card: FeatureCard): string {
  return card.application.trim() || (card.kind === 'global' ? '整页视觉协调；保留业务内容与功能，按目标页面的信息密度调整。' : '按组件用途匹配现有界面');
}
export function featureImplementation(card: FeatureCard): string {
  return [card.instruction, card.adaptation || ''].filter(text => text.trim()).join('\n\n');
}
export function featureSections(card: FeatureCard): { label: string; text: string }[] {
  return [
    { label: '1．带来什么效果', text: card.effect || '' },
    { label: '2．怎么实现', text: featureImplementation(card) },
    { label: '3．适合用在哪里', text: card.applicability || '' },
  ].filter(section => section.text.trim());
}
export function featureInstruction(board: FeatureBoard): string {
  const cards = selectedFeatures(board);
  if (!cards.length) return '';
  return `请参考所附视觉特征卡片中的 ${cards.map((_, i) => i + 1).join('、')} 号特征润色现有界面。
图片中的编号与引线定位的是参考图中的出处，不是目标网页中的修改位置。
${cards.some(card => card.kind === 'global') ? '已选中“整体视觉风格”：以该卡片的关键关系协调指定应用区域（未指定时为整页）的配色分配、形状语言、字体气质、疏密和层次；不要只给原界面贴上零散装饰。它不要求复刻参考图的业务或固定布局。局部卡片细化适用组件，遇到冲突先保留内容可读性与功能，再协调局部做法与整体风格，并说明取舍。未选择的局部卡片不因选择整体风格而自动成为逐项实施要求。' : '未选中“整体视觉风格”：仅迁移所选局部特征，其余画面仅作上下文，不主动套用整页风格。'}
先阅读“适合用在哪里”，按现有组件的用途与内容结构匹配应用位置，并遵守不适用条件。以“带来什么效果”为目标，按“怎么实现”中的规则实施，保留关键设计关系，并根据其中的条件调整尺寸、排列等属性。找不到合适对象时说明原因，不为套用特征新增业务模块。
布局迁移执行要求：仅当所选卡片涉及布局与空间关系时执行。先根据目标网页的内容用途，确定谁是主要内容、谁是补充内容，再将所选卡片中的主次、分组、面积、排列或叠放关系映射到这些内容；不要仅因某个现成组件容易修改就将它当作重点。遵守用户指定的应用区域；未指定时，以所选关系实际需要的范围为准，布局卡片可以作用于整页，不局限于参考图框选区域。允许移动模块、重新分组、改变栏数与面积比例，并调整 HTML 容器和 CSS 布局。保留业务内容、数据与交互功能，不要求保留原来的位置、排列或容器结构。用目标网页的内容实现参考关系，不照搬参考图的模块数量或业务信息。不能仅靠描边、阴影或几像素偏移代替所选布局关系；避免遮挡内容与操作，窄屏按阅读顺序适配。完成后对照所选关系检查实际页面，并简述主要内容与补充内容如何对应、结构发生了什么变化；原结构已经符合时可以保留，但须说明具体对应关系。不适用或未能验证的部分如实说明，不把页面能加载视为布局已实现。未选择布局相关规则时，不因此主动重排整页。
当所选规则要求像素、手写等特殊字形时，应先查找并验证可用的相近字体，通过 HTTPS 字体样式表或 @font-face 实际加载。“可以回退为普通粗体”只用于候选字体无法获取、缺字或明显不可读之后，不是默认实现。确认目标文字（尤其是中文）被覆盖，不能仅声明字体名称。若要求中文像素字形，可以先验证 Fusion Pixel 的简体中文候选 https://fusion-pixel-font.takwolf.com/fusion-pixel-12px-proportional-zh_hans.otf.woff2 ，仅用于合适的短标题；这不是原图字体识别结论，其他风格不要套用此候选。保留可读的回退字体。交付说明列出实际字体与来源；若最终回退，说明尝试过的候选和具体失败原因。没有完成字体加载与字形检查时，明确标注尚未验证，不把浏览器自动回退视为特殊字形已实现。
卡片中的观察估计不是设计稿测量值；迁移建议范围是可调整的起点。保留现有业务内容、数据和交互功能，允许为可读性和布局完整做必要的协调调整。

${cards.map((card, index) => `${index + 1}. ${card.title}
${featureSections(card).map(section => `${section.label}：${section.text}`).join('\n')}\n应用区域：${featureApplication(card)}`).join('\n\n')}`;
}
