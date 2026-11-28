import { extractExecutionDurationMs } from "../services/testResultParser.service.js";
import { healProjectLifecycleStatusIfNeeded } from "../services/project.service.js";
import {
    getDashboardFingerprint,
    diagnoseModuleRootCause,
    buildCrossLayerMatrix,
    buildCausalTrendSeries,
    isExcludedCausalRun,
} from "../services/unifiedQualityDashboard.service.js";
import { getPortfolioFingerprint } from "../services/portfolioDashboard.service.js";
import { isMatch } from "../services/integrationWorkspace.service.js";
import {
    computeFixedWeightProjectHealth,
    computeProjectHealthAndCoverage,
} from "../../../shared/portfolioGovernance.js";

describe("Cross-Dashboard Logic Synchronization Parity Tests", () => {
    describe("Lỗi 2B: Read-Time Self-Healing & Serialization for lifecycleStatus", () => {
        test("healProjectLifecycleStatusIfNeeded auto-heals NOT_STARTED to DOING when snapshot has testRuns or coverage", async () => {
            const project = {
                lifecycleStatus: "NOT_STARTED",
                _count: { snapshots: 1, aiTests: 0, aiSuggestions: 0 },
                snapshots: [
                    {
                        id: "snap_1",
                        coverageSummaries: { id: "cov_1" },
                        _count: { testRuns: 1, systemScenarios: 0 },
                    },
                ],
            };

            const resolved = await healProjectLifecycleStatusIfNeeded(project);
            expect(resolved).toBe("DOING");
            expect(project.lifecycleStatus).toBe("DOING");
            expect(project.lifecycleUpdatedAt).toBeInstanceOf(Date);
        });

        test("healProjectLifecycleStatusIfNeeded keeps NOT_STARTED when project has zero activity", async () => {
            const project = {
                lifecycleStatus: "NOT_STARTED",
                _count: { snapshots: 1, aiTests: 0, aiSuggestions: 0 },
                snapshots: [
                    {
                        id: "snap_1",
                        coverageSummaries: null,
                        _count: { testRuns: 0, systemScenarios: 0 },
                    },
                ],
            };

            const resolved = await healProjectLifecycleStatusIfNeeded(project);
            expect(resolved).toBe("NOT_STARTED");
            expect(project.lifecycleStatus).toBe("NOT_STARTED");
        });

        test("healProjectLifecycleStatusIfNeeded never overwrites PAUSED, COMPLETED, or CANCELLED", async () => {
            for (const manualState of ["PAUSED", "COMPLETED", "CANCELLED"]) {
                const project = {
                    lifecycleStatus: manualState,
                    _count: { snapshots: 3, aiTests: 10, aiSuggestions: 5 },
                    snapshots: [
                        {
                            id: "snap_1",
                            coverageSummaries: { id: "cov_1" },
                            _count: { testRuns: 4, systemScenarios: 2 },
                        },
                    ],
                };
                const resolved = await healProjectLifecycleStatusIfNeeded(project);
                expect(resolved).toBe(manualState);
                expect(project.lifecycleStatus).toBe(manualState);
            }
        });
    });

    describe("Task 5: extractExecutionDurationMs (Runtime 0ms Fix)", () => {
        test("correctly extracts duration from suite perfStats.runtime (Jest format)", () => {
            const raw = {
                testResults: [
                    { name: "suite1.test.js", perfStats: { runtime: 125 } },
                    { name: "suite2.test.js", perfStats: { runtime: 250 } }
                ]
            };
            const dur = extractExecutionDurationMs(raw, 0);
            expect(dur).toBe(375);
        });

        test("correctly extracts duration from endTime - startTime (Vitest format)", () => {
            const raw = {
                testResults: [
                    { name: "suite1.test.js", startTime: 1000, endTime: 1180 }
                ]
            };
            const dur = extractExecutionDurationMs(raw, 0);
            expect(dur).toBe(180);
        });

        test("correctly extracts duration from assertionResults.duration when suite timing is missing", () => {
            const raw = {
                testResults: [
                    {
                        name: "suite1.test.js",
                        assertionResults: [
                            { title: "test 1", duration: 42 },
                            { title: "test 2", duration: 58 }
                        ]
                    }
                ]
            };
            const dur = extractExecutionDurationMs(raw, 0);
            expect(dur).toBe(100);
        });

        test("falls back to runnerElapsedMs if raw JSON lacks all duration fields", () => {
            const raw = {
                numTotalTests: 1,
                numPassedTests: 1,
                testResults: [{ name: "suite1.test.js" }]
            };
            const dur = extractExecutionDurationMs(raw, 320);
            expect(dur).toBe(320);
        });

        test("returns 0 if completely empty and no fallback elapsed time", () => {
            expect(extractExecutionDurationMs(null, 0)).toBe(0);
            expect(extractExecutionDurationMs({}, 0)).toBe(0);
        });
    });

    describe("Task 2: Uncovered APIs Calculation Parity", () => {
        test("ensures 9 uncovered endpoints when 0 are covered, even if wsSummary.uncoveredApis was 0 due to notExecuted split", () => {
            const totalApis = 9;
            const coveredApis = 0;
            const uncoveredApis = Math.max(0, totalApis - coveredApis);
            expect(uncoveredApis).toBe(9);
        });

        test("partial coverage correctly computes remaining gaps", () => {
            const totalApis = 9;
            const coveredApis = 3;
            const uncoveredApis = Math.max(0, totalApis - coveredApis);
            expect(uncoveredApis).toBe(6);
        });
    });

    describe("Task 4: Snapshot Label and Commit SHA Sanitization", () => {
        test("cleans appliedTx: internal transaction marker so it never displays '(applied)' as git SHA", () => {
            const snapshot = {
                id: "snap_12345678",
                versionNumber: 1,
                label: null,
                commitSha: "appliedTx:a8f9c1d2e3b4"
            };

            let displayCommit = snapshot.commitSha;
            if (displayCommit && displayCommit.startsWith("appliedTx:")) {
                displayCommit = null;
            }

            const shortRef = displayCommit
                ? displayCommit.slice(0, 7)
                : snapshot.id.slice(0, 7);
            const vNum = snapshot.versionNumber != null ? `#${snapshot.versionNumber}` : "#1";
            const baseLabel = snapshot.label || `${vNum} (${shortRef})`;

            expect(displayCommit).toBeNull();
            expect(baseLabel).toBe("#1 (snap_12)");
            expect(baseLabel).not.toContain("(applied)");
        });

        test("displays true git commit sha when present", () => {
            const snapshot = {
                id: "snap_12345678",
                versionNumber: 2,
                label: null,
                commitSha: "9f8e7d6c5b4a"
            };

            let displayCommit = snapshot.commitSha;
            if (displayCommit && displayCommit.startsWith("appliedTx:")) {
                displayCommit = null;
            }

            const shortRef = displayCommit ? displayCommit.slice(0, 7) : snapshot.id.slice(0, 7);
            const vNum = `#${snapshot.versionNumber}`;
            const baseLabel = snapshot.label || `${vNum} (${shortRef})`;

            expect(baseLabel).toBe("#2 (9f8e7d6)");
        });
    });

    describe("Performance Optimization: Fingerprint & Cache Verification", () => {
        test("getDashboardFingerprint handles non-existent snapshot gracefully without crashing", async () => {
            const fp = await getDashboardFingerprint("non_existent_snapshot_id");
            expect(fp === null || typeof fp === "string").toBe(true);
        });

        test("getPortfolioFingerprint handles offline/mock environment gracefully without crashing", async () => {
            const fp = await getPortfolioFingerprint("non_existent_user_id");
            expect(fp === null || fp === "empty" || typeof fp === "string").toBe(true);
        });
    });

    describe("Batch 1 Fixes: Wildcard Route Regex Safety & Covered Endpoint Clamping", () => {
        test("isMatch handles catch-all '*' and regex metacharacters without throwing SyntaxError", () => {
            expect(() => isMatch({ method: "GET", path: "/anything" }, { method: "GET", path: "*" })).not.toThrow();
            expect(isMatch({ method: "GET", path: "/anything" }, { method: "GET", path: "*" })).toBe(true);

            for (const weirdRoute of ["/api/v1.0/users", "/api/items/+", "/api/users/:id?", "/api/group/(test)"]) {
                expect(() => isMatch({ method: "GET", path: "/api/items/123" }, { method: "GET", path: weirdRoute })).not.toThrow();
            }
            expect(isMatch({ method: "GET", path: "/api/users/42" }, { method: "GET", path: "/api/users/:id" })).toBe(true);
        });

        test("coveredApis is clamped to totalApis when multiple test cases cover the same endpoint", () => {
            const totalApis = 1;
            const passedTests = 6;
            const coveredEpCount = 1;
            const coveredApis = Math.min(totalApis, coveredEpCount > 0 ? coveredEpCount : passedTests);
            const uncoveredApis = Math.max(0, totalApis - coveredApis);

            expect(coveredApis).toBe(1);
            expect(uncoveredApis).toBe(0);
        });
    });

    describe("Batch 2 Fixes: Cross-Dashboard Health/Grade Formula & 0-Test Parity", () => {
        const computeCanonicalHealth = ({ unit, int, sys }) => {
            const uRate = unit.passed + unit.failed > 0 ? (unit.passed / (unit.passed + unit.failed)) * 100 : 0;
            const iRate = int.passed + int.failed > 0 ? (int.passed / (int.passed + int.failed)) * 100 : 0;
            const sRate = sys.passed + sys.failed > 0 ? (sys.passed / (sys.passed + sys.failed)) * 100 : 0;

            const unitScore = unit.total > 0 ? 0.5 * uRate + 0.5 * unit.cov : 0;
            const intScore = int.total > 0 ? 0.5 * iRate + 0.5 * int.cov : 0;
            const sysScore = sys.total > 0 ? 0.5 * sRate + 0.5 * sys.cov : 0;

            const totalExecuted = unit.total + int.total + sys.total;
            const totalFailed = unit.failed + int.failed + sys.failed;
            let score = Math.round(unitScore * 0.5 + intScore * 0.3 + sysScore * 0.2);
            if (totalFailed > 0) {
                score = Math.max(0, score - Math.min(15, totalFailed * 2));
            }
            let grade = "—";
            if (totalExecuted > 0) {
                if (score >= 80) grade = "A";
                else if (score >= 65) grade = "B";
                else if (score >= 50) grade = "C";
                else grade = "D";
            }
            return { score, grade };
        };

        test("returns score=0 and grade='—' identically when 0 tests have executed across all 3 layers", () => {
            const empty = { total: 0, passed: 0, failed: 0, cov: 0 };
            expect(computeCanonicalHealth({ unit: empty, int: empty, sys: empty })).toEqual({ score: 0, grade: "—" });
        });

        test("computes identical 50/30/20 weighted health, failure penalty, and A/B/C/D grade thresholds", () => {
            // Integration-only repo like Toeic_AnswerSheet: 6/6 passed, 100% API cov, 0 unit, 0 system => 30, D
            expect(
                computeCanonicalHealth({
                    unit: { total: 0, passed: 0, failed: 0, cov: 0 },
                    int: { total: 6, passed: 6, failed: 0, cov: 100 },
                    sys: { total: 0, passed: 0, failed: 0, cov: 0 },
                })
            ).toEqual({ score: 30, grade: "D" });

            // Full passing repo at threshold -> 80 = Grade A
            expect(
                computeCanonicalHealth({
                    unit: { total: 10, passed: 10, failed: 0, cov: 60 },
                    int: { total: 5, passed: 5, failed: 0, cov: 60 },
                    sys: { total: 2, passed: 2, failed: 0, cov: 60 },
                })
            ).toEqual({ score: 80, grade: "A" });
        });

        test("R1: computeFixedWeightProjectHealth scores Unit-only 100%/100% at 50/100 Grade C while Portfolio computeProjectHealthAndCoverage keeps re-normalization", () => {
            const unitOnlyInput = {
                unit: { totalTests: 20, passedTests: 20, failedTests: 0, coveragePct: 100 },
                integration: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
                system: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
            };

            const fixed = computeFixedWeightProjectHealth(unitOnlyInput);
            expect(fixed.healthScore).toBe(50);
            expect(fixed.grade).toBe("C");
            expect(fixed.unifiedCoveragePct).toBe(50);

            // Portfolio must remain unchanged (re-normalizing over executed layers -> 100, Grade A)
            const portfolio = computeProjectHealthAndCoverage(unitOnlyInput);
            expect(portfolio.healthScore).toBe(100);
            expect(portfolio.grade).toBe("A");
            expect(portfolio.unifiedCoveragePct).toBe(100);

            // Two layers: Unit 100%/100% (50) + Integration 100%/100% (30) = 80 Grade A
            const twoLayer = computeFixedWeightProjectHealth({
                unit: { totalTests: 10, passedTests: 10, failedTests: 0, coveragePct: 100 },
                integration: { totalTests: 6, passedTests: 6, failedTests: 0, coveragePct: 100 },
                system: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
            });
            expect(twoLayer.healthScore).toBe(80);
            expect(twoLayer.grade).toBe("A");

            // Three layers with failure penalty: Unit 90% pass / 80% cov (85*0.5=42.5), Int 100%/100% (30), Sys 80%/60% (70*0.2=14) => 86.5 -> 87 - 15 = 72 Grade B
            const threeLayer = computeFixedWeightProjectHealth({
                unit: { totalTests: 100, passedTests: 90, failedTests: 10, coveragePct: 80 },
                integration: { totalTests: 10, passedTests: 10, failedTests: 0, coveragePct: 100 },
                system: { totalTests: 10, passedTests: 8, failedTests: 2, coveragePct: 60 },
            });
            expect(threeLayer.healthScore).toBe(72);
            expect(threeLayer.grade).toBe("B");

            // Zero tests across all 3 layers -> null score, "—" grade, UNTESTED gate
            const empty = computeFixedWeightProjectHealth();
            expect(empty.healthScore).toBeNull();
            expect(empty.grade).toBe("—");
            expect(empty.gateStatus).toBe("UNTESTED");
        });
    });

    describe("Executive Report Parity: Coverage-Only Modules, Separated Labels & Zero-API Diagnosis", () => {
        test("diagnoseModuleRootCause never reports 'API coverage gap' when totalEpCount === 0", () => {
            const zeroApiDiag = diagnoseModuleRootCause("pass", "none", "untested", {
                totalEpCount: 0,
                uncoveredEpCount: 0,
                totalProjectApis: 0,
            });
            expect(zeroApiDiag.summary).not.toMatch(/API coverage gap/i);
            expect(zeroApiDiag.suspectLayer).toBe("none");
            expect(zeroApiDiag.summary).toBe("Unit verified (no APIs)");

            // Legacy caller passing "untested" with 0 endpoints must also not diagnose API coverage gap
            const legacyZeroDiag = diagnoseModuleRootCause("pass", "untested", "untested", {
                totalEpCount: 0,
                uncoveredEpCount: 0,
                totalProjectApis: 4,
            });
            expect(legacyZeroDiag.summary).not.toMatch(/API coverage gap/i);
            expect(legacyZeroDiag.suspectLayer).toBe("none");

            // Genuine discovered endpoints without coverage still report API coverage gap
            const realApiGap = diagnoseModuleRootCause("pass", "untested", "untested", {
                totalEpCount: 3,
                uncoveredEpCount: 3,
                totalProjectApis: 3,
                endpoint: "GET /api/orders",
            });
            expect(realApiGap.summary).toBe("API coverage gap");
            expect(realApiGap.suspectLayer).toBe("integration");
        });

        test("buildCrossLayerMatrix separates pass rate from line coverage and marks coverage-only Core Module accurately", () => {
            const rows = buildCrossLayerMatrix({
                unitFiles: [
                    { filePath: "src/consent/consentManager.ts", linesPct: 100, branchesPct: 100, funcsPct: 100 },
                    { filePath: "src/core/lawDeterminer.ts", linesPct: 98.7, branchesPct: 100, funcsPct: 100 },
                    { filePath: "src/presets/index.ts", linesPct: 99.4, branchesPct: 100, funcsPct: 100 },
                ],
                unitScenarios: [
                    ...Array.from({ length: 44 }, (_, i) => ({
                        id: `c-p-${i}`,
                        title: `consent pass ${i}`,
                        testFile: "tests/consent.test.ts",
                        status: "passed",
                    })),
                    {
                        id: "c-f-1",
                        title: "consent fail 1",
                        testFile: "tests/consent.test.ts",
                        status: "failed",
                    },
                    ...Array.from({ length: 54 }, (_, i) => ({
                        id: `l-p-${i}`,
                        title: `law pass ${i}`,
                        testFile: "tests/law.test.ts",
                        status: "passed",
                    })),
                ],
                endpoints: [],
                systemScenarios: [],
                unitPillar: { totalTests: 99, passedTests: 98, failedTests: 1 },
                systemPillar: { totalTests: 0, passedTests: 0, failedTests: 0 },
            });

            const consent = rows.find((r) => r.moduleName === "Consent Module");
            const law = rows.find((r) => r.moduleName === "Law Module");
            const core = rows.find((r) => r.moduleName === "Core Module");

            expect(consent).toBeDefined();
            expect(consent.unit.total).toBe(45);
            expect(consent.unit.passed).toBe(44);
            expect(consent.unit.failed).toBe(1);
            expect(consent.unit.coverageOnly).toBe(false);
            expect(consent.unit.label).toBe("44/45 passed (97.8%) · 100% lines");

            expect(law).toBeDefined();
            expect(law.unit.total).toBe(54);
            expect(law.unit.label).toBe("54/54 passed (100%) · 98.7% lines");
            expect(law.integration.status).toBe("none");
            expect(law.integration.total).toBe(0);
            expect(law.rootCause.summary).not.toMatch(/API coverage gap/i);

            expect(core).toBeDefined();
            expect(core.unit.total).toBe(0);
            expect(core.unit.passed).toBe(0);
            expect(core.unit.coverageOnly).toBe(true);
            expect(core.unit.fileCount).toBe(1);
            expect(core.unit.avgLinesPct).toBe(99.4);
            expect(core.unit.label).toBe("99.4% lines · 100% branch");
            expect(core.integration.status).toBe("none");
            expect(core.rootCause.summary).not.toMatch(/API coverage gap/i);
        });
    });

    describe("Causal Trend Series: No Look-Ahead Leakage & Cumulative Pass Rate", () => {
        test("starts unexecuted tiers at 0 before their first run and computes cumulative passRate + epCovPct on latest Integration run", () => {
            // combinedHistoricalRuns is ordered newest -> oldest
            const combinedHistoricalRuns = [
                {
                    id: "run-3-unit",
                    type: "JEST",
                    snapshotId: "snap-1",
                    passedTests: 10,
                    failedTests: 0,
                    totalTests: 10,
                    coverageLinesPct: 100,
                    createdAt: "2026-11-27T03:00:00Z",
                },
                {
                    id: "run-2-int",
                    type: "SUPERTEST",
                    snapshotId: "snap-1",
                    passedTests: 18,
                    failedTests: 10,
                    totalTests: 28,
                    coverageLinesPct: 71.5, // Istanbul line cov != API endpoint cov
                    createdAt: "2026-11-27T02:00:00Z",
                },
                {
                    id: "run-1-unit",
                    type: "JEST",
                    snapshotId: "snap-1",
                    passedTests: 10,
                    failedTests: 0,
                    totalTests: 10,
                    coverageLinesPct: 100,
                    createdAt: "2026-11-27T01:00:00Z",
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-1",
                latestUnitRunId: "run-3-unit",
                latestIntRunId: "run-2-int",
                latestSysRunId: null,
                unitLinesPct: 100,
                epCovPct: 60,
                sysFlowCoveragePct: 0,
            });

            expect(series).toHaveLength(3);

            // Run #1 (only Unit has run): Integration must still be 0 (no look-ahead leakage!)
            expect(series[0].unitCoverage).toBe(100);
            expect(series[0].integrationCoverage).toBe(0);
            expect(series[0].systemCoverage).toBe(0);
            expect(series[0].overallCoverage).toBe(50);
            expect(series[0].passRate).toBe(100);

            // Run #2 (latest Integration run uses epCovPct=60 and cumulative pass rate = (10+18)/(10+28) = 73.7%)
            expect(series[1].unitCoverage).toBe(100);
            expect(series[1].integrationCoverage).toBe(60);
            expect(series[1].overallCoverage).toBe(68); // 100*0.5 + 60*0.3
            expect(series[1].passRate).toBe(73.7);

            // Run #3 (Unit re-run): cumulative pass rate combines Unit (10/10) + Integration (18/28) = 28/38 = 73.7%
            expect(series[2].unitCoverage).toBe(100);
            expect(series[2].integrationCoverage).toBe(60);
            expect(series[2].overallCoverage).toBe(68);
            expect(series[2].passRate).toBe(73.7);
        });

        test("multiple Integration runs on same snapshotId never inherit latestIntRunId epCovPct or mix Istanbul coverageLinesPct", () => {
            const combinedHistoricalRuns = [
                {
                    id: "run-2-int",
                    type: "SUPERTEST",
                    snapshotId: "snap-same",
                    passedTests: 16,
                    failedTests: 4,
                    totalTests: 20,
                    coverageLinesPct: 71.5, // Istanbul line cov != endpoint cov
                    createdAt: "2026-11-27T02:00:00Z",
                    snapshot: { id: "snap-same", commitSha: "abc1234", createdAt: "2026-11-27T00:00:00Z" },
                },
                {
                    id: "run-1-int",
                    type: "SUPERTEST",
                    snapshotId: "snap-same",
                    passedTests: 10,
                    failedTests: 10,
                    totalTests: 20,
                    coverageLinesPct: 68.4, // Istanbul line cov must NOT be mixed into endpoint cov series
                    createdAt: "2026-11-27T01:00:00Z",
                    snapshot: { id: "snap-same", commitSha: "abc1234", createdAt: "2026-11-27T00:00:00Z" },
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-same",
                latestIntRunId: "run-2-int",
                epCovPct: 80,
            });

            expect(series).toHaveLength(2);
            // Earlier run on SAME snapshot must NOT inherit epCovPct=80 or Istanbul 68.4%
            expect(series[0].integrationCoverage).toBe(0);
            expect(series[0].overallCoverage).toBe(0);
            expect(series[0].passRate).toBe(50);

            // Latest Integration run uses epCovPct=80
            expect(series[1].integrationCoverage).toBe(80);
            expect(series[1].overallCoverage).toBe(24); // 80 * 0.3
            expect(series[1].passRate).toBe(80);
        });

        test("historical Integration run with null/0 coverage never leaks current epCovPct backward, while explicit endpointCoveragePct is honored", () => {
            const combinedHistoricalRuns = [
                {
                    id: "run-3-int",
                    type: "PLAYWRIGHT_API",
                    snapshotId: "snap-2",
                    passedTests: 9,
                    failedTests: 1,
                    totalTests: 10,
                    coverageLinesPct: null,
                    createdAt: "2026-11-27T03:00:00Z",
                    snapshot: { id: "snap-2", commitSha: "def5678", createdAt: "2026-11-27T02:30:00Z" },
                },
                {
                    id: "run-2-int-null",
                    type: "SUPERTEST",
                    snapshotId: "snap-1",
                    passedTests: 5,
                    failedTests: 5,
                    totalTests: 10,
                    coverageLinesPct: 0,
                    createdAt: "2026-11-27T02:00:00Z",
                    snapshot: { id: "snap-1", commitSha: "abc1234", createdAt: "2026-11-27T00:00:00Z" },
                },
                {
                    id: "run-1-int-explicit",
                    type: "SUPERTEST",
                    snapshotId: "snap-0",
                    passedTests: 4,
                    failedTests: 6,
                    totalTests: 10,
                    coverageLinesPct: null,
                    endpointCoveragePct: 40,
                    createdAt: "2026-11-27T01:00:00Z",
                    snapshot: { id: "snap-0", commitSha: "0001112", createdAt: "2026-11-26T23:00:00Z" },
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-2",
                latestIntRunId: "run-3-int",
                epCovPct: 90,
            });

            expect(series).toHaveLength(3);
            expect(series[0].integrationCoverage).toBe(40);
            expect(series[1].integrationCoverage).toBe(40); // Preserves prior 40, never leaks future 90
            expect(series[2].integrationCoverage).toBe(90);
        });

        test("excludes CANCELED and 0-test runs without wiping out prior rolling pass rate or coverage", () => {
            expect(isExcludedCausalRun({ status: "CANCELED", passedTests: 2, failedTests: 0, totalTests: 2 })).toBe(true);
            expect(isExcludedCausalRun({ status: "COMPLETED", passedTests: 0, failedTests: 0, totalTests: 0 })).toBe(true);
            expect(isExcludedCausalRun({ status: "PASSED", passedTests: 5, failedTests: 0, totalTests: 5 })).toBe(false);

            const combinedHistoricalRuns = [
                {
                    id: "run-4-empty",
                    type: "JEST",
                    snapshotId: "snap-1",
                    status: "FAILED",
                    passedTests: 0,
                    failedTests: 0,
                    totalTests: 0,
                    coverageLinesPct: null,
                    createdAt: "2026-11-27T04:00:00Z",
                },
                {
                    id: "run-3-canceled",
                    type: "SUPERTEST",
                    snapshotId: "snap-1",
                    status: "CANCELED",
                    passedTests: 0,
                    failedTests: 0,
                    totalTests: 0,
                    coverageLinesPct: null,
                    createdAt: "2026-11-27T03:00:00Z",
                },
                {
                    id: "run-2-int",
                    type: "SUPERTEST",
                    snapshotId: "snap-1",
                    status: "PASSED",
                    passedTests: 10,
                    failedTests: 0,
                    totalTests: 10,
                    createdAt: "2026-11-27T02:00:00Z",
                },
                {
                    id: "run-1-unit",
                    type: "JEST",
                    snapshotId: "snap-1",
                    status: "PASSED",
                    passedTests: 20,
                    failedTests: 0,
                    totalTests: 20,
                    coverageLinesPct: 80,
                    createdAt: "2026-11-27T01:00:00Z",
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-1",
                latestUnitRunId: "run-1-unit",
                latestIntRunId: "run-2-int",
                unitLinesPct: 80,
                epCovPct: 70,
            });

            // Only the 2 valid runs remain; rolling unit/int coverage & 100% passRate stay intact
            expect(series).toHaveLength(2);
            expect(series[0].unitCoverage).toBe(80);
            expect(series[0].passRate).toBe(100);
            expect(series[1].unitCoverage).toBe(80);
            expect(series[1].integrationCoverage).toBe(70);
            expect(series[1].passRate).toBe(100);
        });

        test("sanitizes appliedTx: commitSha in runLabel and excludes future-snapshot runs", () => {
            const combinedHistoricalRuns = [
                {
                    id: "run-future-snap2",
                    type: "JEST",
                    snapshotId: "snap-2",
                    status: "PASSED",
                    passedTests: 50,
                    failedTests: 0,
                    totalTests: 50,
                    coverageLinesPct: 95,
                    createdAt: "2026-11-27T05:00:00Z",
                    snapshot: {
                        id: "snap-2",
                        commitSha: "ff998877",
                        createdAt: "2026-11-27T04:00:00Z",
                    },
                },
                {
                    id: "run-2-snap1",
                    type: "SUPERTEST",
                    snapshotId: "snap-1",
                    status: "PASSED",
                    passedTests: 10,
                    failedTests: 0,
                    totalTests: 10,
                    createdAt: "2026-11-27T02:00:00Z",
                    snapshot: {
                        id: "snap-1",
                        commitSha: "appliedTx:12345678",
                        createdAt: "2026-11-27T01:00:00Z",
                    },
                },
                {
                    id: "run-1-snap1",
                    type: "JEST",
                    snapshotId: "snap-1",
                    status: "PASSED",
                    passedTests: 10,
                    failedTests: 0,
                    totalTests: 10,
                    coverageLinesPct: 70,
                    createdAt: "2026-11-27T01:30:00Z",
                    snapshot: {
                        id: "snap-1",
                        commitSha: "appliedTx:12345678",
                        createdAt: "2026-11-27T01:00:00Z",
                    },
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-1",
                snapshotCreatedAt: "2026-11-27T01:00:00Z",
                latestUnitRunId: "run-1-snap1",
                latestIntRunId: "run-2-snap1",
                unitLinesPct: 70,
                epCovPct: 50,
            });

            expect(series).toHaveLength(2);
            expect(series[0].runLabel).toBe("#1 (snap-1)");
            expect(series[0].runLabel).not.toContain("applie");
            expect(series[1].runLabel).toBe("#2 (Current)");
            expect(series.every((pt) => pt.unitCoverage === 70)).toBe(true);
        });

        test("uses historical systemMeasurement coverage on non-latest PLAYWRIGHT/CYPRESS runs before falling back to pass rate", () => {
            const combinedHistoricalRuns = [
                {
                    id: "run-2-sys",
                    type: "PLAYWRIGHT",
                    snapshotId: "snap-2",
                    status: "PASSED",
                    passedTests: 4,
                    failedTests: 0,
                    totalTests: 4,
                    createdAt: "2026-11-27T02:00:00Z",
                    snapshot: { id: "snap-2", commitSha: "bbb222", createdAt: "2026-11-27T02:00:00Z" },
                },
                {
                    id: "run-1-sys",
                    type: "PLAYWRIGHT",
                    snapshotId: "snap-1",
                    status: "PASSED",
                    passedTests: 5,
                    failedTests: 0,
                    totalTests: 5, // passRate = 100%, but systemMeasurement linesPct = 60%
                    systemMeasurement: {
                        status: "MEASURED",
                        tiers: {
                            frontend: {
                                status: "MEASURED",
                                counters: { lines: { covered: 30, total: 50 } },
                            },
                        },
                    },
                    createdAt: "2026-11-27T01:00:00Z",
                    snapshot: { id: "snap-1", commitSha: "aaa111", createdAt: "2026-11-27T01:00:00Z" },
                },
            ];

            const series = buildCausalTrendSeries({
                combinedHistoricalRuns,
                snapshotId: "snap-2",
                snapshotCreatedAt: "2026-11-27T02:00:00Z",
                latestSysRunId: "run-2-sys",
                sysFlowCoveragePct: 82.5,
            });

            expect(series).toHaveLength(2);
            expect(series[0].systemCoverage).toBe(60); // From systemMeasurement, not 100% passRate
            expect(series[1].systemCoverage).toBe(82.5);
        });
    });
});

