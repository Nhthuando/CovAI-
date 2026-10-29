import {it,expect} from '@jest/globals';
import {improvementFailure} from '../services/systemImprovementFailure.service.js';
it.each([
    [{code:'SYSTEM_RUNTIME_START_FAILED',statusCode:408},'SETUP_FAILED','FAILED_VERIFICATION'],
    [{code:'SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE',statusCode:503},'SETUP_FAILED','FAILED_VERIFICATION'],
    [{code:'SYSTEM_OPERATION_TIMEOUT',statusCode:408},'TIME_LIMIT','FAILED_VERIFICATION'],
    [{code:'SYSTEM_TEST_ENVIRONMENT_REQUIRED',statusCode:422},'ENVIRONMENT_REQUIRED','FAILED_VERIFICATION'],
    [{statusCode:408},'VERIFICATION_FAILED','FAILED_VERIFICATION'],
    [{code:'AI_QUOTA_EXCEEDED',statusCode:429},'PROVIDER_LIMIT','PROVIDER_UNAVAILABLE'],
    [{statusCode:409,message:'Assessment is stale'},'SOURCE_CHANGED','STALE'],
])('classifies %j by its actual cause', (error,stopReason,state)=>{
    expect(improvementFailure(error)).toEqual({stopReason,state});
});
