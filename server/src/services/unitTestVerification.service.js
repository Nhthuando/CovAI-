import path from 'node:path';
import { parse } from '@babel/parser';

export const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'];

const normalized = value => String(value || '').replaceAll('\\', '/');
const sameFile = (reported, target, rootDir) => {
    const absolute = value => normalized(path.resolve(rootDir, value));
    const a = absolute(reported);
    const b = absolute(target);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};

// A runner exit code and at least one passing suite do not prove that a batch ran.
export function verifyUnitTestBatch({ rootDir, testFiles = [], results, exitCode, error, allowedSkippedByFile = {} }) {
    const reasons = [];
    const suites = Array.isArray(results?.testResults) ? results.testResults : [];
    const files = [...new Set(testFiles)];
    if (!files.length) reasons.push('EMPTY_BATCH');
    const perFile = files.map(testFile => {
        const suite = suites.find(item => sameFile(item.name || item.testFilePath, testFile, rootDir));
        const assertions = suite?.assertionResults || [];
        const failed = assertions.filter(item => item.status === 'failed').length;
        const skippedAssertions = assertions.filter(item => ['pending', 'skipped', 'todo', 'disabled'].includes(item.status));
        const skipped = skippedAssertions.length;
        const unexpectedSkips = skippedAssertions.filter(item => !(allowedSkippedByFile[testFile] || []).includes(item.fullName || [...(item.ancestorTitles || []), item.title].join(' '))).length;
        const passed = assertions.filter(item => item.status === 'passed').length;
        const valid = Boolean(suite && suite.status === 'passed' && passed > 0 && failed === 0 && unexpectedSkips === 0 && !suite.message);
        return { testFile, valid, passed, failed, skipped, reason: !suite ? 'SUITE_NOT_EXECUTED' : !passed ? 'NO_TESTS_EXECUTED' : !valid ? 'SUITE_INCOMPLETE' : null };
    });
    if (perFile.some(file => !file.valid)) reasons.push('BATCH_INCOMPLETE');

    const allTargetFilesValid = files.length > 0 && perFile.every(file => file.valid);
    const targetSuites = suites.filter(suite =>
        files.some(targetFile => sameFile(suite.name || suite.testFilePath, targetFile, rootDir))
    );
    const targetFailedAssertions = targetSuites.reduce((n, s) => n + (s.assertionResults || []).filter(item => item.status === 'failed').length, 0);
    const targetFailedSuites = targetSuites.filter(s => s.status === 'failed').length;

    if (files.length > 0) {
        if (targetFailedAssertions > 0 || targetFailedSuites > 0 || perFile.some(f => f.failed > 0)) {
            reasons.push('TESTS_FAILED');
        }
        if ((exitCode !== 0 || error) && !allTargetFilesValid) {
            reasons.push('RUNNER_FAILED');
        }
    } else {
        if (exitCode !== 0 || error) reasons.push('RUNNER_FAILED');
        if (results?.success === false || results?.numFailedTestSuites > 0 || results?.numFailedTests > 0) reasons.push('TESTS_FAILED');
    }

    return { valid: reasons.length === 0, reasons, perFile,
        totalTests: suites.reduce((total, suite) => total + (suite.assertionResults?.length || 0), 0),
        passedTests: suites.reduce((total, suite) => total + (suite.assertionResults || []).filter(item => item.status === 'passed').length, 0),
        failedTests: suites.reduce((total, suite) => total + (suite.assertionResults || []).filter(item => item.status === 'failed').length, 0) };
}

function unwrapExpression(node) {
    let curr = node;
    while (curr && (curr.type === 'TSAsExpression' || curr.type === 'TSTypeAssertion' || curr.type === 'TypeCastExpression' || curr.type === 'ParenthesizedExpression')) {
        curr = curr.expression;
    }
    return curr;
}

function extractRequireInfo(node) {
    const unwrapped = unwrapExpression(node);
    if (!unwrapped || typeof unwrapped !== 'object') return null;
    if (unwrapped.type === 'CallExpression' && unwrapped.callee?.type === 'Identifier' && unwrapped.callee.name === 'require' && unwrapped.arguments?.[0]?.type === 'StringLiteral') {
        return { source: unwrapped.arguments[0].value, member: null };
    }
    if (unwrapped.type === 'MemberExpression') {
        const base = extractRequireInfo(unwrapped.object);
        if (base) {
            const propName = unwrapped.property?.name || (unwrapped.property?.type === 'StringLiteral' ? unwrapped.property.value : null);
            return {
                source: base.source,
                member: base.member ? `${base.member}.${propName}` : propName
            };
        }
    }
    return null;
}

