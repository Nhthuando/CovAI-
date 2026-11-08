import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

/**
 * Throttle helper to limit high-frequency socket events
 */
function createThrottler(delayMs = 250) {
  let lastCall = 0;
  let timeoutId = null;
  let lastArgs = null;

  return function throttle(fn, ...args) {
    const now = Date.now();
    lastArgs = args;

    if (now - lastCall >= delayMs) {
      lastCall = now;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      fn(...lastArgs);
    } else if (!timeoutId) {
      const remaining = delayMs - (now - lastCall);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (lastArgs) fn(...lastArgs);
      }, remaining);
    }
  };
}

/**
 * Custom hook for Portfolio Real-Time Socket.IO Telemetry
 */
export function usePortfolioSocket(userId) {
  const queryClient = useQueryClient();
  const throttleMapRef = useRef(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const throttleMap = throttleMapRef.current;

    let token = localStorage.getItem("token");
    try {
      token ||= JSON.parse(localStorage.getItem("user") || "null")?.token;
    } catch {
      // ignore
    }

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("subscribe_notifications", userId);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // 1. Run Started
    socket.on("portfolio:run_started", (payload) => {
      const { projectId, jobId, jobType, pillar, startedAt } = payload || {};
      if (!projectId) return;

      queryClient.setQueryData(["projectsPortfolio", "live"], (old) => {
        if (!old) return old;
        const updatedProjects = (old.projects || []).map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              activeJob: {
                id: jobId,
                type: jobType,
                pillar,
                status: "RUNNING",
                progress: 0,
                startedAt: startedAt || new Date().toISOString(),
              },
            };
          }
          return p;
        });

        const runnerInfra = { ...old.runnerInfrastructure };
        if (runnerInfra) {
          runnerInfra.runningJobsCount = (runnerInfra.runningJobsCount || 0) + 1;
        }

        return {
          ...old,
          projects: updatedProjects,
          runnerInfrastructure: runnerInfra,
        };
      });
    });

    // 2. Run Progress (Throttled at 250ms per project)
    socket.on("portfolio:run_progress", (payload) => {
      const { projectId, jobId, progress, elapsedMs, activeWorkers, queuedJobs } = payload || {};
      if (!projectId) return;

      if (!throttleMapRef.current.has(projectId)) {
        throttleMapRef.current.set(projectId, createThrottler(250));
      }
      const throttledUpdate = throttleMapRef.current.get(projectId);

      throttledUpdate(() => {
        queryClient.setQueryData(["projectsPortfolio", "live"], (old) => {
          if (!old) return old;
          const updatedProjects = (old.projects || []).map((p) => {
            if (p.id === projectId && p.activeJob) {
              return {
                ...p,
                activeJob: {
                  ...p.activeJob,
                  id: jobId || p.activeJob.id,
                  progress: typeof progress === 'number' ? progress : p.activeJob.progress,
                  elapsedMs: elapsedMs ?? p.activeJob.elapsedMs,
                },
              };
            }
            return p;
          });

          const runnerInfra = old.runnerInfrastructure
            ? {
                ...old.runnerInfrastructure,
                ...(activeWorkers !== undefined && { activeWorkers }),
                ...(queuedJobs !== undefined && { queuedJobsCount: queuedJobs }),
              }
            : old.runnerInfrastructure;

          return {
            ...old,
            projects: updatedProjects,
            runnerInfrastructure: runnerInfra,
          };
        });
      });
    });

    // 3. Run Completed
    socket.on("portfolio:run_completed", (payload) => {
      const { projectId, newFeedItem } = payload || {};

      // If feed item is provided, optimistically prepend to feed
      if (newFeedItem) {
        queryClient.setQueryData(["projectsPortfolio", "live"], (old) => {
          if (!old) return old;
          const activityFeed = [newFeedItem, ...(old.activityFeed || [])].slice(0, 30);
          const updatedProjects = (old.projects || []).map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                activeJob: null,
              };
            }
            return p;
          });
          return {
            ...old,
            projects: updatedProjects,
            activityFeed,
          };
        });
      }

      // Re-synchronize full portfolio and unified dashboard state from server
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
        queryClient.invalidateQueries({ queryKey: ["unifiedDashboard"] });
      }, 300);
    });

    // 4. Project Updated (Lifecycle status, Pinned state, etc.)
    socket.on("portfolio:project_updated", (payload) => {
      const { projectId, lifecycleStatus, isPinned } = payload || {};

      queryClient.setQueryData(["projectsPortfolio", "live"], (old) => {
        if (!old) return old;
        const updatedProjects = (old.projects || []).map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              ...(lifecycleStatus !== undefined && { lifecycleStatus }),
              ...(isPinned !== undefined && { isPinned }),
            };
          }
          return p;
        });
        return {
          ...old,
          projects: updatedProjects,
        };
      });

      // Synchronize with general projects cache used by Layout.jsx
      queryClient.setQueriesData({ queryKey: ["projects"] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              ...(lifecycleStatus !== undefined && { lifecycleStatus }),
              ...(isPinned !== undefined && { isPinned }),
            };
          }
          return p;
        });
      });

      if (projectId && lifecycleStatus !== undefined) {
        window.dispatchEvent(
          new CustomEvent("covai:project-status-updated", {
            detail: { projectId, lifecycleStatus, isPinned },
          })
        );
      }

      // Refetch whole portfolio to update executive KPIs and strict aggregations
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["unifiedDashboard"] });
      }, 200);
    });

    // 5. Cross-dashboard metrics updated (e.g. from individual test workspaces or Single-Project Overview)
    socket.on("dashboard:metrics-updated", () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
      }, 250);
    });

    return () => {
      socket.disconnect();
      throttleMap.clear();
    };
  }, [userId, queryClient]);

  return { isConnected };
}

export default usePortfolioSocket;

