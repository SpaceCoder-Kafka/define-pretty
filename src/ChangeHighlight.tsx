import { useEffect, useState } from 'react';
import { Loader2, Maximize2, X } from 'lucide-react';
import type { DimensionHighlightJob } from '../shared/types';
import { api, errorMessage } from './api';
import FullscreenPreview from './FullscreenPreview';

function Picture({ job, original }: { job: DimensionHighlightJob; original: boolean }) {
  const data = job.comparison;
  return <div className="change-picture">
    <img src={original ? data.baselineUrl : data.resultUrl} alt={original ? '本次运行使用的原始网页首屏' : '本维度润色结果首屏'} />
    <div key={String(original)} className="dimension-pulse" aria-hidden="true">
      <svg viewBox={`0 0 ${data.width} ${data.height}`} preserveAspectRatio="none">{(job.highlights ?? []).map(point => {
        const box = original ? point.baselineBox : point.box;
        return box ? <rect key={point.componentId} {...box} rx="7" /> : null;
      })}</svg>
      {(job.highlights ?? []).map((point, i) => {
        const box = original ? point.baselineBox : point.box;
        return box ? <span className="dimension-marker" key={point.componentId} style={{ left: `${Math.min(97, box.x / data.width * 100)}%`, top: `${Math.min(97, box.y / data.height * 100)}%` }}>{i + 1}</span> : null;
      })}
    </div>
  </div>;
}
export default function ChangeHighlight({ runId, name, onClose }: { runId: string; name: string; onClose: () => void }) {
  const [job, setJob] = useState<DimensionHighlightJob>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [original, setOriginal] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setJob(undefined); setError(''); setOriginal(false);
    const endpoint = `/runs/${runId}/dimension-highlights`;
    const update = async (first = false) => {
      try {
        let next = await api<DimensionHighlightJob | null>(endpoint, { signal: controller.signal });
        if (first && (!next || retry > 0)) next = await api<DimensionHighlightJob>(endpoint, { method: 'POST', signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!next) throw new Error('未找到维度差异分析，可点击重试。');
        setJob(next);
        if (['queued', 'running'].includes(next.status)) timer = setTimeout(() => { void update(); }, 2000);
        else if (next.status !== 'completed') setError(next.error ?? '识别未完成，请重试。');
      } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    };
    void update(true);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, retry]);
  const done = job?.status === 'completed';
  const details = done ? <div className="dimension-points">
    {job.highlights?.length ? <><p className="change-note">仅标注与「{job.dimension}」相关的差异 · 高亮 3 秒（含渐显渐隐）/ 隐藏 2 秒</p><ol>{job.highlights.map(point => <li key={point.componentId}><details><summary>{point.label}</summary><span>原始：{point.before}</span><span>结果：{point.after}</span><small>对应规范：{point.rule}</small></details></li>)}</ol></> : <p className="change-note">未识别到可确认的本维度差异点，不显示泛化高亮。</p>}
    {job.note && <p className="change-note">{job.note}</p>}
    <p className="change-attribution" title={`${job.model} · ${job.reasoningEffort}`}>AI 根据本次规范与前后画面识别 · 仅初始首屏</p>
  </div> : null;
  const switcher = <button className="btn small" aria-pressed={original} onClick={() => setOriginal(value => !value)}>{original ? '返回维度结果' : '查看原始画面'}</button>;
  return <div className="change-highlight">
    <div className="change-toolbar"><strong>本维度重点</strong>{done && switcher}<button className="icon-btn" aria-label="关闭维度标注" title="返回可操作的网页" onClick={onClose}><X size={14} /></button></div>
    {done ? <><Picture job={job} original={original} />{details}<div className="change-bottom"><span title={`原始页 ${job.comparison.baselineRunId}`}>绑定本次冻结原始页 · 1440 × 1000</span><button className="icon-btn" aria-label={`全屏查看${name}重点`} title="全屏查看维度重点" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></button></div></> : <div className="change-loading" role="status">{error ? <><span>{error}</span><button className="btn small" onClick={() => setRetry(value => value + 1)}>重试识别</button></> : <><Loader2 className="spin" size={20} /><span>{job?.status === 'queued' ? '等待识别本维度的重点变化…' : '正在结合规范与前后画面定位组件…'}</span><small>首次使用规范生成模型识别，完成后缓存；不重新生成网页。</small></>}</div>}
    {fullscreen && done && <FullscreenPreview name={`${name} · 维度重点`} onClose={() => setFullscreen(false)} content={<><div className="change-toolbar"><strong>{original ? '原始画面' : '本维度结果'}</strong>{switcher}</div><Picture job={job} original={original} />{details}</>} />}
  </div>;
}
