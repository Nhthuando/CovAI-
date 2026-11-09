import { ServiceError } from '../utils/serviceError.js';

// Historical Frontend reports remain readable; all newly requested runs are Full Stack.
export const requireFullStackMode = (mode = 'full') => {
    if (String(mode).toLowerCase().trim() !== 'full') {
        throw new ServiceError('System Test now uses Full Stack only. Generate tests that use the real backend instead of frontend API mocks.', 400, 'SYSTEM_FULL_STACK_ONLY');
    }
    return 'full';
};
