import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import instrumentLibrary from 'istanbul-lib-instrument';
import coverageLibrary from 'istanbul-lib-coverage';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import { dockerRunner } from './dockerRunner.service.js';
import { ensureWorkspaceNodeModulesLinked, cleanupWorkspaceNodeModulesLinks, installPackageInWorkspace } from './dependencyResolution.service.js';
import { parseExistingTestAst } from './unitTestContextEngineering.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { loadWorkspaceEnv } from './environmentDetection.service.js';
import { collectUnitTestEnvironmentFiles, resolveUnitTestDependency } from './unitTestPreflight.service.js';

const traverse = traverseModule.default || traverseModule;
const { createInstrumenter } = instrumentLibrary;
const { createCoverageMap } = coverageLibrary;
const generate = generateModule.default || generateModule;
const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const ignored = new Set(['node_modules', '.git', 'coverage', '.covai-temp', '.covai_journal', '.covai_test_versions', 'dist', 'build']);
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const slash = text => text.replaceAll('\\', '/');

function contained(root, relative) {
    if (!relative || path.isAbsolute(relative)) throw new ServiceError('A relative project file path is required', 400);
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new ServiceError('File is outside the project', 400);
    const actual = fs.realpathSync(target);
    const actualRel = path.relative(fs.realpathSync(root), actual);
    if (actualRel.startsWith('..') || path.isAbsolute(actualRel)) throw new ServiceError('Symbolic links outside the project are not supported', 400);
    return target;
}

/** Adds events at Istanbul's actual counter sites. No expression is evaluated a
 * second time and branch outcomes retain Istanbul's provider-specific indices. */
export function instrumentTraceFile(code, file, role) {
    const parserPlugins = [...(/\.(?:ts|tsx|mts|cts)$/.test(file) ? ['typescript'] : []), ...(/\.(?:jsx|tsx)$/.test(file) ? ['jsx'] : [])];
    const instrumenter = createInstrumenter({ coverageVariable: '__covaiCaptureCoverage', esModules: true, compact: false, preserveComments: true, produceSourceMap: true, parserPlugins });
    const instrumented = instrumenter.instrumentSync(code, file);
    const coverage = instrumenter.fileCoverage;
    const ast = parse(instrumented, { sourceType: 'unambiguous', plugins: parserPlugins });
    traverse(ast, {
        UpdateExpression(p) {
            if (p.node.operator !== '++') return;
            let member = p.node.argument;
            const parts = [];
            while (member?.type === 'MemberExpression') {
                parts.unshift(member.computed ? member.property.value : member.property.name);
                member = member.object;
            }
            if (member?.type !== 'CallExpression' || !member.callee?.name?.startsWith('cov_') || !['s', 'b', 'f'].includes(parts[0])) return;
            const [kind, id, outcomeIndex] = parts;
            const location = kind === 's' ? coverage.statementMap[id] : kind === 'f' ? coverage.fnMap[id]?.loc : coverage.branchMap[id]?.locations[outcomeIndex];
            if (!location) return;
            const event = { file, role, kind, id: String(id), outcomeIndex, line: location.start.line, endLine: location.end.line };
            const call = parse(`globalThis.__covaiTraceHit?.(${JSON.stringify(event)})`, { sourceType: 'module' }).program.body[0].expression;
            p.replaceWith({ type: 'SequenceExpression', expressions: [call, p.node] });
            p.skip();
        },
    });
    return { code: generate(ast, { retainLines: true }).code, coverage };
}

