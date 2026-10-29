import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jest,it,expect,afterEach} from '@jest/globals';
await jest.unstable_mockModule('../services/job.service.js',()=>({addJobLog:jest.fn()}));
await jest.unstable_mockModule('../services/dockerRunner.service.js',()=>({dockerRunner:{run:jest.fn()}}));
const {prepareProjectDependencies,verifyRuntimeTooling}=await import('../services/projectDependencies.service.js');
const {withProjectDependencyCache,currentDependencyCache,registerDependencyWorkspace}=await import('../services/projectDependencyCache.service.js');
const {runtimeDependencyFingerprint}=await import('../services/projectRuntimePlan.service.js');
const roots=[];
const fixture=(pkg={scripts:{dev:'vite'},devDependencies:{vite:'7'}})=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-deps-'));roots.push(root);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));return root;
};
const tooling=root=>{fs.mkdirSync(path.join(root,'node_modules/vite'),{recursive:true});fs.writeFileSync(path.join(root,'node_modules/vite/package.json'),'{"name":"vite","type":"module","main":"index.js"}');fs.writeFileSync(path.join(root,'node_modules/vite/index.js'),'throw new Error("resolution must not execute application packages");');};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('copies job-local prepared dependencies into independent runs without sharing mutable files',async()=>{
    const first=fixture(),second=fixture();
    for(const root of [first,second])fs.writeFileSync(path.join(root,'package-lock.json'),'{}');
    const run=jest.fn(async options=>{tooling(options.snapshotPath);return {success:true};});
    let cacheRoot;
    await withProjectDependencyCache(async()=>{
        cacheRoot=currentDependencyCache().root;
        await prepareProjectDependencies({directory:first,dependencies:{run}});
        await prepareProjectDependencies({directory:second,dependencies:{run}});
        expect(run).toHaveBeenCalledTimes(1);
        fs.writeFileSync(path.join(second,'node_modules/vite/index.js'),'changed in run two');
        expect(fs.readFileSync(path.join(first,'node_modules/vite/index.js'),'utf8')).not.toBe('changed in run two');
    });
    expect(fs.existsSync(cacheRoot)).toBe(false);
    const third=fixture();fs.writeFileSync(path.join(third,'package-lock.json'),'{}');
    await withProjectDependencyCache(()=>prepareProjectDependencies({directory:third,dependencies:{run}}));
    expect(run).toHaveBeenCalledTimes(2);
});
it('invalidates cached dependencies for a different lockfile and skips custom lifecycle hooks',async()=>{
    const run=jest.fn(async options=>{tooling(options.snapshotPath);return {success:true};});
    await withProjectDependencyCache(async()=>{
        for(const [index,pkg] of [{},{},{scripts:{postinstall:'node setup.js'}},{scripts:{postinstall:'node setup.js'}}].entries()){
            const directory=fixture(pkg);
            fs.writeFileSync(path.join(directory,'package-lock.json'),index===1?'different':'{}');
            await prepareProjectDependencies({directory,dependencies:{run}});
        }
    });
    expect(run).toHaveBeenCalledTimes(4);
});
it('freezes an initially missing lockfile and reuses the same resolved dependency versions',async()=>{
    const first=fixture(),second=fixture();
    const run=jest.fn(async options=>{
        tooling(options.snapshotPath);
        fs.writeFileSync(path.join(options.snapshotPath,'package-lock.json'),'{"lockfileVersion":3,"resolved":"first installation"}');
        return {success:true};
    });
    await withProjectDependencyCache(async()=>{
        await prepareProjectDependencies({directory:first,dependencies:{run}});
        await prepareProjectDependencies({directory:second,dependencies:{run}});
        expect(run).toHaveBeenCalledTimes(1);
        expect(runtimeDependencyFingerprint(first)).toBe(runtimeDependencyFingerprint(second));
    });
});
it('reconciles runner-created partial modules only in registered disposable workspaces',async()=>{
    const first=fixture(),second=fixture(),original=fixture();
    for(const root of [first,second,original])fs.writeFileSync(path.join(root,'package-lock.json'),'{}');
    const run=jest.fn(async options=>{tooling(options.snapshotPath);return {success:true};});
    await withProjectDependencyCache(async()=>{
        await prepareProjectDependencies({directory:first,dependencies:{run}});
        for(const root of [second,original])fs.mkdirSync(path.join(root,'node_modules/partial-runner-package'),{recursive:true});
        registerDependencyWorkspace(second);
        await prepareProjectDependencies({directory:second,dependencies:{run}});
        expect(run).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(second,'node_modules/partial-runner-package'))).toBe(false);
        await prepareProjectDependencies({directory:original,dependencies:{run}});
        expect(run).toHaveBeenCalledTimes(2);
        expect(fs.existsSync(path.join(original,'node_modules/partial-runner-package'))).toBe(true);
    });
});
it('reconciles partial node_modules and reuses only a verified matching preparation',async()=>{
    const directory=fixture();fs.mkdirSync(path.join(directory,'node_modules/@playwright/test'),{recursive:true});
    const run=jest.fn(async()=>{tooling(directory);return {success:true};});
    const options={directory,dependencies:{run}};
    await prepareProjectDependencies(options);await prepareProjectDependencies(options);
    expect(run).toHaveBeenCalledTimes(1);expect(run.mock.calls[0][0].command).toContain('npm install --include=dev --include=optional');
    expect(run.mock.calls[0][0].env).toMatchObject({NODE_ENV:'development',NODE_PATH:'',NODE_OPTIONS:''});
    fs.rmSync(path.join(directory,'node_modules/vite'),{recursive:true});
    await prepareProjectDependencies(options);expect(run).toHaveBeenCalledTimes(2);
});
it('stops on a nonzero install before writing a success receipt and redacts secrets',async()=>{
    const directory=fixture(),run=jest.fn().mockResolvedValue({success:false,exitCode:1,stderr:'npm ERR! token-value'});
    await expect(prepareProjectDependencies({directory,env:{API_TOKEN:'token-value'},dependencies:{run}})).rejects.toThrow('npm ERR! [redacted]');
    expect(fs.existsSync(path.join(directory,'.covai-system-test/runtime-dependencies.json'))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
});
it('repairs an out-of-sync npm lock only once and does not retry unrelated failures',async()=>{
    const directory=fixture({}),run=jest.fn().mockResolvedValueOnce({success:false,stderr:'npm error EUSAGE package.json and lock must be in sync'}).mockResolvedValue({success:true});
    fs.writeFileSync(path.join(directory,'package-lock.json'),'{}');
    await prepareProjectDependencies({directory,dependencies:{run}});
    expect(run.mock.calls[0][0].command).toContain('npm ci');expect(run.mock.calls[1][0].command).toContain('npm install');
});
it('does not treat a zero installer exit as evidence that local ESM tools can resolve',async()=>{
    const directory=fixture(),run=jest.fn().mockResolvedValue({success:true});
    await expect(prepareProjectDependencies({directory,dependencies:{run}})).rejects.toMatchObject({code:'AUT_DEPENDENCY_MISSING'});
    await expect(verifyRuntimeTooling({directory,repositoryRoot:directory,pkg:{devDependencies:{vite:'7'}}})).rejects.toThrow('vite');
});
it('reuses one workspace install for backend and hoisted frontend instead of deleting live dependencies',async()=>{
    const root=fixture({workspaces:['apps/*']});
    const backend=path.join(root,'apps/api'),frontend=path.join(root,'apps/shop');
    for(const directory of [backend,frontend])fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(backend,'package.json'),'{"scripts":{"start":"node app.js"}}');
    fs.writeFileSync(path.join(frontend,'package.json'),'{"devDependencies":{"vite":"7"}}');
    const run=jest.fn(async()=>{tooling(root);return {success:true};});
    await prepareProjectDependencies({directory:backend,repositoryRoot:root,dependencies:{run}});
    await prepareProjectDependencies({directory:frontend,repositoryRoot:root,dependencies:{run}});
    expect(run).toHaveBeenCalledTimes(1);expect(run.mock.calls[0][0].snapshotPath).toBe(root);
});
it('does not start installation after cancellation',async()=>{
    const directory=fixture(),controller=new AbortController();controller.abort();const run=jest.fn();
    await expect(prepareProjectDependencies({directory,signal:controller.signal,dependencies:{run}})).rejects.toMatchObject({statusCode:409});
    expect(run).not.toHaveBeenCalled();
});
it('serializes three simultaneous preparations sharing one workspace receipt',async()=>{
    const directory=fixture();
    let active=0,maximum=0;
    const verify=jest.fn(async()=>{
        active++;maximum=Math.max(maximum,active);
        await new Promise(resolve=>setTimeout(resolve,10));
        active--;
    });
    const run=jest.fn().mockResolvedValue({success:true});
    const options={directory,dependencies:{run,verify}};
    await Promise.all([prepareProjectDependencies(options),prepareProjectDependencies(options),prepareProjectDependencies(options)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(maximum).toBe(1);
    expect(verify).toHaveBeenCalledTimes(3);
});
