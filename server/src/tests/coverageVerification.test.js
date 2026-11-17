import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import {
    WORKFLOW_STATES,
    buildTestSuiteManifest,
    validateExecutionScopeAndArtifacts,
    compareTargetedCoverage,
    buildCoverageVerificationDiagnostics,
    findIstanbulCoverageEntry,
} from "../services/coverageVerification.service.js";
import { verifyQualityCoverage } from "../services/unitTestQualityGate.service.js";

function makeEntry({ stmts = [1, 0], branches = [1, 0], fns = [1, 0] } = {}) {
    const statementMap = {};
    const s = {};
    stmts.forEach((hits, idx) => {
        const id = String(idx + 1);
        statementMap[id] = { start: { line: (idx + 1) * 10, column: 0 }, end: { line: (idx + 1) * 10, column: 20 } };
        s[id] = hits;
    });

    const branchMap = {};
    const b = {};
    if (branches.length > 0) {
        branchMap["1"] = {
            type: "if",
            line: 20,
            loc: { start: { line: 20, column: 0 }, end: { line: 20, column: 30 } },
            locations: branches.map((_, idx) => ({ start: { line: 20 + idx, column: 2 }, end: { line: 20 + idx, column: 10 } })),
        };
        b["1"] = branches;
    }

    const fnMap = {};
    const f = {};
    fns.forEach((hits, idx) => {
        const id = String(idx + 1);
        fnMap[id] = { name: `fn${id}`, decl: { start: { line: (idx + 1) * 5, column: 0 }, end: { line: (idx + 1) * 5, column: 10 } } };
        f[id] = hits;
    });

    return { statementMap, s, branchMap, b, fnMap, f };
}

