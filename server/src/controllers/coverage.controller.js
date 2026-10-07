import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { createInstallDepsJob, createRunTestsJob, createSupertestCoverageJob, createVitestCoverageJob, createSystemTestAnalysisJob } from "../services/job.service.js";
import { jobQueue, addSupertestCoveragePipeline, addJobToQueue } from "../services/queue.service.js";
import { processCoverageJob } from "../services/coverageRunner.service.js";
import { detectSupertest } from "../services/supertestDetection.service.js";
import { detectCoverageFrameworks, selectCoverageFramework } from "../services/coverageFramework.service.js";
import { buildIntegrationWorkspace, getIntegrationHistoryService } from "../services/integrationWorkspace.service.js";

import { getFileCoverageDetails } from "../services/fileCoverage.service.js";
import { suggestUnitTestcases } from "../services/unitTestSuggestion.service.js";
import { generateColdStartSystemTests } from "../services/verifiedSystemGeneration.service.js";
import { detectSystemTestFrameworksForSnapshot } from "../services/systemTestFrameworkDetection.service.js";
import { optimizeSystemTest } from "../services/systemTestBooster.service.js";
import { validateGeneratedTestCode } from "../validators/aiTestCode.validator.js";
import { extractSuitesAndScenarios } from "../utils/testFileParser.js";
import { containedPath } from "../services/fullSystemLifecycle.service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SORT_FIELDS = ["filePath", "linesPct", "branchesPct", "funcsPct", "stmtsPct"];
const ALLOWED_SORT_ORDERS = ["asc", "desc"];
const ALLOWED_FUNC_SORT_FIELDS = ["functionName", "filePath", "hit", "startLine"];

const findOwnedSnapshot = (snapshotId, userId) => prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, project: { ownerId: userId } },
    select: { id: true, projectId: true, rootDir: true },
});

export const getCoverageFrameworks = async (req, res) => {
    try {
        const snapshot = await findOwnedSnapshot(req.params.snapshotId, req.user?.id);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        if (!snapshot.rootDir) return res.status(409).json({ success: false, message: "Snapshot is not ready for analysis." });
        return res.json({ success: true, data: detectCoverageFrameworks(snapshot.rootDir) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

export const runCoverageByType = async (req, res) => {
    try {
        const { snapshotId, coverageType } = req.params;
        const requestedFramework = req.body?.framework || req.query?.framework || null;
        const userId = req.user?.id;
        const snapshot = await findOwnedSnapshot(snapshotId, userId);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        if (!snapshot.rootDir) return res.status(409).json({ success: false, message: "Snapshot is not ready for analysis." });

        const detection = detectCoverageFrameworks(snapshot.rootDir);
        let job;
        let jobs = [];
        let framework;

        if (coverageType === "unit") {
            const unitFws = detection.supported?.unit || [];
            // If both Jest and Vitest are detected, run BOTH automatically!
            if (unitFws.includes("jest") && unitFws.includes("vitest")) {
                framework = "jest & vitest";
                const jestJob = await createRunTestsJob({ projectId: snapshot.projectId, snapshotId, userId, mode: "FULL" });
                const vitestJob = await createVitestCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });
                await addJobToQueue("RUN_TESTS", jestJob.id);
                await addJobToQueue("VITEST_COVERAGE", vitestJob.id);
                job = jestJob;
                jobs = [jestJob, vitestJob];
            } else if (unitFws.includes("vitest")) {
                framework = "vitest";
                job = await createVitestCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });
                await addJobToQueue("VITEST_COVERAGE", job.id);
                jobs = [job];
            } else {
                framework = "jest";
                job = await createRunTestsJob({ projectId: snapshot.projectId, snapshotId, userId, mode: "FULL" });
                await addJobToQueue("RUN_TESTS", job.id);
                jobs = [job];
            }
        } else {
            framework = selectCoverageFramework(detection, coverageType, requestedFramework);
            if (framework === "supertest") {
                const installJob = await createInstallDepsJob({ projectId: snapshot.projectId, snapshotId, userId });
                job = await createSupertestCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });
                await addSupertestCoveragePipeline(installJob.id, job.id);
                jobs = [installJob, job];
            } else {
                const runner = framework === "cypress" ? "cypress" : "playwright";
                job = await createSystemTestAnalysisJob({
                    projectId: snapshot.projectId,
                    snapshotId,
                    userId,
                    runner,
                    executionMode: req.body?.executionMode || "full",
                });
                await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id);
                jobs = [job];
            }
        }

        return res.status(202).json({
            success: true,
            message: `${framework} ${coverageType} coverage queued.`,
            data: { framework, coverageType, detectedFrameworks: detection.all, job, jobs },
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            code: error.code,
            message: error.message || "Unable to run coverage analysis.",
            details: error.details,
        });
    }
};

/**
 * SCRUM-151: Create summary endpoint
 * SCRUM-152: Verify permissions
 * SCRUM-153: Retrieve CoverageSummary
 * SCRUM-154: Return formatted response
 *
 * GET /api/coverage/:snapshotId/summary
 */
export const getCoverageSummary = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;

        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        // Verify snapshot tồn tại và thuộc project của user
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                source: true,
                commitSha: true,
                createdAt: true,
                rootDir: true,
                project: {
                    select: { ownerId: true, name: true },
                },
            },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot không tồn tại." });
        }

        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập snapshot này." });
        }

        // Retrieve CoverageSummary
        const summary = await prisma.coverageSummary.findUnique({
            where: { snapshotId },
        });

        const coverage = summary
            ? {
                lines: summary.linesPct,
                branches: summary.branchesPct,
                functions: summary.funcsPct,
                statements: summary.stmtsPct,
            }
            : {
                lines: 0,
                branches: 0,
                functions: 0,
                statements: 0,
            };

        // Read rawTotals from coverage-summary.json if exists
        let rawTotals = null;
        if (snapshot.rootDir) {
            const summaryFile = path.join(snapshot.rootDir, "coverage", "coverage-summary.json");
            if (fs.existsSync(summaryFile)) {
                try {
                    const raw = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
                    if (raw && raw.total) {
                        rawTotals = {
                            statements: raw.total.statements || null,
                            branches: raw.total.branches || null,
                            functions: raw.total.functions || null,
                            lines: raw.total.lines || null,
                        };
                    }
                } catch (_) { }
            }
        }

        // Return formatted response even before the first coverage run completes.
        return res.status(200).json({
            success: true,
            data: {
                snapshotId: snapshot.id,
                projectId: snapshot.projectId,
                projectName: snapshot.project.name,
                source: snapshot.source,
                commitSha: snapshot.commitSha ?? null,
                snapshotCreatedAt: snapshot.createdAt,
                coverage,
                rawTotals,
                summaryCreatedAt: summary?.createdAt ?? null,
            },
        });

    } catch (error) {
        console.error("[CoverageSummary] Lỗi server:", error);
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Có lỗi server!" });
    }
};

/**
 * POST /api/coverage/:snapshotId/run
 *
 * Trigger pipeline bất đồng bộ:
 *   INSTALL_DEPS Job (npm install) → on success → RUN_TESTS Job (jest --coverage)
 *
 * Trả về ngay installJobId để Frontend poll trạng thái.
 */
