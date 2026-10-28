import { ServiceError } from './serviceError.js';

export const nextMidnight = (timeZone, now = new Date()) => {
    const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const today = parts(now), target = Date.UTC(today.year,today.month-1,today.day+1);
    let guess = target;
    for(let index=0;index<4;index++) {const local=parts(new Date(guess));guess += target-Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute,local.second);}
    return new Date(guess);
};
export const quotaDetailsText = error => `${error.message || ''} ${JSON.stringify(error.errorDetails || error.details || [])}`;
export const isDailyGeminiQuota = error => /PerDay|per[_ -]?day|daily quota/i.test(quotaDetailsText(error));
export const geminiQuotaError = (error, model, now = new Date()) => {
    const daily = isDailyGeminiQuota(error);
    const details = error.errorDetails || error.details || [];
    const retry = Array.isArray(details) ? details.find(item=>item['@type']?.endsWith('RetryInfo'))?.retryDelay : null;
    const seconds = retry?.match(/^(\d+(?:\.\d+)?)s$/)?.[1] || String(error.message || '').match(/retry in (\d+(?:\.\d+)?)s/i)?.[1];
    const resetAt = daily ? nextMidnight('America/Los_Angeles',now).toISOString() : null;
    const retryAt = !daily && seconds ? new Date(now.getTime()+Number(seconds)*1000).toISOString() : null;
    const format = date => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'medium'}).format(new Date(date));
    const result = new ServiceError(`${model} has reached its ${daily ? 'daily' : 'request/token'} quota. ${resetAt ? `Daily quota resets at ${format(resetAt)} (UTC+7).` : retryAt ? `The provider says to retry after ${format(retryAt)} (UTC+7). This is a retry time, not a full quota reset.` : 'The provider has not supplied a reset time. Check Google AI Studio for quota details.'}`,429);
    Object.assign(result,{code:'AI_QUOTA_EXCEEDED',model,quotaPeriod:daily?'day':'unknown',resetAt,retryAt});
    return result;
};
