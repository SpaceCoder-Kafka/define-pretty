import { useEffect, useState } from 'react';
import { Plus, Sparkles, X, Loader2 } from 'lucide-react';
import type { Bootstrap, DimensionRule, ExperimentInput, SpecGeneration } from '../shared/types';
import { api, errorMessage } from './api';
import { currentGenerationPrompt } from '../shared/generation-prompt';

const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export default function RuleWorkbench({ form, bootstrap, onChange, onError }: {
  form: ExperimentInput; bootstrap: Bootstrap; onChange: (patch: Partial<ExperimentInput>) => void; onError: (message: string) => void;
}) {
  const [activeId, setActiveId] = useState('');
  const [jobs, setJobs] = useState<SpecGeneration[]>([]);
  const [pending, setPending] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [selectedJob, setSelectedJob] = useState('');
  const config = form.generationConfig ?? bootstrap.defaults.generationConfig ?? bootstrap.defaults.config;
  const rule = form.dimensions.find(item => item.id === activeId) ?? form.dimensions[0];
  const visibleJobs = jobs.filter(job => job.reference.id === form.referenceId);
  const job = jobs.find(job => job.id === selectedJob) ?? visibleJobs[0] ?? jobs[0];
  const running = jobs.some(job => ['queued', 'running', 'checking'].includes(job.status));
  const groups = form.groups ?? [];
  const generationPrompt = currentGenerationPrompt(form.generationPrompt, bootstrap.defaults.generationPrompt ?? '');
  useEffect(() => {
    let disposed = false;
    const load = async () => { try { const data = await api<SpecGeneration[]>('/generations'); if (!disposed) setJobs(data); } catch { /* The next poll retries temporary disconnects. */ } };
    void load(); const timer = setInterval(load, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => { setSelectedJob(''); setEvidence(''); }, [form.referenceId]);
  function updateRule(patch: Partial<DimensionRule>) { if (rule) onChange({ dimensions: form.dimensions.map(item => item.id === rule.id ? { ...item, ...patch } : item) }); }
  function removeRule(id: string) {
    onChange({ dimensions: form.dimensions.filter(item => item.id !== id), groups: groups.filter(group => !group.dimensionIds.includes(id)) });
  }
  async function generate() {
    if (!form.referenceId) return;
    setPending(true); onError('');
    try {
      const result = await api<SpecGeneration>('/generations', { method: 'POST', body: JSON.stringify({ referenceId: form.referenceId, config, prompt: generationPrompt }) });
      setJobs(current => [result, ...current]); setSelectedJob(result.id); setEvidence('');
    } catch (error) { onError(errorMessage(error)); } finally { setPending(false); }
  }
  function applyGenerated(replace: boolean) {
    if (!job?.dimensions || job.reference.id !== form.referenceId) return;
    const dimensions = job.dimensions.filter(rule => replace || rule.title !== '整页视觉重点' || !form.dimensions.some(item => item.title === '整页视觉重点')).map(rule => ({ ...rule, id: `dim-${crypto.randomUUID()}` }));
    onChange({ dimensions: replace ? dimensions : [...form.dimensions, ...dimensions], ...(replace ? { groups: [], styleGuide: undefined } : {}) });
    setActiveId(dimensions[0]?.id ?? '');
  }
  return <>
    <section className="card generation-card">
      <div className="field-heading"><h3><Sparkles size={16} /> 从参考图生成规范</h3><span className="badge">先预览，再采纳</span></div>
      <p className="muted">根据图片决定维度名称和数量。生成结果不会自动覆盖正在编辑的规范。</p>
      <div className="generation-config">
        <div className="field"><label htmlFor="generation-model">规范生成模型</label><input id="generation-model" value={config.model} onChange={event => onChange({ generationConfig: { ...config, model: event.target.value } })} /></div>
        <div className="field"><label htmlFor="generation-reasoning">规范生成推理强度</label><select id="generation-reasoning" value={config.reasoningEffort} onChange={event => onChange({ generationConfig: { ...config, reasoningEffort: event.target.value } })}>{efforts.map(value => <option key={value}>{value}</option>)}</select></div>
      </div>
      <label className="scope-label" htmlFor="generation-prompt">规范生成提示词</label><textarea id="generation-prompt" value={generationPrompt} onChange={event => onChange({ generationPrompt: event.target.value })} />
      <div className="workbench-actions"><span className="hint">整页视觉重点也是一个独立维度；每组仅 3–5 条自身规则，不隐含其他维度目标。</span><button className="btn small" disabled={!bootstrap.defaults.generationPrompt || generationPrompt === bootstrap.defaults.generationPrompt} onClick={() => onChange({ generationPrompt: bootstrap.defaults.generationPrompt })}>使用新版默认提示词</button></div>
      <div className="workbench-actions"><span className="hint">与对照实验的模型、推理强度分别配置 · 30 分钟超时</span><button className="btn accent" disabled={!form.referenceId || !config.model.trim() || !generationPrompt.trim() || running || pending || !bootstrap.runtime.authenticated} onClick={generate}>{pending || running ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{running ? '规范生成中' : '根据参考图生成规范'}</button></div>
      {!form.referenceId && <p className="hint">先上传参考截图，即可生成规范。</p>}
      {job && <div className="generation-result">
        <div className="workbench-actions"><select aria-label="规范生成历史" value={job.id} onChange={event => { setSelectedJob(event.target.value); setEvidence(''); }}>{jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.reference.name} · {item.config.model} · {item.status === 'completed' ? item.integrationSource ? '整体整合完成' : `${item.dimensions?.length} 个维度` : item.status === 'running' ? '生成中' : ({ failed: '失败', cancelled: '已取消', interrupted: '已中断', queued: '排队中', checking: '检查中' } as Record<string, string>)[item.status] ?? item.status}</option>)}</select>
          {job.status === 'running' && <button className="btn small" onClick={async () => { try { const result = await api<SpecGeneration>(`/generations/${job.id}/cancel`, { method: 'POST' }); setJobs(items => items.map(item => item.id === result.id ? result : item)); } catch (error) { onError(errorMessage(error)); } }}>取消生成</button>}
          <button className="btn small" onClick={async () => { try { const data = await api(`/generations/${job.id}/evidence`); setEvidence(JSON.stringify(data, null, 2)); } catch (error) { onError(errorMessage(error)); } }}>查看生成证据</button>
        </div>
        <p className="hint">实际配置：{job.config.model} · {job.config.reasoningEffort} · 图片：{job.reference.name}</p>
        {job.dimensions && <p className="hint">{job.formatVersion === 4 ? '独立维度格式：整页视觉重点可单选、取消或参与组合；C2 接收全部维度原文。' : '历史格式 · 保留原始输出，可使用新版默认提示词重新提炼精简规范。'}</p>}
        {job.styleGuide && <details className="generation-guide"><summary>历史整页视觉重点与执行稿（只读）</summary><pre>{job.styleGuide.direction}</pre><pre>{job.styleGuide.synthesis}</pre><p className="hint">历史内容不再自动附加到实验输入。使用新版提示词重新生成独立维度。</p></details>}
        {job.reference.id !== form.referenceId && <div className="alert info"><span>这次生成使用另一张参考图。先切换到该图，再采纳规范。</span><button className="btn small" onClick={() => onChange({ referenceId: job.reference.id })}>使用此记录的参考图</button></div>}
        {job.error && <div className="alert" role="alert">{job.error}</div>}
        {job.dimensions && <><div className="generated-rules">{job.dimensions.map(item => <details key={item.id}><summary>{item.title}</summary><p>修改范围：{item.scope}</p><pre>{item.instructions}</pre></details>)}</div><div className="workbench-actions"><span className="hint">切换新版建议替换维度，再保存新版本。追加时保留已有整页视觉重点；替换会清空草稿组合。</span><button className="btn" disabled={job.reference.id !== form.referenceId} onClick={() => applyGenerated(false)}>追加为新维度</button><button className="btn" disabled={job.reference.id !== form.referenceId} onClick={() => applyGenerated(true)}>替换全部维度与组合</button></div></>}
        {job.observations && <details className="generation-observations"><summary>观察与推断依据（不发送给润色模型）</summary>{job.observations.map(item => <section key={item.dimensionId}><h4>{item.title}</h4><p>{item.notes}</p></section>)}</details>}
        {evidence && <details open><summary>实际图片、提示词、配置与日志</summary><img className="input-reference" src={job.reference.url} alt="规范生成实际输入图片" /><pre className="generation-evidence">{evidence}</pre></details>}
      </div>}
    </section>
    {form.styleGuide?.direction && !form.dimensions.some(item => item.title === '整页视觉重点') && <section className="card generation-card"><h3>旧版整页视觉重点</h3><p className="hint">这段历史文字不会自动发送给各组。可以原样迁入一个可编辑的独立维度，或重新生成新版规范。</p><pre>{form.styleGuide.direction}</pre><button className="btn small" onClick={() => { const id = `dim-${crypto.randomUUID()}`; onChange({ dimensions: [{ id, title: '整页视觉重点', scope: '整页视觉中心、主次区域比例与阅读顺序', instructions: form.styleGuide!.direction }, ...form.dimensions], styleGuide: undefined }); setActiveId(id); }}>作为独立维度加入草稿</button></section>}
    <div className="workbench-actions dimension-actions"><span>{form.dimensions.length} 个维度 · 可修改标题、范围和提示词</span><button className="btn small" onClick={async () => { try { const template = await api<DimensionRule[]>('/dimension-templates'); const rules = template.map(rule => ({ ...rule, id: `dim-${crypto.randomUUID()}` })); onChange({ dimensions: [...form.dimensions, ...rules] }); setActiveId(rules[0].id); } catch (error) { onError(errorMessage(error)); } }}>添加九组示例模板</button><button className="btn small" onClick={() => { const id = `dim-${crypto.randomUUID()}`; onChange({ dimensions: [...form.dimensions, { id, title: '新维度', scope: '', instructions: '' }] }); setActiveId(id); }}><Plus size={13} />新增维度</button></div>
    <section className="card rules-card"><nav className="rule-nav" aria-label="设计规范分组">{form.dimensions.map((item, index) => <button className={`rule-tab ${item.id === rule?.id ? 'active' : ''}`} key={item.id} onClick={() => setActiveId(item.id)}><strong>{item.title || '未命名维度'}</strong><span className="rule-count">{index + 1}</span></button>)}</nav>
      {rule ? <div className="rule-editor"><div className="workbench-actions"><label htmlFor="rule-title">维度名称</label><button className="btn small ghost" onClick={() => removeRule(rule.id)}><X size={13} />删除维度{groups.some(group => group.dimensionIds.includes(rule.id)) ? '及相关组合' : ''}</button></div><input id="rule-title" value={rule.title} maxLength={120} onChange={event => updateRule({ title: event.target.value })} />
        <label className="scope-label" htmlFor="rule-scope">主要修改范围与必要联动</label><textarea id="rule-scope" className="scope-editor" value={rule.scope} onChange={event => updateRule({ scope: event.target.value })} />
        <p className="hint">以所选维度为主要目标，允许为可读性、布局完整性和交互做必要适配；不主动迁移未选维度的风格。</p>
        <label className="scope-label" htmlFor="rule-instructions">维度提示词</label><textarea id="rule-instructions" value={rule.instructions} onChange={event => updateRule({ instructions: event.target.value })} placeholder="每行写一项明确指令，例如：将页面标题的字号设为 32px。" />
        <div className="editor-footer"><span>单句单操作 · 参数具体 · 术语一致</span><span>{rule.instructions.length} 字</span></div>
      </div> : <div className="rule-editor"><h3>还没有设计维度</h3><p>从参考图生成规范，或手动添加维度。各维度保存后均可单独运行。</p></div>}
    </section>
    <p className="hint canvas-combination-hint">先运行单维度实验，再到「对比画布」查看效果、勾选维度并生成组合组。删除维度时，草稿中引用它的组合也会移除；已保存版本保留。</p>
  </>;
}
