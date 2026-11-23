import path from 'node:path';
import { ServiceError } from '../utils/serviceError.js';
import { systemTestEnvironmentDirectory } from './systemTestEnvironmentRoot.service.js';

const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TTL_MS = 12 * 60 * 60 * 1000;
const vault = new Map();
const directoryKey = directory => path.resolve(systemTestEnvironmentDirectory(directory));

function clearEntry(key, entry) {
    for (const buffer of entry.values.values()) buffer.fill(0);
    vault.delete(key);
}

function getEntry(key, now) {
    const entry = vault.get(key);
    if (entry && entry.expiresAt <= now) {
        clearEntry(key, entry);
        return undefined;
    }
    return entry;
}

setInterval(() => {
    const now = Date.now();
    for (const key of vault.keys()) getEntry(key, now);
}, 5 * 60 * 1000).unref();

export function validateSystemTestSecret(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 8 * 1024 || value.includes('\0')) {
        throw new ServiceError('Enter a test value up to 8 KiB without null characters.', 422);
    }
}

export function storeSystemTestSecrets(directory, values, { now = Date.now() } = {}) {
    const entries = Object.entries(values);
    for (const [, value] of entries) validateSystemTestSecret(value);
    if (!entries.length) return;
    const key = directoryKey(directory);
    const entry = getEntry(key, now) ?? { values: new Map(), hardExpiresAt: now + MAX_TTL_MS };
    for (const [name, value] of entries) {
        entry.values.get(name)?.fill(0);
        entry.values.set(name, Buffer.from(value));
    }
    entry.touchedAt = now;
    entry.updatedAt = now;
    entry.expiresAt = Math.min(now + IDLE_TTL_MS, entry.hardExpiresAt);
    vault.set(key, entry);
}

export function readSystemTestSecrets(directory, { now = Date.now() } = {}) {
    const entry = getEntry(directoryKey(directory), now);
    if (!entry) return {};
    entry.touchedAt = now;
    entry.expiresAt = Math.min(now + IDLE_TTL_MS, entry.hardExpiresAt);
    return Object.fromEntries([...entry.values].map(([name, value]) => [name, value.toString()]));
}

export function clearSystemTestSecrets(directory) {
    const key = directoryKey(directory);
    const entry = vault.get(key);
    if (entry) clearEntry(key, entry);
}

export function listSystemTestSecretNames(directory, { now = Date.now() } = {}) {
    const entry = getEntry(directoryKey(directory), now);
    return entry
        ? { names: [...entry.values.keys()], expiresAt: entry.expiresAt, updatedAt: entry.updatedAt ?? null }
        : { names: [], expiresAt: null, updatedAt: null };
}

export function allSystemTestSecretValues({ now = Date.now() } = {}) {
    const values = new Set();
    for (const key of vault.keys()) {
        const entry = getEntry(key, now);
        for (const buffer of entry?.values.values() ?? []) {
            const value = buffer.toString();
            if (value.length >= 6) values.add(value);
        }
    }
    return [...values];
}

function redactor() {
    const variants = allSystemTestSecretValues().flatMap(value => [value, JSON.stringify(value).slice(1, -1)]);
    if (!variants.length) return text => text;
    const pattern = [...new Set(variants)].sort((a, b) => b.length - a.length)
        .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const matcher = new RegExp(pattern, 'g');
    return text => text.replace(matcher, '***');
}

export function redactSystemTestSecrets(text) {
    return typeof text === 'string' ? redactor()(text) : text;
}

export function redactDeep(value) {
    const redact = redactor();
    const visit = item => {
        if (typeof item === 'string') return redact(item);
        if (Array.isArray(item)) return item.map(visit);
        if (item && Object.getPrototypeOf(item) === Object.prototype) {
            return Object.fromEntries(Object.entries(item).map(([key, child]) => [redact(key), visit(child)]));
        }
        return item;
    };
    return visit(value);
}

export function __clearAllSystemTestSecretsForTest() {
    for (const [key, entry] of vault) clearEntry(key, entry);
}
