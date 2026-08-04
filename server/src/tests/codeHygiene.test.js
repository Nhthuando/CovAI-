import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeCodeHygieneDirectory } from '../services/codeHygiene.orchestrator.js';

describe('Code Hygiene analysis', () => {
    let rootDir;

    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-hygiene-'));
        fs.writeFileSync(path.join(rootDir, 'sample.js'), [
            'console.log("debug output");',
            'debugger;',
            '// TODO: remove temporary implementation',
            '// FIXME: replace this branch',
            '// HACK: compatibility workaround',
            'const text = "TODO in a string is not a comment";'
        ].join('\n'));
    });

    afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

    test('detects debug code and temporary comments and produces a summary', () => {
        const report = analyzeCodeHygieneDirectory(rootDir);
        expect(report.issues.map((issue) => issue.type).sort()).toEqual([
            'CONSOLE_LOG', 'DEBUGGER', 'FIXME', 'HACK', 'TODO'
        ]);
        expect(report.summary).toMatchObject({
            totalIssues: 5,
            infoCount: 2,
            warningCount: 1,
            highCount: 2,
            hygieneScore: 73
        });
    });
});
