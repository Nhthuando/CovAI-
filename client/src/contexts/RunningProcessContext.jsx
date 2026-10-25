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
    completedCount: 0,
    currentFile: "",
    stats: "Applying...",
    progressPct: null,
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
    const loadedAnalysis = { ...initialProcesses.analysis, ...(parsed.analysis || {}) };
    if (loadedAnalysis.isRunning && !loadedAnalysis.jobId) {
      loadedAnalysis.isRunning = false;
    }
    const loadedSuggestion = { ...initialProcesses.suggestion, ...(parsed.suggestion || {}) };
    // In-memory async generation loops cannot survive browser reloads
    if (loadedSuggestion.isGenerating) {
      loadedSuggestion.isGenerating = false;
    }
    const loadedBulkApply = { ...initialProcesses.bulkApply, ...(parsed.bulkApply || {}) };
    // In-memory bulk apply loop cannot survive browser reloads
    if (loadedBulkApply.isApplying) {
      loadedBulkApply.isApplying = false;
    }

    // Expire completedAt older than 4 seconds so finished items don't resurrect on refresh
    const now = Date.now();
    if (loadedAnalysis.completedAt && now - loadedAnalysis.completedAt > 4000) {
      loadedAnalysis.completedAt = null;
    }
    if (loadedSuggestion.completedAt && now - loadedSuggestion.completedAt > 4000) {
      loadedSuggestion.completedAt = null;
      loadedSuggestion.completedMessage = null;
    }
    if (loadedBulkApply.completedAt && now - loadedBulkApply.completedAt > 4000) {
      loadedBulkApply.completedAt = null;
    }

    return {
      analysis: loadedAnalysis,
      suggestion: loadedSuggestion,
      bulkApply: loadedBulkApply,
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
  const autoDismissTimersRef = useRef({});

  // Sync processes to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(processes));
    } catch (_) { }
  }, [processes]);

  // Clean dismiss of a single process or all processes
  const dismissProcess = useCallback((processKey) => {
    if (autoDismissTimersRef.current[processKey]) {
      clearTimeout(autoDismissTimersRef.current[processKey]);
      delete autoDismissTimersRef.current[processKey];
    }
    setProcesses((prev) => {
      if (!processKey || processKey === "all") {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
        return initialProcesses;
      }
      if (!prev[processKey]) return prev;
      const updated = {
        ...prev,
        [processKey]: {
          ...initialProcesses[processKey],
        },
      };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  }, []);

  const dismissAll = useCallback(() => {
    Object.values(autoDismissTimersRef.current).forEach((t) => clearTimeout(t));
    autoDismissTimersRef.current = {};
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    setProcesses(initialProcesses);
  }, []);

  // Schedule auto-dismiss for completed or failed states
  const scheduleAutoDismiss = useCallback((key, delayMs = 3500) => {
    if (autoDismissTimersRef.current[key]) {
      clearTimeout(autoDismissTimersRef.current[key]);
    }
    autoDismissTimersRef.current[key] = setTimeout(() => {
      dismissProcess(key);
      delete autoDismissTimersRef.current[key];
    }, delayMs);
  }, [dismissProcess]);

  // Clean processes when switching projects or navigating to /projects
  const clearOtherProjectProcesses = useCallback((currentProjectId) => {
    setProcesses((prev) => {
      let changed = false;
      const next = { ...prev };
      ["analysis", "suggestion", "bulkApply"].forEach((k) => {
        if (next[k]?.projectId) {
          if (!currentProjectId || next[k].projectId !== currentProjectId) {
            next[k] = { ...initialProcesses[k] };
            changed = true;
            if (autoDismissTimersRef.current[k]) {
              clearTimeout(autoDismissTimersRef.current[k]);
              delete autoDismissTimersRef.current[k];
            }
          }
        }
      });
      if (changed) {
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (_) {}
        return next;
      }
      return prev;
    });
  }, []);

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
          scheduleAutoDismiss("analysis", 3500);
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
          scheduleAutoDismiss("analysis", 4500);
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
  }, [processes.analysis.isRunning, processes.analysis.jobId, processes.analysis.snapshotId, scheduleAutoDismiss]);

  // Methods for Analysis Process
  const startAnalysis = useCallback(({ snapshotId, projectId, type = "unit", jobId = null }) => {
    if (autoDismissTimersRef.current.analysis) {
      clearTimeout(autoDismissTimersRef.current.analysis);
      delete autoDismissTimersRef.current.analysis;
    }
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

  const completeAnalysis = useCallback((arg1 = true, arg2 = null) => {
    let success = true;
    let error = null;
    let step = "Analysis completed successfully!";

    if (typeof arg1 === "string") {
      success = true;
      step = arg1;
      error = arg2 || null;
    } else if (typeof arg1 === "boolean") {
      success = arg1;
      error = arg2 || null;
      step = success ? "Analysis completed successfully!" : (error || "Analysis failed.");
    } else if (arg1 && typeof arg1 === "object") {
      success = arg1.success !== false;
      error = arg1.error || null;
      step = arg1.step || arg1.message || (success ? "Analysis completed successfully!" : "Analysis failed.");
    }

    setProcesses((prev) => ({
      ...prev,
      analysis: {
        ...prev.analysis,
        isRunning: false,
        progress: success ? 100 : prev.analysis.progress,
        step,
        error,
        completedAt: Date.now(),
      },
    }));
    scheduleAutoDismiss("analysis", error ? 4500 : 3500);
  }, [scheduleAutoDismiss]);

  // Methods for Inline Suggestion Process
  const startSuggestion = useCallback(({ snapshotId, projectId, type = "unit", totalFiles = 0, initialMessage = "" }) => {
    if (autoDismissTimersRef.current.suggestion) {
      clearTimeout(autoDismissTimersRef.current.suggestion);
      delete autoDismissTimersRef.current.suggestion;
    }
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
    scheduleAutoDismiss("suggestion", 3500);
  }, [scheduleAutoDismiss]);

  // Methods for Bulk Apply Process
  const startBulkApply = useCallback(({ snapshotId, projectId, totalCount = 0, step = "", type = "unit" }) => {
    if (autoDismissTimersRef.current.bulkApply) {
      clearTimeout(autoDismissTimersRef.current.bulkApply);
      delete autoDismissTimersRef.current.bulkApply;
    }
    setProcesses((prev) => ({
      ...prev,
      bulkApply: {
        isApplying: true,
        snapshotId,
        projectId,
        type,
        totalCount,
        completedCount: 0,
        currentFile: "",
        stats: totalCount > 0 ? `0/${totalCount}` : "Applying...",
        progressPct: 0,
        step: step || `Applying ${totalCount} test suggestions across files...`,
        completedAt: null,
        result: null,
      },
    }));
  }, []);

  const updateBulkApplyStep = useCallback((stepOrUpdate) => {
    setProcesses((prev) => {
      const update = typeof stepOrUpdate === "string" ? { step: stepOrUpdate } : (stepOrUpdate || {});
      const completedCount = update.completedCount !== undefined ? update.completedCount : prev.bulkApply.completedCount;
      const totalCount = update.totalCount !== undefined ? update.totalCount : prev.bulkApply.totalCount;
      const stats = update.stats || (totalCount > 0 ? `${completedCount}/${totalCount}` : prev.bulkApply.stats);
      const progressPct = update.progressPct !== undefined
        ? update.progressPct
        : (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : prev.bulkApply.progressPct);

      return {
        ...prev,
        bulkApply: {
          ...prev.bulkApply,
          ...update,
          completedCount,
          totalCount,
          stats,
          progressPct,
          step: update.step || prev.bulkApply.step,
        },
      };
    });
  }, []);

  const completeBulkApply = useCallback((result = null) => {
    setProcesses((prev) => ({
      ...prev,
      bulkApply: {
        ...prev.bulkApply,
        isApplying: false,
        completedAt: Date.now(),
        result,
        progressPct: 100,
        stats: "Done",
        step: result?.error ? `Applied with errors: ${result.error}` : (result?.message || "✓ Successfully applied test suggestions!"),
      },
    }));
    scheduleAutoDismiss("bulkApply", 3500);
  }, [scheduleAutoDismiss]);

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
    (processes.suggestion.completedMessage && processes.suggestion.completedAt && (Date.now() - processes.suggestion.completedAt < 4000)) ||
    (processes.bulkApply.completedAt && (Date.now() - processes.bulkApply.completedAt < 4000)) ||
    (processes.analysis.completedAt && !processes.analysis.error && (Date.now() - processes.analysis.completedAt < 4000)) ||
    (processes.analysis.error && processes.analysis.completedAt && (Date.now() - processes.analysis.completedAt < 5000))
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
    dismissAll,
    clearOtherProjectProcesses,
    scheduleAutoDismiss,
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
