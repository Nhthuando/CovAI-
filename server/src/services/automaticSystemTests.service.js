import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createAssessmentWorkspace,snapshotIdentity} from './systemAssessmentWorkspace.service.js';
import {containedPath,readFullSystemConfig} from './fullSystemConfig.service.js';
import {generateVerifiedSystemTests} from './verifiedSystemGeneration.service.js';
import {observeSystemApplication} from './systemGenerationContext.service.js';
import {runSystemTests} from './systemTestRunner.service.js';
import {createAiJobBudget,withAiJobBudget,currentAiJobBudget} from './aiJobBudget.service.js';
import {ServiceError} from '../utils/serviceError.js';

export const prepareMissingSystemTests = async ({rootDir,jobId,model,signal,onProgress=async()=>{},dependencies={}}) => {
    const checkpoint=()=>{if(signal?.aborted)throw new ServiceError('Automatic test preparation canceled',409);};
    checkpoint();
    const before=snapshotIdentity(rootDir),workspace=createAssessmentWorkspace({rootDir});
    try {
        await onProgress(29,'No compatible Full Stack tests exist; generating and verifying source-based tests automatically');
        const budget=currentAiJobBudget() || createAiJobBudget({maxRequests:6,signal});
        const result=await withAiJobBudget(budget,()=> (dependencies.generateTests || generateVerifiedSystemTests)({rootDir:workspace.rootDir,jobId,model,onProgress:async(progress,message)=>{checkpoint();await onProgress(Math.min(29,progress),message);},dependencies:{
            observe:options=>observeSystemApplication({...options,environmentRoot:rootDir,signal}),
            run:options=>runSystemTests({...options,environmentRoot:rootDir,signal}),
        }}));
        checkpoint();
        if(result.failed || result.verificationRuns!==2 || !result.code?.trim())throw new ServiceError(result.error || 'Automatically generated tests could not pass two independent runs; original test files remain unchanged',422);
        const now=snapshotIdentity(rootDir);
        if(now.sourceHash!==before.sourceHash || now.testHash!==before.testHash)throw new ServiceError('Project changed during automatic test preparation; retry against the current source',409);
        const config=readFullSystemConfig(rootDir);
        const hash=crypto.createHash('sha256').update(result.code).digest('hex').slice(0,12);
        const relative=path.posix.join(config.frontend.directory,'tests/e2e',`covai-auto-full-${hash}.spec.mjs`);
        const target=containedPath(rootDir,relative);
        fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,result.code,{flag:'wx'});
        return {filePath:relative,verificationRuns:2,scenarioCount:result.scenarioCount,aiUsage:budget.snapshot()};
    } finally{workspace.release();}
};
