import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {it,expect,afterEach} from '@jest/globals';
import {resolveProjectPlaywrightConfig,ensurePlaywrightPrerequisites} from '../services/systemTestRunner.service.js';
import {prepareSystemPlaywright} from '../services/systemTestEvidence.service.js';
const roots=[];
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-project-config-'));roots.push(root);return root;};
const write=(root,file,content)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);return target;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('uses the configuration belonging to the selected test package',()=>{
    const root=fixture(),config=write(root,'apps/shop/playwright.config.ts','export default {};');
    const file=write(root,'apps/shop/e2e/home.spec.ts','');
    write(root,'apps/admin/playwright.config.ts','export default {};');
    expect(resolveProjectPlaywrightConfig(root,{selectedFiles:[file]})).toBe(config);
    expect(()=>resolveProjectPlaywrightConfig(root,{selectedFiles:[file,path.join(root,'apps/admin/e2e/home.spec.ts')]})).toThrow('different Playwright');
    expect(()=>resolveProjectPlaywrightConfig(root,{configPath:'../outside.js'})).toThrow('inside');
});
it('links the selected package runner version instead of substituting CovAI dependencies',()=>{
    const root=fixture(),app=path.join(root,'client');
    for(const pkg of ['@playwright/test','playwright','playwright-core'])write(app,`node_modules/${pkg}/package.json`,'{}');
    ensurePlaywrightPrerequisites(root,4400,{dependencyRoot:app});
    for(const pkg of ['@playwright/test','playwright','playwright-core'])expect(fs.realpathSync(path.join(root,'node_modules',pkg))).toBe(fs.realpathSync(path.join(app,'node_modules',pkg)));
});
it.each(['mjs','cjs'])('preserves actual %s user configuration while managing the server and dynamic URL',async extension=>{
    const root=fixture();write(root,'package.json','{"type":"module"}');
    const settings="{timeout:12345,expect:{timeout:2345},globalSetup:'./setup.mjs',use:{locale:'fr-FR',viewport:{width:777,height:555}},webServer:{command:'node nonexistent-server.js'},projects:[{name:'custom',use:{locale:'de-DE',baseURL:'http://localhost:1'}}]}";
    const config=write(root,`client/playwright.config.${extension}`,`${extension==='cjs'?'module.exports=':'export default '}${settings};`);
    write(root,'client/setup.mjs','export default ()=>{};');write(root,'client/tsconfig.json','{}');
    const file=write(root,'client/e2e/home.spec.mjs',"import{test,expect}from'@playwright/test';test('home',async({page})=>{await page.goto('/');await expect(page.locator('h1')).toBeVisible();});");
    const managed=prepareSystemPlaywright({rootDir:root,execution:{selectedFiles:[file]},executionMode:'frontend',frontendPort:4400,runKey:'managed',configPath:config,managedServer:true});
    const value=(await import(pathToFileURL(path.join(managed.directory,'playwright.config.mjs')).href)).default;
    expect(value.timeout).toBe(12345);expect(value.expect.timeout).toBe(2345);expect(value.webServer).toBeUndefined();
    expect(value.globalSetup).toBe(path.join(root,'client/setup.mjs'));expect(value.tsconfig).toBe(path.join(root,'client/tsconfig.json'));
    expect(value.use).toMatchObject({locale:'fr-FR',viewport:{width:777,height:555},baseURL:'http://127.0.0.1:4400'});
    expect(value.projects[0]).toMatchObject({name:'custom',use:{locale:'de-DE',baseURL:'http://127.0.0.1:4400'}});
});
