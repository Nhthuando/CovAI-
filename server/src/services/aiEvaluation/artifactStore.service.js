import fs from 'node:fs/promises';
import path from 'node:path';
import { fail, hash } from './common.js';

const root = () => path.resolve('storage/projects');
const valid = id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id);
async function localPath(projectId, runId, filename) {
    if (!valid(projectId) || !valid(runId) || (filename && !/^[a-f0-9]{64}\.json$/.test(filename))) fail('INVALID_ARTIFACT_PATH', 'Invalid evaluation artifact reference');
    const base = root(); const target = path.join(base, projectId, 'ai-evaluations', runId, ...(filename ? [filename] : []));
    let current = path.parse(base).root;
    for (const part of path.relative(current, target).split(path.sep)) {
        current = path.join(current, part);
        try { if ((await fs.lstat(current)).isSymbolicLink()) fail('UNSAFE_ARTIFACT_PATH', 'Evaluation artifact paths cannot contain symlinks'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!target.startsWith(base + path.sep)) fail('INVALID_ARTIFACT_PATH', 'Artifact is outside project storage');
    return target;
}
async function bucket() { return (await import('../../config/firebase.js')).getBucket(); }
export async function storeEvidencePayload(projectId, runId, payload) {
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text) <= 64 * 1024) return payload;
    const contentHash = hash(text); const filename = `${contentHash}.json`;
    const backend = process.env.AI_EVALUATION_ARTIFACT_DRIVER === 'firebase' ? 'FIREBASE' : 'LOCAL';
    if (backend === 'FIREBASE') {
        const key = `projects/${projectId}/ai-evaluations/${runId}/${filename}`;
        await (await bucket()).file(key).save(text, { resumable: false, metadata: { contentType: 'application/json' } });
    } else {
        const target = await localPath(projectId, runId, filename);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, text, { flag: 'w' });
    }
    return { _artifact: { backend, filename, contentHash, bytes: Buffer.byteLength(text) } };
}
export async function readEvidencePayload(projectId, runId, payload) {
    if (!payload?._artifact) return payload;
    const artifact = payload._artifact;
    let content;
    if (artifact.backend === 'LOCAL') content = await fs.readFile(await localPath(projectId, runId, artifact.filename), 'utf8');
    else if (artifact.backend === 'FIREBASE' && valid(projectId) && valid(runId) && /^[a-f0-9]{64}\.json$/.test(artifact.filename)) {
        const [buffer] = await (await bucket()).file(`projects/${projectId}/ai-evaluations/${runId}/${artifact.filename}`).download(); content = buffer.toString('utf8');
    } else fail('INVALID_ARTIFACT', 'Invalid artifact reference');
    if (hash(content) !== artifact.contentHash) fail('ARTIFACT_CORRUPTED', 'Evidence artifact integrity check failed', 500);
    return JSON.parse(content);
}
export async function removeRunArtifacts(projectId, runId, evidence) {
    const directory = await localPath(projectId, runId);
    if (evidence.some(e => e.payload?._artifact?.backend === 'FIREBASE')) {
        const prefix = `projects/${projectId}/ai-evaluations/${runId}/`;
        const [files] = await (await bucket()).getFiles({ prefix });
        if (files.some(file => !file.name.startsWith(prefix))) fail('INVALID_ARTIFACT', 'Cloud cleanup returned an unexpected key', 500);
        await Promise.all(files.map(file => file.delete({ ignoreNotFound: true })));
    }
    await fs.rm(directory, { recursive: true, force: true });
}
