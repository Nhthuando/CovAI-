import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    __clearAllSystemTestSecretsForTest,
    allSystemTestSecretValues,
    clearSystemTestSecrets,
    listSystemTestSecretNames,
    readSystemTestSecrets,
    redactSystemTestSecrets,
    storeSystemTestSecrets,
} from '../services/systemTestSecrets.service.js';

const directory = 'system-test-vault-fixture';
const hour = 60 * 60 * 1000;

beforeEach(__clearAllSystemTestSecretsForTest);
afterEach(__clearAllSystemTestSecretsForTest);

describe('System Test secrets', () => {
    it('merges values, returns a copy, and clears the directory', () => {
        storeSystemTestSecrets(directory, { FIRST: 'first-fixture', SECOND: 'old-value' });
        storeSystemTestSecrets(directory, { SECOND: 'second-fixture' });
        const values = readSystemTestSecrets(directory);
        expect(values).toEqual({ FIRST: 'first-fixture', SECOND: 'second-fixture' });
        values.FIRST = 'changed';
        expect(readSystemTestSecrets(directory).FIRST).toBe('first-fixture');
        clearSystemTestSecrets(directory);
        expect(listSystemTestSecretNames(directory)).toEqual({ names: [], expiresAt: null, updatedAt: null });
        expect(readSystemTestSecrets(directory)).toEqual({});
    });

    it('slides the idle TTL on reads and caps the session at twelve hours', () => {
        storeSystemTestSecrets(directory, { KEY: 'test-fixture' }, { now: 0 });
        expect(listSystemTestSecretNames(directory, { now: hour })).toEqual({ names: ['KEY'], expiresAt: 2 * hour, updatedAt: 0 });
        expect(readSystemTestSecrets(directory, { now: 2 * hour })).toEqual({});

        storeSystemTestSecrets(directory, { KEY: 'test-fixture' }, { now: 0 });
        for (let now = hour; now < 12 * hour; now += hour) {
            expect(readSystemTestSecrets(directory, { now }).KEY).toBe('test-fixture');
        }
        expect(listSystemTestSecretNames(directory, { now: 11 * hour }).expiresAt).toBe(12 * hour);
        expect(readSystemTestSecrets(directory, { now: 12 * hour })).toEqual({});
    });

    it('redacts raw and JSON-escaped values and skips values under six characters', () => {
        const value = 'test"key\n\\path';
        storeSystemTestSecrets(directory, { KEY: value, SHORT: 'small' });
        expect(allSystemTestSecretValues()).toEqual([value]);
        expect(redactSystemTestSecrets(`${value} ${JSON.stringify({ value })} small`)).toBe('*** {"value":"***"} small');
    });

    it('rejects invalid values before merging any of them', () => {
        storeSystemTestSecrets(directory, { KEY: 'test-fixture' });
        for (const invalid of [123, 'test\0value', 'é'.repeat(4097)]) {
            expect(() => storeSystemTestSecrets(directory, { KEY: 'replacement', INVALID: invalid })).toThrow();
        }
        expect(readSystemTestSecrets(directory)).toEqual({ KEY: 'test-fixture' });
    });
});
