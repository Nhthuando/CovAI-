import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getUnitTestSimulationSources,
  getUnitTestSimulationTrace,
} from "../services/coverage.service.js";

/**
 * 4-Category Display Labels & Colors
 */
export const CATEGORY_METADATA = {
  HAPPY_PATH: {
    id: "HAPPY_PATH",
    name: "A. Happy Path",
    shortName: "Happy Path",
    badge: "🟢 Happy Path",
    color: "#10b981",
    bgLight: "rgba(16, 185, 129, 0.12)",
    bgDark: "rgba(16, 185, 129, 0.22)",
    border: "rgba(16, 185, 129, 0.35)",
  },
  BOUNDARY_VALUES: {
    id: "BOUNDARY_VALUES",
    name: "B. Boundary Values",
    shortName: "Boundary Values",
    badge: "🟡 Boundary Values",
    color: "#f59e0b",
    bgLight: "rgba(245, 158, 11, 0.12)",
    bgDark: "rgba(245, 158, 11, 0.22)",
    border: "rgba(245, 158, 11, 0.35)",
  },
  BRANCH_TOGGLING: {
    id: "BRANCH_TOGGLING",
    name: "C. Branch Toggling",
    shortName: "Branch Toggling",
    badge: "🔵 Branch Toggling",
    color: "#0284c7",
    bgLight: "rgba(2, 132, 199, 0.12)",
    bgDark: "rgba(2, 132, 199, 0.22)",
    border: "rgba(2, 132, 199, 0.35)",
  },
  ERROR_HANDLING: {
    id: "ERROR_HANDLING",
    name: "D. Error Handling",
    shortName: "Error Handling",
    badge: "🔴 Error Handling",
    color: "#ef4444",
    bgLight: "rgba(239, 68, 68, 0.12)",
    bgDark: "rgba(239, 68, 68, 0.22)",
    border: "rgba(239, 68, 68, 0.35)",
  },
};

/**
 * 7-Phase Execution Taxonomy
 */
export const SIMULATION_PHASES = {
  SETUP_MOCKS: { label: "Setup Mocks", color: "#a855f7", badge: "🟣 Setup Mocks" },
  CALL_ENTRY: { label: "Call Entry", color: "#3b82f6", badge: "🔵 Call Entry" },
  EVAL_PARAMS: { label: "Parameters", color: "#06b6d4", badge: "🔷 Parameters" },
  BRANCH_DECISION: { label: "Branch Decision", color: "#f59e0b", badge: "🟠 Branch Decision" },
  MOCK_INTERACTION: { label: "Mock Resolution", color: "#ec4899", badge: "🌸 Mock Resolution" },
  RETURN_VALUE: { label: "Return Value", color: "#10b981", badge: "🟢 Return Value" },
  ERROR_THROW: { label: "Error Throw", color: "#ef4444", badge: "🔴 Error Throw" },
  ASSERTION: { label: "Assertion", color: "#22c55e", badge: "🎯 Assertion" },
};

