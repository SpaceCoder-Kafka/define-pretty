import ChangeHighlight from './ChangeHighlight';
import FullscreenPreview from './FullscreenPreview';
import RuleWorkbench from './RuleWorkbench';
import { experimentGroups } from '../shared/groups';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Check, CheckCheck, CheckCircle2,
  ChevronRight, Circle, Clock3, Columns2, FileText,
  FlaskConical, Grid2X2, ImagePlus, Info, Layers3, LayoutDashboard,
  Loader2, Maximize2, Monitor, MousePointer2, Palette, Play, Plus, RefreshCw,
  Save, ShieldCheck, SlidersHorizontal, Sparkles, Square,
  TextCursorInput, TriangleAlert, Type, X,
} from 'lucide-react';
import { type Bootstrap, type DimensionId, type DimensionRule,
  type Experiment, type ExperimentDetail, type ExperimentInput, type ExperimentVersion,
  type GroupId, type ReferenceAsset, type Review, type Run, type RunDetails, type RunStatus } from '../shared/types';
import { api, errorMessage, setApiToken } from './api';

type Tab = 'setup' | 'compare' | 'records';
const GROUP_NAMES: Record<GroupId, string> = {
  baseline: '原始网页', direct: '直接参考图', 'all-rules': '参考图+文字规范', 'reference-constrained': '参考图+相同业务约束', layout: '布局比例与结构', spacing: '对齐、间距与栅格',
  typography: '字体与文字层级', color: '色彩与灰阶', buttons: '按钮与交互状态',
  inputs: '输入框与选择器', cards: '卡片组件', charts: '数据图表', icons: '图标与插画',
};
const GROUP_ICONS: Record<GroupId, typeof Layers3> = {
  baseline: LayoutDashboard, direct: ImagePlus, 'all-rules': FileText, 'reference-constrained': ShieldCheck, layout: Columns2, spacing: Grid2X2,
  typography: Type, color: Palette, buttons: MousePointer2, inputs: TextCursorInput,
  cards: Layers3, charts: BarChart3, icons: Sparkles,
};
const STATUS_NAMES: Record<RunStatus, string> = {
  queued: '排队中', running: '生成中', checking: '检查中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
};
const ACTIVE = new Set<RunStatus>(['queued', 'running', 'checking']);
const EMPTY_REVIEW: Review = { adherence: '', scope: '', preference: '', notes: '' };

