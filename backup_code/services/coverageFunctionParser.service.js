import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

const normalizeNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};

const extractFilePath = (entry, key) => {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    if (entry.path && typeof entry.path === "string") {
        return entry.path;
    }
    if (entry.filePath && typeof entry.filePath === "string") {
        return entry.filePath;
    }
    if (entry.filename && typeof entry.filename === "string") {
        return entry.filename;
    }
    if (typeof key === "string") {
        return key;
    }
    return null;
};

const extractFunctionRowsFromIstanbul = (entry, snapshotId, filePath) => {
    const fnMap = entry.fnMap;
    const counts = entry.f;

    if (!fnMap || typeof fnMap !== "object" || !counts || typeof counts !== "object") {
        return [];
    }

    return Object.entries(fnMap)
        .map(([fnId, fnMeta]) => {
            const hit = normalizeNumber(counts[fnId]);
            if (hit === null) {
                return null;
            }

            const functionName =
                (fnMeta && typeof fnMeta.name === "string" && fnMeta.name.trim()) ||
                `anonymous_${fnId}`;

            let startLine = null;
            let endLine = null;

            if (fnMeta && typeof fnMeta === "object") {
                if (fnMeta.loc && typeof fnMeta.loc === "object") {
                    startLine = normalizeNumber(fnMeta.loc.start?.line) ?? startLine;
                    endLine = normalizeNumber(fnMeta.loc.end?.line) ?? endLine;
                }
                if (startLine === null && fnMeta.decl && typeof fnMeta.decl === "object") {
                    startLine = normalizeNumber(fnMeta.decl.start?.line) ?? startLine;
                    endLine = normalizeNumber(fnMeta.decl.end?.line) ?? endLine;
                }
                if (startLine === null && typeof fnMeta.line === "number") {
                    startLine = normalizeNumber(fnMeta.line);
                }
            }

            return {
                snapshotId,
                filePath,
                functionName,
                startLine,
                endLine,
                hit,
            };
        })
        .filter(Boolean);
};

const extractFunctionRowsFromList = (entry, snapshotId, filePath) => {
    if (!Array.isArray(entry.functions)) {
        return [];
    }

    return entry.functions
        .map((fnEntry, index) => {
            if (!fnEntry || typeof fnEntry !== "object") {
                return null;
            }

            const functionName =
                (typeof fnEntry.name === "string" && fnEntry.name.trim()) ||
                `anonymous_${index}`;
            const hit = normalizeNumber(fnEntry.hit ?? fnEntry.hits ?? fnEntry.count ?? fnEntry.executionCount);
            if (hit === null) {
                return null;
            }

            const startLine = normalizeNumber(fnEntry.startLine ?? fnEntry.line ?? fnEntry.loc?.start?.line ?? fnEntry.decl?.start?.line);
            const endLine = normalizeNumber(fnEntry.endLine ?? fnEntry.loc?.end?.line ?? fnEntry.decl?.end?.line);

            return {
                snapshotId,
                filePath,
                functionName,
                startLine,
                endLine,
                hit,
            };
        })
        .filter(Boolean);
};

const getFunctionCoverageRecords = (coverageReport, snapshotId) => {
    if (!coverageReport || typeof coverageReport !== "object") {
        return [];
    }

    let entries = [];
    if (Array.isArray(coverageReport)) {
        entries = coverageReport;
    } else if (Array.isArray(coverageReport.files)) {
        entries = coverageReport.files;
    } else if (Array.isArray(coverageReport.results)) {
        entries = coverageReport.results;
    } else {
        entries = Object.entries(coverageReport)
            .filter(([key]) => key !== "total" && key !== "summary" && key !== "metadata")
            .map(([key, value]) => ({ ...value, filePath: key }));
    }

    return entries.flatMap((entry, index) => {
        const filePath = extractFilePath(entry, entry.filePath || entry.path || index);
        if (!filePath || typeof filePath !== "string") {
            return [];
        }

        const istanbulRecords = extractFunctionRowsFromIstanbul(entry, snapshotId, filePath);
        if (istanbulRecords.length > 0) {
            return istanbulRecords;
        }

        return extractFunctionRowsFromList(entry, snapshotId, filePath);
    });
};

export const parseCoverageFunctionsForSnapshot = async ({
    projectId,
    snapshotId,
    coverageReport,
    userId,
}) => {
    assertStringField(projectId, "projectId");
    assertStringField(snapshotId, "snapshotId");
    assertStringField(userId, "userId");

    if (!coverageReport || typeof coverageReport !== "object") {
        throw new ServiceError("Invalid coverage report", 400);
    }

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: {
            id: snapshotId,
            projectId,
        },
        include: {
            project: {
                select: {
                    ownerId: true,
                },
            },
        },
    });

    if (!snapshot) {
        throw new ServiceError("Snapshot not found for this project", 404);
    }

    if (!snapshot.project || snapshot.project.ownerId !== userId) {
        throw new ServiceError("You do not have permission to update coverage for this project", 403);
    }

    const functionRows = getFunctionCoverageRecords(coverageReport, snapshotId);

    if (functionRows.length === 0) {
        throw new ServiceError("No function coverage records found in coverage report", 400);
    }

    await prisma.$transaction(async (tx) => {
        await tx.coverageFunction.deleteMany({
            where: { snapshotId },
        });

        await tx.coverageFunction.createMany({
            data: functionRows,
            skipDuplicates: true,
        });
    });

    return {
        totalFunctions: functionRows.length,
        functions: functionRows,
    };
};
