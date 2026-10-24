import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { acquireDataDirectoryLock } from './data-lock.ts';
import { startServers } from './index.ts';

test('second startup is rejected before restart recovery can mutate running records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-lock-'));
  const previous = process.env.DEFINE_PRETTY_DATA_DIR;
  const lock = await acquireDataDirectoryLock(root);
  try {
    await writeFile(path.join(root, 'store.json'), JSON.stringify({ experiments: [], references: [], runs: [{ id: 'active', status: 'running' }] }));
    process.env.DEFINE_PRETTY_DATA_DIR = root;
    await assert.rejects(startServers(), /数据目录已由.*使用/);
    assert.equal(JSON.parse(await readFile(path.join(root, 'store.json'), 'utf8')).runs[0].status, 'running');
    await lock.release();
    const next = await acquireDataDirectoryLock(root);
    await next.release();
  } finally {
    if (previous === undefined) delete process.env.DEFINE_PRETTY_DATA_DIR;
    else process.env.DEFINE_PRETTY_DATA_DIR = previous;
    await lock.release();
    await rm(root, { recursive: true, force: true });
  }
});

test('dead owner is recovered and concurrent acquisitions produce only one owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'define-pretty-stale-lock-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['-p', 'process.pid']);
    const pid = Number(stdout.trim());
    const directory = path.join(root, '.server-lock');
    await mkdir(directory);
    await writeFile(path.join(directory, 'owner.json'), JSON.stringify({ pid, token: randomUUID(), createdAt: new Date(0).toISOString() }));
    const results = await Promise.allSettled([acquireDataDirectoryLock(root), acquireDataDirectoryLock(root)]);
    const acquired = results.filter((result) => result.status === 'fulfilled');
    assert.equal(acquired.length, 1);
    const owner = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    for (const result of acquired) await result.value.release();
    await assert.rejects(readFile(path.join(directory, 'owner.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
