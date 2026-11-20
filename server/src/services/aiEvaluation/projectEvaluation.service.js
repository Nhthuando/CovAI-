import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { projectEvaluationSourceScope } from './projectSourceScope.service.js';
import { selectProjectAdapter } from './projectAdapterRegistry.service.js';
import { assessProjectEnvironment } from './projectEnvironment.service.js';
import { withProjectGuard } from '../projectAccess.service.js';
import { hash, fail, serial, safeError, redact, requireEnabled } from './common.js';
import { parse, caseSchema, definitionSchema, validateApproval } from './contracts.js';
import { ownerAccess, enqueueStrict, createRun } from './management.service.js';
import { discoverProjectChatbot } from './projectDiscovery.service.js';
import { buildPlatformBenchmark } from './platformBenchmark.service.js';
import { freezeProjectSource, startProjectSandbox, cleanupProjectSandbox, reconcileProjectSandboxResources } from './projectSandbox.service.js';
import { getRunReport } from './report.service.js';
import { removeRunArtifacts } from './artifactStore.service.js';
import { geminiConfiguration } from '../geminiRouting.service.js';
import { storedEnvironment, mergeEnvironment, writeProjectSettings } from './projectSettings.service.js';

const workspaces = fileURLToPath(new URL('../../../.covai-temp/chatbot-evaluations/', import.meta.url));
async function removeWorkspace(id) {
    const directory = path.resolve(workspaces, id);
    if (!/^[\w-]+$/.test(id) || path.dirname(directory) !== path.resolve(workspaces)) fail('INVALID_WORKSPACE', 'Invalid evaluation workspace');
    await fs.rm(directory, { recursive: true, force: true });
}
const controllers = new Map();
const active = ['QUEUED', 'RUNNING'];
const requestSchema = z.object({ snapshotId: z.string().regex(/^[\w-]{1,128}$/).nullable().optional(), idempotencyKey: z.string().regex(/^[\w-]{1,128}$/), candidateId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(), judgeConsent: z.boolean().optional(), settingsRevision: z.number().int().nonnegative().optional(), removeEnvironmentNames: z.array(z.string()).max(30).default([]), environment: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/), z.string().max(10000)).default({}) }).strict();
export const projectEvaluationDto = row => { if (!row) return null; const { encryptedEnvironment, leaseToken, leaseUntil, ...safe } = row; const { requestFingerprint, ...configuration } = safe.configuration; const discovery = safe.discovery ? { ...safe.discovery, environmentAssessment: safe.discovery.environmentAssessment || assessProjectEnvironment(safe.discovery.environmentNames || []) } : safe.discovery; return { ...safe, discovery, configuration, environmentConfigured: Boolean(encryptedEnvironment) }; };
const rowFor = async (db, projectId, id) => { const row = await db.aiEvaluationProjectRun.findFirst({ where: { id, projectId } }); if (!row) fail('NOT_FOUND', 'Project evaluation not found', 404); return row; };

