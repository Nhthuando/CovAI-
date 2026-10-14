import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { containedPath } from './fullSystemConfig.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

const ignored = new Set(['node_modules', '.git', '.agents', '.codex', '.specify', 'dist', 'build', 'coverage', '.covai-temp', '.covai-system-test', 'test-results', '.npm-cache']);
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
    try {
        for (const file of identity.files) {
            const destination = containedPath(target, file.path);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(containedPath(rootDir, file.path), destination);
        }
    } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
    return { rootDir: target, originalRoot: rootDir, operationId, ...identity, release: () => {
        const real = fs.realpathSync(target);
        const rel = path.relative(fs.realpathSync(base), real);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new ServiceError('Invalid cleanup workspace', 500);
        fs.rmSync(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
};

export const acquireSnapshotLease = async ({ redis, snapshotId }) => {
    const key = `system-assessment:snapshot:${snapshotId}`;
    const token = crypto.randomUUID();
    if (await redis.set(key, token, 'PX', 60000, 'NX') !== 'OK') throw new ServiceError('Another system operation is active for this snapshot', 409);
    let lost = false;
    const refresh = async () => {
        try { if (await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end", 1, key, token, 60000) !== 1) lost = true; }
        catch { lost = true; }
    };
    const timer = setInterval(refresh, 15000); timer.unref();
    const lease = {
        assertHeld: async () => { if (lease.signal?.aborted) throw new ServiceError('System operation canceled or resource budget exceeded',409); if (lost || await redis.get(key) !== token) throw new ServiceError('System operation lease was lost', 409); },
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
