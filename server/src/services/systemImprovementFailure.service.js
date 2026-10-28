import {isStaleImprovementError} from './systemOperationError.service.js';

export const improvementFailure = error => {
    if (error.code === 'SYSTEM_OPERATION_TIMEOUT') return {stopReason:'TIME_LIMIT',state:'FAILED_VERIFICATION'};
    if (error.code === 'SYSTEM_TEST_ENVIRONMENT_REQUIRED') return {stopReason:'ENVIRONMENT_REQUIRED',state:'FAILED_VERIFICATION'};
    if (/^SYSTEM_RUNTIME_|^AUT_|^PROJECT_/.test(error.code || '')) return {stopReason:'SETUP_FAILED',state:'FAILED_VERIFICATION'};
    if (isStaleImprovementError(error)) return {stopReason:'SOURCE_CHANGED',state:'STALE'};
    if (error.statusCode === 413) return {stopReason:'CONTEXT_LIMIT',state:'FAILED_VERIFICATION'};
    if ([429,503].includes(error.statusCode)) return {stopReason:'PROVIDER_LIMIT',state:'PROVIDER_UNAVAILABLE'};
    return {stopReason:'VERIFICATION_FAILED',state:'FAILED_VERIFICATION'};
};
