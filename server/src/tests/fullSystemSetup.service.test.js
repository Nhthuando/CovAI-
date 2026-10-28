import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { ensureFullSystemSetup, validateGeneratedSchema } from '../services/fullSystemSetup.service.js';
import { readFullSystemConfig, resolveSystemRepositoryRoot } from '../services/fullSystemConfig.service.js';

const roots = [];
const write = (root, file, content) => { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),content); };
const fixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'covai-setup-')); roots.push(root);
    write(root,'client/package.json',JSON.stringify({scripts:{dev:'vite'},dependencies:{vite:'1'}}));
    write(root,'server/package.json',JSON.stringify({scripts:{dev:'node index.js'},dependencies:{express:'1',mysql2:'1'}}));
    write(root,'server/index.js',"app.get('/api/todos', handler); db.query('SELECT id, title FROM todos');");
    write(root,'.env','GEMINI_API_KEY=never-send-me');
    write(root,'server/settings.json',JSON.stringify({password:'hidden-password',private_key:'hidden-private-key',url:'mysql://user:hidden-uri@localhost/test'}));
    return root;
};
const proposal = () => ({frontend:{directory:'client'},backend:{directory:'server',healthPath:'/api/todos'},database:{engine:'mysql',initSql:'.covai/generated-schema.sql'},schemaSql:'CREATE TABLE todos(id INT PRIMARY KEY, title VARCHAR(255));',missingInformation:[]});
const generate = value => jest.fn().mockResolvedValue(JSON.stringify(value));
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });

