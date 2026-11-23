import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import prisma from '../../config/prisma.js';
import { snapshotWorkspaceRoot, normalizeDiskPath } from '../../utils/snapshotWorkspace.js';
import { isolatedProcessEnvironment } from '../../utils/isolatedProcessEnvironment.js';
import { acquireSnapshotLease, createAssessmentWorkspace } from '../systemAssessmentWorkspace.service.js';
import { reserveSystemPorts } from '../systemRuntimePorts.service.js';
import {
    startAutServer,
    stopAutServer,
    isPortInUse,
    runSeedDataIfPresent,
    formatAutStartupFailure,
    autRuntimeCompatibilityHint,
} from '../autLifecycle.service.js';
import { prepareFullSystemPackage, readAssessmentTestEnvironment } from '../fullSystemRuntime.service.js';
import { buildAutomaticTestEnvironment } from '../fullSystemEnvironment.service.js';
import { provisionSystemResources } from '../systemRuntimeResources.service.js';
import { inspectSystemSetupSource, inspectSystemPackageSource } from '../fullSystemSetup.service.js';
import { inferFullSystemPlan } from '../fullSystemPlan.service.js';
import { containedPath, readFullSystemConfig } from '../fullSystemConfig.service.js';
import { resolvePackageRuntime } from '../projectRuntimePlan.service.js';
import { prepareProjectDependencies } from '../projectDependencies.service.js';
import { readEphemeralSecret } from './ephemeralSecret.service.js';
import { getChatbotDesignAudit, runChatbotDesignAudit } from './designAudit.service.js';
import { createManagedLoopbackLease, executeTurn } from './httpJson.adapter.js';
import { ServiceError } from '../../utils/serviceError.js';
import { fail, redact } from './common.js';

const KNOWN_LLM_BASE_URL_ENV = ['OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_API_BASE_URL', 'OPENAI_API_HOST', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL', 'GEMINI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL', 'GOOGLE_API_BASE_URL', 'OPENROUTER_BASE_URL', 'AZURE_OPENAI_ENDPOINT', 'OLLAMA_HOST', 'OLLAMA_BASE_URL', 'GROQ_BASE_URL', 'MISTRAL_BASE_URL', 'COHERE_BASE_URL', 'DEEPSEEK_BASE_URL', 'LLM_BASE_URL', 'AI_BASE_URL', 'MODEL_BASE_URL'];

export function protectLlmBaseUrls(env, { auditNames = [], userEnv = {}, ownUrls = [] }) {
    const removed = new Set();
    const ownUrlSet = new Set(ownUrls.map(url => url.trim().replace(/\/$/, '')));
    for (const name of new Set([...auditNames, ...KNOWN_LLM_BASE_URL_ENV])) {
        if (Object.hasOwn(userEnv, name)) {
            env[name] = userEnv[name];
        } else if (Object.hasOwn(env, name)) {
            delete env[name];
            removed.add(name);
        }
    }
    for (const [name, value] of Object.entries(env)) {
        if (typeof value !== 'string' || !ownUrlSet.has(value.trim().replace(/\/$/, '')) || !/(?:^|_)(?:OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE|OPENROUTER|AZURE|OLLAMA|GROQ|MISTRAL|COHERE|DEEPSEEK|LLM|AI|MODEL)(?:_|$)/i.test(name)) continue;
        if (Object.hasOwn(userEnv, name)) {
            env[name] = userEnv[name];
        } else {
            delete env[name];
            removed.add(name);
        }
    }
    return [...removed];
}

const RESERVED_RUNTIME_ENV_NAMES = new Set([
    'PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES',
    'PORT', 'SERVER_PORT', 'HTTP_PORT', 'API_PORT', 'BACKEND_PORT', 'COVAI_AUT_PORT',
    'HOST', 'HOSTNAME', 'DATABASE_URL', 'REDIS_URL', 'ENCRYPTION_KEY', 'JWT_SECRET',
]);

const EMPTY_OR_REFUSAL_RE = /(?:do\s+not\s+have\s+(?:enough\s+|any\s+)?information|don't\s+have\s+(?:enough\s+|any\s+)?information|cannot\s+(?:find|answer)|not\s+(?:found\s+)?in\s+(?:the\s+)?(?:provided\s+)?(?:document|documents|context|knowledge)|no\s+(?:relevant\s+)?(?:documents?|information|context|data)\s+(?:found|available)|knowledge\s+base\s+is\s+empty|database\s+is\s+empty|i\s+don't\s+know|unable\s+to\s+find\s+relevant|không\s+(?:có|tìm\s+thấy)\s+(?:thông\s+tin|dữ\s+liệu|tài\s+liệu)|chưa\s+(?:có|được\s+nạp)\s+dữ\s+liệu|ngoài\s+phạm\s+vi\s+tài\s+liệu|tài\s+liệu\s+không\s+đề\s+cập)/i;

const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'when', 'where', 'which', 'how', 'does', 'are', 'was', 'were', 'will', 'can', 'your', 'about', 'into', 'within', 'have', 'has',
    'của', 'và', 'cho', 'trong', 'được', 'với', 'những', 'các', 'một', 'như', 'khi', 'nào', 'bao', 'nhiêu', 'theo', 'quy', 'định', 'này', 'hay', 'không', 'là', 'có', 'từ', 'đến',
]);

