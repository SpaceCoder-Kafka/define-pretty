import type { ComponentSnapshot } from '../shared/types.ts';

/** Runs in the screenshot page. Geometry is measured, never invented by the model. */
export function collectComponents(prefix: string): ComponentSnapshot[] {
  const result: ComponentSnapshot[] = [];
  const nodes = document.querySelectorAll('main,aside,nav,header,section,article,figure,img,svg,canvas,button,input,select,h1,h2,h3,p,div,li,a');
  for (const node of nodes) {
    if (node.parentElement?.closest('svg') || result.length >= 280) continue;
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const width = Math.min(innerWidth, rect.right) - x, height = Math.min(innerHeight, rect.bottom) - y;
    if (width < 16 || height < 16 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0' || width * height > innerWidth * innerHeight * .88) continue;
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const tag = node.tagName.toLowerCase();
    const identity = [node.id, node.getAttribute('class'), node.getAttribute('aria-label'), node.getAttribute('data-testid')].filter(Boolean).join(' ').slice(0, 180);
    const appearance = ['color','background-color','background-image','font-size','font-weight','line-height','padding','gap','border-radius','border','box-shadow','display','grid-template-columns'].map(key => `${key}:${style.getPropertyValue(key)}`).join(';');
    const media = tag === 'img' ? node.getAttribute('src') ?? '' : tag === 'svg' ? node.outerHTML.slice(0, 1000) : style.backgroundImage !== 'none' ? style.backgroundImage : '';
    result.push({ id: `${prefix}${result.length + 1}`, tag, identity, text, media, appearance,
      box: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
      signature: JSON.stringify([tag, text, node.innerHTML, appearance, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]) });
  }
  return result;
}
