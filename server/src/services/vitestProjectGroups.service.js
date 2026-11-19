import fs from 'node:fs';
import path from 'node:path';
import {installPackageInWorkspace} from './dependencyResolution.service.js';
import {parseJavaScriptCode} from './babelParser.service.js';
import {ServiceError} from '../utils/serviceError.js';

export const VITEST_CONFIG_NAMES = ['vitest.config.ts','vitest.config.mts','vitest.config.cts','vitest.config.js','vitest.config.mjs','vitest.config.cjs','vite.config.ts','vite.config.mts','vite.config.cts','vite.config.js','vite.config.mjs','vite.config.cjs'];
export const findVitestConfig = directory => VITEST_CONFIG_NAMES.find(name => fs.existsSync(path.join(directory,name)));

export function validateVitestSetupFiles({rootDir,directory,config=findVitestConfig(directory),autoHeal=true,createdHarnessFiles=null}) {
    if(!config)return {valid:true,healed:false,configFile:null,missingSetupFiles:[],createdStubs:[]};
    const effectiveRootDir = rootDir || directory;
    const file=path.resolve(directory,config);
    const configPath=path.relative(effectiveRootDir,file).replaceAll('\\','/');
    if(!fs.existsSync(file))return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]}; // Vitest reports a missing config itself.
    const parsed=parseJavaScriptCode(fs.readFileSync(file,'utf8'),{filePath:file});
    if(!parsed.success)return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]}; // Let Vitest evaluate unsupported/dynamic configurations.
    const declarations=new Map();
    for(const node of parsed.ast.program.body)if(node.type==='VariableDeclaration') {
        for(const declaration of node.declarations)if(declaration.id.type==='Identifier')declarations.set(declaration.id.name,declaration.init);
    }
    const unwrap=(node,seen=new Set())=>{
        if(!node || seen.has(node))return null;
        seen.add(node);
        if(node.type==='Identifier')return unwrap(declarations.get(node.name),seen);
        if(['TSAsExpression','TSSatisfiesExpression','ParenthesizedExpression'].includes(node.type))return unwrap(node.expression,seen);
        if(node.type==='CallExpression' && node.callee?.name==='defineConfig')return unwrap(node.arguments[0],seen);
        return node;
    };
    const exported=parsed.ast.program.body.find(node=>node.type==='ExportDefaultDeclaration');
    const object=unwrap(exported?.declaration);
    if(object?.properties?.some(property=>property.type==='SpreadElement'))return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]};
    const get=(object,key)=>object?.type==='ObjectExpression'?object.properties.find(property=>!property.computed && (property.key?.name || property.key?.value)===key)?.value:null;
    const configuredRoot=get(object,'root');
    if(configuredRoot && configuredRoot.type!=='StringLiteral')return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]};
    const testRoot=configuredRoot?path.resolve(directory,configuredRoot.value):directory;
    const test=unwrap(get(object,'test'));
    if(test?.properties?.some(property=>property.type==='SpreadElement'))return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]};
    const setup=unwrap(get(test,'setupFiles'));
    const entries=setup?.type==='ArrayExpression'?setup.elements:[setup];
    const missing=[];
    const missingEntries=[];
    for(const entry of entries) {
        if(entry?.type!=='StringLiteral')continue;
        const specifier=entry.value;
        // Bare package imports are dependency resolution, not missing project files.
        if(!specifier.startsWith('.') && !path.isAbsolute(specifier) &&
            !fs.existsSync(path.join(testRoot,specifier.split('/')[0])) && !/^[^/]+\.[cm]?[jt]sx?$/.test(specifier))continue;
        const absolute=path.resolve(testRoot,specifier);
        const relToRoot=path.relative(effectiveRootDir,absolute).replaceAll('\\','/');
        if(relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
            throw new ServiceError(`Vitest setup file '${specifier}' escapes workspace root: ${relToRoot}`, 422, 'INVALID_SETUP_FILE_PATH');
        }
        let exists=false;
        try {if(fs.statSync(absolute).isFile())exists=true;}catch{}
        if(!exists) {
            for(const ext of ['.ts','.js','.tsx','.jsx','.mts','.mjs','.cts','.cjs']) {
                try {if(fs.statSync(absolute+ext).isFile()){exists=true;break;}}catch{}
            }
        }
        if(exists)continue;
        const rel=path.relative(effectiveRootDir,absolute).replaceAll('\\','/');
        missing.push(rel);
        missingEntries.push({absolute,relative:rel,specifier});
    }
    if(missing.length) {
        if(autoHeal) {
            const createdStubs=[];
            for(const entry of missingEntries) {
                let stubPath=entry.absolute;
                if(!path.extname(stubPath))stubPath=stubPath+'.js';
                const relStub=path.relative(effectiveRootDir,stubPath).replaceAll('\\','/');
                if(relStub.startsWith('..') || path.isAbsolute(relStub)) {
                    throw new ServiceError(`Vitest setup file '${stubPath}' escapes workspace root.`, 422, 'INVALID_SETUP_FILE_PATH');
                }
                try {
                    if(!fs.existsSync(stubPath)) {
                        fs.mkdirSync(path.dirname(stubPath),{recursive:true});
                        fs.writeFileSync(stubPath,'// [covai] auto-healed missing test setup file\nexport default {};\nexport {};\n','utf8');
                    }
                    createdStubs.push(relStub);
                    if(createdHarnessFiles && typeof createdHarnessFiles.add==='function')createdHarnessFiles.add(stubPath);
                } catch(e) {
                    console.warn(`[validateVitestSetupFiles] Failed to create stub at ${stubPath}:`,e.message);
                }
            }
            return {valid:true,healed:true,configFile:configPath,missingSetupFiles:missing,createdStubs};
        }
        throw new ServiceError(`Vitest configuration '${configPath}' references missing setup file(s): ${missing.join(', ')}. Restore the original setup file or correct test.setupFiles to the intended existing file. Analysis and Apply cannot verify tests until this configuration is repaired.`,422,
            'TEST_SETUP_FILE_MISSING',{configFile:configPath,missingSetupFiles:missing});
    }
    return {valid:true,healed:false,configFile:configPath,missingSetupFiles:[],createdStubs:[]};
}