function groupTag(group: GroupId) { return group === 'baseline' ? 'C0' : group === 'direct' ? 'C1' : group === 'all-rules' ? 'C2' : group === 'reference-constrained' ? 'C3' : 'E'; }
function formatTime(date?: string) { return date ? new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
function duration(run: Run) {
  const ms = run.elapsedMs ?? (run.startedAt ? new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime() : 0);
  return ms ? `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s` : '—';
}
function inputOf(exp: Experiment, version: ExperimentVersion): ExperimentInput {
  return { title: exp.title, businessBrief: version.businessBrief, referenceId: version.referenceId, dimensions: structuredClone(version.dimensions), styleGuide: version.styleGuide ? structuredClone(version.styleGuide) : undefined, groups: structuredClone(version.groups ?? []), generationConfig: { ...(version.generationConfig ?? version.config) }, generationPrompt: version.generationPrompt, config: { ...version.config } };
}
function Status({ status }: { status: RunStatus }) {
  return <span className={`status-pill ${status}`}>{ACTIVE.has(status) && <Loader2 className="spin" size={10} />}{STATUS_NAMES[status]}</span>;
}
function Empty({ icon: Icon = FlaskConical, title, description, children }: { icon?: typeof FlaskConical; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-panel"><div className="empty-symbol"><Icon size={25} strokeWidth={1.4} /></div><h3>{title}</h3><p>{description}</p>{children}</div>;
}

function Preview({ run, group, origin, onDetails, onRun, onCancel, locked = false, readOnly = false, baselineMismatch = false, title, selection, combinationSummary }: {
  selection?: { checked: boolean; disabled: boolean; toggle: () => void }; combinationSummary?: string;
  run?: Run; group: GroupId; title?: string; origin: string; onDetails: (id: string) => void;
  onRun: (groups: GroupId[]) => void; onCancel: (id: string) => void; locked?: boolean; readOnly?: boolean; baselineMismatch?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.3);
  const [fullscreen, setFullscreen] = useState(false);
  const [highlight, setHighlight] = useState(false);
  useEffect(() => { setHighlight(false); }, [run?.id]);
  const Icon = GROUP_ICONS[group] ?? Layers3;
  const name = title ?? run?.groupTitle ?? GROUP_NAMES[group] ?? group;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1440));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const running = run && ACTIVE.has(run.status);
  const canHighlight = run?.hasPreview && !running && run.baselineRunId && (run.dimensionIds?.length === 1 || (!run.dimensionIds && Boolean(selection)));
  return <article className={`preview-card ${selection?.checked ? 'selected-for-combination' : ''}`}>
    <div className="preview-header"><div className="preview-title"><span className="group-tag">{groupTag(group)}</span>{name}</div><div className="preview-meta">{run ? <Status status={run.status} /> : <span className="status-pill">未运行</span>}</div></div>
    {['baseline', 'direct', 'all-rules', 'reference-constrained'].includes(group) && <div className="preview-rule-note">{group === 'baseline' ? '仅业务需求，不提供参考材料' : group === 'direct' ? '参考图 + 笼统的风格润色指令' : group === 'reference-constrained' ? '诊断对照 · 与文字规范组使用相同业务保留和交付约束' : '参考图 + 文字规范 · 实际输入以运行证据为准'}</div>}
    {combinationSummary && <div className="preview-rule-note">组合维度：{combinationSummary}</div>}
    {running && <div className="progress-line" />}
    {baselineMismatch && <div className="preview-baseline-warning"><Info size={11} />使用历史基线，请在并排模式查看对应原始页。</div>}
    {canHighlight && <div className="change-entry"><button className={`btn small ${highlight ? 'active' : ''}`} aria-pressed={highlight} onClick={() => setHighlight(value => !value)}><span className="change-swatch" />{highlight ? '关闭维度标注' : '查看本维度强化点'}</button><span>循环强调</span></div>}
    {highlight && canHighlight && <ChangeHighlight key={run.id} runId={run.id} name={name} onClose={() => setHighlight(false)} />}
    <div hidden={highlight && Boolean(canHighlight)} ref={hostRef} className="preview-viewport" style={run?.hasPreview ? { height: scale * 1000 } : undefined}>
      {run?.hasPreview ? <iframe title={`${name} 第 ${run.attempt} 次结果`} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`${origin}/runs/${run.id}/index.html`} style={{ transform: `scale(${scale})` }} /> :
        <div className="preview-placeholder">{running ? <Loader2 className="spin" size={24} strokeWidth={1.2} /> : <Icon size={26} strokeWidth={1.2} />}<span>{running ? (run.status === 'queued' ? '等待可用运行位置' : 'Codex 正在处理这一组') : run?.error ? '本次运行未完成' : '运行后，网页会显示在这里'}</span>{run?.error && <small>{run.error}</small>}</div>}
    </div>
    {selection && <label className="preview-selection"><input type="checkbox" aria-label={`选择维度 ${name}`} checked={selection.checked} disabled={selection.disabled} onChange={selection.toggle} /><span>{selection.disabled && !selection.checked ? '运行并查看结果后可选择组合' : '选入组合'}</span></label>}
    <div className="preview-footer"><span>{run ? `第 ${run.attempt} 次 · ${duration(run)}` : '1440 × 1000'}</span><div className="row-actions">
      {run && <button className="btn small ghost" onClick={() => onDetails(run.id)}><FileText size={12} />查看证据</button>}
      {!readOnly && (running ? <button className="icon-btn" title="取消运行" aria-label={`取消${name}`} onClick={() => onCancel(run.id)}><Square size={12} /></button> : <button className="icon-btn" title={run ? '重新运行，保留历史' : '运行此组'} aria-label={`${run ? '重跑' : '运行'}${name}`} disabled={locked} onClick={() => onRun([group])}>{run ? <RefreshCw size={13} /> : <Play size={13} />}</button>)}
      <button className="icon-btn" title={run?.hasPreview ? '全屏预览' : '生成网页后可全屏预览'} aria-label={`全屏预览${name}`} disabled={!run?.hasPreview} onClick={() => setFullscreen(true)}><Maximize2 size={15} /></button>
    </div></div>
    {fullscreen && run?.hasPreview && <FullscreenPreview name={name} url={`${origin}/runs/${run.id}/index.html`} onClose={() => setFullscreen(false)} />}
  </article>;
}

