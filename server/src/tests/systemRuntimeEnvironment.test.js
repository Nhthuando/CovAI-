import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,jest} from '@jest/globals';
import {isolatedProcessEnvironment} from '../utils/isolatedProcessEnvironment.js';
await jest.unstable_mockModule('../services/job.service.js',()=>({addJobLog:jest.fn()}));
await jest.unstable_mockModule('../services/jobOutput.service.js',()=>({appendJobOutput:jest.fn()}));
const {dockerRunner}=await import('../services/dockerRunner.service.js');

it('preserves OS discovery while requiring explicit project credentials',()=>{
    const env=isolatedProcessEnvironment({OPENAI_API_KEY:'sandbox'},{Path:'runtime-path',SystemRoot:'windows-root',HOME:'user-home',DATABASE_URL:'covai-private-db',GEMINI_API_KEY:'covai-private-key',NODE_OPTIONS:'--require=server-only.cjs'});
    expect(env).toEqual({Path:'runtime-path',SystemRoot:'windows-root',HOME:'user-home',OPENAI_API_KEY:'sandbox',NODE_PATH:'',NODE_OPTIONS:''});
});
it('does not inherit CovAI env or automatically load a production env file into an imported subprocess',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-env-separation-'));
    const previous=process.env.COVAI_ENV_TEST_SECRET;
    process.env.COVAI_ENV_TEST_SECRET='host-fixture-only';
    try {
        fs.writeFileSync(path.join(root,'.env'),'COVAI_FILE_TEST_SECRET=production-fixture-only');
        fs.writeFileSync(path.join(root,'probe.mjs'),"if(process.env.COVAI_ENV_TEST_SECRET || process.env.COVAI_FILE_TEST_SECRET || process.env.PROJECT_TEST_VALUE!=='sandbox-fixture')process.exitCode=1;");
        const result=await dockerRunner.run({snapshotPath:root,command:`"${process.execPath}" probe.mjs`,forceHost:true,isolatedEnv:true,timeoutMs:10000,env:{PROJECT_TEST_VALUE:'sandbox-fixture'}});
        expect(result.success).toBe(true);
    } finally {
        if(previous===undefined)delete process.env.COVAI_ENV_TEST_SECRET;else process.env.COVAI_ENV_TEST_SECRET=previous;
        fs.rmSync(root,{recursive:true,force:true});
    }
},15000);
it('bounds captured subprocess output and keeps the final diagnostic tail',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-output-budget-'));
    try {
        fs.writeFileSync(path.join(root,'output.mjs'),"process.stdout.write('x'.repeat(3*1024*1024)+'FINAL_DIAGNOSTIC');");
        const result=await dockerRunner.run({snapshotPath:root,command:`"${process.execPath}" output.mjs`,forceHost:true,isolatedEnv:true,timeoutMs:10000});
        expect(result.success).toBe(true);
        expect(result.outputTruncated).toBe(true);
        expect(result.stdout.length).toBeLessThanOrEqual(2*1024*1024);
        expect(result.stdout.endsWith('FINAL_DIAGNOSTIC')).toBe(true);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
},15000);
