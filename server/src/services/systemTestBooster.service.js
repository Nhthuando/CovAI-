import fs from 'node:fs';
import { containedPath } from './fullSystemConfig.service.js';
import { collectSystemGenerationContext } from './systemGenerationContext.service.js';
import { generateText } from './gemini.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';
import { preserveTestIntent, analyzeSystemTestFile, walkAst } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const extractBoosterResponse = raw => {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
        const result = JSON.parse(text);
        if (typeof result.optimizedCode !== 'string' || !result.optimizedCode.trim()) throw new Error();
        return result;
    } catch { throw new ServiceError('AI returned an invalid test proposal', 422); }
};
// Kept as explicit failure for older callers; generic smoke tests cannot claim improvement.
export const generateFallbackBoosterScenarios = () => { throw new ServiceError('AI is unavailable; no coverage improvement has been generated', 503); };
export const generateFallbackBreakpointFix = () => { throw new ServiceError('Automatic fallback cannot safely establish the intended repair', 503); };
export const optimizeSystemTest = async ({ rootDir, filePath, mode = 'BOOST_COVERAGE', instruction = '', scenarioData = null, dependencies = {} }) => {
    if (!['BOOST_COVERAGE', 'FIX_BREAKPOINT'].includes(mode)) throw new ServiceError('Unsupported proposal mode', 400);
    const target = containedPath(rootDir, filePath);
    if (!fs.existsSync(target)) throw new ServiceError('Test file not found', 404);
    const existingCode = fs.readFileSync(target, 'utf8');
    if (Buffer.byteLength(existingCode) > 256 * 1024) throw new ServiceError('Test file exceeds 256 KiB', 413);
    const context = collectSystemGenerationContext(rootDir);
    let response;
    try {
        response = await (dependencies.generate || generateText)(JSON.stringify({
            filePath, existingCode, instruction, failure: scenarioData,
            routes: context.routes, uiActions: context.uiActions, clientApiCalls: context.clientApiCalls,
            sourceCode: context.sourceCode, omittedFiles: context.omittedFiles,
        }), `Return JSON {"optimizedCode":"full file", "explanation":"proposal rationale"}.
Only propose tests justified by the supplied source and instruction. Do not claim measured coverage or quality improvement.
Preserve existing imports, scenarios, assertions, matchers and expected values. For BOOST_COVERAGE preserve all existing scenario code and append independent tests.
For FIX_BREAKPOINT fix action mechanics only; never weaken an assertion. Do not skip tests or catch and ignore failures.`, { temperature: 0.2 });
    } catch { throw new ServiceError('AI provider unavailable; no proposal was verified or applied', 503); }
    const result = extractBoosterResponse(response);
    const {ast} = validateGeneratedTestCode(result.optimizedCode);
    walkAst(ast,node=>{
        if(node.type === 'Identifier' && ['process','globalThis','require'].includes(node.name)) throw new ServiceError('AI proposals cannot access host globals or credentials',422);
        if(node.type === 'ImportDeclaration' && node.source.value !== '@playwright/test' && !node.source.value.startsWith('.')) throw new ServiceError('AI proposals may only use Playwright and existing relative helpers',422);
    });
    const analysis = preserveTestIntent(existingCode, result.optimizedCode, filePath, mode);
    const previousTitles = new Set(analyzeSystemTestFile({content:existingCode,filePath}).scenarioSites.map(site=>site.title));
    return { success: true, state: 'DRAFT', verificationStatus: 'NOT_VERIFIED', mode, filePath,
        optimizedCode: result.optimizedCode, explanation: 'AI proposed test code. Execution, requirement correctness and coverage improvement have not been verified.', addedScenarios: analysis.scenarioSites.filter(site=>!previousTitles.has(site.title)).map(site=>site.title) };
};
