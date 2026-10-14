import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from '@babel/parser';
import { pathToFileURL } from 'node:url';
import { containedPath } from './fullSystemLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { ensurePlaywrightExecutionSteps } from './playwrightExecutionSteps.service.js';
import { instrumentReviewedAssertions } from './systemAssertionEvidence.service.js';

export const validateFullSystemTest = (code) => {
  const ast=parse(code,{sourceType:'module',plugins:['typescript','jsx']});
  const visit=node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['fulfill','abort','routeFromHAR','route','addInitScript'].includes(node.callee?.property?.name || node.callee?.property?.value)) {
      throw new ServiceError('Full-system tests must call the real backend. API mocks, request routes, HAR replay and init-script replacements are not allowed; regenerate tests in full-system mode.',422);
    }
    for(const value of Object.values(node)) {if(Array.isArray(value)) value.forEach(visit); else if(value?.type) visit(value);}
  };
  visit(ast);
};

// Playwright transpiles import syntax to require() in CommonJS packages.
// Preserve each source file's module mode even when copying it out of a nested package.
const isModuleFile = file => {
  if (/\.(mjs|mts)$/.test(file)) return true;
  if (/\.(cjs|cts)$/.test(file)) return false;
  let directory=path.dirname(file);
  while (true) {
    const metadata=path.join(directory,'package.json');
    if (fs.existsSync(metadata)) {
      try { return JSON.parse(fs.readFileSync(metadata,'utf8')).type === 'module'; }
      catch { return false; }
    }
    const parent=path.dirname(directory);
    if (parent === directory) return false;
    directory=parent;
  }
};

export const prepareSystemPlaywright = ({rootDir,execution,executionMode,backendUrl,frontendPort,runKey,testFile,configPath,measurementPreparation,assertionBindings=[]}) => {
  const directory=path.join(rootDir,'.covai-system-test','runs',runKey);
  const specs=path.join(directory,'specs');
  fs.mkdirSync(specs,{recursive:true});
  const fixture=path.join(directory,'fixture.mjs');
  const commonJsFixture=path.join(directory,'fixture.cjs');
  const fixtureBody=`const backend=${JSON.stringify(backendUrl || null)};
const test=base.extend({
  ...(backend ? {request: async ({playwright, extraHTTPHeaders, httpCredentials, ignoreHTTPSErrors}, use, testInfo) => {
    const request=await playwright.request.newContext({baseURL:backend,extraHTTPHeaders,httpCredentials,ignoreHTTPSErrors});
    for (const method of ['get','post','put','patch','delete','head','fetch']) {
      const original=request[method].bind(request);
      request[method]=async (...args) => {
        const response=await original(...args);
        ${measurementPreparation ? `if(response.headers()['x-covai-measurement-id'] !== ${JSON.stringify(measurementPreparation.manifest.measurementId)}) throw new Error('Backend response does not belong to this AUT measurement');` : ''}
        if(response.status() >= 400) testInfo.annotations.push({type:'api-failure',description:method.toUpperCase()+' '+new URL(response.url()).pathname+': HTTP '+response.status()});
        return response;
      };
    }
    try {await use(request);} finally {await request.dispose();}
  }} : {}),
  _covaiRealBackend: [async ({page, context}, use) => {
    if (backend) {
      ${measurementPreparation ? `page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/') && response.headers()['x-covai-measurement-id'] !== ${JSON.stringify(measurementPreparation.manifest.measurementId)}){fs.writeFileSync(path.join(${JSON.stringify(measurementPreparation.directory)},'runtime-integrity-'+crypto.randomUUID()+'.json'),JSON.stringify({tier:'backend',measurementId:${JSON.stringify(measurementPreparation.manifest.measurementId)},sourceHash:${JSON.stringify(measurementPreparation.manifest.sourceHash)},coverage:{},incompleteReasons:['AUT_IDENTITY_MISMATCH']}));}});` : ''}
      await context.route('**/api/**', route => {const original=new URL(route.request().url());return route.continue({url:backend+original.pathname+original.search});});
      const forbidden=()=>{throw new Error('API mocking is prohibited in full-system mode');};
      page.route=forbidden; context.route=forbidden; page.routeFromHAR=forbidden; context.routeFromHAR=forbidden;
    }
    ${measurementPreparation ? `const archiveKey=${JSON.stringify('__covaiCoverageArchive_' + measurementPreparation.manifest.measurementId)};
    await context.addInitScript(key=>{const documentId=Math.random().toString(36);globalThis.__covaiCoverageDocumentId=documentId;addEventListener('pagehide',()=>{try{const archive=JSON.parse(sessionStorage.getItem(key)||'{}');archive[documentId]=globalThis.__coverage__ || {};sessionStorage.setItem(key,JSON.stringify(archive));}catch{globalThis.__covaiCoverageArchiveFailed=true;}});},archiveKey);
    const collect=async p=>{try{const sample=await p.evaluate(key=>({current:globalThis.__coverage__ || null,archive:JSON.parse(sessionStorage.getItem(key)||'{}'),failed:Boolean(globalThis.__covaiCoverageArchiveFailed),documentId:globalThis.__covaiCoverageDocumentId}),archiveKey);if(p.__covaiPreviousDocument && sample.documentId !== p.__covaiPreviousDocument && !sample.archive[p.__covaiPreviousDocument])sample.failed=true;p.__covaiPreviousDocument=sample.documentId;for(const coverage of [...Object.values(sample.archive),sample.current].filter(Boolean)){const file=path.join(${JSON.stringify(measurementPreparation.directory)},'runtime-frontend-'+crypto.randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify({tier:'frontend',measurementId:${JSON.stringify(measurementPreparation.manifest.measurementId)},sourceHash:${JSON.stringify(measurementPreparation.manifest.sourceHash)},coverage,incompleteReasons:sample.failed ? ['NAVIGATION_ARCHIVE_FAILED'] : []}));}}catch{}};
    const pending=new Set();const pages=new Set();const watch=p=>{pages.add(p);for(const method of ['goto','reload','close']){const original=p[method].bind(p);p[method]=async(...args)=>{await collect(p);return original(...args);};}const handler=()=>{const task=collect(p);pending.add(task);task.finally(()=>pending.delete(task));};p.on('framenavigated',handler);p.on('domcontentloaded',handler);};watch(page);context.on('page',watch);
    try {await use();} finally {await Promise.all([...pages].map(collect));await Promise.all([...pending]);}` : 'await use();'}
  }, {auto:true}]
});`;
  const helperBody = measurementPreparation ? `async function __covaiAssertion(binding,callback){let outcome='passed';try{await callback();if(base.info().errors.length)outcome='failed';}catch(error){outcome='failed';throw error;}finally{fs.writeFileSync(path.join(${JSON.stringify(measurementPreparation.directory)},'assertion-'+crypto.randomUUID()+'.json'),JSON.stringify({...binding,measurementId:${JSON.stringify(measurementPreparation.manifest.measurementId)},outcome,scenarioTitle:base.info().title}));}}` : '';
  fs.writeFileSync(fixture,`import {test as base} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export * from '@playwright/test';
