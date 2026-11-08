import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Inventory current source and local import dependencies, never env/credential
// files or copies under temp. This is an audit map, not a claim of test coverage.
const root=fileURLToPath(new URL('../',import.meta.url));
const names=[];
const walk=directory=>{
    for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})) {
        const relative=path.posix.join(directory,entry.name);
        if(entry.isSymbolicLink())continue;
        if(entry.isDirectory())walk(relative);
        else if(/\.(?:[cm]?[jt]sx?|prisma)$/.test(entry.name))names.push(relative);
    }
};
for(const directory of ['server/src','client/src','shared'])walk(directory);
names.push('server/prisma/schema.prisma');
const universe=new Set(names);
const test=name=>/\/tests\/|\.(?:test|spec)\./.test(name);
const direct=name=>!test(name) && (/^client\/src\/components\/dashboard\/(?:system\/|SystemTest)/.test(name) || /\/system[^/]*\.[cm]?[jt]sx?$/i.test(name) || /\/(?:fullSystem|automaticSystem|autLifecycle|autStartup|dockerRunner|queue|projectRuntime|projectDependenc|projectOperation|projectWorkspace|projectSystemOperation|projectAccess|projectFileVersion)[^/]*\.[cm]?[jt]sx?$/i.test(name) || ['server/src/controllers/coverage.controller.js','server/src/routes/coverage.route.js','client/src/hooks/useSystemTestWorkspace.js','client/src/services/editorAwareRequest.js','server/prisma/schema.prisma'].includes(name));
const selected=new Map(names.filter(direct).map(name=>[name,'entry']));
const queue=[...selected.keys()];
while(queue.length) {
    const name=queue.shift(),source=fs.readFileSync(path.join(root,name),'utf8');
    const requests=[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(match=>match[1]);
    for(const request of requests) {
        const base=path.posix.normalize(path.posix.join(path.posix.dirname(name),request));
        const dependency=[base,...['.js','.jsx','.mjs','.cjs','.ts','.tsx','/index.js','/index.jsx'].map(extension=>base+extension)].find(candidate=>universe.has(candidate));
        if(dependency && !test(dependency) && !selected.has(dependency)){selected.set(dependency,'dependency');queue.push(dependency);}
    }
}
for(const name of names.filter(name=>test(name) && /(?:system|autLifecycle|autStartup|projectRuntime|projectDependencies|queueWorker|queue\.service|projectEndpointPolicy)/i.test(name)))selected.set(name,'test');
const files=[...selected].sort(([a],[b])=>a.localeCompare(b)).map(([filePath,kind])=>{
    const bytes=fs.readFileSync(path.join(root,filePath));
    return {filePath,kind,lines:bytes.toString('utf8').split('\n').length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
});
const summary=Object.fromEntries(['entry','dependency','test'].map(kind=>[kind,{files:files.filter(file=>file.kind===kind).length,lines:files.filter(file=>file.kind===kind).reduce((sum,file)=>sum+file.lines,0)}]));
fs.writeFileSync(path.join(root,'docs/system-test-scalability-inventory-2026-11-07.json'),JSON.stringify({schemaVersion:1,method:'Current local import graph and System Test test inventory; excludes temp, env files and external packages. Inventory is not exhaustive dynamic dependency discovery or a claim of line-by-line verification.',summary,files},null,2)+'\n');
console.log(JSON.stringify(summary));
