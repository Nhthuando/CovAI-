import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { createInstallDepsJob, createRunTestsJob } from "../services/job.service.js";
import { processCoverageJob } from "../services/coverageRunner.service.js";
import { addJobToQueue } from "../services/queue.service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SORT_FIELDS = ["filePath", "linesPct", "branchesPct", "funcsPct", "stmtsPct"];
const ALLOWED_SORT_ORDERS = ["asc", "desc"];

// SCRUM-160: Functions endpoint sort fields
const ALLOWED_FUNC_SORT_FIELDS = ["functionName", "filePath", "hit", "startLine"];

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

        if (!summary) {
            return res.status(404).json({
                success: false,
                message: "Chưa có dữ liệu coverage cho snapshot này. Hãy chạy test trước.",
            });
        }

        // Return formatted response
        return res.status(200).json({
            success: true,
            data: {
                snapshotId: snapshot.id,
                projectId: snapshot.projectId,
                projectName: snapshot.project.name,
                source: snapshot.source,
                commitSha: snapshot.commitSha ?? null,
                snapshotCreatedAt: snapshot.createdAt,
                coverage: {
                    lines: summary.linesPct,
                    branches: summary.branchesPct,
                    functions: summary.funcsPct,
                    statements: summary.stmtsPct,
                },
                summaryCreatedAt: summary.createdAt,
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
        const rawOrder  = req.query.order  ?? "asc";

        const sortBy = ALLOWED_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "filePath";
        const order  = ALLOWED_SORT_ORDERS.includes(rawOrder)  ? rawOrder  : "asc";

        // Pagination
        const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const skip  = (page - 1) * limit;

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

        if (total === 0) {
            return res.status(404).json({
                success: false,
                message: "Chưa có dữ liệu CoverageFile cho snapshot này. Hãy chạy test trước.",
            });
        }

        // ── Return formatted response ────────────────────────────────────────
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
        const rawOrder  = req.query.order  ?? "asc";
        const sortBy = ALLOWED_FUNC_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "filePath";
        const order  = ALLOWED_SORT_ORDERS.includes(rawOrder)        ? rawOrder  : "asc";

        const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const skip  = (page - 1) * limit;

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

        if (total === 0) {
            return res.status(404).json({
                success: false,
                message: filePathFilter
                    ? `Không tìm thấy function nào khớp với file "${filePathFilter}" trong snapshot này.`
                    : "Chưa có dữ liệu CoverageFunction cho snapshot này. Hãy chạy test trước.",
            });
        }

        // ── Return formatted response ──────────────────────────────────────────
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
