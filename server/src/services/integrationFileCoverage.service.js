const parseJson = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
};

/**
 * Replaces shared CoverageFile values with the per-file numbers measured by the
 * integration runs of the same snapshot. Jobs are ordered newest first; a file
 * takes the newest run that measured it. Older jobs without stored files leave
 * the shared rows unchanged.
 */
export const applyIntegrationFileCoverage = (coverageFiles = [], jobs = []) => {
  const measured = new Map();
  for (const job of jobs || []) {
    if (job?.type !== "SUPERTEST_COVERAGE" || job?.status !== "SUCCESS") continue;
    const rows = parseJson(job.resultJson)?.fileCoverages;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row?.filePath && !measured.has(row.filePath)) measured.set(row.filePath, row);
    }
  }
  if (measured.size === 0) return coverageFiles || [];
  const result = (coverageFiles || []).map((file) => {
    const row = measured.get(file.filePath);
    if (!row) return file;
    measured.delete(file.filePath);
    return {
      ...file,
      linesPct: row.linesPct,
      branchesPct: row.branchesPct,
      funcsPct: row.funcsPct,
      stmtsPct: row.stmtsPct,
    };
  });
  for (const row of measured.values()) result.push({ ...row });
  return result;
};
