import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, test, expect } from '@jest/globals';
import { afterEach, it } from '@jest/globals';
import {analyzeFullStackCompatibility,validateFullSystemTest,storeScenarioScreenshot,prepareSystemPlaywright,mapSystemExecutionCopyPath} from '../services/systemTestEvidence.service.js';
import {readFullSystemConfig} from '../services/fullSystemLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';
const roots=[];
const root=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'covai-evidence-'));roots.push(directory);return directory;};
afterEach(()=>{for(const directory of roots.splice(0)) fs.rmSync(directory,{recursive:true,force:true});});
describe('real system execution and evidence',()=>{
  it('maps reporter paths for execution copies to their original project-relative spec',()=>{
    const copy='657319ce-b609-4afc-8f09-e9ca80db34a9.spec.mjs';
    const original='client/tests/e2e/checkout.spec.mjs';
    const sourceMap={[copy]:original};
    expect(mapSystemExecutionCopyPath(copy,sourceMap)).toBe(original);
    expect(mapSystemExecutionCopyPath(`C:\\repo\\runs\\specs\\${copy}`,sourceMap)).toBe(original);
    expect(mapSystemExecutionCopyPath('specs/unknown.spec.mjs',sourceMap)).toBeNull();
  });
  it('keeps scenario screenshots as checkpoints without relaying them as live frames',async()=>{
    const source=fs.readFileSync(new URL('../services/systemAssessmentJob.service.js',import.meta.url),'utf8');
    const start=source.indexOf('let liveFrameSeq =');
    const end=source.indexOf('const report = await withProjectDependencyCache',start);
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const frames=[],recorded=[],transport=[],events=[],checkpoints=[];
    let now=0;
    const dependencies={
      Date:{now:()=>now},
      job:{snapshotId:'snapshot',userId:'user',snapshot:{rootDir:'/workspace'}},
      assessment:{id:'assessment'},prisma:{},
      catalog:[{filePath:'test.spec.js',title:'scenario',scenarioKey:'scenario-key'}],
      recordSystemLiveFrame:frame=>recorded.push(frame),
      global:{io:{to:()=>({emit:(event,payload)=>frames.push({event,payload})})}},
      currentProjectOperation:()=>({projectId:'project'}),
      deliverScopedProjectTransport:payload=>transport.push(payload),
      storeScenarioScreenshot:()=> 'checkpoint.png',
      persistRunArtifacts:async input=>{checkpoints.push(input);return [{id:'artifact'}];},
      emit:async event=>events.push(event),
      console,
      redactDeep:value=>value,
    };
    const onEvent=new Function(...Object.keys(dependencies),`${source.slice(start,end)} return onEvent;`)(...Object.values(dependencies));
    await onEvent({runIndex:0,type:'SCENARIO_ENDED',screenshotBody:'blank-page',filePath:'test.spec.js',title:'scenario'});
    expect(frames).toEqual([]);expect(recorded).toEqual([]);expect(transport).toEqual([]);
    expect(checkpoints[0].artifacts[0]).toEqual(expect.objectContaining({purpose:'CHECKPOINT',relativePath:'checkpoint.png'}));
    expect(events[0]).toEqual(expect.objectContaining({type:'SCENARIO_ENDED'}));
    const frameBuffer=Buffer.from('live-page');
    const frame=frameBuffer.toString('base64');
    const url='http://localhost:4173/checkout';
    await onEvent({runIndex:1,type:'LIVE_FRAME',frame,url});
    now=39;
    await onEvent({runIndex:1,type:'LIVE_FRAME',frame,url});
    now=40;
    await onEvent({runIndex:2,type:'LIVE_FRAME',frame,url});

    const firstPayload={snapshotId:'snapshot',assessmentId:'assessment',runIndex:1,frame:frameBuffer,url,mime:'image/jpeg',seq:1};
    expect(frames).toEqual([
      {event:'system-run:frame',payload:firstPayload},
      {event:'system-run:frame',payload:{...firstPayload,runIndex:2,seq:2}},
    ]);
    expect(Buffer.isBuffer(frames[0].payload.frame)).toBe(true);
    expect(recorded).toHaveLength(3);
    expect(recorded[0]).toEqual({snapshotId:'snapshot',assessmentId:'assessment',runIndex:1,frame,url});
    expect(transport).toHaveLength(2);
    expect(transport[0]).toEqual({projectId:'project',event:'system-run:frame',payload:firstPayload});
  });
  it('generates the throttled screencast and atomic frame and metadata writes',()=>{
    const directory=root();
    fs.mkdirSync(path.join(directory,'e2e'));
    const file=path.join(directory,'e2e/home.spec.js');
    fs.writeFileSync(file,"import {test} from '@playwright/test'; test('home',async({page})=>{await page.goto('/');});");
    const result=prepareSystemPlaywright({rootDir:directory,execution:{selectedFiles:[file]},executionMode:'frontend',frontendPort:4173,runKey:'live'});
    const fixture=fs.readFileSync(path.join(result.directory,'fixture.mjs'),'utf8');
    expect(fixture).toContain("'Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }");
    expect(fixture).toContain('50 - (Date.now() - lastFrameAt)');
    expect(fixture).toContain("const frameTmpFile = frameFile + '.tmp'");
    expect(fixture).toContain("fs.writeFileSync(frameTmpFile, data, 'utf8');");
    expect(fixture).toContain('fs.renameSync(frameTmpFile, frameFile);');
    expect(fixture).toContain("'live-meta.json'");
    expect(fixture).toContain('fs.renameSync(metaTmpFile, metaFile);');
  });
  it('limits a selected scenario run to its literal Playwright title',()=>{
    const directory=root();fs.mkdirSync(path.join(directory,'e2e'));
    const file=path.join(directory,'e2e/items.spec.js');
    fs.writeFileSync(file,"import {test,expect} from '@playwright/test'; test('A [item]',async({page})=>{await expect(page).toHaveTitle('A');}); test('Other',async({page})=>{await expect(page).toHaveTitle('B');});");
    const result=prepareSystemPlaywright({rootDir:directory,execution:{selectedFiles:[file],selectedTitles:['A [item]']},executionMode:'frontend',frontendPort:4173,runKey:'selected'});
    const config=fs.readFileSync(path.join(result.directory,'playwright.config.mjs'),'utf8');
    expect(config).toContain('grep:new RegExp(');
    const pattern=JSON.parse(config.match(/grep:new RegExp\((".*?")\)/)[1]);
    expect(new RegExp(pattern).test('suite A [item]')).toBe(true);
    expect(new RegExp(pattern).test('suite Other')).toBe(false);
    expect(new RegExp(pattern).test('suite A i')).toBe(false);
  });
  it.each([
    [true, false, 500],
    [undefined, false, 0],
    [false, false, 0],
    [true, true, 450],
  ])('configures watch=%s and headed=%s with slowMo=%i', (watch, headed, slowMo) => {
    const directory = root();
    const file = path.join(directory, 'home.spec.js');
    fs.writeFileSync(file, "import {test} from '@playwright/test'; test('home',async({page})=>{await page.goto('/');});");
    const execution = { selectedFiles: [file], ...(watch !== undefined ? { watch } : {}) };
    const result = prepareSystemPlaywright({ rootDir: directory, execution, executionMode: 'frontend', frontendPort: 4173, runKey: 'speed', headed });
    const config = fs.readFileSync(path.join(result.directory, 'playwright.config.mjs'), 'utf8');
    const fixture = fs.readFileSync(path.join(result.directory, 'fixture.mjs'), 'utf8');
    expect(config).toContain(`slowMo:${slowMo}`);
    expect(fixture.includes('page.waitForTimeout(1500)')).toBe(watch === true);
  });
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
  it.each([undefined, false, true])('writes fast-fail timeouts only when enabled (%s)', fastFail => {
    const directory = root();
    fs.mkdirSync(path.join(directory, 'e2e'));
    fs.writeFileSync(path.join(directory, 'e2e/home.spec.js'), "import {test,expect} from '@playwright/test'; test('title',async({page})=>{await expect(page).toHaveTitle('Home');});");
    const result = prepareSystemPlaywright({
      rootDir: directory, execution: { testDirectory: 'e2e', fastFail },
      executionMode: 'frontend', frontendPort: 4173, runKey: 'timeouts',
    });
    const config = fs.readFileSync(path.join(result.directory, 'playwright.config.mjs'), 'utf8');
    if (fastFail) {
      expect(config).toContain('actionTimeout:8000,navigationTimeout:15000,');
      expect(config).toContain('timeout:Math.min(base.timeout || 30000, 20000)');
      expect(config).toContain('expect:{...base.expect,timeout:Math.min(base.expect?.timeout || 5000, 5000)}');
    } else {
      expect(config).not.toContain('actionTimeout:8000');
      expect(config).not.toContain('navigationTimeout:15000');
      expect(config).toContain('timeout:base.timeout || 30000');
    }
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
  test.each([
    "import { test } from '@playwright/test'; await test.goto('/');",
    "import { test as check } from '@playwright/test'; await check['goto']('/');",
    "const { test: check } = require('@playwright/test'); await check.goto('/');",
    "const check = require('@playwright/test').test; await check.goto('/');",
  ])('rejects invalid calls on the Playwright test binding: %s', code => {
    expect(() => validateFullSystemTest(code)).toThrow('Use page.goto() instead of test.goto() in Playwright tests');
  });
  test('accepts test.step, test.info().attach and test.describe.configure', () => {
    expect(() => validateFullSystemTest(`
      import { test } from '@playwright/test';
      test.describe.configure({ mode: 'serial' });
      test('valid methods', async () => {
        await test.step('Attach evidence', async () => {
          await test.info().attach('evidence', { body: 'ok' });
        });
      });
      function unrelated(test) { test.goto('/'); }
    `)).not.toThrow();
  });
  test('rejects fixture destructuring in a test.step callback', () => {
    expect(() => validateFullSystemTest(`
      import { test } from '@playwright/test';
      test('toggle todo', async ({ page }) => {
        await test.step('Create todo', async ({ request }) => {
          await request.post('/api/todos', { data: { title: 'Todo' } });
        });
      });
    `)).toThrow(expect.objectContaining({
      ...new ServiceError('', 422),
      message: expect.stringMatching(/^test\.step callbacks do not receive fixtures/),
    }));
  });
  test('accepts a test.step callback using a fixture from the test', () => {
    expect(() => validateFullSystemTest(`
      import { test } from '@playwright/test';
      test('toggle todo', async ({ page, request }) => {
        await test.step('Create todo', async () => {
          await request.post('/api/todos', { data: { title: 'Todo' } });
        });
      });
    `)).not.toThrow();
  });
  test('accepts an identifier parameter in a test.step callback', () => {
    expect(() => validateFullSystemTest(`
      import { test } from '@playwright/test';
      test('toggle todo', async ({ page }) => {
        await test.step('Open todos', async (step) => {
          await page.goto('/');
        });
      });
    `)).not.toThrow();
  });
  test('rewrites absolute loopback request URLs before forwarding them', () => {
    const directory = root();
    const file = path.join(directory, 'request.spec.js');
    fs.writeFileSync(file, "import { test } from '@playwright/test'; test('request', async ({ request }) => { await request.get('/api/x'); });");
    const result = prepareSystemPlaywright({
      rootDir: directory, execution: { selectedFiles: [file] }, executionMode: 'full', backendUrl: 'http://127.0.0.1:4500',
      frontendPort: 4173, runKey: 'request-routing',
    });
    for (const name of ['fixture.mjs', 'fixture.cjs']) {
      const fixture = fs.readFileSync(path.join(result.directory, name), 'utf8');
      expect(fixture).toMatch(/URL\.canParse\(args\[0\]\)[\s\S]*?\['http:', 'https:'\]\.includes\(target\.protocol\)[\s\S]*?\['localhost', '127\.0\.0\.1', '\[::1\]'\]\.includes\(target\.hostname\)[\s\S]*?port !== Number\(4173\)[\s\S]*?args\[0\] = backend \+ target\.pathname \+ target\.search;[\s\S]*?await original\(\.\.\.args\)/);
    }
  });
  it('fails explicitly when full-system configuration is absent',()=>{expect(()=>readFullSystemConfig(root())).toThrow(/Full Stack startup setup is missing|Generate and apply a Full Stack test draft/);});
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
    expect(fixture).toContain('Page.startScreencast');
    expect(fixture).toContain('Page.screencastFrameAck');
    expect(fixture).toContain('Page.stopScreencast');
    expect(fixture).toContain('route.continue');expect(fixture).not.toContain('route.fulfill');
    expect(fixture).toContain('playwright.request.newContext({baseURL:backend');
    expect(fixture).toContain('await request.dispose()');
  });
  it('reports API mocks in an extensionless helper import', () => {
    const rootDir = root();
    const filePath = path.join(rootDir, 'system-flows.spec.ts');
    fs.writeFileSync(filePath, "import { test } from '@playwright/test'; import { installMockApi } from './mockApi'; test('flow', async ({ page }) => { await installMockApi(page); });");
    fs.writeFileSync(path.join(rootDir, 'mockApi.ts'), "export const installMockApi = page => page.route('**/api/v1/**', route => route.fulfill({ body: '{}' }));");

    expect(analyzeFullStackCompatibility({ filePath, rootDir })).toEqual({
      compatible: false,
      offendingFile: path.join(rootDir, 'mockApi.ts'),
      reason: 'Uses API mocks via mockApi.ts (frontend-only test)',
    });
    expect(() => prepareSystemPlaywright({ rootDir, execution: { selectedFiles: [filePath] }, executionMode: 'full', frontendPort: 4173, runKey: 'helper-mock' })).toThrow(/real backend.*mockApi\.ts/);
  });
  it('accepts a clean helper and resolves extensionless imports and re-exports in an ESM spec copy', () => {
    const rootDir = root();
    const filePath = path.join(rootDir, 'flow.spec.ts');
    const helper = path.join(rootDir, 'helpers.ts');
    const index = path.join(rootDir, 'shared', 'index.ts');
    fs.mkdirSync(path.dirname(index));
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.writeFileSync(helper, 'export const answer = 42;');
    fs.writeFileSync(index, "export { answer } from '../helpers';");
    fs.writeFileSync(filePath, `
      import { test, expect } from '@playwright/test';
      import { answer } from './helpers';
      export { answer as sharedAnswer } from './shared';
      test('flow', async () => { expect((await import('./helpers')).answer).toBe(answer); });
    `);

    expect(analyzeFullStackCompatibility({ filePath, rootDir })).toEqual({ compatible: true });
    const { directory } = prepareSystemPlaywright({ rootDir, execution: { selectedFiles: [filePath] }, executionMode: 'frontend', frontendPort: 4173, runKey: 'helper' });
    const specs = path.join(directory, 'specs');
    const [name] = fs.readdirSync(specs);
    expect(name).toMatch(/\.spec\.mts$/);
    const copy = fs.readFileSync(path.join(specs, name), 'utf8');
    const helperUrl = JSON.stringify(pathToFileURL(helper).href);
    expect(copy).toContain(`from ${helperUrl}`);
    expect(copy).toContain(`import(${helperUrl})`);
    expect(copy).toContain(`from ${JSON.stringify(pathToFileURL(index).href)}`);
  });
  it.each(['js','cjs'])('runs CommonJS .%s Playwright imports through a CommonJS fixture and preserves the original file',(extension)=>{
    const directory=root();fs.mkdirSync(path.join(directory,'tests/e2e'),{recursive:true});
    const source="const {test,expect}=require('@playwright/test'); const helper=require('./helper'); const missing=require('./missing'); test('real',async({page})=>{await page.goto('/');});";
    const original=path.join(directory,`tests/e2e/crud.spec.${extension}`);
    const helper=path.join(directory,'tests/e2e/helper.cjs');
    fs.writeFileSync(helper,'module.exports = {};');
    fs.writeFileSync(original,source);
    const result=prepareSystemPlaywright({rootDir:directory,execution:{testDirectory:'tests/e2e'},executionMode:'frontend',frontendPort:4173,runKey:'cjs'});
    const specs=path.join(result.directory,'specs');
    const copy=fs.readFileSync(path.join(specs,fs.readdirSync(specs)[0]),'utf8');
    expect(copy).toContain(`require(${JSON.stringify(path.join(result.directory,'fixture.cjs'))})`);
    expect(copy).toContain(`require(${JSON.stringify(helper)})`);
    expect(copy).toContain("require('./missing')");
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
