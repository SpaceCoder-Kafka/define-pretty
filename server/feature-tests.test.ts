import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, realpath, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { checkFeatureTest, FeatureTests } from './feature-tests.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FileStore } from './store.ts';
import { hashWebsite, type Executor } from './codex.ts';
import { featureInstruction, STYLE_TRANSFER_GUIDANCE } from '../shared/feature-board.ts';
import { parseLayoutDiagram } from '../shared/layout-diagram.ts';
import type { PaletteSpec } from '../shared/feature-spec.ts';
import { builtinSourceCatalog, builtinWebsiteRoot } from './builtin-sources.ts';
import { createApp, createPreviewApp } from './http.ts';
import { chromeExecutable } from './validation.ts';
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
  return {dir,main,html,hash,board,boards,store,tests,cleanup:async()=>{await tests.shutdown();await boards.shutdown();await rm(dir,{recursive:true,force:true});}};
}
async function done(fn:()=>Promise<boolean>){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('did not finish');}
test('selected palette parameters and evidence reach one implementation call without unselected specs or layout authority', async () => {
  const palette: PaletteSpec = { kind: 'palette', basis: '页面区域观察估计', colors: [
    { role: 'page-background', label: '纸面', hex: '#FAF9F3', usage: '整页内容底色', areaPercent: 80, evidence: 'estimated' },
    { role: 'text-primary', label: '主要文字', hex: '#222222', usage: '标题与正文', areaPercent: null, evidence: 'estimated' },
  ] };
  let calls = 0;
  const f = await fixture(async options => {
    calls++;
    assert.match(options.prompt, /node preview\.mjs/);
    assert.match(await readFile(path.join(options.cwd, 'preview.mjs'), 'utf8'), /127\.0\.0\.1/);
    assert(options.prompt.includes(JSON.stringify(palette)));
    assert.match(options.prompt, /未选中布局结构卡/);
    assert.match(options.prompt, /应用区域：整页背景/);
    assert(!options.prompt.includes('PRIVATE-SIGNATURE'));
    assert(!options.prompt.includes('#F12345'));
    await writeFile(path.join(options.cwd, 'website/index.html'), '<main style="background:#FAF9F3;color:#222222">保留原业务内容</main>');
    return { exitCode: 0, summary: '已应用页面与文字颜色。' };
  });
  try {
    const base = f.board.cards[0];
    const board = await f.boards.edit(f.board.id, { revision: f.board.revision, title: f.board.title, cards: [
      { ...base, kind: 'local', tier: 'foundation', foundation: 'palette', application: '', spec: palette },
      { ...base, id: 'unselected', kind: 'local', tier: 'signature', selected: false, spec: { kind: 'attributes', basis: 'PRIVATE-SIGNATURE', rows: [{ property: '阴影', value: '4px 4px 0 #F12345', scope: '卡片', evidence: 'estimated' }] } },
    ] });
    const run = await f.tests.start(board.id, board.revision, png, config);
    await done(async () => !['running', 'checking'].includes((await f.tests.get(run.id)).status));
    const result = await f.tests.get(run.id);
    assert.equal(result.status, 'completed', result.error);
    assert.equal(calls, 1);
    assert.deepEqual(result.board.cards[0].spec, palette);
  } finally { await f.cleanup(); }
});
test('selected layout and global cards directly implement the approved rules in one model call',async()=>{
  const diagram=parseLayoutDiagram({aspectRatio:1.6,blocks:[
    {label:'LAYOUT-MAIN-REGION',x:.05,y:.15,width:.7,height:.8,role:'main'},
    {label:'LAYOUT-HIGHLIGHT-REGION',x:.63,y:.28,width:.32,height:.3,role:'highlight'},
  ], proportions:[{type:'relative',block:1,reference:0,widthPercent:46,heightPercent:38,offsetXPercent:82,offsetYPercent:16}]});
  for(const selection of ['layout','global','both']) {
    let calls=0,observedPrompt='';
    const f=await fixture(async options=>{
      calls++;observedPrompt=options.prompt;
      assert.equal(options.readOnly,undefined);assert.equal(options.outputSchema,undefined);
      assert.deepEqual(await readFile(options.referenceFiles![0]),png);
      assert(!options.prompt.includes('不要发送这条规范'));
      await writeFile(path.join(options.cwd,'website/index.html'),'<main>按已选结构重构后的业务内容</main>');
      return {exitCode:0,summary:'直接重构完成',usage:{input_tokens:10,output_tokens:5}};
    });
    try {
      const board=await f.boards.edit(f.board.id,{revision:f.board.revision,title:f.board.title,cards:[
        {id:'global',kind:'global',title:'整体视觉风格',description:'窗口具有主次',effect:'建立阅读焦点',instruction:'GLOBAL-APPROVED-RELATION',applicability:'有主要与补充信息的区域',selected:selection!=='layout',application:'仅经历区域',region:{x:0,y:0,width:1,height:1}},
        {id:'layout',kind:'layout',layout:diagram,title:'主内容与摘要错层排列',description:'摘要跨越主体边界',effect:'先读摘要再读详情',instruction:'LAYOUT-APPROVED-RELATION',applicability:'主内容与摘要',selected:selection!=='global',application:'仅经历区域',region:{x:0,y:0,width:1,height:1}},
        f.board.cards.find(card=>card.id==='excluded')!,
      ]});
      const run=await f.tests.start(board.id,board.revision,png,config);
      await done(async()=>!['running','checking'].includes((await f.tests.get(run.id)).status));
      const result=await f.tests.get(run.id);
      assert.equal(result.status,'completed',result.error);assert.equal(calls,1);
      assert.equal(observedPrompt,result.prompt);assert(result.prompt.endsWith(featureInstruction(board)));
      assert.equal(observedPrompt.includes('LAYOUT-APPROVED-RELATION'),selection!=='global');
      assert.equal(observedPrompt.includes(JSON.stringify(diagram)),selection!=='global');
      assert.equal(observedPrompt.includes('46%'),selection!=='global');
      assert.equal(observedPrompt.includes('GLOBAL-APPROVED-RELATION'),selection!=='layout');
      assert.match(observedPrompt,/仅经历区域/);
      assert.equal(Object.hasOwn(result,'layoutPlan'),false);assert.equal(Object.hasOwn(result,'phase'),false);
      assert.deepEqual(result.usage,{input_tokens:10,output_tokens:5});
      assert.equal(await hashWebsite(f.tests.sourceDirectory(result.source.runId)),f.hash);
    }finally{await f.cleanup();}
  }
});

