import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import traverseModule from '@babel/traverse';
import { getParserPlugins, parseJavaScriptCode } from './babelParser.service.js';
import { localFile, testBlocks, importedSource } from './generatedTestInputRepair.service.js';
import { sourceInputContracts, inputContractViolations } from './unitTestInputContracts.service.js';
import { validateAndNormalizeMocks } from './mockValidation.service.js';
import { testContentHash } from './unitTestChangeSet.service.js';
import { cleanStoragePath, cleanStorageText } from '../utils/pathSanitizer.js';
import { isVitestTestCode, normalizeTestFrameworkCode } from './testFrameworkNormalization.service.js';
import { findIstanbulCoverageEntry } from './coverageVerification.service.js';
import { mongooseDocumentFixtureViolations, preserveMongooseSchemaInDraft } from './mongooseModelDraft.service.js';
import { analyzeMongooseSchemas } from './mongooseSchemaAnalyzer.service.js';
import { frameworkCompatibilityFindings } from './testFrameworkCapabilities.service.js';
import { classifyReportedFailure } from './testFailureClassifier.service.js';
import { hoistGeneratedVitestMocks, vitestHoistingFindings } from './vitestMockHoisting.service.js';

const require = createRequire(import.meta.url);
const jestRequire = createRequire(require.resolve('babel-jest'));
const jestHoist = jestRequire('babel-plugin-jest-hoist');
const traverse = traverseModule.default || traverseModule;

const categories = {
    A: 'INCORRECT_EXPECTATION', B: 'INVALID_FIXTURE', C: 'SOURCE_DEFECT',
    D: 'REQUIREMENT_MISMATCH', E: 'MOCK_OR_ENVIRONMENT', F: 'UNKNOWN',
};
const bounded = value => cleanStorageText(String(value ?? '')).slice(0, 1200);
const boundedValue = value => {
    if (value == null) return null;
    try { return bounded(typeof value === 'string' ? value : JSON.stringify(value)); }
    catch { return null; }
};
const relative = (root, file) => path.relative(root, file).replaceAll('\\', '/');

function finding(code, context, details) {
    return {
        ...context, ...details, code, classification: details.classification || categories[code],
        confidence: details.confidence || 'high',
    };
}

// Only direct, unconditional primitive returns are evaluated statically. No
// imported project code, getters, function calls or generated code is executed.
function literalExport(program, name) {
    for (const statement of program.body) {
        if (statement.type !== 'ExportNamedDeclaration') continue;
        const declaration = statement.declaration;
        const fn = declaration?.type === 'FunctionDeclaration' && declaration.id?.name === name ? declaration
            : declaration?.declarations?.find(entry => entry.id.name === name)?.init;
        if (!fn?.params || fn.async || fn.generator || fn.params.some(param => param.type !== 'Identifier')) continue;
        const body = fn.body;
        const single = body?.type === 'BlockStatement' && body.body.length === 1 ? body.body[0] : null;
        if (single?.type === 'ThrowStatement' && single.argument.type === 'NewExpression' &&
            ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(single.argument.callee.name) &&
            single.argument.arguments[0]?.type === 'StringLiteral') {
            return { value: single.argument.arguments[0].value, line: single.loc.start.line, throws: true };
        }
        const value = body?.type === 'BlockStatement' && body.body.length === 1 && body.body[0].type === 'ReturnStatement'
            ? body.body[0].argument : body?.type !== 'BlockStatement' ? body : null;
        if (value && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(value.type)) {
            return { value: value.type === 'NullLiteral' ? null : value.value, line: value.loc.start.line };
        }
    }
    return null;
}

function simpleExpectation(call) {
    if (!call.isCallExpression() || !call.get('callee').isMemberExpression()) return null;
    const receiver = call.get('callee.object');
    if (!receiver.isCallExpression() || receiver.node.callee.name !== 'expect') return null;
    const method = call.node.callee.property.name;
    return { method, actual: receiver.get('arguments.0'), expected: call.get('arguments.0') };
}

