import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jest,it,expect,beforeEach,afterEach} from '@jest/globals';
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
const cacheEnvKeys = ['COVAI_DEPENDENCY_CACHE', 'COVAI_DEPENDENCY_CACHE_DIR', 'COVAI_DEPENDENCY_CACHE_MAX_ENTRIES'];
let originalCacheEnv;
beforeEach(() => {
    originalCacheEnv = cacheEnvKeys.map(name => process.env[name]);
    process.env.COVAI_DEPENDENCY_CACHE = 'off';
    delete process.env.COVAI_DEPENDENCY_CACHE_MAX_ENTRIES;
});
afterEach(() => {
    for (const [index, name] of cacheEnvKeys.entries()) {
        if (originalCacheEnv[index] === undefined) delete process.env[name];
        else process.env[name] = originalCacheEnv[index];
    }
    for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true,force:true});
});

const persistentFixture = () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-persistent-deps-'));
    roots.push(cacheRoot);
    delete process.env.COVAI_DEPENDENCY_CACHE;
    process.env.COVAI_DEPENDENCY_CACHE_DIR = cacheRoot;
    const run = jest.fn(async ({snapshotPath}) => {
        const modules = path.join(snapshotPath, 'node_modules');
        for (const name of ['pkg', '.vite', '.cache', '.prisma']) {
            fs.mkdirSync(path.join(modules, name), {recursive:true});
            fs.writeFileSync(path.join(modules, name, 'package.json'), '{"name":"pkg"}');
        }
        fs.writeFileSync(path.join(snapshotPath, 'package-lock.json'), '{"lockfileVersion":3,"resolved":"installed"}');
        return {success:true};
    });
    const verify = jest.fn(async plan => {
        expect(fs.existsSync(path.join(plan.installRoot, 'node_modules/pkg/package.json'))).toBe(true);
    });
    const prepare = (pkg = {dependencies:{pkg:'1'}}) => {
        const directory = fixture(pkg);
        fs.writeFileSync(path.join(directory, 'package-lock.json'), '{"lockfileVersion":3}');
        return prepareProjectDependencies({directory, dependencies:{run, verify}});
    };
    const entries = () => fs.readdirSync(cacheRoot).map(name => path.join(cacheRoot, name));
    return {run, verify, prepare, entries};
};

it('persists a complete dependency template across jobs and keys it by manifest', async () => {
    const {run, verify, prepare, entries} = persistentFixture();
    const first = await withProjectDependencyCache(() => prepare());
    expect(run).toHaveBeenCalledTimes(1);
    expect(entries()).toHaveLength(1);
    const [entry] = entries();
    const metadataPath = path.join(entry, 'meta.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata).toEqual({createdAt:expect.any(String),lastUsedAt:expect.any(String),sizeHintFiles:1});
    const old = new Date(0).toISOString();
    fs.writeFileSync(metadataPath, JSON.stringify({...metadata,lastUsedAt:old}));
    expect(fs.readdirSync(path.join(entry, 'node_modules'))).toEqual(['pkg']);

    const second = await withProjectDependencyCache(() => prepare());
    expect(run).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(second.directory, 'package-lock.json'), 'utf8'))
        .toBe(fs.readFileSync(path.join(entry, 'locks/package-lock.json'), 'utf8'));
    expect(fs.existsSync(path.join(second.directory, '.covai-system-test/runtime-dependencies.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).lastUsedAt).not.toBe(old);
    fs.writeFileSync(path.join(second.directory, 'node_modules/pkg/package.json'), '{}');
    expect(fs.readFileSync(path.join(entry, 'node_modules/pkg/package.json'), 'utf8')).toBe('{"name":"pkg"}');
    expect(fs.readFileSync(path.join(first.directory, 'node_modules/pkg/package.json'), 'utf8')).toBe('{"name":"pkg"}');

    await prepare({dependencies:{pkg:'2'}});
    expect(run).toHaveBeenCalledTimes(2);
    expect(entries()).toHaveLength(2);
});

it('replaces an incomplete persistent entry after installing normally', async () => {
    const {run, prepare, entries} = persistentFixture();
    await prepare();
    const [entry] = entries();
    const metadataPath = path.join(entry, 'meta.json');
    fs.rmSync(metadataPath);
    await prepare();
    expect(run).toHaveBeenCalledTimes(2);
    expect(entries()).toEqual([entry]);
    expect(fs.existsSync(metadataPath)).toBe(true);
});

it('discards an unverifiable persistent template and installs again', async () => {
    const {run, verify, prepare, entries} = persistentFixture();
    await prepare();
    const [entry] = entries();
    fs.writeFileSync(path.join(entry, 'node_modules/pkg/stale'), '');
    verify.mockRejectedValueOnce(new Error('invalid cached tree'));
    const second = await prepare();
    expect(run).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(second.directory, 'node_modules/pkg/stale'))).toBe(false);
    expect(fs.existsSync(path.join(entry, 'node_modules/pkg/stale'))).toBe(false);
});

