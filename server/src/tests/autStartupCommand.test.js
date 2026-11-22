import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, it, beforeEach, afterEach } from '@jest/globals';
import {autStartupCommand,inferNodeEntryFile} from '../utils/autStartupCommand.js';

describe('web application startup commands',()=>{
    it.each(['pnpm','yarn','bun'])('forwards %s port flags without npm-only separators',manager=>{
        expect(autStartupCommand('dev','vite',4301,{manager,command:manager})).toBe(`${manager} run dev --port 4301 --strictPort --host 127.0.0.1`);
    });
    it.each([
        ['vite --port 5173','npm run dev -- --port 4301 --strictPort --host 127.0.0.1'],
        ['next dev -p 3000','npm run dev -- --port 4301 --hostname 127.0.0.1'],
        ['nuxt dev','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['astro dev','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['vue-cli-service serve','npm run dev -- --port 4301 --host 127.0.0.1'],
        ['node index.js','npm run dev'],
    ])('selects compatible port flags for %s',(script,expected)=>{
        expect(autStartupCommand('dev',script,4301)).toBe(expected);
    });
});

describe('Node server entry inference', () => {
    let root;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-node-entry-')); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('picks app.js when main points to a missing index.js', () => {
        fs.writeFileSync(path.join(root, 'app.js'), 'app.listen(4000);');
        expect(inferNodeEntryFile(root, { main: 'index.js' })).toBe('app.js');
    });

    test('returns null when the files contain no server calls', () => {
        fs.writeFileSync(path.join(root, 'server.js'), 'module.exports = app;');
        expect(inferNodeEntryFile(root, { main: 'server.js' })).toBeNull();
    });

    test.each(['start', 'dev', 'serve', 'preview'])('defers to the %s startup script', name => {
        fs.writeFileSync(path.join(root, 'app.js'), 'app.listen(4000);');
        expect(inferNodeEntryFile(root, { scripts: { [name]: 'node custom.js' } })).toBeNull();
    });
});
