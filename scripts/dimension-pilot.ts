/** A small, isolated experiment. It never writes the application's store. */
import { createServer, type Server } from 'node:http';
import { randomInt, createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { executeCodex, hashWebsite, createWebsiteDiff } from '../server/runner.ts';
import { chromeExecutable, validateWebsite } from '../server/validation.ts';
import { previewHeaders, safeFilePath } from '../server/security.ts';
import type { Experiment, Run, RunConfig, ReferenceAsset } from '../shared/types.ts';

const project = process.cwd();
const mode = process.argv[2];
const root = path.resolve(process.argv[3] || '.data/pilots/illustration-20261024');
const consolePort = 4183, previewPort = 4184;
const origin = `http://127.0.0.1:${consolePort}`, previewOrigin = `http://127.0.0.1:${previewPort}`;
type Sample = { id: string; arm: 'sentence' | 'rules'; block: number; status: string; elapsedMs?: number; error?: string; validationPassed?: boolean; artifactHash?: string };
type Manifest = { createdAt: string; sourceExperimentId: string; sourceVersionId: string; baselineId: string; baselineHash: string; referenceHash: string; config: RunConfig; goal: string; common: string; rules: string; samples: Sample[]; sourceRule: unknown; rubric: string[]; limitations: string[] };
let manifest: Manifest;
const json = async (file: string, value: unknown) => writeFile(path.join(root, file), JSON.stringify(value, null, 2));
const save = () => json('manifest.json', manifest);
const shuffled = <T,>(items: T[]) => { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; };

async function prepare() {
  try { await access(root); throw new Error('实验目录已存在；不会覆盖或自动重跑。使用 serve 查看，或指定新目录。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const store = JSON.parse(await readFile(path.join(project, '.data/store.json'), 'utf8')) as { experiments: Experiment[]; runs: Run[]; references: ReferenceAsset[] };
  const experiment = store.experiments.find(e => e.id === '3629a963-c196-4983-966b-836492833862')!;
  const version = experiment.versions.find(v => v.id === 'df08fa99-9373-4ddc-9df9-452e08262265')!;
  const baseline = store.runs.find(r => r.id === version.baselineRunId)!;
  const reference = store.references.find(r => r.id === version.referenceId)!;
  const rule = version.dimensions.find(d => d.title === '有机色块拼贴插画')!;
  if (!rule || baseline.status !== 'completed' || !baseline.artifactHash) throw new Error('指定的已冻结输入不可用。');
  const baselineDir = path.join(project, '.data/runs', baseline.id);
  if (await hashWebsite(path.join(baselineDir, 'frozen')) !== baseline.artifactHash) throw new Error('原始页哈希不匹配。');
  const referenceBytes = await readFile(path.join(project, '.data/references', reference.id + '.jpg'));
  if (createHash('sha256').update(referenceBytes).digest('hex') !== reference.sha256) throw new Error('参考图哈希不匹配。');
  const goal = '请借鉴所附参考图的插画风格，重绘现有引导卡片中的协作插画。';
  const common = `website/ 中已有完整的项目管理网页。两位成员协作的插画位于引导卡片 #guide 中。\n保留原始业务文案、数据、模块和所有交互功能，以及现有 data-testid、data-task-id、data-title、data-status。\n本次目标仅为既有引导卡片中的插画。保留团队协作题材，不复制参考图中的业务、人物或秋日活动内容；不改其他区域的主题，不新增模块。允许为插画承载做必要的卡片内部尺寸与间距适配。\n只修改 website/ 下的静态 HTML、CSS、普通 JavaScript 和本地 SVG/资源，入口保持 website/index.html。所有引用使用相对路径；不要联网、安装依赖、使用远程字体或引入框架，不读取工作目录以外的项目文件。\n这是一次生成，不进行额外的浏览器验证或二次润色。外部执行器会对所有结果统一进行 1440×1000 截图和功能检查。完成文件后结束，简述改动。`;
  const labels = shuffled(['A', 'B', 'C', 'D', 'E', 'F']);
  const samples: Sample[] = [];
  for (let block = 1; block <= 3; block++) for (const arm of shuffled(['sentence', 'rules'] as const)) samples.push({ id: labels.shift()!, arm, block, status: 'queued' });
  manifest = { createdAt: new Date().toISOString(), sourceExperimentId: experiment.id, sourceVersionId: version.id, baselineId: baseline.id, baselineHash: baseline.artifactHash, referenceHash: reference.sha256, config: { ...version.config, concurrency: 2 }, goal, common, rules: rule.instructions, samples, sourceRule: rule,
    rubric: ['目标风格迁移：有机色块、层叠与简化形体是否可辨认，避免只按颜色变化评分。', '语义保留：仍能辨认为团队协作；未复制秋日活动业务。', '范围：变化集中于既有引导卡片插画，必要内部适配可接受。', '审美偏好：相对原始页更好／相当／更差，由用户匿名判断。', '技术：统一加载、搜索、筛选、详情、任务身份与资源检查；技术通过不等于审美通过。'],
    limitations: ['一个页面、一个参考图、一个维度、每种方法三次；只能作为局部试验，不能证明普遍优越或统计等效。', '两组共享上下文与业务/技术边界，一句话指风格指令部分，不是整个输入只有一句。', '规则为已有生成结果，未根据本轮输出改写；试验比较增加这些规则的效果，不是格式本身的纯效应。', '两组均为一次生成，宿主检查在生成后执行，不把检查结果回传修正。', '三次独立会话未固定随机种子；每个时间区块并行一组一句话和一组规范，避免先后批次偏差。', '目标仅为插画画法，不要求插画主导整页，也不测试整页还原或跨页面迁移。'] };
  await mkdir(path.join(root, 'runs/baseline'), { recursive: true });
  await cp(path.join(baselineDir, 'frozen'), path.join(root, 'runs/baseline/website'), { recursive: true });
  await cp(path.join(baselineDir, 'semantic.json'), path.join(root, 'runs/baseline/semantic.json'));
  await writeFile(path.join(root, 'reference.jpg'), referenceBytes);
  await save();
  for (const sample of samples) {
    const dir = path.join(root, 'runs', sample.id);
    await mkdir(dir, { recursive: true });
    await cp(path.join(baselineDir, 'frozen'), path.join(dir, 'website'), { recursive: true });
    await writeFile(path.join(dir, 'reference.jpg'), referenceBytes);
    const prompt = `${common}\n\n本次风格目标：\n${goal}${sample.arm === 'rules' ? `\n\n具体规则：\n${rule.instructions}` : ''}\n`;
    await writeFile(path.join(dir, 'prompt.txt'), prompt);
    await writeFile(path.join(dir, 'input.json'), JSON.stringify({ prompt, baselineHash: manifest.baselineHash, referenceHash: manifest.referenceHash, config: manifest.config }, null, 2));
  }
  await writeFile(path.join(root, 'protocol.md'), `# 插画维度配对验证\n\n冻结时间：${manifest.createdAt}\n\n目标：${goal}\n\n两组各 3 次，一句话组与规范组共享相同目标、基线、图片、模型、公共约束、工具及运行预算，仅规范组追加现有四条规则。所有失败保留，不择优重跑。\n\n## 评价\n${manifest.rubric.map(x => '- ' + x).join('\n')}\n\n## 限制\n${manifest.limitations.map(x => '- ' + x).join('\n')}\n\n## 公共约束\n${common}\n\n## 追加规则\n${rule.instructions}\n`);
}

async function capture(id: string) {
  const browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(`${previewOrigin}/runs/${id}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, 'runs', id, 'initial.png'), animations: 'disabled' });
    const guide = page.locator('#guide');
    if (await guide.count() === 1) await guide.screenshot({ path: path.join(root, 'runs', id, 'target.png'), animations: 'disabled' });
    const geometry = await page.locator('body').evaluate(el => ({ viewport: innerWidth, scrollWidth: el.scrollWidth }));
    await json(`runs/${id}/geometry.json`, geometry);
  } finally { await browser.close(); }
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}

async function servers() {
  const preview = express(); preview.use(previewHeaders(consolePort));
  preview.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  preview.get(/^\/runs\/([A-F]|baseline)\/(.+)$/, async (req, res) => {
    try { res.sendFile(await safeFilePath(path.join(root, 'runs', req.params[0], 'website'), req.params[1]), { dotfiles: 'allow' }); }
    catch { res.sendStatus(404); }
  });
  const report = express();
  report.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  report.get('/', async (_req, res) => { res.type('html').send(await readFile(path.join(project, 'scripts/dimension-pilot.html'), 'utf8')); });
  report.get('/state.json', (_req, res) => { res.json({ id: path.basename(root), goal: manifest.goal, config: { model: manifest.config.model, reasoningEffort: manifest.config.reasoningEffort }, samples: [...manifest.samples].sort((a,b) => a.id.localeCompare(b.id)).map(({ id, status, error, validationPassed }) => ({ id, status, error, validationPassed })), pairs: [1, 2, 3].map(block => ({ id: block, samples: manifest.samples.filter(s => s.block === block).map(s => s.id).sort() })), rubric: manifest.rubric, limitations: manifest.limitations }); });
  report.get('/reveal.json', (_req, res) => { res.json(manifest); });
  report.get('/protocol.md', (_req, res) => { res.sendFile(path.join(root, 'protocol.md'), { dotfiles: 'allow' }); });
  report.get('/reference.jpg', (_req, res) => { res.sendFile(path.join(root, 'reference.jpg'), { dotfiles: 'allow' }); });
  report.get(/^\/runs\/([A-F]|baseline)\/(initial.png|target.png|prompt.txt|validation.json|diff.txt)$/, (req, res) => { res.sendFile(path.join(root, 'runs', req.params[0], req.params[1]), { dotfiles: 'allow' }); });
  const previewServer = createServer(preview), reportServer = createServer(report);
  await listen(previewServer, previewPort);
  try { await listen(reportServer, consolePort); } catch(error) { previewServer.close(); throw error; }
  console.log(`匿名对比：${origin}\n产物目录：${root}`);
  return [previewServer, reportServer];
}

if (mode === 'run') await prepare();
else if (mode === 'serve') manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
else throw new Error('用法：npx tsx scripts/dimension-pilot.ts run|serve [新实验目录]');
const runningServers = await servers();
const controllers = new Set<AbortController>();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; for (const controller of controllers) controller.abort(); for (const server of runningServers) server.close(); });
process.on('SIGINT', () => { stopping = true; for (const controller of controllers) controller.abort(); for (const server of runningServers) server.close(); });
if (mode === 'run') {
  await capture('baseline');
  for (let block = 1; block <= 3; block++) {
    await Promise.all(manifest.samples.filter(s => s.block === block).map(async sample => {
      if (stopping) { sample.status = 'interrupted'; return; }
      const dir = path.join(root, 'runs', sample.id);
      const controller = new AbortController(); controllers.add(controller);
      const start = Date.now();
      const timer = setTimeout(() => controller.abort(), manifest.config.timeoutMs);
      sample.status = 'running'; await save(); console.log(`开始 ${sample.id}`);
      try {
        if (await hashWebsite(path.join(dir, 'website')) !== manifest.baselineHash) throw new Error('基线副本哈希不一致');
        const prompt = await readFile(path.join(dir, 'prompt.txt'), 'utf8');
        const result = await executeCodex({ run: { id: sample.id } as Run, cwd: dir, prompt, config: manifest.config, referenceFile: path.join(dir, 'reference.jpg'), signal: controller.signal });
        await json(`runs/${sample.id}/execution.json`, result);
        if (controller.signal.aborted) throw new Error(stopping ? '运行中断' : '30 分钟超时');
        if (result.exitCode !== 0 || result.error) throw new Error(result.error || `退出码 ${result.exitCode}`);
        if (createHash('sha256').update(await readFile(path.join(dir, 'reference.jpg'))).digest('hex') !== manifest.referenceHash) throw new Error('参考图被修改');
        sample.status = 'checking'; await save();
        await writeFile(path.join(dir, 'diff.txt'), await createWebsiteDiff(path.join(root, 'runs/baseline/website'), path.join(dir, 'website')));
        sample.artifactHash = await hashWebsite(path.join(dir, 'website'));
        // Fresh initial screenshot is taken before interaction tests can scroll the page.
        await capture(sample.id);
        const validation = await validateWebsite({ runId: sample.id, runDir: dir, previewOrigin, baselineDir: path.join(root, 'runs/baseline'), signal: controller.signal });
        sample.validationPassed = validation.passed;
        sample.status = validation.passed ? 'completed' : 'failed';
        if (!validation.passed) sample.error = '统一功能检查未通过；保留截图与产物。';
      } catch (error) { sample.status = stopping ? 'interrupted' : 'failed'; sample.error = String(error); }
      finally { clearTimeout(timer); controllers.delete(controller); sample.elapsedMs = Date.now() - start; await save(); console.log(`结束 ${sample.id}：${sample.status} ${(sample.elapsedMs / 1000).toFixed(0)}s`); }
    }));
  }
  await save();
  console.log('六个预注册样本已进入终态。服务保持运行，等待人工匿名评价。');
}