// Compare test callback ASTs rather than whitespace. Repairs to newly generated
// code must never weaken an existing assertion or turn an existing skip on/off.
export function existingTestContractsPreserved(before, after) {
    const contracts = code => {
        const ast = parse(code || '', { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'], allowReturnOutsideFunction: true });
        const result = new Map();
        const add = value => {
            const key = JSON.stringify(value, (name, item) => ['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(name) ? undefined : item);
            result.set(key,(result.get(key) || 0) + 1);
        };
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'FunctionDeclaration') add(node);
            if (node.type === 'VariableDeclaration') {
                const nonRequireDeclarators = [];
                for (const decl of node.declarations || []) {
                    const reqInfo = extractRequireInfo(decl.init);
                    if (reqInfo) {
                        if (decl.id.type === 'ObjectPattern') {
                            for (const prop of decl.id.properties || []) {
                                if (prop.type === 'ObjectProperty') {
                                    add(['requireProp', reqInfo.source, reqInfo.member, prop]);
                                } else if (prop.type === 'RestElement') {
                                    add(['requireRest', reqInfo.source, reqInfo.member, prop.argument?.name]);
                                }
                            }
                        } else if (decl.id.type === 'Identifier') {
                            add(['requireId', reqInfo.source, reqInfo.member, decl.id.name]);
                        } else {
                            add(['requirePattern', reqInfo.source, reqInfo.member, decl.id]);
                        }
                    } else {
                        nonRequireDeclarators.push(decl);
                    }
                }
                if (nonRequireDeclarators.length > 0) {
                    if (nonRequireDeclarators.length === node.declarations.length) {
                        add(node);
                    } else {
                        add({ ...node, declarations: nonRequireDeclarators });
                    }
                }
            }
            if (node.type === 'ExpressionStatement' && node.expression?.type === 'CallExpression') {
                const unwrapped = unwrapExpression(node.expression);
                if (unwrapped.callee?.type === 'Identifier' && unwrapped.callee.name === 'require' && unwrapped.arguments?.[0]?.type === 'StringLiteral') {
                    add(['sideEffectRequire', unwrapped.arguments[0].value]);
                }
            }
            if (node.type === 'ImportDeclaration') {
                if (!node.specifiers.length) add(['sideEffectImport',node.source.value]);
                for (const specifier of node.specifiers) add(['import',node.source.value,node.importKind,specifier]);
            }
            if (node.type === 'CallExpression') {
                let callee = node.callee;
                const modifiers = [];
                while (callee?.type === 'MemberExpression') { modifiers.unshift(callee.property.name || callee.property.value); callee = callee.object; }
                if (['test', 'it', 'xtest', 'xit'].includes(callee?.name) && node.arguments?.[0]?.type === 'StringLiteral') {
                    const callback = node.arguments.find(argument => ['FunctionExpression', 'ArrowFunctionExpression'].includes(argument.type));
                    add([callee.name, modifiers, node.arguments[0].value, callback]);
                }
                if (['jest','vi'].includes(callee?.name) && ['mock','doMock','unstable_mockModule','spyOn'].includes(modifiers[0])) add(node);
            }
            for (const [key, value] of Object.entries(node)) {
                if (['loc','tokens','comments'].includes(key)) continue;
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(ast);
        return result;
    };
    try {
        const oldContracts = contracts(before);
        const newContracts = contracts(after);
        return [...oldContracts].every(([key, count]) => (newContracts.get(key) || 0) >= count);
    } catch { return false; }
}

export function coverageGoalStatus(summary) {
    if (!summary || !COVERAGE_METRICS.every(key => Number.isInteger(summary[key]?.total) && Number.isInteger(summary[key]?.covered) && summary[key].total >= 0 && summary[key].covered >= 0 && summary[key].covered <= summary[key].total)) return 'UNAVAILABLE';
    return COVERAGE_METRICS.every(key => summary[key].covered === summary[key].total) ? 'MET' : 'NOT_MET';
}
