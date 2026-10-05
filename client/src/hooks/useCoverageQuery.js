import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  getCoverageFiles,
  getCoverageFrameworks,
  getCoverageFunctions,
  getCoverageSummary,
  getCoverageTestSuites,
  getTestExecution,
  getFileCoverage,
  getIntegrationWorkspace,
} from "../services/coverage.service.js";
import { getProjectCfgApi, getProjectsApi, getProjectTreeApi } from "../services/project.service.js";
import { queryClient } from "../lib/queryClient.js";

/**
 * Fetch all coverage data for a given snapshot and coverage type in parallel.
 */
export async function fetchCoverageDashboardData({ snapshotId, type, projectId }) {
  if (!snapshotId) return null;

  const promises = [
    getCoverageSummary(snapshotId, type).catch(() => ({ data: null })),
    getCoverageFiles(snapshotId, {
      sortBy: "linesPct",
      order: "asc",
      limit: 200,
      type,
    }).catch(() => ({ data: { files: [] } })),
    getTestExecution(snapshotId).catch(() => ({ data: {} })),
    getCoverageFrameworks(snapshotId).catch(() => ({ data: null })),
  ];

  if (type === "unit") {
    promises.push(
      getCoverageFunctions(snapshotId, {
        limit: 500,
        sortBy: "hit",
        order: "asc",
        type,
      }).catch(() => ({ data: { functions: [] } })),
      getCoverageTestSuites(snapshotId, type).catch(() => ({ data: { testSuites: [] } }))
    );
  }

  const results = await Promise.all(promises);
  const [summaryRes, filesRes, execRes, frameworksRes, funcsRes, suitesRes] = results;

  let mergedFiles = filesRes?.data?.files || [];
  if (type === "integration" && projectId) {
    try {
      const cfgRes = await getProjectCfgApi(projectId, snapshotId);
      const cfgs = cfgRes?.data || [];
      const uniquePaths = [...new Set(cfgs.map((c) => c.filePath))];
      const existingPaths = new Set(mergedFiles.map((f) => f.filePath));
      for (const filePath of uniquePaths) {
        if (!existingPaths.has(filePath)) {
          mergedFiles.push({
            filePath,
            linesPct: 0,
            branchesPct: 0,
            funcsPct: 0,
            stmtsPct: 0,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to fetch CFG for source files in integration view", e);
    }
  }

  return {
    summary: summaryRes?.data || null,
    files: mergedFiles,
    executions: execRes?.data || {},
    frameworks: frameworksRes?.data || null,
    functionsList: funcsRes?.data?.functions || [],
    testSuites: suitesRes?.data?.testSuites || [],
    fetchedAt: Date.now(),
  };
}

/**
 * React Query hook for coverage dashboard data (Unit, Integration, System).
 * Automatically caches results, provides instant render on tab/page switch,
 * and maintains previous data during background refreshes.
 */
export function useCoverageDashboard(snapshotId, type, projectId) {
  return useQuery({
    queryKey: ["coverageDashboard", snapshotId, type, projectId || null],
    queryFn: () => fetchCoverageDashboardData({ snapshotId, type, projectId }),
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000, // 10 minutes cache freshness
    gcTime: 60 * 60 * 1000,    // 1 hour in memory
  });
}

/**
 * React Query hook for single file coverage & AST details.
 */
export function useFileCoverage(snapshotId, filePath) {
  return useQuery({
    queryKey: ["fileCoverage", snapshotId, filePath],
    queryFn: async () => {
      const res = await getFileCoverage(snapshotId, filePath);
      return res?.data || null;
    },
    enabled: Boolean(snapshotId && filePath),
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * React Query hook for Integration Workspace.
 */
export function useIntegrationWorkspace(snapshotId) {
  return useQuery({
    queryKey: ["integrationWorkspace", snapshotId],
    queryFn: async () => {
      const res = await getIntegrationWorkspace(snapshotId);
      return res?.data || null;
    },
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Invalidate all coverage-related queries when tests or analysis finish.
 */
export function invalidateCoverageQueries(snapshotId = null) {
  if (snapshotId) {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || key.length < 2) return false;
        const [domain, snap] = key;
        return (
          (domain === "coverageDashboard" ||
            domain === "fileCoverage" ||
            domain === "integrationWorkspace") &&
          snap === snapshotId
        );
      },
    });
  } else {
    queryClient.invalidateQueries({ queryKey: ["coverageDashboard"] });
    queryClient.invalidateQueries({ queryKey: ["fileCoverage"] });
    queryClient.invalidateQueries({ queryKey: ["integrationWorkspace"] });
  }
}

/**
 * Optimistically updates the CoverageFile percentages in query data for affected source files
 * so the dashboard table updates immediately without waiting for a full re-fetch.
 */
export function updateCoverageFilesData(snapshotId, type, projectId, perFileResults) {
  if (!snapshotId || !perFileResults || typeof perFileResults !== "object") return;

  queryClient.setQueriesData(
    {
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "coverageDashboard" && key[1] === snapshotId;
      }
    },
    (oldData) => {
      if (!oldData || !Array.isArray(oldData.files)) return oldData;
      const updatedFiles = oldData.files.map((file) => {
        let matchRes = perFileResults[file.filePath];
        if (!matchRes) {
          const normFile = (file.filePath || "").replace(/\\/g, "/");
          for (const [k, v] of Object.entries(perFileResults)) {
            const normK = k.replace(/\\/g, "/");
            if (normK === normFile || normK.endsWith("/" + normFile) || normFile.endsWith("/" + normK)) {
              matchRes = v;
              break;
            }
          }
        }

        if (matchRes && matchRes.newCoverage) {
          return {
            ...file,
            linesPct: matchRes.newCoverage.lines,
            branchesPct: matchRes.newCoverage.branches,
            funcsPct: matchRes.newCoverage.functions,
            stmtsPct: matchRes.newCoverage.statements,
          };
        }
        return file;
      });

      return {
        ...oldData,
        files: updatedFiles,
      };
    }
  );
}

/**
 * React Query hook for Project list.
 */
export function useProjectsQuery() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await getProjectsApi();
      return res?.projects || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * React Query hook for Project file tree.
 */
export function useProjectTreeQuery(projectId) {
  return useQuery({
    queryKey: ["projectTree", projectId],
    queryFn: async () => {
      const res = await getProjectTreeApi(projectId);
      return res?.data || [];
    },
    enabled: Boolean(projectId),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
