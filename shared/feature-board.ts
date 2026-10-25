import type { ModelConfig, ReferenceAsset, Usage } from './types.ts';
import type { LayoutDiagram } from './layout-diagram.ts';

/** Normalized coordinates relative to the original image, not the displayed canvas. */
export interface FeatureRegion { x: number; y: number; width: number; height: number }
export interface FeatureCard {
  kind?: 'global' | 'layout' | 'local';
  layout?: LayoutDiagram;
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
  if (card.kind === 'layout' && !card.layout) return false;
  return (card.kind !== 'global' && card.kind !== 'layout') || !!(card.effect?.trim() && card.instruction.trim() && card.applicability?.trim());
}
export function selectedFeatures(board: FeatureBoard): FeatureCard[] { return board.cards.filter(card => card.selected && featureReady(card)); }
export function featureApplication(card: FeatureCard): string {
  return card.application.trim() || (card.kind === 'global' ? '整页视觉风格协调；保留业务内容与功能。' : card.kind === 'layout' ? '按所选布局关系重组适用内容，可作用于整页。' : '按内容用途与所选关系确定应用范围');
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
  const global = cards.some(card => card.kind === 'global');
  const layout = cards.some(card => card.kind === 'layout');
  return `请依据所附视觉特征卡片中的 ${cards.map((_, i) => i + 1).join('、')} 号特征${layout ? '按所选布局重组目标界面，并落实其他已选视觉特征' : '优化目标界面中适用的内容与组件'}。
图片中的编号与引线定位的是参考图中的出处，不是目标网页中的修改位置。
${layout ? '已选中布局结构卡：用户已认可卡片展示的布局关系，直接按这套结构实施，无需再提供布局候选或要求用户二次选择。先辨认目标页面主要内容与补充内容，再按比例色块和卡片规则重新组织分组、分栏、面积、阅读顺序与叠放关系。在应用范围内可大胆重构 HTML 容器与 CSS，不以保留原有布局或改动最少为目标。先落实结构，再完善其他已选视觉效果。' : '未选中布局结构卡：不因为整体风格、配色、字体或装饰要求而默认重排整页。历史专项卡若明确描述布局关系，仍按其明确规则与应用范围迁移，不因缺少类型标记而忽略。'}
${global ? '已选中“整体视觉风格”：协调指定应用区域（未指定时为整页）的配色、文字、形状、表面与视觉权重，保持关键风格关系。整体风格卡不代替布局结构卡的选择；其中历史的泛化布局措辞不自动成为整页重排要求。若同时选择布局结构卡，结构以布局卡为准。未选择的专项卡片不因选择整体风格而自动成为逐项实施要求。' : '未选中“整体视觉风格”：仅迁移所选特征，其余画面仅作上下文，不主动套用整页风格。'}
先阅读“适合用在哪里”，按目标内容的用途确定应用位置，并遵守不适用条件。以“带来什么效果”为目标，按“怎么实现”中的规则实施，保留关键设计关系，并根据其中的条件调整尺寸、排列等属性。找不到合适对象时说明原因，不为套用特征新增业务模块。
布局迁移执行要求（仅适用于已选布局卡或历史专项中明确的结构规则）：先根据目标内容用途，将主要与补充内容映射到卡片中的角色；不要仅因某个现成组件容易修改就将它当作重点。遵守用户指定的应用区域，范围之外仅做必要的衔接调整；未指定时，以所选关系实际需要的范围为准，布局卡片可以作用于整页，不局限于参考图框选区域。允许移动模块、重新分组、改变栏数与面积比例，调整 HTML 容器和 CSS 布局。原来的位置、排列与容器边界不是约束。用目标页面的真实内容实现参考关系，不照搬参考图的业务模块数量、文案或数据。不能仅靠描边、阴影或几像素偏移代替所选布局关系；避免遮挡内容与操作，窄屏按阅读顺序适配。完成后对照所选关系检查实际页面，并简述主要与补充内容如何对应、结构发生了什么变化、哪些功能已验证。不适用或未能验证的部分如实说明，不把页面能加载视为布局已实现。
布局结构落实后，再处理特殊字形：当所选规则要求像素、手写等特殊字形时，应查找并验证可用的相近字体，通过 HTTPS 字体样式表或 @font-face 实际加载。“可以回退为普通粗体”只用于候选字体无法获取、缺字或明显不可读之后，不是默认实现。确认目标文字（尤其是中文）被覆盖，不能仅声明字体名称。若要求中文像素字形，可以先验证 Fusion Pixel 的简体中文候选 https://fusion-pixel-font.takwolf.com/fusion-pixel-12px-proportional-zh_hans.otf.woff2 ，仅用于合适的短标题；这不是原图字体识别结论，其他风格不要套用此候选。保留可读的回退字体。交付说明列出实际字体与来源；若最终回退，说明尝试过的候选和具体失败原因。没有完成字体加载与字形检查时，明确标注尚未验证，不把浏览器自动回退视为特殊字形已实现。
卡片中的观察估计不是设计稿测量值；迁移建议范围是可调整的起点。保留现有业务内容、数据和交互功能，允许为可读性和布局完整做必要的协调调整。

${cards.map((card, index) => `${index + 1}. ${card.title}
${featureSections(card).map(section => `${section.label}：${section.text}`).join('\n')}${card.kind === 'layout' && card.layout ? `\n布局比例示意（观察估计；色块顺序从后到前，坐标和尺寸相对示意画布，保留关系并适配目标内容）：\n${JSON.stringify(card.layout)}` : ''}\n应用区域：${featureApplication(card)}`).join('\n\n')}`;
}
