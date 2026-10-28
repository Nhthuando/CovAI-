import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,jest,afterEach} from '@jest/globals';
import {prepareMissingSystemTests} from '../services/automaticSystemTests.service.js';
const roots=[];
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-tests-'));roots.push(root);fs.mkdirSync(path.join(root,'.covai'));fs.writeFileSync(path.join(root,'package.json'),'{"scripts":{"start":"node index.js"}}');fs.writeFileSync(path.join(root,'index.js'),'original source');fs.writeFileSync(path.join(root,'original.spec.js'),'original mocked test');fs.writeFileSync(path.join(root,'.covai/system-test.json'),JSON.stringify({frontend:{directory:'.'},backend:{directory:'.',healthPath:'/'},unified:true,database:null}));return root;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('publishes a separate file only after two verified runs and retains original tests/source',async()=>{
    const root=fixture(),generateTests=jest.fn(async({rootDir})=>{expect(rootDir).not.toBe(root);expect(fs.readFileSync(path.join(rootDir,'index.js'),'utf8')).toBe('original source');return {code:'verified test code',verificationRuns:2,scenarioCount:1};});
    const result=await prepareMissingSystemTests({rootDir:root,dependencies:{generateTests}});
    expect(fs.readFileSync(path.join(root,result.filePath),'utf8')).toBe('verified test code');
    expect(fs.readFileSync(path.join(root,'original.spec.js'),'utf8')).toBe('original mocked test');expect(fs.readFileSync(path.join(root,'index.js'),'utf8')).toBe('original source');
});
it('does not save failed or singly verified generation',async()=>{
    const root=fixture();
    for(const result of [{failed:true,error:'real runtime failure'},{code:'unconfirmed',verificationRuns:1}])await expect(prepareMissingSystemTests({rootDir:root,dependencies:{generateTests:async()=>result}})).rejects.toThrow();
    expect(fs.existsSync(path.join(root,'tests'))).toBe(false);
});
it('does not publish verification from stale source or after cancellation',async()=>{
    const root=fixture(),controller=new AbortController();
    await expect(prepareMissingSystemTests({rootDir:root,dependencies:{generateTests:async()=>{fs.writeFileSync(path.join(root,'index.js'),'edited source');return {code:'stale',verificationRuns:2};}}})).rejects.toThrow('Project changed');
    controller.abort();const generateTests=jest.fn();
    await expect(prepareMissingSystemTests({rootDir:root,signal:controller.signal,dependencies:{generateTests}})).rejects.toThrow('canceled');expect(generateTests).not.toHaveBeenCalled();
});
