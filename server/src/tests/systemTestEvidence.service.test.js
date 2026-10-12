import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {afterEach,describe,it,expect} from '@jest/globals';
import {validateFullSystemTest,storeScenarioScreenshot,prepareSystemPlaywright} from '../services/systemTestEvidence.service.js';
import {readFullSystemConfig} from '../services/fullSystemLifecycle.service.js';
const roots=[];
const root=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'covai-evidence-'));roots.push(directory);return directory;};
afterEach(()=>{for(const directory of roots.splice(0)) fs.rmSync(directory,{recursive:true,force:true});});
describe('real system execution and evidence',()=>{
  it('automatically records user-written steps in an execution copy and preserves config-owned servers',()=>{
    const directory=root();fs.mkdirSync(path.join(directory,'e2e'));
    const source="import {test,expect} from '@playwright/test'; test('title',async({page})=>{await page.goto('/');await expect(page).toHaveTitle('Wrong title');});";
    const original=path.join(directory,'e2e/home.spec.ts');fs.writeFileSync(original,source);
    const configPath=path.join(directory,'playwright.config.ts');fs.writeFileSync(configPath,"export default {webServer:{command:'npm run dev'},use:{baseURL:'http://localhost:3001'}};");
    const result=prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'e2e'},executionMode:'frontend',frontendPort:4173,runKey:'steps',configPath});
    const specs=path.join(result.directory,'specs');
    const copy=fs.readFileSync(path.join(specs,fs.readdirSync(specs)[0]),'utf8');
    expect(copy).toContain('test.step("Open application page"');
    expect(copy).toContain('test.step("Verify expected result"');
    expect(copy).toContain("expect(page).toHaveTitle('Wrong title')");
    expect(fs.readFileSync(original,'utf8')).toBe(source);
    const config=fs.readFileSync(path.join(result.directory,'playwright.config.mjs'),'utf8');
    expect(config).toContain('import original from');expect(config).toContain('original.webServer');
    expect(config).toContain('...base.use');expect(config).not.toContain("baseURL:'http://127.0.0.1:4173'");
  });
  it('stores inline PNG checkpoints and rejects invalid or excessive attachment bodies',()=>{
    const directory=root();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9d8AAAAASUVORK5CYII=','base64');
    const screenshot=storeScenarioScreenshot({rootDir:directory,source:{body:png.toString('base64')},runKey:'checkpoint'});
    expect(fs.readFileSync(path.join(directory,screenshot))).toEqual(png);
    for(const body of ['not base64',Buffer.from('not PNG').toString('base64'),'A'.repeat(20*1024*1024+1)]) {
      expect(storeScenarioScreenshot({rootDir:directory,source:{body},runKey:'invalid'})).toBeNull();
    }
  });
  it('rejects API mocks and accepts real user actions',()=>{
    expect(()=>validateFullSystemTest("await page.route('**/api/**', () => {});")).toThrow(/real backend/);
    expect(()=>validateFullSystemTest("await page.goto('/'); await page.reload();")).not.toThrow();
  });
  it('fails explicitly when full-system configuration is absent',()=>{expect(()=>readFullSystemConfig(root())).toThrow(/Choose Frontend Dev Server/);});
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
    expect(fixture).toContain('playwright.request.newContext({baseURL:backend');
    expect(fixture).toContain('await request.dispose()');
  });
  it.each(['js','cjs'])('runs CommonJS .%s Playwright imports through a CommonJS fixture and preserves the original file',(extension)=>{
    const directory=root();fs.mkdirSync(path.join(directory,'tests/e2e'),{recursive:true});
    const source="const {test,expect}=require('@playwright/test'); const helper=require('./helper'); test('real',async({page})=>{await page.goto('/');});";
    const original=path.join(directory,`tests/e2e/crud.spec.${extension}`);
    fs.writeFileSync(original,source);
    const result=prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'tests/e2e'},executionMode:'frontend',frontendPort:4173,runKey:'cjs'});
    const specs=path.join(result.directory,'specs');
    const copy=fs.readFileSync(path.join(specs,fs.readdirSync(specs)[0]),'utf8');
    expect(copy).toContain(`require(${JSON.stringify(path.join(result.directory,'fixture.cjs'))})`);
    expect(copy).toContain(`require(${JSON.stringify(path.join(directory,'tests/e2e/helper'))})`);
    expect(fs.readFileSync(original,'utf8')).toBe(source);
    expect(fs.readFileSync(path.join(result.directory,'fixture.cjs'),'utf8')).toContain('module.exports={...playwright,test}');
  });
  it('keeps rejecting full-system API mocks in CommonJS tests',()=>{
    const directory=root();fs.mkdirSync(path.join(directory,'tests/e2e'),{recursive:true});
    fs.writeFileSync(path.join(directory,'tests/e2e/mock.spec.js'),"const {test}=require('@playwright/test'); test('mock',async({page})=>{await page.route('**/api/**',()=>{});});");
    expect(()=>prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'tests/e2e'},executionMode:'full',frontendPort:4173,runKey:'mock'})).toThrow(/real backend/);
  });
  it.each([
    ['commonjs','js','frontend'], ['commonjs','js','full'],
    ['module','js','frontend'], ['module','js','full'],
    ['commonjs','ts','full'], ['module','ts','full'],
    ['module','cjs','full'], ['commonjs','mjs','full'],
  ])('loads managed %s .%s specs with the real Playwright CLI in %s mode', (type,extension,executionMode) => {
    const serverRoot=fileURLToPath(new URL('../../',import.meta.url));
    const temporary=path.join(serverRoot,'.covai-temp');
    fs.mkdirSync(temporary,{recursive:true});
    const directory=fs.mkdtempSync(path.join(temporary,'module path with spaces-')); roots.push(directory);
    // The original nested package intentionally has a different type to the copied location.
    fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({type:type === 'module' ? 'commonjs' : 'module'}));
    const originalDirectory=path.join(directory,'tests/e2e');
    fs.mkdirSync(originalDirectory,{recursive:true});
    fs.writeFileSync(path.join(originalDirectory,'package.json'),JSON.stringify({type}));
    const esm=extension === 'mjs' || (extension !== 'cjs' && type === 'module');
    const helper=esm ? 'helper.mjs' : 'helper.cjs';
    fs.writeFileSync(path.join(originalDirectory,helper),esm ? 'export const answer=42;' : 'exports.answer=42;');
    const imports=extension === 'cjs'
      ? `const {test,expect}=require('@playwright/test'); const {answer}=require('./${helper}');`
      : `import {test,expect} from '@playwright/test'; import {answer} from './${helper}';`;
    const source=imports+"test('module resolution regression',async()=>{await test.step('Check imported helper',async()=>{expect(answer).toBe(42);});});";
    const original=path.join(originalDirectory,`regression.spec.${extension}`);
    fs.writeFileSync(original,source);
    const managed=prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'tests/e2e'},executionMode,backendUrl:executionMode === 'full' ? 'http://127.0.0.1:4500' : undefined,frontendPort:4173,runKey:'run'});
    const runnerEnv={...process.env}; delete runnerEnv.JEST_WORKER_ID;
    const result=spawnSync(process.execPath,[path.join(serverRoot,'node_modules/playwright/cli.js'),'test','--config',path.join(managed.directory,'playwright.config.mjs'),'--list'],{cwd:directory,env:runnerEnv,encoding:'utf8',windowsHide:true,timeout:20000});
    if (result.status !== 0) throw new Error(`Playwright listing failed: ${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`);
    expect(result.stdout).toContain('module resolution regression');
    expect(result.stdout).toContain('Total: 1 test');
    expect(fs.readFileSync(original,'utf8')).toBe(source);
    const copied=fs.readdirSync(path.join(managed.directory,'specs'))[0];
    expect(copied).toMatch(esm ? /\.spec\.m[jt]s$/ : /\.spec\.c[jt]s$/);
  },30000);
});
