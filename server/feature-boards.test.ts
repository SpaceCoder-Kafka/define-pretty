import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cardsInput, FeatureBoards, regionInput, FEATURE_PROMPT, featureSchema } from './feature-boards.ts';
import { FileStore } from './store.ts';
import { FULL_IMAGE_REGION, featureReady, featureInstruction, featureImplementation, featureSections } from '../shared/feature-board.ts';
import type { Executor } from './codex.ts';

const config = { model: 'test', reasoningEffort: 'medium', cliVersion: 'test' };
const generated = { title: '用深色突出主要操作', description: '主要操作使用实心深色，与浅色页面形成对比。', instruction: '把主要操作设为实心深色，次要操作保持轻量。', effect: '让主要操作成为视觉入口。', adaptation: '迁移建议：按钮宽度随文案增长，保留主次对比。', applicability: '具有主次操作关系的工具栏或表单。', region: { x: .2, y: .3, width: .4, height: .2 } };
const layout = { aspectRatio: 2, blocks: [
  { label: '主要内容约58%', role: 'main', x: .1, y: .05, width: .5, height: .9 },
  { label: '辅助内容约42%', role: 'support', x: .62, y: .05, width: .36, height: .9 },
] };
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
  const { adaptation, ...modern } = generated;
  modern.instruction += '\n' + adaptation;
  const f = await fixture(async options => { observedPrompt = options.prompt; assert.equal(options.readOnly, true); return { exitCode: 0, summary: JSON.stringify({ cards: [{ ...modern, kind: 'global' }] }), usage: { input_tokens: 10 } }; });
  try {
    await f.boards.generate(f.board.id);
    await waitFor(async () => (await f.boards.get(f.board.id)).status === 'completed');
    const board = await f.boards.get(f.board.id); assert.equal(board.cards.length, 1); assert.equal(board.cards[0].selected, false); assert.equal(observedPrompt, FEATURE_PROMPT);
    const input = JSON.parse(await readFile(path.join(f.boards.directory(board.id), 'input.json'), 'utf8')); assert.equal(input.reference.sha256, board.reference.sha256); assert.equal(input.prompt, FEATURE_PROMPT);
    assert.equal(input.cardFormat, 6); assert.equal(input.guidanceVersion, 9);
    assert.equal(board.cards[0].adaptation, ''); assert.equal(board.cards[0].instruction, modern.instruction);
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


test('transfer guidance survives saving and reaches selected instructions; legacy cards stay readable', async () => {
  const f = await fixture();
  try {
    const cards = cardsInput([generated], true); cards[0].selected = true;
    const updated = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards });
    const persisted = await f.boards.get(updated.id);
    for (const key of ['effect','adaptation','applicability'] as const) {
      assert.equal(persisted.cards[0][key], generated[key]);
      assert.ok(featureInstruction(persisted).includes(generated[key]));
    }
    const { effect, adaptation, applicability, ...legacy } = cards[0];
    const old = cardsInput([legacy])[0];
    assert.equal(old.instruction, legacy.instruction);
    assert.equal(old.adaptation, '');
    assert.equal(cardsInput([{ ...generated, adaptation: undefined }], true)[0].adaptation, '');
    assert.throws(() => cardsInput([{ ...cards[0], effect: 'a'.repeat(161) }]));
  } finally { await f.cleanup(); }
});

test('three-section cards preserve legacy adaptation through editing, saving and instructions without duplication', async () => {
  const f = await fixture();
  try {
    const old = cardsInput([{ ...generated, instruction: '规'.repeat(600), adaptation: '适'.repeat(320) }], true)[0];
    const before = structuredClone(old);
    const sections = featureSections(old);
    assert.deepEqual(sections.map(s => s.label), ['1．带来什么效果','2．怎么实现','3．适合用在哪里']);
    assert.equal(sections[1].text, `${old.instruction}\n\n${old.adaptation}`);
    assert.deepEqual(old, before);
    const edited = { ...old, selected: true, instruction: featureImplementation(old), adaptation: '' };
    const saved = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [edited] });
    const persisted = await f.boards.get(saved.id);
    assert.equal(featureImplementation(persisted.cards[0]), sections[1].text);
    const prompt = featureInstruction(persisted);
    assert.equal(prompt.split(old.adaptation!).length - 1, 1);
    assert(!featureSchema.properties.cards.items.required.includes('adaptation'));
    assert(!('adaptation' in featureSchema.properties.cards.items.properties));
    assert.throws(() => cardsInput([{ ...edited, instruction: 'a'.repeat(1001) }]));
  } finally { await f.cleanup(); }
});


