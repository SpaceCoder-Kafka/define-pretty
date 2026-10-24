import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { featureInstruction, selectedFeatures } from '../shared/feature-board.ts';
import type { FeatureTest, FeatureTestSource } from '../shared/feature-test.ts';
import type { ModelConfig } from '../shared/types.ts';
import { FeatureBoards } from './feature-boards.ts';
import { executeCodex, hashWebsite, type Executor } from './codex.ts';
import { chromeExecutable, inspectWebsite } from './validation.ts';
import { detectImageType, requireSafeId, safeFilePath } from './security.ts';
import { fail } from './input.ts';

const activeStatus = (status: string) => ['queued','running','checking'].includes(status);
export type TestChecker = (url: string, signal: AbortSignal) => Promise<void>;
export const checkFeatureTest: TestChecker = async (url, signal) => {
  const browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
  const close = () => { void browser.close(); }; signal.addEventListener('abort', close, { once: true });
  try {
    if (signal.aborted) throw new Error('检查已中断。');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    await page.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (['http:','https:'].includes(target.protocol) && target.origin !== new URL(url).origin) { errors.push('页面尝试加载外部资源'); await route.abort(); }
      else await route.continue();
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`资源 HTTP ${response.status()}`); });
    page.on('requestfailed', request => errors.push(request.failure()?.errorText || '资源请求失败'));
    const response = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(300);
    if (!response?.ok() || errors.length) throw new Error(`网页加载检查未通过：${errors.slice(0,3).join('；') || response?.status()}`);
  } finally { signal.removeEventListener('abort', close); await browser.close(); }
};

