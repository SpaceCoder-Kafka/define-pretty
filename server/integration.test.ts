import { styleGuideKey } from '../shared/style-guide.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from './store.ts';
import { createApp, createPreviewApp } from './http.ts';
import { Runner } from './runner.ts';
import { DEFAULT_BUSINESS_BRIEF, DEFAULT_DIMENSIONS } from '../shared/defaults.ts';
import { DIMENSION_IDS, type ExperimentDetail, type ReferenceAsset, type Run, type RunConfig, type RunDetails } from '../shared/types.ts';

// Deliberately simple fixture: validates orchestration, never presented as model output.
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>测试任务</title>
<style>body{font-family:sans-serif;padding:32px} [hidden]{display:none!important}.row{padding:12px;border-bottom:1px solid #ddd}dialog{padding:32px}</style>
<main data-testid="dashboard"><h1>项目工作台</h1><label>搜索<input data-testid="search"></label>
<select data-testid="status-filter"><option value="all">全部</option><option value="todo">待开始</option><option value="done">已完成</option></select><div id="tasks"></div></main>
<dialog data-testid="details-dialog"><p id="detail"></p><button data-testid="details-close">关闭</button></dialog>
<script>const tasks=[['a','登录流程优化','todo'],['b','移动端适配','done'],['c','数据看板迭代','todo'],['d','通知中心','done'],['e','组件库整理','todo'],['f','用户访谈','done']];
const list=document.querySelector('#tasks'), search=document.querySelector('[data-testid=search]'), filter=document.querySelector('select'), dialog=document.querySelector('dialog');
tasks.forEach(([id,title,status])=>{const row=document.createElement('div');row.className='row';row.dataset.testid='task-row';row.dataset.taskId=id;row.dataset.title=title;row.dataset.status=status;const label=document.createElement('span');label.textContent=title;const button=document.createElement('button');button.dataset.testid='primary-action';button.textContent='查看详情';button.onclick=()=>{document.querySelector('#detail').textContent=title;dialog.showModal()};row.append(label,button);list.append(row)});
function apply(){list.querySelectorAll('[data-testid=task-row]').forEach(row=>row.hidden=!(row.dataset.title.includes(search.value)&&(filter.value==='all'||row.dataset.status===filter.value)))}
search.oninput=apply;filter.onchange=apply;document.querySelector('[data-testid=details-close]').onclick=()=>dialog.close();</script></html>`;

// External relative assets exercise the same opaque-origin sandbox as actual generated pages.
const fixtureStyle = fixture.match(/<style>([\s\S]*?)<\/style>/)![1];
const fixtureScript = fixture.match(/<script>([\s\S]*?)<\/script>/)![1];
const fixtureHtml = fixture.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./styles.css">')
  .replace(/<script>[\s\S]*?<\/script>/, '<script src="./app.js"></script>');

const listen = (server: Server) => new Promise<number>((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => {
    server.off('error', reject); resolve((server.address() as { port: number }).port);
  });
});
const close = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
const config: RunConfig = { model: 'integration-fixture', reasoningEffort: 'medium', cliVersion: 'test', concurrency: 2, timeoutMs: 1800000 };

test('HTTP → eleven isolated runs → real browser checks → preserved review and reusable version', { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'define-pretty-integration-'));
  const store = new FileStore(path.join(root, '.data')); await store.initialize();
  const controlServer = createServer(); const consolePort = await listen(controlServer);
  const previewServer = createServer(createPreviewApp(store, consolePort)); const previewPort = await listen(previewServer);
  const origin = `http://127.0.0.1:${consolePort}`, previewOrigin = `http://127.0.0.1:${previewPort}`;
  const seen: { group: string; prompt: string; reference?: string }[] = [];
  const runner = new Runner({ store, previewOrigin, executor: async options => {
    seen.push({ group: options.run.groupId, prompt: options.prompt, reference: options.referenceFile });
    await mkdir(path.join(options.cwd, 'website'), { recursive: true });
    await Promise.all([
      writeFile(path.join(options.cwd, 'website', 'index.html'), fixtureHtml + (options.run.groupId === 'baseline' ? '' : '\n<!-- deterministic integration fixture edit -->')),
      writeFile(path.join(options.cwd, 'website', 'styles.css'), fixtureStyle),
      writeFile(path.join(options.cwd, 'website', 'app.js'), fixtureScript),
    ]);
    return { exitCode: 0, summary: 'integration fixture, not model output', usage: { input_tokens: 1, output_tokens: 1 } };
  } });
  const token = 'integration-token';
  controlServer.on('request', createApp({ store, runner, consolePort, previewOrigin, config, token, runtime: { codexAvailable: true, authenticated: true, version: 'test' } }));
  const request = async <T>(url: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(origin + url, { method, headers: { Origin: origin, 'X-Define-Pretty-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result as T;
  };
  try {
    const upload = new FormData();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2xkAAAAASUVORK5CYII=', 'base64');
    upload.append('file', new Blob([bytes], { type: 'image/png' }), 'test-reference.png');
    const imageResponse = await fetch(origin + '/api/references', { method: 'POST', headers: { Origin: origin, 'X-Define-Pretty-Token': token }, body: upload });
    assert.equal(imageResponse.status, 201); const reference = await imageResponse.json() as ReferenceAsset;
    const input = { title: 'Integration only', businessBrief: DEFAULT_BUSINESS_BRIEF, referenceId: reference.id, dimensions: DEFAULT_DIMENSIONS, config };
    const initial = await request<ExperimentDetail>('/api/experiments', 'POST', input);
    const id = initial.experiment.id, versionId = initial.experiment.versions[0].id;
    const [base] = await request<Run[]>(`/api/experiments/${id}/runs`, 'POST', { versionId, groupIds: ['baseline'] });
    await runner.waitForIdle();
    const baseResult = await store.getRun(base.id);
    assert.equal(baseResult.status, 'completed', JSON.stringify(baseResult.validation));
    assert.ok(baseResult.artifactHash); assert.equal(baseResult.validation?.passed, true);
    assert.equal(seen[0].reference, undefined);
    assert.ok(!seen[0].prompt.includes(DEFAULT_DIMENSIONS[0].instructions));
    const edits = await request<Run[]>(`/api/experiments/${id}/runs`, 'POST', { versionId, groupIds: ['direct', ...DIMENSION_IDS] });
    await runner.waitForIdle();
    const all = await store.listRuns(id);
    assert.equal(all.length, 11);
    for (const run of all) {
      assert.equal(run.status, 'completed', `${run.groupId}: ${JSON.stringify(run.validation)}`);
      if (run.groupId === 'baseline') continue;
      assert.equal(run.baselineRunId, base.id); assert.equal(run.baselineHash, baseResult.artifactHash);
      const details = await request<RunDetails>(`/api/runs/${run.id}`);
      assert.equal(details.input?.reference?.sha256, reference.sha256);
      assert.equal(details.input?.rules.length, run.groupId === 'direct' ? 0 : 1);
      assert.ok(details.diff.includes('deterministic integration fixture edit'));
      const sent = seen.find(item => item.group === run.groupId)!;
      assert.ok(sent.reference);
      for (const rule of DEFAULT_DIMENSIONS) {
        assert.equal(sent.prompt.includes(rule.instructions), rule.id === run.groupId, `${run.groupId} leaked ${rule.id}`);
      }
      assert.ok(details.files.includes('screenshot.png'));
    }
    const canvasCombination = await request<ExperimentDetail & { newRunId: string }>(`/api/experiments/${id}/versions/${versionId}/combinations`, 'POST', {
      title: '观察后组合', sourceRunIds: [edits.find(run => run.groupId === 'typography')!.id, edits.find(run => run.groupId === 'color')!.id],
    });
    assert.equal(canvasCombination.experiment.versions.length, 1);
    assert.equal(canvasCombination.runs.length, 12);
    await runner.waitForIdle();
    const canvasRun = await request<RunDetails>(`/api/runs/${canvasCombination.newRunId}`);
    assert.equal(canvasRun.run.status, 'completed');
    assert.equal(canvasRun.run.baselineHash, baseResult.artifactHash);
    assert.deepEqual(canvasRun.input?.rules.map(rule => rule.id), ['typography', 'color']);
    const selected = edits.find(item => item.groupId === 'typography')!;
    await request(`/api/runs/${selected.id}/review`, 'PUT', { adherence: 'partial', scope: 'acceptable', preference: 'same', notes: 'manual integration review' });
    const changed = { ...input, dimensions: input.dimensions.map(rule => rule.id === 'typography' ? { ...rule, instructions: '将标题字号设为 30px。' } : rule) };
    const next = await request<ExperimentDetail>(`/api/experiments/${id}/versions`, 'POST', changed);
    assert.equal(next.experiment.versions[1].baselineRunId, base.id);
    assert.equal(next.experiment.versions[0].dimensions[2].instructions, DEFAULT_DIMENSIONS[2].instructions);
    const persisted = new FileStore(path.join(root, '.data')); await persisted.initialize();
    assert.equal((await persisted.getRun(selected.id)).review?.notes, 'manual integration review');
    assert.equal((await persisted.listRuns(id)).length, 12);
    assert.equal((await readFile(path.join(store.runDir(base.id), 'website', 'index.html'), 'utf8')), fixtureHtml);
    const combinedVersion = await request<ExperimentDetail>(`/api/experiments/${id}/versions`, 'POST', { ...input,
      generationConfig: { ...config, model: 'separate-vision-model', reasoningEffort: 'low' },
      styleGuide: { direction: '重点与留白', synthesis: '整页设计优先保证主次层级。', sourceKey: styleGuideKey('重点与留白', DEFAULT_DIMENSIONS), referenceId: reference.id },
      groups: [{ id: 'custom-combo', title: '字体与色彩组合', dimensionIds: ['typography', 'color'] }],
    });
    const comboVersion = combinedVersion.experiment.versions.at(-1)!;
    assert.equal(comboVersion.baselineRunId, base.id);
    assert.equal(comboVersion.config.model, config.model);
    const [combo, full] = await request<Run[]>(`/api/experiments/${id}/runs`, 'POST', { versionId: comboVersion.id, groupIds: ['custom-combo', 'all-rules'] });
    await runner.waitForIdle();
    const fullDetails = await request<RunDetails>(`/api/runs/${full.id}`);
    assert.equal(fullDetails.run.status, 'completed');
    assert.equal(fullDetails.run.baselineHash, baseResult.artifactHash);
    assert.equal(fullDetails.run.groupTitle, '参考图+文字规范');
    assert.deepEqual(fullDetails.input?.rules, DEFAULT_DIMENSIONS);
    assert.equal(fullDetails.input?.designBrief, undefined);
    assert.equal(fullDetails.input?.reference?.sha256, reference.sha256);
    const comboDetails = await request<RunDetails>(`/api/runs/${combo.id}`);
    assert.equal(comboDetails.run.status, 'completed');
    assert.equal(comboDetails.run.baselineHash, baseResult.artifactHash);
    assert.deepEqual(comboDetails.input?.rules.map(rule => rule.id), ['typography', 'color']);
    assert.equal(comboDetails.run.groupTitle, '字体与色彩组合');
    for (const rule of DEFAULT_DIMENSIONS) assert.equal(comboDetails.input!.prompt.includes(rule.instructions), ['typography', 'color'].includes(rule.id));
    const preview = await fetch(`${previewOrigin}/runs/${selected.id}/index.html`);
    assert.ok(preview.headers.get('content-security-policy')?.includes('sandbox allow-scripts'));
    assert.equal((await fetch(`${previewOrigin}/api/experiments`)).status, 404);
  } finally {
    await runner.shutdown(); await Promise.all([close(controlServer), close(previewServer)]); await rm(root, { recursive: true, force: true });
  }
});