test('global style is a single fixed full-image card, remains optional, and directs the selected transfer scope', async () => {
  const f = await fixture();
  try {
    const local = cardsInput([generated], true)[0];
    const global = cardsInput([{ ...generated, kind: 'global' }], true)[0];
    assert.equal(global.title, '整体视觉风格');
    assert.deepEqual(global.region, FULL_IMAGE_REGION);
    assert.equal(global.selected, false);
    assert.throws(() => cardsInput([global, { ...global, id: 'duplicate' }]));
    const blank = { ...global, instruction: '', effect: '', applicability: '', selected: true };
    assert.equal(featureReady(blank), false);
    assert.equal(cardsInput([blank])[0].selected, false);
    const saved = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [{ ...local, selected: true }, global] });
    assert.equal(saved.cards[0].kind, 'global');
    assert.match(featureInstruction(saved), /未选中“整体视觉风格”/);
    assert(!featureInstruction(saved).includes('1. 整体视觉风格'));
    saved.cards[0].selected = true;
    const selected = featureInstruction(saved);
    assert.match(selected, /已选中“整体视觉风格”/);
    assert.match(selected, /整页视觉风格协调/);
    assert.match(selected, /不因为整体风格、配色、字体或装饰要求而默认重排整页/);
    assert.match(selected, /整体风格卡不代替布局结构卡的选择/);
    assert.match(selected, /未选择的专项卡片/);
    assert.match(selected, /1. 整体视觉风格/);
    await assert.rejects(f.boards.edit(saved.id, { revision: saved.revision, title: saved.title, cards: [local] }), /固定卡片/);
    const edited = await f.boards.edit(saved.id, { revision: saved.revision, title: saved.title, cards: saved.cards });
    assert.equal((await f.boards.get(edited.id)).cards[0].selected, true);
  } finally { await f.cleanup(); }
});

test('layout selection directly authorizes its structure, respects scope, and excludes unselected diagrams', async () => {
  const f = await fixture();
  try {
    const structure = { ...cardsInput([{ ...generated, title: '宽主栏与辅助栏', kind: 'layout', layout }], true)[0], selected: true, application: '只重新设计项目展示区，其他区域保持现状' };
    const hidden = { ...cardsInput([{ ...generated, title: '未选的霓虹装饰', instruction: 'HIDDEN-NEON-RULE' }], true)[0], selected: false };
    const layoutBoard = { ...f.board, cards: [structure, hidden] };
    const prompt = featureInstruction(layoutBoard);
    assert(prompt.includes(structure.application));
    assert.match(prompt, /范围之外仅做必要的衔接调整/);
    assert.match(prompt, /不以保留原有布局或改动最少为目标/);
    assert.match(prompt, /直接按这套结构实施/);
    assert.match(prompt, /主要内容约58%/);
    assert.match(prompt, /观察估计/);
    assert(!prompt.includes('三个结构明显不同'));
    assert(!prompt.includes(hidden.instruction));
    const localPrompt = featureInstruction({ ...layoutBoard, cards: [{ ...structure, selected: false }, { ...hidden, selected: true }] });
    assert.match(localPrompt, /不因为整体风格、配色、字体或装饰要求而默认重排整页/);
    assert(!localPrompt.includes('已选中布局结构卡：'));
    assert(!localPrompt.includes(structure.application));
    assert(!localPrompt.includes('主要内容约58%'));
    assert.match(localPrompt, /历史专项卡若明确描述布局关系/);
  } finally { await f.cleanup(); }
});

test('layout diagrams validate, keep concrete titles, persist through edits and sort before other specialties', async () => {
  const f = await fixture();
  try {
    const cards = cardsInput([{ ...generated, kind: 'local' }, { ...generated, kind: 'layout', title: '宽主栏与辅助栏', layout }, { ...generated, kind: 'global' }], true);
    assert.deepEqual(cards.map(card => card.kind), ['global', 'layout', 'local']);
    assert.equal(cards[1].title, '宽主栏与辅助栏');
    assert.deepEqual(cards[1].region, generated.region);
    assert.deepEqual(cards[1].layout, layout);
    cards[1].selected = true;
    const saved = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards });
    assert.deepEqual((await f.boards.get(saved.id)).cards[1], cards[1]);
    assert.throws(() => cardsInput([cards[1], { ...cards[1], id: 'another-layout' }]), /最多一张布局/);
    assert.throws(() => cardsInput([{ ...generated, kind: 'layout' }], true), /需要比例色块/);
    assert.throws(() => cardsInput([{ ...cards[1], layout: { ...layout, blocks: [] } }]), /2–8/);
    assert.throws(() => cardsInput([{ ...cards[1], kind: 'local' }]), /只有布局/);
    // Layout drafts remain editable, but only complete diagrams can be selected.
    const draft = cardsInput([{ ...cards[1], layout: undefined, instruction: '' }])[0];
    assert.equal(draft.kind, 'layout'); assert.equal(draft.selected, false); assert.equal(featureReady(draft), false);
    assert(featureSchema.properties.cards.items.required.includes('layout'));
  } finally { await f.cleanup(); }
});

