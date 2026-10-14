import fs from 'node:fs';
import path from 'node:path';
import coverage from 'istanbul-lib-coverage';
import { coverageSummaryFor } from './systemAssessmentContract.service.js';

// Diagnostic only: existing artifacts do not establish run provenance.
export const readIstanbulCoverageArtifacts = coverageDir => {
    try {
        const file = path.join(coverageDir, 'coverage-final.json');
        const total = fs.existsSync(file)
            ? coverage.createCoverageMap(JSON.parse(fs.readFileSync(file, 'utf8'))).getCoverageSummary().data
            : JSON.parse(fs.readFileSync(path.join(coverageDir, 'coverage-summary.json'), 'utf8')).total;
        return Object.fromEntries([...['lines', 'branches', 'statements', 'functions'].map(key => [`${key}Pct`, total[key]?.pct ?? null]), ['isIstanbulArtifact', true]]);
    } catch { return null; }
};
export const calculateSystemCoverage = ({ scenarios = [], measurement = null } = {}) => {
    const files = new Map();
    for (const scenario of scenarios) {
        if (!scenario.testFile) continue;
        const file = files.get(scenario.testFile) || { filePath: scenario.testFile, scenarioCount: 0, durationMs: 0, statuses: [], suites: new Set() };
        file.scenarioCount++;
        file.durationMs += scenario.durationMs || 0;
        file.statuses.push(scenario.status);
        if (scenario.suiteName) file.suites.add(scenario.suiteName);
        files.set(scenario.testFile, file);
    }
    return {
        status: measurement?.status || 'NOT_MEASURED',
        summary: coverageSummaryFor(measurement || { status: 'NOT_MEASURED' }),
        scenarioContributions: {},
        fileBreakdown: [...files.values()].map(({ suites, statuses, ...file }) => ({ ...file, suiteCount: suites.size, coverageLinesPct: null,
            status: statuses.every(s => s === 'passed') ? 'PASSED' : statuses.includes('failed') ? 'FAILED' : statuses.includes('flaky') ? 'FLAKY' : 'SKIPPED' })),
    };
};
