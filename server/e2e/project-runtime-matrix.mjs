import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startAutServer,stopAutServer,resolveAvailableAutPort} from '../src/services/autLifecycle.service.js';
import {selectFrontendPackage} from '../src/services/projectRuntimePlan.service.js';

// Explicitly invoked integration matrix: downloads public packages through the
// managers declared by disposable fixtures; never edits imported projects.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(new URL('../.covai-temp/playwright-browsers',import.meta.url));
const {chromium}=await import('playwright');
const write=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const cases=[
    {name:'root-vite7-esm',app:'.',vite:'^7.2.2'},
    {name:'split-ui-vite8',app:'ui',vite:'^8.0.0'},
    {name:'nested-npm-workspace',app:'apps/storefront',vite:'^7.2.2',workspace:true},
    {name:'preview-requires-build',app:'.',vite:'^7.2.2',preview:true},
    {name:'node-commonjs-web-server',app:'.',node:true},
    {name:'pinned-pnpm',app:'.',vite:'^7.2.2',manager:'pnpm@10.0.0'},
    {name:'pinned-yarn-node-modules',app:'.',vite:'^7.2.2',manager:'yarn@4.0.0'},
    {name:'pinned-bun',app:'.',vite:'^7.2.2',manager:'bun@1.2.0'},
    {name:'next15-react19',app:'apps/portal',next:true},
    {name:'astro5',app:'site',astro:true},
    {name:'pnpm-nested-workspace',app:'apps/storefront',vite:'^7.2.2',workspace:true,manager:'pnpm@10.0.0'},
    {name:'yarn-nested-workspace',app:'apps/storefront',vite:'^7.2.2',workspace:true,manager:'yarn@4.0.0'},
    {name:'bun-nested-workspace',app:'apps/storefront',vite:'^7.2.2',workspace:true,manager:'bun@1.2.0'},
].filter(item=>!process.env.COVAI_RUNTIME_CASES || process.env.COVAI_RUNTIME_CASES.split(',').includes(item.name));
const browser=await chromium.launch({headless:true});
const results=[];
try {
    for(const item of cases) {
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-runtime-matrix-'));
        let aut,page;const started=Date.now();
        try {
            const app=path.join(root,item.app);
            if(item.workspace) {
                write(root,'package.json',{name:'matrix-root',private:true,...(item.manager?{packageManager:item.manager}:{}),...(!item.manager?.startsWith('pnpm')?{workspaces:['apps/*','packages/*']}: {})});
                if(item.manager?.startsWith('pnpm'))write(root,'pnpm-workspace.yaml',"packages: ['apps/*', 'packages/*']\n");
                write(root,'packages/shared/package.json',{name:'@covai-matrix/shared',version:'1.0.0',type:'module',exports:'./index.js'});
                write(root,'packages/shared/index.js','export const step=2;');
            } else if(item.app!=='.')write(root,'package.json',{name:'matrix-root',private:true,scripts:{test:'echo source aggregator'}});
            if(item.next) {
                write(app,'package.json',{name:item.name,private:true,scripts:{dev:'next dev'},dependencies:{next:'^15.5.0',react:'^19.1.0','react-dom':'^19.1.0'}});
                write(app,'app/layout.jsx','export default function Layout({children}){return <html lang="en"><body>{children}</body></html>;}');
                write(app,'app/page.jsx',"'use client';import{useState}from'react';export default function Page(){const[value,setValue]=useState(0);return <><h1>Runtime matrix</h1><button onClick={()=>setValue(value+1)}>{value}</button></>;}");
            } else if(item.astro) {
                write(app,'package.json',{name:item.name,private:true,type:'module',scripts:{dev:'astro dev'},dependencies:{astro:'^5.0.0'}});
                write(app,'src/pages/index.astro','<html lang="en"><body><h1>Runtime matrix</h1><button>0</button><script>document.querySelector("button")!.onclick=event=>{(event.target as HTMLButtonElement).textContent="1";};</script></body></html>');
            } else if(item.node) {
                write(app,'package.json',{name:item.name,scripts:{start:'node app.cjs'}});
                write(app,'app.cjs',`require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Runtime matrix</h1><button onclick="this.textContent=Number(this.textContent)+1">0</button>');}).listen(Number(process.env.PORT),'127.0.0.1');`);
            } else {
                write(app,'package.json',{name:item.name,private:true,type:'module',...(item.manager?{packageManager:item.manager}:{}),scripts:item.preview?{build:'vite build',preview:'vite preview'}:{dev:'vite'},devDependencies:{vite:item.vite},...(item.workspace?{dependencies:{'@covai-matrix/shared':item.manager?'workspace:*':'*'}}:{})});
                write(app,'vite.config.js',"import {defineConfig} from 'vite';export default defineConfig({});");
                write(app,'index.html','<html><body><h1>Runtime matrix</h1><button>0</button><script type="module" src="/main.js"></script></body></html>');
                write(app,'main.js',`${item.workspace?"import {step} from '@covai-matrix/shared';":"const step=1;"}document.querySelector('button').onclick=event=>{event.target.textContent=Number(event.target.textContent)+step;};`);
            }
            const selected=selectFrontendPackage({rootDir:root});assert.equal(selected,app);
            const port=await resolveAvailableAutPort(app,4400);
            console.log('MATRIX_START',item.name);
            aut=await startAutServer({snapshotDir:selected,repositoryRoot:root,port,requireHealthy:true,healthTimeoutMs:60000});
            assert.equal(aut.started,true);
            page=await browser.newPage();
            await page.goto(`http://127.0.0.1:${port}`);
            assert.equal(await page.getByRole('heading').innerText(),'Runtime matrix');
            await page.getByRole('button',{name:'0',exact:true}).click();
            await page.getByRole('button',{name:item.workspace?'2':'1',exact:true}).waitFor();
            results.push({name:item.name,status:'PASSED',durationMs:Date.now()-started});
        } catch(error) {
            results.push({name:item.name,status:'FAILED',durationMs:Date.now()-started,message:String(error.message).slice(0,1000)});
        } finally {
            await page?.close();
            if(aut?.started)await stopAutServer(aut.pid,aut.port);
            const real=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
            assert.ok(!path.relative(base,real).startsWith('..')&&path.basename(real).startsWith('covai-runtime-matrix-'));
            fs.rmSync(real,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
        console.log('MATRIX_RESULT',JSON.stringify(results.at(-1)));
    }
} finally {await browser.close();}
console.log('MATRIX_SUMMARY',JSON.stringify(results));
if(results.some(result=>result.status!=='PASSED'))process.exitCode=1;
