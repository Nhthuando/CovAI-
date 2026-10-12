import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {jest,it,expect,afterEach} from '@jest/globals';
const run=jest.fn();
await jest.unstable_mockModule('../services/dockerRunner.service.js',()=>({dockerRunner:{run}}));
const {prepareFullSystemPackage,readApplicationEnvironment}=await import('../services/fullSystemRuntime.service.js');
const roots=[];
const fixture=()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-runtime-'));roots.push(root);
    fs.mkdirSync(path.join(root,'prisma'),{recursive:true});
    fs.mkdirSync(path.join(root,'node_modules/prisma/build'),{recursive:true});
    fs.writeFileSync(path.join(root,'node_modules/prisma/build/index.js'),'');
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{'@prisma/client':'6'},devDependencies:{prisma:'6'}}));
    fs.writeFileSync(path.join(root,'prisma/schema.prisma'),'datasource db { provider = "mysql"\nurl = env("CUSTOM_DB_URL") }');
    run.mockReset().mockResolvedValue({success:true,exitCode:0});return root;
};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('installs dev dependencies, generates the local Prisma client and pushes only the isolated database',async()=>{
    const directory=fixture(),env={DATABASE_URL:'mysql://isolated-test-db'};
    await prepareFullSystemPackage({directory,env,database:true});
    expect(run.mock.calls.map(([args])=>args.command)).toEqual([expect.stringContaining('--include=dev'),expect.stringContaining('generate --schema'),expect.stringContaining('db push --accept-data-loss')]);
    expect(env.CUSTOM_DB_URL).toBe(env.DATABASE_URL);
    expect(run.mock.calls[2][0].env.CUSTOM_DB_URL).toBe(env.DATABASE_URL);
});
it('deploys committed migrations instead of pushing the schema when migrations exist',async()=>{
    const directory=fixture();fs.mkdirSync(path.join(directory,'prisma/migrations/001'),{recursive:true});
    fs.writeFileSync(path.join(directory,'prisma/migrations/001/migration.sql'),'CREATE TABLE test(id INT);');
    await prepareFullSystemPackage({directory,env:{DATABASE_URL:'mysql://isolated'},database:true});
    expect(run.mock.calls[2][0].command).toContain('migrate deploy');
});
it('rejects a literal datasource URL before executing Prisma database operations',async()=>{
    const directory=fixture();fs.writeFileSync(path.join(directory,'prisma/schema.prisma'),'datasource db { url = "mysql://live-db" }');
    await expect(prepareFullSystemPackage({directory,env:{DATABASE_URL:'mysql://isolated'},database:true})).rejects.toThrow('environment variable');
    expect(run).toHaveBeenCalledTimes(1);
});
it('stops on install failure and redacts the database credentials',async()=>{
    const directory=fixture();run.mockResolvedValueOnce({success:false,stderr:'error secret-password'});
    await expect(prepareFullSystemPackage({directory,env:{DB_PASSWORD:'secret-password'},database:true})).rejects.toThrow('error [redacted]');
    expect(run).toHaveBeenCalledTimes(1);
});
it('loads project test environment before startup, preferring .env.test',()=>{
    const directory=fixture();fs.writeFileSync(path.join(directory,'.env'),'STRIPE_SECRET_KEY=first\nPORT=3000');
    fs.writeFileSync(path.join(directory,'.env.test'),'STRIPE_SECRET_KEY=test-key');
    expect(readApplicationEnvironment(directory)).toEqual({STRIPE_SECRET_KEY:'test-key',PORT:'3000'});
});