export const runCoverage = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        // Lấy snapshot + kiểm tra quyền
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                rootDir: true,
                hasJest: true,
                jestConfigPath: true,
                project: { select: { ownerId: true, name: true } },
            },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot không tồn tại." });
        }
        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập snapshot này." });
        }

        // Snapshot phải có rootDir (INGEST job đã xong)
        if (!snapshot.rootDir) {
            return res.status(409).json({
                success: false,
                message: "Snapshot chưa được giải nén (INGEST job chưa hoàn thành). Hãy đợi INGEST xong.",
            });
        }

        if (!snapshot.rootDir) {
            return res.status(422).json({ success: false, message: "Invalid Node.js project: package.json was not found in the uploaded project." });
        }

        const fs = await import("fs");
        const path = await import("path");
        const candidateDirs = ["", "server", "backend", "api", "client", "frontend", "web", "app"];
        const hasPackageJson = candidateDirs.some((cand) =>
            fs.existsSync(cand ? path.join(snapshot.rootDir, cand, "package.json") : path.join(snapshot.rootDir, "package.json"))
        );
        if (!hasPackageJson) {
            return res.status(422).json({ success: false, message: "Invalid Node.js project: package.json was not found in the uploaded project." });
        }

        // Tạo INSTALL_DEPS Job
        const installJob = await createInstallDepsJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
        });

        // Kick-off pipeline bất đồng bộ qua Queue (COVERAGE_PIPELINE)
        addJobToQueue("COVERAGE_PIPELINE", installJob.id, {
            snapshotId,
            userId,
            projectId: snapshot.projectId
        }).catch((err) => {
            console.error(`[Coverage Pipeline] Lỗi khi thêm vào queue:`, err);
        });

        return res.status(200).json({
            success: true,
            message: "Pipeline coverage đã được khởi động (INSTALL_DEPS → RUN_TESTS).",
            installJobId: installJob.id,
            snapshotId,
            hint: "Poll GET /api/job/:jobId để theo dõi trạng thái.",
        });

    } catch (error) {
        console.error("[RunCoverage] Lỗi server:", error);
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Có lỗi server!" });
    }
};

/**
 * POST /api/coverage/:snapshotId/supertest/run
 * Queues a dedicated Supertest integration coverage job.
 */
export const runSupertestCoverage = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || !snapshotId.trim()) {
            return res.status(400).json({ success: false, message: "Invalid snapshotId." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { id: true, projectId: true, rootDir: true, project: { select: { ownerId: true } } },
        });
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });
        if (!snapshot.rootDir) return res.status(409).json({ success: false, message: "Snapshot is not ready to run tests." });

        const fs = await import("fs");
        const path = await import("path");
        const candidateDirs = ["", "server", "backend", "api", "client", "frontend", "web", "app"];
        const hasPackageJson = candidateDirs.some((cand) =>
            fs.existsSync(cand ? path.join(snapshot.rootDir, cand, "package.json") : path.join(snapshot.rootDir, "package.json"))
        );
        if (!hasPackageJson) {
            return res.status(422).json({ success: false, message: "Invalid Node.js project: package.json was not found in the uploaded project." });
        }

        const supertestInfo = await detectSupertest(snapshot.rootDir);
        if (!supertestInfo.detected || supertestInfo.supertestFiles.length === 0) {
            return res.status(422).json({ success: false, message: "No Supertest test files were found in this snapshot." });
        }

        // Snapshots normally do not include node_modules. Install first so the
        // runner never falls back to npx downloading arbitrary packages.
        const installJob = await createInstallDepsJob({ projectId: snapshot.projectId, snapshotId, userId });
        const job = await createSupertestCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });

        // Queue Supertest pipeline with correct BullMQ dependency direction:
        // SUPERTEST_COVERAGE_PIPELINE (parent) waits for INSTALL_DEPS (child)
        try {
            await addSupertestCoveragePipeline(installJob.id, job.id);
        } catch (error) {
            console.error(`[Supertest Pipeline] Error queuing pipeline:`, error);
            throw error;
        }

        return res.status(202).json({
            success: true,
            message: "Supertest coverage pipeline queued (install dependencies, then run tests).",
            jobId: job.id,
            installJobId: installJob.id,
            snapshotId,
            supertestFileCount: supertestInfo.supertestFiles.length,
        });
    } catch (error) {
        console.error("[RunSupertestCoverage] Server error:", error);
        if (error instanceof ServiceError) return res.status(error.statusCode).json({ success: false, message: error.message });
        return res.status(500).json({ success: false, message: "Unable to queue Supertest coverage." });
    }
};

/**
 * SCRUM-155: Create files endpoint
 * SCRUM-156: Verify permissions
 * SCRUM-157: Retrieve CoverageFile records
 * SCRUM-158: Support sorting
 *
 * GET /api/coverage/:snapshotId/files
 *
 * Query params:
 *  - sortBy   : "filePath" | "linesPct" | "branchesPct" | "funcsPct" | "stmtsPct"  (default: "filePath")
 *  - order    : "asc" | "desc"  (default: "asc")
 *  - page     : number >= 1     (default: 1)
 *  - limit    : number 1-200    (default: 50)
 */
export const getCoverageFiles = async (req, res) => {
    try {
        // ── Auth ────────────────────────────────────────────────────────────
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        // ── SCRUM-155: Validate params ───────────────────────────────────────
        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        // ── SCRUM-158: Parse & validate sorting params ───────────────────────
        const rawSortBy = req.query.sortBy ?? "filePath";
        const rawOrder = req.query.order ?? "asc";

        const sortBy = ALLOWED_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "filePath";
        const order = ALLOWED_SORT_ORDERS.includes(rawOrder) ? rawOrder : "asc";

        // Pagination
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const skip = (page - 1) * limit;

        // ── SCRUM-156: Verify permissions ────────────────────────────────────
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                source: true,
                commitSha: true,
                createdAt: true,
                project: {
                    select: { ownerId: true, name: true },
                },
            },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot không tồn tại." });
        }

        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({
                success: false,
                message: "Bạn không có quyền truy cập snapshot này.",
            });
        }

        // ── SCRUM-157: Retrieve CoverageFile records ─────────────────────────
        const [files, total] = await Promise.all([
            prisma.coverageFile.findMany({
                where: { snapshotId },
                orderBy: { [sortBy]: order },
                skip,
                take: limit,
                select: {
                    id: true,
                    filePath: true,
                    linesPct: true,
                    branchesPct: true,
                    funcsPct: true,
                    stmtsPct: true,
                },
            }),
            prisma.coverageFile.count({ where: { snapshotId } }),
        ]);

        // Return an empty dataset instead of a 404 so the UI can render a valid
        // "no coverage generated yet" state without treating it as a broken API.
        return res.status(200).json({
            success: true,
            data: {
                snapshotId: snapshot.id,
                projectId: snapshot.projectId,
                projectName: snapshot.project.name,
                source: snapshot.source,
                commitSha: snapshot.commitSha ?? null,
                snapshotCreatedAt: snapshot.createdAt,
                sorting: { sortBy, order },
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
                files,
            },
        });

    } catch (error) {
        console.error("[CoverageFiles] Lỗi server:", error);
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Có lỗi server!" });
    }
};

/**
 * SCRUM-160: Create functions endpoint
 * SCRUM-161: Verify permissions
 * SCRUM-162: Retrieve CoverageFunction records
 * SCRUM-163: Support filtering by file
 *
 * GET /api/coverage/:snapshotId/functions
 *
 * Query params:
 *  - filePath : string  (optional) — lọc functions theo file path (SCRUM-163, partial match)
 *  - sortBy   : "functionName" | "filePath" | "hit" | "startLine"  (default: "filePath")
 *  - order    : "asc" | "desc"  (default: "asc")
 *  - page     : number >= 1     (default: 1)
 *  - limit    : number 1-200    (default: 50)
 */
