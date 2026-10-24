import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';

export default function FullscreenPreview({ name, url, content, onClose }: { name: string; url?: string; content?: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1440));
    observer.observe(surfaceRef.current!);
    return () => { observer.disconnect(); dialog.close(); document.body.style.overflow = overflow; before?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} className="fullscreen-preview" aria-label={`${name} 全屏预览`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="fullscreen-preview-header"><strong>{name}</strong><span>1440 × 1000 · 等比放大</span><button autoFocus className="btn" aria-label="退出全屏预览" onClick={onClose}><Minimize2 size={16} />退出全屏</button></header>
    <div className="fullscreen-preview-surface" ref={surfaceRef}>{content ?? <div className="fullscreen-preview-canvas" style={{ height: 1000 * scale }}><iframe title={`${name} 全屏网页`} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ transform: `scale(${scale})` }} /></div>}</div>
  </dialog>, document.body);
}