${fixtureBody}
${helperBody}
export {test${measurementPreparation ? ',__covaiAssertion' : ''}};`, 'utf8');
  fs.writeFileSync(commonJsFixture,`const playwright=require('@playwright/test');
const base=playwright.test;
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
${fixtureBody}
${helperBody}
module.exports={...playwright,test${measurementPreparation ? ',__covaiAssertion' : ''}};`, 'utf8');
  const files=[];
  const fileMap={};
  const walk=directory => {
    if(!fs.existsSync(directory)) return;
    for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
      if(item.isSymbolicLink() || ['node_modules','.git','.covai-system-test'].includes(item.name)) continue;
      const file=path.join(directory,item.name);
      if(item.isDirectory()) walk(file);
      else if(/\.(spec|test)\.([cm]?[jt]s)$/.test(item.name)) files.push(file);
    }
  };
  if(execution.selectedFiles?.length) files.push(...execution.selectedFiles); else if(testFile) files.push(testFile); else walk(containedPath(rootDir,execution.testDirectory || 'tests/e2e'));
  if(!files.length) throw new ServiceError('No E2E test files were found for this run',422);
  for(const file of files) {
    const esm=isModuleFile(file);
    let code=fs.readFileSync(file,'utf8');
    if(executionMode === 'full') validateFullSystemTest(code);
    if(measurementPreparation && assertionBindings.length) code=instrumentReviewedAssertions({content:code,filePath:path.relative(rootDir,file).replaceAll('\\','/'),bindings:assertionBindings,helperImport:esm ? `import {__covaiAssertion} from ${JSON.stringify(pathToFileURL(fixture).href)};` : `const {__covaiAssertion}=require(${JSON.stringify(commonJsFixture)});`});
    // Record steps in the execution copy; user source and assertions stay intact.
    // Unsupported custom fixtures/dynamic tests still run without a guessed percentage.
    try { code=ensurePlaywrightExecutionSteps(code); } catch { /* Retain original semantics when instrumentation is unsupported. */ }
    const ast=parse(code,{sourceType:'module',plugins:['typescript','jsx']});
    const replacements=[];
    let hasPlaywright=false;
    for(const node of ast.program.body) if(node.type === 'ImportDeclaration') {
      const value=node.source.value;
      if(value === '@playwright/test') {
        hasPlaywright=true;
        replacements.push([node.source.start,node.source.end,JSON.stringify(esm ? pathToFileURL(fixture).href : commonJsFixture)]);
      }
      else if(value.startsWith('.')) {
        const resolved=path.resolve(path.dirname(file),value);
        replacements.push([node.source.start,node.source.end,JSON.stringify(esm ? pathToFileURL(resolved).href : resolved)]);
      }
    }
    const visit=node => {
      if(!node || typeof node !== 'object') return;
      if(node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 && node.arguments[0].type === 'StringLiteral') {
        const source=node.arguments[0];
        if(source.value === '@playwright/test') {
          hasPlaywright=true;
          replacements.push([source.start,source.end,JSON.stringify(commonJsFixture)]);
        } else if(source.value.startsWith('.')) {
          replacements.push([source.start,source.end,JSON.stringify(path.resolve(path.dirname(file),source.value))]);
        }
      }
      for(const value of Object.values(node)) {
        if(Array.isArray(value)) value.forEach(visit);
        else if(value?.type) visit(value);
      }
    };
    visit(ast);
    if(!hasPlaywright) throw new ServiceError(`Managed system test ${path.relative(rootDir,file)} must import or require @playwright/test`,422);
    for(const [start,end,value] of replacements.sort((a,b)=>b[0]-a[0])) code=code.slice(0,start)+value+code.slice(end);
    const extension=/\.[cm]?ts$/.test(file) ? (esm ? '.mts' : '.cts') : (esm ? '.mjs' : '.cjs');
    const target=path.join(specs,`${crypto.randomUUID()}.spec${extension}`);
    fileMap[path.basename(target)]=path.relative(rootDir,file).replace(/\\/g,'/');
    fs.writeFileSync(target,code,'utf8');
  }
  const config=path.join(directory,'playwright.config.mjs');
  const inherited=configPath ? `import original from ${JSON.stringify(pathToFileURL(configPath).href)};
