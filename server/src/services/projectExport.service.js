import path from "node:path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const projectSelect = { id: true, name: true, description: true, repoUrl: true, createdAt: true, updatedAt: true };
const snapshotSelect = { id: true, projectId: true, source: true, checksum: true, commitSha: true, createdAt: true, rootDir: true, storagePath: true };

export const loadExportScope = async ({ projectId, snapshotId, userId }) => {
    // Fail closed if an authenticated token does not contain an actual user ID.
    if (!userId) throw new ServiceError("Authentication required", 401);
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: projectSelect });
    if (!project) throw new ServiceError("Project or snapshot not found", 404);
    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId, ...(snapshotId ? { id: snapshotId } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: snapshotSelect,
    });
    if (!snapshot) throw new ServiceError("No snapshot is available for this project", snapshotId ? 404 : 409);
    return { project, snapshot };
};

const parseJson = (value, section, warnings) => {
    if (!value) return null;
    try { return JSON.parse(value); } catch {
        warnings.push(`${section} contains unreadable stored data and was omitted.`);
        return null;
    }
};

const privateKeys = /^(rootDir|storagePath|storageBasePath|absolutePath|password.*|.*token.*|.*secret.*|.*credential.*|stdout|stderr|payloadJson|domSnapshot|screenshotPath)$/i;

/** Normalize known workspace paths and redact unknown host paths in stored analysis. */
export const sanitizeExportData = (value, rootDir, field = "") => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => sanitizeExportData(item, rootDir, field));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.test(key))
            .map(([key, item]) => [key, sanitizeExportData(item, rootDir, key)]));
    }
    if (typeof value !== "string") return value;
    const isPath = /^(filePath|relativePath|path|file|testFile|relatedFiles|sourcePath|targetPath)$/i.test(field);
    let text = isPath ? value.replaceAll("\\", "/") : value;
    if (rootDir) {
        const root = rootDir.replaceAll("\\", "/").replace(/\/$/, "");
        const roots = new Set([root, root.replaceAll("/", "\\"), rootDir]);
        for (const variant of roots) {
            text = text.split(`${variant}/`).join("").split(`${variant}\\`).join("").split(variant).join("[workspace]");
        }
    }
    // Paths outside the workspace are internal implementation details.
    if (isPath && (/^[a-z]:\//i.test(text) || /^\/(?!\/)/.test(text) || /^\/\/[^/]+\//.test(text))) {
        return `[external]/${path.posix.basename(text)}`;
    }
    return text.replace(/\b[a-z]:[\\/][^\s"'<>]+/gi, "[internal path]");
};

const safeRepositoryUrl = (value) => {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (!["https:", "http:"].includes(url.protocol)) return null;
        url.username = ""; url.password = ""; url.search = ""; url.hash = "";
        return url.toString();
    } catch { return null; }
};

export const collectAnalysisExport = async ({ project, snapshot }) => {
    const where = { snapshotId: snapshot.id };
    const [coverage, files, functions, complexity, structure, quality, testRuns, suggestions, cfgs, performance, vulnerabilities, jobs] = await Promise.all([
        prisma.coverageSummary.findUnique({ where, select: { linesPct: true, branchesPct: true, funcsPct: true, stmtsPct: true, createdAt: true } }),
        prisma.coverageFile.findMany({ where, orderBy: { filePath: "asc" }, select: { filePath: true, linesPct: true, branchesPct: true, funcsPct: true, stmtsPct: true } }),
        prisma.coverageFunction.findMany({ where, orderBy: [{ filePath: "asc" }, { startLine: "asc" }], select: { filePath: true, functionName: true, startLine: true, endLine: true, hit: true } }),
        prisma.cyclomatic.findMany({ where, orderBy: [{ value: "desc" }, { filePath: "asc" }], select: { filePath: true, functionName: true, value: true } }),
        prisma.projectStructureAnalysis.findUnique({ where, select: { resultJson: true, createdAt: true } }),
        prisma.qualityReport.findUnique({ where, select: { overallScore: true, performanceScore: true, securityScore: true, coverageScore: true, maintainabilityScore: true, recommendations: true, aiAvailable: true, createdAt: true } }),
        prisma.testRun.findMany({ where, orderBy: { createdAt: "desc" }, select: {
            id: true, type: true, executionMode: true, totalTests: true, passedTests: true, failedTests: true, flakyTests: true, skippedTests: true,
            durationMs: true, status: true, startedAt: true, finishedAt: true, createdAt: true,
            coverageLinesPct: true, coverageBranchesPct: true, coverageStatementsPct: true, coverageFunctionsPct: true,
            scenarios: { orderBy: { createdAt: "asc" }, select: { title: true, suiteName: true, status: true, testFile: true, durationMs: true, failureCategory: true } },
        } }),
        prisma.aiSuggestion.findMany({ where, orderBy: { createdAt: "desc" }, select: { filePath: true, functionName: true, priority: true, message: true, createdAt: true } }),
        prisma.cfg.findMany({ where, orderBy: { filePath: "asc" }, select: { filePath: true, functionName: true, startLine: true, endLine: true, graphJson: true } }),
        prisma.performanceMetric.findUnique({ where, select: { metricsJson: true, createdAt: true } }),
        prisma.vulnerability.findMany({ where, orderBy: { file: "asc" }, select: { type: true, severity: true, file: true, line: true, description: true } }),
        prisma.job.findMany({ where: { ...where, status: { in: ["QUEUED", "RUNNING"] } }, select: { type: true, status: true } }),
    ]);
    const warnings = [];
    if (jobs.length) warnings.push("Analysis jobs are still queued or running. This export contains currently saved results; export again after completion.");
    const analysis = {
        coverage: { summary: coverage, files, functions },
        complexity,
        structure: parseJson(structure?.resultJson, "Structure analysis", warnings),
        quality: quality ? { ...quality, recommendations: parseJson(quality.recommendations, "Quality recommendations", warnings) } : null,
        testRuns,
        suggestions,
        controlFlow: cfgs.map(({ graphJson, ...cfg }) => ({ ...cfg, graph: parseJson(graphJson, "Control flow", warnings) })),
        performance: performance ? { createdAt: performance.createdAt, metrics: parseJson(performance.metricsJson, "Performance", warnings) } : null,
        vulnerabilities,
    };
    const { rootDir, projectId: _projectId, ...safeSnapshot } = snapshot;
    return sanitizeExportData({
        schemaVersion: 1, exportedAt: new Date().toISOString(),
        project: { ...project, repoUrl: safeRepositoryUrl(project.repoUrl) },
        snapshot: safeSnapshot, warnings, analysis,
    }, rootDir);
};

export const exportFilename = (project, snapshot, extension) => {
    const slug = project.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "project";
    const snapshotSlug = snapshot.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "snapshot";
    return `covai-${slug}-${snapshotSlug}.${extension}`;
};
