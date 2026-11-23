// Recompute from an event prefix so seeking backwards cannot retain future hits.
export function buildPlaybackState(trace, stepIndex, testId = null) {
  const sourceLines = new Set();
  const testLines = new Set();
  const statements = new Set();
  const functions = new Set();
  const branches = new Set();
  for (const step of (trace?.steps || []).slice(0, stepIndex + 1)) {
    if (testId && step.testId !== testId && step.testId !== '<suite setup>') continue;
    const location = step.sourceLocation;
    if (location?.file === trace.sourceFilePath) {
      sourceLines.add(location.line);
    }
    if (step.testLocation?.line) testLines.add(step.testLocation.line);
    (step.coverageDelta?.statementIds || []).forEach(id => statements.add(id));
    (step.coverageDelta?.functionIds || []).forEach(id => functions.add(id));
    (step.coverageDelta?.branchOutcomes || []).forEach(({ branchId, outcomeIndex }) => branches.add(`${branchId}:${outcomeIndex}`));
  }
  const measured = trace?.mode === 'RECORDED' && trace?.completeness === 'COMPLETE';
  const summary = trace?.coverageSummary;
  const metric = (covered, total) => ({ covered, total, pct: total ? 100 * covered / total : null });
  const executableLines = new Set(Object.values(trace?.coverageMap?.statementMap || {}).map(location => location.start.line));
  const coveredExecutableLines = new Set([...statements].map(id => trace?.coverageMap?.statementMap?.[id.slice(id.lastIndexOf(':') + 1)]?.start.line).filter(Number.isFinite));
  return { sourceLines: [...sourceLines], testLines: [...testLines], measured,
    coverage: measured && summary ? {
      statements: metric(statements.size, summary.statements.total),
      branches: metric(branches.size, summary.branches.total),
      functions: metric(functions.size, summary.functions.total),
      lines: metric(coveredExecutableLines.size, executableLines.size),
    } : null };
}
