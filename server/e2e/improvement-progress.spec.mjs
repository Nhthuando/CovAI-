import {test,expect} from '@playwright/test';
import {createServer} from '../../client/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
let server,url;
test.beforeAll(async()=>{
    server=await createServer({root:fileURLToPath(new URL('../../client',import.meta.url)),server:{host:'127.0.0.1',port:5183,strictPort:true},plugins:[{name:'improvement-fixture',configureServer(vite){vite.middlewares.use('/__progress',async(req,res)=>{
        const html=await vite.transformIndexHtml('/index.html','<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e-fixtures/improvement-progress.jsx"></script></body></html>');
        res.setHeader('Content-Type','text/html');res.end(html);
    });}}]});
    await server.listen();url='http://127.0.0.1:5183/__progress';
});
test.afterAll(async()=>server?.close());
test('remaining time counts down and reports an overrun without a fake zero',async({page})=>{
    await page.clock.install({time:new Date('2026-10-16T00:00:00Z')});
    await page.clock.pauseAt(new Date('2026-10-16T00:00:01Z'));await page.goto(url);
    await expect(page.getByLabel('Estimated time remaining')).toBeVisible();
    await expect(page.getByText('About 3–5 min left',{exact:true})).toBeVisible();
    await page.clock.fastForward(61000);
    await expect(page.getByText('About 2–4 min left',{exact:true})).toBeVisible();
    await page.clock.fastForward(245000);
    await expect(page.getByText('Taking longer than usual',{exact:true})).toBeVisible();
});
test('a timed-out job shows its real reason and frozen elapsed duration',async({page})=>{
    await page.clock.install();await page.goto(url+'?finished');
    await expect(page.getByText('The improvement reached its 20-minute time limit. Your tests are unchanged.',{exact:true})).toBeVisible();
    await expect(page.getByText('Elapsed: 20m 13s',{exact:true})).toBeVisible();
    await page.clock.fastForward(61000);
    await expect(page.getByText('Elapsed: 20m 13s',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
    await expect(page.getByText(/Source or tests changed/)).toHaveCount(0);
});
test('remaining time and usage fit mobile and desktop layouts',async({page},testInfo)=>{
    for(const width of [390,1440]){
        await page.setViewportSize({width,height:850});await page.goto(url);
        await expect(page.getByLabel('Estimated time remaining')).toBeVisible();
        await expect(page.getByText('Reported tokens',{exact:true})).not.toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        await page.screenshot({path:testInfo.outputPath(`remaining-${width}.png`),fullPage:true});
        await page.getByText('Details',{exact:true}).click();
        await expect(page.getByText('Reported tokens',{exact:true})).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    }
});
test('95% is automatic and partial gains do not claim the target was reached',async({page})=>{
    await page.goto(url+'?partial');
    await expect(page.getByText('Verified tests saved. Coverage increased.',{exact:true})).toBeVisible();
    await page.getByText('Details',{exact:true}).click();
    const goal=page.getByRole('region',{name:'Coverage target'});
    await expect(goal.getByText('Target: 95%',{exact:true})).toBeVisible();
    await expect(goal.getByText('90% milestone reached',{exact:true})).toBeVisible();
    await expect(goal.getByText('The AI request limit was reached.',{exact:true})).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await page.goto(url+'?reached');
    await page.getByText('Details',{exact:true}).click();
    await expect(page.getByText('95% target reached',{exact:true})).toBeVisible();
    await expect(page.getByText('Verified tests saved. Coverage reached the 95% target.',{exact:true})).toBeVisible();
});
test('setup failures stay concise and never claim AI deadline exhaustion or unmeasured coverage',async({page},testInfo)=>{
    for(const width of [390,1440]) {
        await page.setViewportSize({width,height:850});await page.goto(url+'?setup');
        await expect(page.getByRole('status')).toHaveText('Test setup failed');
        await expect(page.getByText('Elapsed: 1m 53s',{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
        await expect(page.getByText('Reported tokens',{exact:true})).toHaveCount(0);
        await expect(page.getByText(/time limit was reached|Measuring baseline|95% target not reached/)).toHaveCount(0);
        await page.screenshot({path:testInfo.outputPath(`setup-${width}.png`),fullPage:true});
        await page.getByText('Details',{exact:true}).click();
        await expect(page.getByText(/Disposable mysql did not become ready/)).toBeVisible();
        await expect(page.getByText('No AI requests were made.',{exact:true})).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    }
});
test('a required project credential remains actionable outside Details',async({page})=>{
    await page.goto(url+'?environment');
    await expect(page.getByRole('status')).toHaveText('Test configuration required');
    await expect(page.getByText('Set STRIPE_SECRET_KEY in server/.env.test to start the backend.',{exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'Coverage target'})).toHaveCount(0);
});