describe("Targeted Coverage Verification & Suite Identity", () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-cov-ver-"));
        fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, "tests", "existing.test.js"), "test('base', () => expect(1).toBe(1));\n");
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test("1. Generated test passes in isolation but is not applied -> blocked with missing file diagnostic", () => {
        const baseline = buildTestSuiteManifest({
            executionId: "exec-base-1",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            coverageArtifactPath: "coverage/base/coverage-final.json",
        });
        const postApply = buildTestSuiteManifest({
            executionId: "exec-post-1",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            coverageArtifactPath: "coverage/post/coverage-final.json",
        });

        const scope = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: postApply,
            expectedAppliedTestFiles: ["tests/existing.test.js", "tests/newProduct.test.js"],
        });

        expect(scope.valid).toBe(false);
        expect(scope.reason).toBe("APPLIED_TEST_FILES_MISSING_FROM_SUITE");
        expect(scope.missingAppliedTestFiles).toEqual(["tests/newProduct.test.js"]);

        const diag = buildCoverageVerificationDiagnostics({
            workflowState: WORKFLOW_STATES.COVERAGE_VERIFICATION_BLOCKED,
            baselineManifest: baseline,
            postApplyManifest: postApply,
            scopeValidation: scope,
        });
        expect(diag.workflowState).toBe(WORKFLOW_STATES.COVERAGE_VERIFICATION_BLOCKED);
        expect(diag.baselineExecutionId).toBe("exec-base-1");
        expect(diag.postApplyExecutionId).toBe("exec-post-1");
    });

    test("2. Generated test applied and included -> scope valid & targeted gain verified", () => {
        const baseline = buildTestSuiteManifest({
            executionId: "exec-base-2",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            coverageArtifactPath: "coverage/base/coverage-final.json",
        });

        fs.writeFileSync(path.join(tmpRoot, "tests", "product.coverage.test.js"), "test('new', () => expect(2).toBe(2));\n");

        const postApply = buildTestSuiteManifest({
            executionId: "exec-post-2",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js", "tests/product.coverage.test.js"],
            coverageArtifactPath: "coverage/post/coverage-final.json",
        });

        const scope = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: postApply,
            expectedAppliedTestFiles: ["tests/existing.test.js", "tests/product.coverage.test.js"],
        });
        expect(scope.valid).toBe(true);

        const cmp = compareTargetedCoverage({
            baselineCoverage: { "src/productService.js": makeEntry({ stmts: [1, 0], branches: [1, 0], fns: [1, 0] }) },
            postApplyCoverage: { "/workspace/src/productService.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }) },
            targetSourceFiles: ["src/productService.js"],
        });
        expect(cmp.hasAnyTargetGain).toBe(true);
        expect(cmp.allTargetsAtThreshold).toBe(true);
        expect(cmp.perSource[0].newlyCovered.statementIds).toEqual(["2"]);
        expect(cmp.perSource[0].newlyCovered.branchIds).toEqual(["1:1"]);
        expect(cmp.perSource[0].newlyCovered.functionIds).toEqual(["2"]);
    });

    test("3. Unchanged suite manifest or reused execution ID / artifact path is rejected", () => {
        const baseline = buildTestSuiteManifest({
            executionId: "exec-1",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            coverageArtifactPath: "coverage/shared/coverage-final.json",
        });

        const sameExec = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: { ...baseline },
            expectedAppliedTestFiles: ["tests/existing.test.js"],
        });
        expect(sameExec.valid).toBe(false);
        expect(sameExec.reason).toBe("SAME_EXECUTION_ID_REUSED");

        const sameArtifact = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: { ...baseline, executionId: "exec-2" },
            expectedAppliedTestFiles: ["tests/existing.test.js"],
        });
        expect(sameArtifact.valid).toBe(false);
        expect(sameArtifact.reason).toBe("COVERAGE_ARTIFACT_OVERWRITTEN");

        const unchanged = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: { ...baseline, executionId: "exec-2", coverageArtifactPath: "coverage/post/coverage-final.json" },
            expectedAppliedTestFiles: ["tests/existing.test.js"],
        });
        expect(unchanged.valid).toBe(false);
        expect(unchanged.reason).toBe("CONTENT_UNCHANGED");

        // Intentional reuse of existing test is allowed when explicitly flagged
        const reused = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: { ...baseline, executionId: "exec-2", coverageArtifactPath: "coverage/post/coverage-final.json" },
            expectedAppliedTestFiles: ["tests/existing.test.js"],
            reusedExistingTests: true,
        });
        expect(reused.valid).toBe(true);
    });

    test("4. Unrelated file gain, statement-only gain without branch 100%, and repeated verification idempotency", () => {
        const cmpUnrelated = compareTargetedCoverage({
            baselineCoverage: { "src/target.js": makeEntry({ stmts: [1, 0], branches: [1, 0], fns: [1, 0] }) },
            postApplyCoverage: {
                "src/target.js": makeEntry({ stmts: [1, 0], branches: [1, 0], fns: [1, 0] }),
                "src/unrelated.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }),
            },
            targetSourceFiles: ["src/target.js"],
        });
        expect(cmpUnrelated.hasAnyTargetGain).toBe(false);

        const cmpPartial = compareTargetedCoverage({
            baselineCoverage: { "src/target.js": makeEntry({ stmts: [1, 0], branches: [1, 0], fns: [1, 0] }) },
            postApplyCoverage: { "src/target.js": makeEntry({ stmts: [1, 1], branches: [1, 0], fns: [1, 1] }) },
            targetSourceFiles: ["src/target.js"],
        });
        expect(cmpPartial.perSource[0].gainPct.statements).toBe(50);
        expect(cmpPartial.perSource[0].gainPct.branches).toBe(0);
        expect(cmpPartial.allTargetsAtThreshold).toBe(false);

        // Repeated verification on already-covered code yields 0 newlyCovered
        const cmpRepeat = compareTargetedCoverage({
            baselineCoverage: { "src/target.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }) },
            postApplyCoverage: { "src/target.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }) },
            targetSourceFiles: ["src/target.js"],
        });
        expect(cmpRepeat.hasAnyTargetGain).toBe(false);
        expect(cmpRepeat.newlyCovered.statementIds).toEqual([]);
        expect(cmpRepeat.newlyCovered.branchIds).toEqual([]);
    });

    test("5. Subproject & Docker /workspace/ path normalization works in verifyQualityCoverage", () => {
        const entry = findIstanbulCoverageEntry(
            { "/workspace/services/productService.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }) },
            "server/services/productService.js"
        );
        expect(entry).not.toBeNull();

        const res = verifyQualityCoverage({
            items: [{ testFile: "tests/p.test.js", sourceFile: "server/services/productService.js", targetBranches: ["if:20"] }],
            baseline: { "/workspace/services/productService.js": makeEntry({ stmts: [1, 0], branches: [1, 0], fns: [1, 0] }) },
            candidate: { "/workspace/services/productService.js": makeEntry({ stmts: [1, 1], branches: [1, 1], fns: [1, 1] }) },
        });
        expect(res[0].verified).toBe(true);
        expect(res[0].branches).toEqual(["if:20"]);
    });

    test("6. Same-path content modification (merge), FILE_WRITE_NOT_CONFIRMED, TEST_DISCOVERY_MISCONFIGURED, and APPLY_NOT_PERFORMED", () => {
        const baseline = buildTestSuiteManifest({
            executionId: "exec-base-6",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            coverageArtifactPath: "coverage/base/coverage-final.json",
        });

        // 6a. Same path, modified content (merged into existing.test.js)
        const mergedContent = "test('base', () => expect(1).toBe(1));\ntest('merged', () => expect(2).toBe(2));\n";
        fs.writeFileSync(path.join(tmpRoot, "tests", "existing.test.js"), mergedContent);
        const postMerged = buildTestSuiteManifest({
            executionId: "exec-post-6a",
            projectId: "proj-1",
            rootDir: tmpRoot,
            testFiles: ["tests/existing.test.js"],
            appliedSuggestionIds: ["sug-1"],
            coverageArtifactPath: "coverage/post-6a/coverage-final.json",
        });

        const staged = new Map([["tests/existing.test.js", fs.existsSync(path.join(tmpRoot, "tests", "existing.test.js")) ? postMerged.testFiles[0].contentHash : ""]]);
        const mergeScope = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: postMerged,
            expectedAppliedTestFiles: ["tests/existing.test.js"],
            stagedFilesByPath: staged,
            discoveredTestFiles: ["tests/existing.test.js"],
        });
        expect(mergeScope.valid).toBe(true);
        expect(mergeScope.manifestDiff.modifiedFiles).toEqual(["tests/existing.test.js"]);

        // 6b. FILE_WRITE_NOT_CONFIRMED (staged hash mismatch)
        const badWrite = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: postMerged,
            expectedAppliedTestFiles: ["tests/existing.test.js"],
            stagedFilesByPath: new Map([["tests/existing.test.js", "different-hash"]]),
            discoveredTestFiles: ["tests/existing.test.js"],
        });
        expect(badWrite.valid).toBe(false);
        expect(badWrite.reason).toBe("FILE_WRITE_NOT_CONFIRMED");

        // 6c. TEST_DISCOVERY_MISCONFIGURED (written outside discovered test dirs)
        const badDiscovery = validateExecutionScopeAndArtifacts({
            baselineManifest: baseline,
            postApplyManifest: postMerged,
            expectedAppliedTestFiles: ["tests/existing.test.js"],
            stagedFilesByPath: staged,
            discoveredTestFiles: [],
        });
        expect(badDiscovery.valid).toBe(false);
        expect(badDiscovery.reason).toBe("TEST_DISCOVERY_MISCONFIGURED");

        // 6d. APPLY_NOT_PERFORMED when all applied suggestions had changed: false
        const notPerformed = validateExecutionScopeAndArtifacts({
            baselineManifest: postMerged,
            postApplyManifest: { ...postMerged, executionId: "exec-post-6d", coverageArtifactPath: "coverage/post-6d/coverage-final.json" },
            expectedAppliedTestFiles: ["tests/existing.test.js"],
            appliedSuggestions: [{ testFile: "tests/existing.test.js", changed: false }],
        });
        expect(notPerformed.valid).toBe(false);
        expect(notPerformed.reason).toBe("APPLY_NOT_PERFORMED");
    });
});
