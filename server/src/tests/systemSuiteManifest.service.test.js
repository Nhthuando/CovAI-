import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from '@jest/globals';
import { captureSystemSuiteManifest } from '../services/systemSuiteManifest.service.js';
it('versions exclusive fixtures, preserves exact bytes and excludes shared application helpers', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'covai-suite-'));
    try {
        await fs.mkdir(path.join(root,'tests/fixtures'),{recursive:true});
        await fs.writeFile(path.join(root,'package.json'),'{}');
        await fs.writeFile(path.join(root,'tests/a.spec.js'),"import {test} from '@playwright/test';import data from './fixtures/data.js';import shared from './fixtures/shared.js';test('A',async()=>{});");
        await fs.writeFile(path.join(root,'tests/fixtures/data.js'),'export default 1;\r\n');
        await fs.writeFile(path.join(root,'tests/fixtures/shared.js'),'export default 2;');
        await fs.writeFile(path.join(root,'app.js'),"import shared from './tests/fixtures/shared.js';");
        const before=await captureSystemSuiteManifest({rootDir:root});
        expect(before.manifest.map(file=>file.path)).toEqual(['tests/a.spec.js','tests/fixtures/data.js']);
        expect((await captureSystemSuiteManifest({rootDir:root})).suiteHash).toBe(before.suiteHash);
        expect(before.blobs.some(blob=>blob.content.endsWith('\r\n'))).toBe(true);
        await fs.writeFile(path.join(root,'tests/fixtures/data.js'),'export default 3;\r\n');
        const fixture=await captureSystemSuiteManifest({rootDir:root});
        expect(fixture.sourceHash).toBe(before.sourceHash);
        expect(fixture.suiteHash).not.toBe(before.suiteHash);
        await fs.writeFile(path.join(root,'tests/fixtures/shared.js'),'export default 4;');
        expect((await captureSystemSuiteManifest({rootDir:root})).sourceHash).not.toBe(before.sourceHash);
        await expect(captureSystemSuiteManifest({rootDir:root,specPaths:['../outside.spec.js']})).rejects.toThrow();
        await fs.appendFile(path.join(root,'tests/a.spec.js'),'\n//'+'x'.repeat(256*1024));
        await expect(captureSystemSuiteManifest({rootDir:root})).rejects.toThrow('256 KiB');
    }finally{await fs.rm(root,{recursive:true,force:true});}
});
