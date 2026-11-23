import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,test,expect,jest,afterEach} from '@jest/globals';
import {
    provisionSystemResources,
    sweepOrphanedSystemContainers,
    SYSTEM_RUNTIME_INSTANCE_ID,
} from '../services/systemRuntimeResources.service.js';
const roots=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('does not contact Docker when the application does not use external local services',async()=>{
    const docker=jest.fn();const resources=await provisionSystemResources({database:null,dependencies:{docker}});
    expect(resources.environment).toEqual({});await resources.cleanup();expect(docker).not.toHaveBeenCalled();
});
it('allocates SQLite inside the execution copy without Docker',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-resource-'));roots.push(root);
    const docker=jest.fn(),resources=await provisionSystemResources({rootDir:root,database:{engine:'sqlite'},dependencies:{docker}});
    expect(resources.environment.DATABASE_URL).toBe('file:'+resources.environment.SQLITE_DB_PATH);
    expect(path.relative(root,resources.environment.SQLITE_DB_PATH)).not.toMatch(/^\.\./);
    expect(docker).not.toHaveBeenCalled();await resources.cleanup();
});
it('owns only its generated containers and cleans earlier resources when later provisioning fails',async()=>{
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='run' && args.includes('redis:7'))throw Error('image unavailable');
        return {stdout:''};
    });
    await expect(provisionSystemResources({database:{engine:'postgres'},services:{redis:true},dependencies:{docker}})).rejects.toMatchObject({code:'SYSTEM_RUNTIME_SERVICE_START_FAILED',details:{output:'image unavailable'}});
    const removed=docker.mock.calls.filter(([args])=>args[0]==='rm').map(([args])=>args.at(-1));
    expect(removed).toHaveLength(2);expect(removed.every(name=>/^covai-system-(postgres|redis)-[a-f0-9-]+$/.test(name))).toBe(true);
});
it('waits for actual MySQL queries and removes only its container and anonymous volume',async()=>{
    let clock=0,queries=0;
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='inspect')return {stdout:JSON.stringify({Status:'running'})};
        if(args[0]==='exec' && ++queries<4)throw Object.assign(Error('initializing'),{stderr:'Connection refused'});
        return {stdout:''};
    });
    const resources=await provisionSystemResources({database:{engine:'mysql'},dependencies:{docker,now:()=>clock,wait:async ms=>{clock+=ms;}}});
    expect(queries).toBe(4);expect(clock).toBe(3000);
    await resources.cleanup();
    expect(docker.mock.calls.find(([args])=>args[0]==='rm')[0]).toEqual(['rm','-f','-v',resources.sqlContainer]);
});
it('captures a stopped service failure before cleanup and redacts generated credentials',async()=>{
    let password;
    const docker=jest.fn(async args=>{
        if(args[0]==='run')password=args.find(arg=>arg.startsWith('MYSQL_PASSWORD=')).split('=')[1];
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='exec')throw Object.assign(Error('not running'),{stderr:`password ${password}`});
        if(args[0]==='inspect')return {stdout:JSON.stringify({Status:'exited',ExitCode:137,OOMKilled:true})};
        if(args[0]==='logs')return {stdout:`startup ${password}`};
        return {stdout:''};
    });
    let failure;try{await provisionSystemResources({database:{engine:'mysql'},dependencies:{docker}});}catch(error){failure=error;}
    expect(failure).toMatchObject({code:'SYSTEM_RUNTIME_SERVICE_NOT_READY',statusCode:503,details:{state:{exitCode:137,oomKilled:true}}});
    expect(JSON.stringify(failure.details)).not.toContain(password);
    const commands=docker.mock.calls.map(([args])=>args[0]);expect(commands.indexOf('logs')).toBeLessThan(commands.indexOf('rm'));
    expect(commands.filter(command=>command==='exec')).toHaveLength(1);
});
it('uses a wall-clock readiness limit without confusing it with the AI deadline',async()=>{
    let clock=0;
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='exec'){clock+=800;throw Error('warming');}
        if(args[0]==='inspect')return {stdout:'{"Status":"running"}'};
        return {stdout:''};
    });
    await expect(provisionSystemResources({database:{engine:'mysql'},dependencies:{docker,readinessMs:2000,now:()=>clock,wait:async ms=>{clock+=ms;}}})).rejects.toMatchObject({code:'SYSTEM_RUNTIME_SERVICE_NOT_READY',details:{waitedMs:2600}});
});
it('reports worker infrastructure separately from required project ENV',async()=>{
    const docker=jest.fn().mockRejectedValue(Error('offline'));
    await expect(provisionSystemResources({database:{engine:'mongodb'},dependencies:{docker}})).rejects.toMatchObject({code:'SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE',statusCode:503});
});
it('uses a lightweight server probe and tolerates a transient Docker wake-up timeout',async()=>{
    const docker=jest.fn(async args=>{
        if(args[0]==='version' && docker.mock.calls.filter(([call])=>call[0]==='version').length===1)throw Object.assign(Error('slow wake-up'),{code:'ETIMEDOUT'});
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        return {stdout:'29.6.2'};
    });
    const resources=await provisionSystemResources({database:{engine:'postgres'},dependencies:{docker}});
    expect(docker.mock.calls.filter(([args])=>args[0]==='version')).toHaveLength(2);
    expect(docker.mock.calls.some(([args])=>args[0]==='info')).toBe(false);
    await resources.cleanup();
});
it('does not provision after cancellation',async()=>{
    const controller=new AbortController();controller.abort();const docker=jest.fn().mockResolvedValue({stdout:''});
    await expect(provisionSystemResources({database:{engine:'mysql'},signal:controller.signal,dependencies:{docker}})).rejects.toMatchObject({statusCode:409});
    expect(docker.mock.calls.some(([args])=>args[0]==='run')).toBe(false);
});
it('preserves operation deadline cancellation during readiness and still cleans its own resource',async()=>{
    const controller=new AbortController();const reason=Object.assign(Error('operation deadline'),{code:'SYSTEM_OPERATION_TIMEOUT',statusCode:408});
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='exec'){controller.abort(reason);throw Error('aborted');}
        return {stdout:''};
    });
    await expect(provisionSystemResources({database:{engine:'mysql'},signal:controller.signal,dependencies:{docker}})).rejects.toBe(reason);
    expect(docker.mock.calls.some(([args])=>args[0]==='rm')).toBe(true);
});
it('stops probing SQL if the Docker engine becomes unavailable',async()=>{
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        if(args[0]==='exec')throw Error('connection failed');
        if(args[0]==='inspect')throw Error('Docker Desktop is unable to start');
        return {stdout:''};
    });
    await expect(provisionSystemResources({database:{engine:'mysql'},dependencies:{docker}})).rejects.toMatchObject({code:'SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE'});
    expect(docker.mock.calls.filter(([args])=>args[0]==='exec')).toHaveLength(1);
});
it('applies memory, CPU, pids, and tmpfs limits on ephemeral containers',async()=>{
    const docker=jest.fn(async args=>{
        if(args[0]==='port')return {stdout:'127.0.0.1:41234\n'};
        return {stdout:''};
    });
    const resources=await provisionSystemResources({database:{engine:'postgres'},dependencies:{docker}});
    const runArgs=docker.mock.calls.find(([args])=>args[0]==='run')[0];
    expect(runArgs).toEqual(expect.arrayContaining(['--memory','512m','--cpus','1','--pids-limit','256','--tmpfs']));
    expect(runArgs).toContain(`covai.owner=${SYSTEM_RUNTIME_INSTANCE_ID}`);
    expect(runArgs).toEqual(expect.arrayContaining([expect.stringMatching(/^covai\.started-at=\d+$/)]));
    await resources.cleanup();
});
test('sweeps legacy, dead, and reused-pid containers while preserving live and remote owners', async () => {
    const host = os.hostname();
    const deadPid = process.pid + 1;
    const docker = jest.fn()
        .mockResolvedValueOnce({stdout:[
            'legacy ',
            `dead ${host}:${deadPid}:dead-uuid`,
            `reused ${host}:${process.pid}:old-uuid`,
            `live ${SYSTEM_RUNTIME_INSTANCE_ID}`,
            `remote ${host}-remote:${deadPid}:remote-uuid`,
        ].join('\r\n')})
        .mockResolvedValueOnce({stdout:''});
    const isOwnerAlive = jest.fn(pid => pid === process.pid);

    await expect(sweepOrphanedSystemContainers({docker, isOwnerAlive}))
        .resolves.toEqual({removed:['legacy', 'dead', 'reused']});
    expect(docker.mock.calls).toEqual([
        [[
            'ps', '-a', '--filter', 'label=covai.system-test=true',
            '--format', '{{.ID}} {{.Label "covai.owner"}}',
        ], {timeout:10000}],
        [['rm', '-f', '-v', 'legacy', 'dead', 'reused'], {timeout:10000}],
    ]);
    expect(isOwnerAlive.mock.calls).toEqual([[deadPid], [process.pid]]);
});
test('warns once and skips orphan cleanup when Docker fails', async () => {
    const docker = jest.fn().mockRejectedValue(Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        await expect(sweepOrphanedSystemContainers({docker}))
            .resolves.toEqual({removed:[], skipped:true});
        expect(warn).toHaveBeenCalledTimes(1);
    } finally {
        warn.mockRestore();
    }
});
test.each([
    ['uses the default MongoDB port when free',true,false,['127.0.0.1:27017:27017'],27017],
    ['uses a random MongoDB port when occupied',false,false,['127.0.0.1::27017'],41234],
    ['retries MongoDB on a random port after a binding collision',true,true,['127.0.0.1:27017:27017','127.0.0.1::27017'],41234],
])('%s',async(_name,portFree,collision,bindings,mappedPort)=>{
    const isPortFree=jest.fn().mockResolvedValue(portFree);
    const docker=jest.fn(async args=>{
        if(collision && args[0]==='run' && args.includes('127.0.0.1:27017:27017'))throw Error('port is already allocated');
        if(args[0]==='port')return {stdout:`127.0.0.1:${mappedPort}\n`};
        return {stdout:''};
    });
    const resources=await provisionSystemResources({database:{engine:'mongodb'},dependencies:{docker,isPortFree,networkMode:'bridge'}});
    const calls=docker.mock.calls.map(([args])=>args);
    const runs=calls.filter(args=>args[0]==='run');
    const name=runs[0][3];
    const remove=['rm','-f','-v',name];
    expect(isPortFree).toHaveBeenCalledWith(27017);
    expect(runs.map(args=>args[args.indexOf('-p')+1])).toEqual(bindings);
    if(collision)expect(calls.slice(calls.indexOf(runs[0])+1,calls.indexOf(runs[1]))).toEqual([remove]);
    expect(calls.filter(args=>args[0]==='port')).toEqual([['port',name,'27017/tcp']]);
    expect(resources.environment.MONGO_PORT).toBe(String(mappedPort));
    await resources.cleanup();
    expect(docker.mock.calls.filter(([args])=>args[0]==='rm').map(([args])=>args)).toEqual(collision ? [remove,remove] : [remove]);
});
it('joins compose network and exposes container hostnames when networkMode is active',async()=>{
    const docker=jest.fn(async args=>({stdout:''}));
    const resources=await provisionSystemResources({database:{engine:'postgres'},services:{redis:true},dependencies:{docker,networkMode:'covai_default'}});
    const runCalls=docker.mock.calls.filter(([args])=>args[0]==='run').map(([args])=>args);
    expect(runCalls).toHaveLength(2);
    for(const args of runCalls)expect(args).toEqual(expect.arrayContaining(['--network','covai_default']));
    expect(docker.mock.calls.some(([args])=>args[0]==='port')).toBe(false);
    expect(resources.environment.DB_HOST).toBe(resources.sqlContainer);
    expect(resources.environment.DB_PORT).toBe('5432');
    expect(resources.environment.DATABASE_URL).toContain(`@${resources.sqlContainer}:5432/covai_test`);
    expect(resources.environment.REDIS_URL).toMatch(/^redis:\/\/covai-system-redis-[a-f0-9-]+:6379$/);
    await resources.cleanup();
});
