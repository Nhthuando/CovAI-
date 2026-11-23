import crypto from 'node:crypto';
import { getAgentManifest } from '../../agents/registry.js';
import { AI_MODELS } from '../../../../shared/aiModels.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { nextMidnight } from '../../utils/geminiQuota.js';
import { ServiceError } from '../../utils/serviceError.js';
import { resolveProjectAccess } from '../projectAccess.service.js';
import {
    parse,
    targetSchema,
    profileInputSchema,
    definitionSchema,
    validateApproval,
    assertDistinctGeneratorAndJudgeModels,
    runSchema,
    reviewSchema,
} from './contracts.js';
import { DEFAULT_EVALUATION_CONFIG, enabled, fail, hash, serial, VERSIONS, TERMINAL, redact, lastLogLines } from './common.js';
import { validateEndpoint, executeTurn } from './httpJson.adapter.js';
import { saveKnowledge, snapshotKnowledge } from './knowledge.service.js';
import { getChatbotDesignAudit } from './designAudit.service.js';
import { isCriterionApplicableToTask } from './evaluator.service.js';
import { verifySourceQuoteAgainstSources, UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION, readEvaluatorFallbackConfig } from './judge.service.js';
import { DEFAULT_PROBE_SECRET_TTL_MS, storeEphemeralSecret, destroyEphemeralSecret, readEphemeralSecret } from './ephemeralSecret.service.js';
import { startManagedChatbotRuntime } from './chatbotRuntime.service.js';
import { readEvidencePayload, removeRunArtifacts } from './artifactStore.service.js';
import { getRunReport } from './report.service.js';
import { KEY_FACTS_CRITERION, checkableFacts, keyFactsApplies } from './keyFacts.js';

export async function readAccess(db, projectId, userId) {
    return resolveProjectAccess({ projectId, userId, capability: 'project.read', db });
}

export async function exportAccess(db, projectId, userId) {
    return resolveProjectAccess({ projectId, userId, capability: 'project.export', db });
}

export async function runAccess(db, projectId, userId) {
    return resolveProjectAccess({ projectId, userId, capability: 'tests.run', db });
}

export async function ownerAccess(db, projectId, userId) {
    const access = await resolveProjectAccess({ projectId, userId, capability: 'project.read', db });
    if (access.role !== 'OWNER') fail('OWNER_REQUIRED', 'Only the project owner can perform this action', 403);
    return access.project;
}

const JUDGE_FORMAT_ATTEMPTS = 2;
const JUDGE_TRANSPORT_ATTEMPTS = 2;
const CONNECTION_TEST_TIMEOUT_MS = 60000;

export { lastLogLines };

export function buildRunQuotaEstimate() {
    const min = 18;
    const max = 20;
    const worstCase = max * JUDGE_FORMAT_ATTEMPTS * JUDGE_TRANSPORT_ATTEMPTS;
    return {
        min,
        max,
        worstCase,
        note: `Best case ${min}–${max} requests for 16 scenarios (K=2). Each judge retry uses quota, so a run can use up to ${worstCase} when the judge model is overloaded.`,
    };
}

export async function getRemainingAiQuota(db, userId, now = new Date()) {
    const limit = process.env.AI_DAILY_QUOTA ? parseInt(process.env.AI_DAILY_QUOTA, 10) : 50;
    const timeZone = process.env.AI_QUOTA_TIMEZONE || 'Asia/Ho_Chi_Minh';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const resetAt = nextMidnight(timeZone, now).toISOString();
    if (!userId) {
        return { limit, used: 0, remaining: limit, resetAt, bestCaseRunEstimate: buildRunQuotaEstimate() };
    }
    const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, aiUsageDate: true, aiUsageCount: true },
    });
    const used = user && user.aiUsageDate === today ? Number(user.aiUsageCount || 0) : 0;
    return {
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt,
        bestCaseRunEstimate: buildRunQuotaEstimate(),
    };
}

async function getProjectEvaluationEnabled(db, projectId) {
    const envDefault = process.env.AI_EVALUATION_ENABLED === 'true';
    if (!db?.aiEvaluationProjectSettings?.findUnique) return envDefault;
    try {
        const record = await db.aiEvaluationProjectSettings.findUnique({
            where: { projectId },
            select: { settings: true },
        });
        if (typeof record?.settings?.enabled === 'boolean') {
            return record.settings.enabled;
        }
        return envDefault;
    } catch (error) {
        console.warn('[aiEvaluation] Could not read project toggle settings:', error?.message || error);
        return envDefault;
    }
}

export async function assertProjectEvaluationEnabled(db, projectId) {
    const isEnabled = await getProjectEvaluationEnabled(db, projectId);
    if (!isEnabled) {
        fail('FEATURE_DISABLED', 'Chatbot evaluation is turned off for this project. Turn it ON in the Chatbot Evaluation tab.', 503);
    }
}

export async function setProjectEvaluationEnabled(db, projectId, nextEnabled) {
    if (typeof nextEnabled !== 'boolean') {
        fail('INVALID_INPUT', 'Provide boolean "enabled" value to toggle Chatbot Evaluation.', 400);
    }
    if (!db?.aiEvaluationProjectSettings?.upsert) {
        return { projectEnabled: nextEnabled };
    }
    const existing = await db.aiEvaluationProjectSettings.findUnique({
        where: { projectId },
        select: { settings: true },
    });
    const baseSettings = existing?.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
        ? existing.settings
        : {};
    await db.aiEvaluationProjectSettings.upsert({
        where: { projectId },
        create: {
            projectId,
            settings: { ...baseSettings, enabled: nextEnabled },
        },
        update: {
            revision: { increment: 1 },
            settings: { ...baseSettings, enabled: nextEnabled },
        },
        select: { projectId: true },
    });
    return { projectEnabled: nextEnabled };
}