export async function startProjectEvaluation(db, projectId, userId, input, { enqueue = enqueueStrict } = {}) {
    requireEnabled(); await ownerAccess(db, projectId, userId);
    const submitted = parse(requestSchema, input);
    const result = await serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const saved = await tx.aiEvaluationProjectSettings.findUnique({ where: { projectId } });
        const value = { ...submitted, snapshotId: submitted.snapshotId === undefined ? saved?.settings.snapshotId || undefined : submitted.snapshotId || undefined, candidateId: submitted.candidateId === undefined ? saved?.settings.candidateId || null : submitted.candidateId, judgeConsent: submitted.judgeConsent ?? saved?.settings.judgeConsent ?? false, environment: mergeEnvironment(storedEnvironment(saved), submitted.environment, submitted.removeEnvironmentNames) };
        const fingerprint = hash({ snapshotId: value.snapshotId || null, candidateId: value.candidateId || null, judgeConsent: value.judgeConsent, environment: value.environment });
        const existing = await tx.aiEvaluationProjectRun.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: value.idempotencyKey } } });
        if (existing) { if (existing.configuration.requestFingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for different inputs', 409); return { row: existing, created: false }; }
        if (submitted.settingsRevision !== undefined && submitted.settingsRevision !== (saved?.revision || 0)) fail('SETTINGS_CONFLICT', 'Configuration has changed. Reload before starting.', 409);
        const snapshot = await tx.projectSnapshot.findFirst({ where: { projectId, ...(value.snapshotId ? { id: value.snapshotId } : {}) }, orderBy: { createdAt: 'desc' } });
        if (!snapshot?.rootDir) fail('SNAPSHOT_REQUIRED', 'Import a project snapshot before evaluating its chatbot');
        if (await tx.aiEvaluationProjectRun.count({ where: { projectId, status: { in: active } } }) >= 1) fail('EVALUATION_ACTIVE', 'A chatbot evaluation is already running for this project', 409);
        await writeProjectSettings(tx, projectId, { snapshotId: value.snapshotId || null, candidateId: value.candidateId, judgeConsent: value.judgeConsent }, value.environment);
        const job = await tx.job.create({ data: { projectId, userId, type: 'AI_EVALUATION_PREPARE', payloadJson: '{}' } });
        const row = await tx.aiEvaluationProjectRun.create({ data: { projectId, snapshotId: snapshot.id, jobId: job.id, idempotencyKey: value.idempotencyKey, configuration: { candidateId: value.candidateId || null, judgeConsent: value.judgeConsent, requestFingerprint: fingerprint, environmentNames: Object.keys(value.environment) }, encryptedEnvironment: Object.keys(value.environment).length ? encrypt(JSON.stringify(value.environment)) : null } });
        await tx.job.update({ where: { id: job.id }, data: { payloadJson: JSON.stringify({ projectEvaluationId: row.id }) } });
        return { row, created: true };
    });
    if (result.created) {
        try { await enqueue('AI_EVALUATION_PREPARE', result.row.jobId); }
        catch { await finishProjectEvaluation(db, result.row.id, 'ERROR', { code: 'QUEUE_UNAVAILABLE', message: 'Evaluation could not be queued. Restore Redis and retry.' }); fail('QUEUE_UNAVAILABLE', 'Evaluation could not be queued. Restore Redis and retry.', 503); }
    }
    return projectEvaluationDto(result.row);
}
export async function listProjectEvaluations(db, projectId) {
    const [runs, snapshots] = await Promise.all([
        db.aiEvaluationProjectRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 30 }),
        db.projectSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, createdAt: true, source: true } }),
    ]);
    return { runs: runs.map(projectEvaluationDto), snapshots, judgeConfigured: Boolean(process.env.AI_EVALUATION_JUDGE_MODEL && geminiConfiguration('chatbot-trustworthiness').configured) };
}
export async function getProjectEvaluation(db, projectId, id) {
    const row = await rowFor(db, projectId, id);
    return { ...projectEvaluationDto(row), report: row.evaluationRunId ? await getRunReport(db, projectId, row.evaluationRunId) : null };
}
export async function deleteProjectEvaluation(db, projectId, id) {
    const row = await rowFor(db, projectId, id);
    if (active.includes(row.status)) fail('EVALUATION_ACTIVE', 'Cancel the evaluation before deleting it', 409);
    const run = row.evaluationRunId ? await db.aiEvaluationRun.findFirst({ where: { id: row.evaluationRunId, projectId }, include: { evidence: true, targetVersion: true, profileVersion: true } }) : null;
    if (run && active.includes(run.executionStatus)) fail('EVALUATION_ACTIVE', 'The evaluation worker is still stopping', 409);
    if (run) await removeRunArtifacts(projectId, run.id, run.evidence);
    await removeWorkspace(row.id);
    await serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        if (run) { await tx.aiEvaluationRun.delete({ where: { id: run.id } }); await tx.job.deleteMany({ where: { id: run.jobId, projectId } }); }
        await tx.aiEvaluationProjectRun.delete({ where: { id: row.id } });
        await tx.job.deleteMany({ where: { id: row.jobId, projectId } });
        if (run && !await tx.aiEvaluationRun.count({ where: { targetVersion: { targetId: run.targetVersion.targetId } } })) await tx.aiEvaluationTarget.delete({ where: { id: run.targetVersion.targetId } });
        if (run && !await tx.aiEvaluationRun.count({ where: { profileVersion: { profileId: run.profileVersion.profileId } } })) await tx.aiEvaluationProfile.delete({ where: { id: run.profileVersion.profileId } });
    });
    return { deleted: true };
}
export async function finishProjectEvaluation(db, id, status, error = null, extra = {}, expectedLease) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationProjectRun" WHERE id = ${id} FOR UPDATE`;
        const row = await tx.aiEvaluationProjectRun.findUnique({ where: { id } });
        if (!row || !active.includes(row.status) || (expectedLease && row.leaseToken !== expectedLease)) return row;
        const updated = await tx.aiEvaluationProjectRun.update({ where: { id }, data: { ...extra, status, phase: status === 'COMPLETED' ? 'RESULTS' : row.phase, finishedAt: new Date(), leaseToken: null, leaseUntil: null, errorCode: error?.code || null, errorMessage: error?.message || null } });
        await tx.job.updateMany({ where: { id: row.jobId }, data: { status: status === 'COMPLETED' ? 'SUCCESS' : status === 'CANCELED' ? 'CANCELED' : 'FAILED', progress: status === 'COMPLETED' ? 100 : undefined, finishedAt: new Date(), errorMessage: error?.message || null } });
        return updated;
    });
}
export async function cancelProjectEvaluation(db, projectId, id) {
    const row = await rowFor(db, projectId, id);
    controllers.get(row.id)?.abort();
    if (row.evaluationRunId) await (await import('./runner.service.js')).cancelRun(db, row.evaluationRunId);
    const canceled = await finishProjectEvaluation(db, id, 'CANCELED', { code: 'USER_CANCELED', message: 'Evaluation canceled' });
    if (row.status === 'RUNNING') await cleanupProjectSandbox(row.id).catch(() => {});
    return projectEvaluationDto(canceled);
}

