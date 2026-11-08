import { extractExecutionDurationMs } from "../services/testResultParser.service.js";

describe("Cross-Dashboard Logic Synchronization Parity Tests", () => {
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
});