export const getTestExecution = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required." });

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { project: { select: { ownerId: true } } }
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        const testRuns = await prisma.testRun.findMany({
            where: { snapshotId },
            orderBy: { createdAt: "desc" }
        });

        // Map to expected frontend structure
        const latestByType = (type) => testRuns.find(r => r.type === type) || null;

        return res.status(200).json({
            success: true,
            data: {
                jest: latestByType("JEST"),
                vitest: latestByType("VITEST"),
                supertest: latestByType("SUPERTEST"),
                playwright: latestByType("PLAYWRIGHT"),
                cypress: latestByType("CYPRESS")
            }
        });
    } catch (error) {
        console.error("[getTestExecution] Error:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

/**
 * GET /api/coverage/:snapshotId/test-suites?type=unit|integration|system
 * Returns test files executed for this snapshot, with classification and test case counts.
 * For type=unit: strictly returns Jest and Vitest test files only.
 */
export const getCoverageTestSuites = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required." });

        const requestedType = (req.query.type || "unit").toLowerCase();

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                rootDir: true,
                project: { select: { ownerId: true } }
            }
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(200).json({ success: true, data: { testSuites: [] } });
        }

        // 1. Locate test-results.json (check candidate paths and merge results from both Jest & Vitest)
        const candidatePaths = [
            path.join(snapshot.rootDir, "coverage", "jest-results.json"),
            path.join(snapshot.rootDir, "coverage", "vitest-results.json"),
            path.join(snapshot.rootDir, "jest-results.json"),
            path.join(snapshot.rootDir, "vitest-results.json"),
            path.join(snapshot.rootDir, "test-results.json"),
            path.join(snapshot.rootDir, "coverage", "test-results.json"),
            path.join(snapshot.rootDir, "coverage", "test-result.json"),
        ];

        const allTestResults = [];
        const seenFiles = new Set();
        for (const p of candidatePaths) {
            if (fs.existsSync(p) && !seenFiles.has(p)) {
                seenFiles.add(p);
                try {
                    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
                    if (Array.isArray(parsed?.testResults)) {
                        allTestResults.push(...parsed.testResults);
                    }
                } catch (_) { }
            }
        }

        const norm = (p) => (p || "").replace(/\\/g, "/").replace(/^\.?\//, "").trim();

        // Map results by normalized relative path
        const resultsByPath = new Map();
        for (const suite of allTestResults) {
            const normName = suite.name ? norm(path.relative(snapshot.rootDir, suite.name)) : "";
            const cleanName = normName || (suite.name ? norm(suite.name) : "");
            resultsByPath.set(cleanName, suite);
            resultsByPath.set(path.basename(cleanName), suite);
        }

        // 2. Discover test files in snapshot rootDir
        const testFiles = [];
        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "coverage") {
                        scanDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    const isTest = /(^|\/)(tests?|__tests__|spec)\//i.test(fullPath.replace(/\\/g, "/")) ||
                        /\.(test|spec)\.[a-z0-9]+$/i.test(entry.name);
                    if (isTest) {
                        testFiles.push(fullPath);
                    }
                }
            }
        };

        scanDir(snapshot.rootDir);

        // 3. Classify and assemble test suites
        const suites = [];
        for (const fullPath of testFiles) {
            const relPath = norm(path.relative(snapshot.rootDir, fullPath));
            const baseName = path.basename(fullPath);
            const lowerPath = relPath.toLowerCase();

            // Read header content to detect framework imports
            let contentHeader = "";
            try {
                const buf = Buffer.alloc(1024);
                const fd = fs.openSync(fullPath, "r");
                const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
                fs.closeSync(fd);
                contentHeader = buf.toString("utf8", 0, bytesRead).toLowerCase();
            } catch (_) { }

            // Framework classification
            let framework = "jest";
            let category = "unit";

            if (lowerPath.includes("supertest") || contentHeader.includes("supertest")) {
                framework = "supertest";
                category = "integration";
            } else if (lowerPath.includes("playwright") || contentHeader.includes("@playwright/test")) {
                framework = "playwright";
                category = "system";
            } else if (lowerPath.includes("cypress") || contentHeader.includes("cypress")) {
                framework = "cypress";
                category = "system";
            } else if (lowerPath.includes("vitest") || contentHeader.includes("vitest")) {
                framework = "vitest";
                category = "unit";
            } else {
                framework = "jest";
                category = "unit";
            }

            // Filter strictly by requested type!
            // If requestedType === "unit", ONLY return unit (Jest & Vitest)
            if (category !== requestedType) {
                continue;
            }

            // Find matching execution results from test-results.json
            const suiteResult = resultsByPath.get(relPath) || resultsByPath.get(baseName);
            const assertions = (suiteResult && Array.isArray(suiteResult.assertionResults))
                ? suiteResult.assertionResults.map(a => ({
                    title: a.title || a.fullName || "Test case",
                    status: a.status || "passed",
                    duration: a.duration || 0
                }))
                : [];

            const totalTests = assertions.length || (suiteResult?.numPassingTests ?? 0) + (suiteResult?.numFailingTests ?? 0) || 1;
            const passedTests = assertions.filter(a => a.status === "passed").length || (suiteResult?.numPassingTests ?? (suiteResult?.status === "passed" ? totalTests : 0));
            const failedTests = assertions.filter(a => a.status === "failed").length || (suiteResult?.numFailingTests ?? (suiteResult?.status === "failed" ? totalTests : 0));

            let status = "passed";
            if (suiteResult) {
                status = suiteResult.status === "failed" || failedTests > 0 ? "failed" : "passed";
            }

            const durationMs = suiteResult ? (suiteResult.endTime - suiteResult.startTime) || 10 : 0;

            suites.push({
                filePath: relPath,
                fileName: baseName,
                framework,
                category,
                status,
                totalTests,
                passedTests,
                failedTests,
                durationMs,
                assertions,
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                snapshotId,
                type: requestedType,
                totalSuites: suites.length,
                testSuites: suites
            }
        });
    } catch (error) {
        console.error("[getCoverageTestSuites] Error:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

export const getCoverageFunctions = async (req, res) => {
    try {
        // ── Auth ─────────────────────────────────────────────────────────────
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        // ── SCRUM-160: Validate route param ───────────────────────────────────
        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        // ── SCRUM-163: Parse filter + sorting + pagination ────────────────────
        const filePathFilter =
            typeof req.query.filePath === "string" && req.query.filePath.trim().length > 0
                ? req.query.filePath.trim()
                : null;

        const rawSortBy = req.query.sortBy ?? "filePath";
        const rawOrder = req.query.order ?? "asc";
        const sortBy = ALLOWED_FUNC_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "filePath";
        const order = ALLOWED_SORT_ORDERS.includes(rawOrder) ? rawOrder : "asc";

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const skip = (page - 1) * limit;

        // ── SCRUM-161: Verify permissions ─────────────────────────────────────
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                source: true,
                commitSha: true,
                createdAt: true,
                project: {
                    select: { ownerId: true, name: true },
                },
            },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot không tồn tại." });
        }

        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({
                success: false,
                message: "Bạn không có quyền truy cập snapshot này.",
            });
        }

        // ── SCRUM-162: Retrieve CoverageFunction records ───────────────────────
        const where = {
            snapshotId,
            // SCRUM-163: optional filter by filePath (partial, case-insensitive)
            ...(filePathFilter && {
                filePath: { contains: filePathFilter, mode: "insensitive" },
            }),
        };

        const [functions, total] = await Promise.all([
            prisma.coverageFunction.findMany({
                where,
                orderBy: { [sortBy]: order },
                skip,
                take: limit,
                select: {
                    id: true,
                    filePath: true,
                    functionName: true,
                    startLine: true,
                    endLine: true,
                    hit: true,
                },
            }),
            prisma.coverageFunction.count({ where }),
        ]);

        // Return an empty dataset instead of a 404 so the UI can render a valid
        // empty coverage state while tests are still running or no tests exist.
        return res.status(200).json({
            success: true,
            data: {
                snapshotId: snapshot.id,
                projectId: snapshot.projectId,
                projectName: snapshot.project.name,
                source: snapshot.source,
                commitSha: snapshot.commitSha ?? null,
                snapshotCreatedAt: snapshot.createdAt,
                filter: { filePath: filePathFilter },
                sorting: { sortBy, order },
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
                functions,
            },
        });

    } catch (error) {
        console.error("[CoverageFunctions] Lỗi server:", error);
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Có lỗi server!" });
    }
};