export async function getCapabilities(db, projectId, userId) {
    const access = await readAccess(db, projectId, userId);
    const [quota, projectEnabled] = await Promise.all([
        getRemainingAiQuota(db, userId),
        getProjectEvaluationEnabled(db, projectId),
    ]);
    return {
        enabled: true,
        projectEnabled,
        actionEnabled: process.env.AI_EVALUATION_ACTION_ENABLED === 'true',
        role: access.role,
        canRun: ['OWNER', 'EDITOR'].includes(access.role),
        models: AI_MODELS,
        defaults: DEFAULT_EVALUATION_CONFIG,
        quota,
    };
}

const TARGET_SELECT = { id: true, projectId: true, name: true, archivedAt: true, createdAt: true };
const PROFILE_SELECT = { id: true, projectId: true, name: true, archivedAt: true, createdAt: true };
const TEST_CASE_SELECT = { id: true, profileVersionId: true, caseKey: true, taskType: true, definition: true, definitionHash: true };
const PROFILE_VERSION_SELECT = {
    id: true,
    profileId: true,
    version: true,
    revision: true,
    status: true,
    definition: true,
    definitionHash: true,
    sourceManifest: true,
    approvedBy: true,
    approvedAt: true,
    createdAt: true,
};
const RUN_SUMMARY_SELECT = {
    id: true,
    projectId: true,
    targetVersionId: true,
    profileVersionId: true,
    snapshotId: true,
    jobId: true,
    parentRunId: true,
    idempotencyKey: true,
    executionStatus: true,
    verdict: true,
    summary: true,
    errorCode: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
};

export const must = resource => resource || fail('NOT_FOUND', 'Evaluation resource not found', 404);
export const targetFor = async (db, projectId, id) => must(await db.aiEvaluationTarget.findFirst({ where: { id, projectId }, select: TARGET_SELECT }));
export const profileFor = async (db, projectId, id) => must(await db.aiEvaluationProfile.findFirst({ where: { id, projectId }, select: PROFILE_SELECT }));
export const versionFor = async (db, projectId, id) => {
    const version = must(await db.aiEvaluationProfileVersion.findFirst({
        where: { id, profile: { projectId } },
        select: { ...PROFILE_VERSION_SELECT, cases: { orderBy: { caseKey: 'asc' }, select: TEST_CASE_SELECT } },
    }));
    const casesWithFlags = version.cases.map(c => ({
        ...c,
        referenceUnverified: Boolean(c.definition?.referenceUnverified),
    }));
    const unverifiedReferenceCaseKeys = casesWithFlags
        .filter(c => c.referenceUnverified)
        .map(c => c.caseKey);
    return {
        ...version,
        cases: casesWithFlags,
        unverifiedReferenceCount: unverifiedReferenceCaseKeys.length,
        unverifiedReferenceCaseKeys,
    };
};

export async function versionWithPreparation(db, projectId, id) {
    const version = await versionFor(db, projectId, id);
    const response = { ...version, latestPreparation: null };
    if (version.status !== 'DRAFT') return response;

    const job = await db.job.findFirst({
        where: {
            projectId,
            type: 'AI_EVALUATION_PREPARE',
            payloadJson: { contains: `"profileVersionId":"${id}"` },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, payloadJson: true },
    });
    if (!job || !['QUEUED', 'RUNNING', 'SUCCESS'].includes(job.status)) return response;

    let payload;
    try {
        payload = JSON.parse(job.payloadJson);
    } catch {
        return response;
    }
    if (payload?.profileVersionId === id && payload.revision === version.revision) {
        response.latestPreparation = { id: job.id, status: job.status };
    }
    return response;
}
export const runFor = async (db, projectId, id) => must(await db.aiEvaluationRun.findFirst({ where: { id, projectId }, select: RUN_SUMMARY_SELECT }));

export function cleanTarget(target) {
    return {
        ...target,
        versions: target.versions?.map(({ credential, ...version }) => ({
            ...version,
            credentialConfigured: !!credential && !credential.revokedAt,
            credentialRevision: credential?.revision || null,
        })),
    };
}

export async function workspace(db, projectId, userId = null) {
    const [targets, profiles, sources, runs, quota, designAudit] = await Promise.all([
        db.aiEvaluationTarget.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                ...TARGET_SELECT,
                versions: {
                    orderBy: { version: 'desc' },
                    select: {
                        id: true,
                        targetId: true,
                        version: true,
                        config: true,
                        configHash: true,
                        credentialId: true,
                        createdAt: true,
                        credential: { select: { revision: true, revokedAt: true } },
                    },
                },
            },
        }),
        db.aiEvaluationProfile.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                ...PROFILE_SELECT,
                versions: {
                    orderBy: { version: 'desc' },
                    select: { id: true, version: true, revision: true, status: true, approvedAt: true },
                },
            },
        }),
        db.aiEvaluationKnowledgeSource.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, name: true, format: true, version: true, status: true, contentHash: true, provenance: true, createdAt: true } }),
        db.aiEvaluationRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, targetVersionId: true, profileVersionId: true, executionStatus: true, verdict: true, summary: true, jobId: true, errorCode: true, createdAt: true, finishedAt: true } }),
        getRemainingAiQuota(db, userId),
        getChatbotDesignAudit(db, projectId, { autoScan: true }),
    ]);
    return {
        targets: targets.map(cleanTarget),
        profiles,
        sources,
        runs,
        quota,
        defaults: DEFAULT_EVALUATION_CONFIG,
        models: AI_MODELS,
        designAudit,
    };
}