function provenLiteral(node) {
    if (!node || !['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return undefined;
    return node.type === 'NullLiteral' ? null : node.value;
}

function callContract(actual, testFile, rootDir, source) {
    let call = actual;
    if (call?.isArrowFunctionExpression() && !call.get('body').isBlockStatement()) call = call.get('body');
    if (actual?.isIdentifier()) {
        const local = actual.scope.getBinding(actual.node.name);
        if (local?.constant && local.path.isVariableDeclarator()) call = local.path.get('init');
    }
    if (!source || !call?.isCallExpression() || importedSource(call, testFile, rootDir) !== source) return null;
    const binding = call.scope.getBinding(call.node.callee.name);
    const functionName = binding?.path.node.imported?.name;
    if (!functionName) return null;
    const args = call.node.arguments.map(provenLiteral);
    return { functionName, input: args.includes(undefined) ? null : JSON.stringify([functionName, args]) };
}

function authoredExpectations(original, testFile, rootDir, source) {
    const requirements = new Map();
    for (const block of testBlocks(original)) {
        block.callback.traverse({ CallExpression(call) {
            const assertion = simpleExpectation(call);
            if (!assertion || !['toBe', 'toEqual', 'toStrictEqual', 'toThrow'].includes(assertion.method)) return;
            const contract = callContract(assertion.actual, testFile, rootDir, source);
            const value = provenLiteral(assertion.expected?.node);
            if (!contract?.input || value === undefined) return;
            const key = (assertion.method === 'toThrow' ? 'throw:' : 'return:') + contract.input;
            const entries = requirements.get(key) || [];
            entries.push({ testCaseId: block.fullName, value });
            requirements.set(key, entries);
        } });
    }
    return requirements;
}

function inspectMockInitialization(ast, runner, context) {
    const findings = [];
    traverse(ast, { CallExpression(call) {
        const { callee, arguments: args } = call.node;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.object.name !== runner) return;
        const method = callee.property.name;
        const report = (reason, evidence) => findings.push(finding('E', context, {
            line: call.node.loc?.start.line, reason, evidence, correction: 'Correct the mock setup and revalidate the draft.',
            ...(runner === 'jest' ? { classification: 'MOCK_HOISTING_ERROR' } : {}),
        }));
        if (method === 'spyOn' && args.length < 2) {
            report(runner + '.spyOn requires an object and a method name.', ['SPY_SIGNATURE']);
        }
        if (method === 'fn' && args[0] && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'ObjectExpression', 'ArrayExpression'].includes(args[0].type)) {
            report(runner + '.fn expects an implementation function.', ['MOCK_IMPLEMENTATION_SIGNATURE']);
        }
        if (runner === 'jest' && ['mock', 'doMock'].includes(method)) {
            const options = args[2];
            const virtual = options?.type === 'ObjectExpression' && options.properties.find(property =>
                property.type === 'ObjectProperty' && (property.key.name || property.key.value) === 'virtual');
            if (virtual && virtual.value.type !== 'BooleanLiteral') {
                report('The Jest virtual option must be a boolean literal.', ['MOCK_INVALID_VIRTUAL_OPTION']);
            }
            const specifier = args[0]?.type === 'StringLiteral' && args[0].value;
            const requiresModule = expression => expression?.type === 'CallExpression' &&
                expression.callee.name === 'require' && expression.arguments[0]?.value === specifier;
            if (method === 'doMock' && specifier && ast.program.body.some(statement =>
                (statement.type === 'ImportDeclaration' && !statement.importKind?.includes('type') && statement.source.value === specifier) ||
                (statement.start < call.node.start && (statement.declarations?.some(entry => requiresModule(entry.init)) ||
                    requiresModule(statement.expression))))) {
                report('jest.doMock cannot replace a dependency already loaded by an import or require.', ['MOCK_INITIALIZATION_ORDER']);
            }
        }
    } });
    return findings;
}

