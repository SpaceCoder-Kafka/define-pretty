import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FeatureTests } from './feature-tests.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FileStore } from './store.ts';
import { hashWebsite, type Executor } from './codex.ts';
import { featureInstruction } from '../shared/feature-board.ts';
const config={model:'test',reasoningEffort:'medium',cliVersion:'test'};
const png=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001','hex');
async function fixture(executor?:Executor, timeout=1000) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'pretty-transfer-test-'));
  const main=path.join(dir,'main'), html=path.join(main,'runs','baseline','website');await mkdir(html,{recursive:true});await writeFile(path.join(html,'index.html'),'<h1>原始业务内容</h1>');
  const hash=await hashWebsite(html);
  const data={experiments:[{id:'exp',title:'最后一个实验',createdAt:'2026-01-02',versions:[{id:'v1',number:1,baselineRunId:'baseline',config}]}],runs:[{id:'baseline',status:'completed',groupId:'baseline',artifactHash:hash,createdAt:'2026-01-02'},{id:'active',status:'running'}]};
  await writeFile(path.join(main,'store.json'),JSON.stringify(data));
  const store=new FileStore(path.join(dir,'cards'));await store.initialize();const boards=new FeatureBoards(store);await boards.initialize();
  const ref=await store.addReference('ref.png','image/png',png);let board=await boards.create(ref.id,config,'卡片');
  board=await boards.edit(board.id,{revision:board.revision,title:board.title,cards:[{id:'chosen',title:'已选特征',description:'可见依据',instruction:'保留关键关系',effect:'突出重点',adaptation:'允许长文案增高',applicability:'摘要列表',selected:true,application:'任务区',region:{x:0,y:0,width:1,height:1}},{id:'excluded',title:'未选的特征',description:'',instruction:'不要发送这条规范',selected:false,application:'',region:{x:0,y:0,width:1,height:1}}]});
  const tests=new FeatureTests(boards,main,'http://127.0.0.1:4194',executor,async()=>{},timeout);await tests.initialize();
  return {dir,main,html,hash,board,boards,tests,cleanup:async()=>{await tests.shutdown();await boards.shutdown();await rm(dir,{recursive:true,force:true});}};
}
async function done(fn:()=>Promise<boolean>){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('did not finish');}
test('imports latest baseline read-only; sends exact selected export and instructions; later tests start from same baseline',async()=>{
  const seen:string[]=[];
  const f=await fixture(async options=>{seen.push(await readFile(path.join(options.cwd,'website/index.html'),'utf8'));assert.deepEqual(await readFile(options.referenceFile!),png);assert(!options.referenceFile!.startsWith(options.cwd+'/'));assert(!options.prompt.includes('不要发送这条规范'));await writeFile(path.join(options.cwd,'website/index.html'),'<h1>修改后</h1>');return {exitCode:0,summary:'done'};});
  try {
    const bytes=await readFile(path.join(f.main,'store.json'));
    const first=await f.tests.start(f.board.id,f.board.revision,png,config);await done(async()=>!['running','checking'].includes((await f.tests.get(first.id)).status));
    const result=await f.tests.get(first.id);assert.equal(result.status,'completed');assert.equal(result.changed,true);assert(result.prompt.endsWith(featureInstruction(f.board)));
    assert.equal(await hashWebsite(f.html),f.hash);assert.deepEqual(await readFile(path.join(f.main,'store.json')),bytes);
    const second=await f.tests.start(f.board.id,f.board.revision,png,config);await done(async()=>(await f.tests.get(second.id)).status==='completed');assert.notEqual(first.id,second.id);assert.equal(seen[0],seen[1]);
    await f.boards.edit(f.board.id,{revision:f.board.revision,title:'后续编辑',cards:[]});assert.equal((await f.tests.get(first.id)).board.cards.length,2);
  } finally{await f.cleanup();}
});
test('rejects stale selection, invalid image and tampered baseline before model execution',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return {exitCode:0};});
  try{
    await assert.rejects(f.tests.start(f.board.id,0,png,config),{status:409});
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,Buffer.from('not image'),config));
    const source=await f.tests.getSource();await writeFile(path.join(f.tests.sourceDirectory(source.runId),'index.html'),'changed');
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,png,config),{status:409});assert.equal(calls,0);
  }finally{await f.cleanup();}
});
test('cancel, timeout and restart remain terminal; overlapping requests do not launch another process',async()=>{
  const executor:Executor=async options=>new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve({exitCode:null}),{once:true}));
  const f=await fixture(executor,60);
  try{
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,png,config),{status:409});
    assert.equal((await f.tests.cancel(run.id)).status,'cancelled');
    const timed=await f.tests.start(f.board.id,f.board.revision,png,config);await done(async()=>(await f.tests.get(timed.id)).status==='failed');
    const record=await f.tests.get(timed.id);await writeFile(path.join(f.tests.directory(timed.id),'run.json'),JSON.stringify({...record,status:'checking'}));
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');await restarted.initialize();assert.equal((await restarted.get(timed.id)).status,'interrupted');
  }finally{await f.cleanup();}
});


test('a preparation interrupted before record publication does not break history or restart',async()=>{
  const f=await fixture();
  try{
    await mkdir(path.join(f.tests.directory('unpublished'),'work'),{recursive:true});
    assert.deepEqual(await f.tests.list(),[]);
    await f.tests.initialize();assert.deepEqual(await f.tests.list(),[]);
  }finally{await f.cleanup();}
});

