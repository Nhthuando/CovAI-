import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma.js';
import { normalizeProjectPath, resolveContainedProjectPath, projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { chatContextMode } from './chatResponsePolicy.service.js';

export const COVAI_PRODUCT_GUIDE = `COV is the assistant inside CovAI. Explorer opens project source; saved source may differ from unsaved editor drafts. Unit Test supports unit test analysis, suggestions and execution; Integration Test covers endpoints and integration workflows; System Test covers browser scenarios and execution evidence. Overview summarizes saved quality and coverage. Architecture displays saved project structure analysis. Jobs shows queued/running/completed operations. Version Control manages source changes. Trustworthiness evaluates an imported chatbot and is separate from this assistant. Settings manages project/account configuration according to access. Help the user navigate these features and understand supplied evidence. Suggestions are not executed tests. File edits and execution must use CovAI's existing review/action flows. No data means unknown, not zero. Historical memory is not current source evidence.`;

export function redactChatSecrets(text = '') {
    return String(text)
        .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?(?:-----END [\w ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
        .replace(/\b(?:AIza[\w-]{25,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{20,})/g, '[REDACTED TOKEN]')
        .replace(/((?:["']?)(?:[\w-]*(?:password|passwd|api[_-]?key|access[_-]?token|secret)[\w-]*)(?:["']?)\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi, '$1"[REDACTED]"')
        .replace(/(\b(?:[\w-]*(?:password|passwd|api[_-]?key|access[_-]?token|secret)[\w-]*)\s*[:=]\s*)(?!["'\s])[^\s,;}]+/gi, '$1[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
export const isChatCredentialPath = value => /(^|[\\/])(?:\.(?:aws|ssh|azure|kube)(?:[\\/]|$)|\.env(?:\.[^\\/]*)?$|\.npmrc$|\.pypirc$|\.netrc$|id_rsa$|id_ed25519$|[^\\/]*\.(?:pem|key|p12|pfx|jks)$|credentials(?:\.[^\\/]*)?$)/i.test(value || '');

// Paths are checked against the canonical workspace, including every symlink ancestor.
export async function readChatSource(snapshot, filePath) {
    normalizeProjectPath(filePath);
    if (isChatCredentialPath(filePath)) return { path: filePath, status: 'excluded', reason: 'Credential file excluded from AI context.' };
    const resolved = await resolveContainedProjectPath(snapshot, filePath);
    const handle = await fs.open(resolved.target, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) return { path: filePath, status: 'unavailable', reason: 'Not a text file.' };
        // Read a bounded prefix even for very large files; never load an entire binary.
        const buffer = Buffer.alloc(Math.min(stat.size, 24001));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytes.includes(0)) return { path: filePath, status: 'excluded', reason: 'Binary file excluded.' };
        const content = redactChatSecrets(bytes.subarray(0, 24000).toString('utf8'));
        return { path: resolved.relativePath, snapshotId: snapshot.id, status: 'available', content,
            truncated: stat.size > 24000, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(),
            contentHash: createHash('sha256').update(content).digest('hex'), source: 'saved-workspace' };
    } finally { await handle.close(); }
}

export async function resolveChatWorkspaceContext({ projectId, snapshot, screenContext, message = '', attachments = [], project, isOwner = false }, db = prisma) {
    const result = { sources: [], warnings: [], data: {} };
    if (chatContextMode({ message, screenContext, attachments }) !== 'analysis') return result;
    const activity = screenContext?.activity;
    if (!snapshot) {
        result.warnings.push('No project snapshot is available. Source and analysis are unknown.');
        return result;
    }
    try {
        const entries = await fs.readdir(projectEditableWorkspaceRoot(snapshot), { withFileTypes: true });
        const visible = entries.filter(entry => !entry.isSymbolicLink() && !isChatCredentialPath(entry.name) && !['node_modules', '.git', 'dist', 'build', 'coverage', '.aws', '.ssh'].includes(entry.name));
        result.data.projectMap = { entries: visible.slice(0, 80).map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })), truncated: visible.length > 80, depth: 1 };
    } catch { result.warnings.push('The repository directory listing is unavailable.'); }
    const sourcePaths = new Set();
    if (activity === 'explorer' && screenContext.filePath) sourcePaths.add(screenContext.filePath);
    // Explicit file references allow questions about a different file without sending the entire repository.
    for (const match of message.matchAll(/(?:`|\s|^)((?:[\w@.-]+\/)*[\w@.-]+\.(?:[cm]?[jt]sx?|json|md|ya?ml|py|java|go|rs|css|html))(?=`|\s|[?,;:]|$)/g)) {
        if (sourcePaths.size < 3) sourcePaths.add(match[1]);
    }
    if (sourcePaths.size < 3) sourcePaths.add('package.json');
    for (const filePath of [...sourcePaths].slice(0, 3)) {
        try {
            const source = await readChatSource(snapshot, filePath);
            result.sources.push(source);
            if (source.status !== 'available') result.warnings.push(`${filePath}: ${source.reason}`);
            if (source.truncated) result.warnings.push(`${filePath}: only the first 24 KB of saved content is included.`);
        } catch (error) {
            if (error.code === 'INVALID_FILE_PATH') throw error;
            result.warnings.push(`${filePath}: saved source unavailable; unsaved editor changes are not included.`);
        }
    }
    if (['architecture', 'overview'].includes(activity)) {
        const analysis = await db.projectStructureAnalysis.findUnique({ where: { snapshotId: snapshot.id }, select: { schemaVersion: true, resultJson: true, updatedAt: true } });
        if (analysis) result.data.architecture = { ...analysis, resultJson: redactChatSecrets(analysis.resultJson).slice(0, 16000), truncated: analysis.resultJson.length > 16000 };
        else result.warnings.push('No saved architecture analysis is available for this snapshot.');
    }
    if (activity === 'overview') {
        result.data.latestTestRuns = await db.testRun.findMany({ where: { snapshotId: snapshot.id }, distinct: ['type'], orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, type: true, status: true, totalTests: true, passedTests: true, failedTests: true, finishedAt: true } });
    }
    if (['jobs', 'activity'].includes(activity)) {
        const where = { projectId, snapshotId: snapshot.id, ...(!isOwner ? { type: { notIn: ['AI_EVALUATION', 'AI_EVALUATION_PREPARE'] } } : {}), ...(screenContext.jobId ? { id: screenContext.jobId } : {}) };
        const rows = await db.job.findMany({ where, orderBy: { createdAt: 'desc' }, take: 8,
            select: { id: true, type: true, status: true, progress: true, createdAt: true, finishedAt: true, errorMessage: true } });
        if (screenContext.jobId && !rows.length) throw new ServiceError('Selected job not found in this project snapshot.', 404);
        result.data.jobs = rows.map(row => ({ ...row, errorMessage: row.errorMessage && redactChatSecrets(row.errorMessage).slice(0, 1500) }));
    }
    if (activity === 'settings') {
        result.data.settings = { name: project?.name, description: redactChatSecrets(project?.description || ''), defaultBranch: project?.defaultBranch,
            hasJest: project?.hasJest, hasVitest: project?.hasVitest, hasPlaywright: project?.hasPlaywright, hasCypress: project?.hasCypress };
        result.warnings.push('Only non-secret project settings are supplied. Account settings, credentials and unsaved forms are excluded.');
    }
    if (['version-control', 'git'].includes(activity)) {
        result.data.recentChanges = await db.projectCodeChange.findMany({ where: { projectId, snapshotId: snapshot.id }, orderBy: { createdAt: 'desc' }, take: 10,
            select: { id: true, source: true, createdAt: true } });
        result.warnings.push('Recent saved workspace change events are included; live Git status and diffs are not loaded.');
    }
    if (activity === 'trustworthiness') {
        if (isOwner) result.data.evaluations = await db.aiEvaluationProjectRun.findMany({ where: { projectId, snapshotId: snapshot.id }, orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, status: true, phase: true, errorCode: true, createdAt: true, finishedAt: true } });
        result.warnings.push(isOwner ? 'Only evaluation status is supplied; evidence, scoring details, target credentials and runtime environment are excluded.' : 'Evaluation details require project owner access and are excluded.');
    }
    if (activity === 'logic-analysis') {
        result.data.complexity = await db.cyclomatic.findMany({ where: { snapshotId: snapshot.id, ...(screenContext.filePath ? { filePath: screenContext.filePath } : {}) }, take: 20,
            select: { filePath: true, functionName: true, value: true } });
        result.warnings.push('Saved complexity is supplied; the current graph selection and unsaved source are not loaded.');
    }
    return result;
}
