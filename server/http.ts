import { fail, text, modelInput } from './input.ts';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Bootstrap } from '../shared/types.ts';
import { FileStore } from './store.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureTests } from './feature-tests.ts';
import { FeatureCompletions } from './feature-completions.ts';
import { createSessionToken, detectImageType, localRequestGuard, previewHeaders, requireSafeId, safeFilePath } from './security.ts';
async function readText(file: string, limit = 256 * 1024): Promise<string> {
  try {
    const value = await readFile(file, 'utf8');
    return value.length > limit ? `[仅显示最后 ${limit} 个字符；完整记录可下载]\n${value.slice(-limit)}` : value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export interface AppOptions {
  featureBoards?: FeatureBoards; featureTests?: FeatureTests; featureCompletions?: FeatureCompletions;
  store: FileStore; consolePort: number; previewOrigin: string;
  config: Bootstrap['defaults']['config']; runtime: Bootstrap['runtime']; token?: string;
  models?: Bootstrap['models']; modelCatalogError?: string;
}

export function createApp(options: AppOptions): Express {
  const { store, consolePort, previewOrigin, config, runtime } = options;
  const token = options.token ?? createSessionToken();
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', localRequestGuard(consolePort, token));
  app.use('/api', express.json({ limit: '512kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });

  const tests = () => { if (!options.featureTests) fail('验证区域尚未启用。',503); return options.featureTests!; };
  const testUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4, fieldSize: 4000 } });
  app.get('/api/feature-tests/source', async (_req,res) => res.json(await tests().getSource()));
  app.get('/api/feature-tests/sources', async (_req,res) => res.json(await tests().listSources()));
  app.get('/api/feature-source-runs', async (_req,res) => res.json(await tests().listSourceRuns()));
  app.post('/api/feature-source-runs', async (req,res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。',503);
    res.status(202).json(await tests().generateSource(text(req.body?.requirements,'网页需求',12000),modelInput(req.body?.config,config,options.models)));
  });
  app.post('/api/feature-source-runs/:id/cancel', async (req,res) => res.json(await tests().cancelSource(requireSafeId(req.params.id))));
  app.get('/api/feature-tests', async (req,res) => res.json(await tests().list(req.query.boardId ? requireSafeId(req.query.boardId) : undefined)));
  app.post('/api/feature-tests', testUpload.single('image'), async (req,res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。',503);
    if (!req.file) fail('缺少所选卡片的导出图片。');
    let supplied; try { supplied=JSON.parse(req.body?.config || '{}'); } catch { fail('测试模型配置无效。'); }
    const revision=Number(req.body?.revision); if(!Number.isSafeInteger(revision) || revision<1) fail('卡片版本无效。');
    res.status(202).json(await tests().start(requireSafeId(req.body?.boardId),revision,req.file!.buffer,modelInput(supplied,config,options.models),req.body?.sourceId ? requireSafeId(req.body.sourceId) : undefined));
  });
  app.get('/api/feature-tests/:id', async (req,res) => res.json(await tests().get(requireSafeId(req.params.id))));
  app.post('/api/feature-tests/:id/refine', async (req,res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。',503);
    const id=requireSafeId(req.params.id), parent=await tests().get(id);
    const defaults={...parent.config,cliVersion:config.cliVersion};
    res.status(202).json(await tests().refine(id,text(req.body?.feedback,'继续优化要求',4000),modelInput(req.body?.config,defaults,options.models)));
  });
  app.post('/api/feature-tests/:id/cancel', async (req,res) => res.json(await tests().cancel(requireSafeId(req.params.id))));
  app.get('/api/feature-tests/:id/image', async (req,res) => { const id=requireSafeId(req.params.id); await tests().get(id); res.type('png').sendFile(path.join(tests().directory(id),'reference.png'),{dotfiles:'allow'}); });
  app.get('/api/feature-tests/:id/original-reference', async (req,res) => {
    const reference = await tests().originalReferenceFile(requireSafeId(req.params.id));
    res.type(reference.mimeType).sendFile(reference.file,{dotfiles:'allow'});
  });

  const boards = () => { if (!options.featureBoards) fail('视觉特征工作台尚未启用。', 503); return options.featureBoards!; };
  const completions = () => { if(!options.featureCompletions)fail('卡片补全尚未启用。',503);return options.featureCompletions!; };
  app.post('/api/feature-boards/:id/complete-card', async (req,res) => {
    if(!runtime.codexAvailable||!runtime.authenticated)fail('Codex 不可用或尚未登录。',503);
    res.status(202).json(await completions().start(requireSafeId(req.params.id),req.body ?? {},modelInput(req.body?.config,config,options.models)));
  });
  app.get('/api/feature-completions/:id',async (req,res)=>res.json(await completions().get(requireSafeId(req.params.id))));
  app.post('/api/feature-completions/:id/cancel',async (req,res)=>res.json(await completions().cancel(requireSafeId(req.params.id))));
  app.get('/api/feature-boards', async (_req, res) => { res.json(await boards().list()); });
  app.post('/api/feature-boards', async (req, res) => { res.status(201).json(await boards().create(requireSafeId(req.body?.referenceId), modelInput(req.body?.config, config, options.models), text(req.body?.title, '特征板名称', 100))); });
  app.get('/api/feature-boards/:id', async (req, res) => { res.json(await boards().get(requireSafeId(req.params.id))); });
  app.put('/api/feature-boards/:id', async (req, res) => { res.json(await boards().edit(requireSafeId(req.params.id), req.body ?? {})); });
  app.post('/api/feature-boards/:id/generate', async (req, res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。', 503);
    res.status(202).json(await boards().generate(requireSafeId(req.params.id)));
  });
  app.post('/api/feature-boards/:id/discover-details', async (req,res) => {
    if (!runtime.codexAvailable || !runtime.authenticated) fail('Codex 不可用或尚未登录。',503);
    const revision=req.body?.revision;if(!Number.isSafeInteger(revision)||revision<1)fail('卡片版本无效。');
    res.status(202).json(await boards().generate(requireSafeId(req.params.id),{revision,config:modelInput(req.body?.config,config,options.models)}));
  });
  app.post('/api/feature-boards/:id/cancel', async (req, res) => { res.json(await boards().cancel(requireSafeId(req.params.id))); });
  app.get('/api/feature-boards/:id/evidence', async (req, res) => {
    const id = requireSafeId(req.params.id); const board = await boards().get(id);
    res.json({ config: board.config, status: board.status, usage: board.usage, error: board.error, input: await readText(path.join(boards().directory(id), 'input.json')), output: await readText(path.join(boards().directory(id), 'final.txt')) });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (_req, res) => {
    const body: Bootstrap = { token, previewOrigin, runtime, defaults: { config }, models: options.models ?? [], modelCatalogError: options.modelCatalogError };
    res.json(body);
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
  app.use('/api', (_req, res) => { res.status(404).json({ error: '接口不存在。' }); });
  app.use('/api', errorHandler);
  return app;
}

export function createPreviewApp(consolePort: number, featureTests?: FeatureTests): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(previewHeaders(consolePort));
  app.get(/^\/feature-tests\/(sources|runs|source-runs)\/([a-zA-Z0-9_-]+)\/(.*)$/, async (req,res) => {
    if(!featureTests) fail('验证区域尚未启用。',404);
    const id=requireSafeId(req.params[1]); let directory: string;
    if(req.params[0]==='sources') { await featureTests!.getSourceById(id); directory=featureTests!.sourceDirectory(id); }
    else if(req.params[0]==='source-runs') { const run=await featureTests!.getSourceRun(id); if(!['checking','completed'].includes(run.status) && !run.draftPreview) fail('原网页尚未就绪。',404); directory=featureTests!.sourceRunWebsite(id); }
    else { const run=await featureTests!.get(id); if(!run.hasPreview && !run.draftPreview) fail('测试网页尚未就绪。',404); directory=featureTests!.websiteDirectory(id); }
    const file = await safeFilePath(directory,req.params[2] || 'index.html');
    // Sandboxed previews have an opaque origin; ES modules still require CORS.
    res.setHeader('Access-Control-Allow-Origin','*');
    res.sendFile(file,{dotfiles:'allow'});
  });
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
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