// Only locations and counter IDs cross the process boundary. No arbitrary local
// variables, environment values, assertion payloads or raw runner logs are stored.
const collectorCode = `module.exports = function install(hooks, identities) {
  const fs = require('node:fs');
  let events = [], testId = null, testLocation = null, truncated = false;
  const maxEvents = 20000;
  hooks.beforeEach(() => { const name = hooks.expect.getState().currentTestName; testId = identities[name] || name; testLocation = null; });
  globalThis.__covaiTraceHit = event => {
    if (events.length >= maxEvents) { truncated = true; return; }
    if (event.role === 'test') testLocation = { file: event.file, line: event.line, endLine: event.endLine, column: 0 };
    events.push({ ...event, sequence: events.length, testId: testId || '<suite setup>', workerId: String(process.env.JEST_WORKER_ID || process.env.VITEST_WORKER_ID || '1'), testLocation });
  };
  hooks.afterEach(() => { events.push({ sequence: events.length, testId, type: 'TEST_END', testLocation }); testId = null; });
  hooks.afterAll(() => fs.writeFileSync('.covai-trace/events.json', JSON.stringify({ events, truncated, coverage: globalThis.__covaiCaptureCoverage || {} })));
};`;

function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }

function traceInputHash(rootDir, sourceFile, testFile) {
    const files = new Set(collectUnitTestEnvironmentFiles(rootDir, [sourceFile, testFile]));
    for (const file of fs.readdirSync(rootDir)) if (/^(?:package\.json|(?:jest|vitest|vite|babel|tsconfig)\..*\.(?:js|ts|mjs|cjs|json))$/.test(file)) files.add(file);
    return digest(JSON.stringify([...files].sort().map(file => [file, digest(fs.readFileSync(contained(rootDir, file)))])) +
        ['.env','.env.test'].map(file => fs.existsSync(path.join(rootDir,file)) ? fs.statSync(path.join(rootDir,file)).mtimeMs : null).join(':'));
}

export function findRecordedUnitTestTrace({ snapshotId, rootDir, sourceFilePath, testFilePath, testCaseTitle, workspaceRevision }) {
    if (!testFilePath) return null;
    const directory = path.join(serverRoot,'.covai-temp','unit-test-traces',digest(String(snapshotId)));
    if (!fs.existsSync(directory)) return null;
    const inputHash = traceInputHash(rootDir,sourceFilePath,testFilePath);
    const traces = fs.readdirSync(directory).filter(name => /^[a-f0-9-]{36}$/.test(name)).map(name => path.join(directory,name,'trace.json')).filter(file => fs.existsSync(file)).sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of traces.slice(0,20)) {
        try {
            const trace = readJson(file);
            if (trace.language === 'en' && trace.inputHash === inputHash && trace.workspaceRevision === workspaceRevision &&
                (trace.scope === 'suite' || [trace.testCase?.title,trace.testCase?.fullTitle].includes(testCaseTitle))) return trace;
        } catch { /* invalid artifacts do not become a synthetic successful trace */ }
    }
    return null;
}

