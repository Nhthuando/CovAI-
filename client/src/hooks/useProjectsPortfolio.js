import { useMemo, useRef, useCallback } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getPortfolioOverviewApi } from "../services/portfolio.service.js";
import { adaptPortfolioDashboard } from "../services/portfolioDashboard/portfolioDashboard.adapter.js";
import { usePortfolioSocket } from "./usePortfolioSocket.js";
import { useAuth } from "./useAuth.js";

/**
 * React Query Hook for Multi-Project Quality Portfolio Dashboard (Dashboard #2).
 * Operates exclusively on real verified PostgreSQL data and real-time Socket.IO telemetry.
 */
export function useProjectsPortfolio({ favorites = [] } = {}) {
  const { user } = useAuth();
  const userId = user?.id;

  // Real-time Socket.IO listener for live run progress, project updates, and infrastructure telemetry
  const { isConnected: isSocketConnected } = usePortfolioSocket(userId);
  const isForceRefreshingRef = useRef(false);

  const query = useQuery({
    queryKey: ["projectsPortfolio", "live"],
    queryFn: async () => {
      const isRefresh = isForceRefreshingRef.current;
      isForceRefreshingRef.current = false;
      try {
        const res = await getPortfolioOverviewApi({ refresh: isRefresh });
        return res?.data || res || null;
      } catch (err) {
        console.error("[Portfolio] Failed to load portfolio overview:", err);
        throw err;
      }
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    gcTime: 15 * 60 * 1000,
  });

  const forceRefresh = useCallback(async () => {
    isForceRefreshingRef.current = true;
    try {
      return await query.refetch();
    } finally {
      isForceRefreshingRef.current = false;
    }
  }, [query]);

  const vm = useMemo(() => {
    const rawData = query.data;
    const liveOverviewData = rawData?.data || rawData;
    if (liveOverviewData && Array.isArray(liveOverviewData.projects)) {
      return adaptPortfolioDashboard({
        liveOverviewData,
        favorites,
      });
    }

    return adaptPortfolioDashboard({
      rawProjects: [],
      perProjectSummaries: {},
      favorites,
    });
  }, [query.data, favorites]);

  return {
    vm,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    forceRefresh,
    isSocketConnected,
  };
}

export default useProjectsPortfolio;
