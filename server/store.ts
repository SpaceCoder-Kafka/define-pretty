import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReferenceAsset } from '../shared/types.ts';
import { requireSafeId } from './security.ts';
const clone = <T>(value: T): T => structuredClone(value);
const missing = (message: string) => Object.assign(new Error(message), { status: 404 });
const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
export class FileStore {
  readonly root: string;
  private data: { references: ReferenceAsset[] } = { references: [] };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(root = path.resolve('.data/visual-cards')) { this.root = path.resolve(root); }
  async initialize(): Promise<void> {
    await mkdir(path.join(this.root, 'references'), { recursive: true });
    let parsed;
    try { parsed = JSON.parse(await readFile(path.join(this.root, 'references.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { parsed = JSON.parse(await readFile(path.join(this.root, 'store.json'), 'utf8')); }
      catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError; }
    }
    if (parsed) {
      if (!Array.isArray(parsed.references)) throw new Error('本地参考图记录格式不正确。');
      this.data = { references: parsed.references };
    }
  }
  private async persist(): Promise<void> {
    const temp = path.join(this.root, `store-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(temp, path.join(this.root, 'references.json'));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  referencePath(id: string): string {
    const reference = this.data.references.find((item) => item.id === requireSafeId(id));
    if (!reference) throw missing('参考图不存在。');
    const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[reference.mimeType];
    if (!extension) throw bad('参考图格式不支持。');
    return path.join(this.root, 'references', `${reference.id}${extension}`);
  }

  async addReference(name: string, mimeType: string, bytes: Buffer): Promise<ReferenceAsset> {
    return this.mutate(async () => {
      const reference: ReferenceAsset = { id: randomUUID(), name: path.basename(name).slice(0, 200), mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: '', createdAt: new Date().toISOString() };
      reference.url = `/api/references/${reference.id}`;
      this.data.references.push(reference);
      try { await writeFile(this.referencePath(reference.id), bytes, { flag: 'wx', mode: 0o600 }); await this.persist(); }
      catch (error) { this.data.references = this.data.references.filter((item) => item.id !== reference.id); throw error; }
      return clone(reference);
    });
  }

  async getReference(id: string): Promise<ReferenceAsset> {
    const value = this.data.references.find((item) => item.id === requireSafeId(id));
    if (!value) throw missing('参考图不存在。');
    return clone(value);
  }

}
