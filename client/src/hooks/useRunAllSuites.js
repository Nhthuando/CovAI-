import { useState, useRef, useCallback } from "react";
import { runCoverageByType } from "../services/coverage.service.js";
import { getJobDetailApi, cancelJobApi } from "../services/job.service.js";
import { invalidateCoverageQueries } from "./useCoverageQuery.js";
import { useToast } from "../components/dashboard/ToastContext.jsx";

/**
 * Poll a background job until completion (SUCCESS, FAILED, CANCELED)
 */
async function pollJobUntilDone(jobId, { isCancelledCheck }) {
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) { // up to 10 minutes (400 * 1500ms)
    if (isCancelledCheck()) {
      try {
        await cancelJobApi(jobId);
      } catch (_) {}
      const cancelErr = new Error("Suite execution cancelled by user.");
      cancelErr.isCancelled = true;
      throw cancelErr;
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

    if (job?.status === "SUCCESS") {
      return job;
    }

    if (["FAILED", "CANCELED"].includes(job?.status)) {
      throw new Error(
        job?.errorMessage || job?.error || `${job.status}: suite analysis execution failed.`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  try {
    await cancelJobApi(jobId);
  } catch (_) {}
  throw new Error("Suite execution timed out after 10 minutes.");
}

/**
 * Hook for sequential multi-suite execution across Unit -> Integration -> System tests
 */
export function useRunAllSuites({ snapshotId, onCompleted = null }) {
  const { addToast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(null); // 'unit' | 'integration' | 'system' | null
  const [stepStates, setStepStates] = useState({
    unit: "idle",        // 'idle' | 'queued' | 'running' | 'done' | 'failed'
    integration: "idle",
    system: "idle",
  });

  const isCancelledRef = useRef(false);
  const activeJobIdRef = useRef(null);

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
    addToast({
      title: "Suite Execution Paused",
      message: "Active and remaining queued test suites were cancelled.",
      type: "info",
    });
  }, [addToast]);

  const runAll = useCallback(async () => {
    if (!snapshotId || isRunning) return;

    isCancelledRef.current = false;
    activeJobIdRef.current = null;
    setIsRunning(true);
    setStepStates({
      unit: "queued",
      integration: "queued",
      system: "queued",
    });

    const steps = [
      { key: "unit", label: "Unit Tests" },
      { key: "integration", label: "Integration Tests" },
      { key: "system", label: "System (E2E) Tests" },
    ];

    let overallSuccess = true;

    for (const step of steps) {
      if (isCancelledRef.current) {
        break;
      }

      setActiveStep(step.key);
      setStepStates((prev) => ({ ...prev, [step.key]: "running" }));

      try {
        const response = await runCoverageByType(snapshotId, step.key);

        // Extract all background jobs from 202 response
        const jobs = Array.isArray(response?.data?.jobs) && response.data.jobs.length > 0
          ? response.data.jobs
          : response?.data?.job
            ? [response.data.job]
            : response?.job
              ? [response.job]
              : [];

        // Sequentially wait for each job in this suite's pipeline to finish on the server
        for (const j of jobs) {
          if (j?.id) {
            activeJobIdRef.current = j.id;
            await pollJobUntilDone(j.id, {
              isCancelledCheck: () => isCancelledRef.current,
            });
          }
        }

        setStepStates((prev) => ({ ...prev, [step.key]: "done" }));
      } catch (err) {
        if (err.isCancelled || isCancelledRef.current) {
          setStepStates((prev) => ({ ...prev, [step.key]: "idle" }));
          break;
        }

        console.error(`[RunAllSuites] Error executing ${step.key}:`, err);
        setStepStates((prev) => ({ ...prev, [step.key]: "failed" }));
        overallSuccess = false;
        addToast({
          title: `${step.label} Encountered an Issue`,
          message: err.message || `An error occurred while executing ${step.label}.`,
          type: "warning",
        });
        // Continue to remaining steps so other test suites still execute
      } finally {
        activeJobIdRef.current = null;
      }
    }

    setIsRunning(false);
    setActiveStep(null);
    activeJobIdRef.current = null;

    // Invalidate caches to refresh dashboard and workspace views with real DB data
    if (snapshotId) {
      invalidateCoverageQueries(snapshotId);
    }

    if (overallSuccess && !isCancelledRef.current) {
      addToast({
        title: "Test Execution Completed",
        message: "All testing suites executed. Latest results refreshed.",
        type: "success",
      });
    }

    if (onCompleted) {
      onCompleted(overallSuccess);
    }
  }, [snapshotId, isRunning, addToast, onCompleted]);

  return {
    runAll,
    isRunning,
    activeStep,
    stepStates,
    cancelRemaining,
  };
}

export default useRunAllSuites;
