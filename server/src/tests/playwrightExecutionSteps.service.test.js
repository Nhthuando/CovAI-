import { describe, it, expect } from '@jest/globals';
import { ensurePlaywrightExecutionSteps } from '../services/playwrightExecutionSteps.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';

const imports = "import {test,expect} from '@playwright/test';\n";
const add = body => ensurePlaywrightExecutionSteps(imports + `test('scenario',async({page,request})=>{${body}});`);
describe('automatic Playwright execution steps', () => {
    it('records actions and assertions without moving shared variable declarations', () => {
        const result = add("const input=page.getByRole('textbox');const response=await page.goto('/');await input.fill('secret-input-value');await input.press('Enter');await expect(input).toHaveValue('secret-input-value');expect(response.status()).toBe(200);");
        expect(result).toContain('const response=await test.step("Open application page", async () => (page.goto(\'/\')))');
        expect(result).toContain('const input=page.getByRole');
        expect(result).toContain('test.step("Enter input value"');
        expect(result).toContain('test.step("Verify input value"');
        expect(result).toContain('test.step("Verify expected result"');
        const { ast } = validateGeneratedTestCode(result);
        const steps = [];
        const walk = node => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee?.property?.name === 'step') steps.push(node.arguments[0].value);
            Object.values(node).forEach(value => { if (Array.isArray(value)) value.forEach(walk); else if (value?.type) walk(value); });
        };
        walk(ast);
        expect(steps).toHaveLength(5);
        expect(steps.join(' ')).not.toContain('secret-input-value');
    });
    it('preserves existing descriptive blocks and adds missing actions without double wrapping', () => {
        const original = imports + "test('todo',async({page})=>{await test.step('Submit new todo',async()=>{await page.getByRole('button').click();await expect(page.locator('body')).toBeVisible();});await page.reload();});";
        const result = ensurePlaywrightExecutionSteps(original);
        expect(result).toContain("test.step('Submit new todo'");
        expect(result.match(/test\.step\(/g)).toHaveLength(2);
        expect(ensurePlaywrightExecutionSteps(result)).toBe(result);
    });
    it('records sync assertions, expression callbacks and returned promises', () => {
        const sync = ensurePlaywrightExecutionSteps(imports + "test('sync',()=>{expect(1).toBe(1);});");
        expect(sync).toContain("test('sync',async ()=>");
        expect(sync).toContain('await test.step');
        const expression = ensurePlaywrightExecutionSteps(imports + "test('inline',({page})=>page.goto('/'));");
        expect(expression).toContain("async ({page})=>await test.step");
        expect(add("return request.get('/api/todos');")).toContain('return await test.step("Send GET request"');
    });
    it('supports imported aliases and CommonJS without instrumenting suite setup', () => {
        const esm = ensurePlaywrightExecutionSteps("import {test as spec,expect as check} from '@playwright/test';spec.describe('suite',()=>{const value=1;spec('x',async({page})=>{await page.goto('/');check(value).toBe(1);});});");
        expect(esm).toContain('await spec.step');
        const cjs = ensurePlaywrightExecutionSteps("const {test,expect}=require('@playwright/test');test('x',async({page})=>{await page.goto('/');await expect(page.locator('body')).toBeVisible();});");
        expect(cjs.match(/test\.step\(/g)).toHaveLength(2);
        const ns = ensurePlaywrightExecutionSteps("import * as pw from '@playwright/test';pw.test('x',async({page})=>{await page.goto('/');});");
        expect(ns).toContain('await pw.test.step');
    });
    it('keeps branches, loops, return values, throws and cleanup intact', () => {
        const result = add("const response=await request.get('/api/todos');try{if(response.ok()){for(const button of await page.getByRole('button').all()){await button.click();}}else{throw new Error('bad response');}}finally{await page.reload();}");
        expect(result).toContain('if(response.ok())');
        expect(result).toContain("throw new Error('bad response')");
        expect(result).toContain('finally{await test.step("Reload application page"');
        expect(result).toContain('for(const button of await test.step');
    });
    it('groups nested awaits within their real outer assertion rather than creating overlapping edits', () => {
        const result = add("await expect(await request.get('/api/todos')).toBeTruthy();");
        expect(result.match(/test\.step\(/g)).toHaveLength(1);
        const syncOuter = add("expect(await request.get('/api/todos')).toBeTruthy();");
        expect(syncOuter.match(/test\.step\(/g)).toHaveLength(1);
        const inline = ensurePlaywrightExecutionSteps(imports + "test('inline',async({request})=>expect(await request.get('/api/todos')).toBeTruthy());");
        expect(inline.match(/test\.step\(/g)).toHaveLength(1);
    });
    it('rejects unawaited, empty-titled or unrecordable scenarios rather than silently losing detail', () => {
        expect(() => add("test.step('forgot await',async()=>{await page.goto('/');});")).toThrow(/awaited/);
        expect(() => add("await test.step('',async()=>{await page.goto('/');});")).toThrow(/titles/);
        expect(() => add("await test.step('Empty',async()=>{});")).toThrow(/empty callbacks/);
        expect(() => add('const value=1;')).toThrow(/real actions/);
        expect(() => add("const test={};await page.goto('/');")).toThrow(/shadowed/);
        expect(() => ensurePlaywrightExecutionSteps("function test(){}test('fake',async()=>{});")).toThrow(/imported Playwright/);
    });
});
