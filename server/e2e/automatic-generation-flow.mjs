import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {prepareAutomaticAssessment} from '../src/services/systemAssessmentPreparation.service.js';
import {assessSystemWorkspace} from '../src/services/systemAssessmentJob.service.js';
// Explicit provider integration test. Generates source-grounded tests through
// the production automatic Run path, then measures them twice independently.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-generation-'));
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20*60*1000);timer.unref();
try {
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'automatic-counter',scripts:{start:'node index.js'},dependencies:{express:'^5.1.0'}}));
 fs.writeFileSync(path.join(root,'index.js'),`const express=require('express');const app=express();let count=0;if(!process.env.JWT_SECRET)throw Error('JWT_SECRET required');app.get('/api/count',(req,res)=>res.json({count}));app.post('/api/increment',(req,res)=>res.json({count:++count}));app.post('/api/reset',(req,res)=>{count=0;res.json({count});});app.get('/',(req,res)=>res.send('<h1>Counter</h1><output id="count"></output><button>Increment</button><script>fetch("/api/count").then(r=>r.json()).then(d=>document.querySelector("output").textContent=d.count);document.querySelector("button").onclick=()=>fetch("/api/increment",{method:"POST"}).then(r=>r.json()).then(d=>document.querySelector("output").textContent=d.count);</script>'));app.listen(Number(process.env.PORT),'127.0.0.1');`);
 const prepared=await prepareAutomaticAssessment({rootDir:root,input:{autoDiscover:true,runner:'playwright',executionMode:'full',model:process.env.COVAI_E2E_MODEL || 'gemini-2.5-flash'},signal:controller.signal,onProgress:async(message,progress)=>console.log('AUTO_GENERATION_STAGE',progress,message)});
 assert.ok(prepared.input.testFiles.length>0);
 const report=await assessSystemWorkspace({rootDir:root,input:prepared.input,signal:controller.signal,onProgress:async(message,progress)=>console.log('AUTO_MEASUREMENT_STAGE',progress,message)});
 assert.equal(report.runs.length,2);assert.ok(report.runs.every(run=>run.testRun.status==='PASSED' && run.testRun.totalTests>0 && run.testRun.totalTests===run.testRun.passedTests));
 console.log('AUTO_GENERATION_RESULT',JSON.stringify({testFiles:prepared.input.testFiles,runs:report.runs.map(run=>({total:run.testRun.totalTests,passed:run.testRun.passedTests})),coverage:Object.fromEntries(Object.entries(report.coverage.tiers).map(([tier,value])=>[tier,{status:value.status,counters:value.counters}]))}));
} catch(error){console.error('AUTO_GENERATION_FAILED',error.message);process.exitCode=1;}
finally{clearTimeout(timer);assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('covai-auto-generation-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
