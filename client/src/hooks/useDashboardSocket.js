import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { queryClient } from "../lib/queryClient";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

/**
 * useDashboardSocket - Real-time Socket.IO telemetry for Unified Dashboard.
 * Listens to:
 * 1. 'dashboard:metrics-updated' -> automatically invalidates unified quality dashboard query.
 * 2. 'dashboard:run-status' -> updates active background runs state across Unit, Integration, System layers.
 * 3. 'dashboard:job-progress' -> streams live percentage and stage info.
 */
export function useDashboardSocket({
  projectId,
  snapshotId,
  onRunStatus = null,
  onJobProgress = null,
  onMetricsUpdated = null,
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [liveRuns, setLiveRuns] = useState({}); // { [jobId]: { jobId, snapshotId, pillar, status, progress, stage } }

  const callbacksRef = useRef({ onRunStatus, onJobProgress, onMetricsUpdated });
  useEffect(() => {
    callbacksRef.current = { onRunStatus, onJobProgress, onMetricsUpdated };
  }, [onRunStatus, onJobProgress, onMetricsUpdated]);

  const invalidateTimeoutRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;

    let alive = true;
    const token = localStorage.getItem("token") || "";

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      if (!alive) return;
      setIsConnected(true);
      socket.emit("project:subscribe", { projectId });
    });

    socket.on("disconnect", () => {
      if (!alive) return;
      setIsConnected(false);
    });

    // 1. Metrics updated event -> Invalidate React Query (debounced 300ms)
    socket.on("dashboard:metrics-updated", (payload) => {
      if (!alive) return;
      if (snapshotId && payload.snapshotId && payload.snapshotId !== snapshotId) {
        return;
      }

      if (payload?.lifecycleStatus) {
        queryClient.setQueriesData({ queryKey: ["projects"] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((p) =>
            p.id === projectId ? { ...p, lifecycleStatus: payload.lifecycleStatus } : p
          );
        });
        window.dispatchEvent(
          new CustomEvent("covai:project-status-updated", {
            detail: { projectId, lifecycleStatus: payload.lifecycleStatus },
          })
        );
      }

      if (invalidateTimeoutRef.current) clearTimeout(invalidateTimeoutRef.current);
      invalidateTimeoutRef.current = setTimeout(() => {
        if (!alive) return;
        queryClient
          .invalidateQueries({
            predicate: (query) =>
              query.queryKey.includes(projectId) ||
              query.queryKey.includes(snapshotId) ||
              (query.queryKey[0] === "unifiedDashboard" && query.queryKey[1] === snapshotId) ||
              query.queryKey[0] === "projects",
            cancelRefetch: false,
          })
          .catch((err) => {
            if (err?.name !== "AbortError" && !err?.message?.includes("aborted")) {
              console.warn("[useDashboardSocket] Invalidation error:", err);
            }
          });
      }, 300);

      window.dispatchEvent(
        new CustomEvent("covai:dashboard-metrics-updated", { detail: payload })
      );
      callbacksRef.current.onMetricsUpdated?.(payload);
    });

    // 1b. Project Lifecycle updated event from portfolio or background auto-transition
    socket.on("portfolio:project_updated", (payload) => {
      if (!alive) return;
      const targetPid = payload?.projectId || projectId;
      if (payload?.lifecycleStatus !== undefined) {
        queryClient.setQueriesData({ queryKey: ["projects"] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((p) =>
            p.id === targetPid ? { ...p, lifecycleStatus: payload.lifecycleStatus } : p
          );
        });
        window.dispatchEvent(
          new CustomEvent("covai:project-status-updated", {
            detail: {
              projectId: targetPid,
              lifecycleStatus: payload.lifecycleStatus,
              isPinned: payload.isPinned,
            },
          })
        );
      }
    });

    // 2. Run Status event (QUEUED, RUNNING, SUCCESS, FAILED, CANCELED)
    socket.on("dashboard:run-status", (payload) => {
      if (!alive) return;
      if (snapshotId && payload.snapshotId && payload.snapshotId !== snapshotId) {
        return;
      }

      const { jobId, status } = payload;
      if (jobId) {
        setLiveRuns((prev) => {
          const current = prev[jobId] || {};
          const nextRun = { ...current, ...payload };

          if (["SUCCESS", "FAILED", "CANCELED"].includes(status)) {
            // Schedule cleanup after 2.5 seconds
            setTimeout(() => {
              if (!alive) return;
              setLiveRuns((curr) => {
                const updated = { ...curr };
                delete updated[jobId];
                return updated;
              });
            }, 2500);
          }

          return { ...prev, [jobId]: nextRun };
        });
      }

      window.dispatchEvent(
        new CustomEvent("covai:dashboard-run-status", { detail: payload })
      );
      callbacksRef.current.onRunStatus?.(payload);
    });

    // 3. Job Progress event
    socket.on("dashboard:job-progress", (payload) => {
      if (!alive) return;
      if (snapshotId && payload.snapshotId && payload.snapshotId !== snapshotId) {
        return;
      }

      const { jobId } = payload;
      if (jobId) {
        setLiveRuns((prev) => {
          const current = prev[jobId] || {};
          return {
            ...prev,
            [jobId]: {
              ...current,
              ...payload,
              progress: payload.progress ?? current.progress ?? 0,
              stage: payload.stage ?? current.stage ?? "",
            },
          };
        });
      }

      window.dispatchEvent(
        new CustomEvent("covai:dashboard-job-progress", { detail: payload })
      );
      callbacksRef.current.onJobProgress?.(payload);
    });

    return () => {
      alive = false;
      if (invalidateTimeoutRef.current) clearTimeout(invalidateTimeoutRef.current);
      socket.emit("project:unsubscribe", { projectId });
      socket.disconnect();
    };
  }, [projectId, snapshotId]);

  return {
    isConnected,
    liveRuns,
  };
}

export default useDashboardSocket;

