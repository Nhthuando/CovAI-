import fs from 'node:fs/promises';
import path from 'node:path';
import { renderSystemTestPdf } from '../server/src/services/systemTestPdf.service.js';
const directory=path.resolve('tmp/pdfs');
await fs.mkdir(directory,{recursive:true});
for(const [name,count] of [['normal',3],['long',12]]) {
    const catalog=Array.from({length:count},(_,index)=>({scenarioKey:`scenario-${index}`,filePath:'tests/auth.spec.js',title:(index===0?'Reject an invalid password':'Sign in with a permitted account')+(name==='long'?' with a long, descriptive scenario title that must wrap without overlapping adjacent content.'.repeat(3):'')+` (${index+1})`,flowJson:['Open the sign-in form','Submit credentials'],inputJson:['Isolated test account'],expectedJson:['The expected account state is displayed'],reviewState:'EXPECTED_CONFIRMED',criterionIds:[]}));
    const runs=[1,2].map(index=>({index,testRunId:`preview-run-${index}`,testRun:{status:'FAILED',startedAt:'2026-11-05T01:00:00.000Z',finishedAt:'2026-11-05T01:00:10.000Z',scenarios:catalog.map((row,i)=>({testFile:row.filePath,title:row.title,status:i===0?'failed':'passed',durationMs:200,failureMessages:i===0?[name==='long'?'Expected an explicit validation error, but the application showed an unexpected response. '.repeat(40):'Expected validation message was not displayed.']:[],apiCalls:[]}))}}));
    const assessment={id:`synthetic-preview-${name}`,snapshotId:'preview-only-not-a-real-project',status:'COMPLETED',runner:'playwright',executionMode:'full',createdAt:'2026-11-05T01:00:00.000Z',sourceHash:'a'.repeat(64),testHash:'b'.repeat(64),reportJson:{schemaVersion:1,runner:'playwright',executionMode:'full',runs,scenarioSnapshot:catalog,coverage:{tiers:{frontend:{status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{covered:4,total:10,pct:40}]))},backend:{status:'NOT_MEASURED',reasonCodes:['NO_INSTRUMENTATION']}}},requirements:{status:'NOT_MEASURED',criteria:[],total:null},gaps:[],limitations:['Synthetic layout preview. These values are fixtures, not actual application results.']}};
    const pdf=await renderSystemTestPdf({assessment,artifacts:name==='long'?[{id:'expired-preview',scenarioKey:'scenario-0',kind:'SCREENSHOT',sha256:'c'.repeat(64),expiredAt:new Date().toISOString()}]:[],generatedAt:'2026-11-05T02:00:00.000Z'});
    await fs.writeFile(path.join(directory,`system-report-${name}.pdf`),pdf);
    console.log(`Rendered ${name} report (${pdf.length} bytes).`);
}
