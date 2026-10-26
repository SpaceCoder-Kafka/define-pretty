import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { featureInstruction, selectedFeatures, VISUAL_IMPLEMENTATION_GUIDANCE } from '../shared/feature-board.ts';
import type { FeatureTest, FeatureTestSource, FeatureSourceRun } from '../shared/feature-test.ts';
import type { ModelConfig } from '../shared/types.ts';
import { FeatureBoards } from './feature-boards.ts';
import { executeCodex, hashWebsite, type Executor, type ExecutionOptions } from './codex.ts';
import { chromeExecutable, inspectWebsite } from './validation.ts';
import { detectImageType, requireSafeId, safeFilePath } from './security.ts';
import { fail, text } from './input.ts';
import { builtinWebsiteRoot, freezeBuiltinSources } from './builtin-sources.ts';
import { startTaskPreview, TASK_PREVIEW_GUIDANCE } from './task-preview.ts';
import { readExecutionProgress } from './execution-progress.ts';
import { readDraftPreview } from './task-preview.ts';

const activeStatus = (status: string) => ['queued','running','checking'].includes(status);
const WEBSITE_WORKFLOW = `生成期间可联网查找或下载素材、安装依赖、构建和启动临时预览，并按实际截图自主对照、修正。浏览器连接器不可用时，可使用命令行无头浏览器等可用方式继续验证。
允许并鼓励使用子代理并行处理独立任务，例如插画与素材、字体与资源准备、局部组件、只读验收。按实际任务决定是否拆分，最多同时使用 3 个子代理；主代理继续推进可独立完成的页面工作。明确每个子代理负责的文件与产物路径，共享设计方向和参考图位置，告知它们其他代理也在工作，不覆盖别人的修改；有依赖或共同编辑同一文件的步骤由主代理协调。主代理负责合并、整页视觉一致性与最终验收；合并前等待相关产物完成。所有代理沿用本次模型和推理强度。
先检查已有 website/assets/、可用依赖和字体工具，适合时直接复用，避免重复下载或安装；确有缺少才准备依赖。不要让独立的素材下载、生图阻塞页面结构实现。尽早将完整页面写入 website/ 并运行 node preview.mjs，提供阶段预览，再合并素材和完善细节。阶段预览不代表最终验收通过。
分文件、分批保存实现，避免一次生成巨大脚本后才尝试落盘。使用 apply_patch 时必须包含 *** Begin Patch 与 *** End Patch；写入后立即确认文件存在。遇到写入或工具错误，先用最小命令修复调用方式，再复用已有内容继续，不要原样重试或整段重新生成。只对当前文件范围执行必要的读取。
首轮截图后优先修正最影响观感的具体差异并检查窄屏与关键交互；后续复查以尚未解决的问题为依据，已验证通过的内容不重复检查，除非后续修改影响它。出现等待、失败重试或阶段切换时，用简短进度说明已完成和正在处理的内容。交付时如实列出残余差距，保留视觉质量目标，不以耗时预算替代验收。
${TASK_PREVIEW_GUIDANCE}
最终只在 website/ 下交付可直接加载的静态 HTML、CSS、JavaScript 和本地资源，入口为 website/index.html；用户预览时无需安装或构建。生成图片和下载素材保存到 website/assets/，使用相对路径；依赖、构建源文件和临时产物放在 website/ 之外。允许通过 HTTPS 加载字体与字体样式表，其余资源保持本地化，不引入远程脚本或业务接口。隔离预览支持普通 SVG 图片；SVG sprite 请将 symbol 内联到当前 HTML，用 <use href="#id"> 引用，外链 <use href="assets/icons.svg#id"> 会受浏览器同源限制。预览环境不提供 localStorage，交互应实际可用。完成后简述交付和验证结果，未验证的部分如实说明。`;
function referenceInputGuidance(originalReference?: FeatureTest['originalReference']) {
  return `任务的只读视觉输入位于工作目录之外：所选卡片导出图为 ../reference.png。${originalReference
    ? `无标记原图为 ../${originalReference.filename}；需要以图生图或编辑时，可将这个原图路径作为图像参考输入。`
    : '本次沿用历史单图记录，没有可用的无标记原图；只附上卡片导出图，不要假定存在第二张输入。'}输入文件保持不变，原图内容只为已选特征提供视觉依据。`;
}
export type TestChecker = (url: string, signal: AbortSignal) => Promise<void>;
export function allowedPreviewResource(target: URL, origin: string, resourceType: string): boolean {
  return target.origin === origin || !['http:', 'https:'].includes(target.protocol) ||
    (target.protocol === 'https:' && ['font', 'stylesheet'].includes(resourceType));
}
export const checkFeatureTest: TestChecker = async (url, signal) => {
  const browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
  const close = () => { void browser.close(); }; signal.addEventListener('abort', close, { once: true });
  try {
    if (signal.aborted) throw new Error('检查已中断。');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    const failedRequests: { url: string; error: string }[] = [];
    await page.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (!allowedPreviewResource(target, new URL(url).origin, route.request().resourceType())) { errors.push(`页面尝试加载不允许的外部资源：${target.href}`); await route.abort(); }
      else await route.continue();
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`资源 HTTP ${response.status()}：${response.url()}`); });
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '资源请求失败' }));
    const response = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(300);
    const fontErrors = await page.evaluate(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([document.fonts.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('字体加载超时。')), 15000); })]);
        return [...document.fonts].filter(font => font.status === 'error').map(font => `字体加载失败：${font.family}`);
      } finally { clearTimeout(timer); }
    });
    errors.push(...fontErrors);
    const externalSvgUses = new Set(await page.evaluate(() => {
      if (globalThis.origin !== 'null') return [];
      const documentUrl = new URL(location.href); documentUrl.hash = '';
      return [...document.querySelectorAll<SVGUseElement>('svg use')].flatMap(use => {
        if (!use.href.baseVal) return [];
        try {
          const target = new URL(use.href.baseVal, use.baseURI); target.hash = '';
          return target.href === documentUrl.href ? [] : [target.href];
        } catch { return []; }
      });
    }));
    for (const failure of failedRequests) {
      const target = new URL(failure.url); target.hash = '';
      // Chromium's opaque-origin SVG use failure is distinct from ordinary CORS failures.
      errors.push(failure.error === 'origin' && externalSvgUses.has(target.href)
        ? `外链 SVG <use> 无法在隔离预览中加载：${target.href}。请将 symbol 内联到当前 HTML，并使用 <use href="#id"> 引用；普通 SVG 图片仍可使用。`
        : `${failure.error}：${failure.url}`);
    }
    if (!response?.ok() || errors.length) throw new Error(`网页加载检查未通过：${[...new Set(errors)].slice(0,3).join('；') || response?.status()}`);
  } finally { signal.removeEventListener('abort', close); await browser.close(); }
};

