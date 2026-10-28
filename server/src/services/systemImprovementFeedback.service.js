const clean = (text, limit = 400) => String(text || '').replace(/\u001b\[[0-9;]*m/g,'').replace(/[a-z]:[\\/][^\s"'<>]+/gi,'[internal path]').slice(0,limit);

// Model feedback retains the failing action and rendered controls. The UI summary
// deliberately stays short and must not be reused as the repair context.
export const buildImprovementRepairFeedback = verification => {
    const summary = summarizeImprovementVerification(verification);
    if (!summary) return null;
    const failures = new Map();
    for (const run of verification.candidate.runs || []) for (const scenario of run.testRun?.scenarios || []) {
        if (!['failed','timedOut','flaky'].includes(scenario.status)) continue;
        const key = `${scenario.testFile}:${scenario.title}`;
        if (failures.has(key) || failures.size >= 3) continue;
        failures.set(key, {
            testFile: scenario.testFile, title: clean(scenario.title),
            message: clean((scenario.failureMessages || []).join('\n'), 3000),
            renderedControls: clean(scenario.domSnapshot, 6000),
            sourceSnippet: clean(scenario.failureCodeSnippet, 2000),
        });
    }
    return {...summary, failures: [...failures.values()]};
};
export const findPreviousImprovementVerification = async ({client,snapshotId,assessmentId,filePath,jobId}) => {
    const candidates = await client.systemTestProposal.findMany({where:{snapshotId,assessmentId,filePath,state:{in:['FAILED_VERIFICATION','NO_MEASURED_IMPROVEMENT']},jobId:{not:jobId}},select:{jobId:true}});
    if(!candidates.length)return null;
    // Proposals have no createdAt field. Chronology belongs to the associated Job.
    let ids=candidates.map(value=>value.jobId);
    while(ids.length) {
        const job = await client.job.findFirst({where:{snapshotId,id:{in:ids}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
        if(!job) return null;
        const record=await client.systemTestProposal.findFirst({where:{snapshotId,assessmentId,filePath,jobId:job.id,state:{in:['FAILED_VERIFICATION','NO_MEASURED_IMPROVEMENT']}},select:{verificationJson:true}});
        if(record?.verificationJson?.candidate)return record;
        ids=ids.filter(id=>id!==job.id);
    }
    return null;
};
export const summarizeImprovementVerification = verification => {
    if (!verification?.candidate) return null;
    const failures=new Map();
    for(const run of verification.candidate.runs || []) for(const scenario of run.testRun?.scenarios || []) if(['failed','timedOut'].includes(scenario.status)) {
        const key=`${scenario.testFile}:${scenario.title}`;
        const messages=scenario.failureMessages || [];
        const message=messages.find(value=>/locator\.|expect\(|Error:/.test(value)) || messages[0] || 'Scenario did not pass.';
        if(!failures.has(key) && failures.size<3) failures.set(key,{title:clean(scenario.title),message:clean(message.split('\n').slice(0,3).join(' '))});
    }
    const passed=verification.candidate.stability?.passedRuns ?? 0;
    const runs=verification.candidate.stability?.runs ?? verification.candidate.runs?.length ?? 0;
    const reasons = {NO_COVERAGE_GAIN:'The tests passed, but measured coverage did not increase.',COVERAGE_REGRESSION:'At least one measured coverage metric decreased.',INCOMPARABLE_MEASUREMENTS:'The measurements could not be compared consistently.',CANDIDATE_NOT_STABLE:'The updated suite did not pass both independent runs without skipped or flaky tests.',BASELINE_NOT_STABLE:'The existing suite did not pass both independent runs.'};
    const reason = reasons[verification.reasonCode] || (passed < runs ? 'The updated suite did not pass every independent run.' : verification.regression ? 'An existing passing scenario regressed or was missing.' : verification.comparison?.comparable === false ? 'The measurements could not be compared consistently.' : null);
    return {reason,reasonCode:verification.reasonCode,baselinePassedRuns:verification.baseline?.stability?.passedRuns ?? null,baselineRuns:verification.baseline?.stability?.runs ?? null,candidatePassedRuns:passed,candidateRuns:runs,failures:[...failures.values()],reasonCodes:verification.comparison?.reasonCodes || []};
};