test('detail discovery preserves a selected layout and rejects a new structural card from the model', async () => {
  let newLayout = false;
  const f = await fixture(async () => ({ exitCode: 0, summary: JSON.stringify({ cards: newLayout ? [{ ...generated, kind: 'layout', layout }] : [{ ...generated, kind: 'local', title: '新的细节' }] }) }));
  try {
    const cards = cardsInput([{ ...generated, kind: 'layout', layout }], true); cards[0].selected = true;
    const parent = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards });
    const next = await f.boards.generate(parent.id, { revision: parent.revision, config });
    await waitFor(async () => (await f.boards.get(next.id)).status === 'completed');
    assert.deepEqual((await f.boards.get(next.id)).cards[0], parent.cards[0]);
    newLayout = true;
    const invalid = await f.boards.generate(parent.id, { revision: parent.revision, config });
    await waitFor(async () => (await f.boards.get(invalid.id)).status === 'failed');
    const result = await f.boards.get(invalid.id);
    assert.match(result.error!, /细节补充不能生成/);
    assert.deepEqual(result.cards, parent.cards);
  } finally { await f.cleanup(); }
});

test('generation missing global style fails without accepting a misleading partial board', async () => {
  const f = await fixture(async () => ({ exitCode: 0, summary: JSON.stringify({ cards: [{ ...generated, kind: 'local' }] }) }));
  try {
    await f.boards.generate(f.board.id);
    await waitFor(async () => (await f.boards.get(f.board.id)).status === 'failed');
    const board = await f.boards.get(f.board.id);
    assert.match(board.error!, /整体视觉风格/);
    assert.deepEqual(board.cards, []);
  } finally { await f.cleanup(); }
});

test('detail discovery snapshots existing cards, preserves choices, and excludes new details until selected',async()=>{
  let prompt='';
  const f=await fixture(async options=>{prompt=options.prompt;assert.equal(options.readOnly,true);const schema=JSON.parse(await readFile(options.outputSchema!,'utf8'));assert.equal(schema.properties.cards.minItems,0);return {exitCode:0,summary:JSON.stringify({cards:[{...generated,kind:'local',title:'用错位小标签点缀辅助说明',instruction:'DETAIL-ONLY-RULE'}]})};});
  try{
    const core=cardsInput([generated],true);core[0].selected=true;core[0].application='顶部操作';
    const parent=await f.boards.edit(f.board.id,{revision:f.board.revision,title:'关键关系',cards:core});
    const next=await f.boards.generate(parent.id,{revision:parent.revision,config});
    assert.notEqual(next.id,parent.id);assert.equal(next.parentBoardId,parent.id);
    await waitFor(async()=>(await f.boards.get(next.id)).status==='completed');
    const result=await f.boards.get(next.id);assert.deepEqual(result.cards[0],parent.cards[0]);assert.deepEqual(await f.boards.get(parent.id),parent);
    assert.equal(result.cards[1].discovery,'detail');assert.equal(result.cards[1].selected,false);assert.equal(result.addedDetails,1);
    assert(prompt.includes(parent.cards[0].instruction));assert(!featureInstruction(result).includes('DETAIL-ONLY-RULE'));
    const input=JSON.parse(await readFile(path.join(f.boards.directory(next.id),'input.json'),'utf8'));assert.equal(input.prompt,prompt);assert.deepEqual(input.existingCards,parent.cards);
    result.cards[1].selected=true;
    const saved=await f.boards.edit(result.id,{revision:result.revision,title:result.title,cards:result.cards});
    assert(featureInstruction(saved).includes('DETAIL-ONLY-RULE'));assert.equal(saved.cards[1].discovery,'detail');
    await assert.rejects(f.boards.generate(parent.id,{revision:1,config}),{status:409});
  }finally{await f.cleanup();}
});

test('detail discovery accepts no additions and removes exact title duplicates',async()=>{
  let output:any[]=[];const f=await fixture(async()=>({exitCode:0,summary:JSON.stringify({cards:output})}));
  try{
    const parent=await f.boards.edit(f.board.id,{revision:f.board.revision,title:'关键关系',cards:cardsInput([generated],true)});
    for(const cards of [[],[{...generated,kind:'local'}]]){
      output=cards;const next=await f.boards.generate(parent.id,{revision:parent.revision,config});
      await waitFor(async()=>(await f.boards.get(next.id)).status==='completed');
      const result=await f.boards.get(next.id);assert.deepEqual(result.cards,parent.cards);assert.equal(result.addedDetails,0);
    }
  }finally{await f.cleanup();}
});

test('invalid or cancelled detail discovery never replaces the copied cards or parent',async()=>{
  const f=await fixture(async()=>({exitCode:0,summary:JSON.stringify({cards:[{...generated,kind:'global'}]})}));
  try{
    const parent=await f.boards.edit(f.board.id,{revision:f.board.revision,title:'关键关系',cards:cardsInput([generated],true)});
    const next=await f.boards.generate(parent.id,{revision:parent.revision,config});await waitFor(async()=>(await f.boards.get(next.id)).status==='failed');
    assert.deepEqual((await f.boards.get(next.id)).cards,parent.cards);assert.deepEqual(await f.boards.get(parent.id),parent);
    const slow=new FeatureBoards(f.store,options=>new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve({exitCode:null}),{once:true})));
    await slow.initialize();const pending=await slow.generate(parent.id,{revision:parent.revision,config});
    const cancelled=await slow.cancel(pending.id);assert.equal(cancelled.status,'cancelled');assert.deepEqual(cancelled.cards,parent.cards);await slow.shutdown();
  }finally{await f.cleanup();}
});