export async function saveTarget(db, projectId, input, targetId) {
    const config = parse(targetSchema, input.config);
    if (config.executionMode === 'EXTERNAL_URL') {
        validateEndpoint(config.endpoint);
    }
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150) fail('INVALID_NAME', 'Enter a target name (1-150 characters)');
    const persistCredential = input.persistCredential === true;
    const credential = input.credential;
    if (credential !== undefined) {
        if (typeof credential !== 'string' || !credential.length || credential.length > 4096 || /[\r\n\0]/.test(credential)) {
            fail('INVALID_CREDENTIAL', 'Invalid target credential');
        }
        if (!persistCredential) {
            fail(
                'CREDENTIAL_NOT_PERSISTED',
                'Target credentials are ephemeral by default and are not saved with target configuration. Supply the credential per evaluation run or connection test, or pass persistCredential: true to store an encrypted credential.',
                400,
            );
        }
        if (config.auth.type === 'none') {
            fail(
                'CREDENTIAL_NOT_PERSISTED',
                'Select bearer or apiKey authentication before storing a target credential, or omit credential when auth.type is none.',
                400,
            );
        }
    }
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const target = targetId
            ? await targetFor(tx, projectId, targetId)
            : await tx.aiEvaluationTarget.create({ data: { projectId, name: input.name.trim() }, select: TARGET_SELECT });
        if (target.archivedAt) fail('TARGET_ARCHIVED', 'Create a new target instead of modifying an archived one');
        const latest = await tx.aiEvaluationTargetVersion.findFirst({
            where: { targetId: target.id },
            orderBy: { version: 'desc' },
            select: { id: true, version: true, credentialId: true },
        });
        let credentialId = latest?.credentialId || null;
        if (credential !== undefined) {
            const previous = await tx.aiEvaluationCredential.findFirst({
                where: { targetId: target.id },
                orderBy: { revision: 'desc' },
                select: { id: true, revision: true },
            });
            const savedCredential = await tx.aiEvaluationCredential.create({
                data: { targetId: target.id, revision: (previous?.revision || 0) + 1, ciphertext: encrypt(credential) },
                select: { id: true },
            });
            credentialId = savedCredential.id;
        } else if (config.auth.type === 'none' || input.ephemeral === true || input.persistCredential === false) {
            credentialId = null;
        }
        await tx.aiEvaluationTarget.update({ where: { id: target.id }, data: { name: input.name.trim() }, select: { id: true } });
        const version = await tx.aiEvaluationTargetVersion.create({
            data: {
                targetId: target.id,
                version: (latest?.version || 0) + 1,
                config,
                configHash: hash(config),
                credentialId: config.auth.type === 'none' ? null : credentialId,
            },
            select: { id: true },
        });
        return { targetId: target.id, versionId: version.id };
    });
}

export async function revokeTargetCredentials(db, projectId, id) {
    await targetFor(db, projectId, id);
    await db.aiEvaluationCredential.updateMany({ where: { targetId: id }, data: { revokedAt: new Date() } });
    return { configured: false };
}

export async function rotateTargetCredential(db, projectId, id, credential) {
    const target = await targetFor(db, projectId, id);
    const latest = must(await db.aiEvaluationTargetVersion.findFirst({
        where: { targetId: target.id },
        orderBy: { version: 'desc' },
        select: { id: true, config: true },
    }));
    return saveTarget(db, projectId, { name: target.name, config: latest.config, credential, persistCredential: true }, target.id);
}

export async function archiveTarget(db, projectId, id, archived) {
    await targetFor(db, projectId, id);
    if (archived !== true) fail('INVALID_ARCHIVE', 'Use versions to change target configuration');
    return db.aiEvaluationTarget.update({ where: { id }, data: { archivedAt: new Date() }, select: TARGET_SELECT });
}

export async function targetCredential(db, targetVersion, ephemeralRefId = null, projectId = null) {
    if (configAuthNone(targetVersion.config)) return undefined;
    if (ephemeralRefId) {
        return readEphemeralSecret(ephemeralRefId, { projectId });
    }
    if (!targetVersion.credentialId && !targetVersion.credential) {
        return undefined;
    }
    const credential = targetVersion.credential || await db.aiEvaluationCredential.findUnique({
        where: { id: targetVersion.credentialId || '' },
        select: { id: true, ciphertext: true, revokedAt: true },
    });
    if (!credential || credential.revokedAt) fail('CREDENTIAL_REVOKED', 'Target credential is missing or revoked');
    return decrypt(credential.ciphertext);
}

function configAuthNone(config) {
    return !config?.auth || config.auth.type === 'none';
}

