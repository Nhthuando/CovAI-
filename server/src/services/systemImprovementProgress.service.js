import { IMPROVEMENT_LIMITS as limits } from '../../../shared/systemImprovement.js';
import { improvementFailure } from './systemImprovementFailure.service.js';
export const improvementTiming = ({ job, history = [], now = Date.now() }) => {
    const started = job.startedAt ? new Date(job.startedAt).getTime() : null;
    const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now;
    const elapsedMs = started ? Math.max(0,end-started) : 0;
    const durations = history.map(item => item.computeTimeMs ?? (item.finishedAt && item.startedAt ? new Date(item.finishedAt)-new Date(item.startedAt) : null))
        .filter(value => Number.isFinite(value) && value > 0).sort((a,b)=>a-b);
    let remaining = null;
    let estimateBasis = 'HISTORY';
    if (job.status === 'RUNNING' && started && durations.length >= 3) {
        const low = durations[Math.floor((durations.length-1)*0.25)] * 0.8;
        const high = durations[Math.ceil((durations.length-1)*0.75)] * 1.3;
        if (elapsedMs < high) remaining = { minMs:Math.max(60000,low-elapsedMs), maxMs:Math.max(60000,high-elapsedMs) };
    }
    // First-time projects can learn from actual completed independent runs.
    // The upper bound includes all remaining candidate/repair rounds, capped
    // by the worker budget. Stage percentages are never interpreted as time.
    if (!remaining && job.status === 'RUNNING' && started && durations.length < 3) {
        const starts = new Map(), measured = [];
        const logs = [...(job.logs || [])].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
        for (const entry of logs) {
            const start = entry.message.match(/^(.*): Preparing independent run (\d+)\/2$/);
            const finish = entry.message.match(/^(.*): Run (\d+)\/2: collecting runtime coverage and assertion results$/);
            if (start) starts.set(`${start[1]}:${start[2]}`,new Date(entry.createdAt).getTime());
            if (finish) {
                const from = starts.get(`${finish[1]}:${finish[2]}`), to = new Date(entry.createdAt).getTime();
                if (Number.isFinite(from) && to > from) measured.push(to-from);
            }
        }
        if (measured.length && elapsedMs < limits.timeLimitMs) {
            const perRun = measured.reduce((sum,value)=>sum+value,0)/measured.length;
            const budgetLeft = limits.timeLimitMs-elapsedMs;
            remaining = {minMs:Math.min(budgetLeft,Math.max(30000,perRun*0.7)),maxMs:Math.min(budgetLeft,Math.max(60000,perRun*1.5*Math.max(2,2+limits.maxRounds*4-measured.length)))};
            estimateBasis = 'OBSERVED_RUNS';
        }
    }
    if(remaining){const left=limits.timeLimitMs-elapsedMs;remaining=left>0?{minMs:Math.min(remaining.minMs,left),maxMs:Math.min(remaining.maxMs,left)}:null;}
    return {sampledAt:new Date(now).toISOString(),startedAt:job.startedAt || null,finishedAt:job.finishedAt || null,elapsedMs,remaining,
        samples:durations.length,estimateBasis,estimateStatus:remaining ? 'ESTIMATED' : job.status === 'QUEUED' ? 'QUEUED' : !['QUEUED','RUNNING'].includes(job.status) ? 'COMPLETE' : durations.length < 3 ? 'LEARNING' : 'OVERRUN'};
};

export const proposalProgress = async ({ client, record, snapshotId }) => {
    if (!record) return null;
    const job = await client.job?.findUnique({where:{id:record.jobId},select:{
        status:true,progress:true,startedAt:true,finishedAt:true,createdAt:true,
        logs:{where:{message:{startsWith:'Improvement stage: '}},orderBy:{createdAt:'desc'},take:100,select:{message:true,createdAt:true}},
    }});
    const history = job?.status === 'RUNNING' && client.job.findMany ? await client.job.findMany({
        where:{snapshotId,type:'SYSTEM_TEST_IMPROVEMENT',status:'SUCCESS',id:{not:record.jobId}},
        orderBy:{createdAt:'desc'},take:20,select:{computeTimeMs:true,startedAt:true,finishedAt:true},
    }) : [];
    const stopped = job?.status === 'CANCELED' && !['APPLIED','RECOVERY_REQUIRED'].includes(record.state)
        || job?.status === 'FAILED' && ['DRAFT','QUEUED','VERIFYING','VERIFIED_IMPROVEMENT'].includes(record.state);
    const legacyTimeout = record.state === 'STALE' && /canceled|resource budget|time limit/i.test(record.verificationJson?.error?.message || '');
    const exhaustedBudget = job?.startedAt && job?.finishedAt && new Date(job.finishedAt)-new Date(job.startedAt) >= limits.timeLimitMs;
    const normalized = legacyTimeout ? {...record,state:'FAILED_VERIFICATION',verificationJson:{...record.verificationJson,error:{...record.verificationJson.error,code:exhaustedBudget?'SYSTEM_OPERATION_TIMEOUT':'SYSTEM_OPERATION_INTERRUPTED',message:exhaustedBudget?'The improvement reached its 20-minute time limit. No unverified tests were saved. Try again to continue targeting uncovered code.':'The improvement stopped before verification could finish. No unverified tests were saved. Try again to continue targeting uncovered code.'}}} : record;
    // Older workers interpreted every service's HTTP 408 as the global AI deadline.
    // Normalize their presentation without changing their recorded audit evidence.
    const error=normalized.verificationJson?.error;
    const runtimeFailure=error && /^SYSTEM_RUNTIME_/.test(error.code || '');
    const corrected=runtimeFailure && ['FAILED','SUCCESS'].includes(job?.status)
        ? {...normalized,state:'FAILED_VERIFICATION',verificationJson:{...normalized.verificationJson,goal:normalized.verificationJson?.goal?{...normalized.verificationJson.goal,stopReason:improvementFailure(error).stopReason}:undefined}}
        : normalized;
    return {...corrected,...(stopped ? {state:job.status === 'CANCELED' ? 'CANCELED' : 'FAILED_VERIFICATION'} : {}),
        jobStatus:job?.status,jobProgress:job?.progress ?? 0,
        jobStage:job?.logs?.[0]?.message?.replace(/^Improvement stage: /,''),
        timing:job ? improvementTiming({job,history}) : null};
};
