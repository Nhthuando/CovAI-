const RATE_LIMIT_TEXT = /\b429\b|RESOURCE_EXHAUSTED|too many requests|rate.?limit|quota/i;
const PER_MINUTE = /per\s?minute|RPM\b/i;
const PER_DAY = /per\s?day|daily/i;
const QUOTA_EXHAUSTED = /limit:\s*0\b|insufficient_quota|billing (hard )?limit|billing not active/i;
const TRANSIENT_TEXT = /503|high demand|overloaded|UNAVAILABLE|temporarily|fetch failed|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|other side closed|UND_ERR_|network (error|timeout)|connect timeout/i;
const BACKOFF_MS = [20_000, 40_000, 60_000, 60_000];

export function classifyTargetFailure(error) {
    const code = error?.code;
    const status = error?.details?.targetStatus;
    const text = [error?.message, error?.targetBody].join('\n');

    if (code === 'TARGET_RATE_LIMIT' || (code === 'TARGET_HTTP_ERROR' && status >= 400 && RATE_LIMIT_TEXT.test(text))) {
        const perMinute = PER_MINUTE.test(text);
        const daily = PER_DAY.test(text) || (!perMinute && QUOTA_EXHAUSTED.test(text));
        const seconds = text.match(/"retryDelay\\*"\s*:\s*\\*"(\d+(?:\.\d+)?)s/i)
            ?? text.match(/retry in (\d+(?:\.\d+)?)\s*s\b/i);
        const tryAgain = seconds ? null : text.match(/try again in (\d+(?:\.\d+)?)\s*(ms|s|m)\b/i);
        const unitMs = { ms: 1, s: 1000, m: 60_000 };
        const retryAfterMs = seconds ? Number(seconds[1]) * 1000
            : tryAgain ? Number(tryAgain[1]) * unitMs[tryAgain[2].toLowerCase()] : null;
        const quota = perMinute ? Number(text.match(/"quotaValue\\*"\s*:\s*(?:\\*")?(\d+(?:\.\d+)?)/i)?.[1]) : null;
        const intervalMs = quota > 0 ? Math.min(30_000, Math.max(250, Math.ceil(60_000 / quota * 1.15))) : null;
        return { kind: daily ? 'DAILY_QUOTA' : 'RATE_LIMIT', retryAfterMs, intervalMs };
    }

    const transient = code === 'TARGET_CONNECTION_ERROR'
        || (code === 'TARGET_HTTP_ERROR' && status >= 500 && TRANSIENT_TEXT.test(text));
    return { kind: transient ? 'TRANSIENT' : 'OTHER', retryAfterMs: null, intervalMs: null };
}

export function createTargetPacer({
    sleep, now = Date.now, defaultIntervalMs = 4500, maxWaitMs = 65_000, maxTotalWaitMs = 15 * 60_000,
}) {
    let cooldownUntil = 0;
    let nextSlot = 0;
    let lastDispatch = -Infinity;
    let interval = null;
    let totalWaitMs = 0;
    let dailyQuotaError = null;
    const dailyQuota = new AbortController();

    return {
        async beforeRequest(signal) {
            signal?.throwIfAborted();
            if (dailyQuotaError) throw dailyQuotaError;
            if (interval === null) return;
            const waitSignal = signal ? AbortSignal.any([signal, dailyQuota.signal]) : dailyQuota.signal;
            let slot = null;
            for (;;) {
                const time = now();
                if (slot === null || slot < cooldownUntil) slot = Math.max(time, cooldownUntil, nextSlot);
                slot = Math.max(slot, lastDispatch + interval);
                nextSlot = Math.max(nextSlot, slot + interval);
                if (slot > time) await sleep(slot - time, waitSignal);
                signal?.throwIfAborted();
                if (dailyQuotaError) throw dailyQuotaError;
                if (slot >= cooldownUntil && slot >= lastDispatch + interval) {
                    lastDispatch = Math.max(slot, now());
                    return;
                }
            }
        },
        onRateLimit({ retryAfterMs, intervalMs }, retry) {
            const time = now();
            const backoff = retryAfterMs != null ? retryAfterMs + 1500 : BACKOFF_MS[retry];
            const wait = Math.min(maxWaitMs, Math.max(2000, backoff));
            const until = Math.max(cooldownUntil, time + wait);
            const addedWait = Math.max(0, until - Math.max(cooldownUntil, time));
            if (totalWaitMs + addedWait > maxTotalWaitMs) return false;
            totalWaitMs += addedWait;
            cooldownUntil = until;
            interval = intervalMs ?? interval ?? defaultIntervalMs;
            return true;
        },
        onDailyQuota(error) {
            dailyQuotaError ??= error;
            dailyQuota.abort(dailyQuotaError);
        },
        get dailyQuotaError() { return dailyQuotaError; },
        get totalWaitMs() { return totalWaitMs; },
        get waitingUntil() { return cooldownUntil; },
    };
}
