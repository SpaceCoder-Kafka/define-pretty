import type { LayoutDiagram as Diagram, LayoutRole } from '../shared/layout-diagram';

/** These colors identify content roles; they do not prescribe the target page's palette. */
export const layoutPalette: Record<LayoutRole, { fill: string; stroke: string; text: string }> = {
  navigation: { fill: '#344052', stroke: '#263343', text: '#ffffff' },
  main: { fill: '#bad5f3', stroke: '#7ca5d5', text: '#203b60' },
  support: { fill: '#f1dce8', stroke: '#cbaabe', text: '#684659' },
  highlight: { fill: '#386ee7', stroke: '#2758bf', text: '#ffffff' },
};
export const layoutRoleLabels: Record<LayoutRole, string> = {
  navigation: '导航', main: '主要内容', support: '辅助内容', highlight: '重点内容',
};

export default function LayoutDiagram({ diagram, label = '布局结构示意' }: { diagram: Diagram; label?: string }) {
  const description = `${label}：${diagram.blocks.map(block => `${layoutRoleLabels[block.role]}，${block.label}`).join('；')}。色块按前后层次叠放，颜色区分内容角色，比例为观察估计。`;
  return <figure className="feature-layout-diagram">
    <div className="feature-layout-diagram-stage">
      <div className="feature-layout-diagram-canvas" role="img" aria-label={description} style={{ aspectRatio: diagram.aspectRatio, width: `min(100%, ${160 * diagram.aspectRatio}px)` }}>
        {diagram.blocks.map((block, index) => {
          const color = layoutPalette[block.role];
          return <div key={index} className="feature-layout-block" aria-hidden="true" title={`${layoutRoleLabels[block.role]}：${block.label}`} style={{ left: `${block.x * 100}%`, top: `${block.y * 100}%`, width: `${block.width * 100}%`, height: `${block.height * 100}%`, background: color.fill, borderColor: color.stroke, color: color.text }}>
            <span>{block.label}</span>
          </div>;
        })}
      </div>
    </div>
    <figcaption>比例为观察估计 · 颜色区分角色</figcaption>
  </figure>;
}
