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

const recentLocalMutations = new Map();

function getMutationEntry(vcMode, projectId) {
  const key = `${vcMode || "none"}:${projectId}`;
  let entry = recentLocalMutations.get(key);
  if (!entry) {
    entry = { inFlight: 0, lastAt: 0 };
    recentLocalMutations.set(key, entry);
  }
  return { key, entry };
}

export function beginLocalVcsMutation(vcMode, projectId) {
  if (!projectId) return () => {};
  const { entry } = getMutationEntry(vcMode, projectId);
  entry.inFlight += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    entry.inFlight = Math.max(0, entry.inFlight - 1);
    entry.lastAt = Date.now();
  };
}

export function markLocalVcsMutation(vcMode, projectId) {
  if (!projectId) return;
  const { entry } = getMutationEntry(vcMode, projectId);
  entry.lastAt = Date.now();
}

export function isLocalVcsEchoSuppressed(vcMode, projectId, windowMs = 900) {
  if (!projectId) return false;
  const key = `${vcMode || "none"}:${projectId}`;
  const entry = recentLocalMutations.get(key);
  if (!entry) return false;
  if (entry.inFlight > 0) return true;
  if (entry.lastAt && Date.now() - entry.lastAt <= windowMs) return true;
  recentLocalMutations.delete(key);
  return false;
}

export function vcsSummaryQueryKey(vcMode, projectId) {
  return ["vcsSummary", vcMode || "none", projectId || "none"];
}

export function useVcsSync(projectId) {
  const { vcMode, isAuthenticated, user } = useAuth();
  const currentUserId = user?.id || null;
  const [activeOperation, setActiveOperation] = useState(null);
  const debounceTimerRef = useRef(null);
  const clearOpTimerRef = useRef(null);
  const lastWorkspaceEventRef = useRef({ key: "", at: 0 });

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
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    queryClient
      .invalidateQueries({
        queryKey: vcsSummaryQueryKey(vcMode, projectId),
        cancelRefetch: false,
      })
      .catch((err) => {
        console.warn("[useVcsSync] Immediate invalidation failed:", err);
      });
  }, [vcMode, projectId]);

  const beginLocalMutation = useCallback(
    () => beginLocalVcsMutation(vcMode, projectId),
    [vcMode, projectId],
  );

  const applyStatusData = useCallback(
    (nextStatus, { suppressEcho = true } = {}) => {
      if (!projectId || !nextStatus || typeof nextStatus !== "object") return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (suppressEcho) {
        markLocalVcsMutation(vcMode, projectId);
      }
      queryClient.setQueryData(vcsSummaryQueryKey(vcMode, projectId), nextStatus);
    },
    [vcMode, projectId],
  );

  const updateStatusOptimistic = useCallback(
    async (updater) => {
      if (!projectId || typeof updater !== "function") return () => {};
      const key = vcsSummaryQueryKey(vcMode, projectId);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      markLocalVcsMutation(vcMode, projectId);
      queryClient.setQueryData(key, (curr) => (curr ? updater(curr) : curr));
      return () => {
        queryClient.setQueryData(key, previous);
      };
    },
    [vcMode, projectId],
  );

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
        const actorId = detail.payload?.actorId || null;
        const isSelfEcho = !actorId || (currentUserId && actorId === currentUserId);
        if (!(isSelfEcho && isLocalVcsEchoSuppressed(vcMode, projectId))) {
          scheduleRefresh(150);
        }
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

      const payload = detail.payload || {};
      if (payload.workspaceChanged) {
        const updatedList = Array.isArray(payload.updatedFiles)
          ? payload.updatedFiles
          : [];
        const dedupeKey = `${projectId}:${payload.workspaceRevision ?? ""}:${payload.headOid ?? ""}:${updatedList.join(",")}`;
        const now = Date.now();
        if (
          lastWorkspaceEventRef.current.key !== dedupeKey ||
          now - lastWorkspaceEventRef.current.at > 1500
        ) {
          lastWorkspaceEventRef.current = { key: dedupeKey, at: now };
          window.dispatchEvent(
            new CustomEvent("covai:vcs-workspace-changed", {
              detail: {
                projectId,
                headOid: payload.headOid || null,
                branch: payload.branch || null,
                updatedFiles: updatedList,
                workspaceRevision: payload.workspaceRevision ?? null,
                source: "socket",
              },
            }),
          );
        }
      }

      const actorId = payload.actorId || null;
      const isSelfEcho = !actorId || (currentUserId && actorId === currentUserId);
      if (isSelfEcho && isLocalVcsEchoSuppressed(vcMode, projectId)) {
        return;
      }

      scheduleRefresh(200);
    };

    const handleProjectEvent = (evt) => {
      const detail = evt?.detail;
      if (!detail || detail.projectId !== projectId) return;
      if (/file|workspace|snapshot/i.test(detail.type || "")) {
        const actorId = detail.actorId || null;
        const isSelfEcho = !actorId || (currentUserId && actorId === currentUserId);
        if (isSelfEcho && isLocalVcsEchoSuppressed(vcMode, projectId)) {
          return;
        }
        scheduleRefresh(300);
      }
    };

    const handleWorkspaceSaved = (evt) => {
      const detail = evt?.detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      // Never suppress genuine workspace editor saves with VCS echo suppression
      scheduleRefresh(200);
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
  }, [enabled, projectId, vcMode, currentUserId, scheduleRefresh]);

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
    beginLocalMutation,
    applyStatusData,
    updateStatusOptimistic,
  };
}