async function platformVersions(db, row, benchmark, discovery, contract) {
    const definition = parse(definitionSchema, benchmark.definition), cases = benchmark.cases.map(c => parse(caseSchema, c));
    validateApproval(definition, cases);
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationProjectRun" WHERE id = ${row.id} FOR UPDATE`;
        const current = await tx.aiEvaluationProjectRun.findUnique({ where: { id: row.id } });
        if (current?.status !== 'RUNNING') fail('RUN_CANCELED', 'Evaluation canceled', 409);
        const config = { adapter: 'PROJECT_SANDBOX', auth: { type: 'none' }, conversationMode: 'messages', snapshotId: row.snapshotId, sourceHash: discovery.sourceHash, candidate: discovery.candidates[0], contract };
        const target = await tx.aiEvaluationTarget.create({ data: { projectId: row.projectId, name: 'Imported project chatbot', versions: { create: { version: 1, config, configHash: hash(config) } } }, include: { versions: true } });
        const profile = await tx.aiEvaluationProfile.create({ data: { projectId: row.projectId, name: `COVAI benchmark ${benchmark.policy.version}`, versions: { create: { version: 1, revision: 1, status: 'APPROVED', definition, definitionHash: benchmark.contractHash, approvedAt: new Date(), sourceManifest: [], cases: { create: cases.map(c => ({ caseKey: c.caseKey, taskType: c.taskType, definition: c, definitionHash: hash(c) })) } } } }, include: { versions: true } });
        return { targetVersionId: target.versions[0].id, profileVersionId: profile.versions[0].id };
    });
}