export async function testConnection(db, projectId, id, options = {}) {
    await targetFor(db, projectId, id);
    const version = must(await db.aiEvaluationTargetVersion.findFirst({
        where: { targetId: id },
        orderBy: { version: 'desc' },
        select: { id: true, config: true, credentialId: true },
    }));
    const inlineCredential = typeof options.ephemeralCredential === 'string' && options.ephemeralCredential.trim()
        ? options.ephemeralCredential.trim()
        : undefined;
    const inlineLlmKey = typeof options.ephemeralLlmApiKey === 'string' && options.ephemeralLlmApiKey.trim()
        ? options.ephemeralLlmApiKey.trim()
        : undefined;
    const credential = inlineCredential || await targetCredential(db, version, null, projectId);
    if (!configAuthNone(version.config) && !credential) {
        fail('CREDENTIAL_REQUIRED', 'Provide an authentication token for this connection test');
    }

    const { ephemeralCredential, ephemeralLlmApiKey, snapshotId, ...adapterOptions } = options;
    let llmKeyRef = null;
    let runtime = null;
    try {
        if (version.config.executionMode === 'MANAGED_PROJECT') {
            let audit = null;
            try {
                audit = await getChatbotDesignAudit(db, projectId, { autoScan: false });
            } catch {
                audit = null;
            }
            const missing = (audit?.autoFillConfig?.requiredBodyFields || [])
                .filter(name => !String(version.config.requestTemplate?.[name] ?? '').trim());
            if (missing.length) {
                fail('TARGET_FIELDS_REQUIRED', `Your chatbot requires ${missing.join(', ')} in each request. Edit the connection and fill it in.`, 400);
            }
            if (!inlineLlmKey) {
                fail('LLM_API_KEY_REQUIRED', 'Enter the LLM API key in the ephemeral password field to test a Managed Project chatbot', 400);
            }
            llmKeyRef = storeEphemeralSecret({
                secret: inlineLlmKey,
                projectId,
                kind: 'llmApiKey',
                ttlMs: DEFAULT_PROBE_SECRET_TTL_MS,
            }).vaultRefId;
            runtime = await startManagedChatbotRuntime({
                db,
                projectId,
                snapshotId: snapshotId || null,
                llmKeyRef,
                extraSecrets: [credential].filter(Boolean),
                extraEnvironment: version.config.environment || {},
                configuredLlmEnvVars: version.config.llmEnvVars || [],
            });
        }

        let result;
        try {
            result = await executeTurn(
            version.config,
            {
                requestId: crypto.randomUUID(),
                messages: [{ role: 'user', content: 'Connection test. Reply with OK. Do not call tools or perform any action.' }],
                latestUserMessage: 'Connection test. Reply with OK. Do not call tools or perform any action.',
                evaluationContext: { executionMode: 'CONNECTION_TEST', toolsAllowed: false },
            },
            { credential, lease: runtime?.loopbackLease || null, timeoutMs: CONNECTION_TEST_TIMEOUT_MS, ...adapterOptions },
            );
        } catch (error) {
            if (runtime?.recentOutput && ['TARGET_TIMEOUT', 'TARGET_HTTP_ERROR', 'TARGET_RATE_LIMIT', 'TARGET_CONNECTION_ERROR', 'INVALID_TARGET_JSON'].includes(error.code)) {
                const tail = lastLogLines(runtime.recentOutput(1200));
                if (tail) error.message = `${error.message}. Chatbot log: ${tail}`;
            }
            error.message = redact(error.message, [credential, inlineLlmKey].filter(Boolean));
            throw error;
        }
        return {
            answer: redact(result.answer, [credential, inlineLlmKey].filter(Boolean)).slice(0, 2000),
            latencyMs: result.latencyMs,
            evidenceAvailability: result.evidenceAvailability,
            capabilityStatus: version.config.mockGateway ? 'GATEWAY_INTEGRATION_NOT_YET_VERIFIED' : 'ANSWER_ONLY',
        };
    } finally {
        await runtime?.stop().catch(() => {});
        if (llmKeyRef) destroyEphemeralSecret(llmKeyRef);
    }
}

export async function getKnowledgeSource(db, projectId, sourceId) {
    return must(await db.aiEvaluationKnowledgeSource.findFirst({
        where: { id: sourceId, projectId, status: { not: 'PROCESSING' } },
        select: {
            id: true,
            projectId: true,
            name: true,
            sourceKey: true,
            version: true,
            format: true,
            status: true,
            content: true,
            contentHash: true,
            provenance: true,
            createdAt: true,
        },
    }));
}

export async function prepareEvaluationJob(db, projectId, userId, metadata, enqueue = enqueueStrict) {
    const job = await db.job.create({
        data: { projectId, userId, type: 'AI_EVALUATION_PREPARE', payloadJson: JSON.stringify(metadata) },
        select: { id: true },
    });
    try {
        await enqueue('AI_EVALUATION_PREPARE', job.id);
    } catch {
        await db.$transaction(async tx => {
            await tx.job.updateMany({
                where: { id: job.id, status: 'QUEUED' },
                data: { status: 'FAILED', errorMessage: 'Enqueue failed', finishedAt: new Date() },
            });
            if (metadata.sourceId) {
                await tx.aiEvaluationKnowledgeSource.updateMany({
                    where: { id: metadata.sourceId, status: 'PROCESSING' },
                    data: { status: 'ERROR', content: '' },
                });
            }
        });
        fail('QUEUE_UNAVAILABLE', 'Preparation could not be queued. Restore Redis and retry.', 503);
    }
    return { jobId: job.id, ...metadata };
}

export async function uploadKnowledgeSource(db, projectId, userId, file, enqueue = enqueueStrict) {
    if (!file) fail('FILE_REQUIRED', 'Choose a knowledge file');
    const encoded = file.buffer.toString('base64');
    const source = await saveKnowledge(db, projectId, {
        name: file.originalname.slice(0, 200),
        format: 'PENDING',
        status: 'PROCESSING',
        content: encoded,
        contentHash: hash(encoded),
        provenance: { type: 'UPLOAD' },
    });
    return prepareEvaluationJob(db, projectId, userId, { sourceId: source.id }, enqueue);
}

export async function createKnowledgeSourceFromInput(db, projectId, body) {
    const { name, content, snapshotId, filePath } = body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200) fail('INVALID_NAME', 'Enter a source name');
    if (snapshotId) {
        return saveKnowledge(db, projectId, { name: name.trim(), ...await snapshotKnowledge(db, projectId, snapshotId, filePath) });
    }
    if (typeof content !== 'string' || !content.trim() || content.length > 200000) {
        fail('INVALID_SOURCE_SIZE', 'Enter 1 to 200,000 characters');
    }
    return saveKnowledge(db, projectId, {
        name: name.trim(),
        content,
        format: 'text',
        contentHash: hash(content),
        provenance: { type: 'USER_PROVIDED' },
    });
}

export async function createProfile(db, projectId, name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 150) fail('INVALID_NAME', 'Enter a benchmark name (1-150 characters)');
    const sources = await db.aiEvaluationKnowledgeSource.findMany({
        where: { projectId, status: 'READY' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 30,
    });
    const sourceIds = sources.map(source => source.id);
    return db.aiEvaluationProfile.create({
        data: { projectId, name: name.trim(), versions: { create: { version: 1, definition: parse(definitionSchema, { sourceIds, scoring: { threshold: 70 } }) } } },
        select: { ...PROFILE_SELECT, versions: { select: PROFILE_VERSION_SELECT } },
    });
}