/**
 * GET /api/coverage/:snapshotId/integration/workspace
 * Retrieves the data for the new Integration Test Workspace
 */
export const getIntegrationWorkspace = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required." });

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { project: { select: { ownerId: true } } }
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        const workspaceData = await buildIntegrationWorkspace(snapshotId);

        return res.status(200).json({ success: true, data: workspaceData });
    } catch (error) {
        console.error("[getIntegrationWorkspace] Server error:", error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Server error while fetching integration workspace." });
    }
};

export const approveIntegrationTests = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required." });

        const { approvedTestIds } = req.body;
        if (!Array.isArray(approvedTestIds)) {
            return res.status(400).json({ success: false, message: "approvedTestIds array is required." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { project: { select: { ownerId: true } } }
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        // Group approved scenarios by AiTest ID
        const approvedScenariosByTestId = {};
        for (const idStr of approvedTestIds) {
            const separatorIndex = idStr.indexOf("::");
            if (separatorIndex === -1) continue;
            
            const testId = idStr.substring(0, separatorIndex);
            const scenarioName = idStr.substring(separatorIndex + 2);
            
            if (!approvedScenariosByTestId[testId]) approvedScenariosByTestId[testId] = [];
            if (scenarioName) approvedScenariosByTestId[testId].push(scenarioName);
        }

        const aiTests = await prisma.aiTest.findMany({ where: { snapshotId } });

        for (const t of aiTests) {
            try {
                if (t.metaJson) {
                    const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
                    if (meta.framework === "SUPERTEST") {
                        const approvedScenarios = approvedScenariosByTestId[t.id] || [];
                        const isApproved = approvedScenarios.length > 0;
                        
                        meta.status = isApproved ? "APPROVED" : "DRAFT";
                        meta.approvedScenarios = approvedScenarios;
                        
                        await prisma.aiTest.update({
                            where: { id: t.id },
                            data: { metaJson: JSON.stringify(meta) }
                        });
                    }
                }
            } catch (e) {
                console.error("Failed to parse metaJson for AiTest", t.id, e);
            }
        }

        return res.status(200).json({ success: true, message: "Approved successfully." });
    } catch (error) {
        console.error("[approveIntegrationTests] Server error:", error);
        return res.status(500).json({ success: false, message: "Server error while approving tests." });
    }
};

/**
 * GET /api/coverage/:snapshotId/file-coverage?filePath=...
 */
export const getFileCoverage = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        const filePath = req.query.filePath;
        if (!filePath) return res.status(400).json({ success: false, message: "filePath query parameter is required." });

        const data = await getFileCoverageDetails(snapshotId, filePath, userId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("[getFileCoverage] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to retrieve file coverage." });
    }
};

/**
 * POST /api/coverage/:snapshotId/suggest-testcase
 */
