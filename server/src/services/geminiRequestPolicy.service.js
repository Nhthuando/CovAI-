const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
import { isDailyGeminiQuota } from '../utils/geminiQuota.js';
export const isDailyQuotaError = isDailyGeminiQuota;

export const runGeminiRequest = async (request, options = {}) => {
    const { requestTimeoutMs = 120000, totalTimeoutMs = 300000, maxAttempts = 4, onRetry, onWait, retryBaseDelayMs = 1000 } = options;
    const deadline = Date.now() + totalTimeoutMs;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Gemini request deadline exceeded. Retry this job later.');
        const controller = new AbortController();
        let timer, heartbeat;
        const started = Date.now();
        try {
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    const error = new Error('Gemini request timed out'); error.code = 'AI_REQUEST_TIMEOUT'; reject(error);
                }, Math.min(requestTimeoutMs, remaining));
            });
            if (onWait) heartbeat = setInterval(() => {
                Promise.resolve().then(() => onWait({attempt, maxAttempts, elapsedMs:Date.now()-started})).catch(() => {});
            }, 15000);
            return await Promise.race([request({signal:controller.signal, attempt}), timeout]);
        } catch (error) {
            clearTimeout(timer); clearInterval(heartbeat);
            const message = String(error.message || 'Unknown provider error');
            const status = error.status;
            const transient = error.code === 'AI_REQUEST_TIMEOUT' || status === 429 || status >= 500 || /429|503|fetch failed/.test(message);
            if (!transient || attempt === maxAttempts) throw error;
            const dailyQuota = isDailyQuotaError(error);
            const retrySeconds = message.match(/retry in ([\d.]+)s/i)?.[1];
            const waitMs = dailyQuota ? 0 : retrySeconds ? Math.min((Number(retrySeconds)+1)*1000,45000) : Math.min(retryBaseDelayMs*2**attempt,10000);
            if (Date.now()+waitMs >= deadline) throw new Error('Gemini request deadline exceeded. Retry this job later.');
            const reason = error.code === 'AI_REQUEST_TIMEOUT' ? 'request timeout' : status === 429 || /429/.test(message) ? 'rate limit (429)' : status === 503 || /503/.test(message) ? 'service unavailable (503)' : 'provider connection error';
            console.warn(`[Gemini API] ${reason}; retry ${attempt+1}/${maxAttempts} in ${waitMs}ms`);
            await onRetry?.({attempt:attempt+1,maxAttempts,waitMs,reason});
            await sleep(waitMs);
        } finally { clearTimeout(timer); clearInterval(heartbeat); }
    }
    throw new Error('Gemini retry attempts exhausted');
};
