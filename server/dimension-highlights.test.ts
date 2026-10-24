import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DimensionHighlights, parseHighlights } from './dimension-highlights.ts';
import type { ComponentSnapshot, VisualComparison } from '../shared/types.ts';
import type { FileStore } from './store.ts';
import type { VisualComparisons } from './visual-comparison.ts';
const node = (id: string, signature: string): ComponentSnapshot => ({ id, signature, tag: 'svg', identity: 'hero-art', text: '', media: '<svg/>', appearance: '', box: { x: 100, y: 200, width: 300, height: 180 } });
const output = { highlights: [{ componentId: 'R1', baselineComponentId: 'B1', label: '引导插画放大', before: '小幅插画', after: '插画占据模块主视觉', rule: '扩大既有插画的视觉占比' }], note: '' };
test('semantic labels use real component geometry and reject fabricated IDs and retain media changes with unchanged DOM', () => {
  const parsed = parseHighlights(JSON.stringify(output), [node('B1','before')], [node('R1','after')]);
  assert.deepEqual(parsed.highlights[0].box, node('R1','after').box);
  assert.ok(parsed.highlights[0].baselineBox);
  // Image bytes or canvas contents can change without changing DOM/style signatures.
  assert.equal(parseHighlights(JSON.stringify(output), [node('B1','same')], [node('R1','same')]).highlights.length, 1);
  assert.throws(() => parseHighlights(JSON.stringify(output), [node('B1','before')], [node('unknown','after')]), /不存在/);
  assert.deepEqual(parseHighlights('{"highlights":[],"note":"无可靠证据"}', [], []).highlights, []);
});
test('dimension analysis uses only actual selected rules, separate model, ordered image attachments and cached jobs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dimension-highlights-'));
  const runDir = path.join(root, 'run'); const captures = path.join(root, 'captures');
  await mkdir(runDir); await mkdir(path.join(captures, 'v2-key'), { recursive: true });
  await writeFile(path.join(runDir, 'input.json'), JSON.stringify({ rules: [{ id:'media', title:'插画主导的媒体层级', scope:'既有插画', instructions:'扩大既有插画的视觉占比' }], config:{ model:'experiment-model' } }));
  await writeFile(path.join(captures, 'v2-key', 'components.json'), JSON.stringify({ baseline:[node('B1','before')],result:[node('R1','after')] }));
  const run = { id:'edit', groupId:'media', hasPreview:true, status:'completed', baselineHash:'base', artifactHash:'result' };
  const store = { root, runDir:()=>runDir, getRun: async()=>run, getVersion:async()=>({ generationConfig:{ model:'spec-model', reasoningEffort:'high', cliVersion:'fixture' } }) } as unknown as FileStore;
  const comparison = { baselineRunId:'base', baselineHash:'base',resultHash:'result',width:1440,height:1000,baselineUrl:'/v2-key/baseline.png',resultUrl:'/v2-key/result.png',capturedAt:new Date().toISOString() } as VisualComparison;
  const comparisons = { directory:()=>captures, get:async()=>comparison } as unknown as VisualComparisons;
  let calls=0;
  const service = new DimensionHighlights(store, comparisons, async options => {
    calls++;assert.equal(options.config.model,'spec-model');assert.equal(options.readOnly,true);
    assert.deepEqual(options.referenceFiles?.map(file=>path.basename(file)),['baseline.png','result.png']);
    assert.match(options.prompt,/插画主导的媒体层级/);assert.match(options.prompt,/不是|不罗列/);
    return { exitCode:0,summary:JSON.stringify(output),usage:{input_tokens:10} };
  });
  try {
    await Promise.all([service.start('edit'),service.start('edit')]);
    for(let i=0;i<100;i++){if((await service.get('edit'))?.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
    const job=await service.get('edit');assert.equal(job?.status,'completed');assert.equal(job?.highlights?.length,1);assert.equal(calls,1);
    await service.start('edit');assert.equal(calls,1);
    assert.deepEqual(JSON.parse(await readFile(path.join(runDir,'input.json'),'utf8')).rules[0].title,'插画主导的媒体层级');
    run.groupId='direct';await assert.rejects(service.start('edit'),/单维度/);
  } finally { await service.shutdown(); await rm(root,{recursive:true,force:true}); }
});
