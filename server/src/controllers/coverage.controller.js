import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { createInstallDepsJob, createRunTestsJob, createSupertestCoverageJob, createVitestCoverageJob, createCypressSystemCoverageJob, createPlaywrightSystemCoverageJob } from "../services/job.service.js";
import { jobQueue, addSupertestCoveragePipeline, addJobToQueue } from "../services/queue.service.js";
import { processCoverageJob } from "../services/coverageRunner.service.js";
import { detectSupertest } from "../services/supertestDetection.service.js";
import { detectCoverageFrameworks, selectCoverageFramework } from "../services/coverageFramework.service.js";
import { buildIntegrationWorkspace } from "../services/integrationWorkspace.service.js";

import { getFileCoverageDetails } from "../services/fileCoverage.service.js";
import { suggestUnitTestcases } from "../services/unitTestSuggestion.service.js";

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
            } else if (framework === "playwright") {
                job = await createPlaywrightSystemCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });
                await addJobToQueue("PLAYWRIGHT_SYSTEM_COVERAGE", job.id);
                jobs = [job];
            } else {
                job = await createCypressSystemCoverageJob({ projectId: snapshot.projectId, snapshotId, userId });
                await addJobToQueue("CYPRESS_SYSTEM_COVERAGE", job.id);
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
        const packageJsonPath = `${snapshot.rootDir}/package.json`;
        if (!fs.existsSync(packageJsonPath)) {
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

        const packageJsonPath = `${snapshot.rootDir}/package.json`;
        const fs = await import("fs");
        if (!fs.existsSync(packageJsonPath)) {
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