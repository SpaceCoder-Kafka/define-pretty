import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { executeCodex, type ExecutionOptions } from './codex.ts';
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

