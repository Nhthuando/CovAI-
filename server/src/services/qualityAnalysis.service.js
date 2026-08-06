import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveOwnedProjectSnapshot } from "./projectScope.service.js";
import { addJobLog } from "./job.service.js";

/**
 * Starts a quality analysis job. Reuses an active job if one exists.
 */
export const startQualityAnalysis = async ({ projectId, snapshotId, userId }) => {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }
    if (!userId || typeof userId !== "string") {
        throw new ServiceError("userId is required", 400);
    }

    const { snapshot } = await resolveOwnedProjectSnapshot({
        projectId,
        snapshotId,
        userId,
    });

    // Check prerequisites: at least CoverageSummary or Cyclomatic data or ProjectStructureAnalysis
    const [coverageSummary, cyclomaticCount, structureAnalysis] = await Promise.all([
        prisma.coverageSummary.findUnique({ where: { snapshotId: snapshot.id } }),
        prisma.cyclomatic.count({ where: { snapshotId: snapshot.id } }),
        prisma.projectStructureAnalysis.findUnique({ where: { snapshotId: snapshot.id } }),
    ]);

    if (!coverageSummary && cyclomaticCount === 0 && !structureAnalysis) {
        throw new ServiceError(
            "Quality analysis requires at least Coverage, Cyclomatic Complexity, or Architecture data. Please run analysis first.",
            409,
        );
    }

    // Check for active job
    const activeWhere = {
        projectId,
        snapshotId: snapshot.id,
        type: "QUALITY_ANALYSIS",
        status: { in: ["QUEUED", "RUNNING"] },
    };
    const active = await prisma.job.findFirst({
        where: activeWhere,
        orderBy: { createdAt: "desc" },
    });
    if (active) return { ...active, reused: true };

    // Create new job
    try {
        const job = await prisma.job.create({
            data: {
                projectId,
                snapshotId: snapshot.id,
                userId,
                type: "QUALITY_ANALYSIS",
                status: "QUEUED",
                progress: 0,
                payloadJson: JSON.stringify({ snapshotId: snapshot.id }),
            },
        });
        await addJobLog(job.id, "INFO", "Quality analysis job created");
        return { ...job, reused: false };
    } catch (error) {
        if (error?.code === "P2002") {
            const concurrent = await prisma.job.findFirst({
                where: activeWhere,
                orderBy: { createdAt: "desc" },
            });
            if (concurrent) return { ...concurrent, reused: true };
        }
        throw error;
    }
};

/**
 * Returns the latest completed QualityReport for a project.
 */
export const getQualityReport = async ({ projectId, userId }) => {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }
    if (!userId || typeof userId !== "string") {
        throw new ServiceError("userId is required", 400);
    }

    // Verify ownership
    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
        select: { id: true },
    });
    if (!project) throw new ServiceError("Project not found", 404);

    // Get latest report (by newest snapshot / created date)
    const report = await prisma.qualityReport.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
    });

    if (!report) return null;

    return {
        id: report.id,
        snapshotId: report.snapshotId,
        projectId: report.projectId,
        performanceScore: report.performanceScore,
        securityScore: report.securityScore,
        coverageScore: report.coverageScore,
        maintainabilityScore: report.maintainabilityScore,
        overallScore: report.overallScore,
        performanceDetails: JSON.parse(report.performanceDetails),
        securityDetails: JSON.parse(report.securityDetails),
        debugReport: JSON.parse(report.debugReport),
        recommendations: JSON.parse(report.recommendations),
        aiAvailable: report.aiAvailable,
        aiError: report.aiError,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
    };
};
