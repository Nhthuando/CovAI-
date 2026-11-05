import assert from 'node:assert/strict';
import { chromium } from '../server/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Users/thuan/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  let requests = 0;
  await page.route('**/api/projects/hover-project/editor/line-history?*', async route => {
    requests++;
    const url = new URL(route.request().url());
    const line = Number(url.searchParams.get('line'));
    await new Promise(resolve => setTimeout(resolve,150));
    await route.fulfill({ json: { success:true,data:{line,source:'HUMAN_EDIT',actorName:'Fixture Developer',contentHash:'fixture',nearby:[{start:1,end:10,source:'HUMAN_EDIT',actorName:'Fixture Developer'}]} } });
  });
  await page.route('**/.evidence-review/hover-check.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hover fixture</title>'}));
  await page.goto('http://localhost:5173/.evidence-review/hover-check.html');
  await page.evaluate(async () => {
    localStorage.setItem('token','hover-fixture');
    const { registerLineHistoryHover } = await import('/src/lib/editor/registerLineHistoryHover.js');
    const model = { getVersionId:()=>1,getLineMaxColumn:()=>20 };
    const provider={queue:[],identity:{documentId:'doc',path:'a.js',generation:1},revision:1};
    let hover;
    registerLineHistoryHover({languages:{registerHoverProvider:(_,value)=>{hover=value;}},Range:class {}},{getModel:()=>model},
      {projectId:'hover-project',snapshotId:'snapshot',path:'a.js'},()=>provider);
    window.hoverFixture={provider,run:(line,token={isCancellationRequested:false})=>hover.provideHover(model,{lineNumber:line},token)};
  });
  const first = await page.evaluate(()=>window.hoverFixture.run(5));
  if(!first) console.log(JSON.stringify({requests,token:await page.evaluate(()=>localStorage.getItem('token')),url:page.url()}));
  assert(first.contents[0].value.includes('Fixture Developer'));
  const started=Date.now();
  await page.evaluate(()=>window.hoverFixture.run(6));
  const adjacentMs=Date.now()-started;
  assert.equal(requests,1,'Adjacent authored line must reuse the response');
  await page.evaluate(()=>Promise.all([window.hoverFixture.run(11),window.hoverFixture.run(11)]));
  assert.equal(requests,2,'Duplicate pending hover must share one request');
  await page.evaluate(()=>{window.hoverFixture.provider.revision=2;return window.hoverFixture.run(6);});
  assert.equal(requests,3,'New document revision must not reuse old attribution');
  await page.evaluate(()=>{localStorage.setItem('token','different-fixture');return window.hoverFixture.run(6);});
  assert.equal(requests,4,'Another account must not reuse cached attribution');
  const stale=await page.evaluate(async()=>{const request=window.hoverFixture.run(12);window.hoverFixture.provider.revision++;return request;});
  assert.equal(stale,null,'Stale in-flight response must not render');
  console.log(JSON.stringify({checks:'adjacent cache, pending deduplication, revision/account isolation, stale response: passed',adjacentMs,realDataChanged:false}));
} finally {await browser.close();}
