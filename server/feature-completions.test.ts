import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from './store.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureCompletions } from './feature-completions.ts';
import type { Executor } from './codex.ts';
import type { FeatureSpec } from '../shared/feature-spec.ts';
import { STYLE_TRANSFER_GUIDANCE } from '../shared/feature-board.ts';
import { layoutDiagramSchema, parseLayoutDiagram, type LayoutDiagram } from '../shared/layout-diagram.ts';

const config={model:'test',reasoningEffort:'medium',cliVersion:'test'};
const result={description:'框内有浅色图标块。',effect:'入口有分组，不抢主要内容。',instruction:'• 同组尺寸一致。\n• 空间不足时允许换行，保留等距。',applicability:'适合少量辅助入口；长说明应保留文字。'};
const layout:LayoutDiagram={aspectRatio:1.6,blocks:[
  {label:'导航约 7%',x:.05,y:.04,width:.9,height:.08,role:'navigation'},
  {label:'主内容约 56%',x:.05,y:.15,width:.7,height:.8,role:'main'},
  {label:'重点摘要约 10%',x:.63,y:.28,width:.32,height:.3,role:'highlight'},
]};
const proportionalLayout = parseLayoutDiagram({ ...layout, proportions: [{ type: 'relative', block: 2, reference: 1, widthPercent: 46, heightPercent: 38, offsetXPercent: 82, offsetYPercent: 16 }] });
const png=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001','hex');
async function fixture(executor:Executor,timeout=1000){
  const dir=await mkdtemp(path.join(os.tmpdir(),'pretty-completion-')),store=new FileStore(dir);await store.initialize();
  const boards=new FeatureBoards(store);await boards.initialize();const ref=await store.addReference('ref.png','image/png',png);
  let board=await boards.create(ref.id,config,'测试');board=await boards.edit(board.id,{revision:board.revision,title:board.title,cards:[{id:'manual',title:'原名称',description:'原依据',effect:'原效果',instruction:'原规则',applicability:'原用途',region:{x:0,y:0,width:1,height:1},selected:true,application:'顶部工具栏'}]});
  const crops:unknown[]=[];const jobs=new FeatureCompletions(boards,store,executor,async(file,mime,region)=>{assert.deepEqual(await readFile(file),png);assert.equal(mime,'image/png');crops.push(region);return png;},timeout);await jobs.initialize();
  const input={cardId:'manual',revision:board.revision,title:'只借鉴这一组浅色入口',region:{x:.2,y:.3,width:.4,height:.2}};
  return {dir,store,boards,board,jobs,input,crops,cleanup:async()=>{await jobs.shutdown();await boards.shutdown();await rm(dir,{recursive:true,force:true});}};
}
async function waitFor(check:()=>Promise<boolean>){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,5));}throw Error('did not finish');}

test('completion uses unsaved intent and crop, returns only generated fields, and never overwrites the board',async()=>{
  let prompt='';const f=await fixture(async options=>{prompt=options.prompt;assert.equal(options.readOnly,true);assert.equal(options.referenceFiles?.length,2);assert(options.referenceFiles![0].endsWith('crop.png'));assert.deepEqual(await readFile(options.referenceFiles![1]),png);const schema=JSON.parse(await readFile(options.outputSchema!,'utf8'));assert.deepEqual(schema.required,['description','effect','instruction','applicability']);assert.equal(schema.properties.layout,undefined);return {exitCode:0,summary:JSON.stringify({...result,title:'不要接受这个标题',region:{x:0,y:0,width:1,height:1},layout}),usage:{output_tokens:20}};});
  try {
    const before=await readFile(path.join(f.boards.directory(f.board.id),'board.json'));
    const job=await f.jobs.start(f.board.id,f.input,config);await waitFor(async()=>(await f.jobs.get(job.id)).status==='completed');
    const done=await f.jobs.get(job.id);assert.deepEqual(done.result,result);assert.equal(done.title,f.input.title);assert.deepEqual(done.region,f.input.region);assert.deepEqual(f.crops,[f.input.region]);assert(prompt.includes(f.input.title));assert(prompt.includes('不改写用户标题'));
    assert.match(prompt, /布局关系的应用范围由内容用途和规则决定/);
    assert.match(prompt, /只借鉴字体、配色或装饰时，不附加整页重排要求/);
    assert.match(prompt, /核对这张卡片的视觉细节，不扩展用户意图/);
    assert(prompt.includes(STYLE_TRANSFER_GUIDANCE));
    const input=JSON.parse(await readFile(path.join(f.jobs.directory(job.id),'input.json'),'utf8'));assert.equal(input.guidanceVersion,13);assert.equal(input.prompt,prompt);
    assert(!prompt.includes('不扩大为整页改造'));
    assert.deepEqual(await readFile(path.join(f.boards.directory(f.board.id),'board.json')),before);
    const restarted=new FeatureCompletions(f.boards,f.store);await restarted.initialize();assert.deepEqual((await restarted.get(job.id)).result,result);
  }finally{await f.cleanup();}
});