import path from 'node:path';
const originalRoot=${JSON.stringify(path.dirname(configPath))};
const server=item=>({...item,cwd:path.resolve(originalRoot,item.cwd || '.')});
const base={...original,webServer:Array.isArray(original.webServer) ? original.webServer.map(server) : original.webServer ? server(original.webServer) : undefined};` : 'const base={};';
  fs.writeFileSync(config,`${inherited}
const use={headless:true,...base.use,${configPath ? '' : `baseURL:'http://127.0.0.1:${frontendPort}',`}screenshot:'on',trace:'retain-on-failure'};
export default {...base,testDir:'./specs',testMatch:'**/*.spec.*',workers:base.workers || 1,retries:${measurementPreparation || testFile ? 0 : 'base.retries ?? 1'},timeout:base.timeout || 30000,outputDir:'./artifacts',use,
projects:base.projects?.map(project=>({...project,testDir:${JSON.stringify(specs)},testMatch:'**/*.spec.*',use:{...use,...project.use,screenshot:'on',trace:'retain-on-failure'}}))};`,'utf8');
  const reportPath=path.join(directory,'results.json');
  fs.writeFileSync(path.join(directory,'source-map.json'),JSON.stringify(fileMap),'utf8');
  return {directory,reportPath,command:`npx playwright test --config "${path.relative(rootDir,config).replace(/\\/g,'/')}" --reporter=json > "${path.relative(rootDir,reportPath).replace(/\\/g,'/')}"`};
};

export const storeScenarioScreenshot = ({rootDir,source,runKey}) => {
  if(!source) return null;
  let data;
  if(typeof source==='object' && typeof source.body==='string') {
    if(source.body.length>20*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.body)) return null;
    data=Buffer.from(source.body,'base64');
  } else {
    if(typeof source!=='string') return null;
    const safeSource=containedPath(rootDir,path.relative(rootDir,source));
    if(!fs.existsSync(safeSource)) return null;
    data=fs.readFileSync(safeSource);
  }
  if(data.length > 15*1024*1024 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
  const relative=path.posix.join('.covai-system-test','evidence',runKey,`${crypto.randomUUID()}.png`);
  const target=containedPath(rootDir,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
  return relative;
};
