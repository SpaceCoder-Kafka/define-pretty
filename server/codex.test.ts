import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { executeCodex, type ExecutionOptions } from './codex.ts';
import { readExecutionProgress } from './execution-progress.ts';
async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(10); }
  throw new Error('Timed out waiting for test condition');
}

async function fakeCli(script: string, callback: (cwd: string, options: ExecutionOptions) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-process-'));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const cli = path.join(bin, 'codex');
  await writeFile(cli, `#!/usr/bin/env node\nif(process.argv.includes('--version')) { console.log('fixture-codex'); process.exit(0); }\n${script}\n`);
  await chmod(cli, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  const controller = new AbortController();
  try {
    await callback(directory, {
      run: { id: 'fixture' },
      cwd: directory, prompt: 'fixture prompt', config: { model: 'fixture', reasoningEffort: 'high', cliVersion: 'fixture-codex' }, signal: controller.signal,
    });
  } finally {
    controller.abort();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('CLI completion resolves transient errors and preserves split UTF-8 output', async () => {
  await fakeCli(`
process.stdout.write(JSON.stringify({type:'error',message:'temporary connection error'})+'\\n');
const text = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'中文完成'}})+'\\n');
const split = text.indexOf(Buffer.from('中')) + 1;
process.stdout.write(text.subarray(0, split));
setTimeout(() => {
  process.stdout.write(text.subarray(split));
  process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:42}})+'\\n');
}, 10);
`, async (_directory, options) => {
    const result = await executeCodex(options);
    assert.equal(result.exitCode, 0);
    assert.equal(result.error, undefined);
    assert.equal(result.summary, '中文完成');
    assert.equal(result.usage?.input_tokens, 42);
    const progress = await readExecutionProgress(options.cwd);
    assert.equal(progress?.activeActions.length, 0);
    assert.equal(progress?.message, '生成执行已结束，准备检查网页');
  });
});

test('website subagents are an explicit per-task opt-in with three concurrent workers', async () => {
  await fakeCli(`process.stdin.resume();`, async (directory, options) => {
    await executeCodex({ ...options, parallelAgents: true });
    let { args } = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8')) as { args: string[] };
    assert(args.includes('multi_agent'));
    assert(args.includes('agents.enabled=true'));
    assert(args.includes('agents.max_concurrent_threads_per_session=3'));
    assert(!args.some(arg => arg.includes('max_depth')));
    await executeCodex({ ...options, readOnly: true });
    ({ args } = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8')));
    assert(!args.includes('multi_agent'));
    assert(!args.some(arg => arg.startsWith('agents.')));
  });
});

test('CLI publishes bounded live progress before process completion and tolerates malformed lines', async () => {
  await fakeCli(`
process.stdout.write('non-json diagnostic\\n');
process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'private',type:'reasoning',text:'private reasoning'}})+'\\n');
const event=JSON.stringify({type:'item.started',item:{id:'cmd',type:'command_execution',command:'apply_patch PRIVATE_TOKEN=secret'}})+'\\n';
process.stdout.write(event.slice(0,20));
setTimeout(()=>process.stdout.write(event.slice(20)),10);
setTimeout(()=>{process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'cmd',type:'command_execution',exit_code:1,aggregated_output:'private'}})+'\\n');},400);
`, async (directory, options) => {
    const running = executeCodex(options);
    await waitUntil(async () => (await readExecutionProgress(directory))?.activeActions.length === 1);
    const live = await readExecutionProgress(directory);
    assert.equal(live?.activeActions[0].label, '写入网页文件');
    assert(!JSON.stringify(live).includes('PRIVATE_TOKEN'));
    assert(!JSON.stringify(live).includes('private reasoning'));
    await running;
    const final = await readExecutionProgress(directory);
    assert.equal(final?.failedActions, 1);
    assert.equal(final?.activeActions.length, 0);
  });
});

test('website execution enables network access and preserves provider and ordered visual inputs', async () => {
  await fakeCli(`process.stdin.resume();`, async (directory, options) => {
    const references = [path.join(directory, 'selected-features.png'), path.join(directory, 'original-reference.webp')];
    await executeCodex({ ...options, config: { ...options.config, provider: 'configured-provider' }, referenceFiles: references });
    const { args } = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8')) as { args: string[] };
    assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
    assert(args.includes('sandbox_workspace_write.network_access=true'));
    assert(args.includes('approval_policy="never"'));
    assert(args.includes('model_provider="configured-provider"'));
    assert.deepEqual(args.flatMap((argument, index) => argument === '--image' ? [args[index + 1]] : []), references);
    assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  });
});

test('analysis keeps read-only permissions and does not enable shell network access', async () => {
  await fakeCli(`process.stdin.resume();`, async (directory, options) => {
    await executeCodex({ ...options, readOnly: true, referenceFile: '/input/reference.png', outputSchema: '/input/schema.json' });
    const { args } = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8')) as { args: string[] };
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    assert(!args.some(argument => argument.startsWith('sandbox_workspace_write.network_access=')));
    assert.equal(args[args.indexOf('--image') + 1], '/input/reference.png');
    assert.equal(args[args.indexOf('--output-schema') + 1], '/input/schema.json');
  });
});

test('cancellation kills a TERM-resistant descendant after the CLI parent exits', { skip: process.platform === 'win32' }, async () => {
  await fakeCli(`
const {spawn} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const child = spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync('descendant.pid',String(child.pid));
setInterval(()=>{},1000);
`, async (directory, options) => {
    const controller = new AbortController();
    let pid: number | undefined;
    try {
      const running = executeCodex({ ...options, signal: controller.signal });
      await waitUntil(async () => {
        try { pid = Number(await readFile(path.join(directory, 'descendant.pid'), 'utf8')); return Boolean(pid); }
        catch { return false; }
      });
      await pause(100); // Let the descendant install its TERM handler.
      controller.abort();
      await running;
      await waitUntil(() => {
        try { process.kill(pid!, 0); return false; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      });
    } finally {
      controller.abort();
      if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ }
    }
  });
});