export async function getProfileWithVersions(db, projectId, id) {
    const profile = await profileFor(db, projectId, id);
    const versions = await db.aiEvaluationProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'desc' },
        select: {
            id: true,
            profileId: true,
            version: true,
            revision: true,
            status: true,
            definition: true,
            definitionHash: true,
            approvedBy: true,
            approvedAt: true,
            createdAt: true,
        },
    });
    return { ...profile, versions };
}

export async function archiveProfile(db, projectId, id, archived) {
    await profileFor(db, projectId, id);
    if (archived !== true) fail('INVALID_ARCHIVE', 'Use draft versions to edit benchmarks');
    return db.aiEvaluationProfile.update({ where: { id }, data: { archivedAt: new Date() }, select: PROFILE_SELECT });
}

export async function cloneProfile(db, projectId, id) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationProfile" WHERE id = ${id} FOR UPDATE`;
        const profile = await profileFor(tx, projectId, id);
        if (profile.archivedAt) fail('PROFILE_ARCHIVED', 'Archived benchmarks cannot be edited');
        const latest = await tx.aiEvaluationProfileVersion.findFirst({
            where: { profileId: id },
            orderBy: { version: 'desc' },
            select: { id: true, version: true, definition: true, cases: { select: TEST_CASE_SELECT } },
        });
        const definition = structuredClone(latest.definition);
        definition.scoring.confirmed = false;
        return tx.aiEvaluationProfileVersion.create({
            data: {
                profileId: id,
                version: latest.version + 1,
                definition,
                cases: { create: latest.cases.map(c => ({ caseKey: c.caseKey, taskType: c.taskType, definition: c.definition, definitionHash: c.definitionHash })) },
            },
            select: { ...PROFILE_VERSION_SELECT, cases: { select: TEST_CASE_SELECT } },
        });
    });
}

async function proposalReferenceFlags(db, projectId, profileVersionId) {
    const preparations = await db.job.findMany({
        where: { projectId, type: 'AI_EVALUATION_PREPARE', status: 'SUCCESS', resultJson: { not: null } },
        select: { resultJson: true },
    });
    const flags = new Map();
    for (const preparation of preparations) {
        const proposal = JSON.parse(preparation.resultJson);
        if (proposal.profileVersionId !== profileVersionId) continue;
        for (const caseDef of proposal.cases || []) {
            if (caseDef.referenceUnverified === true) flags.set(caseDef.caseKey, true);
        }
    }
    return flags;
}

function reconcileCaseQuoteVerification(caseDef, readySources = [], persisted, proposalFlag = false) {
    const quote = (caseDef.sourceQuote || '').trim();
    if (!quote) {
        return { ...caseDef, sourceQuote: '', referenceUnverified: Boolean(persisted?.definition?.referenceUnverified || proposalFlag) };
    }
    const check = verifySourceQuoteAgainstSources(quote, readySources);
    if (check.verified) {
        const verifiedQuote = quote;
        const fallbackFactSummary = Array.isArray(caseDef.expectedFacts) && caseDef.expectedFacts.length > 0
            ? caseDef.expectedFacts.join('; ')
            : (caseDef.expectedBehavior || verifiedQuote);
        return {
            ...caseDef,
            sourceQuote: verifiedQuote,
            referenceUnverified: false,
            criteria: (caseDef.criteria || []).map(r => {
                if (r.method !== 'semantic') return r;
                const shouldRestoreGroundTruth = r.groundTruth === UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION;
                return {
                    ...r,
                    groundTruth: shouldRestoreGroundTruth
                        ? (r.key === 'contextRetention' ? (caseDef.expectedBehavior || fallbackFactSummary) : fallbackFactSummary)
                        : r.groundTruth,
                    expectedFacts: Array.isArray(r.expectedFacts) && r.expectedFacts.length > 0
                        ? r.expectedFacts
                        : (caseDef.expectedFacts || []),
                    sourceQuote: verifiedQuote,
                };
            }),
        };
    }
    return {
        ...caseDef,
        sourceQuote: '',
        referenceUnverified: true,
        criteria: (caseDef.criteria || []).map(r => {
            if (r.method !== 'semantic') return r;
            const isFactBasedKey = ['faithfulness', 'completeness', 'contextRetention'].includes(r.key);
            return {
                ...r,
                groundTruth: isFactBasedKey ? UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION : r.groundTruth,
                expectedFacts: [],
                sourceQuote: '',
            };
        }),
    };
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
        const readySources = value.definition.sourceIds.length > 0
            ? await tx.aiEvaluationKnowledgeSource.findMany({
                where: { id: { in: value.definition.sourceIds }, projectId, status: 'READY' },
                select: { id: true, content: true },
            })
            : [];
        const persistedCases = new Map(current.cases.map(c => [c.caseKey, c]));
        const proposalFlags = await proposalReferenceFlags(tx, projectId, id);
        const normalizedCases = value.cases.map(c => reconcileCaseQuoteVerification(c, readySources, persistedCases.get(c.caseKey), proposalFlags.get(c.caseKey)));
        await tx.aiEvaluationTestCase.deleteMany({ where: { profileVersionId: id } });
        if (normalizedCases.length) {
            await tx.aiEvaluationTestCase.createMany({
                data: normalizedCases.map(c => ({ profileVersionId: id, caseKey: c.caseKey, taskType: c.taskType, definition: c, definitionHash: hash(c) })),
            });
        }
        return versionFor(tx, projectId, id);
    });
}

