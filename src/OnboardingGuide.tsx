import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type { OnboardingStep } from '../shared/onboarding';
import './onboarding.css';

const steps: Record<OnboardingStep, { number: number; target: string; title: string; text: string; next?: string; interactive?: boolean }> = {
  upload: { number: 1, target: 'upload', title: '从一张喜欢的图开始', text: '先用示例快速体验，无需准备图片。点击高亮的上传入口。', interactive: true },
  reference: { number: 2, target: 'reference', title: '这里是你的参考图', text: '上传后，参考图会显示在这里。我们已经为你准备好一张剪纸风格的示例。', next: '下一步' },
  extract: { number: 3, target: 'extract', title: '把设计变成可选项', text: '点击“提炼基础与辨识特征”，发现图中值得借鉴的设计。', interactive: true },
  extracting: { number: 3, target: 'extract', title: '正在展示提炼过程…', text: '快速体验使用预先保存的示例，无需等待真实生成。' },
  select: { number: 4, target: 'select', title: '只带走你喜欢的设计', text: '默认全部选中，不想借鉴的可以取消。试试这个选框，也可以直接下一步。', next: '下一步', interactive: true },
  validate: { number: 5, target: 'validate', title: '看看用在网页上的效果', text: '已恢复全选。点击“验证所选设计”，看看全部特征应用到博客后的示例效果。', interactive: true },
  validating: { number: 5, target: 'validate', title: '正在展示优化过程…', text: '快速体验使用预先生成的网页，不会调用 Codex。' },
  result: { number: 5, target: 'result', title: '从喜欢的风格，到自己的网页', text: '左边是原始博客，右边是预先生成的示例效果。正式使用时，会按你实际选择的特征生成。', next: '下一步' },
  export: { number: 6, target: 'export', title: '把设计参考带走', text: '点击“预览并导出图片”，下载总览图和无标记原图，一起发给 Codex。这里无需实际下载。', interactive: true },
  copy: { number: 7, target: 'copy', title: '最后，带上配套指令', text: '把配套指令与两张图片一起发给 Codex，它就知道要借鉴哪些设计。复制和下载都可稍后再做。', next: '完成，开始使用', interactive: true },
};
type Box = { left: number; top: number; width: number; height: number };

