import { ServiceError } from '../utils/serviceError.js';

export const operationTimeout = () => Object.assign(new ServiceError('The operation reached its 20-minute time limit. No unverified tests were saved. Try again to continue targeting uncovered code.', 408), { code: 'SYSTEM_OPERATION_TIMEOUT' });
export const operationCanceled = () => Object.assign(new ServiceError('System operation canceled', 409), { code: 'SYSTEM_OPERATION_CANCELED' });
export const operationAbortReason = signal => signal?.reason instanceof Error && signal.reason.name !== 'AbortError' ? signal.reason : operationCanceled();
export const isStaleImprovementError = error => error.statusCode === 409 && /assessment is stale|current completed assessment required|requirement revision changed|test changed since review|snapshot changed|dependency\/runtime versions changed/i.test(error.message);
