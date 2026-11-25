import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getIntegrationSimulationTrace } from "../services/coverage.service.js";

export function getScenarioSelectionKey(sc, idx = 0) {
  if (!sc) return `sc_${idx}`;
  return String(
    sc.scenarioId || sc.id || sc.title || sc.testName || `sc_${idx}`,
  );
}

/**
 * Manages Integration Flow Simulation state for a single API endpoint and its scenarios.
 * One shared API graph is reused across all scenarios; switching scenarios loads/caches
 * that scenario's execution trace and drives step-by-step packet playback.
 */
export function useIntegrationSimulation({
  isOpen = false,
  snapshotId = null,
  endpoint = null,
  initialScenario = null,
  autoPlayOnOpen = true,
  onClose = null,
}) {
  const scenarios = useMemo(
    () => (Array.isArray(endpoint?.scenarios) ? endpoint.scenarios : []),
    [endpoint],
  );

  const initialKey = initialScenario
    ? getScenarioSelectionKey(initialScenario, 0)
    : scenarios[0]
      ? getScenarioSelectionKey(scenarios[0], 0)
      : "__default__";

  const syncToken = `${isOpen ? "1" : "0"}::${endpoint?.method || ""}::${endpoint?.path || ""}::${initialKey}`;
  const [prevSyncToken, setPrevSyncToken] = useState(syncToken);

  const [selectedScenarioKey, setSelectedScenarioKey] = useState(initialKey);
  const [traceData, setTraceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const traceCacheRef = useRef(new Map());
  const requestIdRef = useRef(0);

  if (syncToken !== prevSyncToken) {
    setPrevSyncToken(syncToken);
    if (!isOpen) {
      setPlaying(false);
    } else {
      setSelectedScenarioKey(initialKey);
      setCurrentStepIndex(0);
      setPlaying(false);
      setTraceData(null);
      setError("");
    }
  }

  // Clear cache when snapshotId changes
  useEffect(() => {
    traceCacheRef.current.clear();
  }, [snapshotId]);

  const selectedScenario = useMemo(() => {
    if (scenarios.length === 0) return initialScenario || null;
    const found = scenarios.find(
      (sc, idx) => getScenarioSelectionKey(sc, idx) === selectedScenarioKey,
    );
    return found || initialScenario || scenarios[0];
  }, [scenarios, selectedScenarioKey, initialScenario]);

  const fetchTrace = useCallback(
    async (scenarioObj, { forceRefresh = false, autoPlay = true } = {}) => {
      if (!isOpen || !snapshotId || !endpoint) return;

      const epKey = `${(endpoint.method || "GET").toUpperCase()} ${endpoint.path || endpoint.fullPath || "/"}`;
      const scKey = scenarioObj
        ? getScenarioSelectionKey(scenarioObj, 0)
        : "__default__";
      const cacheKey = `${snapshotId}::${epKey}::${scKey}`;

      if (!forceRefresh && traceCacheRef.current.has(cacheKey)) {
        const cached = traceCacheRef.current.get(cacheKey);
        setTraceData(cached);
        setError("");
        setCurrentStepIndex(0);
        setPlaying(autoPlay && (cached?.steps?.length || 0) > 1);
        return;
      }

      const reqId = ++requestIdRef.current;
      setLoading(true);
      setError("");
      setPlaying(false);
      setCurrentStepIndex(0);

      try {
        const res = await getIntegrationSimulationTrace(snapshotId, {
          method: endpoint.method,
          path: endpoint.path || endpoint.fullPath || "/",
          endpoint,
          scenario: scenarioObj || undefined,
          testName: scenarioObj?.title || scenarioObj?.testName,
          code: scenarioObj?.code || "",
          expectedStatus: scenarioObj?.expectedStatus,
        });
        if (reqId !== requestIdRef.current) return;
        const data = res?.data || res;
        traceCacheRef.current.set(cacheKey, data);
        setTraceData(data);
        setCurrentStepIndex(0);
        if (autoPlay && (data?.steps?.length || 0) > 1) {
          setPlaying(true);
        }
      } catch (err) {
        if (reqId !== requestIdRef.current) return;
        setError(err.message || "Failed to build integration simulation trace.");
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [isOpen, snapshotId, endpoint],
  );

  useEffect(() => {
    if (!isOpen || !endpoint) return;
    const timer = setTimeout(() => {
      fetchTrace(selectedScenario, { autoPlay: Boolean(autoPlayOnOpen) });
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, endpoint, selectedScenario, autoPlayOnOpen, fetchTrace]);

  const steps = useMemo(() => traceData?.steps || [], [traceData]);
  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex] || null;
  const isPlaying = Boolean(isOpen && playing && currentStepIndex < totalSteps - 1);

  // Auto-advance timer when playing
  useEffect(() => {
    if (!isPlaying || totalSteps <= 1) return;

    const delayMs = Math.max(280, Math.round(950 / playbackSpeed));
    const timer = setTimeout(() => {
      setCurrentStepIndex((prev) => {
        const next = Math.min(prev + 1, totalSteps - 1);
        if (next >= totalSteps - 1) {
          setPlaying(false);
        }
        return next;
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [isPlaying, currentStepIndex, totalSteps, playbackSpeed]);

  const selectScenario = useCallback((nextKey) => {
    setSelectedScenarioKey(nextKey);
  }, []);

  const play = useCallback(() => {
    if (totalSteps <= 1) return;
    if (currentStepIndex >= totalSteps - 1) {
      setCurrentStepIndex(0);
    }
    setPlaying(true);
  }, [totalSteps, currentStepIndex]);

  const pause = useCallback(() => setPlaying(false), []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setCurrentStepIndex((prev) => Math.min(prev + 1, Math.max(0, totalSteps - 1)));
  }, [totalSteps]);

  const stepBackward = useCallback(() => {
    setPlaying(false);
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const resetAndReplay = useCallback(() => {
    setCurrentStepIndex(0);
    setPlaying(totalSteps > 1);
  }, [totalSteps]);

  const resetToStart = useCallback(() => {
    setPlaying(false);
    setCurrentStepIndex(0);
  }, []);

  const jumpToStep = useCallback(
    (idx) => {
      setPlaying(false);
      const bounded = Math.max(0, Math.min(idx, Math.max(0, totalSteps - 1)));
      setCurrentStepIndex(bounded);
    },
    [totalSteps],
  );

  const jumpToNode = useCallback(
    (nodeId) => {
      const idx = steps.findIndex((s) => s.nodeId === nodeId);
      if (idx >= 0) jumpToStep(idx);
    },
    [steps, jumpToStep],
  );

  // Keyboard shortcuts while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (e.key === "Escape") onClose?.();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepForward();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepBackward();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        resetAndReplay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, togglePlay, stepForward, stepBackward, resetAndReplay]);

  return {
    scenarios,
    selectedScenarioKey,
    selectedScenario,
    traceData,
    steps,
    currentStep,
    currentStepIndex,
    isPlaying,
    playbackSpeed,
    loading,
    error,
    actions: {
      selectScenario,
      play,
      pause,
      togglePlay,
      stepForward,
      stepBackward,
      resetAndReplay,
      resetToStart,
      jumpToStep,
      jumpToNode,
      setPlaybackSpeed,
      refreshTrace: () => fetchTrace(selectedScenario, { forceRefresh: true, autoPlay: true }),
    },
  };
}
