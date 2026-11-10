import { useState, useRef, useCallback, useEffect } from "react";
import {
  runCoverageByType,
  getSuitesReadiness,
  installIntegrationDependencies,
  approveIntegrationScenarios,
  confirmBatchSystemScenarios
} from "../services/coverage.service.js";
import { getJobDetailApi, cancelJobApi } from "../services/job.service.js";
import { invalidateCoverageQueries } from "./useCoverageQuery.js";
import { useToast } from "../components/dashboard/ToastContext.jsx";

/**
 * Poll a background job until completion (SUCCESS, FAILED, CANCELED),
 * boosted by real-time Socket.IO window events for zero-latency completion and live % progress.
 */
async function pollJobUntilDone(jobId, stepKey, { isCancelledCheck, onProgress }) {
  let consecutiveErrors = 0;
  let finishedEarlyJob = null;
  let socketError = null;

  const onSocketRunStatus = (e) => {
    const detail = e.detail;
    if (detail && (detail.jobId === jobId || detail.pillar === stepKey)) {
      if (detail.status === "SUCCESS") {
        finishedEarlyJob = { id: jobId, status: "SUCCESS" };
      } else if (["FAILED", "CANCELED"].includes(detail.status)) {
        socketError = new Error(`${detail.status}: suite execution failed.`);
      }
    }
  };

  const onSocketProgress = (e) => {
    const detail = e.detail;
    if (detail && (detail.jobId === jobId || detail.pillar === stepKey)) {
      if (typeof detail.progress === "number") {
        onProgress?.({
          progress: detail.progress,
          stage: detail.stage || "",
          message: detail.message || detail.stage || ""
        });
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("covai:dashboard-run-status", onSocketRunStatus);
    window.addEventListener("covai:dashboard-job-progress", onSocketProgress);
  }

  try {
    for (let attempt = 0; attempt < 240; attempt += 1) { // up to 12 minutes
      if (isCancelledCheck()) {
        try {
          await cancelJobApi(jobId);
        } catch (_) {}
        const cancelErr = new Error("Suite execution cancelled by user.");
        cancelErr.isCancelled = true;
        throw cancelErr;
      }

      if (socketError) {
        throw socketError;
      }
      if (finishedEarlyJob) {
        return finishedEarlyJob;
      }

      let job = null;
      try {
        const response = await getJobDetailApi(jobId);
        job = response?.job;
        consecutiveErrors = 0;
      } catch (pollErr) {
        consecutiveErrors += 1;
        if (consecutiveErrors > 15) {
          throw new Error(pollErr?.message || "Failed to communicate with job service.");
        }
      }

      if (typeof job?.progress === "number") {
        onProgress?.({
          progress: job.progress,
          stage: job.stage || "",
          message: job.message || job.stage || ""
        });
      }

      if (job?.status === "SUCCESS") {
        return job;
      }

      if (["FAILED", "CANCELED"].includes(job?.status)) {
        throw new Error(
          job?.errorMessage || job?.error || `${job.status}: suite analysis execution failed.`
        );
      }

      // Check socket resolution during the wait in 500ms increments
      for (let s = 0; s < 4; s += 1) {
        if (finishedEarlyJob) return finishedEarlyJob;
        if (socketError) throw socketError;
        if (isCancelledCheck()) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    try {
      await cancelJobApi(jobId);
    } catch (_) {}
    throw new Error("Suite execution timed out after 12 minutes.");
  } finally {
    if (typeof window !== "undefined") {
      window.removeEventListener("covai:dashboard-run-status", onSocketRunStatus);
      window.removeEventListener("covai:dashboard-job-progress", onSocketProgress);
    }
  }
}

/**
 * Hook for multi-suite execution across Unit -> Integration -> System tests
 * with Pre-flight HITL Gate, Real-time % Progress, and Incremental Persistence.
 */
export function useRunAllSuites({
  snapshotId,
  onCompleted = null,
  initialActiveSuiteRun = undefined,
  skipInitialFetch = false,
}) {
  const { addToast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(null); // 'unit' | 'integration' | 'system' | null
  const [stepStates, setStepStates] = useState({
    unit: "idle",        // 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'skipped'
    integration: "idle",
    system: "idle",
  });

  const [stepProgress, setStepProgress] = useState({
    unit: { progress: 0, stage: "", message: "" },
    integration: { progress: 0, stage: "", message: "" },
    system: { progress: 0, stage: "", message: "" },
  });

  const [overallPercent, setOverallPercent] = useState(0);

  // Pre-flight Human-in-the-Loop Gate state
  const [readinessGate, setReadinessGate] = useState({
    isOpen: false,
    data: null,
    isChecking: false,
    loadingAction: null,
    error: null,
  });

  const isCancelledRef = useRef(false);
  const activeJobIdRef = useRef(null);

  // Calculate overall pipeline progress based on completed and currently active steps
  const recalculateOverallProgress = useCallback((activeStates, activeProgress, selectedKeys = ["unit", "integration", "system"]) => {
    const totalSuites = Math.max(1, selectedKeys.length);
    let totalCompletedPoints = 0;

    for (const key of selectedKeys) {
      const state = activeStates[key];
      if (state === "done" || state === "skipped") {
        totalCompletedPoints += 100;
      } else if (state === "running") {
        const pct = activeProgress[key]?.progress || 0;
        totalCompletedPoints += Math.min(99, Math.max(0, pct));
      }
    }

    const calculated = Math.min(100, Math.round(totalCompletedPoints / totalSuites));
    setOverallPercent(calculated);
  }, []);

  // Update progress for a single step
  const handleStepProgress = useCallback((stepKey, payload) => {
    setStepProgress((prev) => {
      const next = {
        ...prev,
        [stepKey]: {
          progress: typeof payload.progress === "number" ? payload.progress : prev[stepKey]?.progress || 0,
          stage: payload.stage || prev[stepKey]?.stage || "",
          message: payload.message || payload.stage || prev[stepKey]?.message || "",
        },
      };
      recalculateOverallProgress(stepStates, next);
      return next;
    });
  }, [recalculateOverallProgress, stepStates]);

  // Cancel running and queued suites
  const cancelRemaining = useCallback(async () => {
    isCancelledRef.current = true;
    const currentJobId = activeJobIdRef.current;
    if (currentJobId) {
      try {
        await cancelJobApi(currentJobId);
      } catch (_) {}
    }

    setStepStates((prev) => {
      const updated = { ...prev };
      for (const k of ["unit", "integration", "system"]) {
        if (updated[k] === "queued" || updated[k] === "running") {
          updated[k] = "idle";
        }
      }
      return updated;
    });

    setIsRunning(false);
    setActiveStep(null);
    activeJobIdRef.current = null;

    // Refresh whatever partial results were saved
    if (snapshotId) {
      invalidateCoverageQueries(snapshotId);
    }

    addToast({
      title: "Suite Execution Paused",
      message: "Remaining queued test suites were cancelled. All completed suite checkpoints were preserved.",
      type: "info",
    });
  }, [addToast, snapshotId]);

  // Execute pipeline for a given set of steps
  const executePipeline = useCallback(async (selectedKeys = ["unit", "integration", "system"]) => {
    if (!snapshotId) return;

    isCancelledRef.current = false;
    activeJobIdRef.current = null;
    setIsRunning(true);
    setOverallPercent(0);

    const initialStates = {
      unit: selectedKeys.includes("unit") ? "queued" : "skipped",
      integration: selectedKeys.includes("integration") ? "queued" : "skipped",
      system: selectedKeys.includes("system") ? "queued" : "skipped",
    };
    setStepStates(initialStates);

    const initialProgress = {
      unit: { progress: 0, stage: "", message: "" },
      integration: { progress: 0, stage: "", message: "" },
      system: { progress: 0, stage: "", message: "" },
    };
    setStepProgress(initialProgress);

    const steps = [
      { key: "unit", label: "Unit Tests" },
      { key: "integration", label: "Integration Tests" },
      { key: "system", label: "System (E2E) Tests" },
    ].filter((s) => selectedKeys.includes(s.key));

    let overallSuccess = true;

    for (const step of steps) {
      if (isCancelledRef.current) break;

      setActiveStep(step.key);
      setStepStates((prev) => {
        const next = { ...prev, [step.key]: "running" };
        recalculateOverallProgress(next, initialProgress, selectedKeys);
        return next;
      });

      handleStepProgress(step.key, { progress: 5, stage: `Starting ${step.label}...` });

      try {
        const response = await runCoverageByType(snapshotId, step.key);

        const jobs = Array.isArray(response?.data?.jobs) && response.data.jobs.length > 0
          ? response.data.jobs
          : response?.data?.job
            ? [response.data.job]
            : response?.job
              ? [response.job]
              : [];

        for (const j of jobs) {
          if (j?.id) {
            activeJobIdRef.current = j.id;
            await pollJobUntilDone(j.id, step.key, {
              isCancelledCheck: () => isCancelledRef.current,
              onProgress: (p) => handleStepProgress(step.key, p),
            });
          }
        }

        setStepStates((prev) => {
          const next = { ...prev, [step.key]: "done" };
          recalculateOverallProgress(next, initialProgress, selectedKeys);
          return next;
        });

        handleStepProgress(step.key, { progress: 100, stage: "Complete", message: "Suite finished" });

        // Incremental Persistence: refresh Dashboard immediately after each suite completes!
        if (snapshotId) {
          await invalidateCoverageQueries(snapshotId);
        }
      } catch (err) {
        if (err.isCancelled || isCancelledRef.current) {
          setStepStates((prev) => ({ ...prev, [step.key]: "idle" }));
          break;
        }

        console.error(`[RunAllSuites] Error executing ${step.key}:`, err);
        setStepStates((prev) => ({ ...prev, [step.key]: "failed" }));
        overallSuccess = false;
        addToast({
          title: `${step.label} Issue`,
          message: err.message || `An error occurred while executing ${step.label}.`,
          type: "warning",
        });
      } finally {
        activeJobIdRef.current = null;
      }
    }

    setIsRunning(false);
    setActiveStep(null);
    activeJobIdRef.current = null;
    setOverallPercent(100);

    if (snapshotId) {
      invalidateCoverageQueries(snapshotId);
    }

    if (overallSuccess && !isCancelledRef.current) {
      addToast({
        title: "Test Execution Completed",
        message: "Executed test suites finished and latest results refreshed.",
        type: "success",
      });
    }

    if (onCompleted) {
      onCompleted(overallSuccess);
    }
  }, [snapshotId, addToast, onCompleted, handleStepProgress, recalculateOverallProgress]);

  // Pre-flight check entry point triggered when user clicks "Run All Suites"
  const initiateRunAll = useCallback(async () => {
    if (!snapshotId || isRunning) return;

    setReadinessGate((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const res = await getSuitesReadiness(snapshotId);
      const readinessData = res?.data;

      if (readinessData?.allReady === true) {
        // All suites ready -> start pipeline immediately
        setReadinessGate({ isOpen: false, data: readinessData, isChecking: false, loadingAction: null, error: null });
        await executePipeline(["unit", "integration", "system"]);
      } else {
        // Blocker exists -> display interactive Pre-flight HITL Gate
        setReadinessGate({
          isOpen: true,
          data: readinessData,
          isChecking: false,
          loadingAction: null,
          error: null,
        });
      }
    } catch (err) {
      console.warn("[RunAllSuites] Pre-flight check failed, falling back to direct run:", err.message);
      setReadinessGate((prev) => ({ ...prev, isChecking: false }));
      // Fallback: run directly
      await executePipeline(["unit", "integration", "system"]);
    }
  }, [snapshotId, isRunning, executePipeline]);

  // Execute in-place HITL actions from Pre-flight Gate
  const resolveHitlAction = useCallback(async (action) => {
    if (!snapshotId || !action?.actionType) return;

    setReadinessGate((prev) => ({ ...prev, loadingAction: action.actionType }));

    try {
      if (action.actionType === "INSTALL_INTEGRATION_DEPS") {
        await installIntegrationDependencies(snapshotId);
        addToast({
          title: "Dependencies Installed",
          message: "supertest & jest were successfully added to package.json.",
          type: "success",
        });
      } else if (action.actionType === "APPROVE_INTEGRATION_SCENARIOS") {
        await approveIntegrationScenarios(snapshotId, { approveAll: true });
        addToast({
          title: "Scenarios Approved",
          message: "Integration scenarios have been approved and marked ready for execution.",
          type: "success",
        });
      } else if (action.actionType === "CONFIRM_SYSTEM_OUTCOMES") {
        await confirmBatchSystemScenarios(snapshotId);
        addToast({
          title: "Outcomes Confirmed",
          message: "System scenario expected outcomes confirmed.",
          type: "success",
        });
      }

      // Re-check readiness after performing action
      const refreshed = await getSuitesReadiness(snapshotId);
      setReadinessGate({
        isOpen: true,
        data: refreshed?.data,
        isChecking: false,
        loadingAction: null,
        error: null,
      });

      if (refreshed?.data?.allReady) {
        addToast({
          title: "All Suites Ready",
          message: "All 3 test suites now satisfy pre-flight readiness checks.",
          type: "success",
        });
      }
    } catch (err) {
      console.error("[RunAllSuites] HITL Action failed:", err);
      setReadinessGate((prev) => ({
        ...prev,
        loadingAction: null,
        error: err.message || "Action could not be completed.",
      }));
      addToast({
        title: "Action Failed",
        message: err.message || "Failed to resolve pre-condition.",
        type: "error",
      });
    }
  }, [snapshotId, addToast]);

  // Run only ready suites (skipping blocked ones)
  const runReadySuitesOnly = useCallback(async () => {
    const suites = readinessGate.data?.suites;
    if (!suites) {
      setReadinessGate((prev) => ({ ...prev, isOpen: false }));
      await executePipeline(["unit", "integration", "system"]);
      return;
    }

    const readyKeys = [];
    if (suites.unit?.readyForExecution) readyKeys.push("unit");
    if (suites.integration?.readyForExecution) readyKeys.push("integration");
    if (suites.system?.readyForExecution) readyKeys.push("system");

    setReadinessGate((prev) => ({ ...prev, isOpen: false }));

    if (readyKeys.length === 0) {
      addToast({
        title: "No Suites Ready",
        message: "None of the test suites meet the readiness pre-conditions. Please resolve the blockers first.",
        type: "warning",
      });
      return;
    }

    await executePipeline(readyKeys);
  }, [readinessGate.data, executePipeline, addToast]);

  const closeReadinessGate = useCallback(() => {
    setReadinessGate((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // F5 Reload & Network Reconnection Recovery
  useEffect(() => {
    if (!snapshotId) return;

    let isMounted = true;

    const attachToActiveRun = (activeRun) => {
      if (!isMounted || !activeRun) return;
      if (activeRun.status !== "RUNNING" && activeRun.status !== "QUEUED") return;
      if (activeJobIdRef.current === activeRun.jobId && isRunning) return;

      setIsRunning(true);
      const pillar = activeRun.pillar || "unit";
      setActiveStep(pillar);
      setStepStates((prev) => ({ ...prev, [pillar]: "running" }));
      setStepProgress((prev) => ({
        ...prev,
        [pillar]: {
          progress: activeRun.progress || 10,
          stage: activeRun.stage || "Resuming execution...",
          message: "Reconnected to active background run",
        },
      }));
      activeJobIdRef.current = activeRun.jobId;

      pollJobUntilDone(activeRun.jobId, pillar, {
        isCancelledCheck: () => isCancelledRef.current,
        onProgress: (p) => handleStepProgress(pillar, p),
      })
        .then(() => {
          if (isMounted) {
            setStepStates((prev) => ({ ...prev, [pillar]: "done" }));
            setIsRunning(false);
            setActiveStep(null);
            invalidateCoverageQueries(snapshotId);
          }
        })
        .catch(() => {
          if (isMounted) {
            setIsRunning(false);
            setActiveStep(null);
          }
        });
    };

    if (initialActiveSuiteRun !== undefined) {
      if (initialActiveSuiteRun) {
        attachToActiveRun(initialActiveSuiteRun);
      }
      return () => {
        isMounted = false;
      };
    }

    if (skipInitialFetch) {
      return () => {
        isMounted = false;
      };
    }

    getSuitesReadiness(snapshotId)
      .then((res) => {
        if (!isMounted) return;
        attachToActiveRun(res?.data?.activeSuiteRun);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [snapshotId, initialActiveSuiteRun, skipInitialFetch, handleStepProgress, isRunning]);

  return {
    runAll: initiateRunAll,
    initiateRunAll,
    executePipeline,
    isRunning,
    activeStep,
    stepStates,
    stepProgress,
    overallPercent,
    readinessGate,
    resolveHitlAction,
    runReadySuitesOnly,
    closeReadinessGate,
    cancelRemaining,
  };
}

export default useRunAllSuites;
