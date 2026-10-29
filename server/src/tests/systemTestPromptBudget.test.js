import {it,expect} from '@jest/globals';
import {focusTestContext,buildBudgetedTestPrompt} from '../services/systemTestPromptBudget.service.js';
it('keeps complete gap source and its imported helpers ahead of unrelated source',()=>{
    const sourceCode=[{path:'client/Unrelated.jsx',content:'u'.repeat(200)},{path:'client/Target.jsx',content:"import helper from './helper';\nexport const target=helper;"},{path:'client/helper.js',content:'export default true;'}];
    const result=focusTestContext({sourceCode,omittedFiles:['missing.js']},JSON.stringify({gaps:[{filePath:'client/Target.jsx',line:2}]}),100);
    expect(result.sourceCode.map(file=>file.path)).toEqual(['client/Target.jsx','client/helper.js']);
    expect(result.omittedFiles).toEqual(expect.arrayContaining(['missing.js','client/Unrelated.jsx']));
    expect(result.sourceCode[0].content).toBe(sourceCode[1].content);
});
it('deduplicates context and bounds gaps without dropping the existing test',()=>{
    const existingCode="import {test,expect} from '@playwright/test';test('old',async()=>{});";
    const context={configuration:{},sourceCode:[{path:'server/route.js',content:'export const route=1;'}],omittedFiles:[],routes:Array(100).fill('duplicated derived context')};
    const result=buildBudgetedTestPrompt({context,existingCode,filePath:'tests/app.spec.js',mode:'BOOST_COVERAGE',instruction:JSON.stringify({gaps:Array.from({length:20},(_,line)=>({filePath:'server/route.js',line}))})});
    const prompt=JSON.parse(result.prompt);
    expect(prompt.existingCode).toBe(existingCode);
    expect(prompt.routes).toBeUndefined();
    expect(JSON.parse(prompt.instruction).gaps).toHaveLength(2);
    expect(prompt.sourceCode).toHaveLength(1);
});
it('handles a legacy null instruction without changing the available source',()=>{
    expect(focusTestContext({sourceCode:[{path:'app.js',content:'export const app=true;'}]},null).sourceCode).toHaveLength(1);
});
