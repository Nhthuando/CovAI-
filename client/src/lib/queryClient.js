import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 minutes - considered fresh, avoids automatic background refetches on navigation
      gcTime: 60 * 60 * 1000,    // 1 hour - keep in memory cache
      refetchOnWindowFocus: false, // Don't refetch on switching browser tabs
      refetchOnMount: false,       // Use cached data immediately without refetching on remount
      refetchOnReconnect: false,   // Don't refetch on reconnect
      retry: 1,                    // Only retry once on failure
    },
  },
});
