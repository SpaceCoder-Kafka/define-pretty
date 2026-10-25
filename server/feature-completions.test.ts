import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from './store.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FeatureCompletions } from './feature-completions.ts';
import type { Executor } from './codex.ts';

const config={model:'test',reasoningEffort:'medium',cliVersion:'test'};
const result={description:'框内有浅色图标块。',effect:'入口有分组，不抢主要内容。',instruction:'• 同组尺寸一致。\n• 空间不足时允许换行，保留等距。',applicability:'适合少量辅助入口；长说明应保留文字。'};
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
  let prompt='';const f=await fixture(async options=>{prompt=options.prompt;assert.equal(options.readOnly,true);assert.equal(options.referenceFiles?.length,2);assert(options.referenceFiles![0].endsWith('crop.png'));const schema=JSON.parse(await readFile(options.outputSchema!,'utf8'));assert.deepEqual(schema.required,['description','effect','instruction','applicability']);return {exitCode:0,summary:JSON.stringify({...result,title:'不要接受这个标题',region:{x:0,y:0,width:1,height:1}}),usage:{output_tokens:20}};});
  try {
    const before=await readFile(path.join(f.boards.directory(f.board.id),'board.json'));
    const job=await f.jobs.start(f.board.id,f.input,config);await waitFor(async()=>(await f.jobs.get(job.id)).status==='completed');
    const done=await f.jobs.get(job.id);assert.deepEqual(done.result,result);assert.equal(done.title,f.input.title);assert.deepEqual(done.region,f.input.region);assert.deepEqual(f.crops,[f.input.region]);assert(prompt.includes(f.input.title));assert(prompt.includes('不改写用户标题'));
    assert.deepEqual(await readFile(path.join(f.boards.directory(f.board.id),'board.json')),before);
    const restarted=new FeatureCompletions(f.boards,f.store);await restarted.initialize();assert.deepEqual((await restarted.get(job.id)).result,result);
  }finally{await f.cleanup();}
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
  const f = await fixture(async options => { prompt = options.prompt; return { exitCode: 0, summary: JSON.stringify(result) }; });
  try {
    const local = structuredClone(f.board.cards[0]);
    const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [local, { ...local, id: 'global', kind: 'global', instruction: '', effect: '', applicability: '', selected: false }] });
    const job = await f.jobs.start(board.id, { ...f.input, cardId: 'global', revision: board.revision }, config);
    await waitFor(async () => (await f.jobs.get(job.id)).status === 'completed');
    const done = await f.jobs.get(job.id);
    assert.equal(done.title, '整体视觉风格');
    assert.deepEqual(done.region, { x: 0, y: 0, width: 1, height: 1 });
    assert.deepEqual(f.crops, [done.region]);
    assert.match(prompt, /独立的整页卡片/);
    assert(!prompt.includes('不扩大为整页改造'));
    assert(!prompt.includes('本次生成一个完整特征板'));
    assert.deepEqual((await f.boards.get(board.id)).cards.find(c => c.id === local.id), local);
  } finally { await f.cleanup(); }
});
