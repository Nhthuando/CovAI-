import { jest, test, expect } from '@jest/globals';
import { readEditorLineHistory } from '../services/projectLineHistory.service.js';

const input = { projectId:'project',snapshotId:'snapshot',documentId:'document',userId:'viewer',generation:1,revision:4,path:'a.js',line:3 };
const row = () => ({ active:true,generation:1,revision:4,contentHash:'hash',text:null,snapshot:{id:'snapshot'},
    nearby:[{start:1,end:1000,source:'HUMAN_EDIT',actorName:'Developer',timestamp:'2026-11-05T00:00:00Z'}] });
test('authored line uses one query and returns a bounded neighboring range', async () => {
    const db={$queryRaw:jest.fn(async()=>[row()])};
    const result=await readEditorLineHistory({...input,db});
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.history.actorName).toBe('Developer');
    expect(result.history.nearby[0]).toMatchObject({start:1,end:23});
    expect(result.text).toBeNull();
});
test('missing authorized row and missing identity fail closed', async () => {
    const db={$queryRaw:jest.fn(async()=>[])};
    await expect(readEditorLineHistory({...input,db})).rejects.toMatchObject({code:'RESOURCE_NOT_FOUND'});
    db.$queryRaw.mockClear();
    await expect(readEditorLineHistory({...input,userId:null,db})).rejects.toMatchObject({code:'AUTH_REQUIRED'});
    expect(db.$queryRaw).not.toHaveBeenCalled();
});
test('replaced, closed or stale document never returns attribution', async () => {
    for (const [change,code] of [[{generation:2},'EDITOR_GENERATION_CHANGED'],[{active:false},'EDITOR_DOCUMENT_CLOSED'],[{revision:5},'EDITOR_SYNC_REQUIRED']]) {
        await expect(readEditorLineHistory({...input,db:{$queryRaw:async()=>[{...row(),...change}]}})).rejects.toMatchObject({code});
    }
});
test('unattributed lines preserve current text for the Git fallback', async () => {
    const result=await readEditorLineHistory({...input,db:{$queryRaw:async()=>[{...row(),nearby:[],text:'current text'}]}});
    expect(result.history).toBeNull(); expect(result.text).toBe('current text');
});
