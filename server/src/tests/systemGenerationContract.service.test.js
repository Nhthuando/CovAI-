import {it,expect} from '@jest/globals';
import {parseSystemGenerationResponse} from '../services/systemGenerationContract.service.js';
import {systemTestPromptRules} from '../services/systemTestPrompt.service.js';
const scenario={id:'account',title:'Account opens',criterionIds:['ACCOUNT'],preconditions:[],inputs:[],actions:['Open account'],expected:['Account is visible'],sourceReferences:['Account.tsx']};
const options={titles:['Account opens'],requirements:{criteria:[{id:'ACCOUNT'}]},sourcePaths:['Account.tsx']};
it('keeps code-only output unreviewed and validates source-backed metadata identities',()=>{
    expect(parseSystemGenerationResponse('{"content":"code"}',options).metadataStatus).toBe('CODE_ONLY');
    expect(parseSystemGenerationResponse(JSON.stringify({scenarios:[scenario]}),options).metadataStatus).toBe('DRAFT');
    expect(()=>parseSystemGenerationResponse(JSON.stringify({scenarios:[{...scenario,criterionIds:['INVENTED']}]}),options)).toThrow('unconfirmed');
    expect(()=>parseSystemGenerationResponse(JSON.stringify({scenarios:[{...scenario,expected:['Visible']}]}),options)).toThrow('resulting state');
    expect(()=>parseSystemGenerationResponse(JSON.stringify({scenarios:[{...scenario,sourceReferences:['missing.tsx']}]}),options)).toThrow('unavailable');
});
it('keeps Full Stack rules real and Cypress syntax independent from Playwright',()=>{
    expect(systemTestPromptRules({executionMode:'full'})).toContain('Do not mock/intercept');
    expect(systemTestPromptRules({framework:'cypress',executionMode:'full'})).toContain('Do not invent backend origins');
    expect(systemTestPromptRules({framework:'cypress'})).not.toContain('test.step(');
});
