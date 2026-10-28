import {describe,it,expect} from '@jest/globals';
import {validateGeneratedTestCode} from '../validators/aiTestCode.validator.js';
import {validateSystemTestQuality} from '../services/systemTestQuality.service.js';

const scenario=(title='create task',operation='CREATE')=>`test('${title}',async({page})=>{
 await test.step('Setup: prerequisite',async()=>{await page.goto('/');});
 await test.step('Action: ${operation} - perform behavior',async()=>{await page.getByRole('button',{name:'Add'}).click();});
 await test.step('Assert: outcome',async()=>{await expect(page.getByText('task')).toBeVisible();});
 await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
 await test.step('Cleanup: remove prerequisite',async()=>{await page.getByRole('button',{name:'Delete'}).click();});
});`;
const validate=code=>validateSystemTestQuality(validateGeneratedTestCode(`import {test,expect} from '@playwright/test';${code}`).ast);
describe('atomic scenario quality',()=>{
 it('accepts separate create/delete scenarios with independent setup and evidence before cleanup',()=>{
  const result=validate(scenario()+scenario('delete task','DELETE'));
  expect(result.scenarios.map(test=>test.operation)).toEqual(['CREATE','DELETE']);
  expect(result.scenarios.every(test=>test.evidenceBeforeCleanup)).toBe(true);
 });
 it('rejects multiple primary actions and combined CRUD titles',()=>{
  expect(()=>validate(scenario().replace('Cleanup: remove prerequisite','Action: DELETE - delete'))).toThrow(/exactly one Action/);
  expect(()=>validate(scenario('add and delete task'))).toThrow(/combined CRUD/);
  expect(()=>validate(scenario('edit and cancel task','UPDATE'))).toThrow(/combined CRUD/);
 });
 it('requires a real outcome assertion and an actual screenshot attachment',()=>{
  expect(()=>validate(scenario().replace("await expect(page.getByText('task')).toBeVisible();","await page.title();"))).toThrow(/expectation/);
  expect(()=>validate(scenario().replace('await page.screenshot()',"'fake image'"))).toThrow(/PNG/);
  expect(()=>validate(scenario().replace("page.getByText('task')","true"))).toThrow(/constants/);
 });
 it('rejects cleanup before evidence',()=>{
  expect(()=>validate(scenario().replace('Assert: outcome','Cleanup: early').replace('Cleanup: remove prerequisite','Assert: late'))).toThrow(/phase order/);
 });
 it('rejects generic button position and conditional action fallbacks',()=>{
  expect(()=>validate(scenario().replace("page.getByRole('button',{name:'Add'})","page.locator('button').first()"))).toThrow(/global button/);
  expect(()=>validate(scenario().replace("await page.getByRole('button',{name:'Add'}).click();","if(await page.getByText('task').isVisible()) await page.getByText('task').click();"))).toThrow(/conditional/);
 });
});
