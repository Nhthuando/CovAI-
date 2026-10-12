import { ServiceError } from '../utils/serviceError.js';

export const parseSystemTestResultQuery = (query = {}) => {
    const where = {};
    if (query.executionMode !== undefined) {
        if (!['frontend', 'full'].includes(query.executionMode)) throw new ServiceError('executionMode must be frontend or full', 400);
        where.executionMode = query.executionMode;
    }
    if (query.runner !== undefined) {
        if (!['playwright', 'cypress'].includes(query.runner)) throw new ServiceError('runner must be playwright or cypress', 400);
        where.type = query.runner.toUpperCase();
    }
    return where;
};