export async function approveProfile(db, projectId, id, revision, userId) {
    return serial(db, async tx => {
        const version = await versionFor(tx, projectId, id);
        if (version.status !== 'DRAFT' || version.revision !== revision) fail('STALE_REVISION', 'Reload the current draft before approval', 409);
        const definition = parse(definitionSchema, version.definition);
        const sources = await tx.aiEvaluationKnowledgeSource.findMany({
            where: { id: { in: definition.sourceIds }, projectId, status: 'READY' },
            select: { id: true, name: true, version: true, contentHash: true, content: true, provenance: true },
        });
        if (sources.length !== new Set(definition.sourceIds).size) fail('SOURCE_NOT_READY', 'Every source must be ready and belong to this project');
        const reconciledCaseHashes = [];
        const reconciledDefinitions = [];
        const proposalFlags = await proposalReferenceFlags(tx, projectId, id);
        for (const row of version.cases) {
            const reconciledDef = reconcileCaseQuoteVerification(row.definition, sources, row, proposalFlags.get(row.caseKey));
            const nextHash = hash(reconciledDef);
            if (nextHash !== row.definitionHash) {
                await tx.aiEvaluationTestCase.update({
                    where: { id: row.id },
                    data: { definition: reconciledDef, definitionHash: nextHash },
                    select: { id: true },
                });
            }
            reconciledDefinitions.push(reconciledDef);
            reconciledCaseHashes.push(nextHash);
        }
        validateApproval(definition, reconciledDefinitions);
        const manifest = sources.map(({ id: sourceId, name, version: sourceVersion, contentHash, content, provenance }) => ({
            id: sourceId, name, version: sourceVersion, contentHash, content, provenance,
        }));
        const changed = await tx.aiEvaluationProfileVersion.updateMany({
            where: { id, status: 'DRAFT', revision },
            data: {
                status: 'APPROVED',
                revision: { increment: 1 },
                definitionHash: hash({ definition, cases: reconciledCaseHashes, sources: manifest.map(s => s.contentHash) }),
                sourceManifest: manifest,
                approvedBy: userId,
                approvedAt: new Date(),
            },
        });
        if (!changed.count) fail('STALE_REVISION', 'Benchmark changed during approval', 409);
        return versionFor(tx, projectId, id);
    });
}

export function estimateProposalAiQuota() {
    const baseRequests = 2;
    const retryReserve = 2;
    return {
        baseRequests,
        retryReserve,
        required: baseRequests + retryReserve,
    };
}

export function estimateRunAiQuota({ cases = [], judge = {} } = {}) {
    if (!judge?.enabled) {
        return { baseRequests: 0, retryReserve: 0, required: 0 };
    }
    const judgedCases = cases.filter(c =>
        Array.isArray(c?.criteria) &&
        c.criteria.some(r => r.enabled && r.method === 'semantic' && isCriterionApplicableToTask(r.key, c.taskType)),
    ).length;
    const baseRequests = judgedCases;
    const retryReserve = judgedCases > 0 ? Math.max(1, Math.ceil(judgedCases * 0.25)) : 0;
    return {
        baseRequests,
        retryReserve,
        required: baseRequests + retryReserve,
    };
}

export async function requestBenchmarkProposal(db, projectId, userId, versionId, enqueue = enqueueStrict) {
    const version = await versionFor(db, projectId, versionId);
    assertDistinctGeneratorAndJudgeModels(version.definition?.judge);
    if (version.status !== 'DRAFT' || !version.definition.judge.generationConsent) {
        fail('PROPOSAL_CONSENT_REQUIRED', 'Save a draft with benchmark-generation consent before requesting a proposal');
    }
    if (userId && !readEvaluatorFallbackConfig()) {
        const estimate = estimateProposalAiQuota();
        const quota = await getRemainingAiQuota(db, userId);
        if (quota.remaining < estimate.required) {
            throw new ServiceError(
                `Insufficient daily AI quota to generate scenarios: ${estimate.required} requests required (${estimate.baseRequests} generator passes + ${estimate.retryReserve} retry reserve), but only ${quota.remaining} of ${quota.limit} requests remain today.`,
                429,
                'INSUFFICIENT_AI_QUOTA',
                {
                    required: estimate.required,
                    baseRequests: estimate.baseRequests,
                    retryReserve: estimate.retryReserve,
                    remaining: quota.remaining,
                    limit: quota.limit,
                    used: quota.used,
                    resetAt: quota.resetAt,
                },
            );
        }
    }
    return prepareEvaluationJob(db, projectId, userId, { profileVersionId: version.id, revision: version.revision }, enqueue);
}

export async function getPreparationStatus(db, projectId, jobId) {
    const job = must(await db.job.findFirst({
        where: { id: jobId, projectId, type: 'AI_EVALUATION_PREPARE' },
        select: { id: true, status: true, errorMessage: true, resultJson: true },
    }));
    return {
        id: job.id,
        status: job.status,
        errorMessage: job.errorMessage,
        result: job.resultJson ? JSON.parse(job.resultJson) : null,
    };
}

export async function enqueueStrict(type, jobId) {
    const { addJobToQueue } = await import('../queue.service.js');
    return addJobToQueue(type, jobId, {}, { attempts: 1 });
}