export const suggestUnitTestcase = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        let { projectId, filePath, framework } = req.body || {};

        if (!filePath) return res.status(400).json({ success: false, message: "filePath is required in body." });

        if (!projectId) {
            const snapshot = await prisma.projectSnapshot.findUnique({
                where: { id: snapshotId },
                select: { projectId: true }
            });
            if (snapshot) projectId = snapshot.projectId;
        }

        const result = await suggestUnitTestcases({ projectId, snapshotId, filePath, userId, framework });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("[suggestUnitTestcase] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to suggest unit testcases." });
    }
};
export const getIntegrationHistory = async (req, res) => {
    try {
        const { snapshotId } = req.params;
        const result = await getIntegrationHistoryService(snapshotId);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('[getIntegrationHistory] Error:', error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to fetch history.' });
    }
};


import { 
    updateScenarioService, 
    addScenarioService, 
    deleteScenarioService, 
    toggleScenarioService, 
    regenerateScenarioService 
} from "../services/scenarioManager.service.js";

const verifyAiTestOwnership = async (aiTestId, userId, res, expectedSnapshotId = null) => {
    const aiTest = await prisma.aiTest.findUnique({
        where: { id: aiTestId },
        select: { snapshotId: true, project: { select: { ownerId: true } } }
    });
    if (!aiTest) {
        res.status(404).json({ success: false, message: "AiTest not found." });
        return false;
    }
    if (aiTest.project.ownerId !== userId) {
        res.status(403).json({ success: false, message: "Forbidden." });
        return false;
    }
    if (expectedSnapshotId && aiTest.snapshotId !== expectedSnapshotId) {
        res.status(403).json({ success: false, message: "Snapshot mismatch." });
        return false;
    }
    return true;
};

export const updateScenario = async (req, res) => {
    try {
        const { aiTestId, scenarioId } = req.params;
        const { code } = req.body;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res))) return;

        const updatedTest = await updateScenarioService(aiTestId, decodeURIComponent(scenarioId), code);
        return res.status(200).json({ success: true, data: updatedTest });
    } catch (error) {
        console.error('[updateScenario] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const addScenario = async (req, res) => {
    try {
        const { aiTestId } = req.params;
        const { code, endpoint } = req.body;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res))) return;

        const updatedTest = await addScenarioService(aiTestId, code, endpoint);
        return res.status(200).json({ success: true, data: updatedTest });
    } catch (error) {
        console.error('[addScenario] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteScenario = async (req, res) => {
    try {
        const { aiTestId, scenarioId } = req.params;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res))) return;

        const updatedTest = await deleteScenarioService(aiTestId, decodeURIComponent(scenarioId));
        return res.status(200).json({ success: true, data: updatedTest });
    } catch (error) {
        console.error('[deleteScenario] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleScenario = async (req, res) => {
    try {
        const { aiTestId, scenarioId } = req.params;
        const { enable } = req.body;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res))) return;

        const updatedTest = await toggleScenarioService(aiTestId, decodeURIComponent(scenarioId), enable);
        return res.status(200).json({ success: true, data: updatedTest });
    } catch (error) {
        console.error('[toggleScenario] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};



export const regenerateScenario = async (req, res) => {
    try {
        const { snapshotId, aiTestId, scenarioId } = req.params;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res, snapshotId))) return;
        
        const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: snapshotId } });
        if (!snapshot) throw new Error("Snapshot not found");

        const job = await prisma.job.create({
            data: {
                projectId: snapshot.projectId,
                snapshotId,
                type: 'AI_TESTS',
                status: 'QUEUED',
                payloadJson: JSON.stringify({ mode: 'SUPERTEST_REGENERATE', aiTestId, scenarioId: decodeURIComponent(scenarioId) })
            }
        });
        await jobQueue.add('covai-jobs', { type: 'AI_TESTS', jobId: job.id });

        return res.status(200).json({ success: true, message: "Regeneration job queued", jobId: job.id });
    } catch (error) {
        console.error('[regenerateScenario] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

import { getScenarioService } from "../services/scenarioManager.service.js";
export const getScenario = async (req, res) => {
    try {
        const { aiTestId, scenarioId } = req.params;
        
        if (!(await verifyAiTestOwnership(aiTestId, req.user.id, res))) return;

        const result = await getScenarioService(aiTestId, decodeURIComponent(scenarioId));
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/coverage/:snapshotId/system/scenarios/:scenarioId/evidence
 * Returns screenshot image or DOM snapshot evidence for a scenario.
 */
export const getSystemTestEvidence = async (req, res) => {
    try {
        const snapshot = await findOwnedSnapshot(req.params.snapshotId, req.user?.id);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found" });

        const scenario = await prisma.testScenario.findFirst({
            where: { id: req.params.scenarioId, testRun: { snapshotId: snapshot.id } },
        });
        if (!scenario) {
            return res.status(404).json({ success: false, message: "Scenario not found" });
        }

        const queryType = req.query.type || req.query.format;
        const requestedType = queryType || (req.accepts && req.accepts(["json", "png"]) === "json" ? "dom" : "screenshot");

        // If client specifically requested DOM snapshot
        if (requestedType === "dom" || requestedType === "json" || queryType === "dom" || queryType === "json") {
            if (!scenario.domSnapshot) {
                return res.status(404).json({ success: false, message: "DOM snapshot evidence not found" });
            }
            return res.status(200).json({
                success: true,
                data: {
                    scenarioId: scenario.id,
                    title: scenario.title,
                    failureStep: scenario.failureStep,
                    failureCategory: scenario.failureCategory,
                    domSnapshot: scenario.domSnapshot,
                },
            });
        }

        // Otherwise attempt to serve screenshot image
        if (scenario.screenshotPath && scenario.screenshotPath.startsWith(".covai-system-test/evidence/")) {
            const { containedPath } = await import("../services/fullSystemLifecycle.service.js");
            const file = containedPath(snapshot.rootDir, scenario.screenshotPath);
            if (fs.existsSync(file)) {
                res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
                return res.type("png").sendFile(file, { dotfiles: "allow" });
            }
        }

        // Fallback: If screenshot image is absent on disk but DOM snapshot is available, return DOM snapshot
        if (scenario.domSnapshot) {
            return res.status(200).json({
                success: true,
                message: "Screenshot unavailable; returning DOM snapshot evidence.",
                data: {
                    scenarioId: scenario.id,
                    title: scenario.title,
                    failureStep: scenario.failureStep,
                    failureCategory: scenario.failureCategory,
                    domSnapshot: scenario.domSnapshot,
                },
            });
        }

        return res.status(404).json({ success: false, message: "Evidence not found" });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Unable to load evidence",
        });
    }
};

/**
 * POST /api/coverage/:snapshotId/system/run
 * Triggers system test execution and analysis for Playwright or Cypress.
 * Parameters:
 *   - runner: "playwright" | "cypress" (optional)
 *   - executionMode: "frontend" | "full" (optional, default: "frontend")
 *   - testFile: string (optional)
 */
export const runSystemTestCoverage = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId is required." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot not found." });
        }
        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You do not own this snapshot." });
        }
        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot files are not ready on disk." });
        }

        const rawRunner = req.body?.runner || req.body?.framework;
        let runner = rawRunner ? String(rawRunner).toLowerCase().trim() : null;
        if (runner && !["playwright", "cypress"].includes(runner)) {
            return res.status(400).json({ success: false, message: "runner must be 'playwright' or 'cypress'." });
        }

        if (!runner) {
            try {
                const detected = detectCoverageFrameworks(snapshot.rootDir);
                const systemFws = detected?.supported?.system || [];
                if (systemFws.includes("playwright")) {
                    runner = "playwright";
                } else if (systemFws.includes("cypress")) {
                    runner = "cypress";
                } else {
                    runner = "playwright";
                }
            } catch (_) {
                runner = "playwright";
            }
        }

        const rawMode = req.body?.executionMode || "frontend";
        const executionMode = String(rawMode).toLowerCase().trim();
        if (!["frontend", "full"].includes(executionMode)) {
            return res.status(400).json({ success: false, message: "executionMode must be 'frontend' or 'full'." });
        }

        const testFile = req.body?.testFile ? String(req.body.testFile).trim() : null;

        const job = await createSystemTestAnalysisJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
            runner,
            executionMode,
            testFile,
        });

        await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id, {
            snapshotId,
            userId,
            projectId: snapshot.projectId,
            runner,
            executionMode,
            testFile,
        });

        return res.status(202).json({
            success: true,
            jobId: job.id,
            message: `System test analysis queued (${runner}, mode: ${executionMode}).`,
            data: {
                jobId: job.id,
                runner,
                executionMode,
                testFile,
            },
        });
    } catch (error) {
        console.error("[runSystemTestCoverage] Error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Unable to queue system test execution.",
        });
    }
};

/**
 * GET /api/coverage/:snapshotId/system/summary
 * Returns System (E2E) Test summary with runner, counts, stabilityScorePct, durationMs, and coverage.
 */
