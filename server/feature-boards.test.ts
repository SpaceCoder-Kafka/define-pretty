import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cardsInput, FeatureBoards, regionInput, FEATURE_PROMPT } from './feature-boards.ts';
import { FileStore } from './store.ts';
import { featureInstruction } from '../shared/feature-board.ts';
import type { Executor } from './runner.ts';

const config = { model: 'test', reasoningEffort: 'medium', cliVersion: 'test' };
const generated = { title: '用深色突出主要操作', description: '主要操作使用实心深色，与浅色页面形成对比。', instruction: '把主要操作设为实心深色，次要操作保持轻量。', region: { x: .2, y: .3, width: .4, height: .2 } };
async function fixture(executor?: Executor) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pretty-features-'));
  const store = new FileStore(root); await store.initialize();
  const reference = await store.addReference('reference.png', 'image/png', Buffer.from('test-image'));
  const boards = new FeatureBoards(store, executor); await boards.initialize();
  const board = await boards.create(reference.id, config, '视觉参考');
  return { root, store, boards, board, cleanup: async () => { await boards.shutdown(); await rm(root, { recursive: true, force: true }); } };
}
async function waitFor(fn: () => Promise<boolean>) { for (let i=0; i<200; i++) { if(await fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('异步测试未完成'); }

test('regions reject off-image/nonfinite coordinates; generated cards are unselected', () => {
  assert.deepEqual(regionInput(generated.region), generated.region);
  for (const region of [{x:-.1,y:0,width:.2,height:.2}, {x:.9,y:0,width:.2,height:.2}, {x:0,y:0,width:0,height:.2}, {x:NaN,y:0,width:.2,height:.2}, {x:1,y:0,width:.0000001,height:.2}]) assert.throws(() => regionInput(region));
  const cards = cardsInput([generated], true); assert.equal(cards[0].selected, false); assert.equal(cards[0].application, '');
  assert.throws(() => cardsInput([cards[0], cards[0]]));
  assert.throws(() => cardsInput([], true));
});

test('selection/instruction edits persist, reject stale writes, and exclude unselected features from instructions', async () => {
  const f = await fixture();
  try {
    const cards = cardsInput([generated, { ...generated, title: '不应导出的特征', instruction: '不要出现在配套指令中' }], true);
    cards[0].selected = true; cards[0].application = '顶部导航';
    const edited = await f.boards.edit(f.board.id, { revision: f.board.revision, title: '新的标题', cards });
    assert.equal(edited.revision, 2);
    await assert.rejects(f.boards.edit(f.board.id, { revision: 1, title: '旧请求', cards }), { status: 409 });
    const again = new FeatureBoards(f.store); await again.initialize(); const loaded = await again.get(f.board.id);
    assert.equal(loaded.cards[0].selected, true); assert.equal(loaded.cards[0].application, '顶部导航');
    const instruction = featureInstruction(loaded);
    assert.ok(instruction.includes('顶部导航')); assert.ok(instruction.includes('参考图中的出处')); assert.ok(!instruction.includes('不应导出的特征')); assert.ok(!instruction.includes('不要出现在配套指令中'));
    loaded.cards[0].selected = false; assert.equal(featureInstruction(loaded), '');
  } finally { await f.cleanup(); }
});

test('real generation contract snapshots input and keeps old cards when starting a new board', async () => {
  let observedPrompt = '';
  const f = await fixture(async options => { observedPrompt = options.prompt; assert.equal(options.readOnly, true); return { exitCode: 0, summary: JSON.stringify({ cards: [generated] }), usage: { input_tokens: 10 } }; });
  try {
    await f.boards.generate(f.board.id);
    await waitFor(async () => (await f.boards.get(f.board.id)).status === 'completed');
    const board = await f.boards.get(f.board.id); assert.equal(board.cards.length, 1); assert.equal(board.cards[0].selected, false); assert.equal(observedPrompt, FEATURE_PROMPT);
    const input = JSON.parse(await readFile(path.join(f.boards.directory(board.id), 'input.json'), 'utf8')); assert.equal(input.reference.sha256, board.reference.sha256); assert.equal(input.prompt, FEATURE_PROMPT);
    await assert.rejects(f.boards.generate(board.id), { status: 409 });
    const next = await f.boards.create(board.reference.id, config, board.title); assert.notEqual(next.id, board.id); assert.equal((await f.boards.get(board.id)).cards.length, 1);
  } finally { await f.cleanup(); }
});

test('invalid model coordinates fail without accepting partial output', async () => {
  const f = await fixture(async () => ({ exitCode: 0, summary: JSON.stringify({ cards: [{ ...generated, region: { x: .9, y: .9, width: .5, height: .5 } }] }) }));
  try { await f.boards.generate(f.board.id); await waitFor(async () => (await f.boards.get(f.board.id)).status === 'failed'); assert.deepEqual((await f.boards.get(f.board.id)).cards, []); }
  finally { await f.cleanup(); }
});

test('cancel is terminal; restart marks an unfinished board interrupted', async () => {
  const executor: Executor = options => new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true }));
  const f = await fixture(executor);
  try {
    await f.boards.generate(f.board.id); const cancelled = await f.boards.cancel(f.board.id); assert.equal(cancelled.status, 'cancelled');
    const interrupted = await f.boards.create(f.board.reference.id, config, '未完成记录');
    await writeFile(path.join(f.boards.directory(interrupted.id), 'board.json'), JSON.stringify({ ...interrupted, status: 'running' }));
    const restarted = new FeatureBoards(f.store); await restarted.initialize(); assert.equal((await restarted.get(interrupted.id)).status, 'interrupted'); assert.equal((await restarted.get(cancelled.id)).status, 'cancelled');
  } finally { await f.cleanup(); }
});


test('shutdown during input preparation does not launch an orphaned model process', async () => {
  let launched = false;
  const f = await fixture(async () => { launched = true; return { exitCode: 0, summary: JSON.stringify({ cards: [generated] }) }; });
  try {
    const generation = f.boards.generate(f.board.id);
    await f.boards.shutdown(); await generation;
    assert.equal(launched, false);
    assert.equal((await f.boards.get(f.board.id)).status, 'interrupted');
  } finally { await f.cleanup(); }
});