export async function processProjectEvaluation(jobId, { db = prisma, sandbox = startProjectSandbox, provider, discover = discoverProjectChatbot } = {}) {
    requireEnabled();
    const found = await db.aiEvaluationProjectRun.findUnique({ where: { jobId } });
    if (!found || found.status !== 'QUEUED') return;
    const leaseToken = crypto.randomUUID();
    if (!(await db.aiEvaluationProjectRun.updateMany({ where: { id: found.id, status: 'QUEUED' }, data: { status: 'RUNNING', leaseToken, leaseUntil: new Date(Date.now() + 45000) } })).count) return;
    const controller = new AbortController(); controllers.set(found.id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60 * 1000)]);
    const directory = path.join(workspaces, found.id);
    let runtime, childRun, heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return; heartbeatBusy = true;
        try {
            const renewed = await db.aiEvaluationProjectRun.updateMany({ where: { id: found.id, status: 'RUNNING', leaseToken }, data: { leaseUntil: new Date(Date.now() + 45000) } });
            const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
            if (!renewed.count || job?.status === 'CANCELED') controller.abort();
        } catch { controller.abort(); } finally { heartbeatBusy = false; }
    }, 5000);
    const progress = async (phase, value, patch = {}) => {
        if (signal.aborted) fail('RUN_CANCELED', 'Evaluation canceled or timed out', 409);
        const changed = await db.aiEvaluationProjectRun.updateMany({ where: { id: found.id, status: 'RUNNING', leaseToken }, data: { phase, ...patch } });
        if (!changed.count) fail('RUN_CANCELED', 'Evaluation no longer active', 409);
        await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { progress: value } });
    };
    try {
        const job = await db.job.findUnique({ where: { id: jobId } });
        await db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
        await fs.mkdir(workspaces, { recursive: true });
        let sourceScope;
        await withProjectGuard({ projectId: found.projectId, userId: job.userId, capability: 'project.read', db, timeout: 120000 }, async tx => {
            const snapshot = await tx.projectSnapshot.findFirst({ where: { id: found.snapshotId, projectId: found.projectId } });
            if (!snapshot) fail('SNAPSHOT_UNAVAILABLE', 'The selected source snapshot is no longer available');
            sourceScope = await projectEvaluationSourceScope(snapshot);
            await freezeProjectSource(sourceScope.root, directory, { signal });
        });
        const discovery = await discover(directory);
        discovery.sourceScope = sourceScope.manifest;
        await progress('CHECKING', 10, { discovery });
        let candidate = found.configuration.candidateId ? discovery.candidates.find(c => c.id === found.configuration.candidateId) : discovery.candidates.length === 1 ? discovery.candidates[0] : null;
        if (!candidate && discovery.status === 'CHATBOT_ADAPTER_REQUIRED') fail('CHATBOT_ADAPTER_REQUIRED', "Detected custom Socket.IO chatbot in source, but no compatible adapter matches the application's event contract and authentication. Adding a Gemini key does not resolve this protocol limitation.");
        if (!candidate && discovery.status === 'CHATBOT_PROTOCOL_UNSUPPORTED') fail('CHAINLIT_ENTRYPOINT_REQUIRED', 'Detected Chainlit library but could not determine entry point: requires an app with on_message or mount_chainlit pointing to a real callback.');
        if (!candidate && discovery.status === 'CHATBOT_BACKEND_REQUIRED') fail('CHATBOT_BACKEND_REQUIRED', 'Detected chat UI using LangGraph SDK, but no supported HTTP JSON response backend was found in source. The UI requires a LangGraph server and Assistant/Graph ID. Import the backend; LangGraph streaming protocol requires a dedicated adapter.');
        if (!candidate) fail(discovery.candidates.length ? 'CHATBOT_SELECTION_REQUIRED' : 'CHATBOT_NOT_FOUND', discovery.candidates.length ? 'Several chatbot routes were detected. Select the chatbot to evaluate.' : 'No supported chatbot entry point was found in this project');
        const selectedDiscovery = { ...discovery, candidates: [candidate] };
        const adapter = selectProjectAdapter(candidate);
        const environment = found.encryptedEnvironment ? JSON.parse(decrypt(found.encryptedEnvironment)) : {};
        const protectedSecrets = Object.entries(environment).filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) && value.length >= 8).map(([, value]) => value);
        runtime = await sandbox({ root: directory, candidate, environment, signal, ownerId: found.id, onProgress: async (detail, preparation) => progress('CHECKING', 20, { result: { readinessStage: detail, ...(preparation ? { runtimePreparation: preparation } : {}) } }) });
        const redactionValues = [...Object.values(environment), ...(runtime.generatedSecrets || [])];
        protectedSecrets.push(...(runtime.generatedSecrets || []));
        const contract = await adapter.probe(runtime, { signal });
        const runtimeInfo = { adapter: contract.adapter, protocol: contract.protocol, dependencyProvenance: runtime.dependencyProvenance || null, generatedEnvironmentNames: runtime.generatedSecrets?.length ? ['CHAINLIT_AUTH_SECRET'] : [] };
        candidate = { ...candidate, requestField: contract.requestField };
        selectedDiscovery.candidates = [candidate];
        const sources = [];
        for (const source of discovery.knowledgeSources.slice(0, 30)) if (source.characters <= 200000) sources.push({ ...source, content: await fs.readFile(path.join(directory, source.file), 'utf8') });
        const benchmark = buildPlatformBenchmark({ discovery: selectedDiscovery, sources, judgeModel: process.env.AI_EVALUATION_JUDGE_MODEL || '', judgeConsent: found.configuration.judgeConsent, protectedSecretsPresent: protectedSecrets.length > 0 });
        if (runtime.dependencyProvenance?.complete === false) benchmark.unavailable.push({ criterion: 'runtime-dependency-fidelity', status: 'INSUFFICIENT_EVIDENCE', reason: 'Project lacks requirements.txt. Run used compatible Chainlit runtime managed by COVAI; did not verify exact native dependencies of application.' });
        const readiness = { ...contract, probe: redact({ ...contract.probe, answer: contract.probe.answer.slice(0, 2000) }, redactionValues) };
        await progress('ANALYZING', 40, { result: { readiness, runtime: runtimeInfo, benchmark: { id: benchmark.policy.id, version: benchmark.policy.version, caseCount: benchmark.cases.length, sourceReferences: benchmark.sourceReferences }, businessAnalysis: benchmark.businessAnalysis, unavailable: benchmark.unavailable } });
        const versions = await platformVersions(db, found, benchmark, selectedDiscovery, readiness);
        childRun = await createRun(db, found.projectId, job.userId, { ...versions, snapshotId: found.snapshotId, idempotencyKey: `project-${found.id}` }, { enqueue: async () => {} });
        await progress('ANALYZING', 45, { evaluationRunId: childRun.id });
        const additionalCriteria = benchmark.unavailable.map(item => ({ caseKey: 'platform-evidence', criterionKey: item.criterion, taskType: 'KNOWLEDGE_QA', caseWeight: 1, criterionWeight: 1, required: item.status !== 'NOT_APPLICABLE', blocking: false, status: item.status, score: null }));
        if (protectedSecrets.some(secret => contract.probe.answer.includes(secret))) additionalCriteria.push({ caseKey: 'readiness', criterionKey: 'runtime-secret-disclosure', taskType: 'KNOWLEDGE_QA', caseWeight: 1, criterionWeight: 1, required: true, blocking: true, status: 'FAILED', score: 0, reason: 'The observed readiness response disclosed a supplied test credential. Its value is redacted in the frozen target contract.' });
        await db.aiEvaluationRun.update({ where: { id: childRun.id }, data: { manifest: { ...childRun.manifest, versions: { ...childRun.manifest.versions, adapter: `${adapter.id}-v${adapter.version}`, discovery: discovery.version }, additionalCriteria, platformBenchmark: { id: benchmark.policy.id, version: benchmark.policy.version, contractHash: benchmark.contractHash }, sourceReferences: benchmark.sourceReferences, projectBusinessAnalysis: benchmark.businessAnalysis, projectSourceHash: discovery.sourceHash, projectSourceManifest: discovery.manifest, projectSourceScope: discovery.sourceScope, projectRuntime: runtimeInfo, evidenceScope: 'IMPORTED_PROJECT_SANDBOX' } } });
        await (await import('./runner.service.js')).processEvaluation(childRun.jobId, { db, provider, turnExecutor: adapter.executor(runtime, contract), parentSignal: signal, redactionSecrets: redactionValues, protectedSecrets });
        const report = await getRunReport(db, found.projectId, childRun.id);
        if (report.executionStatus !== 'COMPLETED') fail(report.errorCode || 'EVALUATION_INTERRUPTED', 'Chatbot evaluation did not complete');
        await runtime.cleanup(); runtime = null;
        await finishProjectEvaluation(db, found.id, 'COMPLETED', null, { result: { readiness, runtime: runtimeInfo, benchmark: { id: benchmark.policy.id, version: benchmark.policy.version, caseCount: benchmark.cases.length, sourceReferences: benchmark.sourceReferences }, businessAnalysis: benchmark.businessAnalysis, unavailable: benchmark.unavailable, summary: report.summary } }, leaseToken);
    } catch (error) {
        if (childRun) await (await import('./runner.service.js')).cancelRun(db, childRun.id).catch(() => {});
        await finishProjectEvaluation(db, found.id, signal.aborted ? 'CANCELED' : 'ERROR', safeError(error), {}, leaseToken);
    } finally {
        clearInterval(heartbeat); controllers.delete(found.id);
        await runtime?.cleanup().catch(() => {});
        await removeWorkspace(found.id).catch(() => {});
    }
}

