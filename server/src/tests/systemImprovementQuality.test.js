import {it,expect} from '@jest/globals';
import {validateAdditionalTestQuality,preserveTestIntent} from '../services/systemTestStaticAnalysis.service.js';
const before="import {test,expect} from '@playwright/test';test('legacy smoke',async({page})=>{await page.goto('/');});";
it('accepts awaited negated web assertions and preserves their expected outcomes',()=>{
    const code=before+"test('delete',async({page})=>{await page.getByRole('button',{name:'Delete'}).click();await expect(page.getByText('Removed task')).not.toBeVisible();});";
    expect(validateAdditionalTestQuality(before,code,'app.spec.js').addedAssertions).toBe(1);
    expect(()=>preserveTestIntent(code,code.replace('.not.toBeVisible()', '.toBeVisible()'),'app.spec.js','FIX_BREAKPOINT')).toThrow('assertion');
});
it.each([
    "const response=await request.put('/todos/missing',{data:{title:'Missing'}});expect(response.status()).toBe(404);",
    "const response=await request.get('/todos');const body=await response.json();expect(body).toEqual([]);",
    "expect((await request.get('/todos/missing')).status()).toBe(404);",
    "const response=await page.request.get('/todos/missing');expect(response.status()).not.toBe(200);",
])('accepts synchronous checks of actual API responses: %s',body=>{
    expect(validateAdditionalTestQuality(before,before+`test('api',async({request,page})=>{${body}});`,'app.spec.js').addedAssertions).toBe(1);
});
it.each([
    "const response={status:()=>404};expect(response.status()).toBe(404);",
    "expect(request.get('/todos')).toBeDefined();",
    "const response=await request.get('/todos');expect(response.json()).toBeDefined();",
    "const response=await request.get('/todos');response=404;expect(response).toBe(404);",
])('does not treat fabricated or unresolved values as API outcome evidence: %s',body=>{
    expect(()=>validateAdditionalTestQuality(before,before+`test('api',async({request})=>{${body}});`,'app.spec.js')).toThrow();
});
it('allows a checkbox in a title-filtered row without treating it as a mutable edit textbox',()=>{
    const code=before+"test('toggle',async({page})=>{const row=page.locator('.group',{hasText:'Task'});await row.locator('input[type=checkbox]').check();await expect(row.getByRole('checkbox')).toBeChecked();});";
    expect(validateAdditionalTestQuality(before,code,'app.spec.js').addedAssertions).toBe(1);
});
it.each([
    "await page.goto('/');",
    "await expect(page.locator('body')).toBeVisible();",
    "if(await page.getByText('Save').isVisible())await page.getByText('Save').click();await expect(page.getByText('Saved')).toBeVisible();",
    "if(true){await expect(page.getByText('Saved')).toBeVisible();}",
    "await page.waitForTimeout(100);await expect(page.getByText('Saved')).toBeVisible();",
    "expect(page.getByText('Saved')).toBeVisible();",
    "await expect([]).toEqual([]);",
    "await expect({}).toEqual({});",
    "await expect(page.getByText('Saved')).toBeVisible().catch(()=>{});",
    "const row=page.locator('.group',{hasText:'Old title'});await row.locator('input').fill('New title');await expect(page.getByText('New title')).toBeVisible();",
    "await page.locator('.group',{hasText:'Old title'}).locator('input').fill('New title');await expect(page.getByText('New title')).toBeVisible();",
    "await page.locator('button.hover:text-purple-400').click();await expect(page.getByText('Saved')).toBeVisible();",
])('rejects additions without reliable outcome checks: %s',body=>{
    expect(()=>validateAdditionalTestQuality(before,before+`test('new',async({page})=>{${body}});`,'app.spec.js')).toThrow();
});
it('requires an outcome assertion for each addition without changing requirements for legacy scenarios',()=>{
    const code=before+"test('save',async({page})=>{await test.step('assert',async()=>{await expect(page.getByText('Saved')).toBeVisible();});});";
    expect(validateAdditionalTestQuality(before,code,'app.spec.js')).toEqual({addedScenarios:['save'],addedAssertions:1});
    expect(()=>validateAdditionalTestQuality(before,code+"test('empty',async()=>{});",'app.spec.js')).toThrow('empty');
});
it('accepts a stable form reacquired independently of mutable row text',()=>{
    const code=before+"test('edit',async({page})=>{const row=page.locator('.group',{hasText:'Old title'});await row.locator('button.edit').click();const form=page.locator('.group form');await form.locator('input').fill('New title');await form.locator('button[type=submit]').click();await expect(page.getByText('New title')).toBeVisible();});";
    expect(validateAdditionalTestQuality(before,code,'app.spec.js').addedScenarios).toEqual(['edit']);
});
it('cannot repair by removing an assertion duplicated in another scenario or by adding scenarios',()=>{
    const assertion="await expect(page.getByText('Saved')).toBeVisible();";
    const candidate="import {test,expect} from '@playwright/test';"+`test('one',async({page})=>{${assertion}});test('two',async({page})=>{${assertion}});`;
    expect(()=>preserveTestIntent(candidate,candidate.replace(`test('two',async({page})=>{${assertion}});`,"test('two',async({page})=>{});"),'app.spec.js','FIX_BREAKPOINT')).toThrow('every scenario assertion');
    expect(()=>preserveTestIntent(candidate,candidate+"test('extra',async()=>{});",'app.spec.js','FIX_BREAKPOINT')).toThrow('cannot add or remove');
});
