// Run only after visually reviewing the completed result. Never copies execution logs.
// Usage: node scripts/snapshot-onboarding-demo.mjs <completed-test-id>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const id = process.argv[2];
assert(id && /^[a-zA-Z0-9_-]+$/.test(id), 'Provide a completed test ID.');
const data = path.resolve(process.env.DEFINE_PRETTY_DATA_DIR || '.data/visual-cards');
const runDirectory = path.join(data, 'feature-tests/runs', id);
const run = JSON.parse(await readFile(path.join(runDirectory, 'run.json'), 'utf8'));
assert(run.status === 'completed' && run.hasPreview, 'Only completed, previewable results can be bundled.');
assert(run.board.cards.length === 8 && run.board.cards.every(card => card.selected), 'The demo requires eight selected cards.');
const current = JSON.parse(await readFile(path.join(data, 'feature-boards', run.boardId, 'board.json'), 'utf8'));
assert.deepEqual(current.cards, run.board.cards, 'The current cards differ from the frozen test input.');
const original = await readFile(path.join(runDirectory, run.originalReference.filename));
assert.equal(createHash('sha256').update(original).digest('hex'), run.board.reference.sha256);
const destination = path.resolve('resources/onboarding/v1');
await assert.rejects(access(destination), 'The version already exists; create a new version instead of overwriting it.');
await mkdir(destination, { recursive: true });
await cp(path.join(data, 'feature-tests/sources', run.source.runId, 'website'), path.join(destination, 'original'), { recursive: true, dereference: false });
await cp(path.join(runDirectory, 'work/website'), path.join(destination, 'optimized'), { recursive: true, dereference: false });
await writeFile(path.join(destination, 'reference.jpg'), original);
const board = {
  id: 'onboarding-v1', title: '剪纸风格 · 快速体验',
  reference: { ...run.board.reference, id: 'onboarding-v1', name: '剪纸风格参考.jpg', url: '/api/onboarding-demo/reference' },
  cards: run.board.cards.map((card, index) => ({ ...card, id: `demo-card-${index + 1}` })),
  config: { model: 'demo', reasoningEffort: 'none', cliVersion: 'bundled' },
  status: 'completed', generationMode: 'core', revision: 1, createdAt: run.createdAt, updatedAt: run.finishedAt,
};
await writeFile(path.join(destination, 'demo.json'), JSON.stringify({ version: 1, board }, null, 2) + '\n');
console.log(`Bundled onboarding v1 from completed test ${id}.`);