export async function reconcileProjectEvaluations(db = prisma, { cleanup = cleanupProjectSandbox, sweep = reconcileProjectSandboxResources } = {}) {
    const stale = await db.aiEvaluationProjectRun.findMany({ where: { OR: [{ status: 'RUNNING', leaseUntil: { lt: new Date() } }, { status: 'QUEUED', createdAt: { lt: new Date(Date.now() - 300000) } }] }, take: 50 });
    for (const row of stale) {
        let recovered = false;
        await serial(db, async tx => {
            await tx.$queryRaw`SELECT id FROM "AiEvaluationProjectRun" WHERE id = ${row.id} FOR UPDATE`;
            const current = await tx.aiEvaluationProjectRun.findUnique({ where: { id: row.id } });
            if (current?.status !== row.status || current.leaseUntil?.getTime() !== row.leaseUntil?.getTime()) return;
            await tx.aiEvaluationProjectRun.update({ where: { id: row.id }, data: { status: 'INDETERMINATE', errorCode: 'WORKER_INTERRUPTED', errorMessage: 'Worker interrupted. Start a new evaluation; requests were not replayed.', finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
            await tx.job.updateMany({ where: { id: row.jobId }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Worker interrupted' } });
            recovered = true;
        });
        if (recovered) {
            if (row.evaluationRunId) await (await import('./runner.service.js')).cancelRun(db, row.evaluationRunId);
            await cleanup(row.id).catch(() => {});
            const directory = path.join(workspaces, row.id);
            if (/^[\w-]+$/.test(row.id) && path.dirname(path.resolve(directory)) === path.resolve(workspaces)) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        }
    }
    await sweep(db).catch(() => {});
    const directories = await fs.readdir(workspaces, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const ids = directories.filter(entry => entry.isDirectory() && /^[\w-]+$/.test(entry.name)).map(entry => entry.name);
    for (let index = 0; index < ids.length; index += 100) {
        const ended = await db.aiEvaluationProjectRun.findMany({ where: { id: { in: ids.slice(index, index + 100) }, status: { notIn: active } }, select: { id: true } });
        for (const row of ended) await removeWorkspace(row.id).catch(() => {});
    }
}