test('layout diagrams preserve proportional overlap and drawing order while rejecting malformed input',()=>{
  const parsed=parseLayoutDiagram(layout);
  assert.deepEqual(parsed,layout);assert.notEqual(parsed,layout);assert.notEqual(parsed.blocks,layout.blocks);
  parsed.blocks[0].label='修改副本';assert.equal(layout.blocks[0].label,'导航约 7%');
  const block=layout.blocks[0];
  const invalidBlocks=[
    {...block,label:''},{...block,label:' '},{...block,label:'长'.repeat(41)},
    {...block,x:-.01},{...block,y:1},{...block,width:0},{...block,height:1.01},
    {...block,x:.8,width:.4},{...block,y:.9,height:.2},{...block,width:NaN},
    {...block,x:'0'},{...block,role:'decoration'},{...block,color:'red'},
  ];
  for(const value of [null,undefined,{}, {...layout,aspectRatio:.39},{...layout,aspectRatio:3.01},{...layout,aspectRatio:Infinity},
    {...layout,blocks:[block]},{...layout,blocks:Array(9).fill(block)},{...layout,extra:true},
    ...invalidBlocks.map(block=>({...layout,blocks:[block,layout.blocks[1]]})),
  ]) assert.throws(()=>parseLayoutDiagram(value));
});

test('layout completion returns a validated proportion diagram as a draft without changing the selected card',async()=>{
  let prompt='';
  const f=await fixture(async options=>{
    prompt=options.prompt;
    assert.equal(options.readOnly,true);
    const schema=JSON.parse(await readFile(options.outputSchema!,'utf8'));
    assert.deepEqual(schema.required,['description','effect','instruction','applicability','layout']);
    assert.deepEqual(schema.properties.layout,layoutDiagramSchema);
    return {exitCode:0,summary:JSON.stringify({...result,layout:proportionalLayout}),usage:{output_tokens:30}};
  });
  try {
    const board=await f.boards.edit(f.board.id,{revision:f.board.revision,title:f.board.title,cards:[{...f.board.cards[0],kind:'layout'}]});
    const before=await readFile(path.join(f.boards.directory(board.id),'board.json'));
    const job=await f.jobs.start(board.id,{...f.input,revision:board.revision},config);
    await waitFor(async()=>!['running','checking'].includes((await f.jobs.get(job.id)).status));
    const done=await f.jobs.get(job.id);
    assert.equal(done.status,'completed',done.error);assert.deepEqual(done.result,{...result,layout:proportionalLayout});
    assert.match(prompt,/比例色块图/);assert.match(prompt,/不生成候选方案/);assert.match(prompt,/不是精确测量/);
    assert.deepEqual(done.region,f.input.region);assert.deepEqual(f.crops,[f.input.region]);
    assert.deepEqual(await readFile(path.join(f.boards.directory(board.id),'board.json')),before);
    const restarted=new FeatureCompletions(f.boards,f.store);await restarted.initialize();assert.deepEqual((await restarted.get(job.id)).result?.layout,proportionalLayout);
  }finally{await f.cleanup();}
});