export async function createRun(db, projectId, userId, input, { enqueue = enqueueStrict, parentRunId = null } = {}) {
    const data = parse(runSchema, input);
    const existing = await db.aiEvaluationRun.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey: data.idempotencyKey } },
        select: { ...RUN_SUMMARY_SELECT, manifest: true },
    });
    if (existing) {
        if (
            existing.targetVersionId !== data.targetVersionId ||
            existing.profileVersionId !== data.profileVersionId ||
            (existing.snapshotId || null) !== (data.snapshotId || null) ||
            Boolean(existing.manifest?.skipKnowledgeProbe) !== Boolean(data.skipKnowledgeProbe)
        ) {
            fail('IDEMPOTENCY_CONFLICT', 'This request key was used with different versions', 409);
        }
        const { manifest: _omittedManifest, ...existingSummary } = existing;
        return existingSummary;
    }

    const profile = await versionFor(db, projectId, data.profileVersionId);
    if ((await profileFor(db, projectId, profile.profileId)).archivedAt) fail('PROFILE_ARCHIVED', 'Archived benchmarks cannot start new runs');
    if (profile.status !== 'APPROVED') fail('PROFILE_NOT_APPROVED', 'Approve the benchmark before running');
    const target = must(await db.aiEvaluationTargetVersion.findFirst({
        where: { id: data.targetVersionId, target: { projectId, archivedAt: null } },
        select: { id: true, version: true, config: true, configHash: true, credentialId: true },
    }));

    let llmKeyRef = null;
    let targetTokenRef = null;
    try {
        if (data.llmApiKey) {
            llmKeyRef = storeEphemeralSecret({ secret: data.llmApiKey, projectId, kind: 'llmApiKey' }).vaultRefId;
        }
        if (data.targetAuthToken) {
            targetTokenRef = storeEphemeralSecret({ secret: data.targetAuthToken, projectId, kind: 'targetAuthToken' }).vaultRefId;
        }
        if (target.config.executionMode === 'MANAGED_PROJECT' && !llmKeyRef) {
            fail('LLM_API_KEY_REQUIRED', 'Enter the LLM API key in the ephemeral password field to boot the imported chatbot');
        }
        if (!configAuthNone(target.config) && !targetTokenRef) {
            const persisted = await targetCredential(db, target, null, projectId);
            if (!persisted) fail('CREDENTIAL_REQUIRED', 'Provide an authentication token for this target');
        }

        const definition = profile.definition;
        assertDistinctGeneratorAndJudgeModels(definition?.judge);
        if (profile.cases.some(c => c.taskType === 'ACTION_TOOL')) {
            if (process.env.AI_EVALUATION_ACTION_ENABLED !== 'true') fail('ACTION_DISABLED', 'Action evaluation must be enabled by the operator', 503);
            if (!target.config.mockGateway || !target.config.testEnvironmentConfirmed) {
                fail('GATEWAY_REQUIRED', 'Confirm a non-production target and enable its COVAI mock gateway integration');
            }
            validateEndpoint(process.env.AI_EVALUATION_GATEWAY_URL || '');
        }
        if (data.snapshotId) must(await db.projectSnapshot.findFirst({ where: { id: data.snapshotId, projectId }, select: { id: true } }));

        const semanticCalls = profile.cases.reduce((sum, c) => sum + c.definition.criteria.filter(r => r.enabled && r.method === 'semantic').length, 0);
        if (definition.judge.enabled && semanticCalls > 200) fail('JUDGE_BUDGET', 'Limit each run to at most 200 semantic judgments');

        const runQuotaEstimate = estimateRunAiQuota({
            cases: profile.cases.map(c => c.definition),
            judge: definition.judge,
        });

        const secretRefs = {
            ...(llmKeyRef ? { llmKeyRef } : {}),
            ...(targetTokenRef ? { targetTokenRef } : {}),
        };

        let run;
        try {
            run = await serial(db, async tx => {
                await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
                if (runQuotaEstimate.required > 0 && userId && !readEvaluatorFallbackConfig()) {
                    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
                    const quota = await getRemainingAiQuota(tx, userId);
                    if (quota.remaining < runQuotaEstimate.required) {
                        throw new ServiceError(
                            `Insufficient daily AI quota to start evaluation: ${runQuotaEstimate.required} requests required (${runQuotaEstimate.baseRequests} judge requests + ${runQuotaEstimate.retryReserve} retry reserve), but only ${quota.remaining} of ${quota.limit} requests remain today.`,
                            429,
                            'INSUFFICIENT_AI_QUOTA',
                            {
                                required: runQuotaEstimate.required,
                                baseRequests: runQuotaEstimate.baseRequests,
                                retryReserve: runQuotaEstimate.retryReserve,
                                remaining: quota.remaining,
                                limit: quota.limit,
                                used: quota.used,
                                resetAt: quota.resetAt,
                            },
                        );
                    }
                }
                if (await tx.aiEvaluationRun.count({ where: { projectId, executionStatus: { in: ['QUEUED', 'RUNNING'] } } }) >= 2) {
                    fail('RUN_LIMIT', 'At most two evaluation runs can be active per project', 409);
                }
                const job = await tx.job.create({
                    data: { projectId, userId, type: 'AI_EVALUATION', payloadJson: JSON.stringify(secretRefs) },
                    select: { id: true },
                });
                return tx.aiEvaluationRun.create({
                    data: {
                        projectId,
                        targetVersionId: target.id,
                        profileVersionId: profile.id,
                        snapshotId: data.snapshotId || null,
                        idempotencyKey: data.idempotencyKey,
                        parentRunId,
                        jobId: job.id,
                        manifest: {
                            versions: VERSIONS,
                            agent: getAgentManifest('chatbot-trustworthiness'),
                            targetConfig: target.config,
                            targetConfigHash: target.configHash,
                            targetVersion: target.version,
                            profileHash: profile.definitionHash,
                            profileVersion: profile.version,
                            sourceHashes: profile.sourceManifest.map(s => ({ id: s.id, hash: s.contentHash })),
                            caseHashes: profile.cases.map(c => c.definitionHash),
                            limits: definition.limits,
                            scoring: definition.scoring,
                            judge: definition.judge,
                            skipKnowledgeProbe: data.skipKnowledgeProbe,
                            evidenceScope: profile.cases.some(c => c.taskType === 'ACTION_TOOL') ? 'COVAI_GATEWAY_ONLY' : 'TARGET_RESPONSE',
                            targetMetadataProvenance: 'TARGET_REPORTED',
                        },
                        cases: {
                            create: profile.cases.map(c => ({
                                testCaseId: c.id,
                                criteria: {
                                    create: [...c.definition.criteria.map(r => ({
                                        criterionKey: r.key,
                                        method: r.method,
                                        status: 'NOT_EVALUATED',
                                        score: null,
                                        reason: 'Case has not been evaluated',
                                        evidenceRefs: [],
                                        evaluator: {},
                                        details: {
                                            caseKey: c.caseKey,
                                            taskType: c.taskType,
                                            caseWeight: c.definition.weight,
                                            criterionWeight: r.weight,
                                            required: r.required,
                                            blocking: r.blocking,
                                            expected: r.rule || { groundTruth: r.groundTruth, rubric: r.rubric, expectedFacts: r.expectedFacts, sourceQuote: r.sourceQuote },
                                        },
                                    })),
                                    ...(keyFactsApplies(c.definition) && !c.definition.criteria.some(r => r.key === KEY_FACTS_CRITERION)
                                        ? [{
                                            criterionKey: KEY_FACTS_CRITERION,
                                            method: 'rule',
                                            status: 'NOT_EVALUATED',
                                            score: null,
                                            reason: 'Case has not been evaluated',
                                            evidenceRefs: [],
                                            evaluator: {},
                                            details: {
                                                caseKey: c.caseKey,
                                                taskType: c.taskType,
                                                caseWeight: c.definition.weight,
                                                criterionWeight: 1,
                                                required: false,
                                                blocking: false,
                                                expected: { type: KEY_FACTS_CRITERION, facts: checkableFacts(c.definition.expectedFacts).map(f => f.fact) },
                                            },
                                        }]
                                        : [])],
                                },
                            })),
                        },
                    },
                    select: RUN_SUMMARY_SELECT,
                });
            });
        } catch (error) {
            if (error.code === 'P2002') {
                if (llmKeyRef) destroyEphemeralSecret(llmKeyRef);
                if (targetTokenRef) destroyEphemeralSecret(targetTokenRef);
                return createRun(db, projectId, userId, input, { enqueue, parentRunId });
            }
            throw error;
        }

        try {
            await enqueue('AI_EVALUATION', run.jobId);
        } catch {
            if (llmKeyRef) destroyEphemeralSecret(llmKeyRef);
            if (targetTokenRef) destroyEphemeralSecret(targetTokenRef);
            await db.$transaction(async tx => {
                const changed = await tx.aiEvaluationRun.updateMany({
                    where: { id: run.id, executionStatus: 'QUEUED' },
                    data: { executionStatus: 'ERROR', errorCode: 'ENQUEUE_FAILED', finishedAt: new Date() },
                });
                if (changed.count) {
                    await tx.job.update({
                        where: { id: run.jobId },
                        data: { status: 'FAILED', errorMessage: 'Evaluation enqueue failed', finishedAt: new Date() },
                        select: { id: true },
                    });
                }
            });
            fail('QUEUE_UNAVAILABLE', 'Evaluation could not be queued. Restore Redis and create a new run.', 503);
        }
        return run;
    } catch (error) {
        if (llmKeyRef && error.code !== 'QUEUE_UNAVAILABLE') destroyEphemeralSecret(llmKeyRef);
        if (targetTokenRef && error.code !== 'QUEUE_UNAVAILABLE') destroyEphemeralSecret(targetTokenRef);
        throw error;
    }
}

