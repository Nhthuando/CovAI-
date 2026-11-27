import fs from 'node:fs';
import path from 'node:path';
import {containedPath} from './fullSystemConfig.service.js';
import {validateFullSystemTestFile} from './systemTestEvidence.service.js';
import {extractSuitesAndScenarios} from '../utils/testFileParser.js';
import {ServiceError} from '../utils/serviceError.js';

const collectSpecs = directory => {
    const files=[];
    const walk=(folder,depth=0)=>{
        if (depth>8 || !fs.existsSync(folder)) return;
        for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
            if(entry.isSymbolicLink() || ['node_modules','.git','.covai-system-test'].includes(entry.name)) continue;
            const file=path.join(folder,entry.name);
            if(entry.isDirectory()) walk(file,depth+1);
            else if(entry.isFile() && /\.(spec|test)\.[cm]?[jt]s$/.test(entry.name)) files.push(file);
        }
    };
    walk(directory); return files;
};

export const resolveSystemTestFile = (rootDir, runnerRoot, testFile) => {
    const repositoryFile = containedPath(rootDir, testFile);
    if (fs.existsSync(repositoryFile) && fs.statSync(repositoryFile).isFile()) return repositoryFile;
    const runnerFile = containedPath(runnerRoot, testFile);
    if (fs.existsSync(runnerFile) && fs.statSync(runnerFile).isFile()) return runnerFile;
    throw new ServiceError(`Selected system test file was not found: ${testFile}. No other suite was run.`, 422);
};

export const prepareFullSystemExecution = async ({rootDir,execution,jobId,onProgress=async()=>{},dependencies={}}) => {
    const runnerRoot=execution.rootDir || rootDir;
    if(Array.isArray(execution.selectedFiles) && execution.selectedFiles.length > 0) {
        const compatible = [];
        const skippedFiles = [];
        const titlesByCompatibility = { compatible: new Set(), skipped: new Set() };
        let firstError;
        for (const f of execution.selectedFiles) {
            const abs = path.isAbsolute(f) ? f : resolveSystemTestFile(rootDir, runnerRoot, f);
            const file = path.relative(rootDir,abs).replace(/\\/g,'/');
            let content;
            let titles = titlesByCompatibility.compatible;
            try {
                if (execution.selectedTitles?.length) content = fs.readFileSync(abs,'utf8');
                validateFullSystemTestFile({filePath:abs,rootDir});
                compatible.push(abs);
            } catch(error) {
                const validationError = new ServiceError(`${file}: ${error.message}`,422);
                if (!error.message.startsWith('Full-system tests must call the real backend.')) throw validationError;
                firstError ??= validationError;
                skippedFiles.push({file,reason:'Uses API mocks (frontend-only test); not run in Full Stack mode.'});
                titles = titlesByCompatibility.skipped;
            }
            if (execution.selectedTitles?.length) {
                for (const title of extractSuitesAndScenarios(content,'PLAYWRIGHT').scenarios) titles.add(title);
            }
        }
        if (!compatible.length) throw firstError;
        const prepared = {...execution,selectedFiles:compatible};
        if (skippedFiles.length) {
            if (execution.selectedTitles?.length) {
                const {compatible: retained, skipped} = titlesByCompatibility;
                prepared.selectedTitles = execution.selectedTitles.filter(title => !skipped.has(title) || retained.has(title));
            }
            await onProgress(18,`Skipped ${skippedFiles.length} frontend-only spec${skippedFiles.length === 1 ? ' that mocks' : 's that mock'} APIs: ${skippedFiles.map(({file}) => file).join(', ')}`);
        }
        return {execution:prepared,skippedFiles};
    }
    if(execution.testFile) {
        const file=resolveSystemTestFile(rootDir,runnerRoot,execution.testFile);
        try { validateFullSystemTestFile({filePath:file,rootDir}); }
        catch(error) { throw new ServiceError(`${path.relative(rootDir,file).replace(/\\/g,'/')}: ${error.message} Generate Full Stack tests that call the real backend instead of API mocks. No other suite was run.`,422); }
        return {execution:{...execution,testFile:file}};
    }
    // Full-system generations have their own directory; never mix them with frontend mocks.
    if (runnerRoot !== rootDir) {
        const files=collectSpecs(containedPath(rootDir,'tests/system'));
        if (files.length) {
            let compatible=true;
            try {for(const file of files) validateFullSystemTestFile({filePath:file,rootDir});} catch {compatible=false;}
            if(compatible) {
                await onProgress(18,`Full Stack selected tests/system (${files.length} spec file(s)). Frontend suites with mocked APIs are not executed in this mode.`);
                return {execution:{...execution,rootDir,testDirectory:'tests/system',testFile:undefined}};
            }
        }
    }
    for(const directory of [...new Set(['tests/system',execution.testDirectory].filter(Boolean))]) {
        const files=collectSpecs(containedPath(runnerRoot,directory));
        if(!files.length) continue;
        try { for(const file of files) validateFullSystemTestFile({filePath:file,rootDir}); }
        catch { continue; }
        return {execution:{...execution,testDirectory:directory}};
    }
    throw new ServiceError('No compatible Full Stack tests are applied. Generate, review and apply a System Test draft first.',409);
};
