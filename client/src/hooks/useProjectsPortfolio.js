import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getProjectsApi } from "../services/project.service.js";
import { adaptPortfolioDashboard } from "../services/portfolioDashboard/portfolioDashboard.adapter.js";

/**
 * React Query Hook for Multi-Project Quality Portfolio Dashboard (Dashboard #2).
 * Supports instant toggling between Live State and mathematically reconciled Demo Showcase.
 */
export function useProjectsPortfolio({ dataMode = "live", favorites = [] } = {}) {
  const query = useQuery({
    queryKey: ["projectsPortfolio", "live"],
    queryFn: async () => {
      const res = await getProjectsApi();
      return res?.projects || [];
    },
    enabled: dataMode === "live",
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 15 * 60 * 1000,
  });

  const vm = useMemo(() => {
    if (dataMode === "demo") {
      return adaptPortfolioDashboard({
        dataMode: "demo",
        favorites,
      });
    }

    const rawProjects = query.data || [];
    return adaptPortfolioDashboard({
      rawProjects,
      perProjectSummaries: {},
      favorites,
      dataMode: "live",
    });
  }, [dataMode, query.data, favorites]);

  return {
    vm,
    isLoading: dataMode === "live" ? query.isLoading : false,
    isFetching: dataMode === "live" ? query.isFetching : false,
    isError: dataMode === "live" ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useProjectsPortfolio;

