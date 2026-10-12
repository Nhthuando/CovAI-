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
    it('resolves editor paths relative to the repository before the nested runner',async()=>{
        const root=fixture();write(root,'tests/system/real.spec.js',code);write(root,'client/e2e/mock.spec.js',mock);
        const execution={rootDir:path.join(root,'client'),testFile:'tests/system/real.spec.js'};
        expect((await prepareFullSystemExecution({rootDir:root,execution})).execution.testFile).toBe(path.join(root,'tests/system/real.spec.js'));
        expect(resolveSystemTestFile(root,path.join(root,'client'),'client/e2e/mock.spec.js')).toBe(path.join(root,'client/e2e/mock.spec.js'));
        await expect(prepareFullSystemExecution({rootDir:root,execution:{...execution,testFile:'client/e2e/mock.spec.js'}})).rejects.toThrow('Switch to Frontend mode');
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
    it('generates from the complete snapshot when the runner is in a nested frontend',async()=>{
        const root=fixture();write(root,'client/e2e/mock.spec.js',mock);
        const generate=jest.fn().mockResolvedValue({code,verificationRuns:2});
        const result=await prepareFullSystemExecution({rootDir:root,execution:{rootDir:path.join(root,'client'),testDirectory:'e2e'},dependencies:{generate}});
        expect(generate).toHaveBeenCalledWith(expect.objectContaining({rootDir:root}));
        expect(result.execution.rootDir).toBe(root);
        expect(result.execution.testFile).toBe(path.join(root,'tests/system/ai-generated.spec.js'));
        expect(fs.readFileSync(result.execution.testFile,'utf8')).toBe(code);
        expect(fs.existsSync(path.join(root,'client/tests/system'))).toBe(false);
    });
    it('prefers the full suite while leaving frontend mocks unchanged',async()=>{
        const root=fixture();write(root,'tests/system/real.spec.js',code);write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn();
        const result=await prepareFullSystemExecution({rootDir:root,execution:{rootDir:root,testDirectory:'tests/e2e'},dependencies:{generate}});
        expect(result.execution.testDirectory).toBe('tests/system');expect(generate).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,'tests/e2e/mock.spec.js'),'utf8')).toBe(mock);
    });
    it('generates and verifies a separate full suite when only frontend mocks exist',async()=>{
        const root=fixture();write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn().mockResolvedValue({code,verificationRuns:2});
        const result=await prepareFullSystemExecution({rootDir:root,execution:{rootDir:root,testDirectory:'tests/e2e'},dependencies:{generate}});
        expect(generate).toHaveBeenCalledTimes(1);expect(result.generated.verificationRuns).toBe(2);expect(result.execution.testDirectory).toBe('tests/system');
        expect(fs.readFileSync(path.join(root,result.generated.filePath),'utf8')).toBe(code);expect(fs.readFileSync(path.join(root,'tests/e2e/mock.spec.js'),'utf8')).toBe(mock);
    });
    it('keeps handwritten tests that already use the real application',async()=>{
        const root=fixture();write(root,'tests/e2e/real.spec.js',code);const generate=jest.fn();
        expect((await prepareFullSystemExecution({rootDir:root,execution:{testDirectory:'tests/e2e'},dependencies:{generate}})).execution.testDirectory).toBe('tests/e2e');expect(generate).not.toHaveBeenCalled();
    });
    it('does not save a failed generated candidate',async()=>{
        const root=fixture();const generate=jest.fn().mockResolvedValue({failed:true,error:'verification failed'});
        await expect(prepareFullSystemExecution({rootDir:root,execution:{},dependencies:{generate}})).rejects.toThrow('verification failed');expect(fs.existsSync(path.join(root,'tests/system'))).toBe(false);
    });
    it('rejects an explicitly selected mocked file instead of running a different scenario',async()=>{
        const root=fixture();write(root,'tests/e2e/mock.spec.js',mock);const generate=jest.fn();
        await expect(prepareFullSystemExecution({rootDir:root,execution:{testFile:'tests/e2e/mock.spec.js'},dependencies:{generate}})).rejects.toThrow('real backend');expect(generate).not.toHaveBeenCalled();
    });
});
