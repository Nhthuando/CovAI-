import {test,expect} from '@playwright/test';
import {createServer} from '../../client/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';

// Real production React components, with deterministic HTTP responses. No
// account, database, Redis, third-party AI call or imported project is modified.
let vite,url;
test.beforeAll(async()=>{
    const root=fileURLToPath(new URL('../../client',import.meta.url));
    vite=await createServer({root,server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_SOCKET_URL':JSON.stringify('http://127.0.0.1:9')},plugins:[{name:'automatic-system-test-entry',configureServer(server){server.middlewares.use('/__covai_automatic__',async(_req,res,next)=>{
        try {res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__covai_automatic__/index.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e-fixtures/system-dashboard.jsx"></script></body></html>'));}catch(error){next(error);}
    });}}]});
    await vite.listen();url=`http://127.0.0.1:${vite.httpServer.address().port}/__covai_automatic__?projectId=project&snapshotId=snapshot`;
});
test.afterAll(async()=>{await vite?.close();});

const report=(status='ready')=>({schemaVersion:1,ready:status==='ready',status:status==='ready'?'READY':'NEEDS_SETUP',workspaceRevision:0,sourceHash:'a'.repeat(64),setupHash:'b'.repeat(64),configured:false,candidateConfig:{frontend:{directory:'.'},backend:{directory:'.',healthPath:'/'},database:null,unified:true},packages:[{directory:'.',startScripts:['start']}],services:{frontend:'.',backend:'.',healthPath:'/',topology:'Unified application',database:'Not required',schema:null,redis:false},environment:status==='env'?[{name:'OPENAI_API_KEY',service:'OpenAI',required:true,status:'MISSING',envFile:'.env.test',sourceFiles:['index.js'],purpose:'OpenAI is initialized at startup.',guidance:'Use a sandbox value.'}]:[],docker:{status:status==='docker'?'UNAVAILABLE':'NOT_REQUIRED',required:status==='docker'},issues:status==='env'?[{code:'ENVIRONMENT_REQUIRED',message:'One startup variable needs a test value.'}]:status==='docker'?[{code:'DOCKER_REQUIRED',message:'Docker is unavailable on the execution worker.'}]:[],limitations:[]});
const installMock=async(page,{status='ready',imported=false}={})=>{
    const calls={runs:[],saved:[],setup:0,confirm:0,errors:[]};
    page.on('pageerror',error=>calls.errors.push(error.message));
    const token=`fixture.${Buffer.from(JSON.stringify({userId:'owner'})).toString('base64')}.fixture`;
    await page.addInitScript(value=>localStorage.setItem('token',value),token);
    await page.route('**/api/**',async route=>{
        const request=route.request(),path=new URL(request.url()).pathname;
        let data=null;
        if(path.endsWith('/access'))data={role:'OWNER',capabilities:['project.read','tests.run','ai.use','evidence.approve']};
        else if(path.endsWith('/system-test/frameworks'))data={totalFilesCount:imported?1:0,frameworks:[{name:'playwright'}],allTestFiles:imported?[{filePath:'tests/imported.spec.js'}]:[]};
        else if(path.endsWith('/setup')){calls.setup++;data=report(status);}
        else if(path.endsWith('/setup/environment')){calls.saved.push(request.postDataJSON());status='ready';data={saved:1};}
        else if(path.endsWith('/capabilities'))data={enabled:true,coverageEnabled:true};
        else if(path.endsWith('/assessments/history'))data={items:[],nextCursor:null};
        else if(path.endsWith('/assessments') && request.method()==='POST'){calls.runs.push(request.postDataJSON());data={jobId:'job',assessmentId:'assessment'};}
        else if(path.endsWith('/summary'))data={hasRun:false};
        else if(path.endsWith('/catalog/features'))data={features:[]};
        else if(path.endsWith('/catalog') || path.endsWith('/catalog/sync'))data={scenarios:imported?[{id:'scenario',scenarioKey:'key',filePath:'tests/imported.spec.js',title:'Imported draft',reviewState:'DRAFT',fullStackCompatible:true,flowJson:['Open page'],inputJson:[],expectedJson:['Page title is visible'],criterionIds:[],assertionHashes:[]}]:[]};
        else if(path.endsWith('/readiness'))data={ready:true,blockers:[]};
        else if(path.endsWith('/discovery'))data={testFiles:['tests/imported.spec.js'],runner:'playwright',executionMode:'full',repeatRuns:2,coverageScope:{frontend:{root:'.',sourceDirectory:'src'}}};
        else if(path.endsWith('/events'))data=[];
        else if(path.includes('/confirm-expected')){calls.confirm++;data={};}
        else if(path==='/api/job/job')return route.fulfill({json:{job:{id:'job',type:'SYSTEM_TEST_ASSESSMENT',status:'RUNNING',userId:'owner',logs:[],progress:10}}});
        await route.fulfill({json:{success:true,data}});
    });
    await page.goto(url);
    return calls;
};
test('starts an empty import automatically without a setup modal and guards duplicate clicks',async({page})=>{
    const calls=await installMock(page);
    const button=page.getByRole('button',{name:'Run automatically',exact:true});
    await expect(button).toBeEnabled();
    await button.evaluate(element=>{element.click();element.click();});
    await expect.poll(()=>calls.runs.length).toBe(1);
    expect(calls.runs[0]).toMatchObject({autoDiscover:true,allowGenerate:true,executionMode:'full'});
    expect(calls.setup).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.errors).toEqual([]);
});
test('asks for required env, accepts a masked sandbox value and resumes the pending run once',async({page})=>{
    const calls=await installMock(page,{status:'env'});
    await page.getByRole('button',{name:'Run automatically',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(calls.runs).toHaveLength(0);
    const input=page.getByLabel('Test value for OPENAI_API_KEY in .env.test');
    await expect(input).toHaveAttribute('type','password');
    await input.fill('sandbox-fixture-value');
    await page.screenshot({path:'../docs/assets/system-test-env-required-2026-11-07.png',fullPage:true});
    await page.getByRole('button',{name:'Save test environment',exact:true}).click();
    await expect.poll(()=>calls.runs.length).toBe(1);
    expect(calls.saved).toEqual([{expectedWorkspaceRevision:0,variables:[{envFile:'.env.test',name:'OPENAI_API_KEY',value:'sandbox-fixture-value'}]}]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.confirm).toBe(0);expect(calls.errors).toEqual([]);
});
test('reports infrastructure failure without asking for environment credentials',async({page})=>{
    const calls=await installMock(page,{status:'docker'});
    await page.getByRole('button',{name:'Run automatically',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Docker is unavailable');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.runs).toHaveLength(0);expect(calls.errors).toEqual([]);
});
test('executes selected imported drafts without sending a business confirmation',async({page})=>{
    const calls=await installMock(page,{imported:true});
    await expect(page.getByText('Imported draft',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'Run system tests',exact:true}).click();
    await expect.poll(()=>calls.runs.length).toBe(1);
    expect(calls.runs[0]).toMatchObject({reviewMode:'execution',scenarioIds:['scenario'],testFiles:['tests/imported.spec.js']});
    expect(calls.confirm).toBe(0);expect(calls.errors).toEqual([]);
});