export const getSystemTestSummary = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;
        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                projectId: true,
                rootDir: true,
                project: { select: { ownerId: true, name: true } },
            },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot không tồn tại." });
        }

        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập snapshot này." });
        }

        // Query TestRun for E2E types only: PLAYWRIGHT, CYPRESS
        const testRuns = await prisma.testRun.findMany({
            where: {
                snapshotId,
                type: { in: ["PLAYWRIGHT", "CYPRESS"] },
            },
            include: {
                scenarios: true,
                testFiles: true,
            },
            orderBy: { createdAt: "desc" },
        });

        // Query latest AI Test for this snapshot
        const latestAiTestRecord = prisma.aiTest?.findFirst
            ? await prisma.aiTest.findFirst({
                where: {
                    snapshotId,
                    mode: { in: ["PLAYWRIGHT_E2E", "CYPRESS_E2E"] },
                },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    status: true,
                    filePath: true,
                    content: true,
                    metaJson: true,
                    createdAt: true,
                },
            })
            : null;

        let latestAiTest = null;
        if (latestAiTestRecord) {
            let meta = null;
            try {
                meta = typeof latestAiTestRecord.metaJson === "string"
                    ? JSON.parse(latestAiTestRecord.metaJson)
                    : latestAiTestRecord.metaJson;
            } catch (_) {}
            latestAiTest = {
                id: latestAiTestRecord.id,
                status: latestAiTestRecord.status,
                filePath: latestAiTestRecord.filePath,
                content: latestAiTestRecord.content,
                meta,
                createdAt: latestAiTestRecord.createdAt,
            };
        }

        if (!testRuns || testRuns.length === 0) {
            return res.status(200).json({
                success: true,
                data: {
                    hasRun: false,
                    runner: null,
                    status: null,
                    e2eTests: 0,
                    totalTests: 0,
                    passed: 0,
                    passedTests: 0,
                    failed: 0,
                    failedTests: 0,
                    flaky: 0,
                    flakyTests: 0,
                    durationMs: 0,
                    stabilityScorePct: 100,
                    coverageAvailable: false,
                    coverageSummary: { linesPct: 0, branchesPct: 0, statementsPct: 0, functionsPct: 0 },
                    featureCoverage: null,
                    files: [],
                    testFiles: [],
                    testRuns: [],
                    scenarios: [],
                    latestAiTest,
                },
            });
        }

        const latestRun = testRuns[0];
        const totalTests = latestRun.totalTests || 0;
        const passedTests = latestRun.passedTests || 0;
        const failedTests = latestRun.failedTests || 0;
        const flakyTests = latestRun.flakyTests || 0;
        const durationMs = latestRun.durationMs || 0;
        const stabilityScorePct = totalTests > 0 ? Number(((passedTests / totalTests) * 100).toFixed(2)) : 0;
        const coverageAvailable = Boolean(latestRun.coverageLinesPct !== null && latestRun.coverageLinesPct !== undefined);
        const coverageSummary = {
            linesPct: latestRun.coverageLinesPct ?? 0,
            branchesPct: latestRun.coverageBranchesPct ?? 0,
            statementsPct: latestRun.coverageStatementsPct ?? 0,
            functionsPct: latestRun.coverageFunctionsPct ?? 0,
        };

        const systemTestFiles = latestRun.testFiles || [];

        // Parse scenarios: use DB records if available, otherwise check report files on disk
        let scenarios = [];
        if (latestRun.scenarios && latestRun.scenarios.length > 0) {
            scenarios = latestRun.scenarios.map((s) => ({
                id: s.id,
                title: s.title,
                file: s.testFile || "",
                durationMs: s.durationMs || 0,
                status: s.status,
                failureMessages: s.failureMessages || [],
                hasEvidence: Boolean(s.screenshotPath),
                failureStep: s.failureStep || null,
                failureCategory: s.failureCategory || null,
                failureCodeSnippet: s.failureCodeSnippet || null,
                domSnapshot: s.domSnapshot || null,
                coverageContributions: {
                    linesPct: s.coverageLinesPct ?? null,
                    branchesPct: s.coverageBranchesPct ?? null,
                },
            }));
        } else if (snapshot.rootDir && fs.existsSync(snapshot.rootDir)) {
            const reportCandidates = [
                path.join(snapshot.rootDir, ".covai-system-test", `${latestRun.type.toLowerCase()}-results.json`),
            ];

            for (const reportPath of reportCandidates) {
                if (fs.existsSync(reportPath)) {
                    try {
                        const modifiedAt = fs.statSync(reportPath).mtimeMs;
                        if (!latestRun.startedAt || !latestRun.finishedAt ||
                            modifiedAt < new Date(latestRun.startedAt).getTime() ||
                            modifiedAt > new Date(latestRun.finishedAt).getTime()) continue;
                        const content = fs.readFileSync(reportPath, "utf8");
                        const reportData = JSON.parse(content);
                        if (reportData.suites) {
                            const collectPlaywrightSpecs = (suite, parentFile = "") => {
                                const currentFile = suite.file || parentFile;
                                for (const spec of (suite.specs || [])) {
                                    const testObj = (spec.tests || [])[0];
                                    const result = (testObj?.results || [])[0];
                                    let status = result?.status || (spec.ok ? "passed" : "failed");
                                    if (testObj?.status === "flaky" || (testObj?.results?.length > 1 && testObj.results.some(r => r.status === "passed"))) {
                                        status = "flaky";
                                    }
                                    const failureMessages = [];
                                    if (result?.error?.message) failureMessages.push(result.error.message);
                                    if (Array.isArray(result?.errors)) {
                                        for (const err of result.errors) {
                                            if (err?.message && !failureMessages.includes(err.message)) failureMessages.push(err.message);
                                        }
                                    }
                                    scenarios.push({
                                        id: spec.id || `${currentFile}-${spec.title}`,
                                        title: spec.title,
                                        file: currentFile ? path.relative(snapshot.rootDir, currentFile).replace(/\\/g, "/") : "",
                                        durationMs: result?.duration || 0,
                                        status,
                                        failureMessages,
                                    });
                                }
                                for (const child of (suite.suites || [])) {
                                    collectPlaywrightSpecs(child, currentFile);
                                }
                            };
                            for (const s of (reportData.suites || [])) {
                                collectPlaywrightSpecs(s);
                            }
                        }
                        if (scenarios.length > 0) break;
                    } catch (_) { }
                }
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                hasRun: true,
                runner: latestRun.type.toLowerCase(),
                status: latestRun.status,
                e2eTests: totalTests,
                totalTests,
                passed: passedTests,
                passedTests,
                failed: failedTests,
                failedTests,
                flaky: flakyTests,
                flakyTests,
                durationMs,
                stabilityScorePct,
                coverageAvailable,
                coverageSummary,
                featureCoverage: null,
                files: systemTestFiles,
                testFiles: systemTestFiles,
                testRuns: testRuns.map(run => ({
                    ...run,
                    coverageSummary: {
                        linesPct: run.coverageLinesPct ?? 0,
                        branchesPct: run.coverageBranchesPct ?? 0,
                        statementsPct: run.coverageStatementsPct ?? 0,
                        functionsPct: run.coverageFunctionsPct ?? 0,
                    },
                    scenarios: run.scenarios?.map(({screenshotPath, ...scenario}) => ({
                        ...scenario,
                        hasEvidence: Boolean(screenshotPath),
                    })),
                })),
                scenarios,
                latestRun: {
                    ...latestRun,
                    coverageSummary,
                    scenarios: undefined,
                },
                executionMode: latestRun.executionMode || "frontend",
                latestAiTest,
            },
        });
    } catch (error) {
        console.error("[getSystemTestSummary] Error:", error);
        return res.status(500).json({ success: false, message: "Server error." });
    }
};

/**
 * GET /api/coverage/:snapshotId/system/scenarios
 * Returns scenarios grouped hierarchically by test file with failure breakpoints,
 * error messages, evidence links, duration, and coverage contributions.
 */
