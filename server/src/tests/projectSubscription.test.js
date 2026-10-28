import { jest } from '@jest/globals';
import { registerProjectStream,closeProjectStreams,registeredProjectStreamCount } from '../services/projectStreamRegistry.service.js';

describe('project stream revocation registry', () => {
    test('revocation closes all tabs for the target member and leaves another project/user alone', () => {
        const first = jest.fn(); const second = jest.fn(); const other = jest.fn();
        registerProjectStream({projectId:'p',userId:'editor',close:first});
        registerProjectStream({projectId:'p',userId:'editor',close:second});
        const unregister = registerProjectStream({projectId:'other',userId:'editor',close:other});
        closeProjectStreams({projectId:'p',userId:'editor',accessRevision:7});
        expect(first).toHaveBeenCalledWith({type:'ACCESS_REVOKED',projectId:'p',accessRevision:7});
        expect(second).toHaveBeenCalledTimes(1);
        expect(other).not.toHaveBeenCalled();
        expect(registeredProjectStreamCount({projectId:'p',userId:'editor'})).toBe(0);
        unregister();
    });
    test('disconnect unregister is idempotent and a broken tab cannot stop other revocations', () => {
        const close = jest.fn();
        const unregister = registerProjectStream({projectId:'p',userId:'u',close});
        unregister();unregister();
        registerProjectStream({projectId:'p',userId:'u',close:()=>{throw new Error('already disconnected');}});
        registerProjectStream({projectId:'p',userId:'u',close});
        expect(()=>closeProjectStreams({projectId:'p',userId:'u',accessRevision:2})).not.toThrow();
        expect(close).toHaveBeenCalledTimes(1);
    });
});
