import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jest,it,expect,beforeEach,afterEach} from '@jest/globals';

const prepare=jest.fn(),environment=jest.fn(),setup=jest.fn(),inspect=jest.fn();
const provision=jest.fn(),reserve=jest.fn(),start=jest.fn(),stop=jest.fn(),seed=jest.fn();
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
