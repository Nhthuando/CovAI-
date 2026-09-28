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
import { classifyTestFile } from "../utils/testingFrameworkDetector.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SORT_FIELDS = ["filePath", "linesPct", "branchesPct", "funcsPct", "stmtsPct"];
const ALLOWED_SORT_ORDERS = ["asc", "desc"];
const ALLOWED_FUNC_SORT_FIELDS = ["functionName", "filePath", "hit", "startLine"];

import { isApiFilePath } from "../utils/apiFileDetector.js";
export { isApiFilePath };

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
            const hasJest = unitFws.includes("jest");
            const hasVitest = unitFws.includes("vitest");
            framework = (hasJest && hasVitest) ? "jest & vitest" : (hasVitest ? "vitest" : "jest");

            // Unified Unit Test Job: Jest & Vitest are run together in 1 single pipeline
            job = await createRunTestsJob({
                projectId: snapshot.projectId,
                snapshotId,
                userId,
                mode: "FULL"
            });
            await addJobToQueue("RUN_TESTS", job.id);
            jobs = [job];
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

        const typeFilter = req.query?.type || req.query?.coverageType || null;

        let coverage = summary
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
                    if (raw) {
                        if (typeFilter === "unit") {
                            // SCRUM-Unit: Filter out API files (routes, controllers, endpoints, app, server), frontend, and test files
                            const unitFileEntries = Object.entries(raw).filter(([filePath]) => {
                                if (filePath === "total") return false;
                                const norm = filePath.replace(/\\/g, "/").toLowerCase();
                                const isFrontend = /(^|\/)(client|frontend|pages|components|ui|web)\//i.test(norm) || /\.[jt]sx$/i.test(norm);
                                const isTest = /(^|\/)(tests?|__tests__|specs?|e2e|cypress|step-definitions?)\//i.test(norm) || /\.(test|spec|testcase|steps?)\./i.test(norm);
                                return !isFrontend && !isTest && !isApiFilePath(filePath);
                            });

                            if (unitFileEntries.length > 0) {
                                let stmtsCovered = 0, stmtsTotal = 0;
                                let branchesCovered = 0, branchesTotal = 0;
                                let funcsCovered = 0, funcsTotal = 0;
                                let linesCovered = 0, linesTotal = 0;

                                for (const [, data] of unitFileEntries) {
                                    stmtsCovered += data.statements?.covered || 0;
                                    stmtsTotal += data.statements?.total || 0;
                                    branchesCovered += data.branches?.covered || 0;
                                    branchesTotal += data.branches?.total || 0;
                                    funcsCovered += data.functions?.covered || 0;
                                    funcsTotal += data.functions?.total || 0;
                                    linesCovered += data.lines?.covered || 0;
                                    linesTotal += data.lines?.total || 0;
                                }

                                const stmtsPct = stmtsTotal > 0 ? Number(((stmtsCovered / stmtsTotal) * 100).toFixed(1)) : 100;
                                const branchesPct = branchesTotal > 0 ? Number(((branchesCovered / branchesTotal) * 100).toFixed(1)) : 100;
                                const funcsPct = funcsTotal > 0 ? Number(((funcsCovered / funcsTotal) * 100).toFixed(1)) : 100;
                                const linesPct = linesTotal > 0 ? Number(((linesCovered / linesTotal) * 100).toFixed(1)) : 100;

                                rawTotals = {
                                    statements: { total: stmtsTotal, covered: stmtsCovered, pct: stmtsPct },
                                    branches: { total: branchesTotal, covered: branchesCovered, pct: branchesPct },
                                    functions: { total: funcsTotal, covered: funcsCovered, pct: funcsPct },
                                    lines: { total: linesTotal, covered: linesCovered, pct: linesPct },
                                };

                                coverage = {
                                    statements: stmtsPct,
                                    branches: branchesPct,
                                    functions: funcsPct,
                                    lines: linesPct,
                                };
                            } else if (raw.total) {
                                rawTotals = {
                                    statements: raw.total.statements || null,
                                    branches: raw.total.branches || null,
                                    functions: raw.total.functions || null,
                                    lines: raw.total.lines || null,
                                };
                            }
                        } else if (typeFilter === "integration") {
                            const apiFileEntries = Object.entries(raw).filter(([filePath]) => {
                                if (filePath === "total") return false;
                                return isApiFilePath(filePath);
                            });

                            if (apiFileEntries.length > 0) {
                                let stmtsCovered = 0, stmtsTotal = 0;
                                let branchesCovered = 0, branchesTotal = 0;
                                let funcsCovered = 0, funcsTotal = 0;
                                let linesCovered = 0, linesTotal = 0;

                                for (const [, data] of apiFileEntries) {
                                    stmtsCovered += data.statements?.covered || 0;
                                    stmtsTotal += data.statements?.total || 0;
                                    branchesCovered += data.branches?.covered || 0;
                                    branchesTotal += data.branches?.total || 0;
                                    funcsCovered += data.functions?.covered || 0;
                                    funcsTotal += data.functions?.total || 0;
                                    linesCovered += data.lines?.covered || 0;
                                    linesTotal += data.lines?.total || 0;
                                }

                                const stmtsPct = stmtsTotal > 0 ? Number(((stmtsCovered / stmtsTotal) * 100).toFixed(1)) : 100;
                                const branchesPct = branchesTotal > 0 ? Number(((branchesCovered / branchesTotal) * 100).toFixed(1)) : 100;
                                const funcsPct = funcsTotal > 0 ? Number(((funcsCovered / funcsTotal) * 100).toFixed(1)) : 100;
                                const linesPct = linesTotal > 0 ? Number(((linesCovered / linesTotal) * 100).toFixed(1)) : 100;

                                rawTotals = {
                                    statements: { total: stmtsTotal, covered: stmtsCovered, pct: stmtsPct },
                                    branches: { total: branchesTotal, covered: branchesCovered, pct: branchesPct },
                                    functions: { total: funcsTotal, covered: funcsCovered, pct: funcsPct },
                                    lines: { total: linesTotal, covered: linesCovered, pct: linesPct },
                                };

                                coverage = {
                                    statements: stmtsPct,
                                    branches: branchesPct,
                                    functions: funcsPct,
                                    lines: linesPct,
                                };
                            } else if (raw.total) {
                                rawTotals = {
                                    statements: raw.total.statements || null,
                                    branches: raw.total.branches || null,
                                    functions: raw.total.functions || null,
                                    lines: raw.total.lines || null,
                                };
                            }
                        } else if (raw.total) {
                            rawTotals = {
                                statements: raw.total.statements || null,
                                branches: raw.total.branches || null,
                                functions: raw.total.functions || null,
                                lines: raw.total.lines || null,
                            };
                        }
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
        const typeFilter = req.query?.type || req.query?.coverageType || null;
        const where = {
            snapshotId,
            ...(typeFilter === "unit" && {
                AND: [
                    { NOT: { filePath: { contains: "client/" } } },
                    { NOT: { filePath: { contains: "frontend/" } } },
                    { NOT: { filePath: { endsWith: ".jsx" } } },
                    { NOT: { filePath: { endsWith: ".tsx" } } },
                    { NOT: { filePath: { contains: "routes/" } } },
                    { NOT: { filePath: { contains: "controllers/" } } },
                    { NOT: { filePath: { contains: "endpoints/" } } },
                    { NOT: { filePath: { endsWith: "app.js" } } },
                    { NOT: { filePath: { endsWith: "app.ts" } } },
                    { NOT: { filePath: { endsWith: "server.js" } } },
                    { NOT: { filePath: { endsWith: "server.ts" } } },
                ]
            }),
        };

        let [files, total] = await Promise.all([
            prisma.coverageFile.findMany({
                where,
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
            prisma.coverageFile.count({ where }),
        ]);

        if (typeFilter === "unit") {
            const beforeCount = files.length;
            files = files.filter(f => !isApiFilePath(f.filePath));
            if (files.length !== beforeCount) {
                total = Math.max(files.length, total - (beforeCount - files.length));
            }
        }

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

const isGenericTitle = (raw, cleanFileName) => {
    if (!raw) return true;
    const lower = raw.toLowerCase().trim();
    if (
        lower === cleanFileName ||
        lower === `${cleanFileName}.js` ||
        lower === `${cleanFileName}.ts` ||
        lower.endsWith(".service") ||
        lower.endsWith(".controller") ||
        lower.endsWith(".middleware") ||
        lower.endsWith(".validation") ||
        lower.endsWith(".util") ||
        lower.endsWith(".helper") ||
        lower.includes("unit test") ||
        lower.includes("test suite") ||
        lower.includes("tests for") ||
        lower.includes("test case") ||
        lower.startsWith("describe ")
    ) {
        return true;
    }
    return false;
};

export const extractTargetFunction = (a, fileName, knownFunctions = []) => {
    const ancestors = Array.isArray(a.ancestorTitles) ? a.ancestorTitles : [];
    const cleanFileName = (fileName || "")
        .replace(/\\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i, "")
        .replace(/^[._]/, "")
        .toLowerCase();

    // 1. Check ancestors backwards (from deepest describe block upwards)
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const raw = ancestors[i]?.trim();
        if (!raw || isGenericTitle(raw, cleanFileName)) continue;

        const cleaned = raw
            .replace(/^(function|method|fn)\s+/i, "")
            .replace(/\(\)$/, "")
            .replace(/^#/, "")
            .trim();

        if (cleaned && !isGenericTitle(cleaned, cleanFileName)) {
            return cleaned;
        }
    }

    // 2. Cross-reference against knownFunctions of the file
    const fullText = `${a.fullName || ""} ${a.title || ""}`;
    const fullTextCompressed = fullText.replace(/[^a-z0-9]/gi, "").toLowerCase();

    if (Array.isArray(knownFunctions) && knownFunctions.length > 0) {
        // 2a. Direct word boundary match
        for (const fn of knownFunctions) {
            if (fn && typeof fn === "string" && fn.length > 1) {
                const regex = new RegExp(`\\b${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
                if (regex.test(fullText)) {
                    return fn;
                }
            }
        }

        // 2b. Check compressed string match (e.g. "run cache benchmark" matches "runcachebenchmark")
        for (const fn of knownFunctions) {
            if (fn && typeof fn === "string" && fn.length > 2) {
                const fnCompressed = fn.replace(/[^a-z0-9]/gi, "").toLowerCase();
                if (fullTextCompressed.includes(fnCompressed)) {
                    return fn;
                }
            }
        }

        // 2c. If the file only has 1 known function, all its tests target that function
        if (knownFunctions.length === 1 && knownFunctions[0]) {
            return knownFunctions[0];
        }
    }

    // 3. Try to extract from title: e.g. "register: should hash...", "login - should fail", "getUser() returns user"
    const titleMatch = (a.title || "").match(/^([a-zA-Z0-9_$]+)(?:\(\))?\s*[:\-–—\s]/);
    if (titleMatch && titleMatch[1]) {
        const cand = titleMatch[1];
        const lowerCand = cand.toLowerCase();
        if (!["should", "it", "test", "when", "given", "returns", "verify", "can", "must", "expect", "throws"].includes(lowerCand)) {
            return cand;
        }
    }

    return null;
};

/**
 * Extract a repo-relative path from a test suite name.
 * Handles both Docker paths (/app/storage/.../repo/foo.test.js)
 * and Windows paths (D:\...\storage\...\repo\foo.test.js).
 * Returns the part after the last occurrence of /repo/ (or \repo\).
 */
const extractRepoRelativePath = (suiteName) => {
    if (!suiteName) return "";
    const normalized = suiteName.replace(/\\/g, "/");
    // Match everything after the last /repo/
    const repoMatch = normalized.match(/(?:\/|^)repo\/(.+)$/i);
    if (repoMatch) return repoMatch[1];
    // Fallback: match storage/projects/<id>/.../<ts>/repo/ pattern
    const storageMatch = normalized.match(/storage\/projects\/[^/]+(?:\/[^/]+)*?\/repo\/(.+)$/i);
    if (storageMatch) return storageMatch[1];
    return normalized;
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

        // Retrieve known functions for snapshot to cross-reference
        const coverageFunctions = await prisma.coverageFunction.findMany({
            where: { snapshotId },
            select: { filePath: true, functionName: true }
        }).catch(() => []);

        const functionsByBaseName = new Map();
        for (const cf of coverageFunctions) {
            const base = path.basename(cf.filePath || "").replace(/\.[^.]+$/, "").toLowerCase();
            if (!functionsByBaseName.has(base)) functionsByBaseName.set(base, []);
            if (cf.functionName && !cf.functionName.startsWith("(") && !cf.functionName.startsWith("anonymous")) {
                functionsByBaseName.get(base).push(cf.functionName);
            }
        }

        const norm = (p) => (p || "").replace(/\\/g, "/").replace(/^\.?\//, "").trim();

        // 1. Locate test-results.json and separate Jest vs Vitest results
        const loadTestResultsFromPaths = (paths) => {
            const list = [];
            const seen = new Set();
            for (const p of paths) {
                if (fs.existsSync(p) && !seen.has(p)) {
                    seen.add(p);
                    try {
                        const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
                        if (Array.isArray(parsed?.testResults)) {
                            list.push(...parsed.testResults);
                        }
                    } catch (_) { }
                }
            }
            const map = new Map();
            for (const suite of list) {
                // extractRepoRelativePath handles Docker paths like /app/storage/.../repo/foo.test.js
                // path.relative() fails when mixing Docker linux paths with Windows host paths
                const repoRelative = suite.name ? norm(extractRepoRelativePath(suite.name)) : "";
                if (!repoRelative) continue;
                map.set(repoRelative, suite);
                // Also index by shorter relative path (strip first directory segment)
                map.set(repoRelative.replace(/^[^/]+\//, ""), suite);
                // Also index by basename for fallback matching
                map.set(path.basename(repoRelative), suite);
            }
            return map;
        };

        const jestResultsByPath = loadTestResultsFromPaths([
            path.join(snapshot.rootDir, "coverage", "jest-results.json"),
            path.join(snapshot.rootDir, "jest-results.json"),
        ]);

        const vitestResultsByPath = loadTestResultsFromPaths([
            path.join(snapshot.rootDir, "coverage", "vitest-results.json"),
            path.join(snapshot.rootDir, "vitest-results.json"),
        ]);

        const generalResultsByPath = loadTestResultsFromPaths([
            path.join(snapshot.rootDir, "coverage", "test-results.json"),
            path.join(snapshot.rootDir, "test-results.json"),
        ]);

        // 2. Discover test files in snapshot rootDir
        const testFiles = [];
        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (requestedType === "unit" && (entry.name === "client" || entry.name === "frontend")) {
                        continue;
                    }
                    if (!["node_modules", ".git", "coverage", "dist", "build", ".next", ".vite", ".vitest", ".cache", "test-data", "test_data", "fixtures", "mocks", "__mocks__"].includes(entry.name)) {
                        scanDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    const isSetupOrHelper = /^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[a-z0-9]+$/i.test(entry.name);
                    const relPathNorm = fullPath.replace(/\\/g, "/").toLowerCase();
                    const isHelperDir = /(^|\/)(test-data|test_data|fixtures?|helpers?|mocks?|__mocks__|utils?|support)\//i.test(relPathNorm);
                    if (isSetupOrHelper || isHelperDir) {
                        continue;
                    }
                    if (requestedType === "unit" && (relPathNorm.includes("client/") || relPathNorm.includes("frontend/") || /\.[jt]sx$/i.test(entry.name))) {
                        continue;
                    }
                    const isTest = (
                        /\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i.test(entry.name) ||
                        (/(^|\/)(tests?|__tests__|unit)\//i.test(relPathNorm) && !/\.(d\.ts|json|md|txt)$/i.test(entry.name))
                    ) && /\.[cm]?[jt]sx?$/i.test(entry.name);
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

            // Read content to detect framework imports
            let content = "";
            try {
                const buf = Buffer.alloc(8192);
                const fd = fs.openSync(fullPath, "r");
                const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
                fs.closeSync(fd);
                content = buf.toString("utf8", 0, bytesRead);
            } catch (_) { }

            // Framework classification using classifyTestFile
            const framework = classifyTestFile(content, relPath);
            let category = "unit";
            if (framework === "supertest") {
                category = "integration";
            } else if (framework === "playwright" || framework === "cypress") {
                category = "system";
            } else {
                category = "unit";
            }

            // Filter strictly by requested type!
            // If requestedType === "unit", ONLY return unit (Jest & Vitest)
            if (category !== requestedType) {
                continue;
            }

            // Exclude frontend / client / jsx / tsx for unit test suites
            if (requestedType === "unit" && (
                lowerPath.includes("client/") ||
                lowerPath.includes("frontend/") ||
                /\.[jt]sx$/i.test(fullPath)
            )) {
                continue;
            }

            // Find matching execution results from framework-specific results map
            let suiteResult = null;
            if (framework === "jest") {
                suiteResult = jestResultsByPath.get(relPath) ||
                    jestResultsByPath.get(relPath.replace(/^[^/]+\//, "")) ||
                    jestResultsByPath.get(baseName);
            } else if (framework === "vitest") {
                suiteResult = vitestResultsByPath.get(relPath) ||
                    vitestResultsByPath.get(relPath.replace(/^[^/]+\//, "")) ||
                    vitestResultsByPath.get(baseName);
            }
            if (!suiteResult) {
                suiteResult = generalResultsByPath.get(relPath) ||
                    generalResultsByPath.get(relPath.replace(/^[^/]+\//, "")) ||
                    generalResultsByPath.get(baseName);
            }
            if (!suiteResult) {
                if (framework === "jest") {
                    suiteResult = vitestResultsByPath.get(relPath) || vitestResultsByPath.get(baseName);
                } else if (framework === "vitest") {
                    suiteResult = jestResultsByPath.get(relPath) || jestResultsByPath.get(baseName);
                }
            }

            const cleanBase = baseName.replace(/\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i, "").toLowerCase();
            const fileKnownFunctions = functionsByBaseName.get(cleanBase) || [];

            const assertions = (suiteResult && Array.isArray(suiteResult.assertionResults))
                ? suiteResult.assertionResults.map(a => {
                    const targetFunction = extractTargetFunction(a, baseName, fileKnownFunctions);
                    return {
                        title: a.title || a.fullName || "Test case",
                        status: a.status || "passed",
                        duration: typeof a.duration === "number" ? a.duration : 0,
                        targetFunction: targetFunction || null,
                        ancestorTitles: Array.isArray(a.ancestorTitles) ? a.ancestorTitles : []
                    };
                })
                : [];

            const numPassing = typeof suiteResult?.numPassingTests === "number" ? suiteResult.numPassingTests : null;
            const numFailing = typeof suiteResult?.numFailingTests === "number" ? suiteResult.numFailingTests : null;

            const passedTests = assertions.length > 0
                ? assertions.filter(a => a.status === "passed").length
                : (numPassing ?? (suiteResult?.status === "passed" ? 1 : 0));

            const failedTests = assertions.length > 0
                ? assertions.filter(a => a.status === "failed").length
                : (numFailing ?? (suiteResult?.status === "failed" ? 1 : 0));

            const totalTests = assertions.length > 0
                ? assertions.length
                : (passedTests + failedTests || (suiteResult ? 1 : 0));

            // pending = file found but no test run result yet; failed/passed = from results
            let status = suiteResult ? (suiteResult.status === "failed" || failedTests > 0 ? "failed" : "passed") : "pending";

            const rawDuration = suiteResult?.endTime && suiteResult?.startTime
                ? (suiteResult.endTime - suiteResult.startTime)
                : (suiteResult?.durationMs || suiteResult?.duration || 0);
            const durationMs = Math.max(0, Math.round(rawDuration));

            // Extract error message from failed suite (e.g. SyntaxError, compile error)
            let message = null;
            if (suiteResult && suiteResult.status === "failed" && Array.isArray(suiteResult.failureMessage)) {
                message = suiteResult.failureMessage.filter(Boolean).join("\n").slice(0, 500) || null;
            } else if (suiteResult && typeof suiteResult.message === "string" && suiteResult.message) {
                message = suiteResult.message.slice(0, 500);
            }

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
                message,
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
        const typeFilter = req.query?.type || req.query?.coverageType || null;
        const where = {
            snapshotId,
            // SCRUM-163: optional filter by filePath (partial, case-insensitive)
            ...(filePathFilter && {
                filePath: { contains: filePathFilter, mode: "insensitive" },
            }),
            ...(typeFilter === "unit" && {
                AND: [
                    { NOT: { filePath: { contains: "client/" } } },
                    { NOT: { filePath: { contains: "frontend/" } } },
                    { NOT: { filePath: { endsWith: ".jsx" } } },
                    { NOT: { filePath: { endsWith: ".tsx" } } },
                    { NOT: { filePath: { contains: "routes/" } } },
                    { NOT: { filePath: { contains: "controllers/" } } },
                    { NOT: { filePath: { contains: "endpoints/" } } },
                    { NOT: { filePath: { endsWith: "app.js" } } },
                    { NOT: { filePath: { endsWith: "app.ts" } } },
                    { NOT: { filePath: { endsWith: "server.js" } } },
                    { NOT: { filePath: { endsWith: "server.ts" } } },
                ]
            }),
        };

        let [functions, total] = await Promise.all([
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

        if (typeFilter === "unit") {
            const beforeCount = functions.length;
            functions = functions.filter(f => !isApiFilePath(f.filePath));
            if (functions.length !== beforeCount) {
                total = Math.max(functions.length, total - (beforeCount - functions.length));
            }
        }

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

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { project: { select: { ownerId: true } } }
        });

        if (!snapshot) return res.status(404).json({ success: false, message: "Snapshot not found." });
        if (snapshot.project.ownerId !== userId) return res.status(403).json({ success: false, message: "Forbidden." });

        const aiTests = await prisma.aiTest.findMany({ where: { snapshotId } });

        for (const t of aiTests) {
            try {
                if (t.metaJson) {
                    const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
                    if (meta.framework === "SUPERTEST") {
                        meta.status = "APPROVED";
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