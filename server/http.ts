import { DimensionHighlights } from './dimension-highlights.ts';
import { VisualComparisons } from './visual-comparison.ts';
import { fail, text, modelInput, dimensionsInput, groupsInput, styleGuideInput } from './input.ts';
import { SpecGenerator, DEFAULT_GENERATION_PROMPT } from './specs.ts';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Bootstrap, type ExperimentInput, type GroupId, type Review, type RunDetails, type RunInput } from '../shared/types.ts';
import { DEFAULT_BUSINESS_BRIEF, DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import type { RunnerController } from './contracts.ts';
import { FileStore } from './store.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureTests } from './feature-tests.ts';
import { FeatureCompletions } from './feature-completions.ts';
import { createSessionToken, detectImageType, localRequestGuard, previewHeaders, requireSafeId, safeFilePath } from './security.ts';

function experimentInput(value: unknown, config: Bootstrap['defaults']['config']): ExperimentInput {
  if (!value || typeof value !== 'object') fail('请填写实验设置。');
  const input = value as Record<string, unknown>;
  const dimensions = dimensionsInput(input.dimensions);
  const groups = groupsInput(input.groups, dimensions);
  const supplied = input.config && typeof input.config === 'object' ? input.config as Record<string, unknown> : {};
  const model = modelInput(supplied, config);
  const concurrency = supplied.concurrency === undefined ? config.concurrency : supplied.concurrency;
  if (typeof concurrency !== 'number' || !Number.isSafeInteger(concurrency) || concurrency < 1) fail('并行数量必须是大于或等于 1 的整数。');
  return {
    title: text(input.title, '实验名称', 120).trim(),
    businessBrief: text(input.businessBrief, '业务需求', 30000),
    referenceId: input.referenceId ? requireSafeId(input.referenceId) : undefined,
    dimensions, styleGuide: styleGuideInput(input.styleGuide, dimensions, input.referenceId), groups, generationConfig: modelInput(input.generationConfig, config),
    generationPrompt: text(input.generationPrompt ?? DEFAULT_GENERATION_PROMPT, '规范生成提示词', 20000),
    config: { ...model, concurrency: concurrency as number, timeoutMs: 1_800_000 },
  };
}

function reviewInput(value: unknown): Review {
  if (!value || typeof value !== 'object') fail('评价格式不正确。');
  const review = value as Review;
  if (!['', 'followed', 'partial', 'missed'].includes(review.adherence) || !['', 'none', 'acceptable', 'outside'].includes(review.scope) || !['', 'better', 'same', 'worse'].includes(review.preference)) fail('评价选项不正确。');
  return { adherence: review.adherence, scope: review.scope, preference: review.preference, notes: text(review.notes, '备注', 10000, true) };
}

async function readText(file: string, limit = 256 * 1024): Promise<string> {
  try {
    const value = await readFile(file, 'utf8');
    return value.length > limit ? `[仅显示最后 ${limit} 个字符；完整记录可下载]\n${value.slice(-limit)}` : value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function listFiles(root: string, prefix = '', limit = { count: 0 }): Promise<string[]> {
  const result: string[] = [];
  try {
    for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      if (limit.count >= 1000) break;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await listFiles(root, relative, limit));
      else if (entry.isFile()) { result.push(relative); limit.count += 1; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return result;
}

export interface AppOptions {
  featureBoards?: FeatureBoards; featureTests?: FeatureTests; featureCompletions?: FeatureCompletions;
  highlights?: DimensionHighlights; comparisons?: VisualComparisons; store: FileStore; runner: RunnerController; generator?: SpecGenerator; consolePort: number; previewOrigin: string;
  config: Bootstrap['defaults']['config']; runtime: Bootstrap['runtime']; token?: string;
}

export function createApp(options: AppOptions): Express {
  const { store, runner, generator, consolePort, previewOrigin, config, runtime } = options;
  const token = options.token ?? createSessionToken();
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', localRequestGuard(consolePort, token));
  app.use('/api', express.json({ limit: '512kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });

  const tests = () => { if (!options.featureTests) fail('验证区域尚未启用。',503); return options.featureTests!; };
  const testUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 3, fieldSize: 4000 } });
  app.get('/api/feature-tests/source', async (_req,res) => res.json(await tests().getSource()));
  app.get('/api/feature-tests', async (req,res) => res.json(await tests().list(req.query.boardId ? requireSafeId(req.query.boardId) : undefined)));
  app.post('/api/feature-tests', testUpload.single('image'), async (req,res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。',503);
    if (!req.file) fail('缺少所选卡片的导出图片。');
    let supplied; try { supplied=JSON.parse(req.body?.config || '{}'); } catch { fail('测试模型配置无效。'); }
    const revision=Number(req.body?.revision); if(!Number.isSafeInteger(revision) || revision<1) fail('卡片版本无效。');
    res.status(202).json(await tests().start(requireSafeId(req.body?.boardId),revision,req.file!.buffer,modelInput(supplied,config)));
  });
  app.get('/api/feature-tests/:id', async (req,res) => res.json(await tests().get(requireSafeId(req.params.id))));
  app.post('/api/feature-tests/:id/cancel', async (req,res) => res.json(await tests().cancel(requireSafeId(req.params.id))));
  app.get('/api/feature-tests/:id/image', async (req,res) => { const id=requireSafeId(req.params.id); await tests().get(id); res.type('png').sendFile(path.join(tests().directory(id),'reference.png'),{dotfiles:'allow'}); });

  const boards = () => { if (!options.featureBoards) fail('视觉特征工作台尚未启用。', 503); return options.featureBoards!; };
  const completions = () => { if(!options.featureCompletions)fail('卡片补全尚未启用。',503);return options.featureCompletions!; };
  app.post('/api/feature-boards/:id/complete-card', async (req,res) => {
    if(!runtime.codexAvailable||!runtime.authenticated)fail('Codex 不可用或尚未登录。',503);
    res.status(202).json(await completions().start(requireSafeId(req.params.id),req.body ?? {},modelInput(req.body?.config,config)));
  });
  app.get('/api/feature-completions/:id',async (req,res)=>res.json(await completions().get(requireSafeId(req.params.id))));
  app.post('/api/feature-completions/:id/cancel',async (req,res)=>res.json(await completions().cancel(requireSafeId(req.params.id))));
  app.get('/api/feature-boards', async (_req, res) => { res.json(await boards().list()); });
  app.post('/api/feature-boards', async (req, res) => { res.status(201).json(await boards().create(requireSafeId(req.body?.referenceId), modelInput(req.body?.config, config), text(req.body?.title, '特征板名称', 100))); });
  app.get('/api/feature-boards/:id', async (req, res) => { res.json(await boards().get(requireSafeId(req.params.id))); });
  app.put('/api/feature-boards/:id', async (req, res) => { res.json(await boards().edit(requireSafeId(req.params.id), req.body ?? {})); });
  app.post('/api/feature-boards/:id/generate', async (req, res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。', 503);
    res.status(202).json(await boards().generate(requireSafeId(req.params.id)));
  });
  app.post('/api/feature-boards/:id/cancel', async (req, res) => { res.json(await boards().cancel(requireSafeId(req.params.id))); });
  app.get('/api/feature-boards/:id/evidence', async (req, res) => {
    const id = requireSafeId(req.params.id); const board = await boards().get(id);
    res.json({ config: board.config, status: board.status, usage: board.usage, error: board.error, input: await readText(path.join(boards().directory(id), 'input.json')), output: await readText(path.join(boards().directory(id), 'final.txt')) });
  });

  const comparisons = options.comparisons ?? new VisualComparisons(store, consolePort);
  const highlights = options.highlights ?? new DimensionHighlights(store, comparisons);
  app.get('/api/runs/:id/dimension-highlights', async (req, res) => res.json(await highlights.get(requireSafeId(req.params.id))));
  app.post('/api/runs/:id/dimension-highlights', async (req, res) => res.json(await highlights.start(requireSafeId(req.params.id))));
  app.get('/api/runs/:id/visual-comparison', async (req, res) => {
    res.json(await comparisons.get(requireSafeId(req.params.id)));
  });
  app.get('/api/runs/:id/visual-comparison/:key/:image', async (req, res) => {
    const id = requireSafeId(req.params.id);
    await store.getRun(id);
    if (!/^v[12]-[a-f0-9]{64}-[a-f0-9]{64}$/.test(String(req.params.key)) || !['baseline.png', 'result.png'].includes(String(req.params.image))) fail('对比画面不存在。');
    const file = await safeFilePath(comparisons.directory(id), `${req.params.key}/${req.params.image}`);
    res.type('png').sendFile(file, { dotfiles: 'allow' });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (_req, res) => {
    const body: Bootstrap = { token, previewOrigin, runtime, defaults: { businessBrief: DEFAULT_BUSINESS_BRIEF, dimensions: [], groups: [], generationConfig: config, generationPrompt: DEFAULT_GENERATION_PROMPT, config }, capabilities: { configurableConcurrency: true, dynamicDimensions: true, visualChangeHighlights: true, dimensionHighlights: true } };
    res.json(body);
  });
  app.get('/api/experiments', async (_req, res) => { res.json(await store.listExperiments()); });
  app.get('/api/experiments/:id', async (req, res) => {
    const id = requireSafeId(req.params.id);
    res.json({ experiment: await store.getExperiment(id), runs: await store.listRuns(id) });
  });
  app.post('/api/experiments', async (req, res) => {
    const experiment = await store.createExperiment(experimentInput(req.body, config));
    res.status(201).json({ experiment, runs: [] });
  });
  app.post('/api/experiments/:id/versions', async (req, res) => {
    const id = requireSafeId(req.params.id);
    const experiment = await store.saveVersion(id, experimentInput(req.body, config));
    res.status(201).json({ experiment, runs: await store.listRuns(id) });
  });
  app.post('/api/references', upload.single('file'), async (req, res) => {
    if (!req.file) fail('请选择 PNG、JPEG 或 WebP 参考截图。');
    const file = req.file!;
    const format = detectImageType(file.buffer);
    if (!format) fail('文件内容不是支持的 PNG、JPEG 或 WebP 图片。');
    res.status(201).json(await store.addReference(file.originalname, format.mimeType, file.buffer));
  });
  app.get('/api/references/:id', async (req, res) => {
    const id = requireSafeId(req.params.id);
    const reference = await store.getReference(id);
    res.type(reference.mimeType).sendFile(store.referencePath(id), { dotfiles: 'allow' });
  });
  app.get('/api/dimension-templates', (_req, res) => { res.json(DEFAULT_DIMENSIONS); });
  app.get('/api/generations', async (_req, res) => { res.json(await store.listGenerations()); });
  app.post('/api/generations', async (req, res) => {
    if (!generator || !runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。', 503);
    res.status(202).json(await generator!.start(requireSafeId(req.body?.referenceId), modelInput(req.body?.config, config), text(req.body?.prompt ?? DEFAULT_GENERATION_PROMPT, '规范生成提示词', 20000)));
  });
  app.post('/api/integrations', (_req, _res) => { fail('整页视觉重点已改为独立维度，请使用新版规范生成。', 410); });
  app.post('/api/generations/:id/cancel', async (req, res) => {
    const id = requireSafeId(req.params.id); await store.getGeneration(id); await generator?.cancel(id); res.json(await store.getGeneration(id));
  });
  app.get('/api/generations/:id/evidence', async (req, res) => {
    const id = requireSafeId(req.params.id); const generation = await store.getGeneration(id);
    const dir = store.generationDir(id);
    res.json({ generation, log: await readText(path.join(dir, 'events.jsonl')), stderr: await readText(path.join(dir, 'stderr.log')), output: await readText(path.join(dir, 'final.txt')) });
  });
  app.post('/api/experiments/:id/versions/:versionId/combinations', async (req, res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。', 503);
    const id = requireSafeId(req.params.id), versionId = requireSafeId(req.params.versionId);
    const sourceRunIds = req.body?.sourceRunIds;
    if (!Array.isArray(sourceRunIds) || sourceRunIds.length > 100) fail('请选择单维度结果。');
    const run = await store.createCombinationRun(id, versionId, text(req.body?.title, '组合组名称', 120), sourceRunIds.map(requireSafeId));
    try { await runner.enqueue(run.id); }
    catch (error) { await store.updateRun(run.id, { status: 'failed', finishedAt: new Date().toISOString(), error: (error as Error).message }); }
    res.status(202).json({ experiment: await store.getExperiment(id), runs: await store.listRuns(id), newRunId: run.id });
  });
  app.post('/api/experiments/:id/runs', async (req, res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail(runtime.error || 'Codex 不可用或尚未登录，请在终端完成配置后重启服务。', 503);
    const id = requireSafeId(req.params.id);
    const versionId = requireSafeId(req.body?.versionId);
    const groups = req.body?.groupIds;
    if (!Array.isArray(groups) || groups.length > 203 || groups.some((group: unknown) => typeof group !== 'string')) fail('实验组列表不正确。');
    const runs = await store.createRuns(id, versionId, groups as GroupId[]);
    for (const run of runs) {
      try { await runner.enqueue(run.id); }
      catch (error) { await store.updateRun(run.id, { status: 'failed', finishedAt: new Date().toISOString(), error: (error as Error).message }); }
    }
    res.status(202).json(await Promise.all(runs.map((run) => store.getRun(run.id))));
  });
  app.post('/api/runs/:id/cancel', async (req, res) => {
    const id = requireSafeId(req.params.id);
    await store.getRun(id);
    await runner.cancel(id);
    res.json(await store.getRun(id));
  });
  app.put('/api/runs/:id/review', async (req, res) => {
    res.json(await store.saveReview(requireSafeId(req.params.id), reviewInput(req.body)));
  });
  app.get('/api/runs/:id', async (req, res) => {
    const id = requireSafeId(req.params.id);
    const run = await store.getRun(id);
    const dir = store.runDir(id);
    const [inputString, diff, log, stderr, lastMessage, files] = await Promise.all([
      readText(path.join(dir, 'input.json'), 512 * 1024), readText(path.join(dir, 'diff.txt')), readText(path.join(dir, 'events.jsonl')), readText(path.join(dir, 'stderr.log')), readText(path.join(dir, 'final.txt')), listFiles(dir),
    ]);
    let input: RunInput | undefined;
    if (inputString) { try { input = JSON.parse(inputString) as RunInput; } catch { /* While a run is starting, the file may not be complete yet. */ } }
    const detail: RunDetails = { run, input, diff, log, stderr, lastMessage, files };
    res.json(detail);
  });
  app.get('/api/runs/:id/artifacts/{*file}', async (req, res) => {
    const id = requireSafeId(req.params.id);
    await store.getRun(id);
    const value = req.params.file;
    const relative = Array.isArray(value) ? value.join('/') : value;
    if (!relative) fail('文件不存在。', 404);
    const file = await safeFilePath(store.runDir(id), relative as string);
    // Artifacts are downloads; generated HTML must never execute on the API origin.
    res.attachment(path.basename(file)).sendFile(file, { dotfiles: 'allow' });
  });
  app.get('/api/events', (req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    const send = () => { if (!res.destroyed) res.write('event: update\ndata: {}\n\n'); };
    store.on('update', send);
    const timer = setInterval(send, 15_000);
    timer.unref();
    send();
    req.on('close', () => { clearInterval(timer); store.off('update', send); });
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: '接口不存在。' }); });
  app.use('/api', errorHandler);
  return app;
}

export function createPreviewApp(store: FileStore, consolePort: number, featureTests?: FeatureTests): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(previewHeaders(consolePort));
  app.get(/^\/feature-tests\/(sources|runs)\/([a-zA-Z0-9_-]+)\/(.*)$/, async (req,res) => {
    if(!featureTests) fail('验证区域尚未启用。',404);
    const id=requireSafeId(req.params[1]); let directory: string;
    if(req.params[0]==='sources') { const source=await featureTests!.getSource(); if(id!==source.runId) fail('原始网页不存在。',404); directory=featureTests!.sourceDirectory(id); }
    else { const run=await featureTests!.get(id); if(!run.hasPreview || ['queued','running'].includes(run.status)) fail('测试网页尚未就绪。',404); directory=featureTests!.websiteDirectory(id); }
    res.sendFile(await safeFilePath(directory,req.params[2] || 'index.html'),{dotfiles:'allow'});
  });
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  app.get(/^\/runs\/([a-zA-Z0-9_-]+)\/(.*)$/, async (req, res) => {
    const runId = requireSafeId(req.params[0]);
    await store.getRun(runId);
    const relative = req.params[1] || 'index.html';
    const file = await safeFilePath(store.websiteDir(runId), relative);
    res.sendFile(file, { dotfiles: 'allow' });
  });
  app.use((_req, res) => { res.status(404).type('text').send('预览文件不存在。'); });
  app.use(errorHandler);
  return app;
}

export function errorHandler(error: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code === 'ENOENT' ? 404 : error.status && error.status >= 400 && error.status < 600 ? error.status : error instanceof multer.MulterError ? 400 : 500;
  const message = error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 10 MiB。' : status === 404 ? '记录或文件不存在。' : status === 500 ? '本地服务发生错误，请检查终端日志。' : error.message;
  if (status === 500) console.error(error);
  res.status(status).json({ error: message });
}