test('imports latest baseline read-only; sends exact selected export and instructions; later tests start from same baseline',async()=>{
  const seen:string[]=[];
  const f=await fixture(async options=>{seen.push(await readFile(path.join(options.cwd,'website/index.html'),'utf8'));assert.deepEqual(await readFile(options.referenceFiles![0]),png);assert(!options.referenceFiles![0].startsWith(options.cwd+'/'));assert(!options.prompt.includes('不要发送这条规范'));await writeFile(path.join(options.cwd,'website/index.html'),'<h1>修改后</h1>');return {exitCode:0,summary:'done'};});
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

test('freezes distinct card and original images in order and rejects changed original bytes',async()=>{
  const cardImage = Buffer.concat([png,Buffer.from('selected-card-export')]);
  let calls=0;
  const f=await fixture(async options=>{
    calls++;
    assert.equal(options.referenceFile,undefined);
    assert.equal(options.referenceFiles?.length,2);
    assert.deepEqual(await readFile(options.referenceFiles![0]),cardImage);
    assert.deepEqual(await readFile(options.referenceFiles![1]),png);
    for (const file of options.referenceFiles!) assert(!file.startsWith(options.cwd+path.sep));
    assert(options.prompt.includes(STYLE_TRANSFER_GUIDANCE));
    assert.match(options.prompt,/第二张.*无标记原图/);
    assert.match(options.prompt,/不扩大修改范围/);
    assert.match(options.prompt,/安装依赖、构建/);
    assert.match(options.prompt,/图片生成或编辑/);
    assert.match(options.prompt,/SVG 图片/);
    assert.match(options.prompt,/<use href="#id">/);
    await writeFile(path.join(options.cwd,'website/index.html'),'<main>原始业务内容</main>');
    return {exitCode:0};
  });
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,cardImage,config);
    await done(async()=>!['running','checking'].includes((await f.tests.get(run.id)).status));
    const completed=await f.tests.get(run.id);
    assert.equal(completed.status,'completed',completed.error);
    assert.deepEqual(run.originalReference,{filename:'original-reference.png',mimeType:'image/png',sha256:f.board.reference.sha256});
    assert.notEqual(run.imageHash,run.originalReference!.sha256);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.tests.directory(run.id),'input.json'),'utf8')).originalReference,run.originalReference);
    const original = await f.tests.originalReferenceFile(run.id);
    await writeFile(f.store.referencePath(f.board.reference.id),Buffer.concat([png,Buffer.from('changed')]));
    assert.deepEqual(await readFile(original.file),png,'the historical input must not follow the mutable source');
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,cardImage,config),{status:409});
    assert.equal(calls,1);
  } finally {await f.cleanup();}
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
    if(!options.referenceFiles?.length && !options.referenceFile){assert(!options.prompt.includes('已选特征'));assert(!options.prompt.includes('项目管理'));await writeFile(file,'<h1>我的博客</h1>');}
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
    assert.equal((await restarted.listSources()).length,builtinSourceCatalog.length+2);
    assert.equal((await restarted.getSourceById(generated.id)).hash,source.hash);
  }finally{await f.cleanup();}
});

test('custom source generation works without any legacy experiment and rejects empty requirements',async()=>{
  let calls=0;
  const f=await fixture(async options=>{calls++;await writeFile(path.join(options.cwd,'website/index.html'),'<h1>个人简历</h1>');return {exitCode:0};});
  try{
    await rm(f.main,{recursive:true,force:true});assert.equal((await f.tests.listSources()).length,builtinSourceCatalog.length);
    await assert.rejects(f.tests.generateSource('  ',config),{status:400});assert.equal(calls,0);
    const job=await f.tests.generateSource('个人简历页',config);
    await done(async()=>(await f.tests.listSources()).length===builtinSourceCatalog.length+1);
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
    assert.equal((await f.tests.getSource()).runId,old.runId);assert.equal((await f.tests.listSources()).length,builtinSourceCatalog.length+1);
    await writeFile(path.join(f.tests.sourceRunDirectory(timed.id),'run.json'),JSON.stringify({...timed,status:'checking'}));
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');await restarted.initialize();
    assert.equal((await restarted.getSourceRun(timed.id)).status,'interrupted');
    assert.equal((await restarted.listSources()).length,builtinSourceCatalog.length+1);
  }finally{await f.cleanup();}
});

test('a source failing browser checks is kept as a failed job, never published for testing',async()=>{
  const f=await fixture();
  const tests=new FeatureTests(f.boards,f.main,'http://localhost:4194',async options=>{await writeFile(path.join(options.cwd,'website/index.html'),'<h1>broken</h1>');return {exitCode:0};},async()=>{throw Error('resource failed');});
  try{
    await tests.initialize();const original=await tests.getSource();
    const job=await tests.generateSource('博客',config);await done(async()=>(await tests.getSourceRun(job.id)).status==='failed');
    assert.match((await tests.getSourceRun(job.id)).error!,/resource failed/);
    const available=await tests.listSources();
    assert.equal(available.filter(s=>s.builtin).length,builtinSourceCatalog.length);
    assert.deepEqual(available.filter(s=>!s.builtin).map(s=>s.runId),[original.runId]);
    await assert.rejects(tests.getSourceById(job.id),{status:404});
  }finally{await tests.shutdown();await f.cleanup();}
});

