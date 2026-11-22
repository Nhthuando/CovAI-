import { ensureFullSystemSetup, inspectSystemPackageSource } from './fullSystemSetup.service.js';
import { resolveSystemRepositoryRoot, containedPath } from './fullSystemConfig.service.js';
import { readAssessmentTestEnvironment } from './fullSystemRuntime.service.js';
import { validateStartupEnvironment, buildAutomaticTestEnvironment, managedEnvironmentNames } from './fullSystemEnvironment.service.js';
import { discoverSystemAssessment } from './systemAssessmentDiscovery.service.js';
import { assessmentRequest, parseRequest } from '../validators/systemAssessment.validator.js';
import { generateText as generateFeatureText } from './gemini.service.js';
import { withGeminiFeature } from './geminiRouting.service.js';
import { withGeminiChannel } from './geminiTokenTracker.service.js';
const generateText = (...args) => withGeminiFeature('system-test', () => generateFeatureText(...args));
import { validateSelectedAiModel } from '../utils/selectedAiModel.js';
import { ServiceError } from '../utils/serviceError.js';
import { prepareMissingSystemTests } from './automaticSystemTests.service.js';
import { discoverExecutionScenarios } from './systemScenarioCatalog.service.js';
import {currentAiJobBudget,createAiJobBudget,withAiJobBudget} from './aiJobBudget.service.js';

// Preparation precedes discovery: Full Stack config determines the source scopes.
export const prepareAutomaticAssessment = async ({rootDir, input, onProgress = async () => {}, signal, jobId, dependencies = {}}) => {
    if(!currentAiJobBudget())return withAiJobBudget(createAiJobBudget({maxRequests:6,signal}),()=>prepareAutomaticAssessment({rootDir,input,onProgress,signal,jobId,dependencies}));
    rootDir = resolveSystemRepositoryRoot(rootDir);
    const checkpoint = async (progress, message) => {
        if (signal?.aborted) throw new ServiceError('System test preparation canceled', 409);
        await onProgress(message, progress);
    };
    await checkpoint(8, 'Discovering application packages and test configuration');
    if (input.executionMode === 'full') {
        const model = validateSelectedAiModel(input.model);
        const aiGenerate = dependencies.generate
            ? (model ? (prompt, instruction, config) => dependencies.generate(prompt, model, instruction, config) : dependencies.generate)
            : (model ? (prompt, instruction, config) => withGeminiChannel("E2E_TEST", () => generateText(prompt, model, instruction, config)) : ((...args) => withGeminiChannel("E2E_TEST", () => generateText(...args))));
        const setup = await (dependencies.setup || ensureFullSystemSetup)({
            rootDir,
            model,
            onProgress: checkpoint,
            dependencies: { generate: aiGenerate },
        });
        if(setup?.config) {
            const directory=setup.config.backend.directory;
            const backend=containedPath(rootDir,directory);
            const source=inspectSystemPackageSource(backend);
            // The actual URLs/ports are allocated by startFullSystem. Defer
            // variables that it wires automatically instead of blocking here.
            const automatic=buildAutomaticTestEnvironment({files:source.files,port:1,backendUrl:'http://127.0.0.1',frontendUrl:'http://127.0.0.1'});
            validateStartupEnvironment({files:source.files,env:buildAutomaticTestEnvironment({files:source.files,env:readAssessmentTestEnvironment(backend)}),directory,scripts:source.packages.find(pkg=>pkg.directory==='.')?.scripts,managedVariables:[...managedEnvironmentNames(source.files,setup.config),...Object.keys(automatic)],preferStart:!setup.config.unified});
        }
    }
    await checkpoint(29, 'Scanning system tests and resolving source coverage scopes');
    let resolved;
    const discover=()=> (dependencies.discover || discoverSystemAssessment)({rootDir,runner:input.runner,executionMode:input.executionMode});
    let generatedTests;
    try{resolved=discover();}catch(error){
        if(input.executionMode!=='full' || !['FULL_STACK_TESTS_REQUIRED','SYSTEM_TESTS_NOT_FOUND'].includes(error.code))throw error;
        if(!input.allowGenerate) {
            if (error.code === 'FULL_STACK_TESTS_REQUIRED' && input.autoDiscover) {
                await checkpoint(32, 'Existing specs mock API calls; running measured coverage in Frontend mode');
                resolved = (dependencies.discover || discoverSystemAssessment)({rootDir, runner: input.runner, executionMode: 'frontend'});
            } else {
                throw new ServiceError('No compatible tests are applied. Generate a draft, review it and apply the tests before running.',409);
            }
        } else {
            generatedTests=await (dependencies.prepareMissing || prepareMissingSystemTests)({rootDir,jobId,model:input.model,signal,onProgress:(progress,message)=>onProgress(message,progress)});
            resolved=discover();
        }
    }
    for (const { filePath, reason } of resolved.excludedTests ?? []) {
        await checkpoint(29, `Skipped ${filePath}: ${reason}`);
    }
    const executionOnly=input.autoDiscover && !input.prepareOnly;
    if (Array.isArray(input.selectedFiles) && input.selectedFiles.length > 0) {
        const want = new Set(input.selectedFiles.map(f => String(f).replace(/\\/g, '/')));
        const filtered = resolved.testFiles.filter(f => want.has(String(f).replace(/\\/g, '/')));
        if (!filtered.length && resolved.executionMode === 'full') {
            await checkpoint(32, 'Selected spec uses frontend mode; switching to Frontend mode');
            resolved = (dependencies.discover || discoverSystemAssessment)({rootDir, runner: input.runner, executionMode: 'frontend'});
        }
        const matched = resolved.testFiles.filter(f => want.has(String(f).replace(/\\/g, '/')));
        if (!matched.length) throw new ServiceError('Selected test file was not found in system specs.', 422);
        resolved = { ...resolved, testFiles: matched };
    }
    const rawCatalog=executionOnly?discoverExecutionScenarios({rootDir,testFiles:resolved.testFiles}):undefined;
    const selectedTitleSet = Array.isArray(input.selectedTitles) && input.selectedTitles.length > 0
        ? new Set(input.selectedTitles.map(t => String(t).trim().toLowerCase()))
        : null;
    const catalog = rawCatalog && selectedTitleSet
        ? rawCatalog.filter(row => selectedTitleSet.has(String(row.title || '').trim().toLowerCase()))
        : rawCatalog;
    const repeatRuns = input.repeatRuns || (selectedTitleSet ? 1 : resolved.repeatRuns || 2);
    return {rootDir, input: parseRequest(assessmentRequest, {...resolved,repeatRuns,...(input.selectedTitles?.length?{selectedTitles:input.selectedTitles}:{}),...(input.headed!==undefined?{headed:input.headed}:{}),...(executionOnly?{reviewMode:'execution',scenarioIds:(catalog||[]).map(row=>row.id)}:{})}),catalog,generatedTests,aiUsage:currentAiJobBudget()?.snapshot()};
};
