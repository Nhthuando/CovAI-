import {describe,it,expect} from '@jest/globals';
import {createSystemTestAnalysisJob,createAiTestsJob} from '../services/job.service.js';

describe('public system-test execution policy',()=>{
  it('rejects invalid execution modes before creating or querying a job',()=>{
    expect(()=>createSystemTestAnalysisJob({executionMode:'invalid'})).toThrow(/frontend or full/);
  });
  it('rejects frontend-only Gemini system-test generation',async()=>{
    await expect(createAiTestsJob({mode:'PLAYWRIGHT_E2E',executionMode:'frontend'})).rejects.toThrow(/full-system/);
  });
  it('rejects unsupported system-test runners explicitly',()=>{
    expect(()=>createSystemTestAnalysisJob({runner:'selenium'})).toThrow(/playwright or cypress/);
  });
});