export function inspectUnitTestQuality({ rootDir, testFile, sourceFile, code, original = '', framework }) {
    const context = { testFile, sourceFile: sourceFile || null };
    const cases = [];
    const findings = [];
    if (code === original) return { cases, findings };
    const parsed = parseJavaScriptCode(code, { filePath: testFile });
    if (!parsed.success) {
        findings.push(finding('E', context, {
            reason: 'The candidate cannot be parsed.',
            evidence: [bounded(parsed.error)], correction: 'Correct the test syntax.',
        }));
        return { cases, findings };
    }
    const base = new Map(testBlocks(original).map(block => [block.fullName, original.slice(block.node.start, block.node.end)]));
    const mocks = validateAndNormalizeMocks({ code, filePath: testFile, sourceFile, rootDir, framework });
    const runner = framework === 'vitest' || (!framework && isVitestTestCode(code)) ? 'vi' : 'jest';
    for (const issue of frameworkCompatibilityFindings(parsed.ast, runner === 'vi' ? 'vitest' : 'jest')) {
        findings.push(finding('E', context, {
            classification: 'FRAMEWORK_COMPATIBILITY_ERROR', line: issue.line, api: issue.api,
            reason: `'${issue.api}' is incompatible with the selected test runner.`,
            evidence: [issue.api], correction: 'Use the equivalent API for the selected runner.',
        }));
    }
    findings.push(...inspectMockInitialization(parsed.ast, runner, context));
    if (runner === 'vi') {
        for (const diagnostic of vitestHoistingFindings(parsed.ast)) findings.push(finding('E', context, {
            ...diagnostic, classification: 'VITEST_MOCK_HOISTING_ERROR',
            correction: 'Initialize shared mock functions with vi.hoisted before the factory registers.',
        }));
    }
    for (const diagnostic of mocks.diagnostics.filter(item => item.severity === 'error' || item.rule === 'UNMOCKED_SPY_ASSERTION')) {
        findings.push(finding('E', context, {
            line: diagnostic.line, sourceLine: diagnostic.sourceLine, reason: diagnostic.message, evidence: [diagnostic.rule],
            classification: diagnostic.rule === 'UNMOCKED_SPY_ASSERTION' ? diagnostic.rule : 'MOCK_BINDING_ERROR',
            ...(runner === 'jest' && /^MOCK_(?:FACTORY|HOIST|NOT_TOP_LEVEL|INVALID_VIRTUAL|MISSING_EXPORT)/.test(diagnostic.rule)
                ? { classification: 'MOCK_HOISTING_ERROR' } : {}),
            correction: 'Correct the mock binding or factory and regenerate the draft.',
        }));
    }
    if (mocks.repairs.some(item => ['SELF_MOCK_REMOVED', 'MOCK_MISSING_EXPORT'].includes(item.rule))) {
        findings.push(finding('E', context, {
            reason: 'A mock replaces the source under test or lacks a required export.',
            ...(runner === 'jest' ? { classification: 'MOCK_HOISTING_ERROR' } : {}),
            evidence: mocks.repairs.filter(item => ['SELF_MOCK_REMOVED', 'MOCK_MISSING_EXPORT'].includes(item.rule)).map(item => item.detail),
            correction: 'Run the real function under test and explicitly provide the dependency exports the fixture needs.',
        }));
    }
    if (runner === 'jest' && /\bjest\s*\.\s*mock\s*\(/.test(code)) {
        try {
            transformSync(code, { filename: path.basename(testFile), configFile: false, babelrc: false,
                parserOpts: { plugins: getParserPlugins(/\.[jt]sx$/i.test(testFile)) },
                plugins: [jestHoist], ast: false, code: false, cloneInputAst: false });
        } catch (error) {
            const message = error.message.split(/\r?\n/).filter(line => !/^\s*Allowed objects:/.test(line)).join('\n');
            findings.push(finding('E', context, {
                reason: 'Jest cannot hoist this mock.',
                classification: 'MOCK_HOISTING_ERROR',
                evidence: [bounded(message)], correction: 'Use an inline factory and initialize its dependencies inside the factory.',
            }));
        }
    }
    const absoluteTest = path.resolve(rootDir, testFile);
    const source = sourceFile && localFile(rootDir, path.resolve(rootDir, sourceFile));
    const sourceCode = source ? fs.readFileSync(source, 'utf8') : '';
    if (preserveMongooseSchemaInDraft({ code, sourceCode, original, framework: runner === 'vi' ? 'vitest' : 'jest' }) !== code) {
        findings.push(finding('E', context, {
            reason: 'A generated Mongoose mock replaces the schema or model under test.',
            evidence: ['Mongoose model validation must run against the real schema.'],
            correction: 'Regenerate the draft with real schema validation and mocked database connections.',
        }));
    }
    const contract = source && sourceInputContracts(sourceCode, { rootDir, sourceFile: source });
    for (const route of contract?.requestRoutes || []) {
        if (route.potentialConflict) findings.push(finding('C', context, {
            classification: 'POTENTIAL_SOURCE_DEFECT', confidence: 'medium', functionName: route.functionName,
            sourceLine: route.potentialConflict.line,
            reason: 'The registered middleware assigns a scalar to req.user, but the controller reads a nested property.',
            evidence: [route.potentialConflict.access, `${route.file}:${route.line}`, ...route.middleware.flatMap(item =>
                item.writes.map(write => `${item.file}:${write.line} assigns ${write.valueKind}`))],
            correction: 'Confirm the middleware and controller contract before changing fixtures.',
        }));
    }
    const sourceAst = source && parseJavaScriptCode(sourceCode, { filePath: sourceFile });
    const isolatedDefects = [];
    if (sourceAst?.success) {
        const blocks = testBlocks(code);
        for (const { name, line } of unboundCommonJsExports(sourceAst.ast)) {
            // Symbol-level attribution: only test cases that reference the unbound export are quarantined,
            // so valid sibling tests (e.g. verifyPayment) remain READY.
            const symbolPattern = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`);
            const testCaseIds = blocks
                .filter(block => symbolPattern.test(code.slice(block.callback.node.start, block.callback.node.end)) ||
                    symbolPattern.test(block.title || ''))
                .map(block => block.fullName);
            const diagnostic = `Source defect at ${sourceFile}:${line}: '${name}' is exported but never declared or imported.`;
            findings.push(finding('C', context, {
                classification: 'POTENTIAL_SOURCE_DEFECT', confidence: 'medium', sourceLine: line,
                defectSymbol: name, defectScope: 'EXPORT_SYMBOL', isolatedTestCaseIds: testCaseIds,
                reason: `The source exports '${name}' without declaring or importing it.`,
                evidence: [bounded(sourceCode.split(/\r?\n/)[line - 1])],
                correction: 'Restore the intended source implementation or confirm that the export should be removed.',
            }));
            isolatedDefects.push({ symbol: name, file: sourceFile, line, testFile, testCaseIds, diagnostic });
        }
    }
    const schemas = /['"]mongoose['"]/.test(sourceCode) ? analyzeMongooseSchemas(sourceCode) : [];
    const requirements = authoredExpectations(original, absoluteTest, rootDir, source);
    const seenTitles = new Set();
    for (const block of testBlocks(code)) {
        if (seenTitles.has(block.fullName) && !base.has(block.fullName)) {
            findings.push(finding('D', { ...context, testCaseId: block.fullName }, {
                reason: 'Multiple generated cases have the same full test name.',
                evidence: ['Duplicate test registration.'], correction: 'Keep one case per distinct intent and use unique test names.',
            }));
        }
        seenTitles.add(block.fullName);
        if (base.get(block.fullName) === code.slice(block.node.start, block.node.end)) continue;
        const testCase = { ...context, testCaseId: block.fullName, line: block.node.loc?.start.line };
        cases.push(testCase);
        const assertions = [];
        block.callback.traverse({ CallExpression(call) {
            const assertion = simpleExpectation(call);
            if (assertion) assertions.push(assertion);
        } });
        // A rejected-input test intentionally uses out-of-contract data.
        const testsRejection = /\b(?:invalid|reject|error|throw|malformed|fail|missing|empty|undefined|null|non.array)\b/i.test(block.title)
            || assertions.some(item => item.method === 'toThrow')
            || /\.validateSync\s*\(\s*\)\s*(?:\?\.\s*errors|\.\s*errors)/.test(code.slice(block.callback.node.start, block.callback.node.end));
        if (!testsRejection && contract) {
            for (const violation of inputContractViolations(block, absoluteTest, rootDir, source, contract.functions)) {
                findings.push(finding('B', testCase, {
                    functionName: violation.functionName, reason: violation.reason,
                    sourceLine: violation.evidence?.line,
                    classification: violation.parameter === 'req' || violation.parameter === 'res' || violation.parameter === 'next'
                        ? 'SOURCE_CONTRACT_MISMATCH' : 'INVALID_FIXTURE',
                    evidence: [violation.evidence?.access, violation.parameter, bounded(code.slice(violation.callStart, violation.callStart + 160))].filter(Boolean),
                    correction: 'Provide a fixture that satisfies the source contract or explicitly test rejection.',
                }));
            }
        }
        if (!testsRejection && schemas.length === 1 && /\b(?:valid|success|default)\b/i.test(block.title)) {
            for (const violation of mongooseDocumentFixtureViolations(block.callback, schemas[0], absoluteTest, source)) {
                findings.push(finding('B', testCase, {
                    line: violation.line, sourceLine: violation.schemaLine, reason: violation.reason,
                    evidence: ['Required and enum constraints come from the declared model schema.'],
                    correction: 'Use a fixture that satisfies the declared schema for this success case.',
                }));
            }
        }
        for (const { actual, expected, method } of assertions) {
            if (!['toBe', 'toEqual', 'toStrictEqual', 'toThrow'].includes(method)) continue;
            const expectedValue = provenLiteral(expected?.node);
            if (expectedValue === undefined) continue;
            if (provenLiteral(actual?.node) !== undefined && assertions.length === 1) {
                findings.push(finding('D', testCase, {
                    assertion: method, expected: expectedValue, actual: provenLiteral(actual.node),
                    reason: 'The only assertion compares literals without observing source behavior.',
                    evidence: ['Both assertion operands are static literals.'],
                    correction: 'Assert a return value, error, or observable effect of the target.',
                }));
            }
            const target = sourceAst?.success && callContract(actual, absoluteTest, rootDir, source);
            if (!target) continue;
            const { functionName, input } = target;
            const literal = literalExport(sourceAst.ast.program, functionName);
            if (!literal || (method === 'toThrow') !== Boolean(literal.throws)) continue;
            if (literal.throws ? typeof expectedValue !== 'string' || literal.value.includes(expectedValue) : Object.is(literal.value, expectedValue)) continue;
            const precedent = input ? requirements.get((literal.throws ? 'throw:' : 'return:') + input) || [] : [];
            const supportedByExistingTest = precedent.length && precedent.every(item => Object.is(item.value, expectedValue));
            findings.push(finding(supportedByExistingTest ? 'C' : 'A', testCase, {
                assertion: method, expected: expectedValue, actual: literal.value, functionName, sourceLine: literal.line,
                ...(supportedByExistingTest ? {} : { classification: 'INVALID_ASSERTION' }),
                reason: supportedByExistingTest
                    ? 'The source contradicts the expectation already encoded by an unchanged test for the same input.'
                    : 'The assertion conflicts with the unconditional source behavior.',
                evidence: [bounded(sourceCode.split(/\r?\n/)[literal.line - 1]),
                    ...precedent.map(item => 'Existing test: ' + item.testCaseId)],
                correction: supportedByExistingTest ? 'Confirm the existing requirement and propose a source fix for review.'
                    : 'Review the requirement before changing the test or proposing a source fix.',
                confidence: 'medium',
            }));
        }
    }
    return { cases, findings, isolatedDefects };
}

export function analyzeUnitTestFailures({ rootDir, items, results, output = '' }) {
    const failures = [];
    for (const suite of results?.testResults || []) {
        const reported = suite.name || suite.testFilePath || '';
        const file = relative(rootDir, path.resolve(rootDir, reported));
        const normalized = cleanStoragePath(reported);
        const matches = items.filter(candidate => candidate.testFile === file || candidate.testFile === normalized ||
            normalized?.endsWith('/' + candidate.testFile));
        const item = matches.length === 1 ? matches[0] : null;
        if (!item || suite.status !== 'failed') continue;
        const assertions = suite.assertionResults?.filter(assertion => assertion.status === 'failed') || [];
        for (const assertion of assertions.length ? assertions : [null]) {
            const message = bounded(assertion ? assertion.failureMessages?.join('\n') : suite.message || suite.failureMessage || output);
            const detail = assertion?.failureDetails?.[0];
            const inline = message.match(/expected (.+?) to (?:strictly |deeply )?(?:equal|be) (.+?)(?:\s*\/\/|\r?$)/im);
            const expected = boundedValue(detail?.expected) ?? message.match(/^\s*Expected[^:\r\n]*:\s*(.+)$/m)?.[1] ?? inline?.[2];
            const actual = boundedValue(detail?.actual) ?? message.match(/^\s*Received[^:\r\n]*:\s*(.+)$/m)?.[1] ?? inline?.[1];
            const diagnosis = classifyReportedFailure(message, {
                framework: item.framework, hasComparison: expected != null && actual != null,
            });
            const sourceLine = item.sourceFile && message.split('\n').find(line => line.replaceAll('\\', '/').includes(item.sourceFile + ':'));
            const undefinedExport = item.sourceFile && findUnboundCommonJsExport(rootDir, item.sourceFile, message);
            if (undefinedExport) {
                failures.push(finding('C', { testFile: item.testFile, sourceFile: item.sourceFile, testCaseId: assertion?.fullName || assertion?.title || null }, {
                    classification: 'POTENTIAL_SOURCE_DEFECT', confidence: 'medium',
                    defectSymbol: undefinedExport.name, defectScope: 'EXPORT_SYMBOL',
                    sourceLine: undefinedExport.line, sourceLocation: sourceLine?.trim() || null,
                    reason: `The source exports '${undefinedExport.name}' without declaring or importing it.`,
                    evidence: [message], correction: 'Restore the intended source implementation or confirm that the export should be removed.',
                }));
                continue;
            }
            failures.push(finding(diagnosis?.code || 'F', {
                testFile: item.testFile, sourceFile: item.sourceFile || null,
                testCaseId: assertion?.fullName || assertion?.title || null,
            }, {
                assertion: expected !== undefined || actual !== undefined ? message.split('\n')[0] : null,
                expected: expected ?? null, actual: actual ?? null, sourceLocation: sourceLine?.trim() || null,
                ...diagnosis,
                reason: diagnosis?.reason || 'The failure alone does not establish the intended behavior.',
                evidence: message ? [message] : [],
                correction: diagnosis?.code === 'E' ? 'Check the dependency, mock and runner setup.' : 'Compare the fixture and assertion with an independent requirement before editing either.',
                confidence: diagnosis?.code === 'E' ? 'high' : 'low',
            }));
        }
    }
    if (!failures.length && output.trim()) {
        const diagnosis = classifyReportedFailure(output);
        failures.push(finding(diagnosis?.code || 'F', { testFile: null, testCaseId: null, sourceFile: null }, {
            ...diagnosis,
            reason: diagnosis?.reason || 'The runner did not report a failed generated case that could be classified.',
            evidence: [bounded(output)],
            correction: diagnosis ? 'Resolve the reported environment or runner error.' : 'Review the regression report and runner logs.',
            confidence: diagnosis ? 'high' : 'low',
        }));
    }
    return failures;
}

function findUnboundCommonJsExport(rootDir, sourceFile, message) {
    const name = message.match(/ReferenceError:\s*([A-Za-z_$][\w$]*) is not defined\b/)?.[1];
    if (!name) return null;
    const file = localFile(rootDir, path.resolve(rootDir, sourceFile));
    if (!file) return null;
    const parsed = parseJavaScriptCode(fs.readFileSync(file, 'utf8'), { filePath: sourceFile });
    if (!parsed.success) return null;
    return unboundCommonJsExports(parsed.ast).find(item => item.name === name) || null;
}

function unboundCommonJsExports(ast) {
    const exports = [];
    traverse(ast, {
        AssignmentExpression(p) {
            const { left, right } = p.node;
            if (!p.parentPath.parentPath?.isProgram() || left.type !== 'MemberExpression' || left.computed ||
                left.object.name !== 'module' || p.scope.getBinding('module') || left.property.name !== 'exports' ||
                right.type !== 'ObjectExpression') return;
            for (const property of right.properties) {
                if (property.type !== 'ObjectProperty' || property.value.type !== 'Identifier') continue;
                const name = property.value.name;
                if (!p.scope.getBinding(name) && !Object.hasOwn(globalThis, name)) exports.push({ name, line: property.loc.start.line });
            }
        },
    });
    return exports;
}

export function recordQualityAttempt(qualityGate, { rootDir, items, results, output, exitCode }) {
    const failures = analyzeUnitTestFailures({ rootDir, items, results, output: exitCode !== 0 ? output : '' });
    qualityGate.attempts.push({
        iteration: qualityGate.attempts.length, timestamp: new Date().toISOString(), exitCode, failures,
        candidates: items.map(({ testFile }) => ({
            testFile, hash: qualityFileHash(rootDir, testFile),
        })),
    });
    return failures;
}

export function proposeVerifiedFrameworkRepair(code, original, findings, options = {}) {
    if (findings.length && findings.every(finding => finding.classification === 'VITEST_MOCK_HOISTING_ERROR')) {
        const content = hoistGeneratedVitestMocks(code, { framework: 'vitest', original });
        return content === code ? null : { content, action: 'HOIST_VITEST_MOCK_BINDINGS' };
    }
    if (findings.length && findings.every(finding => finding.classification === 'UNMOCKED_SPY_ASSERTION')) {
        const runner = options.framework === 'vitest' || (!options.framework && isVitestTestCode(code)) ? 'vi' : 'jest';
        const spyLines = [];
        for (const f of findings) {
            const m = String(f.reason || '').match(/Assertion expects '([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)' to have been called/);
            if (m) {
                const [, obj, prop] = m;
                const stmt = `  if (typeof ${obj} !== 'undefined' && ${obj} && typeof ${obj}.${prop} === 'function') { ${runner}.spyOn(${obj}, '${prop}').mockImplementation(async () => []); }`;
                if (!spyLines.includes(stmt)) spyLines.push(stmt);
            }
        }
        if (spyLines.length > 0) {
            const hook = `beforeEach(() => {\n${spyLines.join('\n')}\n});\n`;
            const content = /beforeEach\s*\(/.test(code)
                ? code.replace(/(beforeEach\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{)/, `$1\n${spyLines.join('\n')}`)
                : `${code.trimEnd()}\n\n${hook}`;
            return content === code ? null : { content, action: 'INJECT_SPY_ON_BEFORE_EACH' };
        }
    }
    if (!findings.length || findings.some(finding => finding.classification !== 'FRAMEWORK_COMPATIBILITY_ERROR' ||
        finding.api !== 'toBeTypeOf')) return null;
    const normalize = value => normalizeTestFrameworkCode(value, { framework: 'jest', matcherOnly: true });
    if (normalize(original) !== original) return null;
    const content = normalize(code);
    return content === code ? null : { content, action: 'NORMALIZE_JEST_TYPEOF' };
}

export function qualityFileHash(rootDir, file) {
    const target = localFile(rootDir, path.resolve(rootDir, file));
    return target ? testContentHash(fs.readFileSync(target, 'utf8')) : null;
}

function coverageEntry(map, file) {
    return findIstanbulCoverageEntry(map, file);
}

function counterKeys(map) {
    const keys = new Map();
    const location = loc => loc && [loc.start.line, loc.start.column, loc.end.line, loc.end.column].join(':');
    for (const [id, meta] of Object.entries(map?.statementMap || {})) {
        keys.set('s:' + location(meta), { line: meta.start.line, hits: map.s?.[id] || 0 });
    }
    for (const [id, meta] of Object.entries(map?.branchMap || {})) {
        for (const [index, loc] of (meta.locations || []).entries()) {
            keys.set(['b', meta.type, location(meta.loc), index, location(loc)].join(':'), {
                branch: meta.type + ':' + (meta.line || meta.loc?.start.line), hits: map.b?.[id]?.[index] || 0,
            });
        }
    }
    return keys;
}

export function verifyQualityCoverage({ items, baseline, candidate }) {
    return items.filter(item => item.targetLines?.length || item.targetBranches?.length).map(item => {
        const before = counterKeys(coverageEntry(baseline, item.sourceFile));
        const after = counterKeys(coverageEntry(candidate, item.sourceFile));
        const gained = [...after].filter(([key, data]) => data.hits > 0 &&
            (!before.size || (before.has(key) && before.get(key).hits === 0)));
        const branches = [...new Set(gained.map(([, data]) => data.branch).filter(value => item.targetBranches?.includes(value)))];
        const lines = [...new Set(gained.map(([, data]) => data.line).filter(value => item.targetLines?.includes(value)))];
        return {
            testFile: item.testFile, sourceFile: item.sourceFile, lines, branches,
            verified: item.targetBranches?.length ? branches.length > 0 : lines.length > 0,
        };
    });
}
