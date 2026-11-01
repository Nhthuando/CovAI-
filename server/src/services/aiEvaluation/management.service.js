import crypto from 'node:crypto';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { resolveProjectAccess } from '../projectAccess.service.js';
import { parse, targetSchema, profileInputSchema, definitionSchema, validateApproval, runSchema, reviewSchema } from './contracts.js';
import { fail, hash, serial, VERSIONS, TERMINAL, redact } from './common.js';
import { validateEndpoint, executeTurn } from './httpJson.adapter.js';

export async function ownerAccess(db, projectId, userId) {
    const access = await resolveProjectAccess({ projectId, userId, capability: 'project.read', db });
    if (access.role !== 'OWNER') fail('OWNER_REQUIRED', 'Only the project owner can access chatbot evaluation', 403);
    return access.project;
}
export const must = resource => resource || fail('NOT_FOUND', 'Evaluation resource not found', 404);
export const targetFor = async (db, projectId, id) => must(await db.aiEvaluationTarget.findFirst({ where: { id, projectId } }));
export const profileFor = async (db, projectId, id) => must(await db.aiEvaluationProfile.findFirst({ where: { id, projectId } }));
export const versionFor = async (db, projectId, id) => must(await db.aiEvaluationProfileVersion.findFirst({ where: { id, profile: { projectId } }, include: { cases: { orderBy: { caseKey: 'asc' } } } }));
export const runFor = async (db, projectId, id) => must(await db.aiEvaluationRun.findFirst({ where: { id, projectId } }));
export function cleanTarget(target) {
    return { ...target, versions: target.versions?.map(({ credential, ...version }) => ({ ...version, credentialConfigured: !!credential && !credential.revokedAt, credentialRevision: credential?.revision || null })) };
}
export async function workspace(db, projectId) {
    const [targets, profiles, sources, runs] = await Promise.all([
        db.aiEvaluationTarget.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, include: { versions: { orderBy: { version: 'desc' }, include: { credential: { select: { revision: true, revokedAt: true } } } } } }),
        db.aiEvaluationProfile.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, include: { versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, revision: true, status: true, approvedAt: true } } } }),
        db.aiEvaluationKnowledgeSource.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, name: true, format: true, version: true, status: true, contentHash: true, provenance: true, createdAt: true } }),
        db.aiEvaluationRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, targetVersionId: true, profileVersionId: true, executionStatus: true, verdict: true, summary: true, jobId: true, errorCode: true, createdAt: true, finishedAt: true } }),
    ]);
    return { targets: targets.map(cleanTarget), profiles, sources, runs };
}
export async function saveTarget(db, projectId, input, targetId) {
    const config = parse(targetSchema, input.config);
    validateEndpoint(config.endpoint);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150) fail('INVALID_NAME', 'Enter a target name (1-150 characters)');
    const credential = input.credential;
    if (credential !== undefined && (typeof credential !== 'string' || !credential.length || credential.length > 4096 || /[\r\n]/.test(credential))) fail('INVALID_CREDENTIAL', 'Invalid target credential');
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const target = targetId ? await targetFor(tx, projectId, targetId) : await tx.aiEvaluationTarget.create({ data: { projectId, name: input.name.trim() } });
        if (target.archivedAt) fail('TARGET_ARCHIVED', 'Create a new target instead of modifying an archived one');
        const latest = await tx.aiEvaluationTargetVersion.findFirst({ where: { targetId: target.id }, orderBy: { version: 'desc' } });
        let credentialId = latest?.credentialId || null;
        if (credential !== undefined) {
            const previous = await tx.aiEvaluationCredential.findFirst({ where: { targetId: target.id }, orderBy: { revision: 'desc' } });
            credentialId = (await tx.aiEvaluationCredential.create({ data: { targetId: target.id, revision: (previous?.revision || 0) + 1, ciphertext: encrypt(credential) } })).id;
        }
        if (config.auth.type !== 'none' && !credentialId) fail('CREDENTIAL_REQUIRED', 'Provide an authentication credential');
        await tx.aiEvaluationTarget.update({ where: { id: target.id }, data: { name: input.name.trim() } });
        const version = await tx.aiEvaluationTargetVersion.create({ data: { targetId: target.id, version: (latest?.version || 0) + 1, config, configHash: hash(config), credentialId: config.auth.type === 'none' ? null : credentialId } });
        return { targetId: target.id, versionId: version.id };
    });
}
export async function targetCredential(db, targetVersion) {
    if (targetVersion.config.auth.type === 'none') return undefined;
    const credential = targetVersion.credential || await db.aiEvaluationCredential.findUnique({ where: { id: targetVersion.credentialId || '' } });
    if (!credential || credential.revokedAt) fail('CREDENTIAL_REVOKED', 'Target credential is missing or revoked');
    return decrypt(credential.ciphertext);
}
export async function testConnection(db, projectId, id, options = {}) {
    await targetFor(db, projectId, id);
    const version = must(await db.aiEvaluationTargetVersion.findFirst({ where: { targetId: id }, orderBy: { version: 'desc' } }));
    const credential = await targetCredential(db, version);
    const result = await executeTurn(version.config, { requestId: crypto.randomUUID(), messages: [{ role: 'user', content: 'Connection test. Reply with OK. Do not call tools or perform any action.' }], evaluationContext: { executionMode: 'CONNECTION_TEST', toolsAllowed: false } }, { credential, timeoutMs: 15000, ...options });
    return { answer: redact(result.answer, [credential]).slice(0, 2000), latencyMs: result.latencyMs, evidenceAvailability: result.evidenceAvailability, capabilityStatus: version.config.mockGateway ? 'GATEWAY_INTEGRATION_NOT_YET_VERIFIED' : 'ANSWER_ONLY' };
}
export async function createProfile(db, projectId, name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 150) fail('INVALID_NAME', 'Enter a benchmark name (1-150 characters)');
    return db.aiEvaluationProfile.create({ data: { projectId, name: name.trim(), versions: { create: { version: 1, definition: parse(definitionSchema, {}) } } }, include: { versions: true } });
}
export async function cloneProfile(db, projectId, id) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationProfile" WHERE id = ${id} FOR UPDATE`;
        const profile = await profileFor(tx, projectId, id);
        if (profile.archivedAt) fail('PROFILE_ARCHIVED', 'Archived benchmarks cannot be edited');
        const latest = await tx.aiEvaluationProfileVersion.findFirst({ where: { profileId: id }, orderBy: { version: 'desc' }, include: { cases: true } });
        const definition = structuredClone(latest.definition);
        definition.scoring.confirmed = false;
        return tx.aiEvaluationProfileVersion.create({ data: { profileId: id, version: latest.version + 1, definition, cases: { create: latest.cases.map(c => ({ caseKey: c.caseKey, taskType: c.taskType, definition: c.definition, definitionHash: c.definitionHash })) } }, include: { cases: true } });
    });
}
export async function saveProfile(db, projectId, id, input) {
    const value = parse(profileInputSchema, input);
    if (value.revision === undefined) fail('REVISION_REQUIRED', 'Provide the current draft revision');
    return serial(db, async tx => {
        const current = await versionFor(tx, projectId, id);
        if (current.status !== 'DRAFT') fail('IMMUTABLE_VERSION', 'Approved benchmark versions cannot be edited', 409);
        const changed = await tx.aiEvaluationProfileVersion.updateMany({ where: { id, status: 'DRAFT', revision: value.revision }, data: { definition: value.definition, revision: { increment: 1 } } });
        if (!changed.count) fail('STALE_REVISION', 'Benchmark changed. Reload before saving.', 409);
        if (new Set(value.cases.map(c => c.caseKey)).size !== value.cases.length) fail('DUPLICATE_CASE', 'Case keys must be unique');
        await tx.aiEvaluationTestCase.deleteMany({ where: { profileVersionId: id } });
        if (value.cases.length) await tx.aiEvaluationTestCase.createMany({ data: value.cases.map(c => ({ profileVersionId: id, caseKey: c.caseKey, taskType: c.taskType, definition: c, definitionHash: hash(c) })) });
        return versionFor(tx, projectId, id);
    });
}
export async function approveProfile(db, projectId, id, revision, userId) {
    return serial(db, async tx => {
        const version = await versionFor(tx, projectId, id);
        if (version.status !== 'DRAFT' || version.revision !== revision) fail('STALE_REVISION', 'Reload the current draft before approval', 409);
        const definition = parse(definitionSchema, version.definition);
        validateApproval(definition, version.cases.map(c => c.definition));
        const sources = await tx.aiEvaluationKnowledgeSource.findMany({ where: { id: { in: definition.sourceIds }, projectId, status: 'READY' } });
        if (sources.length !== new Set(definition.sourceIds).size) fail('SOURCE_NOT_READY', 'Every source must be ready and belong to this project');
        const manifest = sources.map(({ id: sourceId, name, version: sourceVersion, contentHash, content, provenance }) => ({ id: sourceId, name, version: sourceVersion, contentHash, content, provenance }));
        const changed = await tx.aiEvaluationProfileVersion.updateMany({ where: { id, status: 'DRAFT', revision }, data: { status: 'APPROVED', revision: { increment: 1 }, definitionHash: hash({ definition, cases: version.cases.map(c => c.definitionHash), sources: manifest.map(s => s.contentHash) }), sourceManifest: manifest, approvedBy: userId, approvedAt: new Date() } });
        if (!changed.count) fail('STALE_REVISION', 'Benchmark changed during approval', 409);
        return versionFor(tx, projectId, id);
    });
}
export async function enqueueStrict(type, jobId) {
    const { addJobToQueue } = await import('../queue.service.js');
    return addJobToQueue(type, jobId, {}, { attempts: 1 });
}
export async function createRun(db, projectId, userId, input, { enqueue = enqueueStrict, parentRunId = null } = {}) {
    const data = parse(runSchema, input);
    const existing = await db.aiEvaluationRun.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: data.idempotencyKey } } });
    if (existing) {
        if (existing.targetVersionId !== data.targetVersionId || existing.profileVersionId !== data.profileVersionId || (existing.snapshotId || null) !== (data.snapshotId || null)) fail('IDEMPOTENCY_CONFLICT', 'This request key was used with different versions', 409);
        return existing;
    }
    const profile = await versionFor(db, projectId, data.profileVersionId);
    if (profile.status !== 'APPROVED') fail('PROFILE_NOT_APPROVED', 'Approve the benchmark before running');
    const target = must(await db.aiEvaluationTargetVersion.findFirst({ where: { id: data.targetVersionId, target: { projectId, archivedAt: null } } }));
    await targetCredential(db, target);
    const definition = profile.definition;
    if (profile.cases.some(c => c.taskType === 'ACTION_TOOL')) {
        if (process.env.AI_EVALUATION_ACTION_ENABLED !== 'true') fail('ACTION_DISABLED', 'Action evaluation must be enabled by the operator', 503);
        if (!target.config.mockGateway || !target.config.testEnvironmentConfirmed) fail('GATEWAY_REQUIRED', 'Confirm a non-production target and enable its COVAI mock gateway integration');
        validateEndpoint(process.env.AI_EVALUATION_GATEWAY_URL || '');
    }
    if (data.snapshotId) must(await db.projectSnapshot.findFirst({ where: { id: data.snapshotId, projectId } }));
    const semanticCalls = profile.cases.reduce((sum, c) => sum + c.definition.criteria.filter(r => r.enabled && r.method === 'semantic').length, 0);
    if (definition.judge.enabled && semanticCalls > 200) fail('JUDGE_BUDGET', 'Limit each run to at most 200 semantic judgments');
    let run;
    try {
        run = await serial(db, async tx => {
            await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
            if (await tx.aiEvaluationRun.count({ where: { projectId, executionStatus: { in: ['QUEUED', 'RUNNING'] } } }) >= 2) fail('RUN_LIMIT', 'At most two evaluation runs can be active per project', 409);
            const job = await tx.job.create({ data: { projectId, userId, type: 'AI_EVALUATION', payloadJson: '{}' } });
            return tx.aiEvaluationRun.create({ data: { projectId, targetVersionId: target.id, profileVersionId: profile.id, snapshotId: data.snapshotId || null, idempotencyKey: data.idempotencyKey, parentRunId, jobId: job.id,
                manifest: { versions: VERSIONS, targetConfig: target.config, targetConfigHash: target.configHash, targetVersion: target.version, profileHash: profile.definitionHash, profileVersion: profile.version, sourceHashes: profile.sourceManifest.map(s => ({ id: s.id, hash: s.contentHash })), caseHashes: profile.cases.map(c => c.definitionHash), limits: definition.limits, scoring: definition.scoring, judge: definition.judge, evidenceScope: profile.cases.some(c => c.taskType === 'ACTION_TOOL') ? 'COVAI_GATEWAY_ONLY' : 'TARGET_RESPONSE', targetMetadataProvenance: 'TARGET_REPORTED' },
                cases: { create: profile.cases.map(c => ({ testCaseId: c.id, criteria: { create: c.definition.criteria.map(r => ({ criterionKey: r.key, method: r.method, status: 'NOT_EVALUATED', score: null, reason: 'Case has not been evaluated', evidenceRefs: [], evaluator: {}, details: { caseKey: c.caseKey, taskType: c.taskType, caseWeight: c.definition.weight, criterionWeight: r.weight, required: r.required, blocking: r.blocking, expected: r.rule || { groundTruth: r.groundTruth, rubric: r.rubric } } })) } })) } } });
        });
    } catch (error) {
        if (error.code === 'P2002') return createRun(db, projectId, userId, input, { enqueue, parentRunId });
        throw error;
    }
    try { await enqueue('AI_EVALUATION', run.jobId); }
    catch {
        await db.$transaction(async tx => {
            const changed = await tx.aiEvaluationRun.updateMany({ where: { id: run.id, executionStatus: 'QUEUED' }, data: { executionStatus: 'ERROR', errorCode: 'ENQUEUE_FAILED', finishedAt: new Date() } });
            if (changed.count) await tx.job.update({ where: { id: run.jobId }, data: { status: 'FAILED', errorMessage: 'Evaluation enqueue failed', finishedAt: new Date() } });
        });
        fail('QUEUE_UNAVAILABLE', 'Evaluation could not be queued. Restore Redis and create a new run.', 503);
    }
    return run;
}
export async function addReview(db, projectId, criterionId, userId, input) {
    const value = parse(reviewSchema, input);
    const criterion = must(await db.aiEvaluationCriterionResult.findFirst({ where: { id: criterionId, caseResult: { run: { projectId, executionStatus: { in: TERMINAL } } } } }));
    return db.aiEvaluationHumanReview.create({ data: { criterionResultId: criterion.id, reviewerId: userId, ...value } });
}
