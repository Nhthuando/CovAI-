import {it,expect} from '@jest/globals';
import {queueWorkerConfig} from '../utils/queueWorkerConfig.js';
it('keeps the existing bounded worker default and supports API-only instances',()=>{
    expect(queueWorkerConfig({})).toEqual({enabled:true,concurrency:1});
    expect(queueWorkerConfig({COVAI_WORKER_ENABLED:'false',COVAI_WORKER_CONCURRENCY:'4'})).toEqual({enabled:false,concurrency:4});
});
it.each(['0','-1','1.5','NaN','33','Infinity',''])('rejects an unsafe worker concurrency: %s',value=>{
    expect(()=>queueWorkerConfig({COVAI_WORKER_CONCURRENCY:value})).toThrow('integer from 1 to 32');
});