test('missing or invalid layout diagrams fail completion without returning partial rules or overwriting the card',async()=>{
  for(const diagram of [undefined,null,layout,{...proportionalLayout,proportions:[]},{...layout,blocks:[{...layout.blocks[0],x:.8,width:.9},layout.blocks[1]]}]) {
    const f=await fixture(async()=>({exitCode:0,summary:JSON.stringify({...result,layout:diagram})}));
    try {
      const board=await f.boards.edit(f.board.id,{revision:f.board.revision,title:f.board.title,cards:[{...f.board.cards[0],kind:'layout'}]});
      const job=await f.jobs.start(board.id,{...f.input,revision:board.revision},config);
      await waitFor(async()=>(await f.jobs.get(job.id)).status==='failed');
      const failed=await f.jobs.get(job.id);
      assert.equal(failed.result,undefined);assert.match(failed.error!,/布局/);
      assert.deepEqual((await f.boards.get(board.id)).cards,board.cards);
    }finally{await f.cleanup();}
  }
});
test('invalid region, empty intent and stale revision never invoke model; malformed output stays failed',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return {exitCode:0,summary:JSON.stringify({...result,instruction:''})};});
  try {
    await assert.rejects(f.jobs.start(f.board.id,{...f.input,region:{x:.9,y:0,width:.5,height:1}},config));
    await assert.rejects(f.jobs.start(f.board.id,{...f.input,title:''},config));
    await assert.rejects(f.jobs.start(f.board.id,{...f.input,revision:0},config),{status:409});
    assert.equal(calls,0);const job=await f.jobs.start(f.board.id,f.input,config);await waitFor(async()=>(await f.jobs.get(job.id)).status==='failed');assert.equal((await f.jobs.get(job.id)).result,undefined);
    assert.equal((await f.boards.get(f.board.id)).cards[0].instruction,'原规则');
  }finally{await f.cleanup();}
});
test('overlap, cancellation, timeout and restart preserve terminal states without applying drafts',async()=>{
  const executor:Executor=async options=>new Promise(resolve=>{if(options.signal.aborted)resolve({exitCode:null});else options.signal.addEventListener('abort',()=>resolve({exitCode:null}),{once:true});});
  const f=await fixture(executor,70);
  try {
    const first=await f.jobs.start(f.board.id,f.input,config);await assert.rejects(f.jobs.start(f.board.id,f.input,config),{status:409});assert.equal((await f.jobs.cancel(first.id)).status,'cancelled');
    const timed=await f.jobs.start(f.board.id,f.input,config);await waitFor(async()=>(await f.jobs.get(timed.id)).status==='failed');assert.match((await f.jobs.get(timed.id)).error!,/30 分钟/);
    const record=await f.jobs.get(timed.id);await writeFile(path.join(f.jobs.directory(timed.id),'completion.json'),JSON.stringify({...record,status:'running'}));const restarted=new FeatureCompletions(f.boards,f.store);await restarted.initialize();assert.equal((await restarted.get(timed.id)).status,'interrupted');
    assert.equal((await f.boards.get(f.board.id)).revision,f.board.revision);
  }finally{await f.cleanup();}
});

test('global completion uses the full reference and global guidance without changing existing local cards', async () => {
  let prompt = '';
  const f = await fixture(async options => { prompt = options.prompt; const schema=JSON.parse(await readFile(options.outputSchema!,'utf8'));assert.deepEqual(schema.required,['description','effect','instruction','applicability']);assert.equal(schema.properties.layout,undefined);return { exitCode: 0, summary: JSON.stringify(result) }; });
  try {
    const local = structuredClone(f.board.cards[0]);
    const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [local, { ...local, id: 'global', kind: 'global', instruction: '', effect: '', applicability: '', selected: false }] });
    const job = await f.jobs.start(board.id, { ...f.input, cardId: 'global', revision: board.revision }, config);
    await waitFor(async () => (await f.jobs.get(job.id)).status === 'completed');
    const done = await f.jobs.get(job.id);
    assert.equal(done.title, '整体视觉风格');
    assert.deepEqual(done.region, { x: 0, y: 0, width: 1, height: 1 });
    assert.deepEqual(f.crops, [done.region]);
    assert.match(prompt, /不默认授权重新分组、重排整页/);
    assert.match(prompt, /本次补全只输出上述四个字段/);
    assert(!prompt.includes('不扩大为整页改造'));
    assert(!prompt.includes('本次生成一个完整特征板'));
    assert.deepEqual((await f.boards.get(board.id)).cards.find(c => c.id === local.id), local);
  } finally { await f.cleanup(); }
});

const paletteSpec: FeatureSpec = { kind: 'palette', basis: '页面内颜色的观察估计。', colors: [
  { role: 'page-background', label: '页面底色', hex: '#F5F5F7', usage: '整个页面', areaPercent: 70, evidence: 'estimated' },
  { role: 'text-primary', label: '主要文字', hex: '#111111', usage: '标题与正文', areaPercent: null, evidence: 'estimated' },
] };
const specificationCases: FeatureSpec[] = [
  paletteSpec,
  { kind: 'typography', basis: '字形采用相近候选，尺度按截图估计。', referenceWidth: 1000, rows: [
    { role: 'page-title', label: '页面标题', fontFamily: 'sans-serif', fontEvidence: 'suggested', sizePx: 32, weight: 700, lineHeightPx: 40, letterSpacingEm: 0, evidence: 'estimated' },
    { role: 'body', label: '正文', fontFamily: 'sans-serif', fontEvidence: 'suggested', sizePx: 14, weight: 400, lineHeightPx: 22, letterSpacingEm: 0, evidence: 'estimated' },
  ] },
  { kind: 'spacing', basis: '内容间距按完整图估计。', referenceWidth: 1000, rows: [{ label: '模块间距', value: 24, unit: 'px', reference: '内容宽 1000px', usage: '内容模块之间', evidence: 'estimated' }] },
  { kind: 'attributes', basis: '可见的硬边阴影。', rows: [{ property: '阴影', value: '6px 6px 0 #111111', scope: '重点内容卡', evidence: 'estimated' }] },
];

