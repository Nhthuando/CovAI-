import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshPublishedUnitTests} from './unitTestRefresh.js';

test('runs every refresh and keeps synchronous and asynchronous errors separate from publication',async()=>{
    const calls=[];
    const errors=await refreshPublishedUnitTests([
        ()=>{calls.push('coverage');throw new Error('coverage unavailable');},
        async()=>{calls.push('version');throw new Error('version refresh failed');},
        async()=>{calls.push('file');return 'updated';},
    ]);
    assert.deepEqual(calls,['coverage','version','file']);
    assert.deepEqual(errors,['coverage unavailable','version refresh failed']);
});
test('successful refreshes return no warnings',async()=>{
    assert.deepEqual(await refreshPublishedUnitTests([async()=>({success:true})]),[]);
});
test('recognizes query refresh failures returned as data instead of rejected promises',async()=>{
    assert.deepEqual(await refreshPublishedUnitTests([async()=>({isError:true,error:new Error('offline')})]),['offline']);
});
