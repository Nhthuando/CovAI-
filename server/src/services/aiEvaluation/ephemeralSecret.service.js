import crypto from 'node:crypto';
import { queueWorkerConfig } from '../../utils/queueWorkerConfig.js';
import { fail } from './common.js';

export const DEFAULT_RUN_SECRET_TTL_MS = 20 * 60 * 1000;
export const DEFAULT_PROBE_SECRET_TTL_MS = 5 * 60 * 1000;
const MAX_VAULT_ENTRIES = 500;

const vault = new Map();

function zeroizeEntry(entry) {
    if (entry?.buffer && Buffer.isBuffer(entry.buffer)) {
        entry.buffer.fill(0);
    }
}

export function sweepExpiredEphemeralSecrets(now = Date.now()) {
    let removed = 0;
    for (const [vaultRefId, entry] of vault.entries()) {
        if (entry.expiresAt <= now) {
            zeroizeEntry(entry);
            vault.delete(vaultRefId);
            removed += 1;
        }
    }
    return removed;
}

const sweepTimer = setInterval(() => {
    sweepExpiredEphemeralSecrets(Date.now());
}, 60 * 1000);
sweepTimer.unref?.();

export function validateSecretValue(secret, label = 'credential') {
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096 || /[\r\n\0]/.test(secret)) {
        fail('INVALID_EPHEMERAL_SECRET', `Provide a valid ${label} (1 to 4096 single-line characters)`);
    }
    return secret.trim();
}

export function assertColocatedWorkerForSecret({ env = process.env } = {}) {
    const worker = queueWorkerConfig(env);
    if (!worker.enabled) {
        fail(
            'EPHEMERAL_SECRET_REQUIRES_COLOCATED_WORKER',
            'Ephemeral in-memory credentials require the BullMQ worker to run in the same server process (COVAI_WORKER_ENABLED must not be false).',
            503,
        );
    }
}

/**
 * Stores a temporary credential/key in process RAM as a Buffer with bounded TTL.
 * Note: Because Express parses incoming JSON strings before reaching this service,
 * V8 heap string copies remain subject to V8 GC; Buffer zeroization minimizes
 * retention of the vault copy while guaranteeing zero persistence in Postgres/Redis/disk.
 */
export function storeEphemeralSecret({
    secret,
    projectId,
    kind = 'targetAuthToken',
    ttlMs = DEFAULT_RUN_SECRET_TTL_MS,
    now = Date.now(),
    env = process.env,
    requireColocatedWorker = true,
}) {
    if (typeof projectId !== 'string' || !projectId.trim()) {
        fail('INVALID_PROJECT_ID', 'Project identifier is required for ephemeral secret scoping', 400);
    }
    const clean = validateSecretValue(secret, kind);
    if (requireColocatedWorker) {
        assertColocatedWorkerForSecret({ env });
    }
    sweepExpiredEphemeralSecrets(now);
    if (vault.size >= MAX_VAULT_ENTRIES) {
        fail('EPHEMERAL_VAULT_FULL', 'Too many concurrent ephemeral evaluation sessions; retry shortly.', 429);
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 60 * 60 * 1000) {
        fail('INVALID_TTL', 'Ephemeral secret TTL must be between 1s and 60m');
    }

    const vaultRefId = crypto.randomUUID();
    const expiresAt = now + ttlMs;
    vault.set(vaultRefId, {
        buffer: Buffer.from(clean, 'utf8'),
        projectId,
        kind,
        createdAt: now,
        expiresAt,
    });
    return { vaultRefId, kind, expiresAt };
}

export function readEphemeralSecret(vaultRefId, { projectId, now = Date.now() } = {}) {
    sweepExpiredEphemeralSecrets(now);
    if (typeof vaultRefId !== 'string' || !vaultRefId) {
        fail('EPHEMERAL_SECRET_MISSING', 'Ephemeral credential reference is missing', 410);
    }
    const entry = vault.get(vaultRefId);
    if (!entry) {
        fail('EPHEMERAL_SECRET_EXPIRED', 'Ephemeral credential expired or was already cleared from memory. Re-enter the key and retry.', 410);
    }
    if (projectId && entry.projectId !== projectId) {
        fail('EPHEMERAL_SECRET_SCOPE_MISMATCH', 'Ephemeral credential does not belong to this project', 403);
    }
    return entry.buffer.toString('utf8');
}

export function destroyEphemeralSecret(vaultRefId) {
    if (typeof vaultRefId !== 'string' || !vaultRefId) return false;
    const entry = vault.get(vaultRefId);
    if (!entry) return false;
    zeroizeEntry(entry);
    vault.delete(vaultRefId);
    return true;
}

export function clearAllEphemeralSecrets() {
    for (const entry of vault.values()) {
        zeroizeEntry(entry);
    }
    vault.clear();
}

export function __inspectVaultBufferForTest(vaultRefId) {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('Vault buffer inspection is restricted to test environments');
    }
    return vault.get(vaultRefId)?.buffer || null;
}

export function __vaultSizeForTest() {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('Vault size inspection is restricted to test environments');
    }
    return vault.size;
}