test('fresh installation exposes eight builtins without generation and keeps stable IDs across restart', async()=>{
  let calls=0;
  const f=await fixture(async()=>{calls++;return {exitCode:0};});
  try {
    await rm(f.main,{recursive:true,force:true});
    const sources=await f.tests.listSources();
    assert.equal(sources.length,8);
    assert.deepEqual(sources.map(s=>s.builtin?.slug),builtinSourceCatalog.map(s=>s.slug));
    assert.equal((await f.tests.getSource()).runId,sources[0].runId);
    assert.equal(sources[0].builtin?.slug,'dashboard');
    for (const source of sources) {
      assert.equal((await f.tests.getSourceById(source.runId)).hash,source.hash);
      assert.equal(await hashWebsite(f.tests.sourceDirectory(source.runId)),source.hash);
    }
    assert.deepEqual(await f.tests.listSources(),sources);
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');
    await restarted.initialize();
    assert.deepEqual(await restarted.listSources(),sources);
    await assert.rejects(restarted.getSourceById('missing-builtin'),{status:404});
    assert.equal(calls,0);
  } finally {await f.cleanup();}
});

test('selected builtins are copied unchanged for each test and tampering cannot reach the model',async()=>{
  const seen:string[]=[];
  const f=await fixture(async options=>{
    seen.push(await readFile(path.join(options.cwd,'website/index.html'),'utf8'));
    await writeFile(path.join(options.cwd,'website/index.html'),'<h1>仅修改本次测试</h1>');
    return {exitCode:0};
  });
  try {
    const original=await f.tests.getSource();
    const source=(await f.tests.listSources()).find(s=>s.builtin?.slug==='blog')!;
    const bytes=await readFile(path.join(f.tests.sourceDirectory(source.runId),'index.html'),'utf8');
    for(let i=0;i<2;i++) {
      const run=await f.tests.start(f.board.id,f.board.revision,png,config,source.runId);
      await done(async()=>(await f.tests.get(run.id)).status==='completed');
      assert.deepEqual((await f.tests.get(run.id)).source,source);
    }
    assert.deepEqual(seen,[bytes,bytes]);
    assert.equal((await f.tests.getSource()).runId,original.runId);
    assert.equal(await hashWebsite(f.tests.sourceDirectory(source.runId)),source.hash);
    await writeFile(path.join(f.tests.sourceDirectory(source.runId),'index.html'),'tampered');
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,png,config,source.runId),{status:409});
    assert.equal(seen.length,2);
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194');
    await assert.rejects(restarted.initialize(),{status:409});
  } finally {await f.cleanup();}
});

test('a shipped builtin revision gets a new ID while earlier comparisons keep their frozen source',async()=>{
  const f=await fixture(async()=>({exitCode:0}));
  try {
    const old=(await f.tests.listSources()).find(s=>s.builtin?.slug==='dashboard')!;
    const oldBytes=await readFile(path.join(f.tests.sourceDirectory(old.runId),'index.html'),'utf8');
    const run=await f.tests.start(f.board.id,f.board.revision,png,config,old.runId);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const revisedBundle=path.join(f.dir,'revised-bundle');
    await cp(builtinWebsiteRoot,revisedBundle,{recursive:true});
    await writeFile(path.join(revisedBundle,'dashboard/index.html'),oldBytes+'\n<!-- shipped revision two -->');
    const restarted=new FeatureTests(f.boards,f.main,'http://localhost:4194',undefined,undefined,1000,revisedBundle);
    await restarted.initialize();
    const current=await restarted.listSources();
    const latest=current.find(s=>s.builtin?.slug==='dashboard')!;
    assert.notEqual(latest.runId,old.runId);
    assert.notEqual(latest.hash,old.hash);
    assert.equal(current.filter(s=>s.builtin).length,8);
    assert.equal(current.some(s=>s.runId===old.runId),false);
    assert.deepEqual(await restarted.getSourceById(old.runId),old);
    assert.deepEqual((await restarted.get(run.id)).source,old);
    assert.equal(await readFile(path.join(restarted.sourceDirectory(old.runId),'index.html'),'utf8'),oldBytes);
    assert.equal(await hashWebsite(restarted.sourceDirectory(latest.runId)),latest.hash);
    assert.equal(current.filter(s=>!s.builtin).length,1);
  } finally {await f.cleanup();}
});

