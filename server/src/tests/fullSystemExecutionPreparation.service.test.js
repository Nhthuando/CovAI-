import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect,jest,afterEach} from '@jest/globals';
import {prepareFullSystemExecution,resolveSystemTestFile} from '../services/fullSystemExecutionPreparation.service.js';
const roots=[];
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'full-suite-'));roots.push(root);return root;};
const write=(root,file,code)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),code);};
const code="import {test,expect} from '@playwright/test';test('real',async({page})=>{await page.goto('/');await expect(page.locator('body')).toBeVisible();});";
const mock=code.replace("await page.goto('/')","await page.route('**/api/**',()=>{})");
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('Full Stack suite selection',()=>{
    it('skips mocked selections and removes only titles exclusive to those specs',async()=>{
        const root=fixture();
        const mockedFile='tests/e2e/dashboard.spec.js';
        const realFile='tests/e2e/real.spec.js';
        write(root,mockedFile,mock + "\ntest('mock only',async()=>{});");
        write(root,realFile,code);
        const onProgress=jest.fn();
        const result=await prepareFullSystemExecution({rootDir:root,execution:{
            selectedFiles:[mockedFile,realFile],selectedTitles:['mock only','real'],
        },onProgress});
        expect(result.execution.selectedFiles).toEqual([path.join(root,realFile)]);
        expect(result.execution.selectedTitles).toEqual(['real']);
        expect(result.skippedFiles).toEqual([{
            file:mockedFile,reason:'Uses API mocks (frontend-only test); not run in Full Stack mode.',
        }]);
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith(18,`Skipped 1 frontend-only spec that mocks APIs: ${mockedFile}`);
    });
    it('preserves the first validation error when all selected specs mock APIs',async()=>{
        const root=fixture();
        const selectedFiles=['tests/e2e/dashboard.spec.js','tests/e2e/other.spec.js'];
        for (const file of selectedFiles) write(root,file,mock);
        await expect(prepareFullSystemExecution({rootDir:root,execution:{selectedFiles}})).rejects.toMatchObject({
            message:`${selectedFiles[0]}: Full-system tests must call the real backend. API mocks, request routes, HAR replay and init-script replacements are not allowed; regenerate tests in full-system mode.`,
            statusCode:422,
        });
    });
    it('resolves editor paths relative to the repository before the nested runner',async()=>{
        const root=fixture();write(root,'tests/system/real.spec.js',code);write(root,'client/e2e/mock.spec.js',mock);
        const execution={rootDir:path.join(root,'client'),testFile:'tests/system/real.spec.js'};
        expect((await prepareFullSystemExecution({rootDir:root,execution})).execution.testFile).toBe(path.join(root,'tests/system/real.spec.js'));
        expect(resolveSystemTestFile(root,path.join(root,'client'),'client/e2e/mock.spec.js')).toBe(path.join(root,'client/e2e/mock.spec.js'));
        await expect(prepareFullSystemExecution({rootDir:root,execution:{...execution,testFile:'client/e2e/mock.spec.js'}})).rejects.toThrow('Generate Full Stack tests');
        expect(()=>resolveSystemTestFile(root,path.join(root,'client'),'missing.spec.js')).toThrow('No other suite was run');
    });
    it('reuses a verified repository suite even when discovery selects the client package',async()=>{
        const root=fixture();write(root,'tests/system/real.spec.js',code);write(root,'client/e2e/mock.spec.js',mock);
        const generate=jest.fn();
        const result=await prepareFullSystemExecution({rootDir:root,execution:{rootDir:path.join(root,'client'),testDirectory:'e2e'},dependencies:{generate}});
        expect(result.execution.rootDir).toBe(root);
        expect(result.execution.testDirectory).toBe('tests/system');
        expect(generate).not.toHaveBeenCalled();
    });
    it('does not generate or write tests implicitly in a nested frontend',async()=>{
        const root=fixture();write(root,'client/e2e/mock.spec.js',mock);const generate=jest.fn();
        await expect(prepareFullSystemExecution({rootDir:root,execution:{rootDir:path.join(root,'client'),testDirectory:'e2e'},dependencies:{generate}})).rejects.toMatchObject({statusCode:409});
        expect(generate).not.toHaveBeenCalled();expect(fs.existsSync(path.join(root,'tests/system'))).toBe(false);
    });
    it('prefers the full suite while leaving frontend mocks unchanged',async()=>{
        const root=fixture();write(root,'tests/system/real.spec.js',code);write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn();
        const result=await prepareFullSystemExecution({rootDir:root,execution:{rootDir:root,testDirectory:'tests/e2e'},dependencies:{generate}});
        expect(result.execution.testDirectory).toBe('tests/system');expect(generate).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,'tests/e2e/mock.spec.js'),'utf8')).toBe(mock);
    });
    it('preserves frontend mocks while requiring reviewed Full Stack tests',async()=>{
        const root=fixture();write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn();
        await expect(prepareFullSystemExecution({rootDir:root,execution:{testDirectory:'tests/e2e'},dependencies:{generate}})).rejects.toThrow('review and apply');
        expect(generate).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,'tests/e2e/mock.spec.js'),'utf8')).toBe(mock);
    });
    it('keeps handwritten tests that already use the real application',async()=>{
        const root=fixture();write(root,'tests/e2e/real.spec.js',code);const generate=jest.fn();
        expect((await prepareFullSystemExecution({rootDir:root,execution:{testDirectory:'tests/e2e'},dependencies:{generate}})).execution.testDirectory).toBe('tests/e2e');expect(generate).not.toHaveBeenCalled();
    });
    it('does not call generation for an empty suite',async()=>{
        const root=fixture();const generate=jest.fn().mockResolvedValue({failed:true,error:'verification failed'});
        await expect(prepareFullSystemExecution({rootDir:root,execution:{},dependencies:{generate}})).rejects.toMatchObject({statusCode:409});expect(generate).not.toHaveBeenCalled();expect(fs.existsSync(path.join(root,'tests/system'))).toBe(false);
    });
    it('rejects an explicitly selected mocked file instead of running a different scenario',async()=>{
        const root=fixture();write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn();
        await expect(prepareFullSystemExecution({rootDir:root,execution:{testFile:'tests/e2e/mock.spec.js'},dependencies:{generate}})).rejects.toThrow('real backend');expect(generate).not.toHaveBeenCalled();
    });
});
