import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-151: Create summary endpoint
 * SCRUM-152: Verify permissions
 * SCRUM-153: Retrieve CoverageSummary
 * SCRUM-154: Return formatted response
 *
 * GET /api/coverage/:snapshotId/summary
 * Middleware: authMiddleware
 */
export const getCoverageSummary = async (req, res) => {
    try {
        const userId = req.user?.id;

        // ── SCRUM-152: Verify auth ─────────────────────────────────────────
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { snapshotId } = req.params;

        if (!snapshotId || typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
            return res.status(400).json({ success: false, message: "snapshotId không hợp lệ." });
        }

        // ── SCRUM-152: Verify snapshot tồn tại và thuộc project của user ───
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

        // ── SCRUM-153: Retrieve CoverageSummary ───────────────────────────
        const summary = await prisma.coverageSummary.findUnique({
            where: { snapshotId },
        });

        if (!summary) {
            return res.status(404).json({
                success: false,
                message: "Chưa có dữ liệu coverage cho snapshot này. Hãy chạy test trước.",
            });
        }

        // ── SCRUM-154: Return formatted response ──────────────────────────
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
