import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchCoverageDashboardData } from "./useCoverageQuery.js";
import {
  getUnifiedQualityDashboard,
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
 * Fetch 100% real data across Unified Aggregation API + Unit, Integration, and System testing layers in parallel.
 */
export async function fetchAllTestingLayers({ snapshotId, projectId }) {
  if (!snapshotId) {
    return {
      unifiedBackendRaw: null,
      unitRaw: null,
      integrationRaw: null,
      systemRaw: null,
      comparisonRaw: null,
      errorsByLayer: { unit: null, integration: null, system: null },
    };
  }

  const errorsByLayer = { unit: null, integration: null, system: null };

  // FAST PATH: Single unified endpoint returns aggregated data across all 3 tiers in < 300ms
  try {
    const unifiedRes = await getUnifiedQualityDashboard(snapshotId);
    if (unifiedRes?.data) {
      return {
        unifiedBackendRaw: unifiedRes.data,
        unitRaw: null,
        integrationRaw: null,
        systemRaw: null,
        comparisonRaw: null,
        errorsByLayer,
      };
    }
  } catch (err) {
    console.warn("[useUnifiedDashboard] Unified quality endpoint unavailable, falling back to multi-layer fetch:", err.message);
  }

  // FALLBACK PATH: If unified aggregation endpoint is unavailable, fan out to legacy individual endpoints
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
    unifiedBackendRaw: null,
    unitRaw: unitRes,
    integrationRaw: intWorkspaceRes,
    systemRaw: sysSummaryRes,
    comparisonRaw: comparisonRes,
    errorsByLayer,
  };
}

const EMPTY_SNAPSHOTS = [];

/**
 * React Query Hook for Unified Quality & Testing Dashboard (100% Real Data).
 */
export function useUnifiedDashboard({
  snapshotId,
  projectId,
  projectName = "",
  snapshots = EMPTY_SNAPSHOTS,
}) {
  const effectiveSnapshotId = snapshotId || snapshots[0]?.id || "";

  const query = useQuery({
    queryKey: ["unifiedDashboard", effectiveSnapshotId, projectId || null],
    queryFn: () => fetchAllTestingLayers({ snapshotId: effectiveSnapshotId, projectId }),
    enabled: Boolean(effectiveSnapshotId),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000, // 2 minutes cache freshness
    gcTime: 30 * 60 * 1000,
  });

  const vm = useMemo(() => {
    if (!effectiveSnapshotId) {
      return adaptUnifiedDashboard({
        context: {
          projectId,
          projectName,
          snapshotId: "",
          snapshots,
        },
      });
    }

    if (!query.data && query.isLoading) {
      return null;
    }

    return adaptUnifiedDashboard({
      unifiedBackendRaw: query.data?.unifiedBackendRaw || null,
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
    });
  }, [
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
    isLoading: Boolean(effectiveSnapshotId) ? query.isLoading : false,
    isFetching: Boolean(effectiveSnapshotId) ? query.isFetching : false,
    isError: Boolean(effectiveSnapshotId) ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useUnifiedDashboard;