test('builtin sources use the existing sandboxed preview and selected-source test API',async()=>{
  let calls=0;
  const f=await fixture(async options=>{calls++;await writeFile(path.join(options.cwd,'website/index.html'),'<h1>本次优化</h1>');return {exitCode:0};});
  const consoleServer=createServer();
  await new Promise<void>(resolve=>consoleServer.listen(0,'127.0.0.1',resolve));
  const consolePort=(consoleServer.address() as {port:number}).port;
  const previewServer=createServer(createPreviewApp(consolePort,f.tests));
  await new Promise<void>(resolve=>previewServer.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${consolePort}`;
  const previewOrigin=`http://127.0.0.1:${(previewServer.address() as {port:number}).port}`;
  const runtime={codexAvailable:false,authenticated:false,version:'test'};
  consoleServer.on('request',createApp({store:f.store,featureBoards:f.boards,featureTests:f.tests,consolePort,previewOrigin,config,runtime,token:'builtin-test-token'}));
  try {
    const listResponse=await fetch(`${origin}/api/feature-tests/sources`);
    assert.equal(listResponse.status,200);
    const sources=await listResponse.json() as Awaited<ReturnType<FeatureTests['listSources']>>;
    assert.equal(sources.filter(s=>s.builtin).length,8);
    const source=sources.find(s=>s.builtin?.slug==='resume')!;
    const url=`${previewOrigin}/feature-tests/sources/${source.runId}/index.html`;
    const preview=await fetch(url);
    assert.equal(preview.status,200);
    assert.match(preview.headers.get('content-security-policy') || '',/sandbox allow-scripts/);
    assert.doesNotMatch(preview.headers.get('content-security-policy') || '',/allow-same-origin/);
    const frozen=await preview.text();
    assert.equal(frozen,await readFile(path.join(f.tests.sourceDirectory(source.runId),'index.html'),'utf8'));
    assert.equal((await fetch(`${previewOrigin}/feature-tests/sources/missing/index.html`)).status,404);
    assert.equal((await fetch(`${previewOrigin}/feature-tests/sources/${source.runId}/..%2Fsource.json`)).status,400);
    assert.equal((await fetch(`${previewOrigin}/api/bootstrap`)).status,404);
    assert.equal(calls,0,'listing and previewing builtins must not invoke the model or require login');
    runtime.codexAvailable=true;runtime.authenticated=true;
    const form=new FormData();
    form.append('image',new Blob([new Uint8Array(png)],{type:'image/png'}),'selected.png');
    form.append('boardId',f.board.id);form.append('revision',String(f.board.revision));
    form.append('sourceId',source.runId);form.append('config',JSON.stringify(config));
    const response=await fetch(`${origin}/api/feature-tests`,{method:'POST',headers:{Origin:origin,'X-Define-Pretty-Token':'builtin-test-token'},body:form});
    assert.equal(response.status,202);
    const run=await response.json() as {id:string;source:{runId:string}};
    assert.equal(run.source.runId,source.runId);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    assert.equal(calls,1);
    assert.equal(await(await fetch(url)).text(),frozen);
  } finally {
    for(const server of [consoleServer,previewServer]) {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    await f.cleanup();
  }
});

test('serves frozen original inputs and local generated assets while preserving legacy and path isolation',async()=>{
  const cardImage=Buffer.concat([png,Buffer.from('selected-cards')]);
  const f=await fixture(async options=>{
    await mkdir(path.join(options.cwd,'website/assets'),{recursive:true});
    await writeFile(path.join(options.cwd,'website/assets/illustration.png'),png);
    await writeFile(path.join(options.cwd,'website/index.html'),'<main>原始业务内容<img src="assets/illustration.png" alt="插画"></main>');
    return {exitCode:0};
  });
  const consoleServer=createServer();
  await new Promise<void>(resolve=>consoleServer.listen(0,'127.0.0.1',resolve));
  const consolePort=(consoleServer.address() as {port:number}).port;
  const previewServer=createServer(createPreviewApp(consolePort,f.tests));
  await new Promise<void>(resolve=>previewServer.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${consolePort}`;
  const previewOrigin=`http://127.0.0.1:${(previewServer.address() as {port:number}).port}`;
  consoleServer.on('request',createApp({store:f.store,featureBoards:f.boards,featureTests:f.tests,consolePort,previewOrigin,config,runtime:{codexAvailable:false,authenticated:false,version:'test'}}));
  try {
    const started=await f.tests.start(f.board.id,f.board.revision,cardImage,config);
    await done(async()=>(await f.tests.get(started.id)).status==='completed');
    const run=await f.tests.get(started.id),runFile=path.join(f.tests.directory(run.id),'run.json');
    const originalUrl=`${origin}/api/feature-tests/${run.id}/original-reference`;
    const original=await fetch(originalUrl);
    assert.equal(original.status,200);
    assert.match(original.headers.get('content-type') || '',/^image\/png/);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()),png);
    const card=await fetch(`${origin}/api/feature-tests/${run.id}/image`);
    assert.equal(card.status,200);assert.deepEqual(Buffer.from(await card.arrayBuffer()),cardImage);
    const asset=await fetch(`${previewOrigin}/feature-tests/runs/${run.id}/assets/illustration.png`);
    assert.equal(asset.status,200);assert.deepEqual(Buffer.from(await asset.arrayBuffer()),png);
    assert.match(asset.headers.get('content-security-policy') || '',/img-src 'self' data: blob:/);
    assert.equal((await fetch(`${previewOrigin}/feature-tests/runs/${run.id}/..%2Foriginal-reference.png`)).status,400);
    assert.equal((await fetch(`${origin}/api/feature-tests/missing/original-reference`)).status,404);

    const {originalReference,...legacy}=run;
    await writeFile(runFile,JSON.stringify(legacy));
    assert.equal((await fetch(originalUrl)).status,404);
    assert.equal((await fetch(`${origin}/api/feature-tests/${run.id}/image`)).status,200);
    assert.deepEqual(await f.tests.get(run.id),legacy);

    for(const filename of ['../reference.png','prompt.txt','work/website/index.html']) {
      await writeFile(runFile,JSON.stringify({...run,originalReference:{...originalReference,filename}}));
      assert.equal((await fetch(originalUrl)).status,400);
    }
    await writeFile(runFile,JSON.stringify(run));
    const originalFile=path.join(f.tests.directory(run.id),originalReference!.filename);
    await rm(originalFile);
    await symlink(f.store.referencePath(f.board.reference.id),originalFile);
    assert.equal((await fetch(originalUrl)).status,403);
  } finally {
    for(const server of [consoleServer,previewServer]) {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    await f.cleanup();
  }
});

test('sandboxed iframe executes local ES modules and relative imports without exposing API CORS',async()=>{
  const f=await fixture(async options=>{
    await mkdir(path.join(options.cwd,'website/assets'),{recursive:true});
    await writeFile(path.join(options.cwd,'website/index.html'),'<main><p id="result">等待模块</p><button id="increment">增加</button></main><script type="module" src="assets/main.js"></script>');
    await writeFile(path.join(options.cwd,'website/assets/helper.js'),'export const label = "相对模块已加载"; export const increment = value => value + 1;');
    await writeFile(path.join(options.cwd,'website/assets/main.js'),'import { label, increment } from "./helper.js"; let count = 0; const result = document.querySelector("#result"); result.textContent = label; document.querySelector("#increment").addEventListener("click", () => { count = increment(count); result.textContent = `${label}: ${count}`; });');
    return {exitCode:0};
  });
  const consoleServer=createServer();
  await new Promise<void>(resolve=>consoleServer.listen(0,'127.0.0.1',resolve));
  const consolePort=(consoleServer.address() as {port:number}).port;
  const previewServer=createServer(createPreviewApp(consolePort,f.tests));
  await new Promise<void>(resolve=>previewServer.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${consolePort}`;
  const previewOrigin=`http://127.0.0.1:${(previewServer.address() as {port:number}).port}`;
  const app=createApp({store:f.store,featureBoards:f.boards,featureTests:f.tests,consolePort,previewOrigin,config,runtime:{codexAvailable:false,authenticated:false,version:'test'}});
  consoleServer.on('request',app);
  let browser: Browser | undefined;
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const previewUrl=`${previewOrigin}/feature-tests/runs/${run.id}`;
    app.get('/module-fixture',(_req,res)=>res.type('html').send(`<iframe name="module-preview" sandbox="allow-scripts" src="${previewUrl}/index.html"></iframe>`));
    for(const asset of ['index.html','assets/main.js','assets/helper.js']) {
      const response=await fetch(`${previewUrl}/${asset}`,{headers:{Origin:'null'}});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('access-control-allow-origin'),'*');
      assert.equal(response.headers.get('access-control-allow-credentials'),null);
      assert.match(response.headers.get('content-security-policy') || '',/connect-src 'none'/);
    }
    for(const url of [`${origin}/api/health`,`${origin}/api/feature-tests/${run.id}/original-reference`,`${previewOrigin}/api/bootstrap`]) {
      assert.equal((await fetch(url)).headers.get('access-control-allow-origin'),null);
    }
    browser=await chromium.launch({executablePath:await chromeExecutable(),headless:true});
    const page=await browser.newPage();
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/module-fixture`);
    const frame=page.frame({name:'module-preview'});
    assert(frame,'the preview iframe must be attached');
    await frame.waitForFunction(()=>document.querySelector('#result')?.textContent==='相对模块已加载');
    assert.equal(await frame.evaluate(()=>globalThis.origin),'null','the preview must retain its opaque sandbox origin');
    await frame.locator('#increment').click();
    assert.equal(await frame.locator('#result').textContent(),'相对模块已加载: 1');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    for(const server of [consoleServer,previewServer]) {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    await f.cleanup();
  }
});

test('sandboxed SVG sprites receive one actionable diagnosis while inline symbols and SVG images render',async()=>{
  const symbol='<symbol id="icon" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="red"/></symbol>';
  const inline=`<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbol}</svg><svg width="20" height="20"><use href="#icon"/></svg><img id="art" src="assets/art.svg">`;
  const f=await fixture(async options=>{
    const website=path.join(options.cwd,'website');
    await mkdir(path.join(website,'assets'),{recursive:true});
    await writeFile(path.join(website,'index.html'),inline);
    await writeFile(path.join(website,'external.html'),Array.from({length:4},()=>'<svg width="20" height="20"><use href="assets/icons.svg#icon"/></svg>').join(''));
    await writeFile(path.join(website,'other-error.html'),'<img src="assets/missing.svg"><script>throw new Error("origin: unrelated script failure")</script>');
    await writeFile(path.join(website,'assets/icons.svg'),`<svg xmlns="http://www.w3.org/2000/svg">${symbol}</svg>`);
    await writeFile(path.join(website,'assets/art.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>');
    return {exitCode:0};
  });
  const server=createServer(createPreviewApp(4193,f.tests));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser: Browser | undefined;
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/feature-tests/runs/${run.id}`;
    const asset=await fetch(`${base}/assets/icons.svg`);
    assert.equal(asset.headers.get('access-control-allow-origin'),'*');
    assert.match(asset.headers.get('content-security-policy') || '',/sandbox allow-scripts/);
    assert.doesNotMatch(asset.headers.get('content-security-policy') || '',/allow-same-origin/);
    await assert.rejects(checkFeatureTest(`${base}/external.html`,new AbortController().signal),(error: Error)=>{
      assert.equal(error.message.split('外链 SVG <use>').length-1,1,'repeated uses of the same sprite must produce one diagnosis');
      assert.match(error.message,/assets\/icons\.svg/);
      assert.match(error.message,/symbol 内联到当前 HTML/);
      assert.match(error.message,/<use href="#id">/);
      return true;
    });
    await checkFeatureTest(`${base}/index.html`,new AbortController().signal);
    await assert.rejects(checkFeatureTest(`${base}/other-error.html`,new AbortController().signal),(error: Error)=>{
      assert.match(error.message,/origin: unrelated script failure/);
      assert.match(error.message,/missing\.svg/);
      assert.doesNotMatch(error.message,/外链 SVG <use>/);
      return true;
    });
    browser=await chromium.launch({executablePath:await chromeExecutable(),headless:true});
    const page=await browser.newPage();
    await page.goto(`${base}/index.html`);
    assert.deepEqual(await page.evaluate(()=>({
      origin:globalThis.origin,
      iconWidth:document.querySelector<SVGUseElement>('use')!.getBBox().width,
      imageWidth:document.querySelector<HTMLImageElement>('#art')!.naturalWidth,
    })),{origin:'null',iconWidth:16,imageWidth:32});
  } finally {
    await browser?.close();
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await f.cleanup();
  }
});