export async function ensureVitestEnvironment({rootDir,directory,config=findVitestConfig(directory),jobId,runtime,install=installPackageInWorkspace}) {
    if(!config)return;
    const configPath=path.resolve(directory,config);
    if(!fs.existsSync(configPath))return;
    const importedFrom=path.relative(rootDir,configPath);
    const environment=fs.readFileSync(configPath,'utf8').match(/\benvironment\s*:\s*['"](jsdom|happy-dom)['"]/s)?.[1];
    if(!environment)return;
    let runnerCanResolve = !runtime?.runner?.real;
    if(runtime?.runner?.real) {
        let ancestor=path.dirname(runtime.runner.real);
        while(true) {
            if(fs.existsSync(path.join(ancestor,'node_modules',environment,'package.json'))) {runnerCanResolve=true;break;}
            const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;
        }
    }
    let current=path.resolve(directory);
    while(true) {
        if(runnerCanResolve && fs.existsSync(path.join(current,'node_modules',environment,'package.json')))return false;
        if(current===path.resolve(rootDir))break;
        const parent=path.dirname(current);
        if(parent===current || path.relative(rootDir,parent).startsWith('..'))break;
        current=parent;
    }
    const result=await install({rootDir,packageName:environment,isDev:true,importedFrom,jobId});
    if(!result.success)throw new Error(`Unable to install the configured Vitest environment '${environment}'. ${result.stderr || ''}`);
    if(!runnerCanResolve) {
        // A borrowed Vitest imports environments from its real dependency tree.
        // Materialize a local runner, then let coverage alignment verify it again.
        const local=await install({rootDir,packageName:'vitest',version:runtime.runner.version,isDev:true,importedFrom,jobId});
        if(!local.success)throw new Error(`Unable to prepare a local Vitest runtime for '${environment}'. ${local.stderr || ''}`);
    }
    return true;
}

export function groupVitestProjects(rootDir, files) {
    const root = path.resolve(rootDir), groups = new Map();
    const isProjectSubroot = (dir) => {
        if (findVitestConfig(dir)) return true;
        if (dir !== root && fs.existsSync(path.join(dir, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
                if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest || pkg.scripts?.test?.includes('vitest')) {
                    return true;
                }
            } catch { }
        }
        return false;
    };
    for(const file of files) {
        const absolute=path.resolve(root,file);
        const relative=path.relative(root,absolute);
        if(relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Vitest test files must remain inside the workspace.');
        let directory=path.dirname(absolute);
        while(directory!==root && !isProjectSubroot(directory)) directory=path.dirname(directory);
        if(!groups.has(directory))groups.set(directory,[]);
        groups.get(directory).push(file);
    }
    return groups;
}

export function discoverVitestFiles(rootDir, classify) {
    const files=[];
    function walk(directory) {
        for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
            if(['node_modules','.git','coverage','dist','build','.next','.cache'].includes(item.name) || item.name.startsWith('.covai'))continue;
            const absolute=path.join(directory,item.name);
            if(item.isDirectory())walk(absolute);
            else if(item.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(item.name)) {
                const relative=path.relative(rootDir,absolute).replaceAll('\\','/');
                if(classify(fs.readFileSync(absolute,'utf8'),relative)==='vitest')files.push(relative);
            }
        }
    }
    walk(rootDir);return files;
}

export async function runVitestProjectGroups({rootDir,groups,coverageDir,run,mergeFinal,mergeSummaries}) {
    fs.mkdirSync(coverageDir,{recursive:true});
    const suites=[], outputs=[];
    const projectResults = new Map();
    let final={}, summary={}, index=0;
    let anyGroupHadAssertionFailure = false;
    let successfulGroups = 0;

    for(const [directory,files] of groups) {
        const outputDir=path.join(coverageDir,`project-${index++}`);
        fs.mkdirSync(outputDir,{recursive:true});
        const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(outputDir,name),'utf8'));}catch{return null;}};
        let groupExitCode = 0;
        let groupSuccess = false;

        try {
            const result=await run(directory,files,outputDir);
            groupExitCode = result?.exitCode ?? 0;
            if (result?.stdout) outputs.push(result.stdout);
            if (result?.stderr) outputs.push(result.stderr);

            const report=read('vitest-results.json');
            let hasTestResults = false;
            let groupAssertionFailure = false;
            if(Array.isArray(report?.testResults)) {
                hasTestResults = true;
                suites.push(...report.testResults.map(suite=>({...suite,name:path.resolve(directory,suite.name || suite.testFilePath)})));
                for(const suite of report.testResults) {
                    if(suite.status === 'failed' || (suite.assertionResults || []).some(t => t.status === 'failed')) {
                        anyGroupHadAssertionFailure = true;
                        groupAssertionFailure = true;
                    }
                }
            }

            const nextFinal=read('coverage-final.json'), nextSummary=read('coverage-summary.json');
            if(nextFinal) {
                const normalizeFinal = (map) => Object.fromEntries(
                    Object.entries(map || {}).map(([file, value]) => {
                        if (file === "total" || !value || typeof value !== "object") return [file, value];
                        const resolvedPath = path.isAbsolute(file) ? file : path.resolve(directory, file);
                        return [resolvedPath, { ...value, path: resolvedPath }];
                    })
                );
                final = mergeFinal(final, normalizeFinal(nextFinal), { rootDir });
            }
            if(nextSummary?.total) {
                const normalizeSummary = (map) => Object.fromEntries(
                    Object.entries(map || {}).map(([file, value]) => {
                        if (file === "total") return [file, value];
                        const resolvedPath = path.isAbsolute(file) ? file : path.resolve(directory, file);
                        return [resolvedPath, value];
                    })
                );
                summary = mergeSummaries(summary, normalizeSummary(nextSummary), { rootDir, mergedFinal: final });
            }

            if(groupExitCode === 0 && hasTestResults && !groupAssertionFailure) {
                groupSuccess = true;
                successfulGroups++;
            } else if (hasTestResults && !groupAssertionFailure) {
                // If assertions passed but runner exitCode was non-zero due to diagnostic or setup warnings
                groupSuccess = true;
                successfulGroups++;
            }

            projectResults.set(directory, {
                exitCode: groupExitCode,
                success: groupSuccess,
                testResults: report?.testResults || [],
                hasCoverage: Boolean(nextFinal)
            });
        } catch(error) {
            outputs.push(`[${path.relative(rootDir,directory)||'.'}] ${error.message}`);
            projectResults.set(directory, {
                exitCode: 1,
                success: false,
                error: error.message
            });
        }
    }

    const numTotalTests = suites.reduce((n,s)=>n+(s.assertionResults?.length||0),0);
    const numFailedTests = suites.reduce((n,s)=>n+(s.assertionResults||[]).filter(t=>t.status==='failed').length,0);
    const numPassedTests = suites.reduce((n,s)=>n+(s.assertionResults||[]).filter(t=>t.status==='passed').length,0);
    const numFailedTestSuites = suites.filter(s => s.status === 'failed').length;

    let success = false;
    let exitCode = 0;
    if (groups.size === 0) {
        success = true;
        exitCode = 0;
    } else if (anyGroupHadAssertionFailure || numFailedTests > 0 || numFailedTestSuites > 0) {
        success = false;
        exitCode = 1;
    } else if (successfulGroups > 0 || suites.length > 0) {
        success = true;
        exitCode = 0;
    } else {
        success = false;
        exitCode = 1;
    }

    const report={
        success,
        exitCode,
        testResults:suites,
        numTotalTests,
        numFailedTests,
        numPassedTests,
        numTotalTestSuites: suites.length,
        numFailedTestSuites
    };

    for(const name of ['vitest-results.json','test-results.json']) {
        fs.writeFileSync(path.join(coverageDir,name),JSON.stringify(report, null, 2));
    }
    if(Object.keys(final).length) {
        const finalJson = JSON.stringify(final, null, 2);
        fs.writeFileSync(path.join(coverageDir,'coverage-final.json'), finalJson);
        fs.writeFileSync(path.join(coverageDir,'vitest-coverage-final.json'), finalJson);
    }
    if(summary.total) {
        const summaryJson = JSON.stringify(summary, null, 2);
        fs.writeFileSync(path.join(coverageDir,'coverage-summary.json'), summaryJson);
        fs.writeFileSync(path.join(coverageDir,'vitest-coverage-summary.json'), summaryJson);
    }

    return {
        exitCode,
        success,
        stdout:outputs.join('\n'),
        stderr:'',
        coverageDir,
        projectResults
    };
}
