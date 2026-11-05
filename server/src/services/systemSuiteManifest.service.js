import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { captureWorkspaceFiles } from './projectWorkspacePublish.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { scanSystemTestFiles } from '../utils/testFileParser.js';
import { ServiceError } from '../utils/serviceError.js';

export const suiteDigest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const suiteHash = manifest => suiteDigest([...manifest].map(({path: name, sha256}) => ({path:name,sha256})).sort((a,b)=>a.path.localeCompare(b.path)));
const imports = content => [...content.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g)].map(match=>match[1]);
const isTestDirectory = name => /(?:^|\/)(?:tests?|e2e|fixtures|__tests__|cypress)(?:\/|$)/i.test(name);

export const captureSystemSuiteManifest = async ({rootDir, specPaths, excludedPaths = []}) => {
    const all = await captureWorkspaceFiles(rootDir);
    const text = new Map(), graph = new Map();
    for (const [name,file] of all) if (/\.[cm]?[jt]sx?$/.test(name) && file.size <= 256*1024) text.set(name,await fs.readFile(containedPath(rootDir,name),'utf8'));
    const resolve = (name, relative) => {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
        return [base,...['.js','.mjs','.cjs','.ts','.tsx','.jsx','/index.js','/index.ts'].map(ext=>base+ext)].find(candidate=>text.has(candidate));
    };
    for (const [name,content] of text) graph.set(name,imports(content).map(relative=>resolve(name,relative)).filter(Boolean));
    const scanned = scanSystemTestFiles(rootDir);
    const specs = new Set(specPaths || [...scanned.playwrightFiles,...scanned.cypressFiles].map(file=>file.filePath));
    for (const name of specs) {
        containedPath(rootDir,name);
        if (!/\.(?:spec|test|cy)\.[cm]?[jt]sx?$/.test(name) || !all.has(name)) throw new ServiceError('System test file is missing or unsupported',409);
    }
    const owned = new Set(specs), dependencies = new Set();
    const queue = [...specs];
    for (let index=0;index<queue.length;index++) for (const dep of graph.get(queue[index]) || []) {
        if (!owned.has(dep) && isTestDirectory(dep) && !/\.(?:spec|test|cy)\./.test(dep)) {owned.add(dep);queue.push(dep);}
        else if (!owned.has(dep)) dependencies.add(dep);
    }
    // A fixture imported by application/unit code is a shared dependency, not restorable ownership.
    let changed = true;
    while(changed) {
        changed = false;
        for (const name of [...owned]) if (!specs.has(name) && [...graph].some(([consumer,deps])=>!owned.has(consumer) && deps.includes(name))) {owned.delete(name);dependencies.add(name);changed=true;}
    }
    const manifest = [], blobs = [];
    let bytes = 0;
    for (const name of [...owned].sort()) {
        const buffer = await fs.readFile(containedPath(rootDir,name));
        if (buffer.length > 256*1024 || buffer.includes(0)) throw new ServiceError('Managed test files must be UTF-8 text up to 256 KiB',413);
        const content = buffer.toString('utf8');
        if (!Buffer.from(content).equals(buffer)) throw new ServiceError('Managed test files must use UTF-8 encoding',422);
        bytes += buffer.length;
        const sha256 = suiteDigest(buffer);
        manifest.push({path:name,sha256,byteSize:buffer.length,role:specs.has(name)?'SPEC':'HELPER'});
        blobs.push({sha256,content,byteSize:buffer.length});
    }
    if (manifest.length>100 || bytes>16*1024*1024) throw new ServiceError('Test versions support at most 100 files and 16 MiB',413);
    const excluded = new Set([...owned,...excludedPaths]);
    const source = [...all].filter(([name])=>!excluded.has(name)).map(([name,file])=>({path:name,sha256:file.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
    return {identityVersion:'system-suite-v2',manifest,blobs,suiteHash:suiteHash(manifest),sourceHash:suiteDigest(source),configHash:suiteDigest(source.filter(file=>/config\.|package(?:-lock)?\.json$|\.covai\//.test(file.path))),dependencies:[...dependencies].sort()};
};