test('refinement continues a failed result in isolation with frozen selection, inputs and original comparison source',async()=>{
  const cardImage=Buffer.concat([png,Buffer.from('frozen-selection')]);
  const seen:string[]=[];
  let calls=0;
  const f=await fixture(async options=>{
    calls++;seen.push(await readFile(path.join(options.cwd,'website/index.html'),'utf8'));
    assert.deepEqual(await readFile(options.referenceFiles![0]),cardImage);
    assert.deepEqual(await readFile(options.referenceFiles![1]),png);
    assert.equal(options.referenceFiles![0],path.resolve(options.cwd,'../reference.png'));
    assert.equal(await realpath(options.referenceFiles![1]),await realpath(path.resolve(options.cwd,'../original-reference.png')));
    assert(options.prompt.includes('../reference.png'));
    assert(options.prompt.includes('../original-reference.png'));
    assert(options.prompt.includes(STYLE_TRANSFER_GUIDANCE));
    assert(!options.prompt.includes('不要发送这条规范'));
    const input=JSON.parse(await readFile(path.join(options.cwd,'../input.json'),'utf8'));
    assert.equal(input.prompt,options.prompt);
    assert.equal(await readFile(path.join(options.cwd,'../prompt.txt'),'utf8'),options.prompt);
    if(calls>1) {
      assert(options.prompt.includes('调整插画的线条细节，保持标题已实现的尺寸'));
      assert(options.prompt.includes('应用区域：任务区'));
      assert(!options.prompt.includes('后续编辑新增的要求'));
    }
    await writeFile(path.join(options.cwd,'website/index.html'),calls===1?'<h1>上轮已生成的产物</h1>':'<h1>继续优化后的产物</h1>');
    return calls===1?{exitCode:1,error:'model capacity',summary:'未完成'}:{exitCode:0};
  });
  try {
    const started=await f.tests.start(f.board.id,f.board.revision,cardImage,config);
    await done(async()=>(await f.tests.get(started.id)).status==='failed');
    const parent=await f.tests.get(started.id);
    assert.equal(parent.hasPreview,true,parent.error);
    const parentHash=await hashWebsite(f.tests.websiteDirectory(parent.id));
    const parentRecord=await readFile(path.join(f.tests.directory(parent.id),'run.json'));
    await f.boards.edit(f.board.id,{revision:f.board.revision,title:'后来改动',cards:f.board.cards.map(card=>({...card,selected:!card.selected,instruction:'后续编辑新增的要求'}))});
    await writeFile(f.store.referencePath(f.board.reference.id),Buffer.concat([png,Buffer.from('new-upload')]));
    const child=await f.tests.refine(parent.id,'  调整插画的线条细节，保持标题已实现的尺寸  ',config);
    await done(async()=>(await f.tests.get(child.id)).status==='completed');
    const result=await f.tests.get(child.id);
    assert.notEqual(child.id,parent.id);
    assert.deepEqual(result.board,parent.board);
    assert.deepEqual(result.source,parent.source);
    assert.deepEqual(result.originalReference,parent.originalReference);
    assert.equal(result.imageHash,parent.imageHash);
    assert.deepEqual(result.refinement,{parentTestId:parent.id,parentArtifactHash:parentHash,feedback:'调整插画的线条细节，保持标题已实现的尺寸'});
    assert.deepEqual(seen,['<h1>原始业务内容</h1>','<h1>上轮已生成的产物</h1>']);
    assert.equal(await hashWebsite(f.tests.websiteDirectory(parent.id)),parentHash);
    assert.deepEqual(await readFile(path.join(f.tests.directory(parent.id),'run.json')),parentRecord);
    assert.equal(await hashWebsite(f.tests.sourceDirectory(result.source.runId)),f.hash);
    assert.equal((await f.tests.list()).length,2);
    assert.equal(result.changed,true);
  } finally {await f.cleanup();}
});