test('custom sources receive only requirements, remain immutable and keep historical comparisons addressable',async()=>{
  const seen:string[]=[];
  const f=await fixture(async options=>{
    const file=path.join(options.cwd,'website/index.html');
    if(!options.referenceFile){assert(!options.prompt.includes('已选特征'));assert(!options.prompt.includes('项目管理'));await writeFile(file,'<h1>我的博客</h1>');}
    else {seen.push(await readFile(file,'utf8'));assert(!options.prompt.includes('项目管理'));await writeFile(file,'<h1>优化后的博客</h1>');}
    return {exitCode:0,summary:'done',usage:{input_tokens:1,output_tokens:2}};
  });
  try {
    const old=await f.tests.getSource();
    const generated=await f.tests.generateSource('中文个人博客，包含文章和作者介绍',config);
    await done(async()=>(await f.tests.listSources()).some(s=>s.runId===generated.id));
    const source=await f.tests.getSourceById(generated.id);assert.equal(source.requirements,generated.requirements);
    const job=await f.tests.getSourceRun(generated.id);assert.equal(job.status,'completed');assert(job.usage);assert.equal(source.hash,await hashWebsite(f.tests.sourceDirectory(generated.id)));
    assert.equal((await f.tests.getSourceById(old.runId)).hash,old.hash);
    for(let i=0;i<2;i++){
      const run=await f.tests.start(f.board.id,f.board.revision,png,config,generated.id);
      await done(async()=>(await f.tests.get(run.id)).status==='completed');
      assert.equal((await f.tests.get(run.id)).source.runId,generated.id);
    }
    assert.deepEqual(seen,['<h1>我的博客</h1>','<h1>我的博客</h1>']);
    assert.equal(await hashWebsite(f.tests.sourceDirectory(generated.id)),source.hash);
    assert.equal(await hashWebsite(f.html),old.hash);
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');await restarted.initialize();
    assert.equal((await restarted.listSources()).length,2);
    assert.equal((await restarted.getSourceById(generated.id)).hash,source.hash);
  }finally{await f.cleanup();}
});

test('custom source generation works without any legacy experiment and rejects empty requirements',async()=>{
  let calls=0;
  const f=await fixture(async options=>{calls++;await writeFile(path.join(options.cwd,'website/index.html'),'<h1>个人简历</h1>');return {exitCode:0};});
  try{
    await rm(f.main,{recursive:true,force:true});assert.deepEqual(await f.tests.listSources(),[]);
    await assert.rejects(f.tests.generateSource('  ',config),{status:400});assert.equal(calls,0);
    const job=await f.tests.generateSource('个人简历页',config);
    await done(async()=>(await f.tests.listSources()).length===1);
    assert.equal((await f.tests.getSourceById(job.id)).requirements,'个人简历页');
    await assert.rejects(f.tests.getSourceById('../escape'));
  }finally{await f.cleanup();}
});

test('source cancellation, timeout, shutdown and restart preserve the old source and failed records',async()=>{
  const executor:Executor=async options=>new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve({exitCode:null}),{once:true}));
  const f=await fixture(executor,60);
  try{
    const old=await f.tests.getSource();
    const cancelled=await f.tests.generateSource('博客',config);
    await assert.rejects(f.tests.generateSource('简历',config),{status:409});
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,png,config),{status:409});
    assert.equal((await f.tests.cancelSource(cancelled.id)).status,'cancelled');
    const timed=await f.tests.generateSource('简历',config);await done(async()=>(await f.tests.getSourceRun(timed.id)).status==='failed');
    assert.match((await f.tests.getSourceRun(timed.id)).error!,/30 分钟/);
    const interrupted=await f.tests.generateSource('作品集',config);await f.tests.shutdown();
    assert.equal((await f.tests.getSourceRun(interrupted.id)).status,'interrupted');
    assert.equal((await f.tests.getSource()).runId,old.runId);assert.equal((await f.tests.listSources()).length,1);
    await writeFile(path.join(f.tests.sourceRunDirectory(timed.id),'run.json'),JSON.stringify({...timed,status:'checking'}));
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');await restarted.initialize();
    assert.equal((await restarted.getSourceRun(timed.id)).status,'interrupted');
    assert.equal((await restarted.listSources()).length,1);
  }finally{await f.cleanup();}
});

test('a source failing browser checks is kept as a failed job, never published for testing',async()=>{
  const f=await fixture();
  const tests=new FeatureTests(f.boards,f.main,'http://localhost:4194',async options=>{await writeFile(path.join(options.cwd,'website/index.html'),'<h1>broken</h1>');return {exitCode:0};},async()=>{throw Error('resource failed');});
  try{
    await tests.initialize();const original=await tests.getSource();
    const job=await tests.generateSource('博客',config);await done(async()=>(await tests.getSourceRun(job.id)).status==='failed');
    assert.match((await tests.getSourceRun(job.id)).error!,/resource failed/);
    assert.deepEqual((await tests.listSources()).map(s=>s.runId),[original.runId]);
    await assert.rejects(tests.getSourceById(job.id),{status:404});
  }finally{await tests.shutdown();await f.cleanup();}
});