function RunModal({ details, loading, previewOrigin, onClose, onSaveReview }: { details: RunDetails | null; loading: boolean; previewOrigin: string; onClose: () => void; onSaveReview: (review: Review) => Promise<void> }) {
  const [tab, setTab] = useState<'input' | 'review' | 'preview'>('input');
  const [review, setReview] = useState<Review>(EMPTY_REVIEW);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const run = details?.run;
  useEffect(() => { if (run) setReview(run.review ?? { ...EMPTY_REVIEW }); }, [run?.id]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog.fullscreen-preview[open]')) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, a[href], [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', key); before?.focus(); };
  }, [onClose]);
  const saveReview = async () => {
    setSaving(true); setMessage('');
    try { await onSaveReview(review); setMessage('评价已保存'); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  };
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="run-dialog-title">
      <header className="modal-header"><div><h2 id="run-dialog-title">{run ? <><span className="group-tag">{groupTag(run.groupId)}</span>{(run.groupTitle ?? GROUP_NAMES[run.groupId] ?? run.groupId)} <Status status={run.status} /></> : '运行详情'}</h2>{run && <p>第 {run.attempt} 次运行 · {formatTime(run.createdAt)} · {duration(run)}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="关闭详情"><X size={19} /></button></header>
      <div className="modal-tabs">{([['input', '实际输入'], ['preview', '网页预览'], ['review', '人工评价']] as const).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      <div className="modal-body">
        {loading && !details ? <div className="loading"><Loader2 className="spin" size={20} />正在读取运行记录</div> : !details || !run ? <p className="muted">无法读取记录。</p> : <>
          {run.error && <div className="alert"><div className="alert-content"><TriangleAlert size={15} /><span>{run.error}</span></div></div>}
          {tab === 'input' && <>
            <div className="metadata-grid">{[['模型', details.input?.config.model], ['推理配置', details.input?.config.reasoningEffort], ['并行数量', details.input?.config.concurrency], ['CLI 版本', details.input?.config.cliVersion], ['基线哈希', run.baselineHash ?? (run.groupId === 'baseline' ? run.artifactHash : undefined)], ['输入 token', run.usage?.input_tokens], ['输出 token', run.usage?.output_tokens]].map(([label, value]) => <div className="metadata-item" key={String(label)}><label>{label}</label><span className="mono">{String(value ?? '—')}</span></div>)}</div>
            <h3>发送给模型的参考图</h3>{details.input?.reference ? <img className="input-reference" src={details.input.reference.url} alt="本次发送给 Codex 的参考图" /> : <div className="alert info">{run.groupId === 'baseline' ? '原始对照组不接收参考图或设计规范。' : '此运行尚未准备图片输入。'}</div>}
            {details.input?.designBrief && <section><h3>整页视觉重点与整体执行稿</h3><pre>{details.input.designBrief.direction + '\n\n' + details.input.designBrief.synthesis}</pre></section>}
            {(details.input?.rules ?? []).map(rule => <section key={rule.id}><h3>{rule.title} · 当前组规范</h3><pre>{`修改范围：${rule.scope}\n\n${rule.instructions}`}</pre></section>)}
            <div className="field-heading"><h3>完整提示词</h3><button className="btn small ghost" disabled={!details.input} onClick={() => download(details.input?.prompt ?? '', `${run.id}-prompt.txt`)}><ArrowDownToLine size={12} />下载</button></div><pre>{details.input?.prompt || '任务排队中，输入尚未准备。'}</pre>
          </>}
          {tab === 'preview' && <Preview run={run} group={run.groupId} origin={previewOrigin} onDetails={() => setTab('input')} onRun={() => {}} onCancel={() => {}} locked readOnly />}
          {tab === 'review' && <div className="review-form"><div className="alert info"><div className="alert-content"><Info size={15} /><span>分别判断规范、修改范围和个人审美。评价会关联这一次运行，不覆盖其他历史结果。</span></div></div>
            {([
              ['adherence', '01 · 指定规范是否得到遵循？', [['followed', '遵循'], ['partial', '部分遵循'], ['missed', '未遵循']]],
              ['scope', '02 · 是否出现范围外变化？', [['none', '无'], ['acceptable', '可接受的连带变化'], ['outside', '明显越界']]],
              ['preference', '03 · 相比原始网页，你的审美偏好是？', [['better', '更好'], ['same', '相当'], ['worse', '更差']]],
            ] as const).map(([field, label, options]) => <section key={field}><h3>{label}</h3><div className="review-options">{options.map(([value, text]) => <label key={value} className={`review-option ${review[field] === value ? 'selected' : ''}`}><input type="radio" name={field} value={value} checked={review[field] === value} onChange={() => setReview(current => ({ ...current, [field]: value }))} />{text}</label>)}</div></section>)}
            <section><h3>观察备注</h3><textarea aria-label="评价备注" placeholder="例如：标题比例更接近参考，但按钮颜色也发生了变化。" value={review.notes} onChange={event => setReview(current => ({ ...current, notes: event.target.value }))} /></section>
            <div className="review-submit"><span className="muted" style={{ fontSize: 11, marginRight: 15, alignSelf: 'center' }}>{message}</span><button className="btn primary" onClick={saveReview} disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : <CheckCheck size={14} />}保存评价</button></div>
          </div>}
        </>}
      </div>
    </div>
  </div>;
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [versionId, setVersionId] = useState('');
  const [form, setForm] = useState<ExperimentInput | null>(null);
  const [tab, setTab] = useState<Tab>('setup');
  const [compareMode, setCompareMode] = useState<'pair' | 'grid'>('grid');
  const [selectedGroup, setSelectedGroup] = useState<GroupId>('direct');
  const [selectedAttemptId, setSelectedAttemptId] = useState('');
  const [combinationSources, setCombinationSources] = useState<string[]>([]);
  const [combinationTitle, setCombinationTitle] = useState('');
  const [recordFilter, setRecordFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [modalId, setModalId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [referenceName, setReferenceName] = useState('');
  const experimentRef = useRef<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const version = detail?.experiment.versions.find(v => v.id === versionId);
  const validConcurrency = Boolean(form && Number.isSafeInteger(form.config.concurrency) && form.config.concurrency >= 1);
  const dirty = Boolean(form && (!version || JSON.stringify(form) !== JSON.stringify(inputOf(detail!.experiment, version))));
  const runs = detail?.runs ?? [];
  const versionRuns = runs.filter(run => run.versionId === versionId);
  const baseline = runs.find(run => run.id === version?.baselineRunId);
  const activeRuns = versionRuns.filter(run => ACTIVE.has(run.status));
  const baselineInProgress = activeRuns.some(run => run.groupId === 'baseline');
  const canExecute = Boolean(bootstrap?.runtime.codexAvailable && bootstrap.runtime.authenticated && detail && version && !dirty && !busy);
  const canModify = canExecute && Boolean(version?.referenceId && baseline?.status === 'completed');

  const loadExperiment = useCallback(async (id: string) => {
    const next = await api<ExperimentDetail>(`/experiments/${id}`);
    experimentRef.current = id;
    setDetail(next);
    const latest = next.experiment.versions.at(-1)!;
    setVersionId(latest.id); setForm(inputOf(next.experiment, latest)); setReferenceName(''); setSelectedAttemptId('');
  }, []);

  const refresh = useCallback(async () => {
    const id = experimentRef.current;
    const [list, next] = await Promise.all([api<Experiment[]>('/experiments'), id ? api<ExperimentDetail>(`/experiments/${id}`) : Promise.resolve(null)]);
    setExperiments(list);
    if (id === experimentRef.current && next) setDetail(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await api<Bootstrap>('/bootstrap');
        if (cancelled) return;
        setBootstrap(boot); setApiToken(boot.token);
        setForm({ title: '项目管理 Dashboard', ...structuredClone(boot.defaults) });
        const list = await api<Experiment[]>('/experiments');
        if (cancelled) return;
        setExperiments(list);
        if (list.length) await loadExperiment(list[0].id);
      } catch (reason) { if (!cancelled) setError(errorMessage(reason)); }
      finally { if (!cancelled) setInitializing(false); }
    })();
    return () => { cancelled = true; };
  }, [loadExperiment]);

  useEffect(() => {
    if (!bootstrap) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const events = new EventSource('/api/events');
    const update = () => { clearTimeout(timer); timer = setTimeout(() => { refresh().catch(() => {}); }, 250); };
    events.addEventListener('update', update);
    const fallback = setInterval(() => { refresh().catch(() => {}); }, 5000);
    return () => { events.close(); clearTimeout(timer); clearInterval(fallback); };
  }, [bootstrap, refresh]);

  useEffect(() => {
    if (!modalId) return;
    let cancelled = false;
    const load = async () => {
      try { const result = await api<RunDetails>(`/runs/${modalId}`); if (!cancelled) setRunDetails(result); }
      catch (reason) { if (!cancelled) setError(errorMessage(reason)); }
      finally { if (!cancelled) setModalLoading(false); }
    };
    setModalLoading(true); setRunDetails(null); load();
    const timer = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [modalId]);

  function updateForm(patch: Partial<ExperimentInput>) { setForm(current => {
    if (!current) return current;
    const next = { ...current, ...patch };
    if (patch.dimensions || patch.referenceId) next.styleGuide = undefined;
    return next;
  }); setNotice(''); }
  function changeVersion(id: string) {
    if (busy) return;
    if (!detail) return;
    if (dirty) { setError('当前内容尚未保存。请先保存实验版本，再切换版本。'); return; }
    const target = detail.experiment.versions.find(item => item.id === id)!;
    setVersionId(id); setForm(inputOf(detail.experiment, target)); setReferenceName(''); setSelectedAttemptId(''); setNotice('');
  }
  async function selectExperiment(id: string) {
    if (busy) return;
    if (id === detail?.experiment.id) return;
    if (dirty && detail) { setError('当前内容尚未保存。请先保存，再切换实验。'); return; }
    try { setError(''); await loadExperiment(id); } catch (reason) { setError(errorMessage(reason)); }
  }
  function newExperiment() {
    if (busy) return;
    if (!bootstrap) return;
    if (dirty && detail) { setError('当前内容尚未保存。请先保存，再新建实验。'); return; }
    experimentRef.current = null; setDetail(null); setVersionId(''); setSelectedAttemptId(''); setReferenceName('');
    setForm({ title: '新实验', ...structuredClone(bootstrap.defaults) }); setTab('setup'); setNotice(''); setError('');
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('请选择 PNG、JPG 或 WebP 格式的参考截图。'); return; }
    setUploading(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const asset = await api<ReferenceAsset>('/references', { method: 'POST', body });
      updateForm({ referenceId: asset.id }); setReferenceName(asset.name);
    } catch (reason) { setError(errorMessage(reason)); } finally { setUploading(false); }
  }
  async function save() {
    if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await api<ExperimentDetail>(detail ? `/experiments/${detail.experiment.id}/versions` : '/experiments', { method: 'POST', body: JSON.stringify(form) });
      experimentRef.current = next.experiment.id; setDetail(next);
      const latest = next.experiment.versions.at(-1)!;
      setVersionId(latest.id); setForm(inputOf(next.experiment, latest)); setNotice(`版本 v${latest.number} 已保存。${latest.baselineRunId ? '已复用冻结的原始网页。' : '现在可以生成原始网页。'}`);
      setExperiments(await api<Experiment[]>('/experiments'));
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function execute(groupIds: GroupId[]) {
    if (!detail || !version) return;
    if (dirty) { setError('请先保存修改，再运行实验。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const nextRuns = await api<Run[]>(`/experiments/${detail.experiment.id}/runs`, { method: 'POST', body: JSON.stringify({ versionId: version.id, groupIds }) });
      setNotice(`已加入 ${nextRuns.length} 个运行任务。所有修改组独立使用同一份原始网页。`);
      if (groupIds.length === 1 && groupIds[0] !== 'baseline') setSelectedGroup(groupIds[0]);
      setSelectedAttemptId(''); setTab('compare'); await refresh();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    try { await api<Run>(`/runs/${id}/cancel`, { method: 'POST' }); await refresh(); } catch (reason) { setError(errorMessage(reason)); }
  }
  const closeModal = useCallback(() => { setModalId(null); setRunDetails(null); }, []);
  async function saveReview(review: Review) {
    if (!modalId) return;
    const run = await api<Run>(`/runs/${modalId}/review`, { method: 'PUT', body: JSON.stringify(review) });
    setRunDetails(current => current ? { ...current, run } : current); await refresh();
  }
  useEffect(() => {
    if (version && !experimentGroups(version).some(group => group.id === selectedGroup)) { setSelectedGroup('direct'); setSelectedAttemptId(''); }
  }, [version, selectedGroup]);
  useEffect(() => { setCombinationSources([]); setCombinationTitle(''); }, [versionId, baseline?.id]);
  async function combine() {
    if (!detail || !version || !canModify || combinationSources.length < 2) return;
    setBusy(true); setError(''); setNotice('');
    const experimentId = detail.experiment.id;
    try {
      const next = await api<ExperimentDetail & { newRunId: string }>(`/experiments/${experimentId}/versions/${version.id}/combinations`, {
        method: 'POST', body: JSON.stringify({ title: combinationTitle.trim() || combinationSources.map(id => version.dimensions.find(rule => rule.id === runs.find(run => run.id === id)?.groupId)?.title).join(' + ').slice(0, 120), sourceRunIds: combinationSources }),
      });
      if (experimentRef.current !== experimentId) return;
      setDetail(next); setForm(inputOf(next.experiment, next.experiment.versions.find(item => item.id === version.id)!));
      const created = next.runs.find(run => run.id === next.newRunId)!;
      setSelectedGroup(created.groupId); setSelectedAttemptId(created.id); setCombinationSources([]); setCombinationTitle('');
      setNotice(created.status === 'failed' ? `组合组已保存，启动失败：${created.error}。可在卡片重跑。` : '组合组已加入当前画布，正在基于同一原始页生成。');
      setExperiments(await api<Experiment[]>('/experiments'));
    } catch (reason) { setError(errorMessage(reason)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const latestOf = (group: GroupId) => versionRuns.filter(run => run.groupId === group).sort((a, b) => b.attempt - a.attempt)[0] ?? (group === 'baseline' ? baseline : undefined);
  const groupAttempts = versionRuns.filter(run => run.groupId === selectedGroup).sort((a, b) => b.attempt - a.attempt);
  const chosenRun = groupAttempts.find(run => run.id === selectedAttemptId) ?? groupAttempts[0];
  const pairedBaseline = runs.find(run => run.id === chosenRun?.baselineRunId) ?? baseline;
  const groups = experimentGroups(version ?? { dimensions: [] });
  const groupIds = groups.map(group => group.id);
  const fullRulesReady = Boolean(version && version.dimensions.length && version.dimensions.every(rule => rule.instructions.trim()));
  const historicalGroups = [...new Map((detail?.experiment.versions ?? []).flatMap(experimentGroups).map(group => [group.id, group])).values()];
  const groupName = (id: string) => groups.find(group => group.id === id)?.title ?? id;
  const completedGroups = groupIds.filter(group => latestOf(group)?.status === 'completed').length;
  const selectable = (run?: Run) => Boolean(run && run.hasPreview && !ACTIVE.has(run.status) && run.versionId === versionId && run.baselineRunId === baseline?.id && run.baselineHash === baseline?.artifactHash && version?.dimensions.some(rule => rule.id === run.groupId && rule.instructions.trim()));
  const selectedSources = combinationSources.map(id => runs.find(run => run.id === id)).filter((run): run is Run => Boolean(run));
  const combinationSelection = (group: string, run?: Run) => version?.dimensions.some(rule => rule.id === group) ? {
    checked: Boolean(run && combinationSources.includes(run.id)), disabled: !canModify || !selectable(run),
    toggle: () => { if (!run) return; setCombinationSources(current => current.includes(run.id) ? current.filter(id => id !== run.id) : [...current.filter(id => runs.find(item => item.id === id)?.groupId !== group), run.id]); },
  } : undefined;
  const combinationSummary = (id: string) => version?.groups?.find(group => group.id === id)?.dimensionIds.map(id => groupName(id)).join(' + ');
  const ruleCount = form?.dimensions.filter(item => item.instructions.trim()).length ?? 0;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol" aria-hidden="true"><i /><i /><i /><i /></div><div><div className="brand-name">Define Pretty<span style={{ color: 'var(--accent)' }}>.</span></div><div className="brand-sub">DESIGN WITH INTENT</div></div></div>
      <div className="nav-label">WORKSPACE</div>
      {([['setup', SlidersHorizontal, '实验设置', '01'], ['compare', Columns2, '对比画布', '02'], ['records', Clock3, '运行记录', '03']] as const).map(([id, Icon, label, number]) => <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} disabled={busy} title={label}><Icon size={17} strokeWidth={1.6} /><span>{label}</span><span className="nav-number">{number}</span></button>)}
      <div className="sidebar-separator" /><div className="nav-label">EXPERIMENTS</div>
      <div className="project-list">{experiments.map(exp => <button key={exp.id} className={`project-nav ${detail?.experiment.id === exp.id ? 'active' : ''}`} title={exp.title} onClick={() => selectExperiment(exp.id)}><span style={{ flexShrink: 0, fontSize: 9 }}>◇</span><span>{exp.title}</span></button>)}</div>
      <button className="project-nav" onClick={newExperiment}><Plus size={13} /><span>新建实验</span></button>
      <div className="sidebar-note"><h4><FlaskConical size={13} />先验证，再定义。</h4><p>一张参考图，一组规范。<br />观察每一次有目的的改变。</p></div>
      <div className="sidebar-footer"><span className="connection"><i className={`connection-dot ${bootstrap?.runtime.authenticated ? '' : 'offline'}`} />{bootstrap?.runtime.authenticated ? 'Codex 已连接' : '等待连接'}</span><span>v0.1</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><FlaskConical size={13} /><span>UI 实验室</span><ChevronRight size={11} />{experiments.length ? <select className="experiment-select" aria-label="切换实验" value={detail?.experiment.id ?? ''} onChange={event => { if (event.target.value) selectExperiment(event.target.value); }}><option value="" disabled>新建实验</option>{experiments.map(exp => <option value={exp.id} key={exp.id}>{exp.title}</option>)}</select> : <strong>新建实验</strong>}</div><div className="topbar-actions"><span className="local-badge"><Monitor size={12} />本地工作空间</span>{detail && <select className="version-select" aria-label="实验版本" value={versionId} onChange={event => changeVersion(event.target.value)}>{[...detail.experiment.versions].reverse().map(item => <option key={item.id} value={item.id}>v{item.number} · {formatTime(item.createdAt)}</option>)}</select>}<div className="avatar">D</div></div></header>
      <div className="page-heading"><div><div className="eyebrow">{tab === 'setup' ? 'MAKE STYLE SPECIFIC' : tab === 'compare' ? 'SEE WHAT CHANGED' : 'EVERY ATTEMPT COUNTS'}</div><h1>{tab === 'setup' ? '设计，可以逐项验证。' : tab === 'compare' ? '把变化，放在一起看。' : '每一次尝试，都有据可循。'}</h1><p>{tab === 'setup' ? '用参考图和明确的规范，验证更精确的 UI 风格迁移。' : tab === 'compare' ? '同一份原始网页，同一张参考图，观察不同规范带来的变化。' : '保留真实输入、网页结果与评价，不挑选最好的一次。'}</p></div><button className="btn heading-action" onClick={newExperiment}><Plus size={14} />新建实验</button></div>
      {error && <div className="alert" role="alert"><div className="alert-content"><TriangleAlert size={15} /><span>{error}</span></div><button className="icon-btn" onClick={() => setError('')} aria-label="关闭错误提示"><X size={14} /></button></div>}
      {notice && <div className="alert success" role="status"><div className="alert-content"><CheckCircle2 size={15} /><span>{notice}</span></div><button className="icon-btn" onClick={() => setNotice('')} aria-label="关闭提示"><X size={14} /></button></div>}
      {initializing || !bootstrap || !form ? <div className="loading"><Loader2 className="spin" size={20} />正在连接本地实验服务{error && <button className="btn small" onClick={() => window.location.reload()}>重试</button>}</div> : <>
        {tab === 'setup' && <>
          <div className="steps">{[['01', '准备输入', '参考图 + 自选规范'], ['02', '生成原始页', '仅提供业务需求'], ['03', '定向润色', '单维度与组合实验'], ['04', '对比与评价', '保留真实观察']].map(([n, title, subtitle], i) => <div className={`step ${i === (!version ? 0 : !baseline ? 1 : !versionRuns.some(run => run.groupId !== 'baseline') ? 2 : 3) ? 'current' : ''}`} key={n}><span className="step-n">{n}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div>)}</div>
          <div className="section-header"><div className="section-heading"><span className="section-index">01 /</span><h2>实验输入</h2></div><span className="section-caption">原始对照组只接收业务需求</span></div>
          <div className="setup-grid">
            <section className="card reference-card"><div className="card-topline"><strong>风格参考图</strong><span>PNG · JPG · WEBP</span></div>
              <div className={`upload-area ${dragging ? 'dragover' : ''}`} role="button" tabIndex={0} aria-label="上传参考 UI 截图" onClick={() => !uploading && uploadRef.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); uploadRef.current?.click(); } }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!uploading) upload(event.dataTransfer.files[0]); }}>
                <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="参考图片文件" onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
                {uploading ? <><Loader2 size={25} className="spin" /><p>正在上传参考图</p></> : form.referenceId ? <><img className="reference-image" src={`/api/references/${form.referenceId}`} alt="当前实验参考图" /><span className="btn small reference-change"><RefreshCw size={11} />替换图片</span></> : <><span className="upload-icon"><ImagePlus size={21} strokeWidth={1.5} /></span><h4>拖入一张你想参考的 UI 截图</h4><p>或点击这里，从本地选择</p></>}
              </div><div className="reference-caption"><Info size={11} /><span>{form.referenceId ? referenceName || '参考图已上传 · 所有修改组使用同一张图' : '请使用纯 UI 截图，避免包含其他规范文字'}</span></div>
            </section>
            <section className="card brief-card"><div className="field-heading"><label htmlFor="experiment-title">实验名称</label><span className="badge">不同业务，迁移风格</span></div><input id="experiment-title" value={form.title} onChange={event => updateForm({ title: event.target.value })} maxLength={120} style={{ marginBottom: 15, fontSize: 12 }} /><div className="field-heading"><label htmlFor="business-brief">原始网页的业务需求</label><span className="section-caption">可编辑</span></div><textarea id="business-brief" value={form.businessBrief} onChange={event => updateForm({ businessBrief: event.target.value })} placeholder="描述页面需要包含的业务内容和功能，不要加入参考风格规范。" /><div className="brief-footer"><ShieldCheck size={12} /><span>修改业务需求后需生成新基线；各组保留相同内容与功能。</span></div></section>
          </div>
          <div className="section-header"><div className="section-heading"><span className="section-index">02 /</span><h2>设计维度规范</h2><span className="badge orange">{ruleCount} 个维度已填写</span></div></div>
          <RuleWorkbench key={versionId || 'new'} form={form} bootstrap={bootstrap} onChange={updateForm} onError={setError} />
          <div className="section-header"><div className="section-heading"><span className="section-index">03 /</span><h2>对照实验运行配置</h2></div><span className="section-caption">同一轮实验使用相同配置</span></div>
          <section className="card config-card"><div className="field"><label htmlFor="model">对照实验模型</label><input id="model" value={form.config.model} onChange={event => updateForm({ config: { ...form.config, model: event.target.value } })} /><p>{form.config.provider ? `Provider: ${form.config.provider} · ` : ''}{bootstrap.runtime.version || 'Codex CLI'}</p></div><div className="field"><label htmlFor="reasoning">对照实验推理强度</label><select id="reasoning" value={form.config.reasoningEffort} onChange={event => updateForm({ config: { ...form.config, reasoningEffort: event.target.value } })}>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option key={value} value={value}>{value}</option>)}</select><p>使用本地登录凭据，无需额外 API Key</p></div><div className="field"><label htmlFor="concurrency">并行数量（组）</label><input id="concurrency" disabled={!bootstrap.capabilities?.configurableConcurrency} type="number" min={1} step={1} inputMode="numeric" value={form.config.concurrency || ''} aria-invalid={!validConcurrency} onChange={event => updateForm({ config: { ...form.config, concurrency: Number(event.target.value) } })} /><p>{validConcurrency ? `本版本最多 ${form.config.concurrency} 组并行 · ${Math.round(form.config.timeoutMs / 60000)} 分钟超时` : '请输入大于或等于 1 的整数'}</p><p>{bootstrap.capabilities?.configurableConcurrency ? '保存新版本后生效，旧版本任务继续按原配置运行' : '后端更新尚未应用；服务重启后刷新即可修改'}</p></div></section>
          {!bootstrap.runtime.authenticated && <div className="alert" style={{ marginTop: 20 }}><div className="alert-content"><TriangleAlert size={15} /><span>{bootstrap.runtime.error || '未连接到已登录的 Codex CLI。请在终端完成 codex login 后重新打开页面。'}</span></div></div>}
          <div className="bottom-bar"><div className="bottom-note">{dirty ? <><Circle size={8} fill="#df6038" color="#df6038" />有未保存的修改</> : <><Check size={13} />v{version?.number} 已保存 · 输入已冻结</>}</div><div className="bottom-buttons"><button className="btn" disabled={!dirty || !validConcurrency || busy || uploading || !form.title.trim() || !form.businessBrief.trim() || form.dimensions.some(rule => !rule.title.trim()) || (form.groups ?? []).some(group => !group.title.trim())} onClick={save}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}{detail ? '保存为新版本' : '保存实验'}</button><button className="btn primary" disabled={!canExecute || baselineInProgress} onClick={() => execute(['baseline'])}><Play size={13} />{baselineInProgress ? '正在生成原始网页' : baseline ? '重跑原始网页' : '生成原始网页'}<ArrowRight size={13} /></button></div></div>
        </>}
        {tab === 'compare' && <>
          {!detail ? <Empty icon={Columns2} title="先准备你的第一轮实验" description="上传一张参考截图，填写规范并保存实验，再生成原始网页。"><button className="btn primary" onClick={() => setTab('setup')}>前往实验设置<ArrowRight size={13} /></button></Empty> : <>
            <div className="stat-strip"><div className="stat"><strong>{completedGroups.toString().padStart(2, '0')}</strong> / {groups.length} 组完成</div><div className="stat"><strong>{activeRuns.length.toString().padStart(2, '0')}</strong>运行中</div><div className="stat"><strong>{versionRuns.filter(run => run.review?.preference).length.toString().padStart(2, '0')}</strong>已评价</div><span className="stat-spacer">固定视口 · 1440 × 1000</span></div>
            {dirty && <div className="alert info"><span>有未保存的输入修改，请返回实验设置保存后再运行。当前画布展示已保存版本。</span><button className="btn small ghost" onClick={() => setTab('setup')}>去保存<ArrowRight size={12} /></button></div>}
            {!baseline && <div className="alert info"><span>先生成并冻结原始网页，再运行各个独立修改组。</span><button className="btn small primary" disabled={!canExecute || baselineInProgress} onClick={() => execute(['baseline'])}><Play size={12} />生成原始页</button></div>}
            {baseline && !version?.referenceId && <div className="alert info"><span>原始网页已准备。上传纯 UI 参考图并保存新版本，即可开始定向润色。</span><button className="btn small ghost" onClick={() => setTab('setup')}>上传参考图<ArrowRight size={12} /></button></div>}
            {!fullRulesReady && <div className="alert info"><span>C2 使用已保存的全部维度。请先填写并保存维度规范。</span><button className="btn small" onClick={() => setTab('setup')}>去编辑规范</button></div>}
            <div className="toolbar"><div className="toolbar-left"><div className="segmented"><button className={compareMode === 'pair' ? 'active' : ''} onClick={() => setCompareMode('pair')}><Columns2 size={13} />并排对比</button><button className={compareMode === 'grid' ? 'active' : ''} onClick={() => setCompareMode('grid')}><Grid2X2 size={13} />全部实验组</button></div>{compareMode === 'pair' && <select aria-label="选择对比组" value={selectedGroup} onChange={event => { setSelectedGroup(event.target.value as GroupId); setSelectedAttemptId(''); }}>{groupIds.filter(group => group !== 'baseline').map(group => <option key={group} value={group}>{groupTag(group)} · {groupName(group)}</option>)}</select>}{compareMode === 'pair' && groupAttempts.length > 1 && <select aria-label="选择历史运行" value={chosenRun?.id ?? ''} onChange={event => setSelectedAttemptId(event.target.value)}>{groupAttempts.map(run => <option key={run.id} value={run.id}>第 {run.attempt} 次 · {STATUS_NAMES[run.status]}</option>)}</select>}</div><button className="btn accent" disabled={!canModify || activeRuns.some(run => run.groupId !== 'baseline')} onClick={() => execute(groupIds.filter(id => id !== 'baseline' && (id !== 'all-rules' || fullRulesReady)))}><Play size={13} />运行全部修改组</button></div>
            <section className="card canvas-composer" aria-label="组合所选维度">
              <div className="field-heading"><strong>看过效果，再组合</strong><span className="badge">已选 {selectedSources.length} 个维度</span></div>
              <p className="hint">在单维度结果卡片上勾选至少两项。组合从同一原始页重新生成；冲突时按选择顺序优先采用前面的规范。</p>
              {selectedSources.length > 0 && <div className="selected-dimensions">{selectedSources.map(run => <button key={run.id} className="btn small" disabled={busy} onClick={() => setCombinationSources(ids => ids.filter(id => id !== run.id))}>{groupName(run.groupId)} · 第 {run.attempt} 次<X size={12} /></button>)}</div>}
              <div className="workbench-actions"><input aria-label="组合实验组名称" maxLength={120} value={combinationTitle} onChange={event => setCombinationTitle(event.target.value)} placeholder="组合名称（留空则按所选维度命名）" disabled={busy} /><button className="btn accent" disabled={!canModify || selectedSources.length < 2 || !selectedSources.every(selectable)} onClick={combine}><Plus size={14} />组合并生成对比</button>{selectedSources.length > 0 && <button className="btn small ghost" disabled={busy} onClick={() => setCombinationSources([])}>清空选择</button>}</div>
            </section>
            {compareMode === 'pair' ? <div className="comparison-pair"><Preview run={pairedBaseline ?? latestOf('baseline')} group="baseline" origin={bootstrap.previewOrigin} onDetails={setModalId} onRun={execute} onCancel={cancel} locked={!canExecute} /><Preview run={chosenRun} group={selectedGroup} title={groupName(selectedGroup)} selection={combinationSelection(selectedGroup, chosenRun)} combinationSummary={combinationSummary(selectedGroup)} origin={bootstrap.previewOrigin} onDetails={setModalId} onRun={execute} onCancel={cancel} locked={!canModify || (selectedGroup === 'all-rules' && !fullRulesReady)} /></div> : <>{[groupIds.slice(0, 3), groupIds.slice(3)].map((row, index) => <div key={index} className={`comparison-grid ${index === 0 ? 'comparison-controls' : ''}`}>{row.map(group => <Preview key={group} run={group === 'baseline' ? baseline ?? latestOf('baseline') : latestOf(group)} group={group} title={groupName(group)} selection={combinationSelection(group, latestOf(group))} combinationSummary={combinationSummary(group)} origin={bootstrap.previewOrigin} onDetails={setModalId} onRun={execute} onCancel={cancel} locked={group === 'baseline' ? !canExecute || baselineInProgress : !canModify || (group === 'all-rules' && !fullRulesReady)} baselineMismatch={group !== 'baseline' && Boolean(latestOf(group)?.baselineRunId && baseline?.id && latestOf(group)?.baselineRunId !== baseline.id)} />)}</div>)}</>}
            <div className="evidence-strip"><Info size={15} /><div><h4>观察三个不同的问题</h4><p>指定规范是否得到遵循？其他部分有没有意外改变？你是否更喜欢结果？点击「查看证据」记录评价，工具不会自动给美观打分。</p></div></div>
          </>}
        </>}
        {tab === 'records' && <>
          <div className="toolbar"><div className="toolbar-left"><span className="section-caption">{detail ? `${detail.experiment.title} · 全部版本` : '当前实验'} · {runs.length} 次运行</span></div><div className="toolbar-right"><select aria-label="筛选运行分组" value={recordFilter} onChange={event => setRecordFilter(event.target.value)}><option value="all">全部分组</option>{historicalGroups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select><button className="btn small" onClick={() => refresh().catch(reason => setError(errorMessage(reason)))}><RefreshCw size={12} />刷新</button></div></div>
          {!runs.length ? <Empty icon={Clock3} title="这里将记录每一次尝试" description="运行后，可回看各版本的实际输入、生成结果和人工评价。"><button className="btn" onClick={() => setTab('setup')}>准备实验<ArrowRight size={13} /></button></Empty> : <div className="card table-wrap"><table className="runs-table"><thead><tr><th>实验分组</th><th>版本 / 次数</th><th>状态</th><th>开始时间</th><th>耗时</th><th>人工评价</th><th>操作</th></tr></thead><tbody>{[...runs].filter(run => recordFilter === 'all' || run.groupId === recordFilter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => <tr key={run.id}><td><div className="run-name"><span className="group-tag">{groupTag(run.groupId)}</span>{(run.groupTitle ?? GROUP_NAMES[run.groupId] ?? run.groupId)}</div><div className="run-id">{run.id.slice(0, 16)}</div></td><td>v{detail?.experiment.versions.find(item => item.id === run.versionId)?.number} · 第 {run.attempt} 次</td><td><Status status={run.status} /></td><td>{formatTime(run.startedAt ?? run.createdAt)}</td><td className="mono">{duration(run)}</td><td>{run.review?.preference ? ({ better: '更好', same: '相当', worse: '更差' })[run.review.preference] : '待评价'}</td><td><div className="row-actions"><button className="btn small ghost" onClick={() => setModalId(run.id)}>查看记录<ArrowUpRight size={11} /></button>{ACTIVE.has(run.status) && <button className="icon-btn" title="取消运行" onClick={() => cancel(run.id)}><Square size={12} /></button>}</div></td></tr>)}</tbody></table></div>}
        </>}
        <div className="footer-note">DEFINE PRETTY / 用明确的规范，让风格迁移有据可循。</div>
      </>}
    </main>
    {modalId && <RunModal details={runDetails} loading={modalLoading} previewOrigin={bootstrap?.previewOrigin ?? ''} onClose={closeModal} onSaveReview={saveReview} />}
  </div>;
}