export class FeatureTests {
  readonly root: string;
  private source?: FeatureTestSource;
  private sourcePromise?: Promise<FeatureTestSource>;
  private builtinsPromise?: Promise<FeatureTestSource[]>;
  private active?: { id: string; controller: AbortController; promise: Promise<void>; reason?: 'cancelled' | 'interrupted' | 'timeout' };
  private preparing?: Promise<void>;
  private stopped = false;
  constructor(private boards: FeatureBoards, private mainRoot: string, private previewOrigin: string, private executor: Executor = executeCodex, private checker: TestChecker = checkFeatureTest, private timeoutMs = 1_800_000, private builtinRoot = builtinWebsiteRoot) {
    this.root = path.join(path.dirname(boards.root), 'feature-tests');
  }
  private async executeWebsite(options: ExecutionOptions) {
    const preview = await startTaskPreview({ cwd: options.cwd, signal: options.signal });
    try { return await this.executor({ ...options, parallelAgents: true }); }
    finally { await preview.close(); }
  }
  directory(id: string) { return path.join(this.root, 'runs', requireSafeId(id)); }
  workDirectory(id: string) { return path.join(this.directory(id),'work'); }
  websiteDirectory(id: string) { return path.join(this.workDirectory(id),'website'); }
  sourceDirectory(id: string) { return path.join(this.root, 'sources', requireSafeId(id), 'website'); }
  private async persist(run: FeatureTest) { const dir = this.directory(run.id); await mkdir(dir, { recursive: true }); const tmp = path.join(dir, 'run.json.tmp'); await writeFile(tmp, JSON.stringify(run,null,2), { mode: 0o600 }); await rename(tmp,path.join(dir,'run.json')); }
  private async withActivity<T extends FeatureTest | FeatureSourceRun>(run: T, cwd: string): Promise<T> {
    const [progress, draftPreview] = await Promise.all([readExecutionProgress(cwd), readDraftPreview(cwd)]);
    if (progress) {
      if (!activeStatus(run.status)) {
        progress.activeActions = [];
        progress.agents = progress.agents.map(agent => agent.status === 'running' ? { ...agent, status: 'closed' } : agent);
      }
      run.progress = progress;
    }
    if (draftPreview) run.draftPreview = draftPreview;
    else delete run.draftPreview;
    return run;
  }
  async get(id: string): Promise<FeatureTest> { return this.withActivity(JSON.parse(await readFile(path.join(this.directory(id),'run.json'),'utf8')), this.workDirectory(id)); }
  async originalReferenceFile(id: string): Promise<{ file: string; mimeType: string }> {
    const run = await this.get(id), reference = run.originalReference;
    if (!reference) fail('该历史测试未保存原始参考图。',404);
    const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[reference.mimeType];
    if (!extension || reference.filename !== `original-reference${extension}`) fail('原始参考图记录无效。',400);
    return { file: await safeFilePath(this.directory(id),reference.filename), mimeType: reference.mimeType };
  }
  async list(boardId?: string): Promise<FeatureTest[]> {
    const entries = await readdir(path.join(this.root,'runs'), { withFileTypes: true });
    const pending = await Promise.all(entries.filter(e=>e.isDirectory()).map(async e=>{try{return await this.get(e.name);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}));
    const runs = pending.filter((r): r is FeatureTest => !!r);
    return runs.filter(r=>!boardId || r.boardId===boardId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async initialize() {
    await mkdir(path.join(this.root,'runs'), { recursive: true });
    await mkdir(path.join(this.root,'source-runs'), { recursive: true });
    await this.builtinSources();
    for(const run of await this.listSourceRuns()) {
      if(activeStatus(run.status)) await this.persistSourceRun({ ...run, status:'interrupted', error:'服务重启，原网页生成已中断。', finishedAt:new Date().toISOString() });
      else if(run.status==='completed' && run.source) await this.saveSourceMetadata(run.source);
    }
    for(const run of await this.list()) if(activeStatus(run.status)) await this.persist({ ...run, status:'interrupted', error:'服务重启，测试已中断。原记录保留。', finishedAt:new Date().toISOString() });
  }
  async getSource(): Promise<FeatureTestSource> {
    if(this.source) return structuredClone(this.source);
    if(!this.sourcePromise) this.sourcePromise=this.importSource().then(source=>{ this.source=source; return source; }).finally(()=>{this.sourcePromise=undefined;});
    return structuredClone(await this.sourcePromise);
  }
  private builtinSources(): Promise<FeatureTestSource[]> {
    if (!this.builtinsPromise) this.builtinsPromise = freezeBuiltinSources(path.join(this.root, 'sources'), this.builtinRoot).catch(error => { this.builtinsPromise = undefined; throw error; });
    return this.builtinsPromise;
  }
  private async importSource(): Promise<FeatureTestSource> {
    try { return JSON.parse(await readFile(path.join(this.root,'source.json'),'utf8')); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    // Read the main store without initializing it: recovery must never alter main-branch runs.
    type LegacyData = { experiments: { id: string; title: string; createdAt: string; versions: { id: string; number: number; baselineRunId?: string; config: ModelConfig }[] }[]; runs: { id: string; groupId: string; status: string; artifactHash?: string; createdAt: string }[] };
    let data: LegacyData;
    try { data = JSON.parse(await readFile(path.join(this.mainRoot,'store.json'),'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return (await this.builtinSources())[0]; throw error; }
    const experiment = [...(data.experiments ?? [])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    const version = experiment?.versions.toSorted((a,b)=>b.number-a.number)[0];
    const baseline = (data.runs ?? []).find(r=>r.id===version?.baselineRunId);
    if(!experiment || !version || !baseline || baseline.groupId!=='baseline' || baseline.status!=='completed' || !baseline.artifactHash) return (await this.builtinSources())[0];
    const sourceDir=path.join(this.mainRoot,'runs',requireSafeId(baseline.id),'website');
    await safeFilePath(sourceDir,'index.html');
    if(await hashWebsite(sourceDir)!==baseline.artifactHash) fail('历史原始网页的哈希已变化，不能作为验证基线。',409);
    const target=this.sourceDirectory(baseline.id); await mkdir(path.dirname(target),{recursive:true}); await cp(sourceDir,target,{recursive:true});
    if(await hashWebsite(target)!==baseline.artifactHash) fail('原始网页复制校验失败。',409);
    const source: FeatureTestSource={ experimentId:experiment.id,title:experiment.title,versionId:version.id,versionNumber:version.number,runId:baseline.id,createdAt:baseline.createdAt,hash:baseline.artifactHash,config:version.config };
    await this.saveSourceMetadata(source);
    await this.publishSource(source); return source;
  }
  sourceRunDirectory(id: string) { return path.join(this.root, 'source-runs', requireSafeId(id)); }
  sourceWorkDirectory(id: string) { return path.join(this.sourceRunDirectory(id), 'work'); }
  sourceRunWebsite(id: string) { return path.join(this.sourceWorkDirectory(id), 'website'); }
  private async persistSourceRun(run: FeatureSourceRun) {
    const dir=this.sourceRunDirectory(run.id); await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'run.json.tmp'),JSON.stringify(run,null,2),{mode:0o600});
    await rename(path.join(dir,'run.json.tmp'),path.join(dir,'run.json'));
  }
  async getSourceRun(id: string): Promise<FeatureSourceRun> { return this.withActivity(JSON.parse(await readFile(path.join(this.sourceRunDirectory(id),'run.json'),'utf8')), this.sourceWorkDirectory(id)); }
  async listSourceRuns(): Promise<FeatureSourceRun[]> {
    const entries=await readdir(path.join(this.root,'source-runs'),{withFileTypes:true});
    const runs=await Promise.all(entries.filter(e=>e.isDirectory()).map(async e=>{try{return await this.getSourceRun(e.name);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}));
    return runs.filter((r):r is FeatureSourceRun=>!!r).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  private async saveSourceMetadata(source: FeatureTestSource) {
    const dir=path.dirname(this.sourceDirectory(source.runId)); await mkdir(dir,{recursive:true});
    const file=path.join(dir,'source.json');
    try {await readFile(file);return;} catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const tmp=path.join(dir,`source.${randomUUID()}.tmp`);
    await writeFile(tmp,JSON.stringify(source,null,2),{mode:0o600});await rename(tmp,file);
  }
  private async publishSource(source: FeatureTestSource) {
    await writeFile(path.join(this.root,'source.json.tmp'),JSON.stringify(source,null,2),{mode:0o600});
    await rename(path.join(this.root,'source.json.tmp'),path.join(this.root,'source.json'));
    this.source=source;
  }
  async getSourceById(id: string): Promise<FeatureTestSource> {
    requireSafeId(id);
    try {
      const source: FeatureTestSource = JSON.parse(await readFile(await safeFilePath(path.dirname(this.sourceDirectory(id)), 'source.json'), 'utf8'));
      if (source.runId !== id || (source.builtin && id !== `builtin-${source.builtin.slug}-${source.hash}`)) fail('原网页的来源记录已改变。',409);
      return source;
    }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    const current=await this.getSource();
    if(current.runId!==id) fail('原始网页不存在。',404);
    await this.saveSourceMetadata(current); return current;
  }
  async listSources(): Promise<FeatureTestSource[]> {
    const builtins = await this.builtinSources();
    // Preserve the original imported baseline when the first custom page is created.
    try { await this.saveSourceMetadata(await this.getSource()); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT' && (error as {status?:number}).status!==409)throw error; }
    await mkdir(path.join(this.root,'sources'),{recursive:true});
    const entries=await readdir(path.join(this.root,'sources'),{withFileTypes:true});
    const sources=await Promise.all(entries.filter(e=>e.isDirectory() && !e.name.startsWith('.')).map(async e=>{
      try{return JSON.parse(await readFile(path.join(this.root,'sources',e.name,'source.json'),'utf8')) as FeatureTestSource;}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
    }));
    const custom = sources.filter((s):s is FeatureTestSource=>!!s && !s.builtin).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return structuredClone([...builtins, ...custom]);
  }
  async generateSource(requirements: string, config: ModelConfig): Promise<FeatureSourceRun> {
    requirements=text(requirements,'网页需求',12000).trim();
    if(this.stopped || this.preparing || this.active) fail('已有网页任务正在执行，请等待完成或取消后再试。',409);
    let prepared!:()=>void; this.preparing=new Promise<void>(resolve=>{prepared=resolve;});
    try {
      await this.listSources();
      const id=randomUUID(); await mkdir(this.sourceRunWebsite(id),{recursive:true});
      const prompt=`请根据以下用户需求生成一份完整、可使用的网页。自行决定合适的视觉设计，演示数据保持固定。\n${VISUAL_IMPLEMENTATION_GUIDANCE}\n${WEBSITE_WORKFLOW}\n\n用户需求：\n${requirements}`;
      const run:FeatureSourceRun={id,requirements,prompt,config,createdAt:new Date().toISOString(),status:'running'};
      await writeFile(path.join(this.sourceRunDirectory(id),'input.json'),JSON.stringify(run,null,2));
      await writeFile(path.join(this.sourceRunDirectory(id),'prompt.txt'),prompt);
      if(this.stopped) {run.status='interrupted';run.error='服务停止，原网页生成未启动。';await this.persistSourceRun(run);return run;}
      await this.persistSourceRun(run);
      const active={id,controller:new AbortController(),promise:Promise.resolve(),reason:undefined as 'cancelled'|'interrupted'|'timeout'|undefined};this.active=active;
      active.promise=this.executeSource(run,active).finally(()=>{this.active=undefined;});return structuredClone(run);
    } finally {this.preparing=undefined;prepared();}
  }
  private async executeSource(run: FeatureSourceRun, active: NonNullable<FeatureTests['active']>) {
    const timer=setTimeout(()=>{active.reason='timeout';active.controller.abort();},this.timeoutMs);
    try {
      const result=await this.executeWebsite({run:{id:run.id},cwd:this.sourceWorkDirectory(run.id),prompt:run.prompt,config:run.config,signal:active.controller.signal});
      Object.assign(run,{exitCode:result.exitCode,usage:result.usage,summary:result.summary});
      if(active.controller.signal.aborted)throw new Error('生成已停止。');
      if(result.exitCode!==0 || result.error)throw new Error(result.error || `Codex 退出码：${result.exitCode}`);
      await inspectWebsite(this.sourceRunWebsite(run.id));
      run.status='checking';await this.persistSourceRun(run);
      await this.checker(`${this.previewOrigin}/feature-tests/source-runs/${run.id}/index.html`,active.controller.signal);
      if(active.controller.signal.aborted)throw new Error('生成已停止。');
      const hash=await hashWebsite(this.sourceRunWebsite(run.id));
      await mkdir(path.dirname(this.sourceDirectory(run.id)),{recursive:true});
      await cp(this.sourceRunWebsite(run.id),this.sourceDirectory(run.id),{recursive:true});
      if(await hashWebsite(this.sourceDirectory(run.id))!==hash)throw new Error('原网页冻结副本校验失败。');
      if(active.controller.signal.aborted)throw new Error('生成已停止。');
      const source:FeatureTestSource={experimentId:run.id,versionId:run.id,versionNumber:1,runId:run.id,title:run.requirements.slice(0,60),requirements:run.requirements,createdAt:run.createdAt,hash,config:run.config};
      run.source=source;run.status='completed';
    } catch(error) {
      run.status=active.reason==='cancelled'?'cancelled':active.reason==='interrupted'?'interrupted':'failed';
      run.error=active.reason==='timeout'?'原网页生成超过 30 分钟，已停止。':active.reason==='cancelled'?'已取消原网页生成。':active.reason==='interrupted'?'服务停止，原网页生成中断。':(error as Error).message;
    } finally {
      clearTimeout(timer);run.finishedAt=new Date().toISOString();run.elapsedMs=Date.now()-Date.parse(run.createdAt);await this.persistSourceRun(run);
      // Publish only terminal successful outputs; failed or interrupted jobs cannot replace the original page.
      if(run.status==='completed' && run.source)await this.saveSourceMetadata(run.source);
    }
  }
  async cancelSource(id: string) {await this.preparing;if(this.active?.id===id){this.active.reason='cancelled';this.active.controller.abort();await this.active.promise;}return this.getSourceRun(id);}
  async start(boardId: string, revision: number, image: Buffer, config: ModelConfig, sourceId?: string): Promise<FeatureTest> {
    if(this.stopped || this.preparing || this.active) fail('已有测试正在执行，请等待完成或取消后再试。',409);
    let prepared!:()=>void; this.preparing=new Promise<void>(resolve=>{prepared=resolve;});
    try {
      const board=await this.boards.get(boardId);
      if(board.revision!==revision) fail('卡片已更新，请用当前选择重新测试。',409);
      if(board.status==='running' || !selectedFeatures(board).length) fail('请先完成并勾选要验证的卡片。');
      if(detectImageType(image)?.mimeType!=='image/png') fail('测试需要导出的 PNG 卡片图片。');
      const originalBytes = await this.boards.readReference(board.reference.id);
      const originalType = detectImageType(originalBytes);
      const originalHash = createHash('sha256').update(originalBytes).digest('hex');
      if (!originalType || originalType.mimeType !== board.reference.mimeType || originalHash !== board.reference.sha256) fail('原始参考图已改变，请重新上传后再测试。',409);
      const originalReference = { filename: `original-reference${originalType.extension}`, mimeType: originalType.mimeType, sha256: originalHash };
      const source=sourceId ? await this.getSourceById(sourceId) : await this.getSource();
      await safeFilePath(this.sourceDirectory(source.runId),'index.html');
      if(await hashWebsite(this.sourceDirectory(source.runId))!==source.hash) fail('冻结的验证基线已改变。',409);
      const id=randomUUID(), dir=this.directory(id); await mkdir(this.workDirectory(id),{recursive:true});
      await cp(this.sourceDirectory(source.runId),this.websiteDirectory(id),{recursive:true});
      if(await hashWebsite(this.websiteDirectory(id))!==source.hash) fail('测试副本校验失败。',409);
      const prompt=`website/ 中已有一份完整的网页，请直接修改这个副本，保留真实业务内容、数据和交互。\n${WEBSITE_WORKFLOW}\n${referenceInputGuidance(originalReference)}\n\n${featureInstruction(board)}`;
      const run: FeatureTest={id,boardId,boardRevision:revision,board,source,config,prompt,imageHash:createHash('sha256').update(image).digest('hex'),originalReference,createdAt:new Date().toISOString(),status:'running',hasPreview:false};
      await writeFile(path.join(dir,originalReference.filename),originalBytes,{flag:'wx',mode:0o600});
      await writeFile(path.join(dir,'reference.png'),image);
      return await this.publishTest(run);
    } finally { this.preparing=undefined; prepared(); }
  }
  async refine(parentId: string, feedback: string, config: ModelConfig): Promise<FeatureTest> {
    feedback=text(feedback,'继续优化要求',4000).trim();
    if(this.stopped || this.preparing || this.active) fail('已有测试正在执行，请等待完成或取消后再试。',409);
    let prepared!:()=>void; this.preparing=new Promise<void>(resolve=>{prepared=resolve;});
    try {
      const parent=await this.get(requireSafeId(parentId));
      if(parent.id!==parentId) fail('父测试记录标识不一致。',409);
      if(!parent.hasPreview || !['completed','failed','cancelled','interrupted'].includes(parent.status)) fail('只有已结束且保留可预览产物的测试才能继续优化。',409);
      const previousFeedback=await this.refinementFeedback(parent);
      const board=structuredClone(parent.board), source=structuredClone(parent.source);
      if(!selectedFeatures(board).length) fail('原测试没有已选特征，不能继续优化。',409);
      const parentWebsite=this.websiteDirectory(parent.id);
      await safeFilePath(parentWebsite,'index.html');
      for(const file of await inspectWebsite(parentWebsite)) await safeFilePath(parentWebsite,file);
      const parentArtifactHash=await hashWebsite(parentWebsite);
      await safeFilePath(this.sourceDirectory(source.runId),'index.html');
      if(await hashWebsite(this.sourceDirectory(source.runId))!==source.hash) fail('冻结的验证基线已改变。',409);
      const image=await readFile(await safeFilePath(this.directory(parent.id),'reference.png'));
      if(detectImageType(image)?.mimeType!=='image/png' || createHash('sha256').update(image).digest('hex')!==parent.imageHash) fail('父测试的卡片输入已改变，不能继续优化。',409);
      let originalBytes: Buffer | undefined;
      if(parent.originalReference) originalBytes=await readFile((await this.originalReferenceFile(parent.id)).file);
      else {
        // Older tests did not freeze the second image. Recover only the exact
        // reference represented by their frozen board, never a newer board image.
        try { originalBytes=await this.boards.readReference(board.reference.id); }
        catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
      }
      let originalReference: FeatureTest['originalReference'];
      if(originalBytes) {
        const type=detectImageType(originalBytes), sha256=createHash('sha256').update(originalBytes).digest('hex');
        if(!type || type.mimeType!==board.reference.mimeType || sha256!==board.reference.sha256 ||
          (parent.originalReference && (type.mimeType!==parent.originalReference.mimeType || sha256!==parent.originalReference.sha256))) fail('父测试的原始参考图已改变，不能继续优化。',409);
        originalReference={filename:`original-reference${type.extension}`,mimeType:type.mimeType,sha256};
      }
      const id=randomUUID(), dir=this.directory(id); await mkdir(this.workDirectory(id),{recursive:true});
      await cp(parentWebsite,this.websiteDirectory(id),{recursive:true});
      if(await hashWebsite(parentWebsite)!==parentArtifactHash || await hashWebsite(this.websiteDirectory(id))!==parentArtifactHash) fail('父测试产物在复制期间发生变化，请重试。',409);
      const history=previousFeedback.length?`\n\n此前已接受的优化要求（按旧到新排列）：\n已满足的要求继续保持；本轮有明确变更时，本轮要求优先。\n${previousFeedback.map((value,index)=>`第 ${index+1} 轮：\n${value}`).join('\n\n')}`:'';
      const prompt=`website/ 中是上一轮测试产物的独立副本。请根据本次反馈继续缩小与参考图的视觉差距，保留已实现的有效效果、真实业务内容、数据和交互；仅修改当前副本。沿用下面冻结的卡片选择与应用范围，未选特征不成为新增要求。\n${WEBSITE_WORKFLOW}\n${referenceInputGuidance(originalReference)}${history}\n\n本次继续优化反馈：\n${feedback}\n\n${featureInstruction(board,{hasOriginalReference:!!originalReference})}`;
      const run: FeatureTest={id,boardId:parent.boardId,boardRevision:parent.boardRevision,board,source,config,prompt,imageHash:parent.imageHash,originalReference,
        refinement:{parentTestId:parent.id,parentArtifactHash,feedback},createdAt:new Date().toISOString(),status:'running',hasPreview:false};
      await writeFile(path.join(dir,'reference.png'),image,{flag:'wx',mode:0o600});
      if(originalReference && originalBytes) await writeFile(path.join(dir,originalReference.filename),originalBytes,{flag:'wx',mode:0o600});
      return await this.publishTest(run);
    } finally {this.preparing=undefined;prepared();}
  }
  private async refinementFeedback(parent: FeatureTest): Promise<string[]> {
    const visited=new Set([parent.id]), feedback:string[]=[];
    let current=parent;
    while(current.refinement) {
      const value=current.refinement.feedback;
      if(typeof value!=='string' || !value.trim() || value.length>4000) fail('历史优化要求记录无效，不能忽略后继续优化。',409);
      feedback.push(value);
      let ancestorId:string;
      try { ancestorId=requireSafeId(current.refinement.parentTestId); }
      catch { fail('历史优化链包含无效的父测试标识。',409); }
      if(visited.has(ancestorId)) fail('历史优化链出现循环，不能继续优化。',409);
      visited.add(ancestorId);
      try { current=await this.get(ancestorId); }
      catch(error) {
        if((error as NodeJS.ErrnoException).code==='ENOENT') fail('历史优化链缺少父测试记录，不能丢弃此前要求后继续优化。',409);
        throw error;
      }
      if(current.id!==ancestorId) fail('历史优化链的记录标识不一致。',409);
    }
    return feedback.reverse();
  }
  private async publishTest(run: FeatureTest): Promise<FeatureTest> {
    const dir=this.directory(run.id);
    await writeFile(path.join(dir,'prompt.txt'),run.prompt);
    await writeFile(path.join(dir,'input.json'),JSON.stringify(run,null,2));
    if(this.stopped) { run.status='interrupted'; run.error='服务停止，测试未启动。'; await this.persist(run); return structuredClone(run); }
    await this.persist(run);
    const active={id:run.id,controller:new AbortController(),promise:Promise.resolve(),reason:undefined as 'cancelled'|'interrupted'|'timeout'|undefined}; this.active=active;
    active.promise=this.execute(run,active).finally(()=>{this.active=undefined;}); return structuredClone(run);
  }
  private async execute(run: FeatureTest, active: NonNullable<FeatureTests['active']>) {
    const timer=setTimeout(()=>{active.reason='timeout';active.controller.abort();},this.timeoutMs);
    try {
      const referenceFiles = [path.join(this.directory(run.id),'reference.png')];
      if (run.originalReference) referenceFiles.push((await this.originalReferenceFile(run.id)).file);
      if(active.controller.signal.aborted) throw new Error('测试已停止。');
      const result=await this.executeWebsite({run: {id:run.id},cwd:this.workDirectory(run.id),prompt:run.prompt,referenceFiles,config: run.config,signal:active.controller.signal});
      Object.assign(run,{exitCode:result.exitCode,usage:result.usage,summary:result.summary});
      if(active.controller.signal.aborted) throw new Error('测试已停止。');
      try { await inspectWebsite(this.websiteDirectory(run.id)); run.hasPreview=true; } catch { /* Keep failed files, but do not expose an invalid tree. */ }
      if(result.exitCode!==0 || result.error) throw new Error(result.error || `Codex 退出码：${result.exitCode}`);
      if(!run.hasPreview) throw new Error('没有可预览的静态网页。');
      run.changed=await hashWebsite(this.websiteDirectory(run.id))!==run.source.hash;
      run.status='checking'; await this.persist(run);
      await this.checker(`${this.previewOrigin}/feature-tests/runs/${run.id}/index.html`,active.controller.signal);
      if(active.controller.signal.aborted) throw new Error('测试已停止。');
      run.status='completed';
    } catch(error) {
      run.status=active.reason==='cancelled'?'cancelled':active.reason==='interrupted'?'interrupted':'failed';
      run.error=active.reason==='timeout'?'测试超过 30 分钟，已停止。':active.reason==='cancelled'?'已取消测试。':active.reason==='interrupted'?'服务停止，测试中断。':(error as Error).message;
    } finally { clearTimeout(timer);run.finishedAt=new Date().toISOString();run.elapsedMs=Date.now()-Date.parse(run.createdAt);await this.persist(run); }
  }
  async cancel(id: string) { await this.preparing; if(this.active?.id===id){this.active.reason='cancelled';this.active.controller.abort();await this.active.promise;} return this.get(id); }
  async shutdown() { this.stopped=true;await this.preparing;if(this.active){this.active.reason='interrupted';this.active.controller.abort();await this.active.promise;} }
}
