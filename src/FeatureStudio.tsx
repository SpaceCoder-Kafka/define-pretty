import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { FlaskConical, Upload, Sparkles, Plus, Check, Pencil, Download, Copy, X, SlidersHorizontal, MousePointer2, Image as ImageIcon, RotateCcw, ArrowUpRight, LoaderCircle, CheckCheck, Square, Trash2, FileText } from 'lucide-react';
import type { Bootstrap, ModelConfig, ReferenceAsset } from '../shared/types';
import type { FeatureCompletion } from '../shared/feature-completion';
import { GLOBAL_STYLE_TITLE, FULL_IMAGE_REGION, featureReady, featureInstruction, featureImplementation, featureSections, selectedFeatures, featureTier, featureOrder, type FeatureBoard, type FeatureCard, type FeatureRegion } from '../shared/feature-board';
import { api, errorMessage, setApiToken } from './api';
import { exportFeatureBoard, loadReference } from './feature-export';
import './feature-studio.css';
import FeatureValidation, { useFeatureTests } from './FeatureValidation';
import LayoutDiagram from './LayoutDiagram';
import FeatureSpecView, { FeatureSpecEditor, tierLabels, tierDescriptions } from './FeatureSpecView';
import type { FeatureTier } from '../shared/feature-spec';

