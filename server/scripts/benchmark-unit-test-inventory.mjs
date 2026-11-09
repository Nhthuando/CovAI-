import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unitTestInventory } from '../src/services/unitTestFilePolicy.service.js';
import { buildProjectTestDependencyMap } from '../src/services/testDependencyResolver.service.js';

// This measures local discovery work, not AI/network or end-to-end latency.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'covai-inventory-benchmark-'));
const samples = { coldInventoryMs: [], warmInventoryMs: [], coldDependencyMapMs: [], warmDependencyMapMs: [] };
const time = run => { const started=performance.now(); run(); return performance.now()-started; };
const distribution = values => {
    const sorted=[...values].sort((a,b)=>a-b);
    return {samples:sorted.length,medianMs:Number(sorted[Math.floor(sorted.length/2)].toFixed(2)),
        p95Ms:Number(sorted[Math.ceil(sorted.length*0.95)-1].toFixed(2))};
};
try {
    for (let sample=0;sample<20;sample++) {
        const root=path.join(temporary,String(sample));
        fs.mkdirSync(path.join(root,'src/services'),{recursive:true});
        fs.mkdirSync(path.join(root,'tests'),{recursive:true});
        fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({jest:{testMatch:['**/*.test.js']}}));
        for(let index=0;index<100;index++) {
            fs.writeFileSync(path.join(root,`src/services/value${index}.js`),`export const value${index}=input=>input+${index};`);
            fs.writeFileSync(path.join(root,`tests/value${index}.test.js`),`import {value${index}} from '../src/services/value${index}.js'; test('value ${index}',()=>expect(value${index}(1)).toBe(${index+1}));`);
        }
        samples.coldInventoryMs.push(time(()=>unitTestInventory(root)));
        samples.warmInventoryMs.push(time(()=>unitTestInventory(root)));
        samples.coldDependencyMapMs.push(time(()=>buildProjectTestDependencyMap(root)));
        samples.warmDependencyMapMs.push(time(()=>buildProjectTestDependencyMap(root)));
    }
    console.log(JSON.stringify({kind:'inventory-only',node:process.version,platform:process.platform,
        fixture:{sourceFiles:100,testFiles:100},results:Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,distribution(values)])),
        serverRssBytes:process.memoryUsage().rss},null,2));
} finally {
    const relative=path.relative(os.tmpdir(),temporary);
    if(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('covai-inventory-benchmark-')) fs.rmSync(temporary,{recursive:true,force:true});
}
