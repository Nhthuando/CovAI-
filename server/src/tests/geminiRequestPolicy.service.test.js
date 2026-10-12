import {describe,it,expect,jest,afterEach} from '@jest/globals';
import {runGeminiRequest,isDailyQuotaError} from '../services/geminiRequestPolicy.service.js';
afterEach(()=>jest.useRealTimers());
describe('bounded Gemini requests',()=>{
    it('distinguishes temporary minute limits from exhausted daily quotas',()=>{
        expect(isDailyQuotaError(new Error('generate_content_free_tier_requests: GenerateRequestsPerMinute'))).toBe(false);
        expect(isDailyQuotaError(new Error('generate_content_free_tier_requests: GenerateRequestsPerDay'))).toBe(true);
    });
    it('reports 503 retries and recovers without replacing the request',async()=>{
        const request=jest.fn().mockRejectedValueOnce(Object.assign(new Error('provider busy'),{status:503})).mockResolvedValue('valid');
        const onRetry=jest.fn();
        await expect(runGeminiRequest(request,{onRetry,retryBaseDelayMs:0})).resolves.toBe('valid');
        expect(request).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({attempt:2,reason:'service unavailable (503)'}));
    });
    it('aborts stalled HTTP attempts and ends after the retry budget',async()=>{
        const signals=[];
        const request=({signal})=>{signals.push(signal);return new Promise(()=>{});};
        await expect(runGeminiRequest(request,{requestTimeoutMs:10,totalTimeoutMs:1000,maxAttempts:2,retryBaseDelayMs:0})).rejects.toThrow('timed out');
        expect(signals).toHaveLength(2);expect(signals.every(signal=>signal.aborted)).toBe(true);
    });
    it('does not wait beyond the total deadline for another retry',async()=>{
        const request=jest.fn().mockRejectedValue(Object.assign(new Error('busy'),{status:503}));
        await expect(runGeminiRequest(request,{totalTimeoutMs:10,retryBaseDelayMs:1000})).rejects.toThrow('deadline');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('does not retry invalid requests or authentication errors',async()=>{
        const request=jest.fn().mockRejectedValue(Object.assign(new Error('invalid request'),{status:400}));
        await expect(runGeminiRequest(request)).rejects.toThrow('invalid request');expect(request).toHaveBeenCalledTimes(1);
    });
    it('publishes waiting heartbeats and clears them after completion',async()=>{
        jest.useFakeTimers();let finish;const onWait=jest.fn();
        const result=runGeminiRequest(()=>new Promise(resolve=>{finish=resolve;}),{onWait});
        await jest.advanceTimersByTimeAsync(15000);
        expect(onWait).toHaveBeenCalledWith({attempt:1,maxAttempts:4,elapsedMs:15000});
        finish('done');await expect(result).resolves.toBe('done');
        await jest.advanceTimersByTimeAsync(15000);expect(onWait).toHaveBeenCalledTimes(1);
    });
});
