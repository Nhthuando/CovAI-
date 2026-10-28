import {test,expect} from '@playwright/test';
import {createServer} from '../../client/node_modules/vite/dist/node/index.js';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import prisma from '../src/config/prisma.js';

// Explicit opt-in to an owned, existing local verification snapshot. No AI calls,
// source changes or test runs are submitted by these dashboard regression tests.
const jobId=process.env.COVAI_E2E_JOB_ID;
const api=process.env.COVAI_E2E_API || 'http://127.0.0.1:5000/api';
let vite,url,token,snapshotId,scenarios;
const pageErrors=new WeakMap();
const headers=()=>({Authorization:`Bearer ${token}`});
const png=Buffer.from([137,80,78,71,13,10,26,10]);

test.beforeAll(async()=>{
    if(!jobId) throw new Error('Set COVAI_E2E_JOB_ID to an owned local completed improvement job.');
    const job=await prisma.job.findUnique({where:{id:jobId},select:{userId:true,snapshotId:true,projectId:true}});
    if(!job) throw new Error('Configured verification job does not exist');
    const snapshot=await prisma.projectSnapshot.findFirst({where:{id:job.snapshotId,project:{ownerId:job.userId}}});
    if(!snapshot) throw new Error('Configured snapshot does not belong to the verification job owner');
    snapshotId=snapshot.id;
    const run=await prisma.testRun.findFirst({where:{snapshotId,type:'PLAYWRIGHT',executionMode:'full'},orderBy:{createdAt:'desc'},include:{scenarios:true}});
    if(!run?.scenarios.length || run.scenarios.some(item=>!item.screenshotPath)) throw new Error('Verification requires a saved Full Stack run with screenshots');
    scenarios=run.scenarios;
    token=jwt.sign({userId:job.userId},process.env.JWT_SECRET,{expiresIn:'15m'});
    const root=fileURLToPath(new URL('../../client',import.meta.url));
    vite=await createServer({root,server:{host:'127.0.0.1',port:5182,strictPort:true,proxy:{'/api':{target:new URL(api).origin,changeOrigin:true},'/socket.io':{target:new URL(api).origin,ws:true,changeOrigin:true}}},define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_SOCKET_URL':JSON.stringify('http://127.0.0.1:5182')},plugins:[{
        name:'covai-e2e-dashboard-entry',configureServer(server){server.middlewares.use('/__covai_e2e__',async(_req,res,next)=>{
            try {
                const html=await server.transformIndexHtml('/__covai_e2e__/index.html','<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>CovAI dashboard regression</title></head><body><div id="root"></div><script type="module" src="/e2e-fixtures/system-dashboard.jsx"></script></body></html>');
                res.setHeader('Content-Type','text/html');res.end(html);
            } catch(error){next(error);}
        });},
    }]});
    await vite.listen();
    url=`http://127.0.0.1:5182/__covai_e2e__?projectId=${job.projectId}&snapshotId=${snapshotId}`;
});
test.afterAll(async()=>{await vite?.close();await prisma.$disconnect();});
test.beforeEach(async({page})=>{
    const errors=[];pageErrors.set(page,errors);
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(value=>localStorage.setItem('token',value),token);
});
test.afterEach(async({page})=>{expect(pageErrors.get(page) || []).toEqual([]);});
const openDashboard=async page=>{
    await page.goto(url);
    await page.getByRole('combobox',{name:'System test execution mode'}).selectOption('full');
    await expect(page.getByPlaceholder('Search scenarios or files...')).toBeVisible();
};
const checkImage=async(page,scenario)=>{
    await page.getByText(scenario.title,{exact:true}).first().scrollIntoViewIfNeeded();
    const image=page.getByAltText(`Screenshot: ${scenario.title}`,{exact:true}).first();
    await expect(image).toBeVisible();
    await expect.poll(()=>image.evaluate(element=>element.complete && element.naturalWidth>0)).toBe(true);
    return image;
};

test('real authenticated API serves every saved PNG and enforces ownership',async({request})=>{
    for(const scenario of scenarios){
        const endpoint=`${api}/coverage/${snapshotId}/system/scenarios/${scenario.id}/evidence?type=screenshot`;
        const response=await request.get(endpoint,{headers:headers()});
        expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/png');
        expect((await response.body()).subarray(0,8).equals(png)).toBe(true);
    }
    const endpoint=`${api}/coverage/${snapshotId}/system/scenarios/${scenarios[0].id}/evidence?type=screenshot`;
    expect((await request.get(endpoint)).status()).toBe(401);
    const unrelated=jwt.sign({userId:'covai-e2e-unrelated-owner'},process.env.JWT_SECRET,{expiresIn:'5m'});
    expect((await request.get(endpoint,{headers:{Authorization:`Bearer ${unrelated}`}})).status()).toBe(404);
});

