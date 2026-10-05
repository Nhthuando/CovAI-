import {describe,it,expect} from '@jest/globals';
import {createSystemTestAnalysisJob,createAiTestsJob} from '../services/job.service.js';

describe('public system-test execution policy',()=>{
  it('rejects frontend-only jobs before creating or querying a job',()=>{
    expect(()=>createSystemTestAnalysisJob({executionMode:'frontend'})).toThrow(/full-system/);
  });
  it('rejects frontend-only Gemini system-test generation',async()=>{
    await expect(createAiTestsJob({mode:'PLAYWRIGHT_E2E',executionMode:'frontend'})).rejects.toThrow(/full-system/);
  });
  it('rejects unsupported full-system runners explicitly',()=>{
    expect(()=>createSystemTestAnalysisJob({runner:'cypress'})).toThrow(/requires Playwright/);
  });
});
