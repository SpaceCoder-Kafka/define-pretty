import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FeatureTests } from './feature-tests.ts';
import { FeatureBoards } from './feature-boards.ts';
import { FileStore } from './store.ts';
import { hashWebsite, type Executor } from './codex.ts';
import { featureInstruction } from '../shared/feature-board.ts';
import { parseLayoutDiagram } from '../shared/layout-diagram.ts';
import type { PaletteSpec } from '../shared/feature-spec.ts';
import { builtinSourceCatalog, builtinWebsiteRoot } from './builtin-sources.ts';
import { createApp, createPreviewApp } from './http.ts';
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
test('selected palette parameters reach one implementation call with priority and no unselected specs or layout authority', async () => {
  const palette: PaletteSpec = { kind: 'palette', basis: '页面区域观察估计', colors: [
    { role: 'page-background', label: '纸面', hex: '#FAF9F3', usage: '整页内容底色', areaPercent: 80, evidence: 'estimated' },
    { role: 'text-primary', label: '主要文字', hex: '#222222', usage: '标题与正文', areaPercent: null, evidence: 'estimated' },
  ] };
  let calls = 0;
  const f = await fixture(async options => {
    calls++;
    assert(options.prompt.includes(JSON.stringify(palette)));
    assert.match(options.prompt, /一级基础规范 > 二级辨识特征 > 三级精细细节/);
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
      assert.deepEqual(await readFile(options.referenceFile!),png);
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
