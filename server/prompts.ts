import { groupRules } from '../shared/groups.ts';
import type { ExperimentVersion, GroupId, ReferenceAsset, RunInput } from '../shared/types.ts';

/** A stable, non-visual contract lets the same smoke tests exercise every page. */
export const PAGE_CONTRACT = `
交付约束：
1. 只修改当前工作目录内 website/ 下的文件。入口必须为 website/index.html。
2. 使用静态 HTML、CSS、普通 JavaScript 和本地资源。不要使用框架、构建步骤、CDN、远程字体、网络请求、模块脚本或第三方接口。
3. 所有文件引用必须使用相对路径。脚本使用普通 script 标签，不能依赖 localStorage、Cookie 或同源父页面。
4. 数据必须固定。不要使用随机数据或当前日期。不要安装依赖、启动长期服务、访问外部连接器或读取工作目录之外的文件。
5. 为功能验证保留下列不可见的测试标记。这些标记不要求任何视觉样式：
   - 主内容容器：data-testid="dashboard"。
   - 任务搜索输入框：data-testid="search"。输入标题关键字过滤任务，清空恢复所有任务。
   - 原生 select 状态筛选器：data-testid="status-filter"。全部选项 value="all"，其他选项的 value 与任务 data-status 一致。
   - 每个任务元素：data-testid="task-row"，以及唯一 data-task-id、完整标题 data-title、状态 data-status。使用 hidden 或 display:none 隐藏被筛选的任务，不能仅降低透明度。
   - 每条任务的详情按钮：data-testid="primary-action"。点击后打开 data-testid="details-dialog" 的可见详情区域，显示对应任务标题；通过 data-testid="details-close" 关闭。
6. 保持正常键盘操作、可读标签和真实搜索、筛选、详情交互，不要只画出静态控件。
7. 完成文件后直接结束。最终回复只简述写入了什么，不要进行额外的一轮审美润色。
`.trim();

export const COMMON_REFINEMENT = `保留原始网页的业务名称、文案、实体数据、统计值、模块数量和交互功能。
仅在所选规范明确要求时重排相关模块、重绘既有插画或调整视觉面积；允许为内容可读和功能完整做必要布局适配；不得通过新增装饰横幅、删除模块或替换业务内容获取相似度。
保留任务的 data-task-id、data-title、data-status 及功能测试标记。不要复制参考图中的品牌、人物、文案和业务数据。
在本次指定的润色范围内，允许为内容承载、可读性和功能适配尺寸、间距、排版和对比度。保留已有交互与状态语义，不新增无关功能。
交付前在 1440×1000 视口检查整体层级、遮挡、溢出和可读性；如无法执行检查，应如实说明。`;

export const ADAPTATION_POLICY = `以所选维度为主要风格变化目标，不主动迁移未选维度的风格。
未选中“整页视觉重点”时，不另行推导或重设整页视觉中心、主次区域比例及阅读顺序。
允许为内容可读、布局完整和功能可用做最小必要联动。此原则优先于章节中的固定参数和“不改变”等范围限制。
数值是参考目标，不得为机械满足参数制造挤压、遮挡或低对比度。多个所选维度需先去重、协调冲突，再实施一致的设计。`;

export function buildRunInput(
  version: ExperimentVersion,
  groupId: GroupId,
  reference?: ReferenceAsset,
  baselineHash?: string,
): RunInput {
  const rules = groupRules(version, groupId);
  if (groupId !== 'baseline' && !reference) throw new Error('修改组需要参考 UI 截图。');
  if (groupId === 'all-rules' && !rules.length) throw new Error('请先生成或填写维度规范，并保存实验版本。');
  if (rules.some(rule => !rule.instructions.trim())) throw new Error('本组规范为空，请先填写并保存新版本。');

  const directTask = 'website/ 中已有一份完整的项目管理网页。请参照所附参考图的风格润色这个网页。';
  let task: string;
  if (groupId === 'baseline') task = `根据以下业务需求生成一个完整、可使用的中文项目管理 Dashboard。正常完成页面设计。\n\n业务需求：\n${version.businessBrief}`;
  else if (groupId === 'direct') task = directTask;
  else task = `website/ 中已有一份完整的项目管理网页。本次以以下选中的 ${rules.length} 个维度规范为主要润色目标。\n\n${ADAPTATION_POLICY}\n\n${rules.map((rule, index) => `规范章节 ${index + 1}：${rule.title}\n主要修改范围（允许必要适配）：${rule.scope}\n本维度规范：\n${rule.instructions}`).join('\n\n')}\n\n${COMMON_REFINEMENT}`;

  return {
    // The direct-image control deliberately matches a casual user's one-sentence request.
    prompt: groupId === 'direct' ? task : `${task}\n\n${PAGE_CONTRACT}\n`,
    rules: structuredClone(rules),
    ...(groupId === 'baseline' ? {} : { reference }),
    config: structuredClone(version.config),
    businessBrief: version.businessBrief,
    ...(baselineHash ? { baselineHash } : {}),
  };
}
