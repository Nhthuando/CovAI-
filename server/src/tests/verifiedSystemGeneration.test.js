import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect,jest,afterEach} from '@jest/globals';
import {collectSystemGenerationContext} from '../services/systemGenerationContext.service.js';
import {generateVerifiedSystemTests,validateSystemTestIntent,extractSystemTestCode,applySystemTestRepair} from '../services/verifiedSystemGeneration.service.js';
const directories=[];
const root=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'covai-generation-'));directories.push(directory);return directory;};
afterEach(()=>{for(const directory of directories.splice(0)) fs.rmSync(directory,{recursive:true,force:true});});
const code="import {test,expect} from '@playwright/test'; test('shows tasks',async({page})=>{await page.goto('/');await expect(page.getByRole('heading')).toBeVisible();});";
const setup=directory=>{
  fs.mkdirSync(path.join(directory,'.covai'),{recursive:true});
  fs.writeFileSync(path.join(directory,'.covai/system-test.json'),JSON.stringify({database:{engine:'mysql',initSql:'.covai/schema.sql'},backend:{directory:'server',healthPath:'/api/todos'},frontend:{directory:'client'}}));
  fs.mkdirSync(path.join(directory,'client/src/components'),{recursive:true});fs.mkdirSync(path.join(directory,'server'),{recursive:true});
  fs.writeFileSync(path.join(directory,'client/src/components/Task.jsx'),'unique source control');
  fs.writeFileSync(path.join(directory,'.env'),'SECRET=never-send-this');
  fs.writeFileSync(path.join(directory,'.covai/schema.sql'),'CREATE TABLE tasks(id INT);');
};
describe('verified system generation',()=>{
  it('extracts code fences without leaving a javascript language prefix',()=>{
    expect(extractSystemTestCode('```javascript\n'+code+'\n```')).toBe(code);
    expect(extractSystemTestCode('```json\n'+JSON.stringify({content:code})+'\n```')).toBe(code);
  });
  it('reads fresh component source and schema, excluding credentials and generated artifacts',()=>{
    const directory=root();setup(directory);
    fs.mkdirSync(path.join(directory,'.covai-system-test'),{recursive:true});fs.writeFileSync(path.join(directory,'.covai-system-test/fixture.js'),'generated artifact');
    const context=collectSystemGenerationContext(directory);
    expect(JSON.stringify(context)).toContain('unique source control');expect(JSON.stringify(context)).toContain('CREATE TABLE tasks');
    expect(JSON.stringify(context)).not.toContain('never-send-this');expect(JSON.stringify(context)).not.toContain('generated artifact');
    fs.writeFileSync(path.join(directory,'client/src/components/Task.jsx'),'updated control');
    expect(JSON.stringify(collectSystemGenerationContext(directory))).toContain('updated control');
  });
  it('rejects no-assertion, constant assertions, skips and API mocks',()=>{
    expect(()=>validateSystemTestIntent(code.replace("expect(page.getByRole('heading'))","expect(true)"))).toThrow(/constants/);
    expect(()=>validateSystemTestIntent(code.replace("test('shows tasks'","test.skip('shows tasks'"))).toThrow(/skip/);
    expect(()=>validateSystemTestIntent(code+"page.route('**/*',()=>{});")).toThrow(/real backend/);
    expect(validateSystemTestIntent(code)).toEqual(['shows tasks']);
  });
  it('repairs against real feedback and returns only verified code without saving candidate to suite',async()=>{
    const directory=root();const reportPath=path.join(directory,'report.json');
    const generate=jest.fn().mockResolvedValueOnce(JSON.stringify({content:code})).mockResolvedValue(JSON.stringify({replacements:[{old:"await page.goto('/');",new:"await page.goto('/'); await page.reload();"}]}));
    const run=jest.fn().mockImplementationOnce(async()=>{
      fs.writeFileSync(reportPath,JSON.stringify({stats:{expected:0,unexpected:1},suites:[{specs:[{title:'shows tasks',tests:[{results:[{status:'failed',error:{message:'heading selector matched two elements'}}]}]}]}]}));
      return {success:false,reportPath};
    }).mockImplementation(async()=>{
      fs.writeFileSync(reportPath,JSON.stringify({stats:{expected:1,unexpected:0},suites:[]}));return {success:true,reportPath};
    });
    const result=await generateVerifiedSystemTests({rootDir:directory,dependencies:{collect:()=>({sourceCode:[],omittedFiles:[],contextComplete:true}),observe:async()=>({accessibility:'heading Tasks'}),generate,run}});
    expect(result.failed).toBeUndefined();expect(result.attempts).toHaveLength(2);
    expect(result.verificationRuns).toBe(2);expect(run).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[1][0]).toContain('heading selector matched two elements');
    expect(fs.existsSync(path.join(directory,'tests/system/ai-generated.spec.js'))).toBe(false);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({executionMode:'full'}));
  });
  it('does not accept repairs that delete scenarios and stops after bounded attempts',async()=>{
    const directory=root();const reportPath=path.join(directory,'report.json');
    fs.writeFileSync(reportPath,JSON.stringify({stats:{expected:0,unexpected:1},suites:[]}));
    const generate=jest.fn().mockResolvedValueOnce(JSON.stringify({content:code})).mockResolvedValue(JSON.stringify({replacements:[{old:code,new:code.replace('shows tasks','different scenario')}]}));
    const run=jest.fn().mockResolvedValue({success:false,reportPath});
    const result=await generateVerifiedSystemTests({rootDir:directory,dependencies:{collect:()=>({sourceCode:[],omittedFiles:[]}),observe:async()=>({}),generate,run}});
    expect(result.failed).toBe(true);expect(generate).toHaveBeenCalledTimes(3);expect(run).toHaveBeenCalledTimes(1);
    expect(result.error).toContain('scenarios or assertions');
  });
  it('refuses repairs that weaken assertions or change imports',()=>{
    expect(()=>applySystemTestRepair(JSON.stringify({replacements:[{old:"expect(page.getByRole('heading'))",new:'expect(true)'}]}),code)).toThrow(/assertions/);
    expect(()=>applySystemTestRepair(JSON.stringify({replacements:[{old:"import {test,expect}",new:"import {test}"}]}),code)).toThrow(/imports/);
  });
  it('does not verify against stale source if the snapshot changes during the run',async()=>{
    const directory=root();const reportPath=path.join(directory,'report.json');
    fs.writeFileSync(reportPath,JSON.stringify({stats:{expected:1},suites:[]}));
    const collect=jest.fn().mockReturnValueOnce({sourceCode:[{path:'App.jsx',content:'before'}],omittedFiles:[]}).mockReturnValue({sourceCode:[{path:'App.jsx',content:'after'}],omittedFiles:[]});
    await expect(generateVerifiedSystemTests({rootDir:directory,dependencies:{collect,observe:async()=>({}),generate:async()=>JSON.stringify({content:code}),run:async()=>({success:true,reportPath})}})).rejects.toThrow(/source changed/);
  });
});