test('refinement rejects unfinished or unpreviewable parents, changed inputs and unsafe parent files before execution',async()=>{
  let calls=0;
  const f=await fixture(async()=>{calls++;return {exitCode:0};});
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const parent=await f.tests.get(run.id), recordFile=path.join(f.tests.directory(run.id),'run.json');
    for(const patch of [{status:'queued'},{status:'running'},{status:'checking'},{hasPreview:false},{id:'different'}]) {
      await writeFile(recordFile,JSON.stringify({...parent,...patch}));
      await assert.rejects(f.tests.refine(run.id,'继续优化',config),{status:409});
    }
    await writeFile(recordFile,JSON.stringify(parent));
    await assert.rejects(f.tests.refine(run.id,' ',config),{status:400});
    await assert.rejects(f.tests.refine(run.id,'长'.repeat(4001),config),{status:400});
    const image=path.join(f.tests.directory(run.id),'reference.png');
    await writeFile(image,Buffer.concat([png,Buffer.from('changed')]));
    await assert.rejects(f.tests.refine(run.id,'继续优化',config),{status:409});
    await writeFile(image,png);
    const original=path.join(f.tests.directory(run.id),parent.originalReference!.filename);
    await writeFile(original,Buffer.concat([png,Buffer.from('changed')]));
    await assert.rejects(f.tests.refine(run.id,'继续优化',config),{status:409});
    await writeFile(original,png);
    await symlink(f.html,path.join(f.tests.websiteDirectory(run.id),'linked'));
    await assert.rejects(f.tests.refine(run.id,'继续优化',config),/符号链接/);
    assert.equal(calls,1);
    assert.equal((await f.tests.list()).length,1);
  } finally {await f.cleanup();}
});

