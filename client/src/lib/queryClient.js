import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";

const isCancellationError = (error) =>
  error?.name === "AbortError" ||
  error?.code === "ERR_CANCELED" ||
  error?.message?.includes("aborted") ||
  error?.message?.includes("canceled");

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isCancellationError(error)) return;
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isCancellationError(error)) return;
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 minutes - considered fresh, avoids automatic background refetches on navigation
      gcTime: 60 * 60 * 1000,    // 1 hour - keep in memory cache
      refetchOnWindowFocus: false, // Don't refetch on switching browser tabs
      refetchOnMount: false,       // Use cached data immediately without refetching on remount
      refetchOnReconnect: false,   // Don't refetch on reconnect
      retry: (failureCount, error) => {
        if (isCancellationError(error)) return false;
        return failureCount < 1;
      },
    },
  },
});
