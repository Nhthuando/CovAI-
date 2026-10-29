import { canonicalizeOperationInput, hashOperationInput } from '../utils/projectOperationIdentity.js';

describe('project operation semantic identity', () => {
    test('object order is irrelevant while selected scope order is retained', () => {
        expect(hashOperationInput({mode:'FULL',runner:{name:'jest',config:'a'}}))
            .toBe(hashOperationInput({runner:{config:'a',name:'jest'},mode:'FULL'}));
        expect(hashOperationInput({scope:['a','b']})).not.toBe(hashOperationInput({scope:['b','a']}));
    });
    test('model, configuration and workspace revision each distinguish work', () => {
        const base = {projectId:'p',snapshotId:'s',workspaceRevision:1,model:'a',config:'jest'};
        for (const next of [{model:'b'},{config:'vitest'},{workspaceRevision:2}]) {
            expect(hashOperationInput({...base,...next})).not.toBe(hashOperationInput(base));
        }
    });
    test('rejects cycles, functions and non-finite numeric input rather than collapsing identities', () => {
        const cyclic = {}; cyclic.self = cyclic;
        for (const value of [cyclic,{callback:()=>{}},{number:NaN},{date:new Date()}]) expect(()=>canonicalizeOperationInput(value)).toThrow();
    });
    test('undefined optional object fields match an omitted optional field', () => {
        expect(canonicalizeOperationInput({a:undefined,b:null})).toBe('{"b":null}');
    });
});