test('legacy refinement recovers only hash-matching originals and otherwise declares an actual single-image input',async()=>{
  const counts:number[]=[];
  const f=await fixture(async options=>{
    counts.push(options.referenceFiles!.length);
    if(options.referenceFiles!.length===1) {
      assert(!options.prompt.includes('../original-reference'));
      assert(options.prompt.endsWith(featureInstruction(f.board,{hasOriginalReference:false})));
    }
    return {exitCode:0};
  });
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const parent=await f.tests.get(run.id),{originalReference,...legacy}=parent;
    await writeFile(path.join(f.tests.directory(run.id),'run.json'),JSON.stringify(legacy));
    await rm(path.join(f.tests.directory(run.id),originalReference!.filename));
    const recovered=await f.tests.refine(run.id,'继续优化',config);
    await done(async()=>(await f.tests.get(recovered.id)).status==='completed');
    assert.deepEqual(recovered.originalReference,originalReference);
    await writeFile(f.store.referencePath(f.board.reference.id),Buffer.concat([png,Buffer.from('changed')]));
    await assert.rejects(f.tests.refine(run.id,'继续优化',config),{status:409});
    await rm(f.store.referencePath(f.board.reference.id));
    const single=await f.tests.refine(run.id,'继续优化',config);
    await done(async()=>!['running','checking'].includes((await f.tests.get(single.id)).status));
    const finished=await f.tests.get(single.id);
    assert.equal(finished.status,'completed',finished.error);
    assert.equal(single.originalReference,undefined);
    assert.deepEqual(counts,[2,2,1]);
  } finally {await f.cleanup();}
});

test('refinement shares task locking, cancellation and timeout without modifying its parent',async()=>{
  let calls=0;
  const f=await fixture(async options=>{
    if(++calls===1) return {exitCode:0};
    return new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve({exitCode:null}),{once:true}));
  },80);
  try {
    const run=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(run.id)).status==='completed');
    const parentRecord=await readFile(path.join(f.tests.directory(run.id),'run.json'));
    const child=await f.tests.refine(run.id,'继续优化',config);
    await assert.rejects(f.tests.refine(run.id,'另一次优化',config),{status:409});
    await assert.rejects(f.tests.start(f.board.id,f.board.revision,png,config),{status:409});
    await assert.rejects(f.tests.generateSource('其他网页',config),{status:409});
    assert.equal((await f.tests.cancel(child.id)).status,'cancelled');
    const timeout=await f.tests.refine(run.id,'继续优化',config);
    await done(async()=>(await f.tests.get(timeout.id)).status==='failed');
    assert.match((await f.tests.get(timeout.id)).error!,/30 分钟/);
    assert.deepEqual(await readFile(path.join(f.tests.directory(run.id),'run.json')),parentRecord);
  } finally {await f.cleanup();}
});

test('refinement JSON API preserves parent model and provider while using the current CLI version',async()=>{
  const parentConfig={...config,model:'parent-model',provider:'parent-provider',cliVersion:'older-cli'};
  const executionConfigs:typeof parentConfig[]=[];
  const f=await fixture(async options=>{executionConfigs.push(options.config as typeof parentConfig);return {exitCode:0};});
  const server=createServer();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const consolePort=(server.address() as {port:number}).port, origin=`http://127.0.0.1:${consolePort}`;
  const runtime={codexAvailable:true,authenticated:true,version:'test'};
  server.on('request',createApp({store:f.store,featureBoards:f.boards,featureTests:f.tests,consolePort,previewOrigin:'http://127.0.0.1:4194',config,runtime,token:'refine-test-token'}));
  try {
    const parent=await f.tests.start(f.board.id,f.board.revision,png,parentConfig);
    await done(async()=>(await f.tests.get(parent.id)).status==='completed');
    const url=`${origin}/api/feature-tests/${parent.id}/refine`;
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback:'继续优化'})})).status,403);
    const headers={Origin:origin,'Content-Type':'application/json','X-Define-Pretty-Token':'refine-test-token'};
    assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,400);
    runtime.authenticated=false;
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({feedback:'继续优化'})})).status,503);
    runtime.authenticated=true;
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({feedback:'改善插画'})});
    assert.equal(response.status,202);
    const child=await response.json();
    assert.deepEqual(child.config,{...parentConfig,cliVersion:config.cliVersion});
    assert.equal(child.refinement.parentTestId,parent.id);
    await done(async()=>(await f.tests.get(child.id)).status==='completed');
    const override=await fetch(url,{method:'POST',headers,body:JSON.stringify({feedback:'改善文字',config:{model:'explicit-model',reasoningEffort:'high',provider:'forged'}})});
    assert.equal(override.status,202);
    const explicit=await override.json();
    assert.deepEqual(explicit.config,{...parentConfig,cliVersion:config.cliVersion,model:'explicit-model',reasoningEffort:'high'});
    await done(async()=>(await f.tests.get(explicit.id)).status==='completed');
    assert.deepEqual(executionConfigs,[parentConfig,child.config,explicit.config]);
    assert.equal((await f.tests.get(parent.id)).config.cliVersion,'older-cli');
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await f.cleanup();
  }
});