export const getSystemTestScenarios = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;
        if (!snapshotId) {
            return res.status(400).json({ success: false, message: "snapshotId is required." });
        }

        const snapshot = await findOwnedSnapshot(snapshotId, userId);
        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        }

        const testRunId = req.query.testRunId;
        let targetRun = null;
        if (testRunId) {
            targetRun = await prisma.testRun.findFirst({
                where: { id: testRunId, snapshotId },
                include: { scenarios: true, testFiles: true },
            });
        } else {
            targetRun = await prisma.testRun.findFirst({
                where: {
                    snapshotId,
                    type: { in: ["PLAYWRIGHT", "CYPRESS"] },
                },
                orderBy: { createdAt: "desc" },
                include: { scenarios: true, testFiles: true },
            });
        }

        if (!targetRun) {
            return res.status(200).json({
                success: true,
                data: {
                    hasRun: false,
                    testRunId: null,
                    runner: null,
                    executionMode: null,
                    totalScenarios: 0,
                    testFiles: [],
                    scenarios: [],
                },
            });
        }

        let rawScenarios = targetRun.scenarios || [];
        const statusFilter = req.query.status ? String(req.query.status).toLowerCase().trim() : null;
        if (statusFilter && statusFilter !== "all") {
            rawScenarios = rawScenarios.filter((s) => (s.status || "").toLowerCase() === statusFilter);
        }
        const fileFilter = req.query.testFile ? String(req.query.testFile).trim() : null;
        if (fileFilter) {
            rawScenarios = rawScenarios.filter((s) => s.testFile && s.testFile.includes(fileFilter));
        }

        const enrichedScenarios = rawScenarios.map((s) => ({
            id: s.id,
            title: s.title,
            suiteName: s.suiteName,
            status: s.status,
            durationMs: s.durationMs || 0,
            failureMessages: s.failureMessages || [],
            testFile: s.testFile || "unknown",
            failureBreakpoint: {
                failureStep: s.failureStep || null,
                failureCategory: s.failureCategory || null,
                failureCodeSnippet: s.failureCodeSnippet || null,
                hasDomSnapshot: Boolean(s.domSnapshot),
            },
            coverageContributions: {
                linesPct: s.coverageLinesPct ?? null,
                branchesPct: s.coverageBranchesPct ?? null,
            },
            evidence: {
                hasScreenshot: Boolean(s.screenshotPath),
                screenshotUrl: s.screenshotPath
                    ? `/api/coverage/${snapshotId}/system/scenarios/${s.id}/evidence`
                    : null,
                hasDomSnapshot: Boolean(s.domSnapshot),
                domSnapshotUrl: s.domSnapshot
                    ? `/api/coverage/${snapshotId}/system/scenarios/${s.id}/evidence?type=dom`
                    : null,
            },
        }));

        const fileGroupsMap = new Map();
        for (const scenario of enrichedScenarios) {
            const fileKey = scenario.testFile || "unspecified";
            if (!fileGroupsMap.has(fileKey)) {
                fileGroupsMap.set(fileKey, {
                    filePath: fileKey,
                    status: "PASSED",
                    durationMs: 0,
                    totalScenarios: 0,
                    passedScenarios: 0,
                    failedScenarios: 0,
                    flakyScenarios: 0,
                    coverageLinesPct: null,
                    scenarios: [],
                });
            }
            const group = fileGroupsMap.get(fileKey);
            group.scenarios.push(scenario);
            group.totalScenarios += 1;
            group.durationMs += (scenario.durationMs || 0);
            if (scenario.status === "PASSED" || scenario.status === "passed") {
                group.passedScenarios += 1;
            } else if (scenario.status === "FAILED" || scenario.status === "failed") {
                group.failedScenarios += 1;
                group.status = "FAILED";
            } else if (scenario.status === "FLAKY" || scenario.status === "flaky") {
                group.flakyScenarios += 1;
                if (group.status !== "FAILED") group.status = "FLAKY";
            }
        }

        const dbFiles = targetRun.testFiles || [];
        for (const dbFile of dbFiles) {
            if (fileGroupsMap.has(dbFile.filePath)) {
                const grp = fileGroupsMap.get(dbFile.filePath);
                grp.coverageLinesPct = dbFile.coverageLinesPct;
                if (dbFile.durationMs) grp.durationMs = dbFile.durationMs;
            } else {
                fileGroupsMap.set(dbFile.filePath, {
                    filePath: dbFile.filePath,
                    status: dbFile.status,
                    durationMs: dbFile.durationMs || 0,
                    totalScenarios: dbFile.scenarioCount || 0,
                    passedScenarios: 0,
                    failedScenarios: 0,
                    flakyScenarios: 0,
                    coverageLinesPct: dbFile.coverageLinesPct,
                    scenarios: [],
                });
            }
        }

        const groupedFiles = Array.from(fileGroupsMap.values());

        return res.status(200).json({
            success: true,
            data: {
                hasRun: true,
                testRunId: targetRun.id,
                runner: targetRun.type.toLowerCase(),
                executionMode: targetRun.executionMode,
                totalScenarios: enrichedScenarios.length,
                testFiles: groupedFiles,
                scenarios: enrichedScenarios,
            },
        });
    } catch (error) {
        console.error("[getSystemTestScenarios] Error:", error);
        return res.status(500).json({ success: false, message: error.message || "Server error." });
    }
};

/**
 * POST /api/coverage/:snapshotId/system/save-ai-test
 * Manually saves an AI-generated Playwright test to the codebase even if dry-run timed out.
 */
export const saveAiSystemTest = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required." });

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true },
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        const aiTest = await prisma.aiTest.findFirst({
            where: {
                snapshotId,
                mode: "PLAYWRIGHT_E2E",
            },
            orderBy: { createdAt: "desc" },
        });

        if (!aiTest) {
            return res.status(404).json({ success: false, message: "No AI test found for this snapshot." });
        }
        if (aiTest.status !== 'VERIFIED') return res.status(409).json({success:false,message:'Only tests that pass full-system verification can be saved. Regenerate to repair this candidate.'});

        const rootDir = snapshot.rootDir;
        const targetFilePath = aiTest.filePath;
        const fullTargetPath = path.join(rootDir, targetFilePath);

        fs.mkdirSync(path.dirname(fullTargetPath), { recursive: true });
        fs.writeFileSync(fullTargetPath, aiTest.content, "utf8");

        let meta = {};
        try {
            meta = typeof aiTest.metaJson === "string" ? JSON.parse(aiTest.metaJson) : (aiTest.metaJson || {});
        } catch (_) {}

        meta.dryRun = "MANUALLY_SAVED";
        meta.savedAt = new Date().toISOString();

        const updatedAiTest = await prisma.aiTest.update({
            where: { id: aiTest.id },
            data: {
                status: "VERIFIED",
                metaJson: JSON.stringify(meta),
            },
        });

        return res.status(200).json({
            success: true,
            message: `Successfully saved test to ${targetFilePath}`,
            data: {
                id: updatedAiTest.id,
                status: updatedAiTest.status,
                filePath: updatedAiTest.filePath,
                content: updatedAiTest.content,
                meta,
                createdAt: updatedAiTest.createdAt,
            },
        });
    } catch (error) {
        console.error("[saveAiSystemTest] Error:", error);
        return res.status(500).json({ success: false, message: error.message || "Server error while saving AI test." });
    }
};

/**
 * POST /api/coverage/:snapshotId/system/generate-tests
 * Cold-Start E2E system test generation for Playwright and Cypress.
 * Generates configuration if missing, harvests app context, prompts AI, validates AST,
 * and writes runnable test files to disk and DB.
 */
export const generateColdStartSystemTestsController = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;
        if (!snapshotId) {
            return res.status(400).json({ success: false, message: "snapshotId is required." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true },
        });

        if (!snapshot) {
            return res.status(404).json({ success: false, message: "Snapshot not found." });
        }
        if (snapshot.project?.ownerId && snapshot.project.ownerId !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You do not own this snapshot." });
        }

        const rootDir = snapshot.rootDir;
        if (!rootDir || !fs.existsSync(rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot repository is not available on disk." });
        }

        const rawFramework = req.body?.framework || req.body?.runner || "playwright";
        const framework = String(rawFramework).toLowerCase() === "cypress" ? "cypress" : "playwright";
        const targetRoutes = Array.isArray(req.body?.targetRoutes)
            ? req.body.targetRoutes
            : Array.isArray(req.body?.routes)
            ? req.body.routes
            : [];

        // Generate cold-start system tests
        const generationResult = await generateColdStartSystemTests({
            rootDir,
            framework,
            targetRoutes,
        });

        // Upsert AI test in database
        const aiMode = framework === "cypress" ? "CYPRESS_E2E" : "PLAYWRIGHT_E2E";
        const aiTest = await prisma.aiTest.create({
            data: {
                snapshotId,
                filePath: generationResult.filePath,
                content: generationResult.code,
                status: "VERIFIED",
                mode: aiMode,
                metaJson: JSON.stringify({
                    coldStart: true,
                    suiteCount: generationResult.suiteCount,
                    scenarioCount: generationResult.scenarioCount,
                    suites: generationResult.suites,
                    scenarios: generationResult.scenarios,
                    configCreated: generationResult.configCreated,
                    configPath: generationResult.configPath,
                }),
            },
        });

        // Upsert SystemTestFile in DB if model exists
        if (prisma.systemTestFile) {
            try {
                await prisma.systemTestFile.upsert({
                    where: {
                        snapshotId_filePath: {
                            snapshotId,
                            filePath: generationResult.filePath,
                        },
                    },
                    create: {
                        snapshotId,
                        filePath: generationResult.filePath,
                        framework: generationResult.framework,
                        suiteCount: generationResult.suiteCount,
                        scenarioCount: generationResult.scenarioCount,
                    },
                    update: {
                        framework: generationResult.framework,
                        suiteCount: generationResult.suiteCount,
                        scenarioCount: generationResult.scenarioCount,
                    },
                });
            } catch (dbErr) {
                console.warn("[generateColdStartSystemTestsController] systemTestFile upsert warning:", dbErr.message);
            }
        }

        // Refresh framework detection for snapshot to update hasTestFiles and isZeroTestProject
        let frameworks = null;
        try {
            frameworks = await detectSystemTestFrameworksForSnapshot(snapshotId);
        } catch (_) {}

        return res.status(200).json({
            success: true,
            message: `Successfully generated ${generationResult.framework} system tests with ${generationResult.scenarioCount} scenarios.`,
            data: {
                aiTestId: aiTest.id,
                framework: generationResult.framework,
                filePath: generationResult.filePath,
                configCreated: generationResult.configCreated,
                configPath: generationResult.configPath,
                suiteCount: generationResult.suiteCount,
                scenarioCount: generationResult.scenarioCount,
                suites: generationResult.suites,
                scenarios: generationResult.scenarios,
                frameworks,
            },
        });
    } catch (error) {
        console.error("[generateColdStartSystemTestsController] Error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to generate system tests.",
        });
    }
};

