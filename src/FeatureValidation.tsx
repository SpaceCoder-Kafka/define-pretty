import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Maximize2, FlaskConical, LoaderCircle, Check, LayoutGrid, X, RefreshCw } from 'lucide-react';
import type { FeatureBoard } from '../shared/feature-board';
import { selectedFeatures } from '../shared/feature-board';
import type { FeatureTest, FeatureTestSource, FeatureSourceRun } from '../shared/feature-test';
import type { Bootstrap, ModelConfig } from '../shared/types';
import type { DraftPreview, ExecutionProgress } from '../shared/execution-progress';
import { api, errorMessage } from './api';
import { exportFeatureBoard } from './feature-export';
import FullscreenPreview from './FullscreenPreview';
import ModelSettings from './ModelSettings';
import { resolveModelConfig } from '../shared/model-options';

const isActive = (run?: {status: string}) => !!run && ['queued','running','checking'].includes(run.status);
const labels: Record<string,string> = {queued:'等待中',running:'Codex 修改中',checking:'检查网页加载',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export function useFeatureTests(board: FeatureBoard | undefined, bootstrap: Bootstrap | undefined) {
  const [runs,setRuns]=useState<FeatureTest[]>([]);
  const [selectedId,setSelectedId]=useState(''), [config,setConfig]=useState<ModelConfig>();
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false), [anyTestRunning,setAnyTestRunning]=useState(false);
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
    setConfig(resolveModelConfig({ ...bootstrap.defaults.config, reasoningEffort: 'medium' }, bootstrap.models || []));
    const refresh=async()=>{
      const [available,jobs,activity]=await Promise.all([api<FeatureTestSource[]>('/feature-tests/sources'),api<FeatureSourceRun[]>('/feature-source-runs'),api<{busy:boolean}>('/onboarding-availability')]);
      if(!live)return;
      setSources(available);setSourceRuns(jobs);setAnyTestRunning(activity.busy);setLoaded(true);
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
  async function refine(feedback:string) {
    if(!current?.hasPreview || isActive(current) || !config || busy || running || !feedback.trim())return;
    previewChosen.current=true;
    setBusy(true);setError('');
    try {
      const run=await api<FeatureTest>(`/feature-tests/${current.id}/refine`,{method:'POST',body:JSON.stringify({feedback:feedback.trim(),config})});
      setRuns(old=>[run,...old.filter(r=>r.id!==run.id)]);setSelectedId(run.id);
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);section.current?.scrollIntoView({behavior:'smooth',block:'start'});}
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
  const refinementUsesSavedInput=!!current&&((board?.id!==current.boardId || board?.revision!==current.boardRevision)||(!!source&&source.runId!==current.source.runId));
  return {loaded,anyTestRunning,models:bootstrap?.models || [],localModel:bootstrap?.defaults.config.model,modelCatalogError:bootstrap?.modelCatalogError,sources,sourceRuns,sourceId,chooseSource,requirements,setRequirements,generateSource,cancelSource,sourceRunning,authenticated:!!bootstrap?.runtime.authenticated,source,runs,current,selectedId,setSelectedId:chooseHistory,config,setConfig,busy,error,running,start,refine,refinementUsesSavedInput,cancel,section,origin:bootstrap?.previewOrigin || '',ready:!!source&&!!config&&!!bootstrap?.runtime.authenticated};
}
type State=ReturnType<typeof useFeatureTests>;
type ProgressRun = { id:string; status:string; createdAt:string; finishedAt?:string; elapsedMs?:number; progress?:ExecutionProgress; draftPreview?:DraftPreview };
function duration(milliseconds:number) {
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}
function RunProgress({run}: {run:ProgressRun}) {
  const active=isActive(run), [now,setNow]=useState(Date.now);
  useEffect(()=>{
    setNow(Date.now());
    if(!active)return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[run.id,active]);
  const progress=run.progress;
  const end=active?now:Date.parse(run.finishedAt || '') || Date.parse(progress?.updatedAt || '') || Date.parse(run.createdAt);
  const elapsed=!active&&run.elapsedMs!==undefined?run.elapsedMs:end-Date.parse(run.createdAt);
  const activityAge=progress?Math.max(0,now-Date.parse(progress.updatedAt)):0;
  const activeAgents=progress?.agents.filter(agent=>agent.status==='running').length || 0;
  const agentLabels={running:'进行中',completed:'已完成',failed:'失败',closed:'已结束'};
  return <div className="feature-run-progress">
    <div className="feature-run-progress-meta"><span>{active?'已用时':'耗时'} <strong>{duration(elapsed)}</strong></span>{progress&&<><span>已完成 {progress.completedActions} 步</span>{progress.failedActions>0&&<span className="feature-run-retries">失败尝试 {progress.failedActions} 次</span>}{progress.agents.length>0&&<span>{activeAgents>0?`${activeAgents} 个子代理进行中`:`${progress.agents.length} 个子代理参与`}</span>}</>}</div>
    {active&&progress?.message&&<p className="feature-run-message" role="status">{run.status==='checking'?'正在检查网页加载':progress.message}</p>}
    {active&&progress&&<p className={`feature-run-activity${activityAge>=120000?' is-quiet':''}`}>{activityAge>=120000?`${duration(activityAge)} 没有新活动，可能仍在处理。`:`最近活动：${activityAge<1000?'刚刚':`${duration(activityAge)}前`}`}</p>}
    {active&&!progress&&<p className="feature-run-activity">正在执行，尚无可显示的活动记录。</p>}
    {active&&!!progress?.activeActions.length&&<ul className="feature-run-actions">{progress.activeActions.map(action=><li key={action.id}><LoaderCircle className="spin" size={12}/><span>{action.label}</span><small>{duration(now-Date.parse(action.startedAt))}</small></li>)}</ul>}
    {!!progress?.agents.length&&<div className="feature-run-agents" aria-label="子代理任务">{progress.agents.map(agent=><span key={agent.id} className={`feature-run-agent is-${agent.status}`}><i aria-hidden="true"/>{agent.label} · {agentLabels[agent.status]}</span>)}</div>}
  </div>;
}
export function Website({name,url,empty,actions,note}: {name:string;url?:string;empty:string;actions?:ReactNode;note?:string}) {
  const box=useRef<HTMLDivElement>(null), [scale,setScale]=useState(.4), [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{if(!box.current)return;const observer=new ResizeObserver(([entry])=>setScale(entry.contentRect.width/1440));observer.observe(box.current);return()=>observer.disconnect();},[]);
  return <article className="feature-test-page"><header><div className="feature-test-page-title"><strong>{name}</strong>{note&&<span>{note}</span>}</div><div className="feature-test-page-actions">{actions}<button className="feature-icon" aria-label={`全屏查看${name}`} disabled={!url} onClick={()=>setFullscreen(true)}><Maximize2 size={16}/></button></div></header><div ref={box} className="feature-test-viewport" style={{height:1000*scale}}>{url?<iframe title={name} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{transform:`scale(${scale})`}}/>:<p>{empty}</p>}</div>{fullscreen&&url&&<FullscreenPreview name={name} url={url} onClose={()=>setFullscreen(false)}/>}</article>;
}
export function DemoValidation({origin,ready}: {origin:string;ready:boolean}) {
  return <section className="feature-validation" aria-label="示例网页对比">
    <div className="feature-validation-head"><div><h2><FlaskConical size={20}/>验证所选设计</h2><p>把所选设计应用到自己的网页，直观看到优化前后的变化。</p></div><span>快速体验 · 示例</span></div>
    <div className="feature-test-pair" data-tour="result">
      <Website name="原始网页" url={`${origin}/onboarding/v1/original/index.html`} empty="正在读取示例…"/>
      <Website name="优化后的网页" url={ready?`${origin}/onboarding/v1/optimized/index.html`:undefined} empty="点击“验证所选设计”，查看预先生成的示例效果。" note={ready?'预先生成的示例效果':undefined}/>
    </div>
  </section>;
}
function GeneratedWebsite({run,name,baseUrl,finalReady,empty}: {run?:ProgressRun;name:string;baseUrl?:string;finalReady:boolean;empty:string}) {
  const [viewedDraft,setViewedDraft]=useState<{id:string;version?:string}>();
  const latest=run?.draftPreview?.updatedAt;
  useEffect(()=>{
    if(!run){setViewedDraft(undefined);return;}
    setViewedDraft(previous=>previous?.id===run.id&&previous.version?previous:{id:run.id,version:latest});
  },[run?.id,latest]);
  const version=viewedDraft?.id===run?.id?viewedDraft?.version || latest:latest;
  const draft=!finalReady&&!!latest;
  const url=baseUrl&&(finalReady?`${baseUrl}?revision=${encodeURIComponent(run?.finishedAt || run?.status || 'final')}`:draft?`${baseUrl}?revision=${encodeURIComponent(version || '')}`:undefined);
  const newer=!!latest&&latest!==version;
  return <Website name={name} url={url} empty={empty} note={draft?isActive(run)?'阶段预览 · 仍在生成':'阶段预览 · 未完成验收':undefined} actions={draft&&<button className="feature-button" onClick={()=>{if(run)setViewedDraft({id:run.id,version:latest});}} disabled={!newer} aria-label={`刷新${name}阶段预览`}><RefreshCw size={13}/>{newer?'查看更新':'已是最新预览'}</button>}/>;
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

function ImplementationSummary({summary}: {summary?:string}) {
  return summary?.trim() ? <details className="feature-implementation-summary"><summary>实施说明</summary><pre>{summary}</pre></details> : null;
}

function SourcePicker({state,onClose}: {state:State;onClose:()=>void}) {
  const dialogRef=useRef<HTMLDialogElement>(null), titleId=useId();
  const customSource=useRef<HTMLDetailsElement>(null);
  const [previewSource,setPreviewSource]=useState<FeatureTestSource>();
  const {source,config}=state;
  const sourceJob=state.sourceRuns[0];
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
          {config&&<div className="feature-test-controls"><ModelSettings config={config} models={state.models} localModel={state.localModel} error={state.modelCatalogError} onChange={state.setConfig} modelLabel="生成模型" disabled={state.busy||state.running}/><span>与测试模型共用设置</span></div>}
          <div className="feature-source-actions"><button className="feature-button primary" disabled={!state.requirements.trim()||state.busy||state.running||!state.authenticated||!config} onClick={()=>void state.generateSource()}>{state.sourceRunning?<LoaderCircle className="spin" size={16}/>:null}{state.sourceRunning?'原网页生成中…':'生成原始网页'}</button><span>最长 30 分钟 · 关闭弹窗后继续生成</span></div>
          {sourceJob&&<><div className="feature-source-job" role="status"><span>{isActive(sourceJob)?'原网页生成中':labels[sourceJob.status]} · {sourceJob.requirements.slice(0,60)}{sourceJob.error&&`：${sourceJob.error}`}</span>{isActive(sourceJob)&&<button className="feature-button" disabled={state.busy} onClick={()=>void state.cancelSource(sourceJob.id)}>取消生成</button>}</div><RunProgress run={sourceJob}/></>}
          {sourceJob?.draftPreview&&<GeneratedWebsite run={sourceJob} name={isActive(sourceJob)?'生成中的原网页':'生成的原网页'} baseUrl={`${state.origin}/feature-tests/source-runs/${sourceJob.id}/index.html`} finalReady={['checking','completed'].includes(sourceJob.status)} empty="首个可预览版本完成后会显示在这里。"/>}
          <ImplementationSummary summary={sourceJob?.summary}/>
          {state.sourceRuns.length>0&&<details><summary>原网页生成历史（{state.sourceRuns.length}）</summary>{state.sourceRuns.map(r=><div key={r.id}><div className="feature-source-job"><span>{new Date(r.createdAt).toLocaleString('zh-CN')} · {isActive(r)?'生成中':labels[r.status]} · {r.requirements.slice(0,100)}{r.error&&`：${r.error}`}</span>{r.status==='completed'&&<button className="feature-button" disabled={state.busy||state.running} onClick={()=>chooseSource(r.id)}>使用此页</button>}</div><ImplementationSummary summary={r.summary}/></div>)}</details>}
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
  const [feedback,setFeedback]=useState(''), feedbackId=useId();
  useEffect(()=>{setFeedback('');},[current?.id]);
  const parentIndex=current?.refinement?state.runs.findIndex(run=>run.id===current.refinement!.parentTestId):-1;
  return <section className="feature-validation" id="original-websites" ref={state.section}>
    <div className="feature-validation-head"><div><h2><FlaskConical size={20}/>验证所选设计</h2><p>从冻结的原网页开始，借鉴所选特征的风格，为当前网站创作素材；可按反馈继续优化。</p></div><span>统一视口 · 1440 × 1000</span></div>
    {original&&<p className="feature-test-source">{current?'本次历史对比的原网页':'当前原网页'}：{original.title} · {original.builtin?'内置网页':new Date(original.createdAt).toLocaleString('zh-CN')} · 已冻结副本{current&&source&&source.runId!==original.runId?`（下一次测试将使用「${source.title}」）`:''}</p>}
    <div className="feature-test-controls">{config&&<><ModelSettings config={config} models={state.models} localModel={state.localModel} error={state.modelCatalogError} onChange={state.setConfig} modelLabel="测试模型" disabled={state.busy}/><span>用于生成原网页、测试与继续优化 · 与卡片生成配置独立</span></>}
    {state.runs.length>0&&<label className="feature-test-history">测试历史<select value={state.selectedId} onChange={e=>state.setSelectedId(e.target.value)}><option value="">当前原网页 · 尚未选择测试结果</option>{state.runs.map((r,i)=><option key={r.id} value={r.id}>第 {state.runs.length-i} 次 · {new Date(r.createdAt).toLocaleTimeString('zh-CN')} · {labels[r.status]}</option>)}</select></label>}</div>
    {state.error&&<div className="feature-alert" role="alert">{state.error}</div>}
    {current&&<div className="feature-test-state"><div>{isActive(current)&&<LoaderCircle className="spin" size={16}/>}<strong>{labels[current.status]}</strong><span>{current.config.model} · {current.config.reasoningEffort} · {selectedFeatures(current.board).map(c=>c.title).join(' / ')}</span></div>{isActive(current)&&<button className="feature-button" disabled={state.busy} onClick={()=>void state.cancel()}>取消测试</button>}</div>}
    {current&&<RunProgress run={current}/>}
    {current?.error&&<div className="feature-alert">{current.error}{current.hasPreview?' 已保留网页结果供查看。':''}</div>}
    <ImplementationSummary summary={current?.summary}/>
    {current?.refinement&&<div className="feature-refinement-history"><strong>{parentIndex>=0?`基于第 ${state.runs.length-parentIndex} 次结果继续优化`:'基于历史结果继续优化'}</strong><p>{current.refinement.feedback}</p></div>}
    {current?.status==='completed'&&current.changed===false&&<p className="feature-test-source">本次网页文件与原网页一致，未产生修改。</p>}
    <div className="feature-test-pair"><Website name="原始网页" url={original?`${state.origin}/feature-tests/sources/${original.runId}/index.html`:undefined} empty="点击「更换网页」选择内置场景，或自定义生成网页。" actions={<button className="feature-button" aria-haspopup="dialog" onClick={()=>setSourcePickerOpen(true)}>{state.sourceRunning?<LoaderCircle className="spin" size={14}/>:<LayoutGrid size={14}/>} {state.sourceRunning?'查看生成进度':'更换网页'}</button>}/><GeneratedWebsite run={current} name="优化后的网页" baseUrl={current?`${state.origin}/feature-tests/runs/${current.id}/index.html`:undefined} finalReady={!!current?.hasPreview} empty={isActive(current)?'Codex 正在根据所选卡片修改网页，首个阶段预览完成后会显示在这里。':'勾选卡片后，点击底部「测试所选设计」。'}/></div>
    {current?.hasPreview&&!isActive(current)&&<div className="feature-refinement">
      <label htmlFor={feedbackId}>希望继续改进什么</label>
      <p>继续修改此结果，沿用它保存的卡片选择、参考图和原网页，每轮结果都会保留。</p>
      {state.refinementUsesSavedInput&&<p className="feature-refinement-scope">当前卡片版本或原网页选择与此结果不同。要应用当前选择，请使用「测试所选设计」。</p>}
      <textarea id={feedbackId} rows={3} maxLength={4000} disabled={state.busy||state.running} value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder="例如：沿用参考图的线描、色面与质感，围绕本站业务主题重新设计插画，并检查标题与留白比例。"/>
      <button className="feature-button primary" disabled={!feedback.trim()||state.busy||state.running||!state.authenticated||!config} onClick={()=>void state.refine(feedback)}>继续优化此结果</button>
    </div>}
    {current&&<details className="feature-test-input"><summary>查看本次实际输入图片与完整指令</summary><div><div className="feature-test-input-images"><figure><figcaption>图片 1 · 所选卡片图</figcaption><img src={`/api/feature-tests/${current.id}/image`} alt="本次发送给 Codex 的所选卡片图片"/></figure>{current.originalReference&&<figure><figcaption>图片 2 · 无标记原图</figcaption><p>提供已选特征的风格依据，素材主题与用途以当前网站为准。</p><img src={`/api/feature-tests/${current.id}/original-reference`} alt="本次发送给 Codex 的冻结无标记原图"/></figure>}</div><pre>{current.prompt}</pre></div></details>}
    {sourcePickerOpen&&<SourcePicker state={state} onClose={()=>setSourcePickerOpen(false)}/>}
  </section>;
}