export async function rerunEvaluation(db, projectId, userId, runId, body, { enqueue = enqueueStrict } = {}) {
    const run = await runFor(db, projectId, runId);
    if (!TERMINAL.includes(run.executionStatus)) fail('RUN_ACTIVE', 'Wait for the original run or cancel it before rerunning');
    return createRun(
        db,
        projectId,
        userId,
        {
            targetVersionId: run.targetVersionId,
            profileVersionId: run.profileVersionId,
            snapshotId: run.snapshotId,
            idempotencyKey: body?.idempotencyKey || crypto.randomUUID(),
            ...(body?.llmApiKey ? { llmApiKey: body.llmApiKey } : {}),
            ...(body?.targetAuthToken ? { targetAuthToken: body.targetAuthToken } : {}),
            ...(body?.skipKnowledgeProbe !== undefined ? { skipKnowledgeProbe: body.skipKnowledgeProbe } : {}),
        },
        { enqueue, parentRunId: run.id },
    );
}

export async function deleteEvaluationRun(db, projectId, runId) {
    const run = await runFor(db, projectId, runId);
    if (!TERMINAL.includes(run.executionStatus)) fail('RUN_ACTIVE', 'Cancel the run before deleting it');
    const evidence = await db.aiEvaluationEvidence.findMany({
        where: { runId: run.id },
        select: { id: true, payload: true },
    });
    await removeRunArtifacts(projectId, run.id, evidence);
    await db.$transaction(async tx => {
        await tx.aiEvaluationRun.delete({ where: { id: run.id } });
        await tx.job.deleteMany({ where: { id: run.jobId } });
    });
    return { deleted: true };
}

export async function getCaseResultDetail(db, projectId, caseResultId) {
    const row = must(await db.aiEvaluationCaseResult.findFirst({
        where: { id: caseResultId, run: { projectId } },
        select: { id: true, runId: true },
    }));
    const report = await getRunReport(db, projectId, row.runId);
    return report.cases.find(item => item.id === row.id);
}

export async function getEvidenceDetail(db, projectId, evidenceId) {
    const row = must(await db.aiEvaluationEvidence.findFirst({
        where: { id: evidenceId, run: { projectId } },
        select: {
            id: true,
            runId: true,
            caseResultId: true,
            attemptId: true,
            kind: true,
            provenance: true,
            availability: true,
            completeness: true,
            payload: true,
            contentHash: true,
            createdAt: true,
        },
    }));
    return { ...row, payload: await readEvidencePayload(projectId, row.runId, row.payload) };
}

export async function addReview(db, projectId, criterionId, userId, input) {
    const value = parse(reviewSchema, input);
    const criterion = must(await db.aiEvaluationCriterionResult.findFirst({
        where: { id: criterionId, caseResult: { run: { projectId, executionStatus: { in: TERMINAL } } } },
        select: { id: true },
    }));
    return db.aiEvaluationHumanReview.create({
        data: { criterionResultId: criterion.id, reviewerId: userId, ...value },
        select: { id: true, criterionResultId: true, reviewerId: true, verdict: true, score: true, rationale: true, createdAt: true },
    });
}
