import { ensureFullSystemSetup, inspectSystemSetupSource } from './fullSystemSetup.service.js';
import { resolveSystemRepositoryRoot, containedPath } from './fullSystemConfig.service.js';
import { readAssessmentTestEnvironment } from './fullSystemRuntime.service.js';
import { validateStartupEnvironment, buildAutomaticTestEnvironment, managedEnvironmentNames } from './fullSystemEnvironment.service.js';
import { discoverSystemAssessment } from './systemAssessmentDiscovery.service.js';
import { assessmentRequest, parseRequest } from '../validators/systemAssessment.validator.js';
import { generateText } from './gemini.service.js';
import { validateSelectedAiModel } from '../utils/selectedAiModel.js';
import { ServiceError } from '../utils/serviceError.js';
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
        const provider = dependencies.generate || generateText;
        const model = validateSelectedAiModel(input.model);
        const setup=await (dependencies.setup || ensureFullSystemSetup)({rootDir, onProgress: checkpoint, dependencies: {
            generate: model ? (prompt, instruction, config) => provider(prompt, model, instruction, config) : provider,
        }});
        if(setup?.config) {
            const directory=setup.config.backend.directory;
            const backend=containedPath(rootDir,directory);
            const source=inspectSystemSetupSource(backend);
            validateStartupEnvironment({files:source.files,env:buildAutomaticTestEnvironment({files:source.files,env:readAssessmentTestEnvironment(backend)}),directory,scripts:source.packages.find(pkg=>pkg.directory==='.')?.scripts,managedVariables:managedEnvironmentNames(source.files,setup.config)});
        }
    }
    await checkpoint(29, 'Scanning system tests and resolving source coverage scopes');
    let resolved;
    const discover=()=> (dependencies.discover || discoverSystemAssessment)({rootDir,runner:input.runner,executionMode:input.executionMode});
    try{resolved=discover();}catch(error){
        if(input.executionMode!=='full' || !['FULL_STACK_TESTS_REQUIRED','SYSTEM_TESTS_NOT_FOUND'].includes(error.code))throw error;
        const generateTests=dependencies.prepareTests || (await import('./automaticSystemTests.service.js')).prepareMissingSystemTests;
        await generateTests({rootDir,jobId,model:input.model,signal,onProgress:checkpoint});
        resolved=discover();
    }
    return {rootDir, input: parseRequest(assessmentRequest, resolved),aiUsage:currentAiJobBudget()?.snapshot()};
};
