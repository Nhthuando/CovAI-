import {coverageGoal} from '../../../shared/systemImprovement.js';

export const prioritizeImprovementGaps = (report,{avoidIds=[]}={}) => {
    const attempted=new Set(avoidIds);
    const attemptedFiles=new Set((report.gaps || []).filter(gap=>attempted.has(gap.id)).map(gap=>gap.filePath).filter(Boolean));
    const goal=coverageGoal(report),groups=new Map();
    for(const gap of report.gaps || []) {
        const key=gap.filePath || gap.criterionId || gap.kind;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(gap);
    }
    const score=gap=>{
        const metric=gap.kind==='MEASURED_UNCOVERED_BRANCH'?'branches':gap.kind==='MEASURED_UNCOVERED_FUNCTION'?'functions':gap.kind==='MEASURED_UNCOVERED_STATEMENT'?'statements':'lines';
        return (attempted.has(gap.id)?1000:attemptedFiles.has(gap.filePath)?500:0)+(report.coverage?.tiers?.[gap.tier]?.counters?.[metric]?.pct ?? goal.lowestPct ?? 0);
    };
    const ordered=[...groups.values()].map(gaps=>gaps.sort((a,b)=>score(a)-score(b))).sort((a,b)=>score(a[0])-score(b[0]));
    const result=[];
    for(let index=0;result.length<20;index++) {
        const next=ordered.flatMap(gaps=>gaps[index]?[gaps[index]]:[]);
        if(!next.length)break;
        result.push(...next.slice(0,20-result.length));
    }
    return result;
};
