import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,afterEach} from '@jest/globals';
import {selectFrontendPackage,resolvePackageRuntime,runtimeDependencyFingerprint} from '../services/projectRuntimePlan.service.js';
import {snapshotIdentity} from '../services/systemAssessmentWorkspace.service.js';
import {resolveSystemRepositoryRoot} from '../services/fullSystemConfig.service.js';
const roots=[];
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-plan-'));roots.push(root);return root;};
const write=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('finds a nonstandard nested frontend independently of the root aggregator and backend',()=>{
    const root=fixture();write(root,'package.json',{scripts:{test:'npm test --prefix backend'}});
    write(root,'backend/package.json',{scripts:{start:'node app.js'},dependencies:{express:'5'}});
    write(root,'apps/storefront/package.json',{scripts:{dev:'vite'},devDependencies:{vite:'7'}});
    expect(selectFrontendPackage({rootDir:root})).toBe(path.join(root,'apps/storefront'));
});
it('requires evidence to distinguish multiple browser apps and can use selected test ownership',()=>{
    const root=fixture();
    for(const app of ['admin','store'])write(root,`apps/${app}/package.json`,{scripts:{dev:'next dev'},dependencies:{next:'15'}});
    expect(()=>selectFrontendPackage({rootDir:root})).toThrow('Multiple frontend');
    expect(selectFrontendPackage({rootDir:root,testFiles:['apps/store/e2e/cart.spec.js']})).toBe(path.join(root,'apps/store'));
});
it('installs a declared npm workspace at its root, retaining a child app working directory',()=>{
    const root=fixture();write(root,'package.json',{workspaces:['apps/*'],packageManager:'npm@11.6.2'});write(root,'package-lock.json','{}');
    write(root,'apps/shop/package.json',{scripts:{dev:'vite'}});
    const plan=resolvePackageRuntime({directory:path.join(root,'apps/shop'),repositoryRoot:root});
    expect(plan.installRoot).toBe(root);expect(plan.directory).toBe(path.join(root,'apps/shop'));
    expect(plan.install).toContain('npm ci --include=dev --include=optional');
});
it('recognizes nested pnpm workspace members and honors exclusions',()=>{
    const root=fixture();write(root,'package.json',{packageManager:'pnpm@10.0.0'});
    write(root,'pnpm-workspace.yaml',"packages:\n  - 'apps/**'\n  - '!apps/excluded'\n");write(root,'pnpm-lock.yaml','lockfileVersion: 9');
    for(const app of ['nested/shop','excluded'])write(root,`apps/${app}/package.json`,{scripts:{dev:'vite'}});
    const plan=resolvePackageRuntime({directory:path.join(root,'apps/nested/shop'),repositoryRoot:root});
    expect(plan.installRoot).toBe(root);expect(plan.install).toContain('pnpm install --frozen-lockfile --prod=false');
    expect(resolvePackageRuntime({directory:path.join(root,'apps/excluded'),repositoryRoot:root}).installRoot).toBe(path.join(root,'apps/excluded'));
});
it('supports YAML inline lists, aliases and brace workspace patterns',()=>{
    const root=fixture();write(root,'package.json',{packageManager:'pnpm@10.0.0'});
    write(root,'pnpm-workspace.yaml',"packages: ['apps/{shop,admin}']\n");write(root,'apps/shop/package.json',{});
    expect(resolvePackageRuntime({directory:path.join(root,'apps/shop'),repositoryRoot:root}).installRoot).toBe(root);
    write(root,'pnpm-workspace.yaml',"paths: &apps\n  - 'apps/*'\npackages: *apps\n");
    expect(resolvePackageRuntime({directory:path.join(root,'apps/shop'),repositoryRoot:root}).installRoot).toBe(root);
});
it('recovers a deeply selected workspace package without guessing unrelated parent roots',()=>{
    const root=fixture();write(root,'package.json',{workspaces:['apps/*']});write(root,'apps/api/package.json',{});
    expect(resolveSystemRepositoryRoot(path.join(root,'apps/api'))).toBe(root);
    write(root,'unrelated/package.json',{});expect(resolveSystemRepositoryRoot(path.join(root,'unrelated'))).toBe(path.join(root,'unrelated'));
});
it('reports incompatible Node engines before attempting installation or startup',()=>{
    const root=fixture();write(root,'package.json',{engines:{node:'<10'}});
    expect(()=>resolvePackageRuntime({directory:root})).toThrow('requires Node.js <10');
    write(root,'package.json',{engines:{node:'>=18 || ^16.20'}});
    expect(resolvePackageRuntime({directory:root}).manager).toBe('npm');
});
it.each([
    ['npm','package-lock.json','ci --include=dev'],['pnpm','pnpm-lock.yaml','install --frozen-lockfile --prod=false'],
    ['yarn','yarn.lock','install --immutable'],['bun','bun.lock','install --frozen-lockfile'],
])('selects %s from explicit metadata and lockfiles',(manager,lock,expected)=>{
    const root=fixture();write(root,'package.json',{packageManager:`${manager}@4.0.0`});write(root,lock,'{}');
    const plan=resolvePackageRuntime({directory:root});expect(plan.manager).toBe(manager);expect(plan.install).toContain(expected);
    if(manager==='yarn')expect(plan.env.YARN_NODE_LINKER).toBe('node-modules');
});
it('rejects conflicting lockfiles, command injection and paths outside the repository',()=>{
    const root=fixture();write(root,'package.json',{});write(root,'package-lock.json','{}');write(root,'yarn.lock','');
    expect(()=>resolvePackageRuntime({directory:root})).toThrow('Conflicting');
    write(root,'package.json',{packageManager:'npm@1.0.0 && echo bad'});
    expect(()=>resolvePackageRuntime({directory:root})).toThrow('exact version');
    expect(()=>resolvePackageRuntime({directory:path.dirname(root),repositoryRoot:root})).toThrow('inside');
});
it('requires local file dependencies to remain inside the imported repository',()=>{
    const root=fixture();write(root,'package.json',{dependencies:{private:'file:../another-project'}});
    expect(()=>resolvePackageRuntime({directory:root})).toThrow('inside');
});
it('fingerprints resolved dependencies independently of temporary paths and excludes generated caches',()=>{
    const one=fixture(),two=fixture();
    for(const root of [one,two]) {write(root,'package.json',{});write(root,'package-lock.json','{}');}
    expect(runtimeDependencyFingerprint(one)).toBe(runtimeDependencyFingerprint(two));
    write(one,'.next/cache/large.js','x'.repeat(6*1024*1024));
    expect(snapshotIdentity(one).files.map(file=>file.path)).not.toContain('.next/cache/large.js');
    expect(runtimeDependencyFingerprint(one)).toBe(runtimeDependencyFingerprint(two));
    write(two,'package-lock.json','{"version":2}');expect(runtimeDependencyFingerprint(one)).not.toBe(runtimeDependencyFingerprint(two));
});
it('recovery journals do not alter source identity, but source edits do',()=>{
    const root=fixture();write(root,'package.json',{});write(root,'src/a.js','export const a = 1;');
    const before=snapshotIdentity(root);
    write(root,'.covai-collaboration/save.json',{state:'PREPARED'});
    write(root,'.covai-collaboration/content.before','prior bytes');
    write(root,'.covai-temp/operation/log.json',{progress:50});
    expect(snapshotIdentity(root)).toEqual(before);
    write(root,'src/a.js','export const a = 2;');
    expect(snapshotIdentity(root)).not.toEqual(before);
});
