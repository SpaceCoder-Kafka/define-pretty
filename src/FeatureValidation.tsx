import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Maximize2, FlaskConical, LoaderCircle, Check, LayoutGrid, X } from 'lucide-react';
import type { FeatureBoard } from '../shared/feature-board';
import { selectedFeatures } from '../shared/feature-board';
import type { FeatureTest, FeatureTestSource, FeatureSourceRun } from '../shared/feature-test';
import type { Bootstrap, ModelConfig } from '../shared/types';
import { api, errorMessage } from './api';
import { exportFeatureBoard } from './feature-export';
import FullscreenPreview from './FullscreenPreview';

const isActive = (run?: {status: string}) => !!run && ['queued','running','checking'].includes(run.status);
const labels: Record<string,string> = {queued:'等待中',running:'Codex 修改中',checking:'检查网页加载',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export function useFeatureTests(board: FeatureBoard | undefined, bootstrap: Bootstrap | undefined) {
  const [runs,setRuns]=useState<FeatureTest[]>([]);
  const [selectedId,setSelectedId]=useState(''), [config,setConfig]=useState<ModelConfig>();
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [sources,setSources]=useState<FeatureTestSource[]>([]), [sourceRuns,setSourceRuns]=useState<FeatureSourceRun[]>([]);
  const [requirements,setRequirements]=useState(()=>localStorage.getItem('pretty-source-requirements') || '');
  const [sourceId,setSourceId]=useState(()=>localStorage.getItem('pretty-source-id') || '');
  const pendingSource=useRef('');
  const previewChosen=useRef(false);
  const section=useRef<HTMLElement>(null);
  const source=sources.find(s=>s.runId===sourceId);
  useEffect(()=>{localStorage.setItem('pretty-source-requirements',requirements);},[requirements]);
  useEffect(()=>{
    if(!source)return;
    localStorage.setItem('pretty-source-id',sourceId);
    if(source.builtin)localStorage.setItem('pretty-source-builtin',source.builtin.slug);
    else localStorage.removeItem('pretty-source-builtin');
  },[sourceId,source?.builtin?.slug]);
  useEffect(()=>{ if(!bootstrap)return; let live=true;
    setConfig(bootstrap.defaults.config);
    const refresh=async()=>{
      const [available,jobs]=await Promise.all([api<FeatureTestSource[]>('/feature-tests/sources'),api<FeatureSourceRun[]>('/feature-source-runs')]);
      if(!live)return;
      setSources(available);setSourceRuns(jobs);
      setSourceId(id=>available.some(s=>s.runId===id)?id:available.find(s=>s.builtin?.slug===localStorage.getItem('pretty-source-builtin'))?.runId || available[0]?.runId || '');
      const pending=jobs.find(j=>j.id===pendingSource.current);
      if(pending && !isActive(pending)) {
        if(pending.status==='completed' && available.some(s=>s.runId===pending.id)){previewChosen.current=true;setSourceId(pending.id);setSelectedId('');pendingSource.current='';}
        else if(pending.status!=='completed')pendingSource.current='';
      }
    };
    void refresh().catch(cause=>{if(live)setError(errorMessage(cause));});
    const timer=setInterval(()=>void refresh().catch(cause=>{if(live)setError(errorMessage(cause));}),2000);
    return ()=>{live=false;clearInterval(timer);};
  },[bootstrap?.token]);
  useEffect(()=>{ setRuns([]);setSelectedId('');if(!bootstrap || !board)return;let live=true, initial=true;
    // A late initial history response must not replace a source the user just chose.
    const refresh=()=>api<FeatureTest[]>(`/feature-tests?boardId=${board.id}`).then(next=>{if(live){setRuns(next);if(initial){if(!previewChosen.current)setSelectedId(next[0]?.id || '');initial=false;}}}).catch(cause=>{if(live)setError(errorMessage(cause));});
    void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>{live=false;clearInterval(timer);};
  },[board?.id,bootstrap?.token]);
  const current=runs.find(run=>run.id===selectedId), sourceRunning=sourceRuns.some(isActive), running=runs.some(isActive)||sourceRunning;
  async function start() {
    if(!board || !config || !source || busy || running)return;
    previewChosen.current=true;
    setBusy(true);setError('');
    try {
      const snapshot=structuredClone(board), result=await exportFeatureBoard(snapshot);
      const form=new FormData();form.append('image',result.blob,'selected-features.png');form.append('boardId',snapshot.id);form.append('revision',String(snapshot.revision));form.append('config',JSON.stringify(config));form.append('sourceId',source.runId);
      const run=await api<FeatureTest>('/feature-tests',{method:'POST',body:form});
      setRuns(old=>[run,...old.filter(r=>r.id!==run.id)]);setSelectedId(run.id);
    } catch(cause){setError(errorMessage(cause));}finally{setBusy(false);section.current?.scrollIntoView({behavior:'smooth',block:'start'});}
  }
  async function cancel() { if(!current)return;setBusy(true);setError('');try{const next=await api<FeatureTest>(`/feature-tests/${current.id}/cancel`,{method:'POST'});setRuns(old=>old.map(r=>r.id===next.id?next:r));}catch(cause){setError(errorMessage(cause));}finally{setBusy(false);} }
  async function generateSource() {
    if(!config || busy || running || !requirements.trim())return;
    setBusy(true);setError('');
    try {
      const job=await api<FeatureSourceRun>('/feature-source-runs',{method:'POST',body:JSON.stringify({requirements,config})});
      pendingSource.current=job.id;setSourceRuns(old=>[job,...old]);
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  }
  async function cancelSource(id:string) {
    setBusy(true);setError('');
    try {const job=await api<FeatureSourceRun>(`/feature-source-runs/${id}/cancel`,{method:'POST'});setSourceRuns(old=>old.map(r=>r.id===id?job:r));}
    catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  }
  function chooseSource(id:string) {previewChosen.current=true;setSourceId(id);setSelectedId('');}
  function chooseHistory(id:string) {previewChosen.current=true;setSelectedId(id);}
  return {sources,sourceRuns,sourceId,chooseSource,requirements,setRequirements,generateSource,cancelSource,sourceRunning,authenticated:!!bootstrap?.runtime.authenticated,source,runs,current,selectedId,setSelectedId:chooseHistory,config,setConfig,busy,error,running,start,cancel,section,origin:bootstrap?.previewOrigin || '',ready:!!source&&!!config&&!!bootstrap?.runtime.authenticated};
}
type State=ReturnType<typeof useFeatureTests>;
function Website({name,url,empty,actions}: {name:string;url?:string;empty:string;actions?:ReactNode}) {
  const box=useRef<HTMLDivElement>(null), [scale,setScale]=useState(.4), [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{if(!box.current)return;const observer=new ResizeObserver(([entry])=>setScale(entry.contentRect.width/1440));observer.observe(box.current);return()=>observer.disconnect();},[]);
  return <article className="feature-test-page"><header><strong>{name}</strong><div className="feature-test-page-actions">{actions}<button className="feature-icon" aria-label={`全屏查看${name}`} disabled={!url} onClick={()=>setFullscreen(true)}><Maximize2 size={16}/></button></div></header><div ref={box} className="feature-test-viewport" style={{height:1000*scale}}>{url?<iframe title={name} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{transform:`scale(${scale})`}}/>:<p>{empty}</p>}</div>{fullscreen&&url&&<FullscreenPreview name={name} url={url} onClose={()=>setFullscreen(false)}/>}</article>;
}

function BuiltinSourceCard({source,origin,selected,disabled,onChoose,onPreview}: {source:FeatureTestSource;origin:string;selected:boolean;disabled:boolean;onChoose:()=>void;onPreview:()=>void}) {
  const box=useRef<HTMLButtonElement>(null), [scale,setScale]=useState(.2);
  useEffect(()=>{
    if(!box.current)return;
    const observer=new ResizeObserver(([entry])=>setScale(entry.contentRect.width/1440));
    observer.observe(box.current);return()=>observer.disconnect();
  },[]);
  return <article className={`feature-builtin-card${selected?' is-selected':''}`}>
    <button ref={box} className="feature-builtin-preview" aria-label={`预览${source.title}`} onClick={onPreview}>
      <iframe title={`${source.title}缩略图`} src={`${origin}/feature-tests/sources/${source.runId}/index.html`} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" tabIndex={-1} aria-hidden="true" style={{transform:`scale(${scale})`}}/>
      <span className="feature-builtin-expand"><Maximize2 size={13}/>预览</span>
    </button>
    <div className="feature-builtin-info"><div><h3>{source.title}</h3><span>{source.builtin?.style==='neon'?'深色霓虹':'经典渐变'}</span></div><p>{source.builtin?.description}</p>
      <button className={`feature-button${selected?' primary':''}`} disabled={disabled} aria-label={`使用${source.title}`} aria-pressed={selected} onClick={onChoose}>{selected?<><Check size={14}/>已选为原网页</>:'使用此页'}</button>
    </div>
  </article>;
}

function SourcePicker({state,onClose}: {state:State;onClose:()=>void}) {
  const dialogRef=useRef<HTMLDialogElement>(null), titleId=useId();
  const customSource=useRef<HTMLDetailsElement>(null);
  const [previewSource,setPreviewSource]=useState<FeatureTestSource>();
  const {source,config}=state;
  const builtins=state.sources.filter(s=>s.builtin).sort((a,b)=>a.builtin!.order-b.builtin!.order);
  const personal=state.sources.filter(s=>!s.builtin);
  useEffect(()=>{
    const dialog=dialogRef.current!;
    const before=document.activeElement as HTMLElement|null, overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.showModal();
    return ()=>{dialog.close();document.body.style.overflow=overflow;before?.focus();};
  },[]);
  useEffect(()=>{
    if((state.sourceRunning||state.sourceRuns[0]?.error)&&customSource.current) {
      customSource.current.open=true;
      customSource.current.scrollIntoView({block:'nearest'});
    }
  },[state.sourceRunning,state.sourceRuns[0]?.error]);
  function chooseSource(id:string) {
    if(state.busy||state.running)return;
    state.chooseSource(id);onClose();
  }
  return <dialog ref={dialogRef} className="feature-source-picker" aria-labelledby={titleId} onCancel={event=>{if(event.target===event.currentTarget){event.preventDefault();onClose();}}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="feature-dialog-head"><div><h2 id={titleId}>选择原始网页</h2><p>点击「使用此页」替换当前原网页，用于下一次设计测试。</p></div><button autoFocus className="feature-icon" aria-label="关闭网页选择" onClick={onClose}><X size={20}/></button></div>
    <div className="feature-source-picker-body">
      <div className="feature-source-library-head"><div><h3><LayoutGrid size={17}/>内置原始网页 <span>{builtins.length} 款</span></h3><p>选择网页场景，点击缩略图可全屏预览。</p></div><span>无需生成 · 选中即用</span></div>
      {builtins.length>0?<div className="feature-builtin-grid">{builtins.map(s=><BuiltinSourceCard key={s.runId} source={s} origin={state.origin} selected={state.sourceId===s.runId} disabled={state.busy||state.running} onChoose={()=>chooseSource(s.runId)} onPreview={()=>setPreviewSource(s)}/>)}</div>:<p className="feature-source-loading">{state.error?'内置网页暂不可用，请查看下方错误信息。':'正在读取内置网页…'}</p>}
      {source&&<div className="feature-source-choice" role="status"><span>下一次测试：<strong>{source.title}</strong><span className="feature-source-kind">{source.builtin?'内置网页':'我的原网页'}</span></span><button className="feature-button" onClick={()=>setPreviewSource(source)}><Maximize2 size={14}/>预览所选网页</button></div>}
      {personal.length>0&&<label className="feature-personal-sources">我的原网页<select aria-label="选择已生成或历史原网页" value="" disabled={state.busy||state.running} onChange={e=>{if(e.target.value)chooseSource(e.target.value);}}><option value="" disabled>选择已生成或历史原网页（{personal.length}）</option>{personal.map(s=><option key={s.runId} value={s.runId}>{s.title} · {new Date(s.createdAt).toLocaleString('zh-CN')}{state.sourceId===s.runId?' · 已选中':''}</option>)}</select></label>}
      <details className="feature-source-builder" ref={customSource}>
        <summary>自定义原始网页 <span>没有合适的内置网页时，可以自己生成</span></summary>
        <div className="feature-source-builder-content">
          <label htmlFor="source-requirements"><strong>描述你的网页需求</strong></label>
          <p>Codex 会根据需求生成页面，完成后自动设为原网页，再应用你选中的设计特征。</p>
          <textarea id="source-requirements" rows={3} maxLength={12000} value={state.requirements} onChange={e=>state.setRequirements(e.target.value)} placeholder="例如：生成一个中文个人博客，包含作者介绍、文章列表、分类筛选和文章详情；或制作一个产品设计师的个人简历页。"/>
          {config&&<div className="feature-test-controls"><label>生成模型<input value={config.model} disabled={state.busy||state.running} onChange={e=>state.setConfig({...config,model:e.target.value})}/></label><label>推理强度<select value={config.reasoningEffort} disabled={state.busy||state.running} onChange={e=>state.setConfig({...config,reasoningEffort:e.target.value})}>{['none','minimal','low','medium','high','xhigh','max','ultra'].map(value=><option key={value}>{value}</option>)}</select></label><span>与测试模型共用设置</span></div>}
          <div className="feature-source-actions"><button className="feature-button primary" disabled={!state.requirements.trim()||state.busy||state.running||!state.authenticated||!config} onClick={()=>void state.generateSource()}>{state.sourceRunning?<LoaderCircle className="spin" size={16}/>:null}{state.sourceRunning?'原网页生成中…':'生成原始网页'}</button><span>最长 30 分钟 · 关闭弹窗后继续生成</span></div>
          {state.sourceRuns[0]&&<div className="feature-source-job" role="status"><span>{isActive(state.sourceRuns[0])?'原网页生成中':labels[state.sourceRuns[0].status]} · {state.sourceRuns[0].requirements.slice(0,60)}{state.sourceRuns[0].error&&`：${state.sourceRuns[0].error}`}</span>{isActive(state.sourceRuns[0])&&<button className="feature-button" disabled={state.busy} onClick={()=>void state.cancelSource(state.sourceRuns[0].id)}>取消生成</button>}</div>}
          {state.sourceRuns.length>0&&<details><summary>原网页生成历史（{state.sourceRuns.length}）</summary>{state.sourceRuns.map(r=><div key={r.id} className="feature-source-job"><span>{new Date(r.createdAt).toLocaleString('zh-CN')} · {isActive(r)?'生成中':labels[r.status]} · {r.requirements.slice(0,100)}{r.error&&`：${r.error}`}</span>{r.status==='completed'&&<button className="feature-button" disabled={state.busy||state.running} onClick={()=>chooseSource(r.id)}>使用此页</button>}</div>)}</details>}
        </div>
      </details>
      {state.error&&<div className="feature-alert" role="alert">{state.error}</div>}
    </div>
    {previewSource&&<FullscreenPreview name={previewSource.title} url={`${state.origin}/feature-tests/sources/${previewSource.runId}/index.html`} onClose={()=>setPreviewSource(undefined)}/>}
  </dialog>;
}

export default function FeatureValidation({state}: {state:State}) {
  const {source,current,config}=state;
  const original=current?.source || source;
  const [sourcePickerOpen,setSourcePickerOpen]=useState(false);
  return <section className="feature-validation" id="original-websites" ref={state.section}>
    <div className="feature-validation-head"><div><h2><FlaskConical size={20}/>验证所选设计</h2><p>从同一份原始网页开始，将导出图片与配套指令交给 Codex，比较实际效果。</p></div><span>统一视口 · 1440 × 1000</span></div>
    {original&&<p className="feature-test-source">{current?'本次历史对比的原网页':'当前原网页'}：{original.title} · {original.builtin?'内置网页':new Date(original.createdAt).toLocaleString('zh-CN')} · 已冻结副本{current&&source&&source.runId!==original.runId?`（下一次测试将使用「${source.title}」）`:''}</p>}
    <div className="feature-test-controls">{config&&<><label>测试模型<input value={config.model} disabled={state.busy} onChange={e=>state.setConfig({...config,model:e.target.value})}/></label><label>推理强度<select value={config.reasoningEffort} disabled={state.busy} onChange={e=>state.setConfig({...config,reasoningEffort:e.target.value})}>{['none','minimal','low','medium','high','xhigh','max','ultra'].map(value=><option key={value}>{value}</option>)}</select></label><span>用于生成原网页与下一次测试 · 与卡片生成配置独立</span></>}
    {state.runs.length>0&&<label className="feature-test-history">测试历史<select value={state.selectedId} onChange={e=>state.setSelectedId(e.target.value)}><option value="">当前原网页 · 尚未选择测试结果</option>{state.runs.map((r,i)=><option key={r.id} value={r.id}>第 {state.runs.length-i} 次 · {new Date(r.createdAt).toLocaleTimeString('zh-CN')} · {labels[r.status]}</option>)}</select></label>}</div>
    {state.error&&<div className="feature-alert" role="alert">{state.error}</div>}
    {current&&<div className="feature-test-state"><div>{isActive(current)&&<LoaderCircle className="spin" size={16}/>}<strong>{labels[current.status]}</strong><span>{current.config.model} · {current.config.reasoningEffort} · {selectedFeatures(current.board).map(c=>c.title).join(' / ')}</span></div>{isActive(current)&&<button className="feature-button" disabled={state.busy} onClick={()=>void state.cancel()}>取消测试</button>}</div>}
    {current?.error&&<div className="feature-alert">{current.error}{current.hasPreview?' 已保留网页结果供查看。':''}</div>}
    {current?.status==='completed'&&current.changed===false&&<p className="feature-test-source">本次网页文件与原网页一致，未产生修改。</p>}
    <div className="feature-test-pair"><Website name="原始网页" url={original?`${state.origin}/feature-tests/sources/${original.runId}/index.html`:undefined} empty="点击「更换网页」选择内置场景，或自定义生成网页。" actions={<button className="feature-button" aria-haspopup="dialog" onClick={()=>setSourcePickerOpen(true)}>{state.sourceRunning?<LoaderCircle className="spin" size={14}/>:<LayoutGrid size={14}/>} {state.sourceRunning?'查看生成进度':'更换网页'}</button>}/><Website name="优化后的网页" url={current?.hasPreview?`${state.origin}/feature-tests/runs/${current.id}/index.html`:undefined} empty={isActive(current)?'Codex 正在根据所选卡片修改网页…':'勾选卡片后，点击底部「测试所选设计」。'}/></div>
    {current&&<details className="feature-test-input"><summary>查看本次实际输入图片与完整指令</summary><div><img src={`/api/feature-tests/${current.id}/image`} alt="本次发送给 Codex 的所选卡片图片"/><pre>{current.prompt}</pre></div></details>}
    {sourcePickerOpen&&<SourcePicker state={state} onClose={()=>setSourcePickerOpen(false)}/>}
  </section>;
}
