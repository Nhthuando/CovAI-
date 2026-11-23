import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, jest, it, beforeEach, afterEach } from '@jest/globals';

const prepare=jest.fn(),environment=jest.fn(),setup=jest.fn(),inspect=jest.fn();
const provision=jest.fn(),reserve=jest.fn(),start=jest.fn(),stop=jest.fn(),seed=jest.fn();
const spawn=jest.fn();
await jest.unstable_mockModule('node:child_process',()=>({...jest.requireActual('node:child_process'),spawn}));
await jest.unstable_mockModule('../services/fullSystemRuntime.service.js',()=>({prepareFullSystemPackage:prepare,readAssessmentTestEnvironment:environment}));
await jest.unstable_mockModule('../services/fullSystemSetup.service.js',()=>({ensureFullSystemSetup:setup,inspectSystemPackageSource:inspect}));
await jest.unstable_mockModule('../services/systemRuntimeResources.service.js',()=>({provisionSystemResources:provision}));
await jest.unstable_mockModule('../services/systemRuntimePorts.service.js',()=>({reserveSystemPorts:reserve}));
await jest.unstable_mockModule('../services/autLifecycle.service.js',()=>({startAutServer:start,stopAutServer:stop,runSeedDataIfPresent:seed}));
const {startFullSystem}=await import('../services/fullSystemLifecycle.service.js');
let root,config,release,cleanup;
beforeEach(()=>{
    jest.resetAllMocks();
    root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-lifecycle-'));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5'}}));
    config={frontend:{directory:'.'},backend:{directory:'.',healthPath:'/',readiness:'http'},unified:true,backendOnly:true,database:null};
    setup.mockImplementation(async()=>({rootDir:root,config}));
    inspect.mockReturnValue({packages:[{directory:'.',scripts:{start:'node index.js'}}],files:[{path:'index.js',content:'if(!process.env.PORT)throw Error();if(!process.env.CLIENT_URL)throw Error();'}]});
    environment.mockReturnValue({});
    release=jest.fn(async()=>{});reserve.mockResolvedValue([{port:43123,release}]);
    cleanup=jest.fn(async()=>{});provision.mockResolvedValue({environment:{},cleanup});
    start.mockResolvedValue({started:true,pid:123,port:43123});
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));

test('returns 422 when the backend has no startup script or server entry file', async () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'index.js' }));
    inspect.mockReturnValue({ packages: [{ directory: '.', scripts: {} }], files: [] });
    start.mockResolvedValue({ started: false });

    await expect(startFullSystem({ rootDir: root })).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('No application start script or server entry file (server.js, app.js, index.js) was found.'),
    });
});

describe('backend NODE_OPTIONS ignores imported project options', () => {
    test.each([
        ['keeps the resource mock before the port preload and IPv4 option', '--require=/mock.cjs', '--require=/mock.cjs ', ' --dns-result-order=ipv4first'],
        ['uses the port preload and IPv4 option when resource options are undefined', undefined, '', ' --dns-result-order=ipv4first'],
        ['keeps the existing IPv4 option once', '--dns-result-order=ipv4first', '--dns-result-order=ipv4first ', ''],
    ])('%s', async (_name, resourceNodeOptions, expectedPrefix, expectedSuffix) => {
        environment.mockReturnValue({ NODE_OPTIONS: '--require=/project.cjs' });
        provision.mockResolvedValue({ environment: { NODE_OPTIONS: resourceNodeOptions }, cleanup });
        const preload = fileURLToPath(new URL('../utils/autPortOverride.cjs', import.meta.url)).replaceAll('\\', '/');
        const recorder = fileURLToPath(new URL('../utils/externalCallRecorder.cjs', import.meta.url)).replaceAll('\\', '/');

        const runtime = await startFullSystem({ rootDir: root });
        await runtime.cleanup();

        expect(start.mock.calls[0][0].env.NODE_OPTIONS).toBe(`${expectedPrefix}--require="${preload}" --require="${recorder}"${expectedSuffix}`);
    });
});

test('skips Docker exec for PostgreSQL init SQL in mock mode', async () => {
    const initSql = '.covai/generated-schema.sql';
    config.database = { engine: 'postgres', initSql };
    fs.mkdirSync(path.join(root, '.covai'));
    fs.writeFileSync(path.join(root, initSql), 'CREATE TABLE todos (id INTEGER);');
    provision.mockResolvedValue({ mode: 'mock', environment: {}, sqlContainer: null, cleanup });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
        const runtime = await startFullSystem({ rootDir: root });
        expect(spawn.mock.calls.some(([command, args]) => command === 'docker' && args[0] === 'exec')).toBe(false);
        expect(warn).toHaveBeenCalledWith('[fullSystemLifecycle] Skipping init SQL for the in-memory database mock:', initSql);
        await runtime.cleanup();
    } finally {
        warn.mockRestore();
    }
});

it('provides owned URLs before validating startup and always releases the owned runtime',async()=>{
    const runtime=await startFullSystem({rootDir:root});
    expect(start.mock.calls[0][0].env).toMatchObject({PORT:'43123',CLIENT_URL:'http://127.0.0.1:43123'});
    await runtime.cleanup();
    expect(stop).toHaveBeenCalledWith(123,43123,undefined);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalled();
});
it('preserves infrastructure failures instead of replacing a SQL database with SQLite',async()=>{
    config.database={engine:'postgres'};
    const error=Object.assign(new Error('Docker is unavailable'),{code:'SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE',statusCode:503});
    provision.mockRejectedValue(error);
    await expect(startFullSystem({rootDir:root})).rejects.toMatchObject({code:error.code,statusCode:503});
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision.mock.calls[0][0].database.engine).toBe('postgres');
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
});
it('reports only a required external credential before provisioning and releases port reservations',async()=>{
    inspect.mockReturnValue({packages:[{directory:'.',scripts:{start:'node index.js'}}],files:[{path:'index.js',content:"import OpenAI from 'openai';new OpenAI();"}]});
    await expect(startFullSystem({rootDir:root})).rejects.toMatchObject({code:'SYSTEM_TEST_ENVIRONMENT_REQUIRED',details:{variables:[expect.objectContaining({name:'OPENAI_API_KEY',envFile:'.env.test'})]}});
    expect(provision).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
});
it('checks frontend startup credentials before provisioning backend services',async()=>{
    config.unified=false;config.frontend={directory:'web'};
    fs.mkdirSync(path.join(root,'web'));
    reserve.mockResolvedValue([{port:43123,release},{port:43124,release}]);
    inspect.mockImplementation(directory=>directory===root?{packages:[{directory:'.',scripts:{start:'node index.js'}}],files:[]}:{packages:[{directory:'.',scripts:{dev:'node index.js'}}],files:[{path:'index.js',content:'if(!process.env.WEB_PROVIDER_KEY)throw Error();'}]});
    await expect(startFullSystem({rootDir:root})).rejects.toMatchObject({code:'SYSTEM_TEST_ENVIRONMENT_REQUIRED'});
    expect(provision).not.toHaveBeenCalled();
});