type Wire = { id: string; path: string };
const statusText: Record<FeatureBoard['status'], string> = { draft: '待生成', running: '生成中', completed: '已生成', failed: '生成失败', cancelled: '已取消', interrupted: '已中断' };
function mergeCompletion(draft: FeatureCard, result: FeatureCompletion['result']): FeatureCard {
  if (!result) return draft;
  return { ...draft, ...result, spec: 'spec' in result ? result.spec ?? undefined : draft.spec, adaptation: '' };
}
function Crop({ card, url, aspect }: { card: FeatureCard; url: string; aspect: number }) {
  const r = card.region, clip = useId();
  return <svg className="feature-crop" viewBox={`${r.x * 1000} ${r.y * 1000 / aspect} ${r.width * 1000} ${r.height * 1000 / aspect}`} aria-label={`${card.title}的参考区域`}><defs><clipPath id={clip}><rect x={r.x*1000} y={r.y*1000/aspect} width={r.width*1000} height={r.height*1000/aspect}/></clipPath></defs><image href={url} width="1000" height={1000 / aspect} clipPath={`url(#${clip})`} /></svg>;
}
export default function FeatureStudio() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [boards, setBoards] = useState<FeatureBoard[]>([]), [board, setBoard] = useState<FeatureBoard>();
  const [config, setConfig] = useState<ModelConfig>();
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [active, setActive] = useState(''), [editor, setEditor] = useState<FeatureCard>(), [locating, setLocating] = useState(false), [drag, setDrag] = useState<FeatureRegion>();
  const [completion,setCompletion]=useState<FeatureCompletion>(), [completionStarting,setCompletionStarting]=useState(false), [completionCancelling,setCompletionCancelling]=useState(false), [regionConfirmed,setRegionConfirmed]=useState(true);
  const completing=completionStarting || completion?.status==='running';
  const [settings, setSettings] = useState(false), [evidence, setEvidence] = useState('');
  const [exported, setExported] = useState<{ url: string; width: number; height: number }>();
  const [aspect, setAspect] = useState(4 / 3), [imageReady, setImageReady] = useState(false);
  const [wires, setWires] = useState<Wire[]>([]), [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const upload = useRef<HTMLInputElement>(null), diagram = useRef<HTMLDivElement>(null), picture = useRef<HTMLImageElement>(null);
  const cardsRef = useRef(new Map<string, HTMLElement>()), start = useRef<{ x: number; y: number } | undefined>(undefined);
  const exportedRef = useRef('');
  const validation = useFeatureTests(board, bootstrap);
  const locked = busy || validation.busy || saving || completing || board?.status === 'running';
  const view = board ? { ...board, cards: board.cards.map(card => editor?.id === card.id ? editor : card).sort((a, b) => featureOrder(a) - featureOrder(b)) } : undefined;
  const tiers: FeatureTier[] = ['foundation', 'signature', 'detail'];
  const hasFoundationSpecs = !!board && ['style', 'typography', 'layout', 'palette'].every(kind => board.cards.some(card => card.tier === 'foundation' && card.foundation === kind && featureReady(card)));
  const selected = view ? selectedFeatures(view) : [];

  function adopt(next: FeatureBoard) { setBoard(next); setBoards(old => [next, ...old.filter(b => b.id !== next.id)]); localStorage.setItem('define-pretty-feature-board', next.id); }
  function closeEditor() { if(completing)return;setEditor(undefined);setCompletion(undefined);localStorage.removeItem('define-pretty-card-completion'); }
  async function perform(fn: () => Promise<void>) { setError(''); setBusy(true); try { await fn(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  useEffect(() => { let live = true; void (async () => {
    try {
      const boot = await api<Bootstrap>('/bootstrap'); if (!live) return;
      setApiToken(boot.token); setBootstrap(boot);
      const defaults = boot.defaults.config;
      let preference: Partial<ModelConfig> = {};
      try { preference = JSON.parse(localStorage.getItem('define-pretty-feature-config') || '{}'); } catch { /* Ignore invalid local preference. */ }
      setConfig({ ...defaults, ...(typeof preference.model === 'string' ? { model: preference.model } : {}), ...(typeof preference.reasoningEffort === 'string' ? { reasoningEffort: preference.reasoningEffort } : {}) });
      const list = await api<FeatureBoard[]>('/feature-boards'); if (!live) return;
      setBoards(list); const previous = list.find(b => b.id === localStorage.getItem('define-pretty-feature-board')) || list[0]; if (previous) setBoard(previous);
      const pending=localStorage.getItem('define-pretty-card-completion');
      if(pending) { try {
        const saved=JSON.parse(pending), job=await api<FeatureCompletion>(`/feature-completions/${saved.id}`);
        if(!live)return;
        const target=list.find(b=>b.id===job.boardId);
        if(target && target.revision===job.revision && target.cards.some(c=>c.id===job.cardId) && saved.draft?.id===job.cardId) {
          adopt(target);setEditor(saved.draft);setActive(job.cardId);setRegionConfirmed(true);setCompletion(job);
          if(job.status==='completed'&&job.result)setEditor(mergeCompletion(saved.draft,job.result));
          else if(job.error)setError(job.error);
        }else {localStorage.removeItem('define-pretty-card-completion');setError('卡片已更新，未自动恢复旧的补全草稿。');}
      }catch(cause){localStorage.removeItem('define-pretty-card-completion');setError(errorMessage(cause));} }
    } catch(cause) { if (live) setError(errorMessage(cause)); }
  })(); return () => { live = false; }; }, []);
  useEffect(()=>{if(!completion || completion.status!=='running')return;let live=true;
    const poll=()=>api<FeatureCompletion>(`/feature-completions/${completion.id}`).then(next=>{if(!live)return;setCompletion(next);
      if(next.status==='completed'&&next.result){setEditor(current=>current?.id===next.cardId?mergeCompletion(current,next.result):current);setNotice('AI 已补全，请检查后保存。');}
      else if(next.error)setError(next.error);
    }).catch(cause=>{if(live)setError(errorMessage(cause));});
    void poll();const timer=setInterval(()=>void poll(),2000);return()=>{live=false;clearInterval(timer);};
  },[completion?.id,completion?.status]);
  useEffect(() => { if (!board || board.status !== 'running') return; let live = true;
    const timer = setInterval(() => { void api<FeatureBoard>(`/feature-boards/${board.id}`).then(next => { if (live) adopt(next); }).catch(cause => { if(live) setError(errorMessage(cause)); }); }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [board?.id, board?.status]);
  useEffect(() => { if (!board) return; let live = true; setImageReady(false);
    void loadReference(board.reference.url).then(img => { if (live) { setAspect(img.naturalWidth / img.naturalHeight); setImageReady(true); } }).catch(cause => { if(live) setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [board?.reference.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if(config) localStorage.setItem('define-pretty-feature-config', JSON.stringify({ model: config.model, reasoningEffort: config.reasoningEffort })); }, [config]);
  useEffect(() => () => { if (exportedRef.current) URL.revokeObjectURL(exportedRef.current); }, []);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !completing) { setLocating(false); setDrag(undefined); start.current = undefined; if (!locating) { closeEditor(); setSettings(false); setEvidence(''); closeExport(); } } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [locating,completing]);

  const dialogOpen = (!!editor && !locating) || settings || !!evidence || !!exported;
  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')];
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [dialogOpen, !!evidence, !!exported]);

  useLayoutEffect(() => {
    if (!diagram.current || !picture.current || !imageReady || !view) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const root = diagram.current?.getBoundingClientRect(), img = picture.current?.getBoundingClientRect(); if (!root || !img) return;
      setCanvasSize({ width: root.width, height: root.height });
      setWires(view.cards.map((card, index) => { const el = cardsRef.current.get(card.id)?.getBoundingClientRect(); if (!el) return { id: card.id, path: '' };
        const left = index % 2 === 0, sx = (left ? el.right : el.left) - root.left, sy = el.top + 48 - root.top;
        const ex = img.left - root.left + (card.region.x + (left ? 0 : card.region.width)) * img.width, ey = img.top - root.top + (card.region.y + card.region.height / 2) * img.height;
        const bend = (left ? img.left - 12 : img.right + 12) - root.left;
        return { id: card.id, path: `M${sx} ${sy} L${bend} ${sy} L${bend} ${ey} L${ex} ${ey}` };
      }));
    }); };
    const observer = new ResizeObserver(update); observer.observe(diagram.current); observer.observe(picture.current); cardsRef.current.forEach(el => observer.observe(el)); update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [board?.cards, editor?.region, aspect, imageReady]);

  async function save(next: FeatureBoard): Promise<boolean> {
    setSaving(true); setError('');
    try { adopt(await api<FeatureBoard>(`/feature-boards/${next.id}`, { method: 'PUT', body: JSON.stringify({ revision: next.revision, title: next.title, cards: next.cards }) })); return true; }
    catch(cause) { setError(errorMessage(cause)); return false; } finally { setSaving(false); }
  }
  async function uploadFile(file?: File) { if (!file || !config) return; await perform(async () => {
    const form = new FormData(); form.append('file', file);
    const reference = await api<ReferenceAsset>('/references', { method: 'POST', body: form });
    const next = await api<FeatureBoard>('/feature-boards', { method: 'POST', body: JSON.stringify({ referenceId: reference.id, config, title: file.name.replace(/\.[^.]+$/, '').slice(0, 90) || '我的视觉参考' }) });
    adopt(next); setEditor(undefined); setActive('');
  }); }
  async function generate() { if (!board || !config) return; await perform(async () => {
    // Every generation has a separate immutable input record; old cards remain selectable in history.
    const next = await api<FeatureBoard>('/feature-boards', { method: 'POST', body: JSON.stringify({ referenceId: board.reference.id, config, title: board.title }) });
    adopt(next);
    adopt(await api<FeatureBoard>(`/feature-boards/${next.id}/generate`, { method: 'POST' }));
  }); }
  async function discoverDetails() { if(!board || !config)return;await perform(async()=>{
    adopt(await api<FeatureBoard>(`/feature-boards/${board.id}/discover-details`,{method:'POST',body:JSON.stringify({revision:board.revision,config})}));
    setActive('');
  }); }
  function toggle(card: FeatureCard) { if (board && !locked && !editor) void save({ ...board, cards: board.cards.map(c => c.id === card.id ? { ...c, selected: !c.selected } : c) }); }
  async function completeCard() {
    if(!board||!editor||!config||completing||!regionConfirmed)return;
    setCompletionStarting(true);setError('');
    const draft=structuredClone(editor);
    try { const job=await api<FeatureCompletion>(`/feature-boards/${board.id}/complete-card`,{method:'POST',body:JSON.stringify({cardId:draft.id,revision:board.revision,title:draft.title,region:draft.region,config})});
      localStorage.setItem('define-pretty-card-completion',JSON.stringify({id:job.id,draft}));setCompletion(job);
    }catch(cause){setError(errorMessage(cause));}finally{setCompletionStarting(false);}
  }
  async function cancelCompletion() {if(!completion||completionCancelling)return;setCompletionCancelling(true);try{const next=await api<FeatureCompletion>(`/feature-completions/${completion.id}/cancel`,{method:'POST'});setCompletion(next);if(next.status==='completed'&&next.result)setEditor(current=>current?.id===next.cardId?mergeCompletion(current,next.result):current);}catch(cause){setError(errorMessage(cause));}finally{setCompletionCancelling(false);} }
  async function addGlobalCard() {
    if (!board || board.cards.some(c => c.kind === 'global')) return;
    const card: FeatureCard = { id: crypto.randomUUID(), kind: 'global', title: GLOBAL_STYLE_TITLE, description: '', effect: '', instruction: '', applicability: '', selected: false, application: '', region: { ...FULL_IMAGE_REGION } };
    if (await save({ ...board, cards: [card, ...board.cards] })) { setEditor(card); setCompletion(undefined); setRegionConfirmed(true); setActive(card.id); }
  }
  async function addCard() { if (!board) return; const card: FeatureCard = { id: crypto.randomUUID(), kind: 'local', tier: 'detail', discovery: 'detail', title: '我的设计特征', description: '', effect: '', instruction: '说明具体实现规则，以及什么情况下可以怎样调整。', adaptation: '', applicability: '', selected: false, application: '', region: { x: .25, y: .25, width: .5, height: .5 } };
    if (await save({ ...board, cards: [...board.cards, card] })) { setEditor(card); setCompletion(undefined);setRegionConfirmed(false);setLocating(true);setActive(card.id);diagram.current?.scrollIntoView({block:'center',behavior:'smooth'}); }
  }
  function position(e: PointerEvent) { const box = picture.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) }; }
  function pointerDown(e: PointerEvent<SVGSVGElement>) { if (!locating || !editor) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = position(e); setDrag(undefined); }
  function pointerMove(e: PointerEvent<SVGSVGElement>) { if (!start.current) return; const p = position(e), s = start.current; setDrag({ x: Math.min(p.x,s.x), y: Math.min(p.y,s.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }); }
  function pointerUp(e: PointerEvent<SVGSVGElement>) { if (!start.current || !editor) return; const p = position(e), s = start.current; const r = { x: Math.min(p.x,s.x), y: Math.min(p.y,s.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }; start.current = undefined; setDrag(undefined); if (r.width < .01 || r.height < .01) { setNotice('请拖出一个更大的矩形区域。'); return; } setEditor({ ...editor, region: r }); setRegionConfirmed(true);setLocating(false); }
  function closeExport() { if(exportedRef.current) URL.revokeObjectURL(exportedRef.current); exportedRef.current = ''; setExported(undefined); }
  async function previewExport() { if (!board) return; await perform(async () => { const result = await exportFeatureBoard(board); closeExport(); const url = URL.createObjectURL(result.blob); exportedRef.current = url; setExported({ url, width: result.width, height: result.height }); }); }
  async function copyInstruction() { if (!board) return; try { await navigator.clipboard.writeText(featureInstruction(board)); setNotice('配套指令已复制，和导出图片一起发给 AI 即可。'); } catch { setEvidence(featureInstruction(board)); } }
  function renderCard(card: FeatureCard, index: number) {
    const focused = active === card.id;
    return <article key={card.id} style={{ order: index }} ref={el => { if(el) cardsRef.current.set(card.id, el); else cardsRef.current.delete(card.id); }} className={`feature-card ${card.kind === 'global' ? 'feature-global-card' : ''} ${card.selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`} onMouseEnter={() => setActive(card.id)} onMouseLeave={() => setActive('')} onFocus={() => setActive(card.id)}>
      <div className="feature-card-head"><span className="feature-number">{index + 1}</span><label><input type="checkbox" checked={card.selected} disabled={locked || !!editor || !featureReady(card)} onChange={() => toggle(card)} /><span>{card.title}</span></label><button className="feature-icon" aria-label={`编辑${card.title}`} disabled={locked} onClick={() => { setEditor({ ...structuredClone(card), instruction: featureImplementation(card), adaptation: '' }); setCompletion(undefined);setRegionConfirmed(true);setActive(card.id); }}><Pencil size={15}/></button></div>
      <p className={`feature-tier-label is-${featureTier(card)}`} title={tierDescriptions[featureTier(card)]}>{tierLabels[featureTier(card)]}{featureTier(card) === 'foundation' ? ' · 优先落实' : featureTier(card) === 'detail' ? ' · 按需采用' : ''}</p>
      {!featureReady(card) && <p className="feature-global-pending">尚未提炼。点击「编辑要求」，使用 AI 补全或填写规则后再勾选。</p>}
      {card.kind === 'layout' && <p className="feature-layout-label">布局结构 · 勾选即按此结构重组页面</p>}
      {card.kind === 'layout' && card.layout ? <LayoutDiagram diagram={card.layout} label={`${card.title}布局结构示意`}/> : <Crop card={card} url={board!.reference.url} aspect={aspect}/>}
      {card.spec && <FeatureSpecView spec={card.spec}/>}
      <dl className="feature-rules">{featureSections(card).map(section => <div key={section.label}><dt>{section.label}</dt><dd>{section.text}</dd></div>)}</dl>
      {card.description && <details className="feature-source"><summary>查看图中依据</summary><p>{card.description}</p>{card.kind === 'layout' && card.layout && <Crop card={card} url={board!.reference.url} aspect={aspect}/>}</details>}
      <div className="feature-card-foot"><span>{card.selected ? <><Check size={13}/>已选入参考图</> : '勾选以借鉴这个特征'}</span><button disabled={locked} onClick={() => { setEditor({ ...structuredClone(card), instruction: featureImplementation(card), adaptation: '' }); setCompletion(undefined);setRegionConfirmed(true);setActive(card.id); }}>编辑要求 <ArrowUpRight size={13}/></button></div>
    </article>;
  }

  return <div className="feature-app">
    <header className="feature-header"><a className="feature-brand" href="/"><span className="feature-logo"><Sparkles size={20}/></span>Define Pretty <span className="feature-beta">视觉特征卡片</span></a><div className="feature-header-actions"><a className="feature-quiet" href="#original-websites"><FlaskConical size={15}/>原始网页</a><button className="feature-button" onClick={() => setSettings(true)}><SlidersHorizontal size={16}/>生成设置</button></div></header>
    <main className="feature-main">
      <section className="feature-intro"><div><div className="feature-eyebrow">从「喜欢这个」到「借鉴这一点」</div><h1>把喜欢的设计，选出来。</h1><p>选择喜欢的视觉效果，保留关键关系，按自己的内容适配，再交给 AI。</p></div><ol className="feature-steps"><li className={board ? 'done' : 'current'}><span>1</span>上传参考图</li><li className={board?.cards.length ? 'done' : board ? 'current' : ''}><span>2</span>发现与选择</li><li className={selected.length ? 'current' : ''}><span>3</span>导出参考</li></ol></section>
      {error && <div className="feature-alert" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div className="feature-notice" role="status">{notice}</div>}
      <input hidden ref={upload} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void uploadFile(e.target.files?.[0]); e.target.value = ''; }}/>
      <section className="feature-workbench">
        <div className="feature-toolbar"><div className="feature-toolbar-title"><ImageIcon size={18}/>{boards.length ? <select aria-label="选择特征板" value={board?.id || ''} disabled={locked || !!editor} onChange={e => { const next = boards.find(b => b.id === e.target.value); if(next) { adopt(next); setActive(''); } }}>{boards.map(b => <option key={b.id} value={b.id}>{b.title}{b.generationMode==='details'?' · 补充细节':''} · {new Date(b.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {statusText[b.status]}</option>)}</select> : <span>我的视觉参考</span>}<span className="feature-save">{saving ? '保存中…' : board ? '已保存到本地' : 'PNG / JPG / WebP'}</span></div><div className="feature-toolbar-actions"><button className="feature-button" disabled={locked || !config || !!editor} onClick={() => upload.current?.click()}><Upload size={15}/>{board ? '新参考图' : '上传参考图'}</button>{board && <button className="feature-button primary" disabled={locked || !config || !!editor || !imageReady || !bootstrap?.runtime.authenticated} onClick={() => void generate()}><Sparkles size={15}/>{board.cards.length ? '重新提炼基础与辨识特征' : '提炼基础与辨识特征'}</button>}</div></div>
        {!board ? <div className="feature-empty" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if(!busy) void uploadFile(e.dataTransfer.files[0]); }}><div className="feature-empty-art"><span/><span/><div><ImageIcon size={48}/><i>你的灵感，从一张图开始</i></div></div><h2>放入一张你喜欢的 UI 截图</h2><p>AI 默认生成四类基础规范与图中辨识特征，精细细节按需补充。<br/>你来选择哪些值得带走。</p><button className="feature-button primary" disabled={!config || busy} onClick={() => upload.current?.click()}><Upload size={17}/>选择参考图</button><small>或将图片拖到这里 · 最大 10 MB</small></div> : <>
          <div className="feature-subtoolbar"><span><MousePointer2 size={14}/>{board.cards.length ? `${board.cards.length} 个可借鉴特征 · 悬停卡片，查看图中出处` : '先生成特征卡片，或手动添加你喜欢的一点'}</span><div>{board.cards.length>0&&<button disabled={locked || !!editor || !config || !bootstrap?.runtime.authenticated || board.cards.filter(c=>c.kind!=='global').length>=12} onClick={()=>void discoverDetails()}><Sparkles size={14}/>发现更多细节</button>}<button disabled={locked || !!editor || board.cards.filter(c => c.kind !== 'global').length >= 12} onClick={() => void addCard()}><Plus size={14}/>手动添加</button><button disabled={locked || !!editor || !board.cards.length} onClick={() => void save({ ...board, cards: board.cards.map(c => ({ ...c, selected: featureReady(c) && selected.length !== board.cards.filter(featureReady).length })) })}>{selected.length === board.cards.filter(featureReady).length && selected.length ? <Square size={14}/> : <CheckCheck size={14}/>} {selected.length === board.cards.filter(featureReady).length && selected.length ? '取消全选' : '全选'}</button></div></div>
          {!board.cards.some(c => c.kind === 'global') && board.status !== 'running' && <div className="feature-global-intro"><div><strong>整体视觉风格</strong><p>协调配色、文字、形状与视觉权重。布局结构会单独展示为特征卡，勾选后直接按该结构调整页面。</p></div><button className="feature-button" disabled={locked || !!editor} onClick={() => void addGlobalCard()}><Plus size={14}/>补充整体视觉风格</button></div>}
          {board.generationMode==='details'&&board.status==='completed'&&<p className="feature-discovery-note" role="status">{board.addedDetails ? `新增 ${board.addedDetails} 个可选细节，默认未选中。原有卡片及勾选保留。` : '没有发现值得单独补充的新细节，原有卡片及勾选保留。'}</p>}
          {board.cards.length>0&&<><div className="feature-tier-overview" aria-label="特征级别">{tiers.map(tier => <span key={tier} className={`is-${tier}`} title={tierDescriptions[tier]}>{tierLabels[tier]}<b>{view?.cards.filter(card => featureTier(card) === tier).length || 0}</b></span>)}</div><p className="feature-discovery-note">先落实一级基础规范，再保留二级辨识特征；三级细节按需补充。仅所选卡片进入导出与测试。</p></>}
          {board.status === 'running'  && <div className="feature-generating"><LoaderCircle className="spin" size={20}/><div><strong>{board.generationMode==='details'?'正在发现更多细节':'正在提炼基础与辨识特征'}</strong><span>{board.generationMode==='details'?'仅补充已有卡片未覆盖的做法，新增细节默认不选中。':'默认生成整体风格、文字层级、布局空间、配色四类规范，再提取有依据的辨识特征。'}</span></div><button className="feature-button" onClick={() => void perform(async () => adopt(await api<FeatureBoard>(`/feature-boards/${board.id}/cancel`, { method: 'POST' })))}>取消生成</button></div>}
          {board.error && <div className="feature-alert">{board.error} 原始图片与生成记录已保留。</div>}
          {board.cards.length > 0 && !hasFoundationSpecs && board.status !== 'running' && <div className="feature-legacy-note">这份历史卡片尚未包含完整的四类基础规范。点击「重新提炼基础与辨识特征」会生成带配色、字体与空间参数的新特征板，原卡片与勾选保留在历史记录中。</div>}
          {locating && <div className="feature-locate-banner">在参考图上拖出「{editor?.title}」的区域。<button onClick={() => { setLocating(false); setDrag(undefined); start.current = undefined; }}>返回编辑</button></div>}
          <div className={`feature-diagram ${locating ? 'is-locating' : ''}`} ref={diagram}>
            <svg className="feature-wires" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} aria-hidden="true">{wires.map(w => <path key={w.id} d={w.path} className={active === w.id || selected.some(c => c.id === w.id) ? 'on' : ''}/>)}</svg>
            <div className="feature-column">{view?.cards.map((c,i) => i % 2 === 0 ? renderCard(c,i) : null)}</div>
            <div className="feature-reference"><div className="feature-reference-label"><span>REFERENCE</span><span>引线指向参考图中的出处</span></div><div className="feature-image-wrap"><img ref={picture} src={board.reference.url} alt="参考 UI 截图" draggable={false}/><svg className="feature-regions" viewBox={`0 0 1000 ${1000/aspect}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { start.current = undefined; setDrag(undefined); }} style={{ touchAction: locating ? 'none' : 'auto' }}>
              {view?.cards.map((c,i) => <g key={c.id} className={`${c.kind === 'global' ? 'global-region' : ''} ${active === c.id || c.selected ? 'on' : ''}`} onMouseEnter={() => { if(!locating) setActive(c.id); }} onClick={() => { if(!locating) setActive(c.id); }}><title>{c.title}</title><rect x={c.region.x*1000} y={c.region.y*1000/aspect} width={c.region.width*1000} height={c.region.height*1000/aspect}/><foreignObject x={Math.min(c.region.x*1000,950)} y={Math.min(c.region.y*1000/aspect,1000/aspect-40)} width="50" height="60"><span className="feature-image-number">{i+1}</span></foreignObject></g>)}
              {drag && <rect className="feature-drag" x={drag.x*1000} y={drag.y*1000/aspect} width={drag.width*1000} height={drag.height*1000/aspect}/>}</svg></div><p className="feature-reference-note">定位可在卡片编辑中校准。图中的业务内容不会成为迁移要求。</p>{!board.cards.length && board.status !== 'running' && <div className="feature-reference-empty"><Sparkles size={22}/><span>生成卡片后，从你最喜欢的几个特征开始选择。</span></div>}</div>
            <div className="feature-column">{view?.cards.map((c,i) => i % 2 === 1 ? renderCard(c,i) : null)}</div>
          </div>
          <div className="feature-board-meta"><span>原图：{board.reference.name}</span><button disabled={busy} onClick={() => void perform(async () => { const value = await api<Record<string, unknown>>(`/feature-boards/${board.id}/evidence`); setEvidence(JSON.stringify(value,null,2)); })}><FileText size={13}/>生成记录</button></div>
        </>}
      </section>
      <FeatureValidation state={validation}/>
    </main>
    <footer className="feature-selection"><div><span className="feature-selected-count">{selected.length.toString().padStart(2,'0')}</span><div><strong>{selected.length ? '个特征已选中' : '选择你想借鉴的特征'}</strong><span>{selected.length ? selected.map(c => c.title).join(' · ') : '导出图片只包含所选卡片及其标注'}</span></div></div><div><button className="feature-button" disabled={!selected.length || locked || !!editor} onClick={() => void copyInstruction()}><Copy size={16}/>复制配套指令</button><button className="feature-button primary" disabled={!selected.length || locked || !!editor || !imageReady} onClick={() => void previewExport()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Download size={16}/>}预览并导出图片</button><button className="feature-button primary" disabled={!selected.length || locked || !!editor || !imageReady || !validation.ready || validation.running} onClick={() => void validation.start()}><FlaskConical size={16}/>{validation.busy ? '准备测试…' : validation.running ? '测试进行中' : '测试所选设计'}</button></div></footer>
    {editor && !locating && <div className="feature-overlay" onMouseDown={e => { if(e.target === e.currentTarget) closeEditor(); }}><section className="feature-drawer" role="dialog" aria-modal="true" aria-label="编辑特征卡片"><div className="feature-dialog-head"><div><small>FEATURE DETAILS</small><h2>编辑这个特征</h2></div><button aria-label="关闭编辑" disabled={completing} onClick={closeEditor}><X/></button></div><div className="feature-ai-complete"><div><strong>{editor.kind === 'global' ? '根据完整参考图提炼整体视觉风格' : '根据选区与一句话特征补全'}</strong><p>{editor.tier === 'foundation' || editor.spec ? 'AI 会补全规则与具体属性值，表格和图示同步更新；检查后再保存。重新补全会替换这些内容。' : editor.kind === 'layout' ? 'AI 会补全规则、比例与计算范围，图示同步更新；检查后再保存。重新补全会替换这些内容。' : 'AI 生成图中依据和下方三段内容，检查后再保存。重新补全会替换表单中的这些内容。'}</p><small>使用生成设置：{config?.model} · {config?.reasoningEffort}</small></div>{completing ? <><span role="status"><LoaderCircle className="spin" size={15}/>正在补全…</span><button className="feature-button" disabled={!completion || completionStarting || completionCancelling} onClick={()=>void cancelCompletion()}>取消补全</button></> : <button className="feature-button primary" disabled={saving || !config || !bootstrap?.runtime.authenticated || !imageReady || !regionConfirmed || !editor.title.trim() || editor.title.trim()==='我的设计特征'} onClick={()=>void completeCard()}><Sparkles size={15}/>AI 补全</button>}{!regionConfirmed&&<p>请先在参考图上框选区域。</p>}{completion?.status==='completed'&&<p role="status">已填入补全草稿，请检查并保存。</p>}{completion?.error&&<p role="alert">{completion.error}</p>}</div><form onSubmit={e => { e.preventDefault(); if(board && !completing) void save({ ...board, cards: board.cards.map(c => c.id === editor.id ? editor : c) }).then(ok => { if(ok) closeEditor(); }); }}><fieldset disabled={completing || saving}>
      <label>一句话特征 <span>说明某处设计最值得借鉴的做法</span><input autoFocus readOnly={editor.kind === 'global' || editor.tier === 'foundation'} value={editor.title} maxLength={60} required onChange={e => setEditor({ ...editor, title: e.target.value })}/></label>
      <label>图中依据 <span>只记录可见的参考特征</span><textarea value={editor.description} maxLength={240} onChange={e => setEditor({ ...editor, description: e.target.value })}/></label>
      <label>1．带来什么效果 <span>解释突出什么、弱化什么，帮助判断是否需要</span><textarea value={editor.effect || ''} maxLength={160} placeholder="例如：浅色底块能区分入口，又不会像深色大按钮那样抢眼。" onChange={e => setEditor({ ...editor, effect: e.target.value })}/></label>
      <label>2．怎么实现 <span>逐条说明设计关系，以及什么情况下可以怎样调整</span><textarea value={editor.instruction} maxLength={1000} required rows={8} placeholder="例如：同组入口使用统一尺寸和间距；空间不足时可以横排或换行，仍与主要内容留出分隔。" onChange={e => setEditor({ ...editor, instruction: e.target.value })}/></label>
      <label>3．适合用在哪里 <span>说明适用的组件、内容和不适用条件</span><textarea value={editor.applicability || ''} maxLength={200} placeholder="例如：适合少量快捷入口；需要长文字说明时，使用带文字的列表，不强行改成图标。" onChange={e => setEditor({ ...editor, applicability: e.target.value })}/></label>
      {editor.kind === 'layout' && editor.layout && <LayoutDiagram diagram={editor.layout} label="布局结构补全预览"/>}
      {editor.spec && <><FeatureSpecView spec={editor.spec}/><FeatureSpecEditor spec={editor.spec} onChange={spec => setEditor({ ...editor, spec })}/></>}
      <label>应用到我的哪里 <span>选填</span><input placeholder={editor.kind === 'global' ? '默认整页；也可以指定某个完整区域' : editor.kind === 'layout' ? '默认按此结构匹配内容，也可限定应用范围' : '例如：任务列表卡片 / 顶部导航'} maxLength={200} value={editor.application} onChange={e => setEditor({ ...editor, application: e.target.value })}/></label>
      {editor.kind === 'global' ? <p className="feature-global-label">使用整张参考图，无需框选局部区域。</p> : <div className="feature-location-editor"><Crop card={editor} url={board!.reference.url} aspect={aspect}/><button type="button" className="feature-button" onClick={() => { setLocating(true); setActive(editor.id); diagram.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}><MousePointer2 size={15}/>在参考图上重新框选</button><details><summary>精确调整定位（百分比）</summary><div className="feature-region-inputs">{(['x','y','width','height'] as const).map(key => <label key={key}>{{ x:'左', y:'上', width:'宽', height:'高' }[key]}<input type="number" min={key==='x'||key==='y'?0:0.1} max="100" step="0.1" value={Math.round(editor.region[key]*1000)/10} onChange={e => { setEditor({ ...editor, region: { ...editor.region, [key]: Number(e.target.value)/100 } }); setRegionConfirmed(true); }}/></label>)}</div></details></div>}
      {error && <p role="alert" className="feature-inline-error">{error}</p>}<div className="feature-dialog-actions"><button type="button" className="feature-button danger" disabled={saving || editor.kind === 'global' || editor.tier === 'foundation'} onClick={() => { if(board) void save({ ...board, cards: board.cards.filter(c => c.id !== editor.id) }).then(ok => { if(ok) closeEditor(); }); }}><Trash2 size={15}/>删除卡片</button><button className="feature-button primary" disabled={saving} type="submit"><Check size={16}/>保存修改</button></div>
      </fieldset></form></section></div>}
    {settings && <div className="feature-overlay"><section className="feature-modal" role="dialog" aria-modal="true" aria-label="生成设置"><div className="feature-dialog-head"><h2>生成设置</h2><button aria-label="关闭设置" onClick={() => setSettings(false)}><X/></button></div><p>用于特征提炼和 AI 补全。默认生成一级的四类基础规范，以及二级的图中辨识特征；应用时一级优先于二级。三级精细细节通过「发现更多细节」按需生成。卡片由你勾选，新增细节默认未选中。更新后对下一次生成生效，旧结果保持原配置。</p>{config && <><label>模型<input value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })}/></label><label>推理强度<select value={config.reasoningEffort} onChange={e => setConfig({ ...config, reasoningEffort: e.target.value })}>{['none','minimal','low','medium','high','xhigh','max','ultra'].map(x => <option key={x}>{x}</option>)}</select></label></>}<p className="feature-muted">复用本地 Codex 登录 · 单次最长 30 分钟<br/>{bootstrap?.runtime.version}</p><button className="feature-button primary" onClick={() => setSettings(false)}>完成</button></section></div>}
    {exported && <div className="feature-overlay"><section className="feature-export-modal" role="dialog" aria-modal="true" aria-label="导出图片预览"><div className="feature-dialog-head"><div><h2>带走你选中的设计特征</h2><p>{selected.length} 张卡片 · PNG · {exported.width} × {exported.height} px · 下面就是实际导出的图片</p></div><button aria-label="关闭导出" onClick={closeExport}><X/></button></div><div className="feature-export-image"><img src={exported.url} alt="仅包含已选卡片的视觉规范导出图"/></div><div className="feature-dialog-actions"><button className="feature-button" onClick={() => void copyInstruction()}><Copy size={16}/>复制配套指令</button><a className="feature-button primary" download={`Define-Pretty-${new Date().toISOString().slice(0,10)}.png`} href={exported.url}><Download size={16}/>下载 PNG</a></div></section></div>}
    {evidence && <div className="feature-overlay"><section className="feature-modal evidence" role="dialog" aria-modal="true" aria-label="生成记录"><div className="feature-dialog-head"><h2>记录与指令</h2><button aria-label="关闭记录" onClick={() => setEvidence('')}><X/></button></div><pre>{evidence}</pre></section></div>}
  </div>;
}
