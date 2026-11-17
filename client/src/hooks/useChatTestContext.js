import { useEffect } from 'react';

// Report the displayed values alongside identifiers for separately resolved evidence.
export function useChatTestContext(onChange, { projectId, snapshotId, testType, testRunId, scenarioId, displayedMetrics }) {
  const metricsJson = displayedMetrics ? JSON.stringify(displayedMetrics) : null;
  useEffect(() => {
    onChange?.({
      projectId, snapshotId, testType,
      testRunId: testRunId || undefined,
      scenarioId: scenarioId || undefined,
      displayedMetrics: metricsJson ? { ...JSON.parse(metricsJson), projectId, snapshotId } : undefined,
    });
  }, [onChange, projectId, snapshotId, testType, testRunId, scenarioId, metricsJson]);
}