test('three refinement rounds retain prior feedback in order, prioritize explicit changes and freeze each prompt',async()=>{
  const submitted:string[]=[];
  const f=await fixture(async options=>{submitted.push(options.prompt);return {exitCode:0};});
  try {
    const base=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(base.id)).status==='completed');
    const requirements=['标题固定为48px，禁止修改导航。','保留标题和导航，增加插画的线条细节。','本轮将标题改为52px，其余要求继续保持。'];
    let parent=base;
    const originals=new Map<string,Buffer>();
    for(const requirement of requirements) {
      originals.set(parent.id,await readFile(path.join(f.tests.directory(parent.id),'run.json')));
      parent=await f.tests.refine(parent.id,requirement,config);
      await done(async()=>(await f.tests.get(parent.id)).status==='completed');
    }
    const final=await f.tests.get(parent.id), prompt=final.prompt;
    const positions=requirements.map(requirement=>prompt.indexOf(requirement));
    assert(positions.every(position=>position>=0));
    assert(positions[0]<positions[1] && positions[1]<positions[2]);
    assert(prompt.includes('已满足的要求继续保持'));
    assert(prompt.includes('本轮有明确变更时，本轮要求优先'));
    assert.equal(final.refinement!.feedback,requirements[2]);
    assert.equal(submitted.at(-1),prompt);
    assert.equal(await readFile(path.join(f.tests.directory(final.id),'prompt.txt'),'utf8'),prompt);
    assert.equal(JSON.parse(await readFile(path.join(f.tests.directory(final.id),'input.json'),'utf8')).prompt,prompt);
    for(const [id,bytes] of originals) assert.deepEqual(await readFile(path.join(f.tests.directory(id),'run.json')),bytes);
  } finally {await f.cleanup();}
});

test('refinement rejects cycles, missing history and unsafe ancestor IDs instead of dropping earlier requirements',async()=>{
  let calls=0;
  const f=await fixture(async()=>{calls++;return {exitCode:0};});
  try {
    const base=await f.tests.start(f.board.id,f.board.revision,png,config);
    await done(async()=>(await f.tests.get(base.id)).status==='completed');
    const child=await f.tests.refine(base.id,'标题固定48px',config);
    await done(async()=>(await f.tests.get(child.id)).status==='completed');
    const original=await f.tests.get(child.id), file=path.join(f.tests.directory(child.id),'run.json');
    for(const [parentTestId,message] of [[child.id,/循环/],['missing-history',/缺少父测试/],['../escape',/无效/]] as const) {
      const edited=JSON.stringify({...original,refinement:{...original.refinement,parentTestId}});
      await writeFile(file,edited);
      await assert.rejects(f.tests.refine(child.id,'细化插画',config),(error:Error & {status?:number})=>{
        assert.equal(error.status,409);assert.match(error.message,message);return true;
      });
      assert.equal(await readFile(file,'utf8'),edited);
    }
    assert.equal(calls,2);
    assert.equal((await f.tests.list()).length,2);
  } finally {await f.cleanup();}
});

test('rendered drafts are previewable during execution and after cancellation without final acceptance', async () => {
  let entered = false;
  const f = await fixture(async options => {
    assert.equal(options.parallelAgents, true);
    assert.match(options.prompt, /子代理并行处理独立任务/);
    entered = true;
    await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { exitCode: 1 };
  }, 10_000);
  const server = createServer(createPreviewApp(4193, f.tests));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const run = await f.tests.start(f.board.id, f.board.revision, png, config);
    await done(async () => entered);
    const url = `${origin}/feature-tests/runs/${run.id}/index.html`;
    assert.equal((await fetch(url)).status, 404, 'the copied baseline is not a generated draft');
    const cwd = f.tests.workDirectory(run.id);
    await writeFile(path.join(cwd, 'website/index.html'), '<h1>Stage draft</h1>');
    await writeFile(path.join(cwd, 'draft-preview.json'), JSON.stringify({ updatedAt: new Date().toISOString() }));
    const active = await f.tests.get(run.id);
    assert.equal(active.status, 'running');
    assert.equal(active.hasPreview, false);
    assert(active.draftPreview);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
    assert.equal(await response.text(), '<h1>Stage draft</h1>');
    await assert.rejects(f.tests.refine(run.id, 'Continue', config));
    const stopped = await f.tests.cancel(run.id);
    assert.equal(stopped.status, 'cancelled');
    assert.equal(stopped.hasPreview, false);
    assert(stopped.draftPreview);
    assert.equal((await fetch(url)).status, 200);
    await writeFile(path.join(cwd, 'private.txt'), 'private');
    await symlink(path.join(cwd, 'private.txt'), path.join(cwd, 'website/escape.txt'));
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(`${origin}/feature-tests/runs/${run.id}/..%2Fprivate.txt`)).status, 404);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await f.cleanup();
  }
});

test('source drafts stay out of selectable sources until final success', async () => {
  let entered = false;
  const f = await fixture(async options => {
    assert.equal(options.parallelAgents, true);
    await writeFile(path.join(options.cwd, 'website/index.html'), '<h1>Source draft</h1>');
    await writeFile(path.join(options.cwd, 'draft-preview.json'), JSON.stringify({ updatedAt: new Date().toISOString() }));
    entered = true;
    await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { exitCode: 1 };
  }, 10_000);
  try {
    const run = await f.tests.generateSource('A source draft', config);
    await done(async () => entered);
    assert((await f.tests.getSourceRun(run.id)).draftPreview);
    assert(!(await f.tests.listSources()).some(source => source.runId === run.id));
    const stopped = await f.tests.cancelSource(run.id);
    assert.equal(stopped.status, 'cancelled');
    assert(stopped.draftPreview);
    assert(!(await f.tests.listSources()).some(source => source.runId === run.id));
  } finally { await f.cleanup(); }
});
