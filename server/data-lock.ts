import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface Owner { pid: number; token: string; createdAt: string }
export interface DataDirectoryLock { release(): Promise<void> }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

async function readOwner(directory: string): Promise<Owner> {
  // mkdir wins atomically; allow that owner a short interval to write its metadata.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const value = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')) as Owner;
      if (!Number.isInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string' || !value.token) throw new Error('Invalid lock owner');
      return value;
    } catch (error) {
      if (attempt === 7) {
        try { await lstat(directory); }
        catch (missing) { throw missing; }
        throw new Error(`数据目录锁的所有者信息不完整。请确认没有其他实例运行后检查 ${directory}。`, { cause: error });
      }
      await delay(25);
    }
  }
  throw new Error('无法读取数据目录锁。');
}

/** Acquire before FileStore.initialize: a second process must never run recovery. */
export async function acquireDataDirectoryLock(root: string): Promise<DataDirectoryLock> {
  await mkdir(root, { recursive: true });
  const directory = path.join(root, '.server-lock');
  const owner: Owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await mkdir(directory);
      try { await writeFile(path.join(directory, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); }
      catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            const current = await readOwner(directory);
            if (current.token === owner.token && current.pid === owner.pid) await rm(directory, { recursive: true, force: true });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    try {
      const observed = await readOwner(directory);
      if (alive(observed.pid)) throw new Error(`该数据目录已由 Define Pretty 进程 ${observed.pid} 使用。请使用现有实例，或设置另一个 DEFINE_PRETTY_DATA_DIR。`);
      // The recovery marker belongs to this exact directory. Concurrent recoverers
      // must re-read ownership after acquiring it, never delete a fresh owner's lock.
      const info = await lstat(directory);
      const recovery = path.join(directory, 'recovering');
      try { await mkdir(recovery); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('另一个实例正在恢复数据目录锁，请稍后重试。');
        throw error;
      }
      let renamed = false;
      try {
        const current = await readOwner(directory);
        const currentInfo = await lstat(directory);
        if (current.token !== observed.token || currentInfo.ino !== info.ino || currentInfo.dev !== info.dev || alive(current.pid)) throw new Error('数据目录锁已由其他实例接管，请使用现有实例。');
        const retired = path.join(root, `.server-lock-stale-${owner.token}`);
        await rename(directory, retired);
        renamed = true;
        await rm(retired, { recursive: true, force: true });
      } finally {
        if (!renamed) {
          const currentInfo = await lstat(directory).catch(() => undefined);
          if (currentInfo?.ino === info.ino && currentInfo.dev === info.dev) await rm(recovery, { recursive: true, force: true });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error('无法获取数据目录锁，请稍后重试。');
}
