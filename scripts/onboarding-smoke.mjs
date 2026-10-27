// Read-only browser regression suite against a running local server.
// Usage: node scripts/onboarding-smoke.mjs [http://127.0.0.1:4293]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'http://127.0.0.1:4293';
const output = '.test-data/onboarding-qa';
await mkdir(output, { recursive: true });
const demo = JSON.parse(await readFile('resources/onboarding/v1/demo.json', 'utf8'));
const sources = await (await fetch(`${origin}/api/feature-tests/sources`)).json();
const savedBoard = { ...structuredClone(demo.board), id: 'saved-board', title: '我的原工作区' };
savedBoard.cards[0].selected = false;
const savedRun = {id:'saved-test',boardId:savedBoard.id,boardRevision:1,board:savedBoard,source:sources[0],config:savedBoard.config,prompt:'保存的历史指令',imageHash:'saved-image',status:'completed',createdAt:savedBoard.createdAt,hasPreview:false};
const browser = await chromium.launch({ executablePath: process.env.DEFINE_PRETTY_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const checks = [], failures = [];
const mark = text => { checks.push(text); console.log(`✓ ${text}`); };

async function setup({ existing = false, seen = false, mobile = false, reduced = false, denied = false, activity = {busy:false}, unavailable = {value:false} } = {}) {
  const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, reducedMotion: reduced ? 'reduce' : 'no-preference', permissions:['clipboard-read','clipboard-write'] });
  const writes = [], requests = [], page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if(response.status()>=400 && /\/onboarding\/v1\//.test(response.url()))failures.push(`Missing sample asset: ${response.url()}`); });
  await context.addInitScript(({seen,existing,source,denied}) => {
    if(window.top !== window)return;
    if(seen)localStorage.setItem('define-pretty-onboarding-v1','seen');
    if(existing) {
      localStorage.setItem('define-pretty-feature-board','saved-board');
      localStorage.setItem('pretty-source-id',source);
      localStorage.setItem('pretty-source-requirements','保留我的网页需求草稿');
    }
    if(denied)Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Clipboard unavailable'))}});
  }, {seen,existing,source:sources[0].runId,denied});
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(url.pathname + url.search);
    if(!['GET','HEAD','OPTIONS'].includes(request.method())) { writes.push(request.url()); await route.abort(); return; }
    if(url.pathname === '/api/bootstrap') {
      const response = await route.fetch(), body = await response.json(); body.runtime.authenticated=false; body.runtime.codexAvailable=false;
      await route.fulfill({response,json:body}); return;
    }
    if(url.pathname === '/api/onboarding-availability') {await route.fulfill({json:activity});return;}
    if(url.pathname === '/api/feature-boards') {await route.fulfill({json:existing?[savedBoard]:[]});return;}
    if(url.pathname === '/api/feature-tests') {await route.fulfill({json:existing?[savedRun]:[]});return;}
    if(url.pathname === '/api/feature-tests/saved-test/image') {await route.fulfill({contentType:'image/jpeg',body:await readFile('resources/onboarding/v1/reference.jpg')});return;}
    if(url.pathname === '/api/onboarding-demo' && unavailable.value) {await route.fulfill({status:503,json:{error:'示例暂不可用'}});return;}
    await route.continue();
  });
  await page.goto(origin);
  return {context,page,writes,requests};
}
const stage = (page, text) => page.locator('.onboarding-tip h2').filter({hasText:text}).waitFor();
const target = (page, id) => page.locator(`[data-tour="${id}"]`);
const next = page => page.locator('.onboarding-tip').getByRole('button',{name:'下一步',exact:true}).click();
async function reach(page, where, {copy=false}={}) {
  await stage(page,'从一张喜欢的图开始'); if(where==='upload')return;
  await target(page,'upload').click(); await stage(page,'这里是你的参考图'); if(where==='reference')return;
  await next(page); await stage(page,'把设计变成可选项'); if(where==='extract')return;
  await target(page,'extract').click(); if(where==='extracting'){await stage(page,'正在展示提炼过程');return;}
  await stage(page,'只带走你喜欢的设计'); if(where==='select')return;
  await next(page); await stage(page,'看看用在网页上的效果'); if(where==='validate')return;
  await target(page,'validate').click(); if(where==='validating'){await stage(page,'正在展示优化过程');return;}
  await stage(page,'从喜欢的风格'); if(where==='result')return;
  await next(page); await stage(page,'把设计参考带走'); if(where==='export')return;
  await target(page,'export').click(); await stage(page,'最后，带上配套指令');
  if(copy)await target(page,'copy').click();
}
async function assertLayout(page, interactive) {
  const g = await page.evaluate(() => {
    const tip=document.querySelector('.onboarding-tip').getBoundingClientRect(), ring=document.querySelector('.onboarding-highlight').getBoundingClientRect();
    return {tip:{left:tip.left,top:tip.top,right:tip.right,bottom:tip.bottom},ring:{left:ring.left,top:ring.top,right:ring.right,bottom:ring.bottom},width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert(g.tip.left >= 0 && g.tip.top >= 0 && g.tip.right <= g.width+1 && g.tip.bottom <= g.height+1, JSON.stringify(g));
  assert(!g.overflow,'Unexpected horizontal page overflow');
  if(interactive)assert(g.tip.right <= g.ring.left || g.tip.left >= g.ring.right || g.tip.bottom <= g.ring.top || g.tip.top >= g.ring.bottom,'Tooltip covers its interactive target');
}

try {
  const s = await setup(); const {page} = s; let filePickers=0; page.on('filechooser',()=>filePickers++);
  await stage(page,'从一张喜欢的图开始'); await assertLayout(page,true);
  await page.screenshot({path:`${output}/desktop-upload.png`});
  await reach(page,'select');
  assert.equal(await page.locator('.feature-card input:checked').count(),8);
  await assertLayout(page,true); await page.screenshot({path:`${output}/desktop-selection.png`});
  await target(page,'select').uncheck(); assert.equal(await page.locator('.feature-card input:checked').count(),7);
  await target(page,'select').check(); await target(page,'select').uncheck();
  await page.keyboard.press('Tab'); assert(await page.evaluate(()=>!!document.activeElement.closest('.onboarding-tip')));
  await next(page); assert.equal(await page.locator('.feature-card input:checked').count(),8);
  await target(page,'validate').click(); await stage(page,'从喜欢的风格');
  await page.frameLocator('iframe[title="优化后的网页"]').getByRole('heading',{name:'记录每一份灵感， 发现无限可能'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-tour="result"]').getBoundingClientRect().top < 200);
  await assertLayout(page,false);
  await page.screenshot({path:`${output}/desktop-comparison.png`});
  await next(page); await target(page,'export').click(); await stage(page,'最后，带上配套指令');
  await page.getByAltText('仅包含已选特征的视觉总览图').evaluate(image=>image.decode());
  await assertLayout(page,true); await page.screenshot({path:`${output}/desktop-export.png`});
  await page.getByRole('button',{name:'完成，开始使用'}).click();
  await page.locator('.onboarding-guide').waitFor({state:'detached'});
  assert.equal(await page.locator('.feature-card').count(),0); assert.equal(filePickers,0); assert.deepEqual(s.writes,[]);
  assert(!s.requests.some(url=>url.includes('boardId=onboarding-v1')));
  await page.reload(); await page.getByRole('button',{name:'使用指引',exact:true}).waitFor();
  assert.equal(await page.locator('.onboarding-guide').count(),0);
  await s.context.close(); mark('Fresh unauthenticated user completes without file pickers, writes, copy or downloads; cards are selected and reset before validation.');

  for (const where of ['upload','reference','extract','extracting','select','validate','validating','result','export','copy']) {
    const test = await setup({existing:true,seen:true});
    await test.page.getByRole('button',{name:'使用指引',exact:true}).click(); await reach(test.page,where);
    await test.page.keyboard.press('Escape'); await test.page.locator('.onboarding-guide').waitFor({state:'detached'});
    await test.page.waitForTimeout(1300); // Cancelled timers must not later replace the restored board.
    assert.equal(await test.page.getByRole('combobox',{name:'选择特征板'}).inputValue(),'saved-board');
    assert.equal(await test.page.locator('.feature-card input:checked').count(),7);
    assert.equal(await test.page.locator('.feature-test-history select').inputValue(),'saved-test');
    assert.equal(await test.page.evaluate(()=>localStorage.getItem('pretty-source-requirements')),'保留我的网页需求草稿');
    assert.equal(await test.page.getByRole('dialog').count(),0); assert.deepEqual(test.writes,[]); await test.context.close();
  }
  mark('Escape from every step preserves saved cards, history and drafts; cancelled animations stay cancelled.');

  const denied = await setup({seen:true,denied:true,reduced:true});
  await denied.page.getByRole('button',{name:'使用指引',exact:true}).click(); await reach(denied.page,'copy',{copy:true});
  assert((await denied.page.getByRole('textbox',{name:'手动复制配套指令'}).inputValue()).includes('炭黑短笔触'));
  await denied.page.getByRole('textbox',{name:'手动复制配套指令'}).click(); await denied.page.getByRole('button',{name:'完成，开始使用'}).click();
  assert.deepEqual(denied.writes,[]); await denied.context.close(); mark('Reduced motion skips animations; blocked clipboard offers manual copy without blocking completion.');

  const copy = await setup({seen:true,reduced:true});
  await copy.page.getByRole('button',{name:'使用指引',exact:true}).click(); await reach(copy.page,'copy',{copy:true});
  assert((await copy.page.evaluate(()=>navigator.clipboard.readText())).includes('炭黑短笔触'));
  const download = copy.page.waitForEvent('download'); await copy.page.getByRole('link',{name:'下载总览 PNG',exact:true}).click();
  assert.equal(await (await download).failure(),null);
  await copy.page.getByRole('button',{name:'跳过使用指引'}).click(); await copy.context.close(); mark('Actual PNG download and instruction clipboard copy work.');

  const unavailable={value:true}; const retry=await setup({unavailable});
  await target(retry.page,'upload').click(); await retry.page.getByRole('alert').filter({hasText:'示例暂不可用'}).waitFor();
  unavailable.value=false; await retry.page.getByRole('button',{name:'重试',exact:true}).click(); await stage(retry.page,'这里是你的参考图');
  await retry.page.getByRole('button',{name:'跳过使用指引'}).click(); assert.deepEqual(retry.writes,[]); await retry.context.close(); mark('Missing samples show retry/skip and never invoke real generation.');

  const activity={busy:true}; const deferred=await setup({activity});
  await deferred.page.waitForResponse(response=>response.url().endsWith('/api/onboarding-availability'));
  assert.equal(await deferred.page.locator('.onboarding-guide').count(),0); assert(await deferred.page.getByRole('button',{name:'使用指引',exact:true}).isDisabled());
  activity.busy=false; await stage(deferred.page,'从一张喜欢的图开始');
  await deferred.page.getByRole('button',{name:'跳过使用指引'}).click(); await deferred.page.getByRole('button',{name:'生成设置',exact:true}).click();
  assert(await deferred.page.getByRole('button',{name:'使用指引',exact:true}).isDisabled());
  await deferred.page.keyboard.press('Escape'); await deferred.context.close(); mark('Running tasks defer entry; active dialogs disable replay.');

  const mobile=await setup({mobile:true,reduced:true});
  for (const where of ['upload','reference','extract','select','validate','result','export','copy']) {
    if(where==='upload')await stage(mobile.page,'从一张喜欢的图开始');
    if(where==='reference'){await target(mobile.page,'upload').click();await stage(mobile.page,'这里是你的参考图');}
    if(where==='extract'){await next(mobile.page);await stage(mobile.page,'把设计变成可选项');}
    if(where==='select'){await target(mobile.page,'extract').click();await stage(mobile.page,'只带走你喜欢的设计');}
    if(where==='validate'){await next(mobile.page);await stage(mobile.page,'看看用在网页上的效果');}
    if(where==='result'){await target(mobile.page,'validate').click();await stage(mobile.page,'从喜欢的风格');}
    if(where==='export'){await next(mobile.page);await stage(mobile.page,'把设计参考带走');}
    if(where==='copy'){await target(mobile.page,'export').click();await stage(mobile.page,'最后，带上配套指令');}
    await assertLayout(mobile.page,!['reference','result'].includes(where)); await mobile.page.screenshot({path:`${output}/mobile-${where}.png`});
  }
  await mobile.page.getByRole('button',{name:'完成，开始使用'}).click(); assert.deepEqual(mobile.writes,[]); await mobile.context.close(); mark('390 px layout completes every step with unobstructed interactive targets and no horizontal overflow.');
  assert.deepEqual(failures,[]); await writeFile(`${output}/checks.json`,JSON.stringify({checks,failures},null,2));
} finally { await browser.close(); }
