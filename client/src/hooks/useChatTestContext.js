import { useEffect } from 'react';

// Report identifiers only; the server resolves and authorizes the underlying evidence.
export function useChatTestContext(onChange, { projectId, snapshotId, testType, testRunId, scenarioId }) {
  useEffect(() => {
    onChange?.({ projectId, snapshotId, testType, testRunId: testRunId || undefined, scenarioId: scenarioId || undefined });
  }, [onChange, projectId, snapshotId, testType, testRunId, scenarioId]);
}
