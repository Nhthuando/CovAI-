import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,it,expect} from '@jest/globals';
import {validateFullSystemTest,storeScenarioScreenshot,prepareSystemPlaywright} from '../services/systemTestEvidence.service.js';
import {readFullSystemConfig} from '../services/fullSystemLifecycle.service.js';
const roots=[];
const root=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'covai-evidence-'));roots.push(directory);return directory;};
afterEach(()=>{for(const directory of roots.splice(0)) fs.rmSync(directory,{recursive:true,force:true});});
describe('real system execution and evidence',()=>{
  it('rejects API mocks and accepts real user actions',()=>{
    expect(()=>validateFullSystemTest("await page.route('**/api/**', () => {});")).toThrow(/real backend/);
    expect(()=>validateFullSystemTest("await page.goto('/'); await page.reload();")).not.toThrow();
  });
  it('fails explicitly when full-system configuration is absent',()=>{expect(()=>readFullSystemConfig(root())).toThrow(/No mock fallback/);});
  it('persists PNG evidence and rejects files outside the snapshot',()=>{
    const directory=root();const source=path.join(directory,'shot.png');
    fs.writeFileSync(source,Buffer.from([137,80,78,71,13,10,26,10,0]));
    const stored=storeScenarioScreenshot({rootDir:directory,source,runKey:'run'});
    expect(fs.readFileSync(path.join(directory,stored))).toEqual(fs.readFileSync(source));
    expect(()=>storeScenarioScreenshot({rootDir:directory,source:path.join(directory,'..','outside.png'),runKey:'run'})).toThrow(/inside/);
  });
  it('forces screenshot capture for every scenario and uses real backend routing',()=>{
    const directory=root();fs.mkdirSync(path.join(directory,'tests/system'),{recursive:true});
    fs.writeFileSync(path.join(directory,'tests/system/crud.spec.js'),"import {test,expect} from '@playwright/test'; test('real',async({page})=>{await page.goto('/');});");
    const result=prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'tests/system'},executionMode:'full',backendUrl:'http://127.0.0.1:4500',frontendPort:4173,runKey:'run'});
    expect(fs.readFileSync(path.join(result.directory,'playwright.config.mjs'),'utf8')).toContain("screenshot:'on'");
    const fixture=fs.readFileSync(path.join(result.directory,'fixture.mjs'),'utf8');
    expect(fixture).toContain('route.continue');expect(fixture).not.toContain('route.fulfill');
  });
});
