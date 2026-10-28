import { useState, useRef, useCallback } from "react";
import { runCoverageByType } from "../services/coverage.service.js";
import { invalidateCoverageQueries } from "./useCoverageQuery.js";
import { useToast } from "../components/dashboard/ToastContext.jsx";

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

  const cancelRemaining = useCallback(() => {
    isCancelledRef.current = true;
    setStepStates((prev) => {
      const updated = { ...prev };
      for (const k of ["unit", "integration", "system"]) {
        if (updated[k] === "queued") {
          updated[k] = "idle";
        }
      }
      return updated;
    });
    addToast({
      title: "Suite Execution Paused",
      message: "Remaining queued test suites were cancelled.",
      type: "info",
    });
  }, [addToast]);

  const runAll = useCallback(async () => {
    if (!snapshotId || isRunning) return;

    isCancelledRef.current = false;
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
        await runCoverageByType(snapshotId, step.key);
        setStepStates((prev) => ({ ...prev, [step.key]: "done" }));
      } catch (err) {
        console.error(`[RunAllSuites] Error executing ${step.key}:`, err);
        setStepStates((prev) => ({ ...prev, [step.key]: "failed" }));
        overallSuccess = false;
        addToast({
          title: `${step.label} Failed`,
          message: err.message || `An error occurred while executing ${step.label}.`,
          type: "error",
        });
        // Continue or stop on fatal? We allow remaining steps to attempt execution
      }
    }

    setIsRunning(false);
    setActiveStep(null);

    // Invalidate caches to refresh dashboard and workspace views
    invalidateCoverageQueries(snapshotId);

    if (overallSuccess && !isCancelledRef.current) {
      addToast({
        title: "Test Execution Completed",
        message: "All 3 testing suites executed. Latest results refreshed.",
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
