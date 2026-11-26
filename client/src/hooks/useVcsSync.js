import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { gitService } from "../services/git.service";
import { snapshotVcsService } from "../services/snapshotVcs.service";
import { buildVcsSummary } from "../services/vcsUiHelpers";
import { VC_MODES } from "../../../shared/versionControlMode.js";
import { GIT_SOCKET_EVENTS } from "../../../shared/gitProtocol.js";
import { SNAPSHOT_SOCKET_EVENTS } from "../../../shared/snapshotVcsProtocol.js";
import { queryClient } from "../lib/queryClient";

export function vcsSummaryQueryKey(vcMode, projectId) {
  return ["vcsSummary", vcMode || "none", projectId || "none"];
}

export function useVcsSync(projectId) {
  const { vcMode, isAuthenticated } = useAuth();
  const [activeOperation, setActiveOperation] = useState(null);
  const debounceTimerRef = useRef(null);
  const clearOpTimerRef = useRef(null);

  const enabled = Boolean(isAuthenticated && projectId && vcMode);

  const query = useQuery({
    queryKey: vcsSummaryQueryKey(vcMode, projectId),
    queryFn: async () => {
      if (vcMode === VC_MODES.GIT_GITHUB) {
        const res = await gitService.getStatus(projectId);
        return res?.data || null;
      }
      const res = await snapshotVcsService.getStatus(projectId);
      return res?.data || null;
    },
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, err) => {
      if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const scheduleRefresh = useCallback(
    (delayMs = 300) => {
      if (!enabled) return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        queryClient
          .invalidateQueries({
            queryKey: vcsSummaryQueryKey(vcMode, projectId),
            cancelRefetch: false,
          })
          .catch((err) => {
            console.warn("[useVcsSync] Failed to invalidate summary:", err);
          });
      }, delayMs);
    },
    [enabled, vcMode, projectId],
  );

  const invalidateAll = useCallback(() => {
    if (!projectId) return;
    queryClient
      .invalidateQueries({
        queryKey: vcsSummaryQueryKey(vcMode, projectId),
        cancelRefetch: false,
      })
      .catch((err) => {
        console.warn("[useVcsSync] Immediate invalidation failed:", err);
      });
  }, [vcMode, projectId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleVcsEvent = (evt) => {
      const detail = evt?.detail;
      if (!detail || detail.projectId !== projectId) return;

      if (detail.event === GIT_SOCKET_EVENTS.OPERATION_PROGRESS) {
        if (clearOpTimerRef.current) {
          clearTimeout(clearOpTimerRef.current);
          clearOpTimerRef.current = null;
        }
        setActiveOperation({
          operation: detail.payload?.operation || "git",
          phase: detail.payload?.phase || "running",
          message: detail.payload?.message || "Running Git operation...",
          timestamp: Date.now(),
        });
        return;
      }

      if (detail.event === GIT_SOCKET_EVENTS.OPERATION_COMPLETED) {
        setActiveOperation({
          operation: detail.payload?.operation || "git",
          phase: "completed",
          message: detail.payload?.message || "Operation completed",
          timestamp: Date.now(),
        });
        if (clearOpTimerRef.current) clearTimeout(clearOpTimerRef.current);
        clearOpTimerRef.current = setTimeout(() => {
          setActiveOperation(null);
        }, 2500);
        scheduleRefresh(150);
        return;
      }

      if (detail.event === SNAPSHOT_SOCKET_EVENTS.GC_COMPLETED) {
        setActiveOperation({
          operation: "gc",
          phase: "completed",
          message: `Storage GC freed ${detail.payload?.freedBytes || 0} bytes`,
          timestamp: Date.now(),
        });
        if (clearOpTimerRef.current) clearTimeout(clearOpTimerRef.current);
        clearOpTimerRef.current = setTimeout(() => {
          setActiveOperation(null);
        }, 3000);
        scheduleRefresh(150);
        return;
      }

      scheduleRefresh(200);
    };

    const handleProjectEvent = (evt) => {
      const detail = evt?.detail;
      if (!detail || detail.projectId !== projectId) return;
      if (/file|workspace|snapshot/i.test(detail.type || "")) {
        scheduleRefresh(300);
      }
    };

    const handleWorkspaceSaved = (evt) => {
      const detail = evt?.detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      scheduleRefresh(300);
    };

    window.addEventListener("covai:vcs-event", handleVcsEvent);
    window.addEventListener("covai:project-event", handleProjectEvent);
    window.addEventListener("covai:workspace-saved", handleWorkspaceSaved);

    return () => {
      window.removeEventListener("covai:vcs-event", handleVcsEvent);
      window.removeEventListener("covai:project-event", handleProjectEvent);
      window.removeEventListener("covai:workspace-saved", handleWorkspaceSaved);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (clearOpTimerRef.current) clearTimeout(clearOpTimerRef.current);
    };
  }, [enabled, projectId, scheduleRefresh]);

  const summary = useMemo(
    () => buildVcsSummary(vcMode, query.data),
    [vcMode, query.data],
  );

  return {
    ...summary,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error || null,
    activeOperation,
    refetch: query.refetch,
    invalidateAll,
  };
}
