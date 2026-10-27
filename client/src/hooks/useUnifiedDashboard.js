import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchCoverageDashboardData } from "./useCoverageQuery.js";
import {
  getIntegrationWorkspace,
  getCoverageSummary,
  getBeforeAfterComparison,
} from "../services/coverage.service.js";
import {
  getSystemTestSummary,
  getSystemTestScenarios,
} from "../services/systemTest.service.js";
import { adaptUnifiedDashboard } from "../services/unifiedDashboard/unifiedDashboard.adapter.js";

/**
 * Fetch raw data across Unit, Integration, and System testing layers in parallel.
 */
export async function fetchAllTestingLayers({ snapshotId, projectId, projectName = "", snapshots = [] }) {
  if (!snapshotId) return null;

  const errorsByLayer = { unit: null, integration: null, system: null };

  const [unitRes, intWorkspaceRes, , sysSummaryRes, , comparisonRes] =
    await Promise.all([
      // 1. Unit Test Layer (re-uses shared cached queryFn)
      fetchCoverageDashboardData({ snapshotId, type: "unit", projectId }).catch((err) => {
        errorsByLayer.unit = err.message || "Failed to load unit test data";
        return null;
      }),

      // 2. Integration Workspace
      getIntegrationWorkspace(snapshotId)
        .then((res) => res?.data || null)
        .catch((err) => {
          errorsByLayer.integration = err.message || "Failed to load integration workspace";
          return null;
        }),

      // 2b. Integration Coverage Summary
      getCoverageSummary(snapshotId, "integration")
        .then((res) => res?.data || null)
        .catch(() => null),

      // 3. System Test Summary
      getSystemTestSummary(snapshotId)
        .then((res) => res?.data || null)
        .catch((err) => {
          errorsByLayer.system = err.message || "Failed to load system test summary";
          return null;
        }),

      // 3b. System Test Scenarios
      getSystemTestScenarios(snapshotId)
        .then((res) => res?.data || [])
        .catch(() => []),

      // 4. Baseline Before/After Comparison (for deltas & trends)
      projectId
        ? getBeforeAfterComparison(projectId, { snapshotId })
            .then((res) => res?.data || null)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  const vm = adaptUnifiedDashboard({
    unitRaw: unitRes,
    integrationRaw: intWorkspaceRes,
    systemRaw: sysSummaryRes,
    comparisonRaw: comparisonRes,
    context: {
      projectId,
      projectName,
      snapshotId,
      snapshots,
    },
  });

  return {
    vm,
    errorsByLayer,
  };
}

/**
 * React Query Hook for Unified Quality & Testing Dashboard.
 */
export function useUnifiedDashboard({ snapshotId, projectId, projectName = "", snapshots = [] }) {
  const query = useQuery({
    queryKey: ["unifiedDashboard", snapshotId, projectId || null],
    queryFn: () => fetchAllTestingLayers({ snapshotId, projectId, projectName, snapshots }),
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // 5 minutes cache freshness
    gcTime: 30 * 60 * 1000,    // 30 minutes in memory
  });

  return {
    vm: query.data?.vm || null,
    errorsByLayer: query.data?.errorsByLayer || { unit: null, integration: null, system: null },
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useUnifiedDashboard;
