import { ServiceError } from '../utils/serviceError.js';

export const systemSuiteError = error => {
    if (['P2021', 'P2022'].includes(error.code)) return new ServiceError('Test version storage is not ready. The server needs the System Test database migration and a regenerated Prisma Client.', 503, 'SYSTEM_VERSION_SCHEMA_REQUIRED');
    if (['P1001', 'P1002'].includes(error.code)) return new ServiceError('The database is unavailable. Reconnect and retry version history.', 503, 'SYSTEM_VERSION_DATABASE_UNAVAILABLE');
    return error;
};

export const assertSystemSuiteStorage = db => {
    if (!db.systemSuiteVersion || !db.systemSuiteState || !db.systemTestBlob) throw systemSuiteError({code:'P2021'});
};
