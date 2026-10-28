import { operationAbortReason } from './systemOperationError.service.js';
import { registerDependencyWorkspace } from './projectDependencyCache.service.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { containedPath } from './fullSystemConfig.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { runtimeIgnoredDirectories } from './projectRuntimePlan.service.js';

const ignored = new Set([...runtimeIgnoredDirectories, '.specify', '.npm-cache']);
const secret = name => /^\.env(?:\.|$)/i.test(name) || /(?:credential|service[-_]?account|secret|private[-_]?key)/i.test(name) || /\.(pem|key|p12)$/i.test(name);
export const snapshotIdentity = rootDir => {
    const files = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (ignored.has(entry.name) || secret(entry.name)) continue;
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new ServiceError('Assessment does not follow source symlinks', 422);
            if (entry.isDirectory()) visit(target);
            else if (entry.isFile()) {
                const stat = fs.statSync(target);
                if (stat.size > 5 * 1024 * 1024) throw new ServiceError('Assessment source file exceeds 5 MiB', 413);
                files.push({ path: path.relative(rootDir, target).replaceAll('\\', '/'), hash: digest(fs.readFileSync(target)) });
            }
        }
    };
    visit(rootDir);
    const tests = files.filter(file => /\.(?:test|spec|cy)\.[cm]?[jt]sx?$/.test(file.path));
    const configs = files.filter(file => /(?:config\.|package(?:-lock)?\.json$|\.covai\/)/.test(file.path));
    return { files, sourceHash: digest(files.filter(file => !tests.includes(file))), testHash: digest(tests), configHash: digest(configs) };
};
export const createAssessmentWorkspace = ({ rootDir, operationId = crypto.randomUUID() }) => {
    const identity = snapshotIdentity(rootDir);
    const base = path.join(os.tmpdir(), 'covai-assessments');
    fs.mkdirSync(base, { recursive: true });
    const target = fs.mkdtempSync(path.join(base, 'operation-'));
    const extraFiles = [];
    try {
        for (const file of identity.files) {
            const destination = containedPath(target, file.path);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(containedPath(rootDir, file.path), destination);
        }
        // In imported monorepos where snapshot rootDir is pointed at the backend package (e.g. server),
        // copy any sibling frontend package (e.g. client, frontend) into the workspace so the frontend
        // AUT server can be resolved and launched alongside the test runner.
        const parent = path.dirname(rootDir);
        if (['server', 'backend', 'api'].includes(path.basename(rootDir)) && (fs.existsSync(path.join(parent, '.git')) || ['client', 'frontend', 'web', 'ui', 'app'].some(n => fs.existsSync(path.join(parent, n, 'package.json'))))) {
            const siblingNames = ['client', 'frontend', 'web', 'ui', 'app'];
            for (const sibling of siblingNames) {
                const siblingDir = path.join(parent, sibling);
                if (fs.existsSync(path.join(siblingDir, 'package.json')) && !fs.existsSync(path.join(rootDir, sibling))) {
                    const siblingIdentity = snapshotIdentity(siblingDir);
                    for (const file of siblingIdentity.files) {
                        const destination = path.join(target, sibling, file.path);
                        fs.mkdirSync(path.dirname(destination), { recursive: true });
                        fs.copyFileSync(containedPath(siblingDir, file.path), destination);
                        extraFiles.push({ path: `${sibling}/${file.path}`, hash: file.hash });
                    }
                }
            }
        }
    } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
    registerDependencyWorkspace(target);
    return { rootDir: target, originalRoot: rootDir, operationId, ...identity, files: [...identity.files, ...extraFiles], release: () => {
        const real = fs.realpathSync(target);
        const rel = path.relative(fs.realpathSync(base), real);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new ServiceError('Invalid cleanup workspace', 500);
        fs.rmSync(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
};

export const acquireSnapshotLease = async ({ redis, snapshotId, maxRetries = 3, retryDelayMs = 250 }) => {
    const key = `system-assessment:snapshot:${snapshotId}`;
    const token = crypto.randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (await redis.set(key, token, 'PX', 60000, 'NX') === 'OK') {
            acquired = true;
            break;
        }
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }
    if (!acquired) throw new ServiceError('Another system operation is active for this snapshot', 409);
    let lost = false;
    const refresh = async () => {
        try { if (await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end", 1, key, token, 60000) !== 1) lost = true; }
        catch { lost = true; }
    };
    const timer = setInterval(refresh, 15000); timer.unref();
    const assertOwnership=async()=>{if(lost || await redis.get(key)!==token)throw new ServiceError('System operation lease was lost',409);};
    const lease = {
        assertOwnership,
        assertHeld: async () => { if (lease.signal?.aborted) throw operationAbortReason(lease.signal); await assertOwnership(); },
        release: async () => { clearInterval(timer); await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, key, token); },
    };
    return lease;
};

export const purgeExpiredAssessmentArtifacts = (rootDir, now = Date.now()) => {
    const directory = containedPath(rootDir,'.covai-system-test/assessment');
    if(!fs.existsSync(directory)) return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
        if(!entry.isDirectory() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
        const target=containedPath(directory,entry.name);
        if(now-fs.statSync(target).mtimeMs > 14*24*60*60*1000) fs.rmSync(target,{recursive:true,force:true});
    }
};
