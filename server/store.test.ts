import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from './store.ts';

test('legacy references remain readable; uploads persist separately without changing historical jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-references-'));
  try {
    const reference = { id: 'legacy', name: 'old.png', mimeType: 'image/png', size: 3, sha256: 'old', url: '/api/references/legacy', createdAt: '2026-01-01' };
    const historical = JSON.stringify({ references: [reference], runs: [{ status: 'running' }], generations: [{ status: 'running' }], experiments: [{ id: 'old' }] });
    await writeFile(path.join(root, 'store.json'), historical);
    const store = new FileStore(root); await store.initialize();
    assert.deepEqual(await store.getReference('legacy'), reference);
    const added = await Promise.all(Array.from({ length: 4 }, (_, i) => store.addReference(`${i}.png`, 'image/png', Buffer.from('image'))));
    const reopened = new FileStore(root); await reopened.initialize();
    assert.deepEqual(await reopened.getReference('legacy'), reference);
    for (const asset of added) {
      assert.deepEqual(await reopened.getReference(asset.id), asset);
      assert.equal(await readFile(reopened.referencePath(asset.id), 'utf8'), 'image');
    }
    assert.equal(await readFile(path.join(root, 'store.json'), 'utf8'), historical);
    assert.equal(JSON.parse(await readFile(path.join(root, 'references.json'), 'utf8')).references.length, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});