export default function OnboardingGuide({ step, loading, error, onNext, onRetry, onFinish }: {
  step: OnboardingStep; loading: boolean; error: string; onNext: () => void; onRetry: () => void; onFinish: () => void;
}) {
  const info = steps[step], tip = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box>(), [interactionBox, setInteractionBox] = useState<Box>(), [position, setPosition] = useState({ left: 16, top: 16 });
  const target = () => document.querySelector<HTMLElement>(`[data-tour="${info.target}"]`);

  useLayoutEffect(() => {
    const element = target();
    if (!element) return;
    const interaction = step === 'copy' ? document.querySelector<HTMLElement>('.feature-export-modal .feature-dialog-actions')! : element;
    // The small checkbox needs its card scrolled into view; fixed footer buttons stay put.
    const scrollTarget = step === 'select' ? element.closest('.feature-card')! : element;
    if (!['validate', 'validating', 'export', 'copy'].includes(step)) scrollTarget.scrollIntoView({ block: step === 'result' ? 'start' : 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    const measure = () => {
      const rect = element.getBoundingClientRect(), margin = 8;
      const left = Math.max(4, rect.left - margin), top = Math.max(4, rect.top - margin);
      const right = Math.min(window.innerWidth - 4, rect.right + margin), bottom = Math.min(window.innerHeight - 4, rect.bottom + margin);
      const next = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      setBox(next);
      const area = interaction.getBoundingClientRect();
      setInteractionBox({left:Math.max(4,area.left-margin),top:Math.max(4,area.top-margin),width:Math.max(0,Math.min(window.innerWidth-4,area.right+margin)-Math.max(4,area.left-margin)),height:Math.max(0,Math.min(window.innerHeight-4,area.bottom+margin)-Math.max(4,area.top-margin))});
      const width = tip.current?.offsetWidth || 340, height = tip.current?.offsetHeight || 230;
      const footer = document.querySelector('.feature-selection')?.getBoundingClientRect();
      const ceiling = step === 'copy' ? window.innerHeight - 12 : Math.min(window.innerHeight - 12, (footer?.top ?? window.innerHeight) - 12);
      const below = bottom + 16;
      const above = top - height - 16;
      let x = Math.max(12, Math.min(window.innerWidth - width - 12, left + next.width / 2 - width / 2));
      let y: number;
      if (below + height <= ceiling) y = below;
      else if (above >= 12) y = above;
      else if (right + width + 28 <= window.innerWidth) { x = right + 16; y = Math.max(12, Math.min(top, ceiling - height)); }
      else if (left - width - 16 >= 12) { x = left - width - 16; y = Math.max(12, Math.min(top, ceiling - height)); }
      else y = Math.max(12, ceiling - height);
      setPosition({ left: x, top: Math.max(12, Math.min(y, ceiling - height)) });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element); observer.observe(interaction); if (tip.current) observer.observe(tip.current);
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [step, loading, error]);

  useEffect(() => {
    const element = target();
    const allowed = () => {
      const area = step === 'copy' ? document.querySelector('.feature-export-modal .feature-dialog-actions') : info.interactive ? element : null;
      const controls = area ? [area, ...area.querySelectorAll<HTMLElement>('button, a, input, textarea')].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('button:not(:disabled), a[href], input:not(:disabled), textarea')) : [];
      return [...controls, ...tip.current!.querySelectorAll<HTMLElement>('button')];
    };
    const first = () => (['upload', 'extract', 'validate', 'export', 'select'].includes(step) && !loading && !error ? element : tip.current?.querySelector<HTMLElement>('button'));
    first()?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onFinish(); }
      if (event.key !== 'Tab') return;
      const controls = allowed(), current = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault(); event.stopImmediatePropagation();
      controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus({ preventScroll: true });
    };
    const focus = (event: FocusEvent) => { if (!allowed().includes(event.target as HTMLElement)) tip.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }); };
    const click = (event: MouseEvent) => {
      const el = event.target as Element;
      if (el.closest('.onboarding-tip') || (info.interactive && !loading && (element?.contains(el) || (step === 'copy' && el.closest('.feature-dialog-actions'))))) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', keydown, true); document.addEventListener('focusin', focus); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focus); document.removeEventListener('click', click, true); };
  }, [step, loading, error, onFinish]);

  const hole = interactionBox && interactionBox.width > 0 && interactionBox.height > 0 ? `M${interactionBox.left},${interactionBox.top}h${interactionBox.width}v${interactionBox.height}h-${interactionBox.width}Z` : '';
  return <div className="onboarding-guide">
    <svg className="onboarding-shade" width="100%" height="100%" aria-hidden="true"><path d={`M0,0H${window.innerWidth}V${window.innerHeight}H0Z ${hole}`} fillRule="evenodd"/></svg>
    {box && <div className="onboarding-highlight" style={box}/>}
    <section ref={tip} className="onboarding-tip" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-text" style={position}>
      <div className="onboarding-meta"><span>快速体验 · {info.number} / 7</span><button onClick={onFinish} aria-label="跳过使用指引">跳过 <X size={14}/></button></div>
      <h2 id="onboarding-title">{info.title}</h2><p id="onboarding-text">{info.text}</p>
      {(loading || step === 'extracting' || step === 'validating') && <p role="status" className="onboarding-status"><LoaderCircle size={15} className="spin"/>{loading?'正在读取示例…':'正在展示示例…'}</p>}
      {error && <div role="alert" className="onboarding-error"><p>{error}</p><button className="feature-button" onClick={onRetry}>重试</button></div>}
      {info.next && <button className="feature-button primary onboarding-next" onClick={onNext}>{info.next}</button>}
    </section>
  </div>;
}
