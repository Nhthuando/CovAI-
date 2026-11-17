import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,jest} from '@jest/globals';
import {inspectSystemSetup,systemSetupConfig,saveSystemTestEnvironment} from '../services/systemSetupPreflight.service.js';
import {parse as parseEnvironment} from 'dotenv';
import {systemTestEnvironmentDirectory} from '../services/systemTestEnvironmentRoot.service.js';
import {createSystemSetupControllers} from '../controllers/systemSetup.controller.js';

const write=(root,name,content)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);};
const fixture=()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-preflight-'));
    write(root,'client/package.json',JSON.stringify({scripts:{dev:'vite'},dependencies:{vite:'1'}}));
    write(root,'client/src/main.js','const analytics = import.meta.env.VITE_ANALYTICS_KEY;');
    write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'1',stripe:'1',openai:'1'}}));
    write(root,'server/index.js',"import Stripe from 'stripe';import OpenAI from 'openai';const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);app.get('/health',(req,res)=>res.send('ok'));app.post('/ai',()=>new OpenAI({apiKey:process.env.AI_API_KEY}));");
    return root;
};
const dependencies={checkDocker:async required=>({status:required?'AVAILABLE':'NOT_REQUIRED',required})};

it('explains missing setup and startup credentials, without treating lazy integrations as startup blockers',async()=>{
    const root=fixture();
    try {
        const result=await inspectSystemSetup({rootDir:root,dependencies});
        expect(result.ready).toBe(false);expect(result.candidateConfig.database).toBeNull();
        expect(result.environment.find(row=>row.name==='STRIPE_SECRET_KEY')).toMatchObject({status:'MISSING',required:true,envFile:'server/.env.test',service:'Stripe'});
        expect(result.environment.find(row=>row.name==='AI_API_KEY')).toMatchObject({status:'MAY_BE_NEEDED',required:false,service:'OpenAI'});
        expect(result.environment.find(row=>row.name==='VITE_ANALYTICS_KEY').envFile).toBe('client/.env.test');
        write(root,'.covai/system-test.json',JSON.stringify(result.candidateConfig));
        write(root,'server/.env','AI_API_KEY=production-value-not-for-tests');
        write(root,'server/.env.test','STRIPE_SECRET_KEY=private-test-value-not-for-response');
        const checked=await inspectSystemSetup({rootDir:root,dependencies});
        expect(checked.ready).toBe(true);
        expect(checked.environment.find(row=>row.name==='STRIPE_SECRET_KEY').status).toBe('PRESENT');
        expect(checked.environment.find(row=>row.name==='AI_API_KEY').status).toBe('MAY_BE_NEEDED');
        expect(JSON.stringify(checked)).not.toContain('private-test-value');expect(JSON.stringify(checked)).not.toContain('production-value');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('checks Docker only for required local services and reports unsupported stacks honestly',async()=>{
    const root=fixture(),other=fs.mkdtempSync(path.join(os.tmpdir(),'covai-unsupported-'));
    try {
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'1',mysql2:'1'}}));
        write(root,'server/schema.sql','CREATE TABLE records(id INT PRIMARY KEY);');
        const probe=jest.fn(async required=>({status:required?'UNAVAILABLE':'NOT_REQUIRED',required,message:'Start Docker Desktop.'}));
        const result=await inspectSystemSetup({rootDir:root,dependencies:{checkDocker:probe}});
        expect(probe).toHaveBeenCalledWith(true);expect(result.issues.some(row=>row.code==='DOCKER_REQUIRED')).toBe(true);
        const unsupported=await inspectSystemSetup({rootDir:other,dependencies});
        expect(unsupported.status).toBe('UNSUPPORTED');expect(unsupported.docker.status).toBe('NOT_CHECKED');
    }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});}
});
it('auto-detects unambiguous full-stack SQL projects with inline queries and ignores test-runner config variables',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-todo-'));
    try {
        write(root,'client/package.json',JSON.stringify({scripts:{dev:'vite'},dependencies:{vite:'1',react:'18'}}));
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'1',mysql2:'1'}}));
        write(root,'server/index.js',"import express from 'express';import mysql from 'mysql2/promise';const app=express();const pool=mysql.createPool({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});app.get('/api/todos',async(_req,res)=>{const [rows]=await pool.query('SELECT * FROM todos ORDER BY created_at DESC');res.json(rows);});app.listen(process.env.PORT||5000);");
        write(root,'server/playwright.config.mjs','export default { use: { baseURL: process.env.AUT_URL }, forbidOnly: !!process.env.CI };');
        const result=await inspectSystemSetup({rootDir:root,dependencies});
        expect(result.ready).toBe(true);
        expect(result.status).toBe('READY');
        expect(result.candidateConfig).toMatchObject({
            frontend:{directory:'client'},
            backend:{directory:'server',healthPath:'/api/todos'},
            database:{engine:'mysql',initSql:'.covai/generated-schema.sql'}
        });
        expect(result.environment.every(row=>row.status==='MANAGED')).toBe(true);
        expect(result.environment.some(row=>row.name==='AUT_URL'||row.name==='CI')).toBe(false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('resolves operation env paths only into the owned original and rejects secret fields in setup JSON',()=>{
    const root=fixture();
    try {
        const copy=path.join(root,'copy');fs.mkdirSync(copy);
        expect(systemTestEnvironmentDirectory(path.join(copy,'server'),{rootDir:copy,originalRootDir:root})).toBe(path.join(root,'server'));
        const unrelated=path.join(root,'unrelated');expect(systemTestEnvironmentDirectory(unrelated,{rootDir:copy,originalRootDir:root})).toBe(unrelated);
        expect(systemSetupConfig.safeParse({frontend:{directory:'../outside'},backend:{directory:'server',healthPath:'/'},database:null}).success).toBe(false);
        expect(systemSetupConfig.safeParse({frontend:{directory:'client'},backend:{directory:'server',healthPath:'/'},database:null,apiKey:'do-not-store'}).success).toBe(false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('denies a foreign snapshot before inspecting files or probing Docker',async()=>{
    const probe=jest.fn(),db={projectSnapshot:{findFirst:jest.fn(async()=>null)}};
    const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
    await createSystemSetupControllers({db,dependencies:{checkDocker:probe}}).inspect({user:{id:'foreign'},params:{snapshotId:'snapshot'}},res);
    expect(res.status).toHaveBeenCalledWith(404);expect(probe).not.toHaveBeenCalled();
});
it('does not block selected application startup on an unused package credential',async()=>{
    const root=fixture();
    try {
        write(root,'server/.env.test','STRIPE_SECRET_KEY=sandbox');
        write(root,'tools/package.json',JSON.stringify({scripts:{start:'node index.js'}}));
        write(root,'tools/index.js','if(!process.env.UNUSED_PROVIDER_TOKEN)throw Error();');
        const report=await inspectSystemSetup({rootDir:root,dependencies});
        expect(report.ready).toBe(true);
        expect(report.environment.find(row=>row.name==='UNUSED_PROVIDER_TOKEN')).toMatchObject({status:'MAY_BE_NEEDED',required:false});
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
it('discovers package metadata even after the source context budget has been consumed',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-large-preflight-'));
    try {
        for(let index=0;index<5;index++)write(root,`a-${index}.js`,'// filler\n'+' '.repeat(39000));
        write(root,'web/package.json',JSON.stringify({scripts:{dev:'vite'},devDependencies:{vite:'7'}}));
        const report=await inspectSystemSetup({rootDir:root,dependencies});
        expect(report.packages).toEqual([{directory:'web',startScripts:['dev']}]);
        expect(report.candidateConfig).toMatchObject({frontendOnly:true,unified:true});
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
const environmentDb=root=>({projectSnapshot:{findFirst:jest.fn(async()=>({id:'snapshot',projectId:'project',rootDir:root}))},project:{findFirst:jest.fn(async()=>({id:'project',ownerId:'owner',workspaceRevision:0}))},job:{findFirst:jest.fn(async()=>null)}});
it('saves sandbox values from the dialog only into detected test environment files without returning secrets',async()=>{
    const root=fixture(),db=environmentDb(root);
    try {
        write(root,'server/.env','STRIPE_SECRET_KEY=production-unchanged');
        write(root,'server/.env.test','EXISTING_SETTING=preserved');
        const result=await saveSystemTestEnvironment({snapshotId:'snapshot',userId:'owner',db,input:{expectedWorkspaceRevision:0,variables:[{envFile:'server/.env.test',name:'STRIPE_SECRET_KEY',value:'sandbox-test-key'}]},dependencies});
        expect(result).toEqual({saved:1});
        expect(JSON.stringify(result)).not.toContain('sandbox-test-key');
        expect(parseEnvironment(fs.readFileSync(path.join(root,'server/.env.test')))).toEqual({EXISTING_SETTING:'preserved',STRIPE_SECRET_KEY:'sandbox-test-key'});
        expect(fs.readFileSync(path.join(root,'server/.env'),'utf8')).toBe('STRIPE_SECRET_KEY=production-unchanged');
        expect((await inspectSystemSetup({rootDir:root,dependencies})).ready).toBe(true);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
it.each([['server/.env','STRIPE_SECRET_KEY'],['server/.env.test','NODE_OPTIONS'],['client/.env.test','STRIPE_SECRET_KEY']])('rejects an unapproved credential destination %s:%s',async(envFile,name)=>{
    const root=fixture();
    try {
        await expect(saveSystemTestEnvironment({snapshotId:'snapshot',userId:'owner',db:environmentDb(root),input:{expectedWorkspaceRevision:0,variables:[{envFile,name,value:'do-not-save'}]},dependencies})).rejects.toMatchObject({statusCode:422});
        expect(fs.existsSync(path.join(root,envFile))).toBe(false);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
it('refuses credential changes during active jobs, after source revision changes, or without owner approval capability',async()=>{
    const root=fixture(),db=environmentDb(root),input={expectedWorkspaceRevision:0,variables:[{envFile:'server/.env.test',name:'STRIPE_SECRET_KEY',value:'do-not-save'}]};
    try {
        db.job.findFirst.mockResolvedValueOnce({id:'active'});
        await expect(saveSystemTestEnvironment({snapshotId:'snapshot',userId:'owner',db,input,dependencies})).rejects.toMatchObject({statusCode:409});
        await expect(saveSystemTestEnvironment({snapshotId:'snapshot',userId:'owner',db,input:{...input,expectedWorkspaceRevision:1},dependencies})).rejects.toMatchObject({statusCode:409});
        db.project.findFirst.mockResolvedValue({id:'project',ownerId:'owner',workspaceRevision:0});
        db.projectMember={findUnique:jest.fn(async()=>({role:'EDITOR'}))};
        await expect(saveSystemTestEnvironment({snapshotId:'snapshot',userId:'editor',db,input,dependencies})).rejects.toMatchObject({statusCode:403});
        expect(fs.existsSync(path.join(root,'server/.env.test'))).toBe(false);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
