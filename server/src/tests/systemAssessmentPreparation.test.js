import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect,jest,afterEach} from '@jest/globals';
import {prepareAutomaticAssessment} from '../services/systemAssessmentPreparation.service.js';
const roots=[];
const write=(root,file,text)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
const fixture=()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-assessment-setup-'));roots.push(root);
    write(root,'client/package.json',JSON.stringify({scripts:{dev:'vite'},dependencies:{vite:'1'}}));
    write(root,'server/package.json',JSON.stringify({scripts:{dev:'node index.js'},dependencies:{express:'1',mysql2:'1'}}));
    write(root,'server/index.js',"app.get('/api/todos',handler);db.query('SELECT id,title FROM todos');");
    write(root,'server/tests/todo.spec.js',"import {test} from '@playwright/test';test('read todos',async({page})=>{await page.goto('/');});");
    return root;
};
const proposal={frontend:{directory:'client'},backend:{directory:'server',healthPath:'/api/todos'},database:{engine:'mysql',initSql:'.covai/generated-schema.sql'},schemaSql:'CREATE TABLE todos(id INT PRIMARY KEY,title VARCHAR(255));',missingInformation:[]};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('automatic Run preparation',()=>{
    it('discovers imported scenarios for execution without changing their reviewed state',async()=>{
        const root=fixture();
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5'}}));
        write(root,'server/index.js',"import express from 'express';const app=express();app.get('/',(_req,res)=>res.send('ready'));");
        const result=await prepareAutomaticAssessment({rootDir:root,input:{autoDiscover:true,runner:'playwright',executionMode:'full',headed:true}});
        expect(result.input).toMatchObject({reviewMode:'execution',headed:true,scenarioIds:[result.catalog[0].id]});
        expect(result.catalog[0]).toMatchObject({title:'read todos',reviewState:'DRAFT'});
    });
    it('generates missing tests only when requested, then discovers the generated execution catalog',async()=>{
        const root=fixture();
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5'}}));
        const before=fs.readFileSync(path.join(root,'server/tests/todo.spec.js'),'utf8');
        const discover=jest.fn().mockImplementationOnce(()=>{const error=new Error('no tests');error.code='SYSTEM_TESTS_NOT_FOUND';throw error;}).mockReturnValue({runner:'playwright',executionMode:'full',testFiles:['tests/generated.spec.js'],coverageScope:{frontend:{root:'client',sourceDirectory:'.'},backend:{root:'server',sourceDirectory:'.'}},repeatRuns:2});
        const prepareMissing=jest.fn(async()=>{write(root,'tests/generated.spec.js',"import {test,expect} from '@playwright/test';test('generated',()=>{expect(true).toBe(true);});");return {filePath:'tests/generated.spec.js',verificationRuns:2};});
        const result=await prepareAutomaticAssessment({rootDir:root,input:{autoDiscover:true,allowGenerate:true,executionMode:'full',runner:'playwright'},dependencies:{discover,prepareMissing}});
        expect(prepareMissing).toHaveBeenCalledTimes(1);
        expect(result.catalog[0]).toMatchObject({title:'generated',reviewState:'DRAFT'});
        expect(result.generatedTests).toMatchObject({verificationRuns:2});
        expect(fs.readFileSync(path.join(root,'server/tests/todo.spec.js'),'utf8')).toBe(before);
    });
    it('prepares missing setup before discovery from an imported backend subdirectory without .git',async()=>{
        const root=fixture(),generate=jest.fn().mockResolvedValue(JSON.stringify(proposal)),progress=jest.fn();
        const result=await prepareAutomaticAssessment({rootDir:path.join(root,'server'),input:{autoDiscover:true,runner:'playwright',executionMode:'full',model:'gemini-2.5-flash'},onProgress:progress,dependencies:{generate}});
        expect(result.rootDir).toBe(fs.realpathSync(root));
        expect(result.input).toMatchObject({testFiles:['server/tests/todo.spec.js'],coverageScope:{frontend:{root:'client'},backend:{root:'server'}}});
        expect(generate.mock.calls[0][1]).toBe('gemini-2.5-flash');
        expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(true);
        expect(progress.mock.calls.some(([message])=>message.includes('configuration prepared'))).toBe(true);
        await prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'full'},dependencies:{generate}});
        expect(generate).toHaveBeenCalledTimes(1);
    });
    it('runs frontend discovery without generating a database setup',async()=>{
        const root=fixture(),generate=jest.fn();
        const result=await prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'frontend'},dependencies:{generate}});
        expect(result.input.coverageScope.backend).toBeUndefined();
        expect(generate).not.toHaveBeenCalled();
    });
    it('does not continue to discovery when setup fails',async()=>{
        const root=fixture(),discover=jest.fn();
        await expect(prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'full'},dependencies:{setup:async()=>{throw new Error('schema missing');},discover}})).rejects.toThrow('schema missing');
        expect(discover).not.toHaveBeenCalled();
    });
    it('reports a source-required test credential before discovery without reading production env',async()=>{
        const root=fixture(),discover=jest.fn();
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5',stripe:'19'}}));
        write(root,'server/index.js',`const Stripe=require('stripe');const stripe=Stripe(process.env.STRIPE_SECRET_KEY);`);
        write(root,'server/.env','STRIPE_SECRET_KEY=production-secret');
        const setup=async()=>({config:{backend:{directory:'server'}}});
        await expect(prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'full'},dependencies:{setup,discover}})).rejects.toMatchObject({code:'SYSTEM_TEST_ENVIRONMENT_REQUIRED'});
        expect(discover).not.toHaveBeenCalled();
    });
    it('stops canceled preparation before provider calls',async()=>{
        const root=fixture(),generate=jest.fn();
        await expect(prepareAutomaticAssessment({rootDir:root,input:{executionMode:'full'},signal:{aborted:true},dependencies:{generate}})).rejects.toThrow('canceled');
        expect(generate).not.toHaveBeenCalled();
    });
    it('requires explicit reviewed Apply when Full Stack has only mocked tests',async()=>{
        const root=fixture(),setup=async()=>({config:{backend:{directory:'server'}}});
        const discover=jest.fn().mockImplementation(()=>{const error=new Error('Mocked tests only');error.code='FULL_STACK_TESTS_REQUIRED';throw error;});
        const prepareTests=jest.fn();
        await expect(prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'full'},dependencies:{setup,discover,prepareTests}})).rejects.toMatchObject({statusCode:409});
        expect(prepareTests).not.toHaveBeenCalled();expect(discover).toHaveBeenCalledTimes(1);
    });
    it('does not publish setup if canceled while waiting for AI',async()=>{
        const root=fixture(),controller=new AbortController();
        const generate=async()=>{controller.abort();return JSON.stringify(proposal);};
        await expect(prepareAutomaticAssessment({rootDir:root,input:{runner:'playwright',executionMode:'full'},signal:controller.signal,dependencies:{generate}})).rejects.toThrow('canceled');
        expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
        expect(fs.existsSync(path.join(root,'.covai/generated-schema.sql'))).toBe(false);
    });
});
