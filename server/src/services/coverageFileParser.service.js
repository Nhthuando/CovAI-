import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { canonicalizeFilePath } from "../utils/pathSanitizer.js";
import { isBusinessLogicSourceFile } from "../utils/businessLogicFileDetector.js";

const assertStringField = (value, fieldName) => {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(`${fieldName} is required`, 400);
  }
};

const normalizeCoverageValue = (value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const calculatePct = (section, isFileCovered = false) => {
  if (!section || typeof section !== "object") {
    return null;
  }

  if (section.pct !== undefined) {
    if (typeof section.pct === "number") return section.pct;
    if (section.pct === "Unknown") return 0;
  }

  const covered = normalizeCoverageValue(section.covered);
  const total = normalizeCoverageValue(section.total);
  if (total !== null && total >= 0 && covered !== null) {
    if (total === 0) {
      return isFileCovered ? 100 : 0;
    }
    return (covered / total) * 100;
  }

  const hits = normalizeCoverageValue(section.hits);
  if (hits !== null && normalizeCoverageValue(section.total) === null) {
    return hits;
  }

  return null;
};

const extractFilePath = (entry, key, rootDir = "") => {
  let raw = null;
  if (entry.path && typeof entry.path === "string") {
    raw = entry.path;
  } else if (entry.filePath && typeof entry.filePath === "string") {
    raw = entry.filePath;
  } else if (entry.filename && typeof entry.filename === "string") {
    raw = entry.filename;
  } else if (typeof key === "string") {
    raw = key;
  }
  if (!raw || typeof raw !== "string") return null;

  return canonicalizeFilePath(raw, rootDir);
};

const calculateIstanbulPct = (map, isFileCovered = false) => {
  if (!map || typeof map !== "object") {
    return null;
  }

  const values = Object.values(map);
  if (values.length === 0) {
    return isFileCovered ? 100 : 0;
  }

  const coveredCount = values.filter((v) => {
    if (Array.isArray(v)) {
      return v.some((x) => x > 0);
    }
    return v > 0;
  }).length;

  return (coveredCount / values.length) * 100;
};

const getCoverageRecords = (coverageReport, rootDir = "") => {
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
      .filter(
        ([key]) => key !== "total" && key !== "summary" && key !== "metadata",
      )
      .map(([key, value]) => ({ ...value, filePath: key }));
  }

  return entries
    .map((entry, index) => {
      const filePath = extractFilePath(
        entry,
        entry.filePath || entry.path || index,
        rootDir
      );
      if (!filePath || typeof filePath !== "string") {
        return null;
      }

      const linesPct =
        calculatePct(entry.lines) ??
        calculatePct(entry.line) ??
        calculatePct(entry.linesCoverage) ??
        calculateIstanbulPct(entry.s) ??
        0;
      const isFileCovered = linesPct > 0;

      const funcsPct =
        calculatePct(entry.functions, isFileCovered) ??
        calculatePct(entry.function, isFileCovered) ??
        calculatePct(entry.funcs, isFileCovered) ??
        calculateIstanbulPct(entry.f, isFileCovered);
      const branchesPct =
        calculatePct(entry.branches, isFileCovered) ??
        calculatePct(entry.branch, isFileCovered) ??
        calculateIstanbulPct(entry.b, isFileCovered);
      const stmtsPct =
        calculatePct(entry.statements, isFileCovered) ??
        calculatePct(entry.statement, isFileCovered) ??
        calculatePct(entry.stmts, isFileCovered) ??
        calculateIstanbulPct(entry.s, isFileCovered);

      return {
        filePath,
        linesPct: linesPct !== null ? Math.round(linesPct * 100) / 100 : 0,
        funcsPct: funcsPct !== null ? Math.round(funcsPct * 100) / 100 : 0,
        branchesPct:
          branchesPct !== null ? Math.round(branchesPct * 100) / 100 : 0,
        stmtsPct: stmtsPct !== null ? Math.round(stmtsPct * 100) / 100 : 0,
      };
    })
    .filter(Boolean);
};