test('foundation and signature completion returns only the matching specification as a draft', async () => {
  for (const spec of specificationCases) {
    const isLayout = spec.kind === 'spacing';
    let observedPrompt = '';
    const output = { ...result, spec, ...(isLayout ? { layout: proportionalLayout } : {}) };
    const f = await fixture(async options => {
      observedPrompt = options.prompt;
      const schema = JSON.parse(await readFile(options.outputSchema!, 'utf8'));
      assert.deepEqual(schema.properties.spec.properties.kind.enum, [spec.kind]);
      assert(schema.required.includes('spec'));
      assert.equal(schema.required.includes('layout'), isLayout);
      return { exitCode: 0, summary: JSON.stringify(output) };
    });
    try {
      const foundation = spec.kind === 'spacing' ? 'layout' : spec.kind === 'attributes' ? undefined : spec.kind;
      const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [{
        ...f.board.cards[0], kind: isLayout ? 'layout' : 'local', tier: foundation ? 'foundation' : 'signature', foundation, spec,
        ...(isLayout ? { layout: proportionalLayout } : {}),
      }] });
      const before = structuredClone(board);
      const job = await f.jobs.start(board.id, { ...f.input, revision: board.revision }, config);
      await waitFor(async () => !['running','checking'].includes((await f.jobs.get(job.id)).status));
      const done = await f.jobs.get(job.id);
      assert.equal(done.status, 'completed', done.error);
      assert.deepEqual(done.result, output);
      assert(observedPrompt.includes(`spec.kind="${spec.kind}"`));
      assert(observedPrompt.includes('保持分类不变'));
      assert.deepEqual(await f.boards.get(board.id), before);
      const restarted = new FeatureCompletions(f.boards, f.store); await restarted.initialize();
      assert.deepEqual((await restarted.get(job.id)).result, output);
    } finally { await f.cleanup(); }
  }
});

test('invalid or missing required completion parameters fail atomically and leave selected originals unchanged', async () => {
  const invalid = [undefined, null, specificationCases[3], { ...paletteSpec, colors: [] }];
  for (const spec of invalid) {
    const f = await fixture(async () => ({ exitCode: 0, summary: JSON.stringify({ ...result, spec }) }));
    try {
      const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [{ ...f.board.cards[0], kind: 'local', tier: 'foundation', foundation: 'palette', spec: paletteSpec }] });
      const job = await f.jobs.start(board.id, { ...f.input, revision: board.revision }, config);
      await waitFor(async () => (await f.jobs.get(job.id)).status === 'failed');
      assert.equal((await f.jobs.get(job.id)).result, undefined);
      assert.deepEqual(await f.boards.get(board.id), board);
    } finally { await f.cleanup(); }
  }
});

test('detail completion explicitly clears an obsolete parameter table without mutating the saved card', async () => {
  const oldSpec = specificationCases[3];
  const f = await fixture(async options => {
    const schema = JSON.parse(await readFile(options.outputSchema!, 'utf8'));
    assert(schema.required.includes('spec'));
    assert(schema.properties.spec.anyOf.some((item: { type?: string }) => item.type === 'null'));
    return { exitCode: 0, summary: JSON.stringify({ ...result, spec: null }) };
  });
  try {
    const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [{ ...f.board.cards[0], kind: 'local', tier: 'detail', spec: oldSpec }] });
    const job = await f.jobs.start(board.id, { ...f.input, revision: board.revision }, config);
    await waitFor(async () => (await f.jobs.get(job.id)).status === 'completed');
    assert.equal((await f.jobs.get(job.id)).result?.spec, null);
    assert.deepEqual((await f.boards.get(board.id)).cards[0].spec, oldSpec);
    const restarted = new FeatureCompletions(f.boards, f.store); await restarted.initialize();
    assert.equal((await restarted.get(job.id)).result?.spec, null);
  } finally { await f.cleanup(); }
});
