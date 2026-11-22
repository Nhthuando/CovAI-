import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { scanSystemTestFiles } from '../utils/testFileParser.js';
import { containedPath, readFullSystemConfig, resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { validateFullSystemTest } from './systemTestEvidence.service.js';
import { selectFrontendPackage } from './projectRuntimePlan.service.js';
import { inspectSystemSetupSource } from './fullSystemSetup.service.js';
import { inferFullSystemPlan } from './fullSystemPlan.service.js';

export const discoverSystemAssessment = ({ rootDir, runner = 'playwright', executionMode = 'frontend' }) => {
    if (runner !== 'playwright') throw new ServiceError('Measured coverage currently supports Playwright only', 422);
    rootDir = resolveSystemRepositoryRoot(rootDir);
    const config = executionMode === 'full' ? readFullSystemConfig(rootDir, { allowMissing: true }) || inferFullSystemPlan(inspectSystemSetupSource(rootDir),{allowSchemaDraft:true}) : null;
    const discovered = scanSystemTestFiles(rootDir).playwrightFiles.map(file => file.filePath);
    const excludedTests = [];
    const syntaxErrors = [];
    const testFiles = discovered.filter(file => {
        const isJavaScript = /\.(?:[cm]?js|jsx)$/i.test(file);
        const source = isJavaScript || executionMode === 'full' ? fs.readFileSync(containedPath(rootDir, file), 'utf8') : undefined;
        if (isJavaScript) {
            try {
                parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] });
            } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
                const location = error.loc ? `${error.loc.line}:${error.loc.column}` : '';
                const message = error.message.replace(/ \(\d+:\d+\)$/, '');
                const reason = `invalid JavaScript syntax${location ? ` (${location})` : ''}: ${message}`;
                excludedTests.push({ filePath: file, reason });
                syntaxErrors.push(`Test file ${file} has invalid JavaScript syntax${location ? ` (line ${location})` : ''}: ${message}. Regenerate or fix it.`);
                return false;
            }
        }
        if (/\.(jsx|tsx)$/.test(file)) {
            excludedTests.push({ filePath: file, reason: 'Managed Playwright evidence supports JS/TS spec files without JSX syntax' });
            return false;
        }
        if (executionMode !== 'full') return true;
        try { validateFullSystemTest(source); return true; }
        catch (error) { if (error.statusCode !== 422) throw error; excludedTests.push({filePath:file,reason:'Mocked or intercepted API: run this file in Frontend mode'}); return false; }
    });
    if (!testFiles.length) {
        if (syntaxErrors.length) throw new ServiceError(syntaxErrors.join('\n'), 422);
        const failure=new ServiceError(excludedTests.length ? 'No compatible Full Stack tests found. Existing tests mock API calls. Generate tests in Full Stack mode to exercise the real API and database; existing mocked tests remain available in Frontend mode.' : 'No Playwright test files were found in this snapshot',422);
        failure.code=excludedTests.length?'FULL_STACK_TESTS_REQUIRED':'SYSTEM_TESTS_NOT_FOUND';
        throw failure;
    }
    if (testFiles.length > 20) throw new ServiceError('Measured execution supports up to 20 test files per run; this suite exceeds that limit', 422);
    const findRoot = (configured, names) => {
        if (configured) { containedPath(rootDir, configured); return configured; }
        const candidates = names.filter(name => fs.existsSync(path.join(rootDir, name, 'package.json')));
        if (candidates.length === 1) return candidates[0];
        if (!candidates.length && fs.existsSync(path.join(rootDir, 'package.json'))) return '.';
        throw new ServiceError('Application package is ambiguous; automatic source detection could not establish a coverage scope', 422);
    };
    const scope = root => ({ root, sourceDirectory: fs.existsSync(containedPath(rootDir, root + '/src')) ? 'src' : '.' });
    const selectedFrontend=config?.frontend?.directory || selectFrontendPackage({rootDir,testFiles});
    const frontend = scope(selectedFrontend ? path.relative(rootDir,containedPath(rootDir,selectedFrontend)).replaceAll('\\','/') || '.' : findRoot(null,['client','frontend','web']));
    return { testFiles, excludedTests, runner, executionMode, repeatRuns: 2, coverageScope: { ...(config?.backendOnly?{}:{frontend}), ...(executionMode === 'full' && !config?.frontendOnly ? { backend: scope(findRoot(config?.backend?.directory, ['server', 'backend', 'api'])) } : {}) } };
};
