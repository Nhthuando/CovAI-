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
    it('creates schema and config from source without exposing env files', async () => {
        const root = fixture(), model = generate(proposal());
        const result = await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        expect(result.generated).toBe(true);
        expect(readFullSystemConfig(root).database.engine).toBe('mysql');
        expect(fs.readFileSync(path.join(root,'.covai/generated-schema.sql'),'utf8')).toContain('CREATE TABLE todos');
        expect(model.mock.calls[0][0]).not.toContain('never-send-me');
        expect(model.mock.calls[0][0]).not.toMatch(/hidden-password|hidden-private-key|hidden-uri/);
    });
    it('reuses existing config without a model call or schema overwrite', async () => {
        const root=fixture(), model=generate(proposal());
        await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}});
        model.mockClear();
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).generated).toBe(false);
        expect(model).not.toHaveBeenCalled();
    });
    it('serializes concurrent preparation for the same root', async () => {
        const root=fixture(), model=generate(proposal());
        await Promise.all([1,2,3].map(()=>ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})));
        expect(model).toHaveBeenCalledTimes(1);
    });
    it.each(['bad-json','missing','unsafe','escape','engine','endpoint','directory','invented-table','invented-column'])('rejects %s and leaves no config', async kind => {
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
    it('allows retry after a model failure', async () => {
        const root=fixture();
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:async()=>{throw new Error('offline');}}})).rejects.toThrow('offline');
        expect((await ensureFullSystemSetup({rootDir:root,dependencies:{generate:generate(proposal())}})).generated).toBe(true);
    });
    it('reports unsupported source before invoking AI', async () => {
        const root=fixture(), model=generate(proposal()); fs.unlinkSync(path.join(root,'server/package.json'));
        await expect(ensureFullSystemSetup({rootDir:root,dependencies:{generate:model}})).rejects.toThrow(/source must identify/);
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
