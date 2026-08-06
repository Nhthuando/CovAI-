import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";
import {
    computeCoverageScore,
    computePerformanceScore,
    computeMaintainabilityScore,
    computeOverallScore,
} from "./qualityScoring.service.js";
import { runQualityAiAnalysis } from "./qualityAiAnalysis.service.js";
import fs from "fs";
import path from "path";

/**
 * Reads source files from the snapshot directory for AI context.
 * Returns the top 15 riskiest files (by CC + coverage gaps).
 */
const loadSourceFilesForAi = (rootDir, cyclomatics, coverageFunctions) => {
    if (!rootDir || !fs.existsSync(rootDir)) return [];

    const riskFiles = new Set();
    // Files with high CC functions
    (cyclomatics || [])
        .filter((c) => c.value > 5)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .forEach((c) => riskFiles.add(c.filePath));

    // Files with uncovered functions
    (coverageFunctions || [])
        .filter((f) => f.hit === 0)
        .slice(0, 10)
        .forEach((f) => riskFiles.add(f.filePath));

    const results = [];
    for (const relativePath of riskFiles) {
        if (results.length >= 15) break;
        const absPath = path.join(rootDir, relativePath);
        try {
            if (fs.existsSync(absPath)) {
                const content = fs.readFileSync(absPath, "utf-8");
                results.push({ path: relativePath, content: content.slice(0, 5000) });
            }
        } catch {
            // Skip unreadable files
        }
    }
    return results;
};

/**
 * BullMQ worker handler for QUALITY_ANALYSIS jobs.
 */
export const processQualityAnalysisJob = async (jobId) => {
    if (!jobId || typeof jobId !== "string") {
        throw new ServiceError("jobId is required", 400);
    }

    try {
        await updateJobStatus({ jobId, status: "RUNNING", progress: 5 });
    } catch (error) {
        if (["Job not found", "Only queued jobs can start", "Cannot start a canceled job"].includes(error.message)) return;
        console.error(`[QualityJob ${jobId}] Could not start`, error);
        return;
    }

    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[QualityJob ${jobId}] Could not load job`, error);
        return;
    }

    const { snapshotId, projectId } = job;

    try {
        // ── Phase 1: Aggregate existing data ────────────────────
        await addJobLog(jobId, "INFO", "Aggregating existing analysis data...");
        await updateJobStatus({ jobId, progress: 10 });

        const [coverageSummary, cyclomatics, coverageFunctions, structureAnalysis] = await Promise.all([
            prisma.coverageSummary.findUnique({ where: { snapshotId } }),
            prisma.cyclomatic.findMany({ where: { snapshotId } }),
            prisma.coverageFunction.findMany({ where: { snapshotId } }),
            prisma.projectStructureAnalysis.findUnique({ where: { snapshotId } }),
        ]);

        const structureResult = structureAnalysis
            ? JSON.parse(structureAnalysis.resultJson)
            : null;

        await updateJobStatus({ jobId, progress: 25 });

        // ── Phase 2: Rule-based scoring ─────────────────────────
        await addJobLog(jobId, "INFO", "Computing rule-based scores...");

        const coverageResult = computeCoverageScore(coverageSummary);
        const performanceResult = computePerformanceScore(cyclomatics, structureResult);
        const maintainabilityResult = computeMaintainabilityScore(cyclomatics, structureResult);

        await updateJobStatus({ jobId, progress: 40 });

        // ── Phase 3: AI analysis ────────────────────────────────
        await addJobLog(jobId, "INFO", "Running AI security and debug analysis...");

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { rootDir: true },
        });

        const sourceFiles = loadSourceFilesForAi(
            snapshot?.rootDir,
            cyclomatics,
            coverageFunctions,
        );

        const aiResult = await runQualityAiAnalysis({
            sourceFiles,
            cyclomatics,
            coverageSummary,
            coverageFunctions,
            structureResult,
        });

        if (!aiResult.aiAvailable) {
            await addJobLog(jobId, "WARN", `AI analysis unavailable: ${aiResult.aiError}`);
        }

        await updateJobStatus({ jobId, progress: 75 });

        // ── Phase 4: Compute Overall Score ──────────────────────
        await addJobLog(jobId, "INFO", "Computing overall quality score...");

        const overallScore = computeOverallScore(
            coverageResult.score,
            performanceResult.score,
            aiResult.securityScore,
            maintainabilityResult.score,
        );

        await updateJobStatus({ jobId, progress: 85 });

        // ── Phase 5: Persist ────────────────────────────────────
        await addJobLog(jobId, "INFO", "Saving quality report...");

        await prisma.qualityReport.upsert({
            where: { snapshotId },
            create: {
                snapshotId,
                projectId,
                performanceScore: performanceResult.score,
                securityScore: aiResult.securityScore,
                coverageScore: coverageResult.score,
                maintainabilityScore: maintainabilityResult.score,
                overallScore,
                performanceDetails: JSON.stringify(performanceResult.details),
                securityDetails: JSON.stringify(aiResult.securityDetails),
                debugReport: JSON.stringify(aiResult.debugReport),
                recommendations: JSON.stringify(aiResult.recommendations),
                aiAvailable: aiResult.aiAvailable,
                aiError: aiResult.aiError,
            },
            update: {
                performanceScore: performanceResult.score,
                securityScore: aiResult.securityScore,
                coverageScore: coverageResult.score,
                maintainabilityScore: maintainabilityResult.score,
                overallScore,
                performanceDetails: JSON.stringify(performanceResult.details),
                securityDetails: JSON.stringify(aiResult.securityDetails),
                debugReport: JSON.stringify(aiResult.debugReport),
                recommendations: JSON.stringify(aiResult.recommendations),
                aiAvailable: aiResult.aiAvailable,
                aiError: aiResult.aiError,
            },
        });

        await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
        await addJobLog(jobId, "INFO", `Quality analysis completed. Overall score: ${overallScore}`);
    } catch (error) {
        console.error(`[QualityJob ${jobId}] Failed:`, error);
        await addJobLog(jobId, "ERROR", `Quality analysis failed: ${error.message}`);
        await updateJobStatus({
            jobId,
            status: "FAILED",
            errorMessage: error.message,
        }).catch(() => {});
        throw error;
    }
};
