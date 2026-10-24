import { useEffect, useRef, useState } from 'react';
import { Maximize2, FlaskConical, LoaderCircle } from 'lucide-react';
import type { FeatureBoard } from '../shared/feature-board';
import { selectedFeatures } from '../shared/feature-board';
import type { FeatureTest, FeatureTestSource } from '../shared/feature-test';
import type { Bootstrap, ModelConfig } from '../shared/types';
import { api, errorMessage } from './api';
import { exportFeatureBoard } from './feature-export';
import FullscreenPreview from './FullscreenPreview';

const isActive = (run?: FeatureTest) => !!run && ['queued','running','checking'].includes(run.status);
const labels: Record<string,string> = {queued:'等待中',running:'Codex 修改中',checking:'检查网页加载',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export function useFeatureTests(board: FeatureBoard | undefined, bootstrap: Bootstrap | undefined) {
  const [source,setSource]=useState<FeatureTestSource>(), [runs,setRuns]=useState<FeatureTest[]>([]);
  const [selectedId,setSelectedId]=useState(''), [config,setConfig]=useState<ModelConfig>();
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{ if(!bootstrap)return; let live=true;
    void api<FeatureTestSource>('/feature-tests/source').then(value=>{if(live){setSource(value);setConfig({...value.config,provider:bootstrap.defaults.config.provider,cliVersion:bootstrap.defaults.config.cliVersion});}}).catch(cause=>{if(live)setError(errorMessage(cause));});
    return ()=>{live=false;};
  },[bootstrap?.token]);
  useEffect(()=>{ setRuns([]);setSelectedId('');if(!bootstrap || !board)return;let live=true;
    const refresh=()=>api<FeatureTest[]>(`/feature-tests?boardId=${board.id}`).then(next=>{if(live){setRuns(next);setSelectedId(current=>current || next[0]?.id || '');}}).catch(cause=>{if(live)setError(errorMessage(cause));});
    void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>{live=false;clearInterval(timer);};
  },[board?.id,bootstrap?.token]);
  const current=runs.find(run=>run.id===selectedId), running=runs.some(isActive);
  async function start() {
    if(!board || !config || !source || busy || running)return;
    setBusy(true);setError('');
    try {
      const snapshot=structuredClone(board), result=await exportFeatureBoard(snapshot);
      const form=new FormData();form.append('image',result.blob,'selected-features.png');form.append('boardId',snapshot.id);form.append('revision',String(snapshot.revision));form.append('config',JSON.stringify(config));
      const run=await api<FeatureTest>('/feature-tests',{method:'POST',body:form});
      setRuns(old=>[run,...old.filter(r=>r.id!==run.id)]);setSelectedId(run.id);
    } catch(cause){setError(errorMessage(cause));}finally{setBusy(false);section.current?.scrollIntoView({behavior:'smooth',block:'start'});}
  }
  async function cancel() { if(!current)return;setBusy(true);setError('');try{const next=await api<FeatureTest>(`/feature-tests/${current.id}/cancel`,{method:'POST'});setRuns(old=>old.map(r=>r.id===next.id?next:r));}catch(cause){setError(errorMessage(cause));}finally{setBusy(false);} }
  return {source,runs,current,selectedId,setSelectedId,config,setConfig,busy,error,running,start,cancel,section,origin:bootstrap?.previewOrigin || '',ready:!!source&&!!config&&!!bootstrap?.runtime.authenticated};
}
type State=ReturnType<typeof useFeatureTests>;
function Website({name,url,empty}: {name:string;url?:string;empty:string}) {
  const box=useRef<HTMLDivElement>(null), [scale,setScale]=useState(.4), [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{if(!box.current)return;const observer=new ResizeObserver(([entry])=>setScale(entry.contentRect.width/1440));observer.observe(box.current);return()=>observer.disconnect();},[]);
  return <article className="feature-test-page"><header><strong>{name}</strong><button className="feature-icon" aria-label={`全屏查看${name}`} disabled={!url} onClick={()=>setFullscreen(true)}><Maximize2 size={16}/></button></header><div ref={box} className="feature-test-viewport" style={{height:1000*scale}}>{url?<iframe title={name} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{transform:`scale(${scale})`}}/>:<p>{empty}</p>}</div>{fullscreen&&url&&<FullscreenPreview name={name} url={url} onClose={()=>setFullscreen(false)}/>}</article>;
}
export default function FeatureValidation({state}: {state:State}) {
  const {source,current,config}=state;
  const original=current?.source || source;
  return <section className="feature-validation" ref={state.section}>
    <div className="feature-validation-head"><div><h2><FlaskConical size={20}/>验证所选设计</h2><p>从同一份原始网页开始，将导出图片与配套指令交给 Codex，比较实际效果。</p></div><span>统一视口 · 1440 × 1000</span></div>
    {source&&<p className="feature-test-source">原网页：{source.title} · 版本 {source.versionNumber} · {new Date(source.createdAt).toLocaleString('zh-CN')} · 已冻结副本</p>}
    <div className="feature-test-controls">{config&&<><label>测试模型<input value={config.model} disabled={state.busy} onChange={e=>state.setConfig({...config,model:e.target.value})}/></label><label>推理强度<select value={config.reasoningEffort} disabled={state.busy} onChange={e=>state.setConfig({...config,reasoningEffort:e.target.value})}>{['none','minimal','low','medium','high','xhigh','max','ultra'].map(value=><option key={value}>{value}</option>)}</select></label><span>用于下一次测试 · 与卡片生成配置独立</span></>}
    {state.runs.length>0&&<label className="feature-test-history">测试历史<select value={state.selectedId} onChange={e=>state.setSelectedId(e.target.value)}>{state.runs.map((r,i)=><option key={r.id} value={r.id}>第 {state.runs.length-i} 次 · {new Date(r.createdAt).toLocaleTimeString('zh-CN')} · {labels[r.status]}</option>)}</select></label>}</div>
    {state.error&&<div className="feature-alert" role="alert">{state.error}</div>}
    {current&&<div className="feature-test-state"><div>{isActive(current)&&<LoaderCircle className="spin" size={16}/>}<strong>{labels[current.status]}</strong><span>{current.config.model} · {current.config.reasoningEffort} · {selectedFeatures(current.board).map(c=>c.title).join(' / ')}</span></div>{isActive(current)&&<button className="feature-button" disabled={state.busy} onClick={()=>void state.cancel()}>取消测试</button>}</div>}
    {current?.error&&<div className="feature-alert">{current.error}{current.hasPreview?' 已保留网页结果供查看。':''}</div>}
    {current?.status==='completed'&&current.changed===false&&<p className="feature-test-source">本次网页文件与原网页一致，未产生修改。</p>}
    <div className="feature-test-pair"><Website name="原始网页" url={original?`${state.origin}/feature-tests/sources/${original.runId}/index.html`:undefined} empty="正在读取主实验台最后一个实验的原网页…"/><Website name="优化后的网页" url={current?.hasPreview?`${state.origin}/feature-tests/runs/${current.id}/index.html`:undefined} empty={isActive(current)?'Codex 正在根据所选卡片修改网页…':'勾选卡片后，点击底部「测试所选设计」。'}/></div>
    {current&&<details className="feature-test-input"><summary>查看本次实际输入图片与完整指令</summary><div><img src={`/api/feature-tests/${current.id}/image`} alt="本次发送给 Codex 的所选卡片图片"/><pre>{current.prompt}</pre></div></details>}
  </section>;
}