test('full dashboard stays mounted during slow refresh; screenshots and filters survive',async({page})=>{
    let discoveries=0,completedDiscoveries=0;
    page.on('response',response=>{if(response.url().includes('/system-test/frameworks?')&&response.ok())completedDiscoveries++;});
    await page.route('**/system-test/frameworks?*',async route=>{discoveries++;if(discoveries>1)await new Promise(resolve=>setTimeout(resolve,600));await route.continue();});
    await openDashboard(page);
    await expect(page.getByText('Verified tests saved. Coverage increased.',{exact:true})).toBeVisible();
    // One initial discovery plus one legitimate completion refresh, never a loop.
    await expect.poll(()=>completedDiscoveries).toBe(2);
    for(const scenario of scenarios)await checkImage(page,scenario);
    const search=page.getByPlaceholder('Search scenarios or files...');
    const searchTerm=(scenarios.find(item=>/edit/i.test(item.title)) || scenarios[0]).title;
    await search.fill(searchTerm);
    const edits=scenarios.filter(item=>item.title.includes(searchTerm));
    expect(edits.length).toBeGreaterThan(0);
    const image=await checkImage(page,edits[0]);
    const imageUrl=await image.getAttribute('src');
    await page.evaluate(()=>{
        window.__discoveryFlashes=0;
        window.__dashboardObserver=new MutationObserver(()=>{if(document.body.textContent.includes('Checking for system test files...'))window.__discoveryFlashes++;});
        window.__dashboardObserver.observe(document.body,{childList:true,subtree:true});
    });
    const refresh=page.getByTitle('Refresh dashboard data');
    for(let i=0;i<3;i++){
        const done=page.waitForResponse(response=>response.url().includes('/system-test/frameworks?')&&response.ok());
        await refresh.click();await done;
        await expect(search).toHaveValue(searchTerm);
        await expect(image).toHaveAttribute('src',imageUrl);
    }
    // Observe longer than the 10s status poll period: this is a bounded negative
    // stability assertion, not a sleep used to wait for page readiness.
    const before=discoveries;
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,11000)));
    expect(await page.evaluate(()=>window.__discoveryFlashes)).toBe(0);
    expect(discoveries).toBe(before);
    await expect(search).toHaveValue(searchTerm);
    await page.screenshot({path:path.resolve('../tmp/dashboard-stable-evidence.png'),fullPage:true});
});

test('evidence enlarges, report renders PNGs, and navigation restores the full run',async({page})=>{
    await openDashboard(page);
    const scenario=scenarios[0];await checkImage(page,scenario);
    await page.getByRole('button',{name:`Enlarge screenshot for ${scenario.title}`,exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await expect.poll(()=>dialog.locator('img').evaluateAll(images=>images.some(image=>image.complete&&image.naturalWidth>0))).toBe(true);
    await page.getByRole('button',{name:'Close evidence',exact:true}).click();
    await page.getByRole('button',{name:'Export / Print Report'}).click();
    await checkImage(page,scenario);
    await page.getByRole('button',{name:'Leave test dashboard'}).click();
    await page.getByRole('button',{name:'Return to test dashboard'}).click();
    await page.getByRole('combobox',{name:'System test execution mode'}).selectOption('full');
    await checkImage(page,scenario);
    await page.reload();
    await page.getByRole('combobox',{name:'System test execution mode'}).selectOption('full');
    await checkImage(page,scenario);
});

test('a failed evidence download offers retry and recovers without reloading the dashboard',async({page})=>{
    const scenario=scenarios[0];let failed=false;
    await page.route(`**/scenarios/${scenario.id}/evidence?type=screenshot`,async route=>{
        if(!failed){failed=true;await route.fulfill({status:503,contentType:'application/json',body:'{}'});}else await route.continue();
    });
    await openDashboard(page);
    await page.getByText(scenario.title,{exact:true}).first().scrollIntoViewIfNeeded();
    const figure=page.locator('figure').filter({has:page.getByRole('button',{name:'Retry screenshot'})});
    await expect(figure.getByText('Screenshot unavailable. The evidence file could not be loaded.')).toBeVisible();
    await figure.getByRole('button',{name:'Retry screenshot'}).click();
    await checkImage(page,scenario);
    await page.setViewportSize({width:390,height:844});
    await checkImage(page,scenario);
    const size=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
    expect(size.width).toBe(size.viewport);
    await page.screenshot({path:path.resolve('../tmp/dashboard-evidence-mobile.png'),fullPage:true});
});
