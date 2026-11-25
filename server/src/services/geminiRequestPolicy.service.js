const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
import { isDailyGeminiQuota } from '../utils/geminiQuota.js';
export const isDailyQuotaError = isDailyGeminiQuota;

const parseDurationSeconds = value => {
    const match = String(value ?? '').match(/^\s*([\d.]+)\s*s?\s*$/i);
    return match ? Number(match[1]) : null;
};

/** Reads a provider-suggested retry delay: structured RetryInfo first, then "retry in Ns" text. */
export const providerRetrySeconds = error => {
    const details = Array.isArray(error?.errorDetails) ? error.errorDetails : [];
    for (const detail of details) {
        if (String(detail?.['@type'] || '').endsWith('RetryInfo')) {
            const seconds = parseDurationSeconds(detail.retryDelay);
            if (Number.isFinite(seconds)) return seconds;
        }
    }
    const fromMessage = String(error?.message || '').match(/retry in ([\d.]+)s/i)?.[1];
    return fromMessage ? Number(fromMessage) : null;
};

/**
 * Wait before the next attempt. baseMs scales the backoff (1000 = production;
 * 0 in tests disables waiting except for an explicit provider-suggested delay).
 * - per-minute 429: provider delay + 1 s, else 5 s, 10 s, 20 s… (cap 45 s)
 * - 5xx / timeout / connection: 2 s, 4 s, 8 s… (cap 20 s)
 * plus up to 1 s of jitter (scaled).
 */
export const computeRetryDelayMs = (error, attempt, baseMs = 1000, random = Math.random) => {
    const scale = Math.max(0, Number(baseMs) || 0) / 1000;
    const message = String(error?.message || '');
    const isRateLimit = error?.status === 429 || /429/.test(message);
    const jitter = Math.round(random() * 1000 * scale);
    if (isRateLimit) {
        const suggested = providerRetrySeconds(error);
        if (Number.isFinite(suggested)) return Math.min((suggested + 1) * 1000, 45000) + jitter;
        return Math.min(5000 * scale * 2 ** (attempt - 1), 45000) + jitter;
    }
    return Math.min(2000 * scale * 2 ** (attempt - 1), 20000) + jitter;
};

export const runGeminiRequest = async (request, options = {}) => {
    const { requestTimeoutMs = 120000, totalTimeoutMs = 300000, maxAttempts = 4, onRetry, onWait, retryBaseDelayMs = 1000, getFallbackRequest } = options;
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
            if (!transient || attempt === maxAttempts) {
                const remainingMs = deadline - Date.now();
                const fallback = !controller.signal.aborted && remainingMs > 0 && getFallbackRequest?.(error);
                if (fallback) {
                    const fallbackAttempts = remainingMs > 15000 ? Math.min(Math.max(1, maxAttempts), 2) : 1;
                    return runGeminiRequest(fallback, { requestTimeoutMs, totalTimeoutMs: remainingMs, maxAttempts: fallbackAttempts, onRetry, onWait, retryBaseDelayMs, getFallbackRequest });
                }
                throw error;
            }
            if (isDailyQuotaError(error)) {
                // A daily quota cannot recover within this request; retrying only burns another quota unit.
                console.warn('[Gemini API] daily quota exhausted; not retrying');
                throw error;
            }
            const waitMs = computeRetryDelayMs(error, attempt, retryBaseDelayMs);
            if (Date.now()+waitMs >= deadline) throw new Error('Gemini request deadline exceeded. Retry this job later.');
            const reason = error.code === 'AI_REQUEST_TIMEOUT' ? 'request timeout' : status === 429 || /429/.test(message) ? 'rate limit (429)' : status === 503 || /503/.test(message) ? 'service unavailable (503)' : 'provider connection error';
            console.warn(`[Gemini API] ${reason}; retry ${attempt+1}/${maxAttempts} in ${waitMs}ms`);
            await onRetry?.({attempt:attempt+1,maxAttempts,waitMs,reason});
            await sleep(waitMs);
        } finally { clearTimeout(timer); clearInterval(heartbeat); }
    }
    throw new Error('Gemini retry attempts exhausted');
};
