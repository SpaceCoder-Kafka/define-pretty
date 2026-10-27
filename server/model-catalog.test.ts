import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readModelCatalog } from './model-catalog.ts';
import { getRuntimeDefaults } from './runtime.ts';
import { modelInput } from './input.ts';
import { resolveModelConfig } from '../shared/model-options.ts';
import type { ModelOption } from '../shared/types.ts';

const option = (model: string, efforts: string[], defaultReasoningEffort = 'medium'): ModelOption => ({
  model, displayName: `Local ${model}`, isDefault: model === 'local-model', defaultReasoningEffort,
  supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: `Use ${reasoningEffort}` })),
});
const catalog = [option('local-model', ['low', 'medium', 'high', 'ultra']), option('fast-model', ['low', 'medium'], 'low')];

async function fakeCli(script: string, callback: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-models-'));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const cli = path.join(bin, 'codex');
  await writeFile(cli, `#!/usr/bin/env node
if(process.argv.includes('--version')) { console.log('fixture-codex'); process.exit(0); }
if(process.argv.includes('login')) { console.error('Logged in'); process.exit(0); }
${script}
`);
  await chmod(cli, 0o755);
  const previousPath = process.env.PATH, previousHome = process.env.CODEX_HOME;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  process.env.CODEX_HOME = directory;
  try { await callback(directory); }
  finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  }
}

const serverScript = `
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['app-server', '--listen', 'stdio://']);
const catalog = ${JSON.stringify(catalog)};
let initialized = false;
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const reply = result => process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');
  if(request.method === 'initialize') { assert.equal(request.params.clientInfo.name, 'define_pretty'); reply({}); }
  else if(request.method === 'initialized') initialized = true;
  else if(request.method === 'model/list') {
    assert(initialized);
    assert.equal(request.params.includeHidden, false);
    process.stdout.write('diagnostic\\nnull\\n');
    process.stdout.write(JSON.stringify({method:'notification'})+'\\n');
    if(!request.params.cursor) reply({data:[catalog[0], {...catalog[1],model:'hidden',hidden:true}, {model:'invalid'}],nextCursor:'page-2'});
    else { assert.equal(request.params.cursor,'page-2'); reply({data:[catalog[1]],nextCursor:null}); }
  } else assert.fail('Unexpected RPC: '+request.method);
});`;

test('local catalog follows initialization and pagination, preserving model-specific efforts', async () => {
  await fakeCli(serverScript, async () => assert.deepEqual(await readModelCatalog(), catalog));
});

test('runtime keeps local provider and model, but generation defaults to high', async () => {
  await fakeCli(serverScript, async directory => {
    await writeFile(path.join(directory, 'config.toml'), 'model = "configured-custom"\nmodel_provider = "private-provider"\nmodel_reasoning_effort = "low"\n');
    const startup = await getRuntimeDefaults();
    assert.deepEqual(startup.config, { model: 'configured-custom', provider: 'private-provider', reasoningEffort: 'high', cliVersion: 'fixture-codex' });
    assert.equal(startup.runtime.authenticated, true);
    assert.deepEqual(startup.models, catalog);
    assert.equal(startup.modelCatalogError, undefined);
  });
});

test('unconfigured runtime uses the local catalog default model', async () => {
  await fakeCli(serverScript, async () => {
    const startup = await getRuntimeDefaults();
    assert.equal(startup.config.model, 'local-model');
    assert.equal(startup.config.reasoningEffort, 'high');
  });
});

test('query failure preserves usable runtime and local config without exposing CLI errors', async () => {
  await fakeCli(`process.stdin.once('data',()=>console.log(JSON.stringify({id:1,error:{message:'secret-provider-token'}})));`, async directory => {
    await writeFile(path.join(directory, 'config.toml'), 'model = "configured-custom"\n');
    const startup = await getRuntimeDefaults();
    assert.equal(startup.runtime.authenticated, true);
    assert.equal(startup.runtime.error, undefined);
    assert.equal(startup.config.model, 'configured-custom');
    assert.deepEqual(startup.models, []);
    assert.match(startup.modelCatalogError!, /无法读取模型列表/);
    assert(!startup.modelCatalogError!.includes('secret-provider-token'));
  });
});

test('model query times out and rejects early CLI exit', async () => {
  await fakeCli('process.stdin.resume();', async () => assert.rejects(readModelCatalog(200), /超时/));
  await fakeCli('process.exit(1);', async () => assert.rejects(readModelCatalog(), /退出|连接已关闭/));
});

test('switching models preserves a supported effort and replaces an unsupported one', () => {
  const config = { model: 'local-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'fixture' };
  assert.deepEqual(resolveModelConfig(config, catalog), config);
  assert.deepEqual(resolveModelConfig({ ...config, model: 'fast-model' }, catalog), { ...config, model: 'fast-model', reasoningEffort: 'low' });
  assert.deepEqual(resolveModelConfig({ ...config, reasoningEffort: 'ultra' }, catalog), { ...config, reasoningEffort: 'ultra' });
  const unlisted = { ...config, model: 'configured-custom' };
  assert.deepEqual(resolveModelConfig(unlisted, catalog), unlisted);
});

test('model input checks the local catalog efforts and protects server runtime identity', () => {
  const defaults = { model: 'local-model', reasoningEffort: 'high', provider: 'custom', cliVersion: 'fixture' };
  assert.throws(() => modelInput({ model: 'fast-model', reasoningEffort: 'high' }, defaults, catalog), /推理强度无效/);
  const dynamic = [option('dynamic-model', ['adaptive'], 'adaptive')];
  assert.deepEqual(modelInput({ model: 'dynamic-model', reasoningEffort: 'adaptive', provider: 'forged' }, defaults, dynamic), { ...defaults, model: 'dynamic-model', reasoningEffort: 'adaptive' });
  assert.deepEqual(modelInput({}, defaults, catalog), defaults);
  assert.deepEqual(modelInput({ model: 'configured-custom' }, defaults, catalog), { ...defaults, model: 'configured-custom' });
});
