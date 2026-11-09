import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { containedPath,resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { currentProjectOperation,withOperationPublishGuard } from './projectOperationWorkspace.service.js';

const kinds = { SCREENSHOT: { mimeType: 'image/png', maxBytes: 15 * 1024 * 1024 }, TRACE: { mimeType: 'application/zip', maxBytes: 25 * 1024 * 1024 } };

export const inspectRunArtifact = ({ rootDir, relativePath, kind }) => {
    const policy = kinds[kind];
    if (!policy || typeof relativePath !== 'string' || !relativePath.startsWith('.covai-system-test/')) throw new ServiceError('Unsupported assessment artifact', 422);
    const absolute = containedPath(rootDir, relativePath);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > policy.maxBytes) throw new ServiceError('Assessment artifact size is invalid', 422);
    const bytes = fs.readFileSync(absolute);
    if (kind === 'SCREENSHOT' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ServiceError('Invalid PNG evidence', 422);
    if (kind === 'TRACE' && !bytes.subarray(0, 2).equals(Buffer.from([80, 75]))) throw new ServiceError('Invalid trace archive', 422);
    return { relativePath: relativePath.replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), mimeType: policy.mimeType, byteSize: bytes.length };
};

export const persistRunArtifacts = async ({ client, assessmentId, rootDir, artifacts, catalog = [] }) => withOperationPublishGuard(async tx => {
    const operation = currentProjectOperation();
    const writeClient = operation ? tx : client;
    const saved = [];
    for (const artifact of artifacts.slice(0, 500)) {
        const matches = catalog.filter(scenario => scenario.filePath === artifact.filePath && scenario.title === artifact.title);
        try {
            const inspected = inspectRunArtifact({ rootDir, relativePath: artifact.relativePath, kind: artifact.kind });
            if (operation) {
                const original = resolveSystemRepositoryRoot(path.join(operation.originalRootDir,operation.analysisRelative));
                const destination = containedPath(original,inspected.relativePath);
                const bytes = fs.readFileSync(containedPath(rootDir,inspected.relativePath));
                fs.mkdirSync(path.dirname(destination),{recursive:true});
                if (!fs.existsSync(destination)) fs.writeFileSync(destination,bytes,{flag:'wx'});
                else if (crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') !== inspected.sha256) throw new ServiceError('Artifact identity collision',409);
            }
            const record = await writeClient.systemRunArtifact.create({ data: { assessmentId, scenarioKey: matches.length === 1 ? matches[0].scenarioKey : null, kind: artifact.kind, runIndex:artifact.runIndex || null, attemptIndex:artifact.attemptIndex ?? null, stepKey:artifact.stepKey || null, purpose:artifact.purpose || (artifact.kind === 'TRACE' ? 'FAILURE' : 'FINAL'), ...inspected } });
            saved.push({...record,filePath:artifact.filePath,title:artifact.title});
        } catch (error) {
            if (error.statusCode) continue;
            throw error;
        }
    }
    return saved;
});

export const readOwnedRunArtifact = ({ rootDir, artifact }) => {
    if(artifact.expiredAt)throw new ServiceError('This evidence has expired under the retention policy',410);
    if (!fs.existsSync(containedPath(rootDir,artifact.relativePath))) rootDir = resolveSystemRepositoryRoot(rootDir);
    const inspected = inspectRunArtifact({ rootDir, relativePath: artifact.relativePath, kind: artifact.kind });
    if (inspected.sha256 !== artifact.sha256 || inspected.byteSize !== artifact.byteSize) throw new ServiceError('Artifact hash mismatch', 409);
    return { bytes: fs.readFileSync(containedPath(rootDir, artifact.relativePath)), mimeType: inspected.mimeType };
};

// Candidate runs are read-only operations, but their verified artifacts must
// survive the operation copy so a later explicit Apply can publish a report.
export const preserveCandidateArtifacts = ({rootDir,report}) => {
    const operation=currentProjectOperation();
    if(!operation)return;
    const destinationRoot=resolveSystemRepositoryRoot(path.join(operation.originalRootDir,operation.analysisRelative));
    const retained=[];
    for(const artifact of (report.evidenceArtifacts||[]).slice(0,500)) {
        try {
            const inspected=inspectRunArtifact({rootDir,relativePath:artifact.relativePath,kind:artifact.kind});
            const target=containedPath(destinationRoot,inspected.relativePath);
            fs.mkdirSync(path.dirname(target),{recursive:true});
            const bytes=fs.readFileSync(containedPath(rootDir,inspected.relativePath));
            if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:'wx'});
            else if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==inspected.sha256)throw new ServiceError('Candidate artifact identity mismatch',409);
            retained.push({...artifact,...inspected});
        }catch(error){if(!error.statusCode && error.code!=='ENOENT')throw error;}
    }
    report.evidenceArtifacts=retained;
};
