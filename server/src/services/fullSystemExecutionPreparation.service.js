import fs from 'node:fs';
import path from 'node:path';
import {containedPath} from './fullSystemConfig.service.js';
import {validateFullSystemTest} from './systemTestEvidence.service.js';
import {generateVerifiedSystemTests} from './verifiedSystemGeneration.service.js';
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
    if(execution.testFile) {
        const file=resolveSystemTestFile(rootDir,runnerRoot,execution.testFile);
        try { validateFullSystemTest(fs.readFileSync(file,'utf8')); }
        catch(error) { throw new ServiceError(`${path.relative(rootDir,file).replace(/\\/g,'/')}: ${error.message} Switch to Frontend mode to run this mocked test. No other suite was run.`,422); }
        return {execution:{...execution,testFile:file}};
    }
    // Full-system generations have their own directory; never mix them with frontend mocks.
    if (runnerRoot !== rootDir) {
        const files=collectSpecs(containedPath(rootDir,'tests/system'));
        if (files.length) {
            let compatible=true;
            try {for(const file of files) validateFullSystemTest(fs.readFileSync(file,'utf8'));} catch {compatible=false;}
            if(compatible) {
                await onProgress(18,`Full Stack selected tests/system (${files.length} spec file(s)). Frontend suites with mocked APIs are not executed in this mode.`);
                return {execution:{...execution,rootDir,testDirectory:'tests/system',testFile:undefined}};
            }
        }
    }
    for(const directory of [...new Set(['tests/system',execution.testDirectory].filter(Boolean))]) {
        const files=collectSpecs(containedPath(runnerRoot,directory));
        if(!files.length) continue;
        try { for(const file of files) validateFullSystemTest(fs.readFileSync(file,'utf8')); }
        catch { continue; }
        return {execution:{...execution,testDirectory:directory}};
    }
    await onProgress(18,'No compatible Full Stack suite found; generating and verifying real-backend tests');
    let preparationProgress=18;
    const generated=await (dependencies.generate || generateVerifiedSystemTests)({rootDir,jobId,onProgress:(progress,message)=>{
        preparationProgress=Math.max(preparationProgress,Math.min(30,Math.round(18+progress*0.12)));
        return onProgress(preparationProgress,message);
    }});
    if(generated.failed) throw new ServiceError(generated.error || 'Generated Full Stack tests failed verification; no suite was saved',422);
    validateFullSystemTest(generated.code);
    const filePath='tests/system/ai-generated.spec.js';
    const file=containedPath(rootDir,filePath);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,generated.code,'utf8');
    return {execution:{...execution,rootDir,testDirectory:'tests/system',testFile:file},generated:{...generated,filePath}};
};