// Process-local lease map used only when Redis is offline (e.g. in-process Jest tests),
// allowing acquireSnapshotLease from systemAssessmentWorkspace.service.js to run unmodified.
const localLeaseStore = new Map();
const inMemoryLeaseRedis = {
    async set(key, value, mode, ttlMs, nx) {
        const now = Date.now();
        const current = localLeaseStore.get(key);
        if (current && current.expiresAt <= now) localLeaseStore.delete(key);
        if (nx === 'NX' && localLeaseStore.has(key)) return null;
        localLeaseStore.set(key, { value, expiresAt: mode === 'PX' ? now + Number(ttlMs) : now + 60000 });
        return 'OK';
    },
    async get(key) {
        const entry = localLeaseStore.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            localLeaseStore.delete(key);
            return null;
        }
        return entry.value;
    },
    async eval(script, _numKeys, key, token, ttlMs) {
        const entry = localLeaseStore.get(key);
        if (!entry || entry.expiresAt <= Date.now() || entry.value !== token) return 0;
        if (script.includes('pexpire')) {
            entry.expiresAt = Date.now() + Number(ttlMs);
            return 1;
        }
        if (script.includes('del')) {
            localLeaseStore.delete(key);
            return 1;
        }
        return 0;
    },
};

async function resolveLeaseRedis(explicitRedis) {
    if (explicitRedis) return explicitRedis;
    if (process.env.NODE_ENV === 'test') return inMemoryLeaseRedis;
    try {
        const { getSystemEvidenceRedis } = await import('../queue.service.js');
        return getSystemEvidenceRedis();
    } catch {
        return inMemoryLeaseRedis;
    }
}

async function logRedacted(db, jobId, level, message, secrets = []) {
    if (!db || !jobId) return;
    const cleanMessage = redact(String(message), secrets);
    try {
        await db.jobLog.create({
            data: { jobId, level, message: cleanMessage },
            select: { id: true },
        });
        global.io?.to(`job:${jobId}`).emit('job:log', { jobId, level, message: cleanMessage });
    } catch {
        // Ignore non-fatal logging errors
    }
}

async function resolveTargetSnapshot(db, projectId, snapshotId) {
    if (snapshotId) {
        return db.projectSnapshot.findFirst({
            where: { id: snapshotId, projectId },
            select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true },
        });
    }
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { activeSnapshotId: true },
    });
    if (project?.activeSnapshotId) {
        const active = await db.projectSnapshot.findFirst({
            where: { id: project.activeSnapshotId, projectId },
            select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true },
        });
        if (active) return active;
    }
    return db.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true },
    });
}

function sanitizeDetectedLlmEnvVars(rawNames = []) {
    if (!Array.isArray(rawNames)) return [];
    const valid = [];
    for (const candidate of rawNames) {
        if (
            typeof candidate === 'string' &&
            /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(candidate) &&
            !RESERVED_RUNTIME_ENV_NAMES.has(candidate.toUpperCase()) &&
            !valid.includes(candidate)
        ) {
            valid.push(candidate);
        }
    }
    return valid;
}

