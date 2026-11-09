import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import * as traverseModule from '@babel/traverse';

const parseCode = (code, opts) => (babelParser.parse ? babelParser.parse(code, opts) : babelParser.default.parse(code, opts));
const traverse = traverseModule.default?.default || traverseModule.default || traverseModule;

describe('Milestone 2 Challenger Empirical Tests: Frontend UI & State Logic', () => {
    const repoRoot = path.resolve(process.cwd(), process.cwd().endsWith('server') ? '..' : '.');
    const versionHistoryPath = path.resolve(repoRoot, 'client/src/components/dashboard/UnitTestVersionHistoryView.jsx');
    const batchVersionsPath = path.resolve(repoRoot, 'client/src/components/dashboard/UnitTestBatchVersions.jsx');
    const dashboardPath = path.resolve(repoRoot, 'client/src/components/dashboard/CoverageTypeDashboard.jsx');

    let versionHistoryCode;
    let batchVersionsCode;
    let dashboardCode;

    beforeAll(() => {
        versionHistoryCode = fs.readFileSync(versionHistoryPath, 'utf8');
        batchVersionsCode = fs.readFileSync(batchVersionsPath, 'utf8');
        dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
    });

    describe('UnitTestVersionHistoryView.jsx: Line 181 Hijack Elimination', () => {
        test('AST verification: No early return of UnitTestBatchVersions', () => {
            const ast = parseCode(versionHistoryCode, {
                sourceType: 'module',
                plugins: ['jsx']
            });

            let hasBatchVersionsImport = false;
            let hasEarlyReturnBatchVersions = false;

            traverse(ast, {
                ImportDeclaration(p) {
                    if (p.node.source.value.includes('UnitTestBatchVersions')) {
                        hasBatchVersionsImport = true;
                    }
                },
                ReturnStatement(p) {
                    const arg = p.node.argument;
                    if (arg && arg.type === 'JSXElement') {
                        const name = arg.openingElement.name.name;
                        if (name === 'UnitTestBatchVersions') {
                            hasEarlyReturnBatchVersions = true;
                        }
                    }
                }
            });

            expect(hasBatchVersionsImport).toBe(false);
            expect(hasEarlyReturnBatchVersions).toBe(false);
            expect(versionHistoryCode).not.toContain('return <UnitTestBatchVersions');
            expect(versionHistoryCode).not.toContain('filesList.some(file => file.activeBatchId)');
        });
    });

    describe('UnitTestVersionHistoryView.jsx: State Logic & Card Render Specifications', () => {
        // Extract and simulate the versionsTimeline useMemo computation from UnitTestVersionHistoryView
        function computeVersionsTimeline(filesList) {
            const totalFiles = filesList.length;
            const map = {};

            // Mirror component logic:
            for (const fileRec of filesList) {
                const versions = fileRec.versions || [];
                for (const ver of versions) {
                    const vNum = Number(ver.version);
                    if (!map[vNum]) {
                        map[vNum] = {
                            version: vNum,
                            files: [],
                            count: 0,
                            activeCount: 0,
                            isBaseline: vNum === 1
                        };
                    }
                    const isActive = (fileRec.currentVersion || 1) === vNum;
                    map[vNum].files.push({
                        testFile: fileRec.testFile,
                        isActive
                    });
                    map[vNum].count++;
                    if (isActive) map[vNum].activeCount++;
                }
            }

            // Ensure Baseline Version 1 is always present and accounts for all files
            if (totalFiles > 0) {
                if (!map[1]) {
                    map[1] = {
                        version: 1,
                        label: "Version 1: Baseline / Initial State",
                        isBaseline: true,
                        type: "ORIGINAL",
                        status: "BASELINE",
                        files: [],
                        count: 0,
                        activeCount: 0,
                    };
                }
                const existingV1FileKeys = new Set(map[1].files.map(f => f.testFile));
                for (const fileRec of filesList) {
                    const key = fileRec.testFile;
                    if (!existingV1FileKeys.has(key)) {
                        const curVer = fileRec.currentVersion || 1;
                        map[1].files.push({
                            testFile: fileRec.testFile,
                            isActive: curVer === 1,
                            status: "BASELINE"
                        });
                        map[1].count++;
                        if (curVer === 1) {
                            map[1].activeCount++;
                        }
                    }
                }
            }

            const sortedTimeline = Object.values(map).sort((a, b) => b.version - a.version);

            // Compute dominant version dynamically based on file version frequencies
            const versionFreq = {};
            for (const fileRec of filesList) {
                const curVer = fileRec.currentVersion || 1;
                versionFreq[curVer] = (versionFreq[curVer] || 0) + 1;
            }
            let dominant = 1;
            let maxFreq = 0;
            for (const [vStr, freq] of Object.entries(versionFreq)) {
                const vNum = Number(vStr);
                if (freq > maxFreq || (freq === maxFreq && vNum > dominant)) {
                    maxFreq = freq;
                    dominant = vNum;
                }
            }

            const canRevertToBaseline = filesList.some(file => (file.currentVersion || 1) > 1) || dominant > 1;
            const canSwitchToV2 = sortedTimeline.some(v => v.version === 2) && (dominant !== 2 || filesList.some(file => (file.currentVersion || 1) !== 2));

            return {
                versionsTimeline: sortedTimeline,
                currentDominantVersion: dominant,
                canRevertToBaseline,
                canSwitchToV2
            };
        }

        function getCardButtonProps(verItem, totalFiles, currentDominantVersion) {
            const isFullyActive = verItem.activeCount === totalFiles && totalFiles > 0;
            if (isFullyActive) {
                return {
                    isActive: true,
                    label: "Current Version",
                    icon: "Check"
                };
            }
            const isBaseline = verItem.version === 1;
            const isHistorical = verItem.version < currentDominantVersion;
            const isRevert = isBaseline || isHistorical;
            const buttonLabel = isBaseline
                ? "Revert all files to Version 1 (Baseline)"
                : isHistorical
                    ? "Revert all files to this version"
                    : `Switch to Version ${verItem.version}`;

            return {
                isActive: false,
                label: buttonLabel,
                icon: isRevert ? "RotateCcw" : "Zap"
            };
        }

        test('Scenario A: All files on Version 2 (AI suggestions applied)', () => {
            const filesList = [
                { testFile: 'tests/auth.test.js', currentVersion: 2, versions: [{ version: 1 }, { version: 2 }] },
                { testFile: 'tests/user.test.js', currentVersion: 2, versions: [{ version: 1 }, { version: 2 }] }
            ];

            const { versionsTimeline, currentDominantVersion, canRevertToBaseline } = computeVersionsTimeline(filesList);

            expect(currentDominantVersion).toBe(2);
            expect(canRevertToBaseline).toBe(true);

            // Version 2 should be active
            const v2Item = versionsTimeline.find(v => v.version === 2);
            expect(v2Item).toBeDefined();
            const v2Button = getCardButtonProps(v2Item, filesList.length, currentDominantVersion);
            expect(v2Button.isActive).toBe(true);
            expect(v2Button.label).toBe("Current Version");
            expect(v2Button.icon).toBe("Check");

            // Version 1 should be Baseline and offer RotateCcw reversion
            const v1Item = versionsTimeline.find(v => v.version === 1);
            expect(v1Item).toBeDefined();
            const v1Button = getCardButtonProps(v1Item, filesList.length, currentDominantVersion);
            expect(v1Button.isActive).toBe(false);
            expect(v1Button.label).toBe("Revert all files to Version 1 (Baseline)");
            expect(v1Button.icon).toBe("RotateCcw");
        });

        test('Scenario B: Multi-cycle history (Versions 1, 2, 3) with Version 3 active', () => {
            const filesList = [
                { testFile: 'tests/cart.test.js', currentVersion: 3, versions: [{ version: 1 }, { version: 2 }, { version: 3 }] }
            ];

            const { versionsTimeline, currentDominantVersion } = computeVersionsTimeline(filesList);
            expect(currentDominantVersion).toBe(3);

            // Version 1 (Baseline)
            const v1Item = versionsTimeline.find(v => v.version === 1);
            const v1Props = getCardButtonProps(v1Item, 1, currentDominantVersion);
            expect(v1Props.label).toBe("Revert all files to Version 1 (Baseline)");
            expect(v1Props.icon).toBe("RotateCcw");

            // Version 2 (Historical)
            const v2Item = versionsTimeline.find(v => v.version === 2);
            const v2Props = getCardButtonProps(v2Item, 1, currentDominantVersion);
            expect(v2Props.label).toBe("Revert all files to this version");
            expect(v2Props.icon).toBe("RotateCcw");

            // Version 3 (Active)
            const v3Item = versionsTimeline.find(v => v.version === 3);
            const v3Props = getCardButtonProps(v3Item, 1, currentDominantVersion);
            expect(v3Props.label).toBe("Current Version");
            expect(v3Props.icon).toBe("Check");
        });

        test('Scenario C: Project on Baseline Version 1 disables header quick revert button', () => {
            const filesList = [
                { testFile: 'tests/auth.test.js', currentVersion: 1, versions: [{ version: 1 }, { version: 2 }] }
            ];

            const { currentDominantVersion, canRevertToBaseline } = computeVersionsTimeline(filesList);
            expect(currentDominantVersion).toBe(1);
            expect(canRevertToBaseline).toBe(false);
        });

        test('Source JSX analysis: Header quick button dispatches { allFiles: true, targetVersion: 1 }', () => {
            expect(versionHistoryCode).toContain('onClick={() => onSwitchVersion({ allFiles: true, targetVersion: 1 })}');
            expect(versionHistoryCode).toContain('Revert to Version 1 (Baseline)');
            expect(versionHistoryCode).toContain('disabled={isSwitchingVersion || !canRevertToBaseline}');
        });

        test('Source JSX analysis: Card Revert button dispatches { allFiles: true, targetVersion: verItem.version }', () => {
            expect(versionHistoryCode).toContain('onClick={() => onSwitchVersion({ allFiles: true, targetVersion: verItem.version })}');
            expect(versionHistoryCode).toContain('Revert all files to Version 1 (Baseline)');
            expect(versionHistoryCode).toContain('Revert all files to this version');
            expect(versionHistoryCode).toContain('Current Version');
        });
    });

    describe('CoverageTypeDashboard.jsx: handleSwitchVersion Contract & Refetch', () => {
        test('AST verification: handleSwitchVersion re-fetches coverage and reload versions on success', () => {
            const ast = parseCode(dashboardCode, {
                sourceType: 'module',
                plugins: ['jsx']
            });

            let foundHandleSwitchVersion = false;
            let hasSuccessCheck = false;
            let callsLoadUnitTestVersions = false;
            let callsRefetchCoverage = false;
            let callsInvalidateQueries = false;

            traverse(ast, {
                VariableDeclarator(p) {
                    if (p.node.id.name === 'handleSwitchVersion') {
                        foundHandleSwitchVersion = true;
                        p.traverse({
                            IfStatement(ifPath) {
                                const testCode = dashboardCode.slice(ifPath.node.test.start, ifPath.node.test.end);
                                if (testCode.includes('result?.success') || testCode.includes('res?.success')) {
                                    hasSuccessCheck = true;
                                    const bodyCode = dashboardCode.slice(ifPath.node.consequent.start, ifPath.node.consequent.end);
                                    if (bodyCode.includes('loadUnitTestVersions()')) callsLoadUnitTestVersions = true;
                                    if (bodyCode.includes('refetchCoverage()')) callsRefetchCoverage = true;
                                    if (bodyCode.includes('invalidateCoverageQueries')) callsInvalidateQueries = true;
                                }
                            }
                        });
                    }
                }
            });

            expect(foundHandleSwitchVersion).toBe(true);
            expect(hasSuccessCheck).toBe(true);
            expect(callsLoadUnitTestVersions).toBe(true);
            expect(callsRefetchCoverage).toBe(true);
            expect(callsInvalidateQueries).toBe(true);
        });

        test('Source verification: handleSwitchVersion dispatches allFiles and targetVersion', () => {
            expect(dashboardCode).toContain('const handleSwitchVersion = useCallback(async ({ filePath = null, targetVersion = 1, allFiles = false })');
            expect(dashboardCode).toContain('switchUnitTestVersion(snapshotId, {');
            expect(dashboardCode).toContain('allFiles,');
            expect(dashboardCode).toContain('targetVersion,');
            expect(dashboardCode).toContain('if (result?.success || res?.success)');
        });
    });

    describe('UnitTestBatchVersions.jsx: Baseline and Historical Rollback Affordances', () => {
        test('Source verification: Renders Baseline Version 1 section and historical revert actions', () => {
            expect(batchVersionsCode).toContain('Version 1 (Baseline)');
            expect(batchVersionsCode).toContain('Revert all files to Version 1 (Baseline)');
            expect(batchVersionsCode).toContain("onClick={() => onSwitchVersion?.({targetVersion:1,allFiles:true})}");
            expect(batchVersionsCode).toContain('Revert all files to this version');
            expect(batchVersionsCode).toContain("onClick={() => onSwitchVersion?.({targetVersion:batch.version,allFiles:true})}");
        });
    });
});
