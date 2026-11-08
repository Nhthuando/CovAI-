import { systemTestPromptRules } from './systemTestPrompt.service.js';
import fs from 'node:fs';
import { containedPath } from './fullSystemConfig.service.js';
import { collectSystemGenerationContext } from './systemGenerationContext.service.js';
import { generateText } from './gemini.service.js';
import { withGeminiChannel } from './geminiTokenTracker.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';
import { preserveTestIntent, analyzeSystemTestFile, walkAst, validateAdditionalTestQuality } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { buildBudgetedTestPrompt } from './systemTestPromptBudget.service.js';
import { retainValidAdditionalTests } from './systemImprovementCandidates.service.js';

export const extractBoosterResponse = raw => {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
        const result = JSON.parse(text);
        if (!(typeof result.optimizedCode === 'string' && result.optimizedCode.trim()) && !(typeof result.additionalTests === 'string' && result.additionalTests.trim())) throw new Error();
        return result;
    } catch { throw new ServiceError('AI returned an invalid test proposal', 422); }
};
// Kept as explicit failure for older callers; generic smoke tests cannot claim improvement.
export const generateFallbackBoosterScenarios = () => { throw new ServiceError('AI is unavailable; no coverage improvement has been generated', 503); };
export const generateFallbackBreakpointFix = () => { throw new ServiceError('Automatic fallback cannot safely establish the intended repair', 503); };
export const optimizeSystemTest = async ({ rootDir, filePath, mode = 'BOOST_COVERAGE', instruction = '', scenarioData = null, dependencies = {}, model }) => {
    if (!['BOOST_COVERAGE', 'FIX_BREAKPOINT'].includes(mode)) throw new ServiceError('Unsupported proposal mode', 400);
    const target = containedPath(rootDir, filePath);
    if (!fs.existsSync(target)) throw new ServiceError('Test file not found', 404);
    const existingCode = fs.readFileSync(target, 'utf8');
    if (Buffer.byteLength(existingCode) > 256 * 1024) throw new ServiceError('Test file exceeds 256 KiB', 413);
    const context = collectSystemGenerationContext(rootDir);
    let budget;
    try {budget=buildBudgetedTestPrompt({filePath,existingCode,instruction,scenarioData,context,mode});}
    catch(error) {throw new ServiceError(error.message,413);}
    let response;
    try {
        const provider=dependencies.generate || generateText;
        const generate=model ? (prompt,instruction,config)=>withGeminiChannel("E2E_TEST", () => provider(prompt,model,instruction,config)) : ((...args) => withGeminiChannel("E2E_TEST", () => provider(...args)));
        response = await generate(budget.prompt, `${mode === 'BOOST_COVERAGE' ? 'Return JSON {"additionalTests":"only new test declarations"}. Do not repeat the existing file or imports. Add at most 3 focused tests using the existing imports.' : 'Return JSON {"optimizedCode":"full corrected file"}.'}
${systemTestPromptRules({executionMode: (()=>{try{return JSON.parse(instruction).executionMode;}catch{return 'frontend';}})(),repair:mode==='FIX_BREAKPOINT'})}
Return one to three independent new tests for distinct supplied gaps. Use existing imports and preserve baseline code. Runtime evidence may inform locator mechanics, never redefine Expected.`, { temperature: 0.2, maxOutputTokens: mode === 'BOOST_COVERAGE' ? 5000 : 12000, responseMimeType:'application/json',maxAttempts:2,totalTimeoutMs:150000 });
    } catch (error) { if(['AI_QUOTA_EXCEEDED','AI_JOB_BUDGET_EXCEEDED'].includes(error.code) || error.statusCode === 409) throw error; throw new ServiceError('AI provider unavailable; no proposal was verified or applied', 503); }
    const result = extractBoosterResponse(response);
    if(result.additionalTests) {
        if(mode !== 'BOOST_COVERAGE') throw new ServiceError('Append-only output is not a breakpoint repair',422);
        const combined=analyzeSystemTestFile({content:existingCode+'\n'+result.additionalTests,filePath});
        const original=analyzeSystemTestFile({content:existingCode,filePath});
        const addedCount=combined.scenarioSites.length-original.scenarioSites.length;
        if(addedCount<1 || addedCount>3) throw new ServiceError('AI must add between one and three focused tests',422);
        result.optimizedCode=existingCode+'\n\n'+result.additionalTests;
    }
    const {ast} = validateGeneratedTestCode(result.optimizedCode);
    walkAst(ast,node=>{
        if(node.type === 'Identifier' && ['process','globalThis','require'].includes(node.name)) throw new ServiceError('AI proposals cannot access host globals or credentials',422);
        if(node.type === 'ImportDeclaration' && node.source.value !== '@playwright/test' && !node.source.value.startsWith('.')) throw new ServiceError('AI proposals may only use Playwright and existing relative helpers',422);
    });
    let analysis = preserveTestIntent(existingCode, result.optimizedCode, filePath, mode);
    let quality;
    try {
        if(mode==='BOOST_COVERAGE'){
            const retained=retainValidAdditionalTests(existingCode,result.optimizedCode,filePath);
            result.optimizedCode=retained.content;quality=retained.quality;
            analysis=preserveTestIntent(existingCode,result.optimizedCode,filePath);
        }else quality=validateAdditionalTestQuality(existingCode,result.optimizedCode,filePath);
    }
    catch (error) { error.rejectedAdditionalTests = result.optimizedCode.slice(-6000); throw error; }
    const previousTitles = new Set(analyzeSystemTestFile({content:existingCode,filePath}).scenarioSites.map(site=>site.title));
    const addedScenarios=analysis.scenarioSites.filter(site=>!previousTitles.has(site.title)).map(site=>site.title);
    if(mode === 'BOOST_COVERAGE' && (addedScenarios.length<1 || addedScenarios.length>3)) throw new ServiceError('AI must propose one to three additional tests; no update was applied',422);
    return { success: true, state: 'DRAFT', verificationStatus: 'NOT_VERIFIED', mode, filePath,
        optimizedCode: result.optimizedCode, quality, promptBudget:{characters:budget.promptCharacters,sourceCharacters:budget.sourceCharacters,selectedGaps:budget.selectedGapCount}, explanation: 'AI proposed test code. Execution, requirement correctness and coverage improvement have not been verified.', addedScenarios };
};
