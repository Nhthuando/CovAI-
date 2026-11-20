import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { isTransientDatabaseError, safeError, serial } from '../services/aiEvaluation/common.js';

const databaseError = () => Object.assign(
    new Error('Transaction API error: Unable to start a transaction in the given time.'),
    { code: 'P2028' },
);

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe('isTransientDatabaseError', () => {
    test('recognizes P2028', () => {
        expect(isTransientDatabaseError({ code: 'P2028' })).toBe(true);
    });

    test('recognizes a transaction startup timeout message', () => {
        expect(isTransientDatabaseError(new Error('Transaction API error: Unable to start a transaction in the given time.'))).toBe(true);
    });

    test('rejects an unrelated error', () => {
        expect(isTransientDatabaseError(new Error('boom'))).toBe(false);
    });
});

describe('serial', () => {
    test('retries transient failures and allows more time to acquire a transaction', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const db = {
            $transaction: jest.fn()
                .mockRejectedValueOnce(databaseError())
                .mockRejectedValueOnce(databaseError())
                .mockResolvedValueOnce('ok'),
        };
        const operation = jest.fn();
        const result = serial(db, operation);

        await jest.advanceTimersByTimeAsync(2000);

        await expect(result).resolves.toBe('ok');
        expect(db.$transaction).toHaveBeenCalledTimes(3);
        expect(db.$transaction).toHaveBeenCalledWith(operation, expect.objectContaining({ maxWait: 10000 }));
    });

    test('rejects a non-transient error immediately', async () => {
        const error = new Error('boom');
        const db = { $transaction: jest.fn().mockRejectedValue(error) };

        await expect(serial(db, jest.fn())).rejects.toBe(error);
        expect(db.$transaction).toHaveBeenCalledTimes(1);
    });
});

test('safeError exposes a database busy error for P2028', () => {
    expect(safeError(databaseError())).toEqual({
        code: 'DATABASE_BUSY',
        message: 'The database did not respond in time. Run the evaluation again.',
    });
});
