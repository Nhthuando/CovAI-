import {it,expect,jest} from '@jest/globals';
import {createAiJobBudget,withAiJobBudget,currentAiJobBudget} from '../services/aiJobBudget.service.js';

it('blocks request seven before sending and reports actual provider totals',async()=>{
    const onChange=jest.fn(),budget=createAiJobBudget({onChange});
    for(let i=0;i<6;i++) {
        await budget.beforeRequest();
        await budget.record({promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:20});
    }
    await expect(budget.beforeRequest()).rejects.toMatchObject({code:'AI_JOB_BUDGET_EXCEEDED'});
    expect(budget.snapshot()).toMatchObject({requests:6,reportedRequests:6,totalTokens:120,promptTokens:60,outputTokens:30,incomplete:false});
});
it('keeps failed or unreported requests visible rather than estimating tokens',async()=>{
    const budget=createAiJobBudget();
    await budget.beforeRequest();await budget.record(undefined);
    expect(budget.snapshot()).toMatchObject({requests:1,reportedRequests:0,totalTokens:0,incomplete:true});
});
it('isolates simultaneous job scopes and leaves other Gemini callers unaffected',async()=>{
    const one=createAiJobBudget(),two=createAiJobBudget();
    await Promise.all([one,two].map(budget=>withAiJobBudget(budget,async()=>{
        await Promise.resolve();expect(currentAiJobBudget()).toBe(budget);
        await currentAiJobBudget().beforeRequest();
    })));
    expect(one.snapshot().requests).toBe(1);expect(two.snapshot().requests).toBe(1);
    expect(currentAiJobBudget()).toBeUndefined();
});
it('does not dispatch another request after cancellation or lost job ownership',async()=>{
    const controller=new AbortController();controller.abort();
    const budget=createAiJobBudget({signal:controller.signal});
    await expect(budget.beforeRequest()).rejects.toThrow('canceled');
    expect(budget.snapshot().requests).toBe(0);
});