export class FeatureTests {
  readonly root: string;
  private source?: FeatureTestSource;
  private sourcePromise?: Promise<FeatureTestSource>;
  private active?: { id: string; controller: AbortController; promise: Promise<void>; reason?: 'cancelled' | 'interrupted' | 'timeout' };
  private preparing?: Promise<void>;
  private stopped = false;
  constructor(private boards: FeatureBoards, private mainRoot: string, private previewOrigin: string, private executor: Executor = executeCodex, private checker: TestChecker = checkFeatureTest, private timeoutMs = 1_800_000) {
    this.root = path.join(path.dirname(boards.root), 'feature-tests');
  }
  directory(id: string) { return path.join(this.root, 'runs', requireSafeId(id)); }
  workDirectory(id: string) { return path.join(this.directory(id),'work'); }
  websiteDirectory(id: string) { return path.join(this.workDirectory(id),'website'); }
  sourceDirectory(id: string) { return path.join(this.root, 'sources', requireSafeId(id), 'website'); }
  private async persist(run: FeatureTest) { const dir = this.directory(run.id); await mkdir(dir, { recursive: true }); const tmp = path.join(dir, 'run.json.tmp'); await writeFile(tmp, JSON.stringify(run,null,2), { mode: 0o600 }); await rename(tmp,path.join(dir,'run.json')); }
  async get(id: string): Promise<FeatureTest> { return JSON.parse(await readFile(path.join(this.directory(id),'run.json'),'utf8')); }
  async list(boardId?: string): Promise<FeatureTest[]> {
    const entries = await readdir(path.join(this.root,'runs'), { withFileTypes: true });
    const pending = await Promise.all(entries.filter(e=>e.isDirectory()).map(async e=>{try{return await this.get(e.name);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}));
    const runs = pending.filter((r): r is FeatureTest => !!r);
    return runs.filter(r=>!boardId || r.boardId===boardId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async initialize() {
    await mkdir(path.join(this.root,'runs'), { recursive: true });
    for(const run of await this.list()) if(activeStatus(run.status)) await this.persist({ ...run, status:'interrupted', error:'服务重启，测试已中断。原记录保留。', finishedAt:new Date().toISOString() });
  }
  async getSource(): Promise<FeatureTestSource> {
    if(this.source) return structuredClone(this.source);
    if(!this.sourcePromise) this.sourcePromise=this.importSource().then(source=>{ this.source=source; return source; }).finally(()=>{this.sourcePromise=undefined;});
    return structuredClone(await this.sourcePromise);
  }
  private async importSource(): Promise<FeatureTestSource> {
    try { return JSON.parse(await readFile(path.join(this.root,'source.json'),'utf8')); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    // Read the main store without initializing it: recovery must never alter main-branch runs.
    const data = JSON.parse(await readFile(path.join(this.mainRoot,'store.json'),'utf8')) as { experiments: { id: string; title: string; createdAt: string; versions: { id: string; number: number; baselineRunId?: string; config: ModelConfig }[] }[]; runs: { id: string; groupId: string; status: string; artifactHash?: string; createdAt: string }[] };
    const experiment = [...data.experiments].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    const version = experiment?.versions.toSorted((a,b)=>b.number-a.number)[0];
    const baseline = data.runs.find(r=>r.id===version?.baselineRunId);
    if(!experiment || !version || !baseline || baseline.groupId!=='baseline' || baseline.status!=='completed' || !baseline.artifactHash) fail('尚未导入可用的验证原网页。',409);
    const sourceDir=path.join(this.mainRoot,'runs',requireSafeId(baseline.id),'website');
    await safeFilePath(sourceDir,'index.html');
    if(await hashWebsite(sourceDir)!==baseline.artifactHash) fail('历史原始网页的哈希已变化，不能作为验证基线。',409);
    const target=this.sourceDirectory(baseline.id); await mkdir(path.dirname(target),{recursive:true}); await cp(sourceDir,target,{recursive:true});
    if(await hashWebsite(target)!==baseline.artifactHash) fail('原始网页复制校验失败。',409);
    const source: FeatureTestSource={ experimentId:experiment.id,title:experiment.title,versionId:version.id,versionNumber:version.number,runId:baseline.id,createdAt:baseline.createdAt,hash:baseline.artifactHash,config:version.config };
    await writeFile(path.join(this.root,'source.json.tmp'),JSON.stringify(source,null,2),{mode:0o600}); await rename(path.join(this.root,'source.json.tmp'),path.join(this.root,'source.json')); return source;
  }
  async start(boardId: string, revision: number, image: Buffer, config: ModelConfig): Promise<FeatureTest> {
    if(this.stopped || this.preparing || this.active) fail('已有测试正在执行，请等待完成或取消后再试。',409);
    let prepared!:()=>void; this.preparing=new Promise<void>(resolve=>{prepared=resolve;});
    try {
      const board=await this.boards.get(boardId);
      if(board.revision!==revision) fail('卡片已更新，请用当前选择重新测试。',409);
      if(board.status==='running' || !selectedFeatures(board).length) fail('请先完成并勾选要验证的卡片。');
      if(detectImageType(image)?.mimeType!=='image/png') fail('测试需要导出的 PNG 卡片图片。');
      const source=await this.getSource();
      if(await hashWebsite(this.sourceDirectory(source.runId))!==source.hash) fail('冻结的验证基线已改变。',409);
      const id=randomUUID(), dir=this.directory(id); await mkdir(this.workDirectory(id),{recursive:true});
      await cp(this.sourceDirectory(source.runId),this.websiteDirectory(id),{recursive:true});
      if(await hashWebsite(this.websiteDirectory(id))!==source.hash) fail('测试副本校验失败。',409);
      const prompt=`website/ 中已有一份完整的项目管理网页，请直接修改这个副本。交付保持自包含的 HTML、CSS、JavaScript 和本地资源，入口为 website/index.html，使用相对路径引用资源。\n\n${featureInstruction(board)}`;
      const run: FeatureTest={id,boardId,boardRevision:revision,board,source,config,prompt,imageHash:createHash('sha256').update(image).digest('hex'),createdAt:new Date().toISOString(),status:'running',hasPreview:false};
      await writeFile(path.join(dir,'reference.png'),image); await writeFile(path.join(dir,'prompt.txt'),prompt); await writeFile(path.join(dir,'input.json'),JSON.stringify(run,null,2));
      if(this.stopped) { run.status='interrupted'; run.error='服务停止，测试未启动。'; await this.persist(run); return run; }
      await this.persist(run);
      const active={id,controller:new AbortController(),promise:Promise.resolve(),reason:undefined as 'cancelled'|'interrupted'|'timeout'|undefined}; this.active=active;
      active.promise=this.execute(run,active).finally(()=>{this.active=undefined;}); return structuredClone(run);
    } finally { this.preparing=undefined; prepared(); }
  }
  private async execute(run: FeatureTest, active: NonNullable<FeatureTests['active']>) {
    const timer=setTimeout(()=>{active.reason='timeout';active.controller.abort();},this.timeoutMs);
    try {
      const result=await this.executor({run: {id:run.id},cwd:this.workDirectory(run.id),prompt:run.prompt,referenceFile:path.join(this.directory(run.id),'reference.png'),config: run.config,signal:active.controller.signal});
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