function stripSensitiveKeysFromTestEnv(rawTestEnv = {}, detectedLlmEnvVars = []) {
    const blocked = new Set(detectedLlmEnvVars.map(v => v.toUpperCase()));
    const result = {};
    for (const [key, val] of Object.entries(rawTestEnv)) {
        if (blocked.has(key.toUpperCase())) continue;
        result[key] = val;
    }
    return result;
}

export async function startManagedChatbotRuntime({
    db = prisma,
    projectId,
    snapshotId = null,
    jobId = null,
    llmKeyRef = null,
    extraSecrets = [],
    extraEnvironment = {},
    configuredLlmEnvVars = [],
    signal,
    redis = null,
    onBeforeWorkspaceCleanup = null,
    provisionResources = provisionSystemResources,
}) {
    if (!llmKeyRef) {
        fail('LLM_API_KEY_REQUIRED', 'Enter the LLM API key in the ephemeral password field to start the imported chatbot', 400);
    }

    const llmApiKey = readEphemeralSecret(llmKeyRef, { projectId });
    const allSecrets = [llmApiKey, ...extraSecrets].filter(s => typeof s === 'string' && s.length > 0);

    const snapshot = await resolveTargetSnapshot(db, projectId, snapshotId);
    if (!snapshot) {
        fail('SNAPSHOT_REQUIRED', 'Import a project repository or ZIP snapshot before starting Managed Project evaluation', 409);
    }

    const originalRoot = snapshotWorkspaceRoot(snapshot) || normalizeDiskPath(snapshot.rootDir);
    if (!originalRoot || !fs.existsSync(originalRoot)) {
        fail('WORKSPACE_UNAVAILABLE', 'Snapshot source files are not accessible on this server', 409);
    }

    let audit = await getChatbotDesignAudit(db, projectId, { snapshotId: snapshot.id, autoScan: false });
    if (!audit || audit.status === 'NOT_SCANNED') {
        audit = await runChatbotDesignAudit(db, projectId, { snapshotId: snapshot.id });
    }

    if (!audit?.detected || !audit.summary?.launchability?.ready) {
        fail(
            'MANAGED_STARTUP_UNSUPPORTED',
            audit?.summary?.launchability?.reason || 'This project cannot be auto-started by CovAI; connect via External URL mode instead.',
            422,
        );
    }

    const auditList = audit.summary?.launchability?.requiredLlmEnvVars || audit.autoFillConfig?.llmEnvVars || [];
    const detectedLlmEnvVars = sanitizeDetectedLlmEnvVars([...new Set([...auditList, ...configuredLlmEnvVars])]);
    if (!detectedLlmEnvVars.length) {
        fail(
            'LLM_ENV_VAR_NOT_DETECTED',
            'Design Audit did not detect any LLM API key environment variable in the imported project source code. Read the key from process.env in your chatbot backend or use External URL mode.',
            422,
        );
    }

    let snapshotLease = null;
    let workspace = null;
    let portLease = null;
    let resources = null;
    let serverHandle = null;
    let loopbackLease = null;
    let leasedPort = null;
    let stopped = false;
    let stopPromise = null;

    const stop = () => {
        if (stopPromise) return stopPromise;
        stopped = true;
        stopPromise = (async () => {
            try {
                loopbackLease?.revoke();
            } catch (err) {
                console.error('[ChatbotRuntime] Failed to revoke loopback lease:', redact(String(err?.message || err), allSecrets));
            }
            if (serverHandle?.pid) {
                const closePromise = serverHandle.process && serverHandle.process.exitCode === null
                    ? new Promise(resolve => {
                        const timer = setTimeout(resolve, 4000);
                        timer.unref?.();
                        serverHandle.process.once('close', () => { clearTimeout(timer); resolve(); });
                    })
                    : Promise.resolve();
                try {
                    await stopAutServer(serverHandle.pid, leasedPort, null);
                    await closePromise;
                    if (leasedPort) {
                        const portDeadline = Date.now() + 3000;
                        while (Date.now() < portDeadline && await isPortInUse(leasedPort, '127.0.0.1', 200)) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                    await logRedacted(db, jobId, 'INFO', `[ChatbotRuntime] Stopped isolated chatbot server on 127.0.0.1:${leasedPort}.`, allSecrets);
                } catch (stopErr) {
                    const msg = redact(String(stopErr?.message || stopErr), allSecrets);
                    console.error(`[ChatbotRuntime] Error stopping child process PID ${serverHandle.pid}: ${msg}`);
                    await logRedacted(db, jobId, 'WARN', `[ChatbotRuntime] Warning while stopping child server: ${msg}`, allSecrets);
                }
            }
            if (resources) {
                try {
                    await resources.cleanup();
                } catch (cleanupErr) {
                    const redactedErr = redact(String(cleanupErr?.message || cleanupErr || 'Unknown resource cleanup error'), allSecrets);
                    console.error(`[ChatbotRuntime] Isolated resource cleanup failed for job ${jobId || 'unknown'}: ${redactedErr}`);
                    await logRedacted(
                        db,
                        jobId,
                        'WARN',
                        `[ChatbotRuntime] Warning: isolated resource cleanup encountered an error: ${redactedErr}`,
                        allSecrets,
                    );
                }
            }
            try {
                await portLease?.release();
            } catch (portErr) {
                console.error('[ChatbotRuntime] Port lease release failed:', redact(String(portErr?.message || portErr), allSecrets));
            }
            if (workspace) {
                if (process.env.NODE_ENV === 'test' && typeof onBeforeWorkspaceCleanup === 'function') {
                    await onBeforeWorkspaceCleanup(workspace.rootDir);
                }
                try {
                    workspace.release();
                } catch (wsErr) {
                    console.error('[ChatbotRuntime] Temporary workspace cleanup failed:', redact(String(wsErr?.message || wsErr), allSecrets));
                }
            }
            try {
                await snapshotLease?.release();
            } catch (leaseErr) {
                console.error('[ChatbotRuntime] Snapshot lease release failed:', redact(String(leaseErr?.message || leaseErr), allSecrets));
            }
        })();
        return stopPromise;
    };

    try {
        const leaseRedis = await resolveLeaseRedis(redis);
        snapshotLease = await acquireSnapshotLease({ redis: leaseRedis, snapshotId: snapshot.id });
        snapshotLease.signal = signal;

        workspace = createAssessmentWorkspace({
            rootDir: originalRoot,
            operationId: jobId || crypto.randomUUID(),
        });

        const [reservedPort] = await reserveSystemPorts(1);
        portLease = reservedPort;
        leasedPort = reservedPort.port;

        const packageDirRel = audit.summary?.launchability?.packageDir || '.';
        const backendDir = containedPath(workspace.rootDir, packageDirRel);
        const originalBackendDir = fs.existsSync(path.join(originalRoot, packageDirRel))
            ? containedPath(originalRoot, packageDirRel)
            : originalRoot;

        const nonSecretTestEnv = stripSensitiveKeysFromTestEnv(
            readAssessmentTestEnvironment(originalBackendDir),
            detectedLlmEnvVars,
        );
        const appliedExtraEnvironment = stripSensitiveKeysFromTestEnv(extraEnvironment, detectedLlmEnvVars);
        const packageSource = inspectSystemPackageSource(backendDir);
        const backendUrl = `http://127.0.0.1:${leasedPort}`;
        const llmBaseUrlOptions = {
            auditNames: audit.summary?.launchability?.llmBaseUrlEnvVars || audit.autoFillConfig?.llmBaseUrlEnvVars || [],
            userEnv: { ...nonSecretTestEnv, ...appliedExtraEnvironment },
            ownUrls: [backendUrl],
        };

        let baseEnv = buildAutomaticTestEnvironment({
            files: packageSource.files,
            env: { ...nonSecretTestEnv, ...appliedExtraEnvironment },
            port: leasedPort,
            backendUrl,
            frontendUrl: backendUrl,
        });
        const removedLlmBaseUrlNames = new Set(protectLlmBaseUrls(baseEnv, llmBaseUrlOptions));

        let systemPlan = null;
        const explicitConfigPath = path.join(workspace.rootDir, '.covai/system-test.json');
        if (fs.existsSync(explicitConfigPath)) {
            try { systemPlan = readFullSystemConfig(workspace.rootDir); } catch { systemPlan = null; }
        } else {
            try { systemPlan = inferFullSystemPlan(inspectSystemSetupSource(workspace.rootDir)); } catch { systemPlan = null; }
        }

        let runtimePlan = null;
        if (systemPlan?.database || systemPlan?.services?.redis) {
            await logRedacted(db, jobId, 'INFO', '[ChatbotRuntime] Provisioning isolated database/cache resources for chatbot backend...', allSecrets);
            resources = await provisionResources({
                rootDir: workspace.rootDir,
                database: systemPlan.database,
                services: systemPlan.services,
                signal,
            });
            baseEnv = buildAutomaticTestEnvironment({
                files: packageSource.files,
                env: baseEnv,
                resources: resources.environment,
                port: leasedPort,
                backendUrl,
                frontendUrl: backendUrl,
            });
            for (const name of protectLlmBaseUrls(baseEnv, llmBaseUrlOptions)) removedLlmBaseUrlNames.add(name);
            delete baseEnv.COVAI_SQLITE_FALLBACK_PATH;
            await prepareFullSystemPackage({
                directory: backendDir,
                repositoryRoot: workspace.rootDir,
                env: baseEnv,
                jobId: null,
                database: Boolean(systemPlan.database),
                signal,
                schemaStrategy: systemPlan.database?.schemaStrategy,
                prismaSchema: systemPlan.database?.prismaSchema ? containedPath(workspace.rootDir, systemPlan.database.prismaSchema) : undefined,
            });
            if (systemPlan.database) {
                await runSeedDataIfPresent({
                    snapshotDir: backendDir,
                    repositoryRoot: workspace.rootDir,
                    jobId: null,
                    signal,
                    env: baseEnv,
                    isolatedDatabase: true,
                });
            }
            runtimePlan = resolvePackageRuntime({ directory: backendDir, repositoryRoot: workspace.rootDir });
        } else {
            runtimePlan = resolvePackageRuntime({ directory: backendDir, repositoryRoot: workspace.rootDir });
            const declaredDeps = Object.keys({
                ...runtimePlan.pkg.dependencies,
                ...runtimePlan.pkg.devDependencies,
                ...runtimePlan.pkg.optionalDependencies,
            });
            if (declaredDeps.length > 0) {
                runtimePlan = await prepareProjectDependencies({
                    directory: backendDir,
                    repositoryRoot: workspace.rootDir,
                    jobId: null,
                    signal,
                    env: baseEnv,
                });
            }
        }

        const preloadPath = fileURLToPath(new URL('../../utils/autPortOverride.cjs', import.meta.url)).replaceAll('\\', '/');
        const nodeOptions = [baseEnv.NODE_OPTIONS, `--require="${preloadPath}"`].filter(Boolean).join(' ').trim();

        // CRITICAL SECURITY INVARIANT:
        // Never call prepareAutEnvironment (which writes .env to disk).
        // Inject the LLM API key ONLY into the in-memory spawn environment for detectedLlmEnvVars.
        const spawnEnv = {
            ...isolatedProcessEnvironment(),
            ...baseEnv,
            HOST: '127.0.0.1',
            HOSTNAME: '127.0.0.1',
            PORT: String(leasedPort),
            COVAI_AUT_PORT: String(leasedPort),
            NODE_OPTIONS: nodeOptions,
        };
        for (const envName of detectedLlmEnvVars) {
            spawnEnv[envName] = llmApiKey;
        }
        for (const name of protectLlmBaseUrls(spawnEnv, llmBaseUrlOptions)) removedLlmBaseUrlNames.add(name);

        const detectedGetHealth = audit.summary?.endpoints?.find(ep => ep.method === 'GET')?.endpointPath || '/';
        await portLease.release();

        // Scope startup signal to boot phase only so post-boot cancellation runs a single awaited stop() in finally
        const bootAbortController = new AbortController();
        const forwardBootAbort = () => bootAbortController.abort();
        if (signal?.aborted) bootAbortController.abort();
        else signal?.addEventListener('abort', forwardBootAbort, { once: true });

        try {
            serverHandle = await startAutServer({
                snapshotDir: backendDir,
                repositoryRoot: workspace.rootDir,
                port: leasedPort,
                jobId: null,
                healthPath: detectedGetHealth,
                allowHttpNotFound: true,
                allowHttpClientError: true,
                requireHealthy: true,
                preferStart: true,
                env: spawnEnv,
                signal: bootAbortController.signal,
                dependencies: { prepare: async () => runtimePlan },
            });
        } finally {
            signal?.removeEventListener('abort', forwardBootAbort);
            for (const envName of detectedLlmEnvVars) {
                delete spawnEnv[envName];
            }
        }

        if (!serverHandle?.started || !serverHandle.pid) {
            fail('CHATBOT_START_FAILED', 'No runnable start/dev script was found in the imported chatbot package', 422);
        }

        let childExited = false;
        serverHandle.process?.once('exit', () => { childExited = true; });
        serverHandle.process?.once('error', () => { childExited = true; });

        loopbackLease = createManagedLoopbackLease({
            port: leasedPort,
            pid: serverHandle.pid,
            isProcessAlive: () => !stopped && !childExited,
        });

        await logRedacted(
            db,
            jobId,
            'INFO',
            `[ChatbotRuntime] Isolated chatbot started on http://127.0.0.1:${leasedPort} (PID ${serverHandle.pid}, env vars: ${detectedLlmEnvVars.join(', ')}${Object.keys(appliedExtraEnvironment).length ? `, extra settings: ${Object.keys(appliedExtraEnvironment).join(', ')}` : ''}${removedLlmBaseUrlNames.size ? `, kept provider URLs default: ${[...removedLlmBaseUrlNames].join(', ')}` : ''}).`,
            allSecrets,
        );

        return {
            port: leasedPort,
            pid: serverHandle.pid,
            workspaceRoot: workspace.rootDir,
            workspaceDirName: path.basename(workspace.rootDir),
            sqlContainer: resources?.sqlContainer || null,
            detectedLlmEnvVars,
            loopbackLease,
            audit,
            recentOutput: (maxChars = 1200) => redact(String(serverHandle?.recentOutput?.(maxChars) || ''), allSecrets),
            stop,
        };
    } catch (error) {
        await stop();
        const rawMessage = error?.message || 'Failed to start imported chatbot';
        const formatted = redact(formatAutStartupFailure(rawMessage, {}), allSecrets);
        const hint = redact(autRuntimeCompatibilityHint(rawMessage), allSecrets);
        await logRedacted(db, jobId, 'ERROR', `[ChatbotRuntime] Startup failed: ${formatted}`, allSecrets);
        if (error?.statusCode && error?.code) {
            error.message = redact(error.message, allSecrets);
            throw error;
        }
        fail(
            'CHATBOT_START_FAILED',
            `Could not boot the imported chatbot server.${hint ? ` ${hint}` : ''} ${formatted}`.trim(),
            422,
        );
    }
}

function normalizeForMatch(text = '') {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractDistinctiveTerms(phrases = []) {
    const terms = new Set();
    for (const phrase of phrases) {
        const normalized = normalizeForMatch(phrase);
        for (const token of normalized.split(' ')) {
            if (!token) continue;
            const isNumber = /\d/.test(token);
            if ((isNumber && token.length >= 1) || (token.length >= 3 && !STOPWORDS.has(token))) {
                terms.add(token);
            }
        }
    }
    return [...terms];
}

function collectCaseAnchors(caseDef = {}, sources = []) {
    const exactPhrases = [];
    if (Array.isArray(caseDef.expectedFacts)) {
        exactPhrases.push(...caseDef.expectedFacts.filter(f => typeof f === 'string' && f.trim()));
    }
    for (const criterion of caseDef.criteria || []) {
        if (Array.isArray(criterion.expectedFacts)) {
            exactPhrases.push(...criterion.expectedFacts.filter(f => typeof f === 'string' && f.trim()));
        }
        if (typeof criterion.groundTruth === 'string' && criterion.groundTruth.trim()) {
            exactPhrases.push(criterion.groundTruth.trim());
        }
        if (criterion.method === 'rule' && criterion.rule) {
            if (Array.isArray(criterion.rule.expected)) {
                exactPhrases.push(...criterion.rule.expected.filter(v => typeof v === 'string' && v.trim()));
            } else if (typeof criterion.rule.expected === 'string' && criterion.rule.expected.trim()) {
                exactPhrases.push(criterion.rule.expected.trim());
            }
        }
        if (typeof criterion.sourceQuote === 'string' && criterion.sourceQuote.trim()) {
            exactPhrases.push(criterion.sourceQuote.trim());
        }
    }
    if (typeof caseDef.sourceQuote === 'string' && caseDef.sourceQuote.trim()) {
        exactPhrases.push(caseDef.sourceQuote.trim());
    }
    if (!exactPhrases.length && Array.isArray(sources) && sources.length > 0) {
        exactPhrases.push(...sources.map(s => String(s.content || '').slice(0, 1500)).filter(Boolean));
    }
    return exactPhrases;
}

export function evaluateProbeAnswerAgainstKnowledge(answer, anchors = []) {
    const raw = String(answer || '').trim();
    if (!raw) {
        return { matched: false, reason: 'Chatbot returned an empty response.' };
    }
    const normAnswer = normalizeForMatch(raw);
    if (!normAnswer) {
        return { matched: false, reason: 'Chatbot response contained no recognizable text.' };
    }

    const cleanAnchors = anchors.map(a => normalizeForMatch(a)).filter(Boolean);
    const hasExactPhrase = cleanAnchors.some(anchor => anchor.length <= 80 && normAnswer.includes(anchor));
    if (hasExactPhrase && !EMPTY_OR_REFUSAL_RE.test(raw)) {
        return { matched: true, reason: 'Matched expected fact phrase directly.' };
    }

    if (EMPTY_OR_REFUSAL_RE.test(raw) && !hasExactPhrase) {
        return { matched: false, reason: 'Chatbot replied that it has no matching information or empty knowledge base.' };
    }

    const terms = extractDistinctiveTerms(anchors);
    if (!terms.length) {
        return { matched: normAnswer.split(' ').length >= 3, reason: 'Chatbot returned a non-empty substantive answer.' };
    }

    const answerTokens = new Set(normAnswer.split(' '));
    const matchedTerms = terms.filter(term => answerTokens.has(term) || (term.length >= 4 && normAnswer.includes(term)));
    const requiredMatches = Math.min(2, Math.max(1, Math.ceil(terms.length * 0.25)));
    if (matchedTerms.length >= requiredMatches) {
        return { matched: true, reason: `Matched ${matchedTerms.length} domain terms from knowledge source.` };
    }
    return { matched: false, reason: 'Response did not contain expected domain facts from the knowledge documents.' };
}

export function selectKnowledgeProbeItems(caseRows = [], sources = []) {
    const eligible = caseRows
        .map(row => row.testCase?.definition || row.definition || row)
        .filter(def => def && ['HAPPY_PATH', 'KNOWLEDGE_QA'].includes(def.taskType) && Array.isArray(def.turns) && def.turns.length > 0);

    if (eligible.length > 0) {
        return eligible.slice(0, 2).map(def => ({
            caseKey: def.caseKey,
            question: def.turns[0].content,
            context: def.context || '',
            anchors: collectCaseAnchors(def, sources),
        }));
    }

    if (Array.isArray(sources) && sources.length > 0) {
        const primary = sources[0];
        const firstParagraph = String(primary.content || '')
            .split(/\r?\n\s*\r?\n/)
            .map(line => line.replace(/^#+\s*/, '').trim())
            .find(line => line.length >= 15) || String(primary.content || '').slice(0, 300).trim();
        if (firstParagraph) {
            return [{
                caseKey: 'source-readiness-probe-1',
                question: `Summarize the key policy or information stated in "${primary.name}".`,
                context: '',
                anchors: [firstParagraph],
            }];
        }
    }

    return [];
}

export async function probeChatbotKnowledgeReadiness({
    targetConfig,
    caseRows = [],
    sources = [],
    credential,
    lease = null,
    transport,
    secretsToRedact = [],
    timeoutMs = 20000,
    signal,
}) {
    const probeItems = selectKnowledgeProbeItems(caseRows, sources);
    if (!probeItems.length) {
        return { skipped: true, ready: true, probes: [] };
    }

    const redactList = [credential, ...secretsToRedact].filter(s => typeof s === 'string' && s.length > 0);
    const probeObservations = await Promise.all(probeItems.map(async item => {
        if (signal?.aborted) fail('RUN_CANCELED', 'Evaluation run was canceled during knowledge readiness probe', 409);
        const messages = [
            ...(item.context ? [{ role: 'system', content: item.context }] : []),
            { role: 'user', content: item.question },
        ];
        const response = await executeTurn(
            targetConfig,
            {
                requestId: `probe-${crypto.randomUUID()}`,
                messages,
                latestUserMessage: item.question,
                evaluationContext: { executionMode: 'KNOWLEDGE_PROBE', toolsAllowed: false },
                signal,
            },
            { credential, lease, transport, timeoutMs },
        );
        const check = evaluateProbeAnswerAgainstKnowledge(response.answer, item.anchors);
        return {
            caseKey: item.caseKey,
            question: item.question,
            answerExcerpt: redact(response.answer, redactList).slice(0, 500),
            latencyMs: response.latencyMs,
            matched: check.matched,
            reason: check.reason,
        };
    }));

    const anyMatched = probeObservations.some(p => p.matched);
    if (!anyMatched) {
        throw new ServiceError(
            'Knowledge readiness probe failed: the target chatbot responded, but could not answer sample questions from the provided business documents. Verify that your chatbot knowledge base or database is seeded, or set skipKnowledgeProbe: true to run anyway.',
            422,
            'KNOWLEDGE_NOT_READY',
            {
                status: 'KNOWLEDGE_EMPTY_OR_UNSEEDED',
                probes: probeObservations,
            },
        );
    }

    return {
        skipped: false,
        ready: true,
        status: 'KNOWLEDGE_READY',
        probes: probeObservations,
    };
}

const execFileAsync = promisify(execFile);

/**
 * Best-effort cleanup of orphaned child processes, temp assessment directories, and Docker containers
 * left behind by interrupted Managed Project evaluation runs upon server startup / stale lease reconciliation.
 */
export async function cleanupOrphanedChatbotRuntime(runtimeMeta = {}) {
    if (!runtimeMeta || typeof runtimeMeta !== 'object') return;
    const assessmentsBase = path.join(os.tmpdir(), 'covai-assessments');
    const dirName = typeof runtimeMeta.workspaceDirName === 'string' && /^operation-[\w-]+$/.test(runtimeMeta.workspaceDirName)
        ? runtimeMeta.workspaceDirName
        : null;
    const candidateWorkspace = dirName ? path.join(assessmentsBase, dirName) : null;
    const workspaceStillOnDisk = Boolean(candidateWorkspace && fs.existsSync(candidateWorkspace));

    if (
        Number.isInteger(runtimeMeta.pid) &&
        runtimeMeta.pid > 0 &&
        runtimeMeta.pid !== process.pid &&
        runtimeMeta.pid !== process.ppid &&
        Number.isInteger(runtimeMeta.port) &&
        runtimeMeta.port > 0 &&
        workspaceStillOnDisk &&
        await isPortInUse(runtimeMeta.port, '127.0.0.1', 300)
    ) {
        try {
            await stopAutServer(runtimeMeta.pid, runtimeMeta.port, null);
        } catch (err) {
            console.error(`[ChatbotRuntime] Orphan process cleanup warning (PID ${runtimeMeta.pid}): ${err?.message || err}`);
        }
    }

    if (typeof runtimeMeta.sqlContainer === 'string' && /^covai-system-(?:mysql|postgres|mongodb|redis)-[0-9a-f-]{36}$/i.test(runtimeMeta.sqlContainer)) {
        try {
            await execFileAsync('docker', ['rm', '-f', '-v', runtimeMeta.sqlContainer], { timeout: 15000, windowsHide: true });
        } catch (err) {
            console.error(`[ChatbotRuntime] Orphan container cleanup warning (${runtimeMeta.sqlContainer}): ${err?.message || err}`);
        }
    }

    if (candidateWorkspace && workspaceStillOnDisk) {
        try {
            const realBase = fs.realpathSync(assessmentsBase);
            const realTarget = fs.realpathSync(candidateWorkspace);
            const rel = path.relative(realBase, realTarget);
            if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                fs.rmSync(realTarget, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
            }
        } catch (err) {
            console.error(`[ChatbotRuntime] Orphan workspace cleanup warning (${candidateWorkspace}): ${err?.message || err}`);
        }
    }
}