const getTotalCoverageSummary = (coverageReport) => {
  if (!coverageReport || typeof coverageReport !== "object") {
    return null;
  }

  const total = coverageReport.total ?? coverageReport.summary;
  if (!total || typeof total !== "object") {
    return null;
  }

  const astStmtsPct = calculateIstanbulPct(total.s);
  const astFuncsPct = calculateIstanbulPct(total.f);
  const astBranchesPct = calculateIstanbulPct(total.b);

  const rawStmtsPct = calculatePct(total.statements) ?? calculatePct(total.statement) ?? calculatePct(total.stmts);
  const rawFuncsPct = calculatePct(total.functions) ?? calculatePct(total.function);
  const rawBranchesPct = calculatePct(total.branches) ?? calculatePct(total.branch);
  const rawLinesPct = calculatePct(total.lines) ?? calculatePct(total.line);

  return {
    linesPct: rawLinesPct ?? astStmtsPct ?? 0,
    branchesPct: (astBranchesPct !== null && astBranchesPct > 0) ? astBranchesPct : (rawBranchesPct ?? astBranchesPct ?? 0),
    funcsPct: (astFuncsPct !== null && astFuncsPct > 0) ? astFuncsPct : (rawFuncsPct ?? astFuncsPct ?? 0),
    stmtsPct: (astStmtsPct !== null && astStmtsPct > 0) ? astStmtsPct : (rawStmtsPct ?? astStmtsPct ?? 0),
  };
};

export const parseCoverageFilesForSnapshot = async ({
  projectId,
  snapshotId,
  coverageReport,
  userId,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");

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

  const effectiveUserId = userId || snapshot.project?.ownerId;
  if (!effectiveUserId) {
    throw new ServiceError("Cannot determine owner for snapshot", 403);
  }

  if (userId && snapshot.project && snapshot.project.ownerId !== userId) {
    throw new ServiceError(
      "You do not have permission to update coverage for this project",
      403,
    );
  }

  const coverageRows = getCoverageRecords(coverageReport, snapshot.rootDir);

  const testType = coverageReport.testType || "UNIT"; // 'UNIT' or 'INTEGRATION'

  const dedupedMap = new Map();
  for (const row of coverageRows) {
    if (!row.filePath) continue;
    if (testType === "UNIT" && !isBusinessLogicSourceFile(row.filePath)) continue;
    if (!dedupedMap.has(row.filePath)) {
      dedupedMap.set(row.filePath, {
        snapshotId,
        filePath: row.filePath,
        linesPct: row.linesPct,
        branchesPct: row.branchesPct,
        funcsPct: row.funcsPct,
        stmtsPct: row.stmtsPct,
      });
    } else {
      const existing = dedupedMap.get(row.filePath);
      existing.linesPct = Math.max(existing.linesPct || 0, row.linesPct || 0);
      existing.branchesPct = Math.max(existing.branchesPct || 0, row.branchesPct || 0);
      existing.funcsPct = Math.max(existing.funcsPct || 0, row.funcsPct || 0);
      existing.stmtsPct = Math.max(existing.stmtsPct || 0, row.stmtsPct || 0);
    }
  }
  const formattedRows = Array.from(dedupedMap.values());

  const rawSummary = getTotalCoverageSummary(coverageReport);
  const summaryRow = rawSummary || {
    linesPct: 0,
    branchesPct: 0,
    funcsPct: 0,
    stmtsPct: 0,
  };

  const safeNum = (v) => {
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string") {
      const p = parseFloat(v);
      if (!isNaN(p)) return p;
    }
    return 0;
  };

  await prisma.$transaction(async (tx) => {
    await tx.coverageFile.deleteMany({
      where: { snapshotId },
    });

    if (formattedRows.length > 0) {
      await tx.coverageFile.createMany({
        data: formattedRows,
        skipDuplicates: true,
      });
    }

    if (rawSummary) {
      await tx.coverageSummary.upsert({
        where: { snapshotId },
        update: {
          linesPct: safeNum(summaryRow.linesPct),
          branchesPct: safeNum(summaryRow.branchesPct),
          funcsPct: safeNum(summaryRow.funcsPct),
          stmtsPct: safeNum(summaryRow.stmtsPct),
        },
        create: {
          snapshotId,
          linesPct: safeNum(summaryRow.linesPct),
          branchesPct: safeNum(summaryRow.branchesPct),
          funcsPct: safeNum(summaryRow.funcsPct),
          stmtsPct: safeNum(summaryRow.stmtsPct),
        },
      });
    }
  });

  return {
    totalFiles: formattedRows.length,
    summary: summaryRow,
    files: formattedRows,
  };
};