export function useUnitTestSimulation({
  snapshotId,
  projectId = null,
  availableSourceFiles = [],
  availableFunctionsList = [],
  availableTestSuites = [],
  initialSourceFile = null,
  initialTestFile = null,
  initialTestCaseId = null,
  initialFunctionName = null,
  initialTestCode = null,
  initialCategory = "HAPPY_PATH",
  enabled = true,
} = {}) {
  // Build initial sources from availableSourceFiles prop if provided
  const propSources = useMemo(() => {
    if (!Array.isArray(availableSourceFiles) || availableSourceFiles.length === 0) return [];
    return availableSourceFiles.map((file) => {
      const fPath = file.filePath || file.path || file.fileName || "";
      const fName = file.fileName || file.name || fPath.split("/").pop() || "source.js";
      // Find matching functions from availableFunctionsList
      const fns = (Array.isArray(availableFunctionsList) ? availableFunctionsList : [])
        .filter((fn) => {
          const fnPath = fn.filePath || "";
          return fnPath === fPath || fnPath.endsWith(fPath) || fPath.endsWith(fnPath);
        })
        .map((fn) => ({
          name: fn.name || fn.cleanName || fn.functionName || "anonymous",
          startLine: fn.startLine || fn.line || 1,
          endLine: fn.endLine || fn.startLine || 1,
          complexity: fn.complexity || 1,
        }));

      return {
        filePath: fPath,
        fileName: fName,
        functions: fns.length > 0 ? fns : (file.functions || []),
        hasTests: Boolean(file.hasTests || file.testFiles?.length),
        sourceCode: file.content || file.sourceCode || "",
      };
    });
  }, [availableSourceFiles, availableFunctionsList]);

  // Initial selections
  const defaultFile = initialSourceFile || propSources[0]?.filePath || null;
  const defaultFn = initialFunctionName || propSources[0]?.functions?.[0]?.name || null;

  // Navigation & Selection state
  const [selectedSourceFile, setSelectedSourceFile] = useState(defaultFile);
  const [selectedTestFile, setSelectedTestFile] = useState(initialTestFile);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState(initialTestCaseId);
  const [selectedFunctionName, setSelectedFunctionName] = useState(defaultFn);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || "HAPPY_PATH");
  const [activeCodeView, setActiveCodeView] = useState("split"); // "source" | "test" | "split"

  // Playback state
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 0.5, 1, 2

  // Trace data state
  const [sourcesData, setSourcesData] = useState(() => (propSources.length > 0 ? propSources : []));
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [simulationTrace, setSimulationTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState(null);
  const [isKeyboardEnabled, setIsKeyboardEnabled] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const traceRequestRef = useRef(0);

  // Sync propSources when they arrive asynchronously
  useEffect(() => {
    if (propSources.length > 0) {
      setSourcesData((prev) => (prev.length === 0 ? propSources : prev));
      if (!selectedSourceFile) {
        const nextFile = initialSourceFile || propSources[0]?.filePath;
        setSelectedSourceFile(nextFile);
        if (propSources[0]?.functions?.[0]?.name && !selectedFunctionName) {
          setSelectedFunctionName(initialFunctionName || propSources[0].functions[0].name);
        }
      }
    }
  }, [propSources, selectedSourceFile, selectedFunctionName, initialSourceFile, initialFunctionName]);

  // Sync props state without calling setState inside an effect
  const [prevProps, setPrevProps] = useState({
    source: initialSourceFile,
    test: initialTestFile,
    tc: initialTestCaseId,
    fn: initialFunctionName,
    cat: initialCategory,
  });

  if (
    initialSourceFile !== prevProps.source ||
    initialTestFile !== prevProps.test ||
    initialTestCaseId !== prevProps.tc ||
    initialFunctionName !== prevProps.fn ||
    initialCategory !== prevProps.cat
  ) {
    setPrevProps({
      source: initialSourceFile,
      test: initialTestFile,
      tc: initialTestCaseId,
      fn: initialFunctionName,
      cat: initialCategory,
    });
    if (initialSourceFile && initialSourceFile !== selectedSourceFile) {
      setSelectedSourceFile(initialSourceFile);
    }
    if (initialTestFile && initialTestFile !== selectedTestFile) {
      setSelectedTestFile(initialTestFile);
    }
    if (initialTestCaseId && initialTestCaseId !== selectedTestCaseId) {
      setSelectedTestCaseId(initialTestCaseId);
    }
    if (initialFunctionName && initialFunctionName !== selectedFunctionName) {
      setSelectedFunctionName(initialFunctionName);
    }
    if (initialCategory && initialCategory !== selectedCategory) {
      setSelectedCategory(initialCategory);
    }
  }

  // Load available simulation sources list
  useEffect(() => {
    if (!snapshotId || !enabled) return;
    let isMounted = true;

    const loadSources = async () => {
      try {
        setSourcesLoading(true);
        const res = await getUnitTestSimulationSources(snapshotId);
        if (!isMounted) return;
        const list = res?.data?.sourceFiles || res?.data?.sources || res?.sourceFiles || [];
        if (list.length > 0) {
          setSourcesData(list);

          // Auto-select first source file if none selected
          if (!selectedSourceFile) {
            setSelectedSourceFile(list[0].filePath);
            if (list[0].functions && list[0].functions.length > 0) {
              setSelectedFunctionName(list[0].functions[0].name);
            }
          }
        }
      } catch (err) {
        console.warn("Failed to load simulation sources:", err);
      } finally {
        if (isMounted) setSourcesLoading(false);
      }
    };

    loadSources();
    return () => {
      isMounted = false;
    };
  }, [snapshotId, enabled, refreshTrigger, selectedSourceFile]);

  // Load or synthesize simulation trace
  useEffect(() => {
    if (!enabled) return;

    const targetFile = selectedSourceFile || initialSourceFile;
    if (!targetFile && !initialTestCode) return;

    let isMounted = true;
    const request = ++traceRequestRef.current;

    const loadTrace = async () => {
      try {
        setTraceLoading(true);
        setTraceError(null);

        if (snapshotId && targetFile) {
          const payload = {
            sourceFilePath: targetFile,
            testFilePath: selectedTestFile || initialTestFile || undefined,
            testCaseId: selectedTestCaseId || initialTestCaseId || undefined,
            functionName: selectedFunctionName || initialFunctionName || undefined,
            category: selectedCategory || initialCategory || "HAPPY_PATH",
            testCode: initialTestCode || undefined,
          };

          const res = await getUnitTestSimulationTrace(snapshotId, payload);
          const trace = res?.data || res;
          if (isMounted && request === traceRequestRef.current && trace && Array.isArray(trace.steps) && trace.steps.length > 0) {
            setSimulationTrace(trace);
            setCurrentStepIndex(0);
            setIsPlaying(false);
            setTraceLoading(false);
            return;
          }
        }
        throw new Error("No trace returned from simulation endpoint");
      } catch (err) {
        if (!isMounted || request !== traceRequestRef.current) return;
        setSimulationTrace(null);
        setIsPlaying(false);
        setTraceError(err.message || 'Unable to load the recording. Please try again.');
      } finally {
        if (isMounted && request === traceRequestRef.current) setTraceLoading(false);
      }
    };

    loadTrace();
    return () => {
      isMounted = false;
      traceRequestRef.current++;
    };
  }, [
    snapshotId,
    enabled,
    selectedSourceFile,
    initialSourceFile,
    selectedTestFile,
    initialTestFile,
    selectedTestCaseId,
    initialTestCaseId,
    selectedFunctionName,
    initialFunctionName,
    selectedCategory,
    initialCategory,
    initialTestCode,
    refreshTrigger,
  ]);

  // Derived steps and active step
  const steps = useMemo(() => {
    return simulationTrace?.steps || [];
  }, [simulationTrace]);

  const totalSteps = steps.length;
  const currentStep = useMemo(() => {
    if (steps.length === 0) return null;
    const idx = Math.max(0, Math.min(currentStepIndex, steps.length - 1));
    return steps[idx];
  }, [steps, currentStepIndex]);

  // Playback Controls
  const play = useCallback(() => {
    if (steps.length === 0) return;
    if (currentStepIndex >= steps.length - 1) {
      setCurrentStepIndex(0);
    }
    setIsPlaying(true);
  }, [steps.length, currentStepIndex]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const stepForward = useCallback(() => {
    setCurrentStepIndex((prev) => {
      if (prev < steps.length - 1) {
        return prev + 1;
      }
      setIsPlaying(false);
      return prev;
    });
  }, [steps.length]);

  const stepBackward = useCallback(() => {
    setCurrentStepIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex(0);
  }, []);

  const jumpToEnd = useCallback(() => {
    setIsPlaying(false);
    if (steps.length > 0) {
      setCurrentStepIndex(steps.length - 1);
    }
  }, [steps.length]);

  const jumpToStep = useCallback(
    (index) => {
      if (steps.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, steps.length - 1));
      setCurrentStepIndex(safeIndex);
    },
    [steps.length]
  );

  // Playback timer effect
  useEffect(() => {
    if (!isPlaying || steps.length === 0) return;

    const intervalMs = Math.round(1500 / playbackSpeed);
    const timer = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev >= steps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, steps.length]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    if (!enabled || !isKeyboardEnabled) return;

    const handleKeyDown = (e) => {
      // Don't intercept if user is typing in an input, textarea, select, or monaco editor
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        stepForward();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        stepBackward();
      } else if (e.code === "Home" || e.code === "KeyR") {
        e.preventDefault();
        reset();
      } else if (e.code === "End") {
        e.preventDefault();
        jumpToEnd();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, isKeyboardEnabled, togglePlay, stepForward, stepBackward, reset, jumpToEnd]);

  // Custom test code state for interactive test authoring sandbox
  const [authoredTestCode, setCustomTestCode] = useState(initialTestCode || null);
  const customTestCode = authoredTestCode ?? simulationTrace?.testCode ?? '';

  // Simulate custom user-authored test code
  const simulateCustomTest = useCallback(async (codeToSimulate) => {
    const code = codeToSimulate !== undefined ? codeToSimulate : customTestCode;
    if (!code || !code.trim()) return null;
    const request = ++traceRequestRef.current;
    try {
      setTraceLoading(true);
      setTraceError(null);
      const targetFile = selectedSourceFile || initialSourceFile;
      if (snapshotId) {
        const payload = {
          sourceFilePath: targetFile,
          testFilePath: selectedTestFile || initialTestFile || undefined,
          testCaseId: selectedTestCaseId || initialTestCaseId || undefined,
          functionName: selectedFunctionName || initialFunctionName || undefined,
          category: selectedCategory || initialCategory || "HAPPY_PATH",
          testCode: code,
        };
        const res = await getUnitTestSimulationTrace(snapshotId, payload);
        const trace = res?.data || res;
        if (request !== traceRequestRef.current) return null;
        if (trace && Array.isArray(trace.steps) && trace.steps.length > 0) {
          setSimulationTrace(trace);
          setCurrentStepIndex(0);
          setIsPlaying(false);
          setTraceLoading(false);
          return trace;
        }
      }
      throw new Error("No simulation steps returned for custom test code");
    } catch (err) {
      if (request !== traceRequestRef.current) return null;
      console.warn("Failed to simulate custom test:", err);
      setSimulationTrace(null);
      setIsPlaying(false);
      setTraceError(err.message || 'Unable to illustrate this test.');
      return null;
    } finally {
      if (request === traceRequestRef.current) setTraceLoading(false);
    }
  }, [
    snapshotId,
    selectedSourceFile,
    initialSourceFile,
    selectedTestFile,
    initialTestFile,
    selectedTestCaseId,
    initialTestCaseId,
    selectedFunctionName,
    initialFunctionName,
    selectedCategory,
    initialCategory,
    customTestCode,
  ]);

  const captureRuntimeTrace = useCallback(async (scope = 'test') => {
    if (!snapshotId || !simulationTrace?.testFilePath || traceLoading) return;
    setTraceLoading(true);
    setTraceError(null);
    setIsPlaying(false);
    const request = ++traceRequestRef.current;
    try {
      const response = await getUnitTestSimulationTrace(snapshotId, {
        sourceFilePath: selectedSourceFile || initialSourceFile,
        testFilePath: simulationTrace.testFilePath,
        testCaseTitle: simulationTrace.testCase?.fullTitle || simulationTrace.testCase?.title,
        functionName: selectedFunctionName || initialFunctionName,
        category: selectedCategory, capture: true, scope: scope === 'suite' ? 'suite' : 'test',
      });
      const trace = response?.data || response;
      if (request !== traceRequestRef.current) return;
      setSimulationTrace(trace);
      setCurrentStepIndex(0);
    } catch (error) {
      if (request !== traceRequestRef.current) return;
      setTraceError(error.message || 'Unable to record the test execution.');
    } finally { if (request === traceRequestRef.current) setTraceLoading(false); }
  }, [snapshotId, simulationTrace, traceLoading, selectedSourceFile, initialSourceFile, selectedFunctionName, initialFunctionName, selectedCategory]);

  return {
    // State
    selectedSourceFile,
    selectedTestFile,
    selectedTestCaseId,
    selectedFunctionName,
    selectedCategory,
    activeCodeView,
    currentStepIndex,
    isPlaying,
    playbackSpeed,
    sourcesData,
    sourcesLoading,
    simulationTrace,
    steps,
    totalSteps,
    currentStep,
    traceLoading,
    traceError,
    isKeyboardEnabled,
    customTestCode,

    // Actions
    actions: {
      captureRuntimeTrace,
      play,
      pause,
      togglePlay,
      stepForward,
      stepBackward,
      reset,
      jumpToEnd,
      jumpToStep,
      setPlaybackSpeed,
      setActiveCodeView,
      setCustomTestCode,
      simulateCustomTest,
      setSelectedSourceFile: (file) => {
        setCustomTestCode(null);
        setSelectedSourceFile(file);
        const found =
          (Array.isArray(sourcesData) && sourcesData.find((s) => s.filePath === file)) ||
          (Array.isArray(propSources) && propSources.find((s) => s.filePath === file));
        if (found?.functions && found.functions.length > 0) {
          setSelectedFunctionName(found.functions[0].name);
        } else {
          setSelectedFunctionName(null);
        }
        setCurrentStepIndex(0);
        setIsPlaying(false);
      },
      setSelectedTestFile,
      setSelectedTestCaseId,
      setSelectedFunctionName,
      setSelectedCategory,
      setIsKeyboardEnabled,
      refetchTrace: () => setRefreshTrigger((p) => p + 1),
      refetchSources: () => setRefreshTrigger((p) => p + 1),
    },
  };
}

export default useUnitTestSimulation;