describe('automatic Full Stack setup', () => {
    it('uses an existing Prisma schema and real root route without asking AI for SQL or endpoints',async()=>{
        const root=fixture(),model=generate({backend:{healthPath:'/invented'}});
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5','@prisma/client':'6'},devDependencies:{prisma:'6'}}));
        write(root,'server/index.js','const express=require("express"); const app=express(); app.get("/",(req,res)=>res.send("ready"));');
        write(root,'server/prisma/schema.prisma','datasource db { provider = "mysql"\n url = env("DATABASE_URL") }\n model Food { id Int @id }');
        const result=await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        expect(result.config).toMatchObject({backend:{directory:'server',healthPath:'/'},database:{engine:'mysql',prismaSchema:'server/prisma/schema.prisma',schemaStrategy:'push'}});
        expect(readFullSystemConfig(root)).toEqual(result.config);
        expect(model).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(root,'.covai/generated-schema.sql'))).toBe(false);
    });
    it('creates schema and config from source without exposing env files', async () => {
        const root = fixture(), model = generate(proposal());
        const result = await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        expect(result.generated).toBe(true);
        expect(readFullSystemConfig(root).database.engine).toBe('mysql');
        expect(fs.readFileSync(path.join(root,'.covai/generated-schema.sql'),'utf8')).toContain('CREATE TABLE todos');
        expect(model.mock.calls[0][0]).not.toContain('never-send-me');
        expect(model.mock.calls[0][0]).not.toMatch(/hidden-password|hidden-private-key|hidden-uri/);
        expect(model.mock.calls[0][0]).toContain('A missing SQL schema file alone is not missing information');
        expect(model.mock.calls[0][2]).toMatchObject({
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', required: ['missingInformation'] },
            maxOutputTokens: 16000,
        });
    });
    it('accepts a complete JSON fence with BOM without another model call', async () => {
        const root = fixture();
        const value = proposal();
        value.schemaSql = 'CREATE TABLE todos(\n id INT PRIMARY KEY,\n title VARCHAR(255)\n);';
        const model = jest.fn().mockResolvedValue('\uFEFF```json\n' + JSON.stringify(value, null, 2) + '\n```');
        const result = await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        expect(result.generated).toBe(true);
        expect(model).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(path.join(root,'.covai/generated-schema.sql'),'utf8')).toBe(value.schemaSql);
    });
    it('regenerates malformed JSON once before writing any files', async () => {
        const root = fixture(), progress = jest.fn();
        const invalid = '{"schemaSql":"CREATE TABLE todos(\n secret-value';
        const model = jest.fn().mockResolvedValueOnce(invalid).mockImplementationOnce(async () => {
            expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
            expect(fs.existsSync(path.join(root,'.covai/generated-schema.sql'))).toBe(false);
            return JSON.stringify(proposal());
        });
        expect((await ensureFullSystemSetup({rootDir:root,onProgress:progress,dependencies:{generate:model}})).generated).toBe(true);
        expect(model).toHaveBeenCalledTimes(2);
        expect(model.mock.calls[1][0]).toContain('Regenerate the complete proposal');
        expect(model.mock.calls[1][0]).not.toContain('secret-value');
        expect(model.mock.calls[1][2].maxOutputTokens).toBe(32000);
        expect(progress).toHaveBeenCalledWith(22, expect.stringContaining('regenerating once'));
    });
    it.each(['', 'secret-value', '{"frontend":', 'null', '[]', '"secret-value"', '{"missingInformation":"secret-value"}', 'Explanation\n' + JSON.stringify(proposal())])('stops after two unreadable responses without partial files: %s', async response => {
        const root = fixture(), model = jest.fn().mockResolvedValue(response);
        let failure;
        try { await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}}); } catch (error) { failure = error; }
        expect(failure).toMatchObject({statusCode:422});
        expect(failure.message).toContain('after 2 attempts');
        expect(failure.message).not.toContain('secret-value');
        expect(model).toHaveBeenCalledTimes(2);
        expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
        expect(fs.existsSync(path.join(root,'.covai/generated-schema.sql'))).toBe(false);
    });
    it('does not retry valid JSON that selects an unsafe configuration', async () => {
        const root = fixture(), value = proposal();
        value.schemaSql += ' DROP TABLE todos;';
        const model = generate(value);
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).rejects.toThrow(/only CREATE TABLE/);
        expect(model).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(root,'.covai'))).toBe(false);
    });
    it('returns missing source information without retrying or writing setup', async () => {
        const root = fixture(), model = generate({missingInformation:['Database schema is unavailable']});
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).rejects.toThrow('needs more information: Database schema is unavailable');
        expect(model).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(root,'.covai'))).toBe(false);
    });
    it('reuses existing config without a model call or schema overwrite', async () => {
        const root=fixture(), model=generate(proposal());
        await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        model.mockClear();
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).generated).toBe(false);
        expect(model).not.toHaveBeenCalled();
    });
    it.each(['../outside.prisma','server/schema.sql'])('rejects an unsafe or invalid Prisma schema reference: %s',prismaSchema=>{
        const root=fixture();
        write(root,'.covai/system-test.json',JSON.stringify({frontend:{directory:'client'},backend:{directory:'server',healthPath:'/'},database:{engine:'mysql',prismaSchema,schemaStrategy:'push'}}));
        expect(()=>readFullSystemConfig(root)).toThrow();
    });
    it('serializes concurrent preparation for the same root', async () => {
        const root=fixture(), model=generate(proposal());
        await Promise.all([1,2,3].map(()=>ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})));
        expect(model).toHaveBeenCalledTimes(1);
    });
    it.each(['bad-json','missing','unsafe','escape','invented-table','invented-column'])('rejects %s and leaves no config', async kind => {
        const root=fixture(), value=proposal();
        if(kind==='missing') value.missingInformation=['Schema is ambiguous'];
        if(kind==='unsafe') value.schemaSql+=' DROP TABLE todos;';
        if(kind==='escape') value.database.initSql='../external.sql';
        if(kind==='engine') value.database.engine='sqlite';
        if(kind==='endpoint') value.backend.healthPath='/fabricated';
        if(kind==='directory') value.frontend.directory='../client';
        if(kind==='invented-table') value.schemaSql='CREATE TABLE invented(id INT);';
        if(kind==='invented-column') value.schemaSql='CREATE TABLE todos(invented INT);';
        const model=kind==='bad-json'?jest.fn().mockResolvedValue('bad'):generate(value);
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).rejects.toThrow();
        expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
    });
    it('uses deterministic source facts instead of failing on an AI-invented service, database or health route',async()=>{
        const root=fixture(),value=proposal();
        value.frontend.directory='../untrusted';value.backend.directory='invented-backend';value.backend.healthPath='/invented';value.database.engine='sqlite';
        const result=await ensureFullSystemSetup({rootDir:root,dependencies:{generate:generate(value)}});
        expect(result.config).toMatchObject({frontend:{directory:'client'},backend:{directory:'server',healthPath:'/',readiness:'http'},database:{engine:'mysql'}});
    });
    it('allows retry after a model failure', async () => {
        const root=fixture();
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:async()=>{throw new Error('offline');}}})).rejects.toThrow('AI is unavailable while preparing Full Stack configuration');
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:generate(proposal())}})).generated).toBe(true);
    });
    it('configures a frontend-only application without requiring an invented backend', async () => {
        const root=fixture(), model=generate(proposal()); fs.unlinkSync(path.join(root,'server/package.json'));
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).config).toMatchObject({unified:true,frontendOnly:true,database:null});
        expect(model).not.toHaveBeenCalled();
    });
    it('configures a backend without database dependencies without requiring database environment variables', async () => {
        const root=fixture(), model=generate(proposal());
        write(root,'server/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'1'}}));
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).config.database).toBeNull();
        expect(model).not.toHaveBeenCalled();
    });
    it('keeps invalid existing setup and reports it', async () => {
        const root=fixture(), model=generate(proposal());write(root,'.covai/system-test.json','broken');
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).rejects.toThrow(/Invalid/);
        expect(model).not.toHaveBeenCalled();
    });
    it('resolves the stack root when imported project is a backend subdirectory', () => {
        const root=fixture();fs.mkdirSync(path.join(root,'.git'));
        expect(resolveSystemRepositoryRoot(path.join(root,'server'))).toBe(fs.realpathSync(root));
        expect(readFullSystemConfig(path.join(root,'server'),{allowMissing:true})).toBeNull();
    });
    it.each(['CREATE DATABASE live;', 'CREATE TABLE x(id INT); INSERT INTO x VALUES(1);', 'CREATE TABLE x(id INT); GRANT ALL ON *.* TO user;', 'CREATE TABLE x(id INT); /*!50000 DROP TABLE x */'])('rejects non-schema SQL %s', sql => {
        expect(()=>validateGeneratedSchema(sql)).toThrow();
    });
});
