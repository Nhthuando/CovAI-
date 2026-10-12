import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from '@babel/parser';
import { pathToFileURL } from 'node:url';
import { containedPath } from './fullSystemLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';

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

export const prepareSystemPlaywright = ({rootDir,execution,executionMode,backendUrl,frontendPort,runKey,testFile}) => {
  const directory=path.join(rootDir,'.covai-system-test','runs',runKey);
  const specs=path.join(directory,'specs');
  fs.mkdirSync(specs,{recursive:true});
  const fixture=path.join(directory,'fixture.mjs');
  const commonJsFixture=path.join(directory,'fixture.cjs');
  const fixtureBody=`const test=base.extend({
  _covaiRealBackend: [async ({page, context}, use) => {
    const backend=${JSON.stringify(backendUrl || null)};
    if (backend) {
      await context.route('**/api/**', route => {const original=new URL(route.request().url());return route.continue({url:backend+original.pathname+original.search});});
      const forbidden=()=>{throw new Error('API mocking is prohibited in full-system mode');};
      page.route=forbidden; context.route=forbidden; page.routeFromHAR=forbidden; context.routeFromHAR=forbidden;
    }
    await use();
  }, {auto:true}]
});`;
  fs.writeFileSync(fixture,`import {test as base} from '@playwright/test';
export * from '@playwright/test';
export ${fixtureBody}`, 'utf8');
  fs.writeFileSync(commonJsFixture,`const playwright=require('@playwright/test');
const base=playwright.test;
${fixtureBody}
module.exports={...playwright,test};`, 'utf8');
  const files=[];
  const fileMap={};
  const walk=directory => {
    if(!fs.existsSync(directory)) return;
    for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
      if(item.isSymbolicLink() || ['node_modules','.git','.covai-system-test'].includes(item.name)) continue;
      const file=path.join(directory,item.name);
      if(item.isDirectory()) walk(file);
      else if(/\.(spec|test)\.([cm]?js|ts)$/.test(item.name)) files.push(file);
    }
  };
  if(testFile) files.push(testFile); else walk(containedPath(rootDir,execution.testDirectory || 'tests/e2e'));
  if(!files.length) throw new ServiceError('No E2E test files were found for this run',422);
  for(const file of files) {
    let code=fs.readFileSync(file,'utf8');
    if(executionMode === 'full') validateFullSystemTest(code);
    const ast=parse(code,{sourceType:'module',plugins:['typescript','jsx']});
    const replacements=[];
    let hasPlaywright=false;
    for(const node of ast.program.body) if(node.type === 'ImportDeclaration') {
      const value=node.source.value;
      if(value === '@playwright/test') {
        hasPlaywright=true;
        replacements.push([node.source.start,node.source.end,JSON.stringify(pathToFileURL(fixture).href)]);
      }
      else if(value.startsWith('.')) replacements.push([node.source.start,node.source.end,JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),value)).href)]);
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
    const target=path.join(specs,`${crypto.randomUUID()}.spec${path.extname(file)}`);
    fileMap[path.basename(target)]=path.relative(rootDir,file).replace(/\\/g,'/');
    fs.writeFileSync(target,code,'utf8');
  }
  const config=path.join(directory,'playwright.config.mjs');
  fs.writeFileSync(config,`export default {testDir:'./specs',testMatch:'**/*.spec.*',workers:1,retries:${testFile ? 0 : 1},timeout:30000,outputDir:'./artifacts',use:{headless:true,baseURL:'http://127.0.0.1:${frontendPort}',screenshot:'on',trace:'retain-on-failure'}};`,'utf8');
  const reportPath=path.join(directory,'results.json');
  fs.writeFileSync(path.join(directory,'source-map.json'),JSON.stringify(fileMap),'utf8');
  return {directory,reportPath,command:`npx playwright test --config "${path.relative(rootDir,config).replace(/\\/g,'/')}" --reporter=json > "${path.relative(rootDir,reportPath).replace(/\\/g,'/')}"`};
};

export const storeScenarioScreenshot = ({rootDir,source,runKey}) => {
  if(!source) return null;
  const safeSource=containedPath(rootDir,path.relative(rootDir,source));
  if(!fs.existsSync(safeSource)) return null;
  const data=fs.readFileSync(safeSource);
  if(data.length > 15*1024*1024 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
  const relative=path.posix.join('.covai-system-test','evidence',runKey,`${crypto.randomUUID()}.png`);
  const target=containedPath(rootDir,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(safeSource,target);
  return relative;
};
