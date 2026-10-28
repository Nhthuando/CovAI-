import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,afterEach} from '@jest/globals';
import {resolveSystemScreenshot} from '../services/systemScreenshotPath.service.js';
let root;
afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
const fixture=()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-evidence-root-'));
    for(const dir of ['client','server']) {fs.mkdirSync(path.join(root,dir));fs.writeFileSync(path.join(root,dir,'package.json'),'{}');}
    return path.join(root,'server');
};
const screenshot='.covai-system-test/evidence/run/screenshot.png';
it('finds repository screenshots when the snapshot points to its backend package',()=>{
    const backend=fixture(),file=path.join(root,screenshot);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'png');
    expect(resolveSystemScreenshot(backend,screenshot)).toBe(file);
});
it('retains package-relative legacy evidence and returns null for missing files',()=>{
    const backend=fixture(),file=path.join(backend,screenshot);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'png');
    expect(resolveSystemScreenshot(backend,screenshot)).toBe(file);
    expect(resolveSystemScreenshot(backend,screenshot+'-missing')).toBeNull();
});
it('rejects traversal and unsupported paths before searching another root',()=>{
    const backend=fixture();
    expect(()=>resolveSystemScreenshot(backend,'.covai-system-test/evidence/../../../outside.png')).toThrow(/inside/);
    expect(resolveSystemScreenshot(backend,'elsewhere/image.png')).toBeNull();
});
