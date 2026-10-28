export const IMPROVEMENT_LIMITS = Object.freeze({target:95,milestone:90,maxRounds:8,maxRequests:12,maxNoGainRounds:3,timeLimitMs:20*60000,finishReserveMs:2*60000});
export const COVERAGE_METRICS = ['lines','branches','functions','statements'];

export const coverageGoal = report => {
    const metrics=[],unmeasured=[];
    const configured=report?.input?.coverageScope;
    for(const tier of ['frontend','backend']) {
        const measurement=report?.coverage?.tiers?.[tier];
        if(configured && !configured[tier])continue;
        if(!measurement) {if(configured?.[tier])unmeasured.push(tier);continue;}
        if(measurement.status!=='MEASURED') {unmeasured.push(tier);continue;}
        for(const metric of COVERAGE_METRICS) {
            const value=measurement.counters?.[metric];
            if(value?.total===0)continue;
            if(!value || !Number.isFinite(value.pct) || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.covered) || value.total<0 || value.covered<0 || value.covered>value.total) {unmeasured.push(`${tier}.${metric}`);continue;}
            metrics.push({tier,metric,pct:value.pct,rawPct:value.covered*100/value.total});
        }
    }
    const lowest=metrics.length?Math.min(...metrics.map(value=>value.rawPct)):null;
    const lowestPct=lowest===null?null:Number(lowest.toFixed(2));
    const complete=metrics.length>0 && !unmeasured.length;
    return {target:IMPROVEMENT_LIMITS.target,milestone:IMPROVEMENT_LIMITS.milestone,lowestPct,metrics,unmeasured,
        reached:complete && lowest>=IMPROVEMENT_LIMITS.target,milestoneReached:complete && lowest>=IMPROVEMENT_LIMITS.milestone};
};
