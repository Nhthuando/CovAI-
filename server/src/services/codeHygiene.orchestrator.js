import fs from 'fs';
import {currentProjectOperation} from './projectOperationWorkspace.service.js';
import path from 'path';
import { parseJavaScriptCode } from './babelParser.service.js';
import { CodeHygieneRuleRunner } from './codeHygieneRuleRunner.js';
import { saveCodeHygieneReport } from './codeHygiene.service.js';
import { calculateSummary } from './codeHygieneSummary.service.js';

const SOURCE_FILE_PATTERN = /\.(js|jsx|ts|tsx)$/i;
const IGNORED_DIRECTORIES = new Set(['node_modules', 'build', 'dist', 'coverage', '.git', '.covai-collaboration', '.covai-temp', '.covai-system-test']);

const isSourceFile = (entry) => entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name);

/** Coordinates source discovery, rule execution, summary generation, and persistence. */
export const analyzeCodeHygieneDirectory = (rootDir, { ruleRunner = new CodeHygieneRuleRunner() } = {}) => {
    if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        throw new Error('A readable source directory is required for code hygiene analysis.');
    }

    const issues = [];
    const scanDirectory = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) scanDirectory(filePath);
            } else if (isSourceFile(entry)) {
                const source = fs.readFileSync(filePath, 'utf-8');
                const parsed = parseJavaScriptCode(source);
                if (parsed.success) issues.push(...ruleRunner.run(parsed.ast, filePath));
            }
        }
    };

    scanDirectory(rootDir);
    return { summary: calculateSummary(issues), issues };
};

export const runCodeHygieneAnalysis = async (snapshotId, rootDir, dependencies = {}) => {
    const report = analyzeCodeHygieneDirectory(rootDir, dependencies);
    const issues = currentProjectOperation() ? report.issues.map(issue=>({...issue,filePath:path.relative(rootDir,issue.filePath).replaceAll('\\','/')})) : report.issues;
    await (dependencies.saveReport ?? saveCodeHygieneReport)(snapshotId, issues, report.summary);
    return report;
};
