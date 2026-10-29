import {it,expect} from '@jest/globals';
import {geminiQuotaError,nextMidnight} from '../utils/geminiQuota.js';
it.each([
    ['2026-10-14T03:00:00Z','2026-10-14T07:00:00.000Z'],
    ['2026-01-01T14:00:00Z','2026-01-02T08:00:00.000Z'],
    ['2026-03-08T07:00:00Z','2026-03-08T08:00:00.000Z'],
    ['2026-03-08T10:00:00Z','2026-03-09T07:00:00.000Z'],
])('computes Pacific daily reset across DST at %s',(now,expected)=>{
    expect(nextMidnight('America/Los_Angeles',new Date(now)).toISOString()).toBe(expected);
});
it('daily quota identifies structured quota IDs and reports the Vietnam reset time',()=>{
    const error=geminiQuotaError({message:'RESOURCE_EXHAUSTED',errorDetails:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel'}]}]},'gemini-3.5-flash-lite',new Date('2026-10-14T03:00:00Z'));
    expect(error).toMatchObject({code:'AI_QUOTA_EXCEEDED',statusCode:429,quotaPeriod:'day',resetAt:'2026-10-14T07:00:00.000Z'});
    expect(error.message).toContain('14:00:00');
});
it('a provider retry delay is an earliest retry time, not an invented daily reset',()=>{
    const error=geminiQuotaError({message:'Too many requests',errorDetails:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'30s'}]},'gemini-2.5-flash',new Date('2026-10-14T03:00:00Z'));
    expect(error).toMatchObject({resetAt:null,retryAt:'2026-10-14T03:00:30.000Z'});
});
it('does not invent a reset time when no period or retry info is supplied',()=>{
    expect(geminiQuotaError({message:'quota exceeded'},'gemini-3.8-flash')).toMatchObject({resetAt:null,retryAt:null});
});
