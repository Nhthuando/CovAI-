import { ServiceError } from '../utils/serviceError.js';

export const hashFields = ['sourceHash', 'scopeHash', 'configHash', 'runtimeHash', 'requirementRevisionId', 'runner', 'browser', 'executionMode', 'adapterVersion', 'seed'];
export const counter = (covered, total) => {
    if (![covered, total].every(Number.isSafeInteger) || covered < 0 || total < covered) throw new ServiceError('Invalid measured counter', 422);
    return { covered, total, pct: total ? Number((covered * 100 / total).toFixed(2)) : null };
};
export const unknownMeasurement = (status = 'NOT_MEASURED', reason = 'NO_RUN_INSTRUMENTATION') => ({ schemaVersion: 1, status, provider: null, counters: null, reasonCodes: [reason] });
export const validateMeasurement = measurement => {
    if (!measurement || measurement.schemaVersion !== 1 || !['MEASURED', 'PARTIAL', 'NOT_MEASURED', 'UNSUPPORTED', 'INVALID', 'LEGACY_UNVERIFIED'].includes(measurement.status)) throw new ServiceError('Invalid measurement contract', 422);
    if (measurement.status === 'MEASURED') {
        if (!measurement.measurementId || !measurement.sourceHash || !measurement.scopeHash || !measurement.artifactManifestHash || measurement.provider !== 'istanbul' || measurement.scope?.omittedFiles?.length || measurement.scope?.eligibleFiles !== measurement.scope?.instrumentedFiles) throw new ServiceError('Measurement lacks complete provenance', 422);
        for (const metric of ['lines', 'branches', 'statements', 'functions']) {
            const value = measurement.counters?.[metric];
            if (!value || counter(value.covered, value.total).pct !== value.pct) throw new ServiceError('Invalid coverage metric', 422);
        }
    }
    return measurement;
};
export const canCompareAssessments = (before, after) => {
    const reasonCodes = hashFields.filter(field => before?.[field] !== after?.[field]).map(field => `DIFFERENT_${field.toUpperCase()}`);
    if (!before?.sourceHash || !before?.scopeHash || !before?.configHash) reasonCodes.push('MISSING_IDENTITY');
    return { comparable: !reasonCodes.length, reasonCodes };
};
export const coverageSummaryFor = measurement => ({ status: measurement?.status || 'LEGACY_UNVERIFIED', linesPct: null, branchesPct: null, statementsPct: null, functionsPct: null, tiers: measurement?.tiers || {} });