export async function captureUnitTestTrace({ snapshotId, rootDir, sourceFilePath, testFilePath, testCaseId, testCaseTitle, category, scope = 'test', workspaceRevision = null, run = dockerRunner.run }) {
    const sourceFull = contained(rootDir, sourceFilePath);
    const testFull = contained(rootDir, testFilePath);
    const sourceCode = fs.readFileSync(sourceFull, 'utf8');
    const testCode = fs.readFileSync(testFull, 'utf8');
    if (/\b(?:test|it|describe)\.concurrent\b/.test(testCode)) throw new ServiceError('Runtime replay currently records sequential test cases. Concurrent cases require a separate async-context adapter.',422);
    const inputHash = traceInputHash(rootDir,sourceFilePath,testFilePath);
    const tests = parseExistingTestAst(testCode, testFilePath)?.tests || [];
    const selected = tests.find(test => [test.id, test.title, test.fullTitle].includes(testCaseId || testCaseTitle)) || tests.find(test => test.category === category) || tests[0];
    if (!selected) throw new ServiceError('Select a real runnable test before recording a trace', 409);
    const pkg = readJson(path.join(rootDir, 'package.json')) || {};
    const framework = /(?:from\s*['"]vitest|require\(['"]vitest)/.test(testCode) || pkg.devDependencies?.vitest && !pkg.devDependencies?.jest ? 'vitest' : 'jest';
    const runId = crypto.randomUUID();
    const artifactDir = path.join(serverRoot, '.covai-temp', 'unit-test-traces', digest(String(snapshotId)), runId);
    const workspace = path.join(artifactDir, 'workspace');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.cpSync(rootDir, workspace, { recursive: true, filter: file => file === rootDir || !ignored.has(path.basename(file)) && !/^\.env(?:\.|$)/.test(path.basename(file)) && !fs.lstatSync(file).isSymbolicLink() });
    const traceDir = path.join(workspace, '.covai-trace');
    fs.mkdirSync(traceDir, { recursive: true });
    const links = ensureWorkspaceNodeModulesLinked(rootDir, workspace);
    try {
        const sourceRel = slash(path.relative(rootDir, sourceFull));
        const testRel = slash(path.relative(rootDir, testFull));
        const source = instrumentTraceFile(sourceCode, sourceRel, 'source');
        const test = instrumentTraceFile(testCode, testRel, 'test');
        fs.writeFileSync(path.join(workspace, sourceRel), source.code);
        fs.writeFileSync(path.join(workspace, testRel), test.code);
        fs.writeFileSync(path.join(traceDir, 'collector.cjs'), collectorCode);
        const resolver = createRequire(path.join(workspace, 'package.json'));
        let binary;
        try { binary = resolver.resolve(framework === 'jest' ? 'jest/bin/jest' : 'vitest/vitest.mjs'); }
        catch {
            const installed = await installPackageInWorkspace({rootDir:workspace,packageName:framework,isDev:true});
            if (!installed.success) throw new ServiceError(`Unable to install ${framework} in the recording workspace`,409);
            binary = resolver.resolve(framework === 'jest' ? 'jest/bin/jest' : 'vitest/vitest.mjs');
        }
        const title = selected.runnerTitle || selected.fullTitle || selected.title;
        const pattern = `^${title.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&')}$`;
        let args;
        const identities = Object.fromEntries(tests.flatMap(test => [[test.fullTitle,test.runnerTitle || test.fullTitle],[test.runnerTitle || test.title,test.runnerTitle || test.title]]));
        if (framework === 'jest') {
            fs.writeFileSync(path.join(traceDir, 'setup.cjs'), `require('./collector.cjs')(require('@jest/globals'),${JSON.stringify(identities)});`);
            args = [binary, '--runInBand', '--runTestsByPath', testRel, '--coverage=false', '--json', '--outputFile=.covai-trace/results.json', ...(scope === 'suite' ? [] : [`--testNamePattern=${pattern}`]), '--setupFilesAfterEnv=./.covai-trace/setup.cjs'];
        } else {
            fs.writeFileSync(path.join(traceDir, 'setup.mjs'), `import { beforeEach, afterEach, afterAll, expect } from 'vitest'; import install from './collector.cjs'; install({beforeEach,afterEach,afterAll,expect},${JSON.stringify(identities)});`);
            const configName = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vite.config.ts', 'vite.config.js'].find(file => fs.existsSync(path.join(workspace, file)));
            const configImport = configName ? `import original from '../${configName}';` : 'const original = {};';
            fs.writeFileSync(path.join(traceDir, 'config.mjs'), `import { mergeConfig } from 'vitest/config'; ${configImport} export default mergeConfig(typeof original === 'function' ? original({mode:'test',command:'serve'}) : original, { test: { setupFiles: ['.covai-trace/setup.mjs'], fileParallelism: false, maxWorkers: 1, coverage: {enabled: false} } });`);
            args = [binary, 'run', testRel, '--config=.covai-trace/config.mjs', '--reporter=json', '--outputFile=.covai-trace/results.json', ...(scope === 'suite' ? [] : [`--testNamePattern=${pattern}`])];
        }
        // Structured spawn arguments keep project file names and titles out of shell syntax.
        fs.writeFileSync(path.join(traceDir, 'run.cjs'), `const {spawnSync}=require('node:child_process'); const result=spawnSync(process.execPath,${JSON.stringify(args)},{stdio:'inherit',windowsHide:true}); process.exit(result.status ?? 1);`);
        const projectEnv = await loadWorkspaceEnv(rootDir);
        const attempted = new Set();
        let execution;
        for (let attempt=0;attempt<=5;attempt++) {
            for (const file of ['events.json','results.json']) if(fs.existsSync(path.join(traceDir,file)))fs.unlinkSync(path.join(traceDir,file));
            execution = await run({ snapshotPath: workspace, command: 'node .covai-trace/run.cjs', timeoutMs: 60000, forceHost: true,
                inheritEnv: false, loadEnvExamples: false, env: { ...(projectEnv?.variables || {}), NODE_ENV: 'test', NODE_OPTIONS: '--experimental-vm-modules' } });
            if (execution.exitCode === 0 || attempt === 5) break;
            const recovery = await resolveUnitTestDependency({rootDir:workspace,output:(execution.stderr || '') + '\n' + (execution.stdout || ''),attempted});
            if (!recovery.resolved) break;
            args[0] = resolver.resolve(framework === 'jest' ? 'jest/bin/jest' : 'vitest/vitest.mjs');
            fs.writeFileSync(path.join(traceDir,'run.cjs'),`const {spawnSync}=require('node:child_process'); const result=spawnSync(process.execPath,${JSON.stringify(args)},{stdio:'inherit',windowsHide:true}); process.exit(result.status ?? 1);`);
        }
        const captured = readJson(path.join(traceDir, 'events.json'));
        const results = readJson(path.join(traceDir, 'results.json'));
        if (!captured || !results) throw new ServiceError('Runner did not produce a complete runtime trace. Check dependencies and test configuration.', 409);
        const suite = results.testResults?.find(item => slash(item.name || '').endsWith(testRel));
        const assertions = (suite?.assertionResults || []).filter(item => ['passed', 'failed'].includes(item.status));
        const executedNames = new Set(assertions.map(item => item.fullName || [...(item.ancestorTitles || []), item.title].join(' ')));
        executedNames.add('<suite setup>');
        const events = captured.events.filter(event => executedNames.has(event.testId));
        const sourceCoverage = captured.coverage[sourceRel];
        const map = createCoverageMap(sourceCoverage ? { [sourceRel]: sourceCoverage } : {});
        const coverageSummary = sourceCoverage ? map.getCoverageSummary().toJSON() : null;
        const sourceEvents = events.filter(event => event.role === 'source');
        const hitCounts = new Map();
        for (const event of sourceEvents) {
            const key = `${event.kind}:${event.id}:${event.kind === 'b' ? event.outcomeIndex : 0}`;
            hitCounts.set(key,(hitCounts.get(key) || 0) + 1);
        }
        const countsMatch = sourceCoverage && ['s', 'f', 'b'].every(kind => Object.entries(sourceCoverage[kind]).every(([id, count]) =>
            (Array.isArray(count) ? count : [count]).every((value, index) => value === (hitCounts.get(`${kind}:${id}:${index}`) || 0))));
        const inputUnchanged = inputHash === traceInputHash(rootDir,sourceFilePath,testFilePath);
        const runnerFinished = execution.exitCode === 0 || assertions.some(item => item.status === 'failed');
        const complete = Boolean(runnerFinished && !results.numRuntimeErrorTestSuites && !captured.truncated && sourceEvents.length && assertions.length && countsMatch && inputUnchanged);
        const steps = events.map((event, index) => {
            const sourceLocation = event.role === 'source' ? { file: sourceRel, line: event.line, endLine: event.line, column: 0 } : null;
            const type = event.type || (event.role === 'test' ? 'TEST_CALL' : event.kind === 'b' ? 'BRANCH' : event.kind === 'f' ? 'FUNCTION_ENTER' : 'STATEMENT');
            const conditionType = event.kind === 'b' ? sourceCoverage?.branchMap[event.id]?.type : null;
            const booleanBranch = ['if','cond-expr'].includes(conditionType);
            const description = event.testId === '<suite setup>' ? 'Preparing and registering test cases; test bodies have not started yet.' : type === 'TEST_END' ? 'The test has finished; its status was confirmed by the runner.' : event.role === 'test' ? `The test is executing the statement on line ${event.line}.` : type === 'BRANCH' ? booleanBranch ? `The condition on line ${event.line} evaluates to ${event.outcomeIndex === 0 ? 'true' : 'false'}; execution follows this branch.` : `Execution follows outcome ${event.outcomeIndex + 1} on line ${event.line}.` : `Source code is executing on line ${event.line}.`;
            const key = `${sourceRel}:${event.id}`;
            return { ...event, sequence: index, stepIndex: index + 1, stepNumber: index + 1, type, phase: type === 'BRANCH' ? 'BRANCH_DECISION' : type === 'TEST_END' ? 'ASSERTION' : event.role === 'test' ? 'CALL_ENTRY' : 'EVAL_PARAMS',
                title: description, description, sourceLocation, testLocation: event.testLocation, line: sourceLocation?.line || null, testLine: event.testLocation?.line || null,
                branchEvaluation: type === 'BRANCH' ? {condition:sourceCode.split(/\r?\n/)[event.line-1]?.trim(),branchTaken:booleanBranch ? event.outcomeIndex === 0 ? 'TRUE' : 'FALSE' : `OUTCOME_${event.outcomeIndex}`} : undefined,
                assertion: type === 'TEST_END' ? {passed:assertions.find(item => (item.fullName || [...(item.ancestorTitles || []),item.title].join(' ')) === event.testId)?.status === 'passed'} : undefined,
                coverageDelta: { statementIds: event.role === 'source' && event.kind === 's' ? [key] : [], functionIds: event.role === 'source' && event.kind === 'f' ? [key] : [], branchOutcomes: event.role === 'source' && event.kind === 'b' ? [{ branchId: key, outcomeIndex: event.outcomeIndex }] : [] },
                educationalGuidance: { stepNarrative: description, logicRationale: 'This location was recorded during an actual test execution.' } };
        });
        const trace = { schemaVersion: 2, language: 'en', mode: 'RECORDED', runId, framework, scope, inputHash, workspaceRevision, tests: assertions.map(item => ({ id: item.fullName || [...(item.ancestorTitles || []), item.title].join(' '), title: item.title, status: item.status })), completeness: complete ? 'COMPLETE' : 'INCOMPLETE', sourceFilePath: sourceRel, testFilePath: testRel,
            sourceCode, testCode, sourceHash: digest(sourceCode), testHash: digest(testCode), recordedAt: new Date().toISOString(),
            testCase: { ...selected, category: selected.category || category || 'HAPPY_PATH' }, steps, coverageSummary,
            coverageMap: sourceCoverage ? { statementMap: sourceCoverage.statementMap, branchMap: sourceCoverage.branchMap, fnMap: sourceCoverage.fnMap } : null,
            summary: { totalSteps: steps.length, outcome: execution.exitCode === 0 && assertions.every(item => item.status === 'passed') ? 'PASSED' : 'FAILED', assertionsCount: assertions.length,
                allAssertionsPassed: assertions.length > 0 && assertions.every(item => item.status === 'passed'), executedLines: [...new Set(sourceEvents.map(event => event.line))], durationMs: results.startTime ? Date.now() - results.startTime : null }, initialMocks: [] };
        fs.writeFileSync(path.join(artifactDir, 'trace.json'), JSON.stringify(trace));
        return trace;
    } finally {
        cleanupWorkspaceNodeModulesLinks(links);
        if (fs.existsSync(workspace)) {
            const relative = path.relative(fs.realpathSync(artifactDir),fs.realpathSync(workspace));
            if (relative === 'workspace') fs.rmSync(workspace,{recursive:true,force:true});
        }
    }
}