it('evicts the least recently used old entry and protects recent entries', async () => {
    const {prepare, entries} = persistentFixture();
    process.env.COVAI_DEPENDENCY_CACHE_MAX_ENTRIES = '2';
    const oldEntries = [];
    for (const version of ['1', '2']) {
        await prepare({dependencies:{pkg:version}});
        const entry = entries().find(candidate => !oldEntries.includes(candidate));
        oldEntries.push(entry);
        const metadataPath = path.join(entry, 'meta.json');
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        fs.writeFileSync(metadataPath, JSON.stringify({...metadata,lastUsedAt:new Date(Number(version)).toISOString()}));
    }
    await prepare({dependencies:{pkg:'3'}});
    expect(entries()).toHaveLength(2);
    expect(entries()).not.toContain(oldEntries[0]);
    expect(entries()).toContain(oldEntries[1]);
    process.env.COVAI_DEPENDENCY_CACHE_MAX_ENTRIES = '1';
    await prepare({dependencies:{pkg:'4'}});
    expect(entries()).toHaveLength(2);
    expect(entries()).not.toContain(oldEntries[1]);
});

it('installs in every fresh copy when the persistent cache is off', async () => {
    const {run, prepare, entries} = persistentFixture();
    await prepare();
    process.env.COVAI_DEPENDENCY_CACHE = 'off';
    await prepare();
    await prepare();
    expect(run).toHaveBeenCalledTimes(3);
    expect(entries()).toHaveLength(1);
});

it('skips a cache directory configured inside the imported project', async () => {
    const {run, verify} = persistentFixture();
    const directory = fixture();
    const cacheRoot = path.join(directory, '.covai-temp', 'dependency-cache');
    process.env.COVAI_DEPENDENCY_CACHE_DIR = cacheRoot;
    await prepareProjectDependencies({directory, dependencies:{run, verify}});
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cacheRoot)).toBe(false);
});
it('allows a queued preparation to recover after an earlier caller fails',async()=>{
    const directory=fixture({});
    let failFirst;
    let markStarted;
    const started=new Promise(resolve=>{markStarted=resolve;});
    const firstRun=jest.fn(()=>new Promise(resolve=>{failFirst=()=>resolve({success:false,stderr:'temporary registry failure'});markStarted();}));
    const secondRun=jest.fn(async()=>({success:true}));
    const first=prepareProjectDependencies({directory,dependencies:{run:firstRun,verify:async()=>{}}});
    const firstFailure=expect(first).rejects.toThrow('temporary registry failure');
    const second=prepareProjectDependencies({directory,dependencies:{run:secondRun,verify:async()=>{}}});
    await started;
    failFirst();
    await firstFailure;
    await expect(second).resolves.toMatchObject({directory});
    expect(secondRun).toHaveBeenCalledTimes(1);
});
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
it('accepts installed CLI-only tooling without an importable entry point (react-scripts)',async()=>{
    const directory=fixture({scripts:{start:'react-scripts start'},dependencies:{'react-scripts':'5'}});
    fs.mkdirSync(path.join(directory,'node_modules/react-scripts/bin'),{recursive:true});
    fs.writeFileSync(path.join(directory,'node_modules/react-scripts/package.json'),'{"name":"react-scripts","bin":{"react-scripts":"./bin/react-scripts.js"}}');
    await expect(verifyRuntimeTooling({directory,repositoryRoot:directory,pkg:{dependencies:{'react-scripts':'5'}}})).resolves.toBeUndefined();
});
it('finds hoisted workspace tooling and reports only the packages that are really missing',async()=>{
    const root=fixture({workspaces:['apps/*']});const app=path.join(root,'apps/web');fs.mkdirSync(app,{recursive:true});
    tooling(root);
    await expect(verifyRuntimeTooling({directory:app,repositoryRoot:root,pkg:{devDependencies:{vite:'7',nodemon:'3'}}})).rejects.toThrow('Application dependencies are incomplete: nodemon.');
});
it('does not borrow tooling installed above the repository root',async()=>{
    const outer=fixture({});tooling(outer);const repo=path.join(outer,'repo');fs.mkdirSync(repo);
    await expect(verifyRuntimeTooling({directory:repo,repositoryRoot:repo,pkg:{devDependencies:{vite:'7'}}})).rejects.toMatchObject({code:'AUT_DEPENDENCY_MISSING'});
});
