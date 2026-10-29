import { useMemo } from "react";
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
export async function fetchAllTestingLayers({ snapshotId, projectId }) {
  if (!snapshotId) {
    return {
      unitRaw: null,
      integrationRaw: null,
      systemRaw: null,
      comparisonRaw: null,
      errorsByLayer: { unit: null, integration: null, system: null },
    };
  }

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

  return {
    unitRaw: unitRes,
    integrationRaw: intWorkspaceRes,
    systemRaw: sysSummaryRes,
    comparisonRaw: comparisonRes,
    errorsByLayer,
  };
}

/**
 * React Query Hook for Unified Quality & Testing Dashboard.
 * Supports instantaneous toggling between `live` and `demo` data modes.
 */
export function useUnifiedDashboard({
  snapshotId,
  projectId,
  projectName = "",
  snapshots = [],
  dataMode = "live",
}) {
  const effectiveSnapshotId =
    snapshotId || (dataMode === "demo" ? "cmvs3749" : null);

  const query = useQuery({
    queryKey: ["unifiedDashboard", effectiveSnapshotId, projectId || null],
    queryFn: () => fetchAllTestingLayers({ snapshotId: effectiveSnapshotId, projectId }),
    enabled:
      Boolean(effectiveSnapshotId) &&
      (dataMode === "demo" || effectiveSnapshotId !== "cmvs3749") &&
      dataMode === "live",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // 5 minutes cache freshness
    gcTime: 30 * 60 * 1000,    // 30 minutes in memory
  });

  const vm = useMemo(() => {
    if (dataMode === "demo") {
      return adaptUnifiedDashboard({
        context: {
          projectId,
          projectName,
          snapshotId: effectiveSnapshotId,
          snapshots,
        },
        dataMode: "demo",
      });
    }

    if (!query.data && query.isLoading) {
      return null;
    }

    return adaptUnifiedDashboard({
      unitRaw: query.data?.unitRaw || null,
      integrationRaw: query.data?.integrationRaw || null,
      systemRaw: query.data?.systemRaw || null,
      comparisonRaw: query.data?.comparisonRaw || null,
      context: {
        projectId,
        projectName,
        snapshotId: effectiveSnapshotId,
        snapshots,
      },
      dataMode: "live",
    });
  }, [
    dataMode,
    query.data,
    query.isLoading,
    projectId,
    projectName,
    effectiveSnapshotId,
    snapshots,
  ]);

  return {
    vm,
    errorsByLayer: query.data?.errorsByLayer || { unit: null, integration: null, system: null },
    isLoading: dataMode === "live" ? query.isLoading : false,
    isFetching: dataMode === "live" ? query.isFetching : false,
    isError: dataMode === "live" ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useUnifiedDashboard;
