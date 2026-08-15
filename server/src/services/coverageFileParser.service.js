import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

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

const calculatePct = (section) => {
  if (!section || typeof section !== "object") {
    return null;
  }

  if (section.pct !== undefined && typeof section.pct === "number") {
    return section.pct;
  }

  const covered = normalizeCoverageValue(section.covered);
  const total = normalizeCoverageValue(section.total);
  if (total !== null && total >= 0 && covered !== null) {
    return total === 0 ? 100 : (covered / total) * 100;
  }

  const hits = normalizeCoverageValue(section.hits);
  if (hits !== null && normalizeCoverageValue(section.total) === null) {
    return hits;
  }

  return null;
};

const extractFilePath = (entry, key) => {
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

const calculateIstanbulPct = (map) => {
  if (!map || typeof map !== "object") {
    return null;
  }

  const values = Object.values(map);
  if (values.length === 0) {
    return 100;
  }

  const coveredCount = values.filter((v) => {
    if (Array.isArray(v)) {
      return v.some((x) => x > 0);
    }
    return v > 0;
  }).length;

  return (coveredCount / values.length) * 100;
};

const getCoverageRecords = (coverageReport) => {
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
      const funcsPct =
        calculatePct(entry.functions) ??
        calculatePct(entry.function) ??
        calculatePct(entry.funcs) ??
        calculateIstanbulPct(entry.f);
      const branchesPct =
        calculatePct(entry.branches) ??
        calculatePct(entry.branch) ??
        calculateIstanbulPct(entry.b);
      const stmtsPct =
        calculatePct(entry.statements) ??
        calculatePct(entry.statement) ??
        calculatePct(entry.stmts) ??
        calculateIstanbulPct(entry.s);

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

  return {
    linesPct: calculatePct(total.lines) ?? calculatePct(total.line) ?? 0,

    branchesPct:
      calculatePct(total.branches) ??
      calculatePct(total.branch) ??
      calculateIstanbulPct(total.b) ??
      0,

    funcsPct:
      calculatePct(total.functions) ??
      calculatePct(total.function) ??
      calculateIstanbulPct(total.f) ??
      0,

    stmtsPct:
      calculatePct(total.statements) ??
      calculatePct(total.statement) ??
      calculatePct(total.stmts) ??
      calculateIstanbulPct(total.s) ??
      0,
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
    throw new ServiceError(
      "You do not have permission to update coverage for this project",
      403,
    );
  }

  const coverageRows = getCoverageRecords(coverageReport);
  if (coverageRows.length === 0) {
    throw new ServiceError("No coverage files found in coverage report", 400);
  }

  const testType = coverageReport.testType || "UNIT"; // 'UNIT' or 'INTEGRATION'

  const formattedRows = coverageRows.map((row) => ({
    snapshotId,
    filePath: row.filePath,
    linesPct: row.linesPct,
    branchesPct: row.branchesPct,
    funcsPct: row.funcsPct,
    stmtsPct: row.stmtsPct,
  }));

  const summaryRow = getTotalCoverageSummary(coverageReport);

  await prisma.$transaction(async (tx) => {
    await tx.coverageFile.deleteMany({
      where: { snapshotId },
    });

    await tx.coverageFile.createMany({
      data: formattedRows,
      skipDuplicates: true,
    });

    if (summaryRow) {
      await tx.coverageSummary.upsert({
        where: { snapshotId },
        update: {
          linesPct: summaryRow.linesPct,
          branchesPct: summaryRow.branchesPct,
          funcsPct: summaryRow.funcsPct,
          stmtsPct: summaryRow.stmtsPct,
        },
        create: {
          snapshotId,
          linesPct: summaryRow.linesPct,
          branchesPct: summaryRow.branchesPct,
          funcsPct: summaryRow.funcsPct,
          stmtsPct: summaryRow.stmtsPct,
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
