import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getJobDetailApi } from "../services/job.service.js";
import { invalidateCoverageQueries } from "../hooks/useCoverageQuery.js";

const RunningProcessContext = createContext(null);

const STORAGE_KEY = "covai_running_processes";
const SUGGESTIONS_STORAGE_PREFIX = "covai_snapshot_suggestions_";

const initialProcesses = {
  analysis: {
    isRunning: false,
    jobId: null,
    snapshotId: null,
    projectId: null,
    type: "unit",
    progress: 0,
    step: "",
    error: null,
    completedAt: null,
  },
  suggestion: {
    isGenerating: false,
    snapshotId: null,
    projectId: null,
    type: "unit",
    totalFiles: 0,
    completedFiles: 0,
    currentFile: "",
    message: "",
    completedAt: null,
    completedMessage: null,
  },
  bulkApply: {
    isApplying: false,
    snapshotId: null,
    projectId: null,
    type: "unit",
    totalCount: 0,
    step: "",
    completedAt: null,
    result: null,
  },
};

function loadStoredProcesses() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initialProcesses;
    const parsed = JSON.parse(raw);
    return {
      analysis: { ...initialProcesses.analysis, ...(parsed.analysis || {}) },
      suggestion: { ...initialProcesses.suggestion, ...(parsed.suggestion || {}) },
      bulkApply: { ...initialProcesses.bulkApply, ...(parsed.bulkApply || {}) },
    };
  } catch (err) {
    console.warn("Failed to load stored running processes:", err);
    return initialProcesses;
  }
}

