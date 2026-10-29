import {it,expect,jest} from '@jest/globals';
import {acquireSnapshotLease} from '../services/systemAssessmentWorkspace.service.js';
import {operationTimeout} from '../services/systemOperationError.service.js';
it('keeps ownership checks independent of timeout cancellation without permitting a lost lease',async()=>{
    let current;
    const redis={set:jest.fn(async(_key,token)=>{current=token;return 'OK';}),get:jest.fn(async()=>current),eval:jest.fn(async()=>1)};
    const lease=await acquireSnapshotLease({redis,snapshotId:'owned'});
    try {
        const controller=new AbortController();lease.signal=controller.signal;controller.abort(operationTimeout());
        await expect(lease.assertHeld()).rejects.toMatchObject({code:'SYSTEM_OPERATION_TIMEOUT'});
        await expect(lease.assertOwnership()).resolves.toBeUndefined();
        current='another operation';
        await expect(lease.assertOwnership()).rejects.toThrow('lease was lost');
    } finally {await lease.release();}
});
