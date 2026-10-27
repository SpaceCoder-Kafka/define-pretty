import { useId } from 'react';
import type { FeatureCard } from '../shared/feature-board';
import { featureOverview } from '../shared/feature-overview';
import LayoutDiagram from './LayoutDiagram';

/** The same summary projection is used by the selectable board and PNG export. */
export default function FeatureOverview({ card, url, aspect }: { card: FeatureCard; url: string; aspect: number }) {
  const overview = featureOverview(card), clip = useId(), region = card.region;
  const crop = <svg className="feature-overview-crop" viewBox={`${region.x * 1000} ${region.y * 1000 / aspect} ${region.width * 1000} ${region.height * 1000 / aspect}`} role="img" aria-label={`${card.title}的参考示例`}>
    <defs><clipPath id={clip}><rect x={region.x * 1000} y={region.y * 1000 / aspect} width={region.width * 1000} height={region.height * 1000 / aspect}/></clipPath></defs>
    <image href={url} width="1000" height={1000 / aspect} clipPath={`url(#${clip})`}/>
  </svg>;
  return <div className={`feature-overview-content is-${overview.kind}`}>
    {card.kind === 'layout' && card.layout ? <LayoutDiagram diagram={card.layout} label={`${card.title}布局结构示意`} compact/> : (overview.kind === 'style' || overview.kind === 'attributes') && crop}
    {overview.summary && <p className="feature-overview-summary">{overview.summary}</p>}
    {overview.swatches.length > 0 && <ul className="feature-overview-swatches" aria-label="重点配色">{overview.swatches.map((swatch, index) => <li key={index}>
      <span className="feature-overview-swatch" style={{ background: swatch.hex }}/>
      <strong>{swatch.hex}</strong><span>{swatch.role}</span><small>{[swatch.area, swatch.evidence].filter(Boolean).join(' · ')}</small>
    </li>)}</ul>}
    {overview.rows.length > 0 && <dl className="feature-overview-rows">{overview.rows.map((row, index) => <div key={index}>
      <dt>{row.label}</dt><dd><strong>{row.value}</strong></dd>{row.detail && <dd className="feature-overview-row-detail"><small>{row.detail}</small></dd>}
    </div>)}</dl>}
    {overview.notes.length > 0 && <div className="feature-overview-notes">{overview.notes.map((note, index) => <p key={index}>{note}</p>)}</div>}
    {overview.hasMore && <span className="feature-overview-more">其余细节见配套指令</span>}
  </div>;
}