export function RunningProcessProvider({ children }) {
  const [processes, setProcesses] = useState(loadStoredProcesses);
  const suggestionsCacheRef = useRef({});
  const pollingRef = useRef(null);

  // Sync processes to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(processes));
    } catch (_) { }
  }, [processes]);

  // Background poller for analysis job (runs across all pages and tabs)
  useEffect(() => {
    const { isRunning, jobId, snapshotId } = processes.analysis;
    if (!isRunning || !jobId) {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    let isDisposed = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (isDisposed) return;
      try {
        const response = await getJobDetailApi(jobId);
        if (isDisposed) return;
        const job = response?.job;
        consecutiveErrors = 0;

        if (!job) {
          pollingRef.current = setTimeout(poll, 2000);
          return;
        }

        const prog = typeof job.progress === "number" ? job.progress : undefined;
        let stepDescription = processes.analysis.step;

        if (prog !== undefined) {
          if (prog <= 20) stepDescription = "Preparing dependencies & Docker environment...";
          else if (prog <= 45) stepDescription = "Running Jest unit test suites & generating coverage...";
          else if (prog <= 65) stepDescription = "Running Vitest unit test suites & generating coverage...";
          else if (prog <= 85) stepDescription = "Merging multi-framework coverage & analyzing AST functions...";
          else if (prog < 100) stepDescription = "Saving analysis results & syncing data...";
          else stepDescription = "Analysis completed!";
        }

        if (job.status === "SUCCESS") {
          pollingRef.current = null;
          setProcesses((prev) => ({
            ...prev,
            analysis: {
              ...prev.analysis,
              isRunning: false,
              progress: 100,
              step: "Analysis completed successfully!",
              completedAt: Date.now(),
              error: null,
            },
          }));
          if (snapshotId) {
            invalidateCoverageQueries(snapshotId);
          }
          return;
        } else if (["FAILED", "CANCELED"].includes(job.status)) {
          pollingRef.current = null;
          setProcesses((prev) => ({
            ...prev,
            analysis: {
              ...prev.analysis,
              isRunning: false,
              error: job.errorMessage || job.error || `${job.status}: coverage analysis failed.`,
              completedAt: Date.now(),
            },
          }));
          return;
        } else if (prog !== undefined) {
          setProcesses((prev) => ({
            ...prev,
            analysis: {
              ...prev.analysis,
              progress: Math.max(prev.analysis.progress, prog),
              step: stepDescription,
            },
          }));
        }

        pollingRef.current = setTimeout(poll, 2000);
      } catch (err) {
        if (isDisposed) return;
        consecutiveErrors++;
        if (consecutiveErrors <= 2) {
          console.warn("[RunningProcess] Polling retry:", err.message || err);
        }
        const delay = consecutiveErrors > 5 ? 5000 : 2500;
        pollingRef.current = setTimeout(poll, delay);
      }
    };

    poll();

    return () => {
      isDisposed = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [processes.analysis.isRunning, processes.analysis.jobId, processes.analysis.snapshotId]);

  // Methods for Analysis Process
  const startAnalysis = useCallback(({ snapshotId, projectId, type = "unit", jobId = null }) => {
    setProcesses((prev) => ({
      ...prev,
      analysis: {
        isRunning: true,
        jobId,
        snapshotId,
        projectId,
        type,
        progress: 8,
        step: "Initializing test analysis environment...",
        error: null,
        completedAt: null,
      },
    }));
  }, []);

  const updateAnalysisProgress = useCallback((progress, step) => {
    setProcesses((prev) => ({
      ...prev,
      analysis: {
        ...prev.analysis,
        progress: typeof progress === "number" ? progress : prev.analysis.progress,
        step: step || prev.analysis.step,
      },
    }));
  }, []);

  const completeAnalysis = useCallback((success = true, error = null) => {
    setProcesses((prev) => ({
      ...prev,
      analysis: {
        ...prev.analysis,
        isRunning: false,
        progress: success ? 100 : prev.analysis.progress,
        step: success ? "Analysis completed successfully!" : "Analysis failed.",
        error: error || null,
        completedAt: Date.now(),
      },
    }));
  }, []);

  // Methods for Inline Suggestion Process
  const startSuggestion = useCallback(({ snapshotId, projectId, type = "unit", totalFiles = 0, initialMessage = "" }) => {
    setProcesses((prev) => ({
      ...prev,
      suggestion: {
        isGenerating: true,
        snapshotId,
        projectId,
        type,
        totalFiles,
        completedFiles: 0,
        currentFile: "",
        message: initialMessage || `Generating inline test suggestions for ${totalFiles} files...`,
        completedAt: null,
        completedMessage: null,
      },
    }));
  }, []);

  const updateSuggestionProgress = useCallback(({ completedFiles, totalFiles, currentFile, message, filePath, fileSuggestions, snapshotId }) => {
    setProcesses((prev) => ({
      ...prev,
      suggestion: {
        ...prev.suggestion,
        completedFiles: typeof completedFiles === "number" ? completedFiles : prev.suggestion.completedFiles,
        totalFiles: typeof totalFiles === "number" ? totalFiles : prev.suggestion.totalFiles,
        currentFile: currentFile || prev.suggestion.currentFile,
        message: message || prev.suggestion.message,
      },
    }));

    if (snapshotId && filePath && fileSuggestions) {
      saveFileSuggestions(snapshotId, filePath, fileSuggestions);
    }
  }, []);

  const completeSuggestion = useCallback((message = "") => {
    setProcesses((prev) => ({
      ...prev,
      suggestion: {
        ...prev.suggestion,
        isGenerating: false,
        completedAt: Date.now(),
        completedMessage: message || `✓ Generated inline test suggestions under ${prev.suggestion.completedFiles || prev.suggestion.totalFiles} files!`,
      },
    }));
  }, []);

  // Methods for Bulk Apply Process
  const startBulkApply = useCallback(({ snapshotId, projectId, totalCount = 0, step = "" }) => {
    setProcesses((prev) => ({
      ...prev,
      bulkApply: {
        isApplying: true,
        snapshotId,
        projectId,
        totalCount,
        step: step || `Applying ${totalCount} test suggestions across files...`,
        completedAt: null,
        result: null,
      },
    }));
  }, []);

  const updateBulkApplyStep = useCallback((step) => {
    setProcesses((prev) => ({
      ...prev,
      bulkApply: {
        ...prev.bulkApply,
        step: step || prev.bulkApply.step,
      },
    }));
  }, []);

  const completeBulkApply = useCallback((result = null) => {
    setProcesses((prev) => ({
      ...prev,
      bulkApply: {
        ...prev.bulkApply,
        isApplying: false,
        completedAt: Date.now(),
        result,
      },
    }));
  }, []);

  // Dismiss / Clear process notification
  const dismissProcess = useCallback((processKey) => {
    setProcesses((prev) => {
      if (!prev[processKey]) return prev;
      return {
        ...prev,
        [processKey]: {
          ...prev[processKey],
          completedAt: null,
          completedMessage: null,
          error: null,
        },
      };
    });
  }, []);

const sanitizeCachedSuggestions = (sugsMap) => {
  if (!sugsMap || typeof sugsMap !== "object") return {};
  const cleaned = {};
  for (const [key, val] of Object.entries(sugsMap)) {
    if (Array.isArray(val)) {
      cleaned[key] = val.map((sug) => {
        if (sug && sug.status === "APPLYING") {
          return {
            ...sug,
            status: sug.testRunError ? "FAILED" : "GENERATED",
          };
        }
        return sug;
      });
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
};

  // Suggestions Cache Management (Persisted in sessionStorage by snapshotId)
  const getSuggestions = useCallback((snapshotId) => {
    if (!snapshotId) return {};
    if (suggestionsCacheRef.current[snapshotId]) {
      return sanitizeCachedSuggestions(suggestionsCacheRef.current[snapshotId]);
    }
    try {
      const raw = sessionStorage.getItem(`${SUGGESTIONS_STORAGE_PREFIX}${snapshotId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        suggestionsCacheRef.current[snapshotId] = parsed;
        return sanitizeCachedSuggestions(parsed);
      }
    } catch (_) { }
    return {};
  }, []);

  const saveSuggestions = useCallback((snapshotId, sugsMap) => {
    if (!snapshotId) return;
    suggestionsCacheRef.current[snapshotId] = sugsMap;
    try {
      sessionStorage.setItem(`${SUGGESTIONS_STORAGE_PREFIX}${snapshotId}`, JSON.stringify(sugsMap));
    } catch (_) { }
  }, []);

  const saveFileSuggestions = useCallback((snapshotId, filePath, fileSugs) => {
    if (!snapshotId || !filePath) return;
    const current = suggestionsCacheRef.current[snapshotId] || {};
    const updated = {
      ...current,
      [filePath]: fileSugs,
    };
    suggestionsCacheRef.current[snapshotId] = updated;
    try {
      sessionStorage.setItem(`${SUGGESTIONS_STORAGE_PREFIX}${snapshotId}`, JSON.stringify(updated));
    } catch (_) { }
  }, []);

  const updateSingleSuggestionCode = useCallback((snapshotId, filePath, sugId, newCode) => {
    if (!snapshotId || !filePath) return;
    const current = suggestionsCacheRef.current[snapshotId] || {};
    const fileList = current[filePath] || [];
    const updatedList = fileList.map((s) =>
      (s.suggestionId === sugId || s.id === sugId)
        ? { ...s, generatedCode: newCode, suggestedTestCode: newCode, status: "EDITED" }
        : s
    );
    const updated = { ...current, [filePath]: updatedList };
    suggestionsCacheRef.current[snapshotId] = updated;
    try {
      sessionStorage.setItem(`${SUGGESTIONS_STORAGE_PREFIX}${snapshotId}`, JSON.stringify(updated));
    } catch (_) { }
  }, []);

  const removeFileSuggestions = useCallback((snapshotId, filePath) => {
    if (!snapshotId || !filePath) return;
    const current = suggestionsCacheRef.current[snapshotId] || {};
    const updated = { ...current };
    delete updated[filePath];
    // Also delete any path variant
    Object.keys(updated).forEach((k) => {
      if (k.endsWith(filePath) || filePath.endsWith(k)) {
        delete updated[k];
      }
    });
    suggestionsCacheRef.current[snapshotId] = updated;
    try {
      sessionStorage.setItem(`${SUGGESTIONS_STORAGE_PREFIX}${snapshotId}`, JSON.stringify(updated));
    } catch (_) { }
  }, []);

  // Computed summary
  const hasActiveProcess = Boolean(
    processes.analysis.isRunning ||
    processes.suggestion.isGenerating ||
    processes.bulkApply.isApplying
  );

  const recentlyCompleted = Boolean(
    (processes.suggestion.completedMessage && processes.suggestion.completedAt && (Date.now() - processes.suggestion.completedAt < 12000)) ||
    (processes.analysis.completedAt && !processes.analysis.error && (Date.now() - processes.analysis.completedAt < 8000)) ||
    (processes.analysis.error && processes.analysis.completedAt && (Date.now() - processes.analysis.completedAt < 12000))
  );

  const value = {
    processes,
    hasActiveProcess,
    recentlyCompleted,
    startAnalysis,
    updateAnalysisProgress,
    completeAnalysis,
    startSuggestion,
    updateSuggestionProgress,
    completeSuggestion,
    startBulkApply,
    updateBulkApplyStep,
    completeBulkApply,
    dismissProcess,
    getSuggestions,
    saveSuggestions,
    saveFileSuggestions,
    removeFileSuggestions,
    updateSingleSuggestionCode,
  };

  return (
    <RunningProcessContext.Provider value={value}>
      {children}
    </RunningProcessContext.Provider>
  );
}

export function useRunningProcess() {
  const ctx = useContext(RunningProcessContext);
  if (!ctx) {
    throw new Error("useRunningProcess must be used within a RunningProcessProvider");
  }
  return ctx;
}
