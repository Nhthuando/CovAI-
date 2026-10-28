import {jest,it,expect} from '@jest/globals';
const user={findUnique:jest.fn(),update:jest.fn()};
const tx={user,$queryRaw:jest.fn(async()=>[]),aiQuotaReservation:{findUnique:jest.fn(async()=>null)}};
await jest.unstable_mockModule('../config/prisma.js',()=>({default:{user,$transaction:async action=>action(tx)}}));
const {checkAndIncrementQuota}=await import('../services/aiQuota.service.js');
it('reports the application daily reset separately from Gemini quotas',async()=>{
    const originalZone=process.env.AI_QUOTA_TIMEZONE;
    process.env.AI_QUOTA_TIMEZONE='Asia/Ho_Chi_Minh';
    jest.useFakeTimers().setSystemTime(new Date('2026-10-14T09:00:00Z'));
    try {
        user.findUnique.mockResolvedValue({aiUsageDate:'2026-10-14',aiUsageCount:999999});
        await expect(checkAndIncrementQuota('owner')).rejects.toMatchObject({statusCode:429,code:'AI_APP_QUOTA_EXCEEDED',resetAt:'2026-10-14T17:00:00.000Z'});
        expect(user.update).not.toHaveBeenCalled();
    } finally {jest.useRealTimers();if(originalZone===undefined)delete process.env.AI_QUOTA_TIMEZONE;else process.env.AI_QUOTA_TIMEZONE=originalZone;}
});
