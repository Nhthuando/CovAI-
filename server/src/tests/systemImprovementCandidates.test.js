import {it,expect} from '@jest/globals';
import {retainValidAdditionalTests,retainPassedAdditionalTests} from '../services/systemImprovementCandidates.service.js';
const before="import {test,expect} from '@playwright/test';test('original',async({page})=>{await expect(page.getByText('Original')).toBeVisible();});";
const good="test('api',async({request})=>{const r=await request.post('/items',{data:{}});expect(r.status()).toBe(400);});";
const bad="test('broken edit',async({page})=>{const row=page.locator('.row',{hasText:'Old'});await row.locator('input').fill('New');await expect(page.getByText('New')).toBeVisible();});";
it('retains valid independent additions when another experimental test is invalid',()=>{
    const result=retainValidAdditionalTests(before,before+good+bad,'app.spec.js');
    expect(result.content).toBe(before+good);expect(result.quality.addedScenarios).toEqual(['api']);
    expect(result.rejected.map(s=>s.title)).toEqual(['broken edit']);
});
it('rejects a wholly invalid batch and never removes an original test or changed hook',()=>{
    expect(()=>retainValidAdditionalTests(before,before+bad,'app.spec.js')).toThrow('text-filtered');
    expect(()=>retainValidAdditionalTests(before,before.replace('Original','Changed')+good,'app.spec.js')).toThrow();
    expect(()=>retainValidAdditionalTests(before,before+good+'test.beforeEach(()=>{});','app.spec.js')).toThrow('infrastructure');
});
it('keeps only observed passing additions for subsequent independent re-verification',()=>{
    const report={runs:[{testRun:{scenarios:[{title:'original',testFile:'app.spec.js',status:'passed'},{title:'api',testFile:'app.spec.js',status:'passed'},{title:'broken edit',testFile:'app.spec.js',status:'failed'}]}}]};
    expect(retainPassedAdditionalTests(before,before+good+bad,'app.spec.js',report).content).toBe(before+good);
    report.runs.push({testRun:{scenarios:[{title:'api',testFile:'app.spec.js',status:'failed'}]}});
    expect(retainPassedAdditionalTests(before,before+good+bad,'app.spec.js',report)).toBeNull();
});
