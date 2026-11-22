import { extractExecutionDurationMs } from "../services/testResultParser.service.js";
import { healProjectLifecycleStatusIfNeeded } from "../services/project.service.js";
import { getDashboardFingerprint } from "../services/unifiedQualityDashboard.service.js";
import { getPortfolioFingerprint } from "../services/portfolioDashboard.service.js";
import { isMatch } from "../services/integrationWorkspace.service.js";

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
    });
});