/**
 * GET /api/coverage/:snapshotId/system/tests/content?filePath=...
 * Reads and returns content and parsed metadata of a specific system test file.
 */
export const getSystemTestFileContent = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        const filePath = req.query.filePath;
        if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
            return res.status(400).json({ success: false, message: "filePath query parameter is required." });
        }

        const snapshot = await findOwnedSnapshot(snapshotId, userId);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot directory not found." });
        }

        const fullPath = containedPath(snapshot.rootDir, filePath.trim());
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
            return res.status(404).json({ success: false, message: `Test file not found: ${filePath}` });
        }

        const content = fs.readFileSync(fullPath, "utf8");
        const stat = fs.statSync(fullPath);
        const isCypress = filePath.toLowerCase().includes("cypress") || /\bcy\./.test(content);
        const framework = isCypress ? "cypress" : "playwright";
        const { suites, scenarios } = extractSuitesAndScenarios(content, framework.toUpperCase());

        return res.status(200).json({
            success: true,
            data: {
                filePath: filePath.trim(),
                content,
                framework,
                size: stat.size,
                lineCount: content.split("\n").length,
                suites,
                scenarios,
                suiteCount: suites.length,
                scenarioCount: scenarios.length,
            },
        });
    } catch (error) {
        console.error("[getSystemTestFileContent] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to read test file." });
    }
};

/**
 * PUT /api/coverage/:snapshotId/system/tests/content
 * Updates and saves modified test file content to disk and synchronizes DB records.
 */
export const updateSystemTestFileContent = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        const { filePath, content } = req.body || {};
        if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
            return res.status(400).json({ success: false, message: "filePath is required." });
        }
        if (typeof content !== "string") {
            return res.status(400).json({ success: false, message: "content string is required." });
        }

        const snapshot = await findOwnedSnapshot(snapshotId, userId);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot directory not found." });
        }

        // Validate syntax and dangerous imports using AST validator
        validateGeneratedTestCode(content);

        const fullPath = containedPath(snapshot.rootDir, filePath.trim());
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, "utf8");

        const isCypress = filePath.toLowerCase().includes("cypress") || /\bcy\./.test(content);
        const framework = isCypress ? "cypress" : "playwright";
        const { suites, scenarios } = extractSuitesAndScenarios(content, framework.toUpperCase());

        // Update any associated AiTest record
        try {
            await prisma.aiTest.updateMany({
                where: { snapshotId, filePath: filePath.trim() },
                data: { content },
            });
        } catch (_) {}

        return res.status(200).json({
            success: true,
            message: "Test file saved successfully.",
            data: {
                filePath: filePath.trim(),
                framework,
                suiteCount: suites.length,
                scenarioCount: scenarios.length,
                suites,
                scenarios,
            },
        });
    } catch (error) {
        console.error("[updateSystemTestFileContent] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to update test file." });
    }
};

/**
 * POST /api/coverage/:snapshotId/system/tests/run-single
 * Executes a single test file quickly for immediate verification without rerunning the entire suite.
 */
export const runSingleSystemTest = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        const { filePath, runner: rawRunner, framework: rawFramework, executionMode: explicitMode } = req.body || {};
        const explicitRunner = rawRunner || rawFramework;
        if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
            return res.status(400).json({ success: false, message: "filePath is required." });
        }

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true },
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });
        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot repository not ready on disk." });
        }

        const fullPath = containedPath(snapshot.rootDir, filePath.trim());
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, message: `Test file not found: ${filePath}` });
        }

        // Detect runner if not explicitly provided
        let runner = explicitRunner ? String(explicitRunner).toLowerCase().trim() : null;
        if (!runner) {
            const isCypress = filePath.toLowerCase().includes("cypress") || filePath.includes(".cy.");
            runner = isCypress ? "cypress" : "playwright";
        }
        if (!["playwright", "cypress"].includes(runner)) {
            return res.status(400).json({ success: false, message: "runner must be 'playwright' or 'cypress'." });
        }

        const executionMode = explicitMode && ["full", "frontend"].includes(String(explicitMode).toLowerCase())
            ? String(explicitMode).toLowerCase()
            : "frontend";

        const job = await createSystemTestAnalysisJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
            runner,
            executionMode,
            testFile: filePath.trim(),
        });

        await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id, {
            snapshotId,
            userId,
            projectId: snapshot.projectId,
            runner,
            executionMode,
            testFile: filePath.trim(),
        });

        return res.status(202).json({
            success: true,
            jobId: job.id,
            message: `Single test file execution queued for ${filePath.trim()}`,
            data: {
                jobId: job.id,
                filePath: filePath.trim(),
                runner,
                executionMode,
            },
        });
    } catch (error) {
        console.error("[runSingleSystemTest] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to run single test." });
    }
};

/**
 * POST /api/coverage/:snapshotId/system/optimize-test
 * Invokes AI Booster to optimize coverage or repair failure breakpoint in a test file.
 */
export const optimizeSystemTestController = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

        const { snapshotId } = req.params;
        const { filePath, scenarioId, mode = "BOOST_COVERAGE", instruction } = req.body || {};

        if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
            return res.status(400).json({ success: false, message: "filePath is required." });
        }

        const snapshot = await findOwnedSnapshot(snapshotId, userId);
        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found or unauthorized." });
        if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
            return res.status(409).json({ success: false, message: "Snapshot repository not ready on disk." });
        }

        const optimizationResult = await optimizeSystemTest({
            rootDir: snapshot.rootDir,
            filePath: filePath.trim(),
            scenarioId: scenarioId || null,
            mode,
            instruction: instruction || null,
        });

        return res.status(200).json({
            success: true,
            message: `Successfully optimized test (${optimizationResult.mode}).`,
            data: optimizationResult,
        });
    } catch (error) {
        console.error("[optimizeSystemTestController] Error:", error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to optimize test file." });
    }
};



