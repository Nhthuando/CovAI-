import { getJobDetailApi } from "../../services/job.service.js";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dagre from "dagre";
import {
  X,
  Info,
  ZoomIn,
  ZoomOut,
  GitBranch,
  ArrowLeft,
  TerminalSquare,
  Network,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ShieldCheck,
  Calculator,
  Layers,
  Activity,
  ExternalLink,
} from "lucide-react";
import {
  getProjectCfgApi,
  getProjectCcApi,
  getFileContentApi,
  buildCfgApi,
} from "../../services/project.service.js";
import { useBreakpoints } from "../../hooks/useMediaQuery";
import "./portfolio/portfolio.css";

/* --- ANIMATION VARIANTS --- */
const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, y: 20, transition: { duration: 0.3 } },
};

function syntaxHighlight(text) {
  return text
    .split(
      /(\bfunction\b|\bif\b|\belse\b|\breturn\b|\bconst\b|\blet\b|\bvar\b|"[^"]*"|'[^']*'|\b\d+\b)/g,
    )
    .map((part, i) => {
      if (
        ["function", "if", "else", "return", "const", "let", "var"].includes(
          part,
        )
      )
        return (
          <span key={i} className="text-[var(--ps-cobalt)] font-medium">
            {part}
          </span>
        );
      if (part.startsWith('"') || part.startsWith("'"))
        return (
          <span key={i} className="text-[var(--ps-emerald)]">
            {part}
          </span>
        );
      if (/^\d+$/.test(part))
        return (
          <span key={i} className="text-[var(--ps-amber)]">
            {part}
          </span>
        );
      return (
        <span key={i} className="text-[var(--ps-ink)]">
          {part}
        </span>
      );
    });
}

function computeLayout(nodes, edges) {
  if (!nodes || nodes.length === 0)
    return { nodes: [], edges: [], width: 400, height: 400 };
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    marginx: 50,
    marginy: 50,
    nodesep: 60,
    ranksep: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    // Label length heuristic for width
    const label = n.label || n.type || n.id;
    const width = Math.max(120, label.length * 8 + 40);
    g.setNode(n.id, { width, height: 40 });
  });

  edges.forEach((e) => {
    g.setEdge(e.from, e.to);
  });

  dagre.layout(g);

  const graphInfo = g.graph();
  const graphWidth = Math.max(graphInfo.width || 0, 400);
  const graphHeight = Math.max(graphInfo.height || 0, 300);

  return {
    width: graphWidth,
    height: graphHeight,
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, x: pos.x, y: pos.y, width: pos.width };
    }),
    edges: edges.map((e) => {
      const edgePos = g.edge(e.from, e.to);
      return { ...e, points: edgePos.points };
    }),
  };
}

const pointsToSvgPath = (points) => {
  if (!points || points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

const getComplexityMeta = (value) => {
  const v = value || 1;
  if (v <= 4) {
    return {
      level: "Low",
      riskText: "Low Risk",
      summary: "Low complexity, concise structure, easy to maintain.",
      recommendation:
        "Minimal defect risk. Standard unit test cases provide sufficient coverage.",
      color: "var(--ps-emerald)",
      textColor: "text-[var(--ps-emerald)]",
      badgeClass:
        "bg-[var(--ps-emerald)]/10 text-[var(--ps-emerald)] border-[var(--ps-emerald)]/25",
      tier: 1,
      icon: CheckCircle2,
    };
  }
  if (v <= 10) {
    return {
      level: "Moderate",
      riskText: "Moderate Risk",
      summary: "Moderate complexity with multiple decision paths.",
      recommendation:
        "Thoroughly test all conditional branches (if / else / switch / loop).",
      color: "var(--ps-amber)",
      textColor: "text-[var(--ps-amber)]",
      badgeClass:
        "bg-[var(--ps-amber)]/10 text-[var(--ps-amber)] border-[var(--ps-amber)]/25",
      tier: 2,
      icon: AlertTriangle,
    };
  }
  if (v <= 20) {
    return {
      level: "High",
      riskText: "High Risk",
      summary:
        "High complexity, difficult to exhaustively verify all execution paths.",
      recommendation:
        "Refactoring recommended: decompose into smaller helper functions or services.",
      color: "var(--ps-rose)",
      textColor: "text-[var(--ps-rose)]",
      badgeClass:
        "bg-[var(--ps-rose)]/10 text-[var(--ps-rose)] border-[var(--ps-rose)]/25",
      tier: 3,
      icon: AlertOctagon,
    };
  }
  return {
    level: "Critical",
    riskText: "Very High Risk",
    summary:
      "Critical complexity (spaghetti flow), very high probability of regression bugs.",
    recommendation:
      "Immediate refactoring mandatory before deploying to production.",
    color: "var(--ps-rose)",
    textColor: "text-[var(--ps-rose)]",
    badgeClass:
      "bg-[var(--ps-rose)]/12 text-[var(--ps-rose)] border-[var(--ps-rose)]/30",
    tier: 4,
    icon: AlertOctagon,
  };
};

/* --- NODE COMPONENTS --- */
function FuncNode({ label, x, y, onClick }) {
  return (
    <motion.div
      data-no-pan="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="group flex items-center justify-center ps-mono select-none cursor-pointer rounded-lg border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] hover:border-[var(--ps-cobalt)] text-[var(--ps-ink)] transition-colors duration-150"
      initial={{ x: "-50%", y: "-50%", scale: 1 }}
      whileHover={{
        scale: 1.02,
        x: "-50%",
        y: "-50%",
      }}
      whileTap={{ scale: 0.98, x: "-50%", y: "-50%" }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 10,
        fontSize: "12.5px",
        padding: "9px 18px",
        whiteSpace: "nowrap",
      }}
    >
      <Network
        size={14}
        className="mr-2 text-[var(--ps-ink-muted)] group-hover:text-[var(--ps-cobalt)] transition-colors"
      />
      <span>{label}()</span>
    </motion.div>
  );
}

function CFGNode({
  label,
  line,
  x,
  y,
  active = false,
  isDiamond = false,
  width = 120,
  isSelected = false,
  onClick,
}) {
  return (
    <motion.div
      data-no-pan="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      initial={{ x: "-50%", y: "-50%", scale: 0.96, opacity: 0 }}
      animate={{
        x: "-50%",
        y: "-50%",
        scale: isSelected ? 1.03 : 1,
        opacity: 1,
      }}
      transition={{ duration: 0.15 }}
      whileHover={{ scale: isSelected ? 1.04 : 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`flex items-center justify-center ps-mono select-none text-center cursor-pointer transition-colors duration-150 ${
        isDiamond ? "rounded-lg" : "rounded-md"
      } ${
        isSelected
          ? "border border-[var(--ps-cobalt)] bg-[var(--ps-surface-2)] text-[var(--ps-ink)] font-semibold ring-1 ring-[var(--ps-cobalt)]/40 z-30"
          : active
            ? "border border-[var(--ps-cobalt)]/70 bg-[var(--ps-surface)] text-[var(--ps-ink)] font-medium z-10"
            : "border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] hover:border-[var(--ps-cobalt)]/60 hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink)] z-10"
      }`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontSize: "12px",
        padding: "7px 16px",
        minWidth: `${width}px`,
      }}
    >
      {(isSelected || active) && (
        <span
          className={`w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0 ${
            isSelected ? "bg-[var(--ps-cobalt)]" : "bg-[var(--ps-cobalt)]/75"
          }`}
        />
      )}
      {isDiamond && (
        <GitBranch
          size={12.5}
          className="mr-1.5 text-[var(--ps-amber)] opacity-90 flex-shrink-0"
        />
      )}
      <span>{label}</span>
      {line ? (
        <span
          className={`text-[11px] ml-1.5 ps-mono ${
            isSelected
              ? "text-[var(--ps-cobalt)] font-medium"
              : "text-[var(--ps-ink-muted)]"
          }`}
        >
          L{line}
        </span>
      ) : null}
    </motion.div>
  );
}

/**
 * Normalizes POSIX paths for safe, cross-platform comparison
 */
export const normalizePathForCompare = (p) => {
  if (!p) return "";
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:.*?\/)?storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "")
    .replace(/^(?:.*?\/)?repo\//i, "")
    .toLowerCase();
};

/**
 * Checks whether candidate files contain a target file match
 */
export const hasCfgFileMatch = (candidateFiles, targetPath) => {
  if (
    !targetPath ||
    !Array.isArray(candidateFiles) ||
    candidateFiles.length === 0
  )
    return false;
  const targetNorm = normalizePathForCompare(targetPath);
  const strippedTarget = targetNorm.replace(
    /^(?:backend|server|client|api|app|frontend)\//i,
    "",
  );
  const baseTarget = targetNorm.split("/").pop();

  return candidateFiles.some((f) => {
    const fNorm = normalizePathForCompare(f);
    const strippedCandidate = fNorm.replace(
      /^(?:backend|server|client|api|app|frontend)\//i,
      "",
    );
    return (
      fNorm === targetNorm ||
      targetNorm.endsWith("/" + fNorm) ||
      fNorm.endsWith("/" + targetNorm) ||
      strippedCandidate === strippedTarget ||
      strippedTarget.endsWith("/" + strippedCandidate) ||
      strippedCandidate.endsWith("/" + strippedTarget) ||
      fNorm.split("/").pop() === baseTarget
    );
  });
};

/**
 * Matches target file within candidate CFG files
 */
export const findMatchingCfgFile = (candidateFiles, targetPath) => {
  if (
    !targetPath ||
    !Array.isArray(candidateFiles) ||
    candidateFiles.length === 0
  ) {
    return candidateFiles?.[0] || null;
  }
  const targetNorm = normalizePathForCompare(targetPath);

  // 1. Exact full path match
  const exact = candidateFiles.find(
    (f) => normalizePathForCompare(f) === targetNorm,
  );
  if (exact) return exact;

  // 2. Suffix match (endsWith)
  const endsWithMatch = candidateFiles.find(
    (f) =>
      targetNorm.endsWith("/" + normalizePathForCompare(f)) ||
      normalizePathForCompare(f).endsWith("/" + targetNorm),
  );
  if (endsWithMatch) return endsWithMatch;

  // 3. Match after stripping common monorepo root prefixes (backend/, server/, client/, api/, app/)
  const strippedTarget = targetNorm.replace(
    /^(?:backend|server|client|api|app|frontend)\//i,
    "",
  );
  const strippedMatch = candidateFiles.find((f) => {
    const strippedCandidate = normalizePathForCompare(f).replace(
      /^(?:backend|server|client|api|app|frontend)\//i,
      "",
    );
    return (
      strippedCandidate === strippedTarget ||
      strippedTarget.endsWith("/" + strippedCandidate) ||
      strippedCandidate.endsWith("/" + strippedTarget)
    );
  });
  if (strippedMatch) return strippedMatch;

  // 4. Basename match
  const baseTarget = targetNorm.split("/").pop();
  const baseMatch = candidateFiles.find(
    (f) => normalizePathForCompare(f).split("/").pop() === baseTarget,
  );
  if (baseMatch) return baseMatch;

  // 5. Prefix match (handles truncated paths with ... in UI)
  const cleanPrefix = targetNorm.replace(/\.{2,}$/, "");
  if (cleanPrefix.length > 5) {
    const prefixMatch = candidateFiles.find((f) =>
      normalizePathForCompare(f).startsWith(cleanPrefix),
    );
    if (prefixMatch) return prefixMatch;
  }

  return candidateFiles[0];
};

/**
 * Matches target function in file CFG list using a 5-tier resolution strategy:
 * 1. Exact function name match (or truncated prefix)
 * 2. Exact startLine match
 * 3. Innermost Span match
 * 4. Synthetic func_L{N} match
 * 5. Fallback to first function
 */
export const findMatchingCfgFunction = (
  fileCfgs,
  targetFuncName,
  targetLine,
) => {
  if (!Array.isArray(fileCfgs) || fileCfgs.length === 0) return null;
  const lineNum =
    targetLine && Number(targetLine) > 0 ? Number(targetLine) : null;

  // 1. Function name match (if not anonymous or synthetic func_L...)
  if (targetFuncName && typeof targetFuncName === "string") {
    const cleanTarget = targetFuncName.replace(/\(\)$/, "").trim();
    const isSyntheticOrAnon =
      /^func_l\d+$/i.test(cleanTarget) ||
      /^anonymous/i.test(cleanTarget) ||
      /^\(anonymous/i.test(cleanTarget);

    if (!isSyntheticOrAnon && cleanTarget.length > 0) {
      // 1a. Exact name match
      const exactMatch = fileCfgs.find((c) => c.functionName === cleanTarget);
      if (exactMatch) return exactMatch.functionName;

      // 1b. Case-insensitive match
      const caseMatch = fileCfgs.find(
        (c) => c.functionName?.toLowerCase() === cleanTarget.toLowerCase(),
      );
      if (caseMatch) return caseMatch.functionName;

      // 1c. Prefix match (handles truncated names like fallbackRewriteFr...)
      const prefix = cleanTarget.replace(/\.{2,}$/, "").trim();
      if (prefix.length >= 6) {
        const prefixMatch = fileCfgs.find(
          (c) =>
            c.functionName &&
            (c.functionName.startsWith(prefix) ||
              c.functionName.toLowerCase().startsWith(prefix.toLowerCase())),
        );
        if (prefixMatch) return prefixMatch.functionName;
      }
    }
  }

  // 2. Exact startLine match (avoids enclosing outer functions when target is callback)
  if (lineNum !== null) {
    const exactStartMatch = fileCfgs.find((c) => c.startLine === lineNum);
    if (exactStartMatch) return exactStartMatch.functionName;
  }

  // 3. Innermost Span match
  if (lineNum !== null) {
    const containingFunctions = fileCfgs.filter(
      (c) => c.startLine <= lineNum && c.endLine && c.endLine >= lineNum,
    );
    if (containingFunctions.length > 0) {
      containingFunctions.sort(
        (a, b) => a.endLine - a.startLine - (b.endLine - b.startLine),
      );
      return containingFunctions[0].functionName;
    }
  }

  // 4. Synthetic func_L{N} match
  if (targetFuncName && typeof targetFuncName === "string") {
    const match = targetFuncName.trim().match(/^func_l(\d+)$/i);
    if (match) {
      const parsedLine = Number(match[1]);
      const lineExact = fileCfgs.find((c) => c.startLine === parsedLine);
      if (lineExact) return lineExact.functionName;
    }
  }

  // 5. Fallback: return first function
  return fileCfgs[0].functionName;
};

async function rebuildCfg(projectId, snapshotId) {
  const response = await buildCfgApi(projectId, snapshotId);
  const jobId = response?.data?.job?.id;
  if (!jobId) throw new Error("CFG build did not return a job.");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const { job } = await getJobDetailApi(jobId);
    if (job?.status === "SUCCESS") return;
    if (["FAILED", "CANCELED"].includes(job?.status)) {
      throw new Error(job.errorMessage || "CFG build did not complete.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("CFG build is still running. Check the job queue.");
}

export default function CFGCalculator({
  project,
  snapshotId: selectedSnapshotId,
  onClose,
  initialFile,
  initialFunc,
  initialLine,
  onOpenFile,
}) {
  const cleanPropSnapshotId =
    typeof selectedSnapshotId === "object"
      ? selectedSnapshotId?.id || selectedSnapshotId?.snapshotId || ""
      : String(selectedSnapshotId || "").trim() === "[object Object]" ||
          selectedSnapshotId === "undefined" ||
          selectedSnapshotId === "null"
        ? ""
        : selectedSnapshotId || "";

  const targetSnapshotId =
    cleanPropSnapshotId ||
    project?.snapshotId ||
    project?.snapshots?.[0]?.id ||
    project?.latestSnapshotId ||
    "";
  const { isMobile } = useBreakpoints();
  const projectId = project?.id;
  const snapshotId =
    selectedSnapshotId ||
    project?.activeSnapshotId ||
    project?.latestSnapshotId ||
    project?.snapshots?.[0]?.id;
  const [cfgs, setCfgs] = useState([]);
  const [ccs, setCcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFunc, setSelectedFunc] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [highlightedLine, setHighlightedLine] = useState(null);
  const codeContainerRef = useRef(null);
  const [sourceCode, setSourceCode] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const canvasRef = useRef(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Resize state
  const [leftWidth, setLeftWidth] = useState(420);
  const [rightWidth, setRightWidth] = useState(400);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [topHeight, setTopHeight] = useState(30); // Percentage
  const [isResizingTop, setIsResizingTop] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeft) {
        setLeftWidth(Math.max(200, Math.min(800, e.clientX)));
      } else if (isResizingRight) {
        setRightWidth(
          Math.max(200, Math.min(800, window.innerWidth - e.clientX)),
        );
      } else if (isResizingTop) {
        const containerHeight = window.innerHeight;
        const newHeight = (e.clientY / containerHeight) * 100;
        setTopHeight(Math.max(10, Math.min(80, newHeight)));
      }
    };
    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
      setIsResizingTop(false);
      document.body.style.cursor = "default";
    };
    if (isResizingLeft || isResizingRight || isResizingTop) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = isResizingTop ? "row-resize" : "col-resize";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight, isResizingTop]);

  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      setError(null);
      // Refetch only after the job publishes the graphs.
      await rebuildCfg(projectId, snapshotId);
      const [cfgRes, ccRes] = await Promise.all([
        getProjectCfgApi(projectId, snapshotId),
        getProjectCcApi(projectId, snapshotId),
      ]);
      setCfgs(cfgRes.data || []);
      setCcs(ccRes.data || []);
      const files = [
        ...new Set((cfgRes?.data || []).map((cfg) => cfg.filePath)),
      ];
      setSelectedFile(
        findMatchingCfgFile(files, selectedFile || initialFile) ||
          files[0] ||
          null,
      );
      setSelectedFunc(null);
    } catch (err) {
      setError(err.message || "Failed to rebuild CFG");
    } finally {
      setRebuilding(false);
    }
  };

  const autoRebuiltRef = useRef(new Set());

  useEffect(() => {
    let current = true;
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        // Default to latest snapshot when no snapshot was selected
        let [cfgRes, ccRes] = await Promise.all([
          getProjectCfgApi(projectId, snapshotId),
          getProjectCcApi(projectId, snapshotId),
        ]);

        if (!current) return;
        let currentCfgs = cfgRes?.data || [];
        let currentCcs = ccRes?.data || [];
        let files = [...new Set(currentCfgs.map((c) => c.filePath))];

        // If user requested a specific file (initialFile) without existing CFG,
        // and auto-rebuild has not been attempted yet -> Trigger buildCfgApi once to fetch fresh CFG
        if (
          initialFile &&
          !hasCfgFileMatch(files, initialFile) &&
          !autoRebuiltRef.current.has(snapshotId || projectId) &&
          project?.id
        ) {
          autoRebuiltRef.current.add(snapshotId || projectId);
          setRebuilding(true);
          try {
            await rebuildCfg(projectId, snapshotId);
            const [cfgRes2, ccRes2] = await Promise.all([
              getProjectCfgApi(projectId, snapshotId),
              getProjectCcApi(projectId, snapshotId),
            ]);
            if (!current) return;
            currentCfgs = cfgRes2?.data || [];
            currentCcs = ccRes2?.data || [];
            files = [...new Set(currentCfgs.map((c) => c.filePath))];
          } catch (autoErr) {
            console.warn("Auto-rebuild CFG for missing file failed:", autoErr);
            if (current) setError(autoErr.message || "Failed to rebuild CFG");
          } finally {
            if (current) setRebuilding(false);
          }
        }

        setCfgs(currentCfgs);
        setCcs(currentCcs);

        if (currentCfgs.length > 0) {
          const targetFile =
            findMatchingCfgFile(files, initialFile) || files[0];
          setSelectedFile(targetFile);
          setSelectedFunc(null);

          if (initialFunc || initialLine) {
            const fileCfgs = currentCfgs.filter(
              (c) => c.filePath === targetFile,
            );
            const targetFunc = findMatchingCfgFunction(
              fileCfgs,
              initialFunc,
              initialLine,
            );
            if (targetFunc) {
              setSelectedFunc(targetFunc);
            }
          }
        }
      } catch (err) {
        if (current) setError(err.message || "Failed to fetch CFG/CC data");
      } finally {
        if (current) setLoading(false);
      }
    }
    if (projectId) fetchData();
    return () => {
      current = false;
    };
  }, [projectId, snapshotId, initialFile, initialFunc, initialLine]);

  // Keep selectedFile / selectedFunc synchronized if initialFile / initialFunc changes dynamically
  useEffect(() => {
    if (!initialFile || cfgs.length === 0) return;
    const files = [...new Set(cfgs.map((c) => c.filePath))];
    const matchedFile = findMatchingCfgFile(files, initialFile);
    if (matchedFile && matchedFile !== selectedFile) {
      setSelectedFile(matchedFile);
    }
    if (initialFunc || initialLine) {
      const relevantCfgs = cfgs.filter(
        (c) => c.filePath === (matchedFile || selectedFile),
      );
      const matchedFunc = findMatchingCfgFunction(
        relevantCfgs,
        initialFunc,
        initialLine,
      );
      if (matchedFunc && matchedFunc !== selectedFunc) {
        setSelectedFunc(matchedFunc);
      }
    }
  }, [initialFile, initialFunc, initialLine, cfgs]);

  useEffect(() => {
    setSourceCode("");
    if (!selectedFile || !project?.id) return;
    const controller = new AbortController();
    getFileContentApi(project.id, selectedFile, {
      snapshotId:
        targetSnapshotId ||
        project.snapshots?.[0]?.id ||
        project.latestSnapshotId,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) setSourceCode(res.data.content);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load CFG source code:", err);
        setSourceCode("// Failed to load source code");
      });
    return () => controller.abort();
  }, [selectedFile, project, targetSnapshotId]);

  const uniqueFiles = useMemo(() => {
    return [...new Set(cfgs.map((c) => c.filePath))];
  }, [cfgs]);

  const fileCfgs = useMemo(() => {
    return cfgs.filter((c) => c.filePath === selectedFile);
  }, [cfgs, selectedFile]);

  const fileCcs = useMemo(() => {
    return ccs.filter((c) => c.filePath === selectedFile);
  }, [ccs, selectedFile]);

  const activeCfg = useMemo(() => {
    return fileCfgs.find((c) => c.functionName === selectedFunc);
  }, [fileCfgs, selectedFunc]);

  const activeCc = useMemo(() => {
    return fileCcs.find((c) => c.functionName === selectedFunc);
  }, [fileCcs, selectedFunc]);

  const maxCc = useMemo(() => {
    if (fileCcs.length === 0) return 0;
    return Math.max(...fileCcs.map((c) => c.value));
  }, [fileCcs]);

  const isCallGraph = selectedFunc === null;

  // Process source code lines
  const sourceLines = useMemo(() => {
    return sourceCode.split("\n").map((text, i) => ({ num: i + 1, text }));
  }, [sourceCode]);

  // Smooth-scroll code pane to target function definition
  useEffect(() => {
    if (!selectedFunc || !activeCfg) return;
    const targetLine = activeCfg.startLine || initialLine;
    if (!targetLine) return;

    setHighlightedLine(targetLine);

    const timer = setTimeout(() => {
      const lineEl = document.getElementById(`cfg-source-line-${targetLine}`);
      if (lineEl && codeContainerRef.current) {
        lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [selectedFunc, activeCfg, sourceCode, initialLine]);

  // DAGRE Layouts
  const graphLayout = useMemo(() => {
    if (isCallGraph) {
      // Just layout the functions side by side or vertically
      const nodes = fileCfgs.map((c, i) => ({
        id: c.functionName,
        label: c.functionName,
      }));
      const edges = [];
      // Create a dummy chain so dagre lays them out nicely vertically
      for (let i = 0; i < nodes.length - 1; i++)
        edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
      return computeLayout(nodes, edges);
    } else {
      if (!activeCfg || !activeCfg.graphJson)
        return { nodes: [], edges: [], width: 400, height: 400 };
      try {
        const parsed = JSON.parse(activeCfg.graphJson);
        let nodes = parsed.nodes || [];
        let edges = parsed.edges || [];

        if (nodes.every((node) => node.type === "start"))
          return { nodes: [], edges: [], width: 400, height: 400 };

        // Add virtual exit node to conform to standard McCabe CFG calculation
        if (nodes.length > 0) {
          const fromNodeIds = new Set(edges.map((e) => e.from));
          const leafNodes = nodes.filter((n) => !fromNodeIds.has(n.id));

          if (leafNodes.length > 0) {
            const exitNodeId = "virtual_exit_node";
            nodes = [
              ...nodes,
              {
                id: exitNodeId,
                type: "exit",
                label: "Virtual Exit",
                line: activeCfg?.endLine,
              },
            ];
            leafNodes.forEach((leaf) => {
              edges = [...edges, { from: leaf.id, to: exitNodeId }];
            });
          }
        }

        return computeLayout(nodes, edges);
      } catch (e) {
        console.warn("Unable to read CFG graph:", e);
        return { nodes: [], edges: [], width: 400, height: 400 };
      }
    }
  }, [isCallGraph, fileCfgs, activeCfg]);

  // Center the graph at 100% when the file or function changes.
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [selectedFile, selectedFunc]);

  // Handle canvas mouse drag for panning
  const handleCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("[data-no-pan]")) return;

    setIsDragging(true);
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - dragOriginRef.current.startX;
      const dy = e.clientY - dragOriginRef.current.startY;
      setPan({
        x: dragOriginRef.current.panX + dx,
        y: dragOriginRef.current.panY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Handle canvas mouse wheel zoom
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const onWheel = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) =>
        Math.min(Math.max(Number((z * zoomFactor).toFixed(2)), 0.2), 3),
      );
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Handle node selection and smooth scroll to source line
  const handleNodeClick = (node) => {
    setSelectedNodeId(node.id);
    const targetLine =
      node.line ||
      (node.type === "start"
        ? activeCfg?.startLine
        : node.type === "exit"
          ? activeCfg?.endLine
          : null);

    if (targetLine) {
      setHighlightedLine(targetLine);
      const el = document.getElementById(`cfg-source-line-${targetLine}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphLayout.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphLayout.nodes]);

  const selectedNodeInEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graphLayout.edges.filter((e) => e.to === selectedNode.id);
  }, [selectedNode, graphLayout.edges]);

  const selectedNodeOutEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graphLayout.edges.filter((e) => e.from === selectedNode.id);
  }, [selectedNode, graphLayout.edges]);

  const selectedNodeLineText = useMemo(() => {
    if (!selectedNode) return "";
    const targetLine =
      selectedNode.line ||
      (selectedNode.type === "start"
        ? activeCfg?.startLine
        : selectedNode.type === "exit"
          ? activeCfg?.endLine
          : null);
    if (!targetLine) return "";
    const lineObj = sourceLines.find((l) => l.num === targetLine);
    return lineObj ? lineObj.text.trim() : "";
  }, [selectedNode, sourceLines, activeCfg]);

  // Sync scroll and highlight when active function CFG changes
  useEffect(() => {
    setSelectedNodeId(null);
    if (activeCfg?.startLine) {
      setHighlightedLine(activeCfg.startLine);
      const timer = setTimeout(() => {
        const el = document.getElementById(
          `cfg-source-line-${activeCfg.startLine}`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setHighlightedLine(null);
    }
  }, [selectedFunc, activeCfg]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="portfolio-studio fixed inset-0 z-50 flex flex-col bg-[var(--ps-bg)] text-[var(--ps-ink)]"
      style={{
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* --- HEADER --- */}
      <div className="flex items-center justify-between flex-shrink-0 px-4 h-12 bg-[var(--ps-surface)] border-b border-[var(--ps-line)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <select
            value={selectedFile || ""}
            onChange={(e) => {
              setSelectedFile(e.target.value);
              setSelectedFunc(null);
            }}
            className="ps-select h-8 rounded-md px-2.5 text-xs ps-mono outline-none cursor-pointer max-w-[320px]"
          >
            {uniqueFiles.map((f) => (
              <option
                key={f}
                value={f}
                className="bg-[var(--ps-surface)] text-[var(--ps-ink)]"
              >
                {f}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 text-xs text-[var(--ps-ink-secondary)] min-w-0">
            {!isCallGraph && (
              <>
                <span className="text-[var(--ps-ink-muted)]">/</span>
                <span className="text-[var(--ps-ink)] ps-mono font-medium truncate">
                  {selectedFunc}()
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenFile && selectedFile && (
            <button
              onClick={() => {
                onClose?.();
                onOpenFile(
                  selectedFile,
                  activeCfg?.startLine || highlightedLine || initialLine || 1,
                  selectedFunc,
                  activeCfg?.endLine,
                );
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--ps-line-strong)] bg-[var(--ps-surface-2)] hover:bg-[var(--ps-line)]/60 text-[var(--ps-ink)] transition-colors duration-150 active:scale-[0.98] text-xs font-medium cursor-pointer"
              title="Open this function in Monaco Editor"
            >
              <ExternalLink
                size={13}
                className="text-[var(--ps-ink-secondary)]"
              />
              <span>Open in Editor</span>
            </button>
          )}
          <button
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors duration-150 cursor-pointer bg-transparent border-none"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {loading || rebuilding ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--ps-ink-secondary)]">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          >
            <RefreshCw size={22} className="text-[var(--ps-cobalt)]" />
          </motion.div>
          <span className="text-xs ps-mono text-[var(--ps-ink-muted)]">
            {rebuilding ? "Rebuilding CFG..." : "Loading analysis data..."}
          </span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--ps-rose)]">
          <span className="text-xs">{error}</span>
          <button
            onClick={handleRebuild}
            className="ps-btn-contrast px-4 py-2 rounded-md cursor-pointer text-xs font-medium flex items-center gap-2 transition-colors duration-150"
          >
            <RefreshCw size={13} /> Rebuild CFG
          </button>
        </div>
      ) : cfgs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <Network
              size={36}
              className="text-[var(--ps-ink-muted)] opacity-60"
            />
            <span className="text-sm font-semibold text-[var(--ps-ink)]">
              No CFG data available
            </span>
            <span className="text-xs text-[var(--ps-ink-secondary)] max-w-md leading-relaxed">
              Control Flow Graph and Cyclomatic Complexity data have not been
              generated for the current snapshot. Click the button below to
              build.
            </span>
          </div>
          <button
            onClick={handleRebuild}
            className="ps-btn-contrast px-4 py-2 rounded-md cursor-pointer text-xs font-medium flex items-center gap-2 transition-colors duration-150"
          >
            <RefreshCw size={14} /> Build CFG & CC
          </button>
        </div>
      ) : (
        /* --- MAIN CONTENT --- */
        <div
          style={{
            flex: 1,
            display: "flex",
            overflowX: isMobile ? "hidden" : "auto",
            overflowY: "hidden",
            background: "var(--ps-bg)",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              height: "100%",
              width: "100%",
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            {/* LEFT COLUMN: Source Code */}
            <div
              style={{
                width: isMobile ? "100%" : `${leftWidth}px`,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid var(--ps-line)",
                background: "var(--ps-surface)",
                height: isMobile ? `${topHeight}%` : "100%",
                position: "relative",
              }}
            >
              <div
                onMouseDown={() =>
                  isMobile ? setIsResizingTop(true) : setIsResizingLeft(true)
                }
                style={{
                  position: "absolute",
                  [isMobile ? "bottom" : "right"]: -3,
                  top: isMobile ? "auto" : 0,
                  bottom: isMobile ? -3 : 0,
                  width: isMobile ? "100%" : 6,
                  height: isMobile ? 6 : "100%",
                  cursor: isMobile ? "row-resize" : "col-resize",
                  zIndex: 100,
                }}
              />
              <div className="h-10 px-4 flex items-center justify-between border-b border-[var(--ps-line)] bg-[var(--ps-surface)] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--ps-ink)]">
                    Source code
                  </span>
                  {highlightedLine && (
                    <span className="bg-[var(--ps-cobalt)]/10 text-[var(--ps-cobalt)] border border-[var(--ps-cobalt)]/30 px-2 py-0.5 rounded-md text-[11px] ps-mono">
                      Line {highlightedLine}
                    </span>
                  )}
                </div>
                <span className="bg-[var(--ps-inset)] text-[var(--ps-ink-muted)] border border-[var(--ps-line)] px-2 py-0.5 rounded-md text-[10px] ps-mono">
                  JS/TS
                </span>
              </div>
              <div
                ref={codeContainerRef}
                className="flex-1 overflow-y-auto py-3 ps-mono text-xs leading-relaxed bg-[var(--ps-bg)]"
              >
                {sourceLines.map((line) => {
                  const isTargetLine = highlightedLine === line.num;
                  const isActiveScope =
                    activeCfg &&
                    line.num >= activeCfg.startLine &&
                    line.num <= activeCfg.endLine;
                  const isDimmed =
                    !isCallGraph && !isActiveScope && !isTargetLine;

                  return (
                    <div
                      key={line.num}
                      id={`cfg-source-line-${line.num}`}
                      onClick={() => {
                        const matchingNode = graphLayout.nodes.find(
                          (n) => n.line === line.num,
                        );
                        if (matchingNode) {
                          setSelectedNodeId(matchingNode.id);
                        }
                        setHighlightedLine(line.num);
                      }}
                      className={`flex items-start px-3 py-0.5 transition-colors duration-100 cursor-pointer ${
                        isTargetLine
                          ? "bg-[var(--ps-cobalt)]/12 border-l-2 border-l-[var(--ps-cobalt)]"
                          : isActiveScope
                            ? "bg-[var(--ps-surface)] border-l-2 border-l-[var(--ps-line-strong)] hover:bg-[var(--ps-surface-2)]/60"
                            : "border-l-2 border-l-transparent hover:bg-[var(--ps-surface)]"
                      } ${isDimmed ? "opacity-40" : "opacity-100"}`}
                    >
                      <span
                        className={`w-10 flex-shrink-0 text-right pr-2.5 select-none ps-mono text-[11px] flex items-center justify-end gap-1 ${
                          isTargetLine
                            ? "text-[var(--ps-cobalt)] font-semibold"
                            : isActiveScope
                              ? "text-[var(--ps-ink-secondary)]"
                              : "text-[var(--ps-ink-muted)]"
                        }`}
                      >
                        {isTargetLine && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-cobalt)]" />
                        )}
                        <span>{line.num}</span>
                      </span>
                      <span
                        className={`whitespace-pre-wrap break-all flex-1 ps-mono text-xs ${
                          isTargetLine
                            ? "text-[var(--ps-ink)] font-medium"
                            : "text-[var(--ps-ink)]"
                        }`}
                      >
                        {syntaxHighlight(line.text)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE COLUMN: Graph Area */}
            <div
              style={{
                flex: 1,
                minWidth: isMobile ? "100%" : "550px",
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid var(--ps-line)",
                background: "var(--ps-bg)",
                position: "relative",
                height: isMobile ? "40%" : "100%",
              }}
            >
              <div className="h-10 px-4 flex items-center justify-between border-b border-[var(--ps-line)] bg-[var(--ps-surface)] z-20 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  {!isCallGraph && (
                    <button
                      onClick={() => setSelectedFunc(null)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--ps-line)] bg-[var(--ps-inset)] hover:border-[var(--ps-line-strong)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors duration-150 text-xs font-medium cursor-pointer"
                    >
                      <ArrowLeft size={13} /> Back
                    </button>
                  )}
                  <span className="text-xs font-medium text-[var(--ps-ink)]">
                    {isCallGraph ? "Functions in file" : "Control flow graph"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-[var(--ps-inset)] h-7 px-2 rounded-md border border-[var(--ps-line)]">
                  <ZoomOut
                    size={13}
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(
                          Math.max(Number((z - 0.15).toFixed(2)), 0.2),
                          3,
                        ),
                      )
                    }
                    className="cursor-pointer text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors"
                    title="Zoom Out"
                  />
                  <span className="text-[11px] text-[var(--ps-ink-secondary)] w-10 text-center ps-mono select-none">
                    {Math.round(zoom * 100)}%
                  </span>
                  <ZoomIn
                    size={13}
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(
                          Math.max(Number((z + 0.15).toFixed(2)), 0.2),
                          3,
                        ),
                      )
                    }
                    className="cursor-pointer text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors"
                    title="Zoom In"
                  />
                  <div className="w-[1px] h-3.5 bg-[var(--ps-line)] mx-1" />
                  <button
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Reset View (Center Graph)"
                    className="flex items-center gap-1 text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors p-0.5 cursor-pointer bg-transparent border-none text-[11px] ps-mono"
                  >
                    <RotateCcw size={11.5} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <div
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                style={{
                  flex: 1,
                  position: "relative",
                  overflow: "hidden",
                  backgroundColor: "var(--ps-bg)",
                  backgroundImage:
                    "radial-gradient(var(--ps-line) 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: isDragging ? "none" : "transform 0.1s ease-out",
                    willChange: "transform",
                  }}
                >
                  {graphLayout.nodes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--ps-ink-secondary)]">
                      <GitBranch
                        size={28}
                        className="text-[var(--ps-ink-muted)] mb-3 opacity-60"
                      />
                      <span className="text-sm font-medium text-[var(--ps-ink)]">
                        No graph nodes found
                      </span>
                      <span className="text-xs text-[var(--ps-ink-muted)] mt-1">
                        This function might be empty or unparseable.
                      </span>
                    </div>
                  ) : isCallGraph ? (
                    /* --- CALL GRAPH --- */
                    <div
                      style={{
                        position: "relative",
                        width: `${graphLayout.width}px`,
                        height: `${graphLayout.height}px`,
                      }}
                    >
                      {graphLayout.nodes.map((n) => (
                        <FuncNode
                          key={n.id}
                          label={n.id}
                          x={n.x}
                          y={n.y}
                          onClick={() => setSelectedFunc(n.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    /* --- CFG --- */
                    <div
                      style={{
                        position: "relative",
                        width: `${graphLayout.width}px`,
                        height: `${graphLayout.height}px`,
                      }}
                    >
                      <svg
                        width={graphLayout.width}
                        height={graphLayout.height}
                        style={{
                          position: "absolute",
                          inset: 0,
                          pointerEvents: "none",
                          overflow: "visible",
                        }}
                      >
                        <defs>
                          <marker
                            id="arrowhead"
                            markerWidth="8"
                            markerHeight="6"
                            refX="7"
                            refY="3"
                            orient="auto"
                          >
                            <polygon
                              points="0 0, 8 3, 0 6"
                              fill="var(--ps-cobalt)"
                            />
                          </marker>
                        </defs>
                        {graphLayout.edges.map((e, i) => (
                          <path
                            key={i}
                            d={pointsToSvgPath(e.points)}
                            fill="none"
                            stroke="var(--ps-cobalt)"
                            strokeOpacity="0.6"
                            strokeWidth="1.5"
                            markerEnd="url(#arrowhead)"
                          />
                        ))}
                      </svg>

                      {graphLayout.nodes.map((n) => (
                        <CFGNode
                          key={n.id}
                          label={n.label || n.type || n.id}
                          line={n.line}
                          x={n.x}
                          y={n.y}
                          width={n.width}
                          isDiamond={n.type === "condition"}
                          active={
                            n.type === "start" ||
                            n.type === "return" ||
                            n.type === "exit"
                          }
                          isSelected={selectedNodeId === n.id}
                          onClick={() => handleNodeClick(n)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Canvas Status Strip */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-[var(--ps-ink-muted)] bg-[var(--ps-surface)] px-3 py-1.5 rounded-md border border-[var(--ps-line)] flex items-center gap-2 whitespace-nowrap pointer-events-none select-none z-20">
                  <Info size={13} className="text-[var(--ps-ink-muted)]" />
                  <span>
                    {isCallGraph
                      ? "Click a function node to analyze its CFG • Drag canvas to pan"
                      : "Click any node to navigate to code • Drag canvas to pan • Scroll to zoom"}
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Metrics */}
            <div
              style={{
                width: isMobile ? "100%" : `${rightWidth}px`,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                padding: isMobile ? "16px" : "20px",
                overflowY: "auto",
                background: "var(--ps-surface)",
                height: isMobile ? "30%" : "100%",
                position: "relative",
              }}
            >
              {!isMobile && (
                <div
                  onMouseDown={() => setIsResizingRight(true)}
                  style={{
                    position: "absolute",
                    left: -3,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    cursor: "col-resize",
                    zIndex: 100,
                  }}
                />
              )}
              <AnimatePresence mode="wait">
                {isCallGraph ? (
                  <motion.div
                    key="metrics-macro"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col h-full"
                  >
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--ps-line)]">
                      <Layers
                        size={14}
                        className="text-[var(--ps-ink-muted)]"
                      />
                      <div className="text-xs font-medium text-[var(--ps-ink)]">
                        File architecture overview
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-[var(--ps-inset)] p-3.5 rounded-lg border border-[var(--ps-line)]">
                        <div className="text-[11px] text-[var(--ps-ink-muted)] mb-1">
                          Total functions
                        </div>
                        <div className="text-2xl ps-mono font-semibold text-[var(--ps-ink)] tabular-nums">
                          {fileCfgs.length}
                        </div>
                      </div>
                      <div className="bg-[var(--ps-inset)] p-3.5 rounded-lg border border-[var(--ps-line)]">
                        <div className="text-[11px] text-[var(--ps-ink-muted)] mb-1">
                          Max McCabe CC
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl ps-mono font-semibold text-[var(--ps-ink)] tabular-nums">
                            {maxCc}
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              maxCc >= 10
                                ? "bg-[var(--ps-rose)]"
                                : maxCc >= 5
                                  ? "bg-[var(--ps-amber)]"
                                  : "bg-[var(--ps-emerald)]"
                            }`}
                            title={
                              maxCc >= 10
                                ? "High complexity"
                                : maxCc >= 5
                                  ? "Moderate complexity"
                                  : "Low complexity"
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {/* Complexity Distribution */}
                    <div className="rounded-lg p-4 border border-[var(--ps-line)] bg-[var(--ps-inset)] mb-4">
                      <div className="text-xs font-medium text-[var(--ps-ink)] mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Activity
                            size={13}
                            className="text-[var(--ps-ink-muted)]"
                          />
                          <span>Complexity distribution</span>
                        </div>
                        <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)] font-normal">
                          {fileCcs.length} analyzed
                        </span>
                      </div>
                      <div className="flex gap-0.5 h-1.5 w-full rounded-sm overflow-hidden bg-[var(--ps-surface-2)] border border-[var(--ps-line)] mb-3">
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value <= 4).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--ps-emerald)]/85 transition-all"
                          title="Low risk (<= 4)"
                        />
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value > 4 && c.value <= 10).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--ps-amber)]/85 transition-all"
                          title="Moderate risk (5-10)"
                        />
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value > 10).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--ps-rose)]/85 transition-all"
                          title="High risk (> 10)"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] ps-mono text-[var(--ps-ink-secondary)]">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-emerald)] inline-block" />
                          Low ({fileCcs.filter((c) => c.value <= 4).length})
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-amber)] inline-block" />
                          Mod (
                          {
                            fileCcs.filter((c) => c.value > 4 && c.value <= 10)
                              .length
                          }
                          )
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-rose)] inline-block" />
                          High ({fileCcs.filter((c) => c.value > 10).length})
                        </span>
                      </div>
                    </div>

                    {/* Navigation Help */}
                    <div className="rounded-lg p-4 border border-[var(--ps-line)] bg-[var(--ps-inset)]">
                      <div className="flex items-center gap-2 mb-2 text-[var(--ps-ink)] font-medium text-xs">
                        <Info
                          size={13.5}
                          className="text-[var(--ps-ink-muted)]"
                        />
                        <span>Call graph navigation</span>
                      </div>
                      <p className="text-xs text-[var(--ps-ink-secondary)] leading-relaxed m-0">
                        Select a function node in the Call Graph to inspect its
                        internal Control Flow Graph, McCabe complexity index,
                        decision paths, and recommended test cases.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="metrics-micro"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col h-full"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--ps-line)] gap-2">
                      <div className="flex items-center gap-2">
                        <Activity
                          size={14}
                          className="text-[var(--ps-ink-muted)]"
                        />
                        <span className="text-xs font-medium text-[var(--ps-ink)]">
                          Complexity analysis
                        </span>
                      </div>
                      <span className="text-[11px] ps-mono px-2 py-0.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)] text-[var(--ps-ink-secondary)] truncate max-w-[140px]">
                        {selectedFunc}()
                      </span>
                    </div>

                    {/* --- SELECTED NODE INSPECTOR --- */}
                    {selectedNode ? (
                      <div className="rounded-lg border border-[var(--ps-cobalt)]/40 bg-[var(--ps-inset)] p-3.5 mb-4">
                        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[var(--ps-line)]">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ps-ink)]">
                            <GitBranch
                              size={13}
                              className="text-[var(--ps-ink-muted)]"
                            />
                            <span>Node inspector</span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedNodeId(null);
                              setHighlightedLine(null);
                            }}
                            title="Deselect Node"
                            className="flex items-center gap-1 text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors px-1.5 py-0.5 rounded-md hover:bg-[var(--ps-surface-2)] cursor-pointer bg-transparent border-none text-[11px] ps-mono"
                          >
                            <X size={12} />
                            <span>Deselect</span>
                          </button>
                        </div>

                        {/* Node Identity & Type */}
                        <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="ps-mono text-sm font-semibold text-[var(--ps-ink)]">
                              {selectedNode.label ||
                                selectedNode.type ||
                                selectedNode.id}
                            </span>
                            {selectedNode.line && (
                              <span className="text-[11px] ps-mono text-[var(--ps-cobalt)] bg-[var(--ps-cobalt)]/10 border border-[var(--ps-cobalt)]/25 px-2 py-0.5 rounded-md">
                                Line {selectedNode.line}
                              </span>
                            )}
                          </div>

                          <span
                            className={`text-[10.5px] ps-mono font-medium px-2 py-0.5 rounded-md border ${
                              selectedNode.type === "condition"
                                ? "bg-[var(--ps-amber)]/10 text-[var(--ps-amber)] border-[var(--ps-amber)]/25"
                                : selectedNode.type === "start"
                                  ? "bg-[var(--ps-cobalt)]/10 text-[var(--ps-cobalt)] border-[var(--ps-cobalt)]/25"
                                  : selectedNode.type === "return" ||
                                      selectedNode.type === "exit"
                                    ? "bg-[var(--ps-rose)]/10 text-[var(--ps-rose)] border-[var(--ps-rose)]/25"
                                    : "bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] border-[var(--ps-line)]"
                            }`}
                          >
                            {selectedNode.type === "condition"
                              ? "Decision (Branch)"
                              : selectedNode.type === "start"
                                ? "Function Entry"
                                : selectedNode.type === "return"
                                  ? "Return Exit"
                                  : selectedNode.type === "exit"
                                    ? "Virtual Exit"
                                    : "Sequential Stmt"}
                          </span>
                        </div>

                        {/* Code snippet preview */}
                        {selectedNodeLineText && (
                          <div className="mb-2.5 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] p-2.5 ps-mono text-xs text-[var(--ps-ink)] leading-relaxed">
                            <div className="text-[10px] text-[var(--ps-ink-muted)] mb-1.5 flex items-center justify-between">
                              <span>Source line preview</span>
                              <span className="text-[var(--ps-cobalt)] ps-mono">
                                L{selectedNode.line || activeCfg?.startLine}
                              </span>
                            </div>
                            <div className="text-xs ps-mono whitespace-pre-wrap break-all text-[var(--ps-ink)] bg-[var(--ps-bg)] p-2 rounded-md border border-[var(--ps-line)]">
                              {syntaxHighlight(selectedNodeLineText)}
                            </div>
                          </div>
                        )}

                        {/* Connectivity Grid */}
                        <div className="grid grid-cols-3 gap-2 mb-2.5">
                          <div className="p-2 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                            <div className="text-[10px] text-[var(--ps-ink-muted)]">
                              In-degree
                            </div>
                            <div className="text-sm ps-mono font-semibold text-[var(--ps-ink)] tabular-nums mt-0.5">
                              {selectedNodeInEdges.length}
                            </div>
                          </div>
                          <div className="p-2 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                            <div className="text-[10px] text-[var(--ps-ink-muted)]">
                              Out-degree
                            </div>
                            <div className="text-sm ps-mono font-semibold text-[var(--ps-ink)] tabular-nums mt-0.5">
                              {selectedNodeOutEdges.length}
                            </div>
                          </div>
                          <div className="p-2 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                            <div className="text-[10px] text-[var(--ps-ink-muted)]">
                              Complexity
                            </div>
                            <div
                              className={`text-sm ps-mono font-semibold tabular-nums mt-0.5 ${
                                selectedNode.type === "condition"
                                  ? "text-[var(--ps-amber)]"
                                  : "text-[var(--ps-ink-secondary)]"
                              }`}
                            >
                              {selectedNode.type === "condition"
                                ? "+1 CC"
                                : "+0"}
                            </div>
                          </div>
                        </div>

                        {/* Node Flow Description */}
                        <div className="text-[11px] text-[var(--ps-ink-secondary)] bg-[var(--ps-surface)] p-2.5 rounded-md border border-[var(--ps-line)] leading-relaxed">
                          {selectedNode.type === "condition" && (
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-amber)] mt-1.5 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--ps-ink)] font-medium">
                                  Branching node:
                                </strong>{" "}
                                Evaluates predicate condition and creates 2
                                alternative execution branches (+1 McCabe
                                Complexity).
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "start" && (
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-cobalt)] mt-1.5 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--ps-ink)] font-medium">
                                  Entry point:
                                </strong>{" "}
                                Function entry root node initializing call scope
                                and parameter bindings.
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "return" && (
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-rose)] mt-1.5 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--ps-ink)] font-medium">
                                  Return statement:
                                </strong>{" "}
                                Terminates execution along this branch and
                                yields return value to caller.
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "exit" && (
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-rose)] mt-1.5 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--ps-ink)] font-medium">
                                  Terminal sink:
                                </strong>{" "}
                                Virtual McCabe exit node absorbing all terminal
                                return paths (P = 1).
                              </span>
                            </span>
                          )}
                          {selectedNode.type !== "condition" &&
                            selectedNode.type !== "start" &&
                            selectedNode.type !== "return" &&
                            selectedNode.type !== "exit" && (
                              <span className="flex items-start gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-ink-muted)] mt-1.5 flex-shrink-0 inline-block" />
                                <span>
                                  <strong className="text-[var(--ps-ink)] font-medium">
                                    Sequential statement:
                                  </strong>{" "}
                                  Linear execution block without conditional
                                  branching.
                                </span>
                              </span>
                            )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--ps-line-strong)] p-3.5 mb-4 text-center bg-[var(--ps-inset)]/60">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--ps-ink-secondary)]">
                          <Info
                            size={13}
                            className="text-[var(--ps-ink-muted)]"
                          />
                          <span>
                            Click any node in graph to inspect its parameters
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Radial Meter & Status Card */}
                    {(() => {
                      const ccVal = activeCc?.value || 1;
                      const meta = getComplexityMeta(ccVal);
                      const MetaIcon = meta.icon;
                      const circumference = 364.4; // 2 * PI * 58
                      const dashoffset =
                        circumference -
                        (circumference * Math.min(ccVal, 20)) / 20;

                      return (
                        <>
                          <div className="flex flex-col items-center justify-center p-5 mb-4 rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)]">
                            <div className="relative flex items-center justify-center w-36 h-36">
                              <svg className="w-full h-full -rotate-90">
                                <circle
                                  cx="72"
                                  cy="72"
                                  r="58"
                                  stroke="var(--ps-line-strong)"
                                  strokeWidth="7"
                                  fill="none"
                                  opacity="0.45"
                                />
                                <circle
                                  cx="72"
                                  cy="72"
                                  r="58"
                                  stroke={meta.color}
                                  strokeWidth="7"
                                  fill="none"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={dashoffset}
                                  strokeLinecap="round"
                                  style={{
                                    transition:
                                      "stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                                  }}
                                />
                              </svg>
                              <div className="absolute flex flex-col items-center">
                                <span className="text-3xl font-semibold ps-mono text-[var(--ps-ink)] tabular-nums tracking-tight">
                                  {ccVal}
                                </span>
                                <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)] mt-0.5">
                                  McCabe CC
                                </span>
                              </div>
                            </div>

                            {/* Status Pill */}
                            <div className="mt-4 flex flex-col items-center gap-2.5 w-full">
                              <div
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${meta.badgeClass}`}
                              >
                                <MetaIcon size={13} />
                                <span>
                                  {meta.level} Complexity ({meta.riskText})
                                </span>
                              </div>

                              <p className="text-center text-xs text-[var(--ps-ink-secondary)]">
                                {meta.summary}
                              </p>

                              {/* 4-Tier Interactive Scale Bar */}
                              <div className="w-full px-1 mt-1">
                                <div className="flex gap-1 h-1.5 w-full rounded-sm overflow-hidden bg-[var(--ps-surface-2)]">
                                  <div
                                    className={`flex-1 rounded-sm transition-all duration-200 ${
                                      meta.tier === 1
                                        ? "bg-[var(--ps-emerald)]"
                                        : "bg-[var(--ps-line)] opacity-50"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-sm transition-all duration-200 ${
                                      meta.tier === 2
                                        ? "bg-[var(--ps-amber)]"
                                        : "bg-[var(--ps-line)] opacity-50"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-sm transition-all duration-200 ${
                                      meta.tier === 3
                                        ? "bg-[var(--ps-rose)]"
                                        : "bg-[var(--ps-line)] opacity-50"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-sm transition-all duration-200 ${
                                      meta.tier === 4
                                        ? "bg-[var(--ps-rose)]"
                                        : "bg-[var(--ps-line)] opacity-50"
                                    }`}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] ps-mono text-[var(--ps-ink-muted)] mt-1.5 px-0.5">
                                  <span
                                    className={
                                      meta.tier === 1
                                        ? "text-[var(--ps-emerald)] font-medium"
                                        : ""
                                    }
                                  >
                                    1-4 Low
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 2
                                        ? "text-[var(--ps-amber)] font-medium"
                                        : ""
                                    }
                                  >
                                    5-10 Mod
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 3
                                        ? "text-[var(--ps-rose)] font-medium"
                                        : ""
                                    }
                                  >
                                    11-20 High
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 4
                                        ? "text-[var(--ps-rose)] font-medium"
                                        : ""
                                    }
                                  >
                                    20+ Crit
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Graph Formula Card */}
                          <div className="rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)] p-4 mb-4">
                            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[var(--ps-line)]">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ps-ink)]">
                                <Calculator
                                  size={13}
                                  className="text-[var(--ps-ink-muted)]"
                                />
                                <span>Graph formula</span>
                              </div>
                              <span className="text-[11px] ps-mono text-[var(--ps-ink-secondary)] bg-[var(--ps-surface)] px-2 py-0.5 rounded-md border border-[var(--ps-line)]">
                                M = E - N + 2P
                              </span>
                            </div>

                            {/* Equation calculation visualization */}
                            <div className="bg-[var(--ps-surface)] rounded-md py-2 px-3 mb-3 border border-[var(--ps-line)] flex items-center justify-center gap-2 ps-mono text-xs text-[var(--ps-ink)] tabular-nums">
                              <span className="font-semibold text-[var(--ps-cobalt)] text-sm">
                                {ccVal}
                              </span>
                              <span className="text-[var(--ps-ink-muted)]">
                                =
                              </span>
                              <span className="font-medium">
                                {graphLayout.edges.length}
                              </span>
                              <span className="text-[var(--ps-ink-muted)] text-[10px]">
                                (E)
                              </span>
                              <span className="text-[var(--ps-ink-muted)]">
                                -
                              </span>
                              <span className="font-medium">
                                {graphLayout.nodes.length}
                              </span>
                              <span className="text-[var(--ps-ink-muted)] text-[10px]">
                                (N)
                              </span>
                              <span className="text-[var(--ps-ink-muted)]">
                                +
                              </span>
                              <span className="font-medium">2</span>
                              <span className="text-[var(--ps-ink-muted)] text-[10px]">
                                (P)
                              </span>
                            </div>

                            {/* 3 Metrics Mini Cards Grid */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="p-2.5 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                                <div className="text-[10.5px] text-[var(--ps-ink-muted)]">
                                  Edges (E)
                                </div>
                                <div className="text-base ps-mono font-semibold text-[var(--ps-ink)] tabular-nums mt-0.5">
                                  {graphLayout.edges.length}
                                </div>
                              </div>
                              <div className="p-2.5 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                                <div className="text-[10.5px] text-[var(--ps-ink-muted)]">
                                  Nodes (N)
                                </div>
                                <div className="text-base ps-mono font-semibold text-[var(--ps-ink)] tabular-nums mt-0.5">
                                  {graphLayout.nodes.length}
                                </div>
                              </div>
                              <div className="p-2.5 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] text-center">
                                <div className="text-[10.5px] text-[var(--ps-ink-muted)]">
                                  Exits (P)
                                </div>
                                <div className="text-base ps-mono font-semibold text-[var(--ps-ink)] tabular-nums mt-0.5">
                                  1
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* QA & Testing Insights Card */}
                          <div className="rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)] p-4">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ps-ink)] mb-3 pb-2 border-b border-[var(--ps-line)]">
                              <ShieldCheck
                                size={13}
                                className="text-[var(--ps-ink-muted)]"
                              />
                              <span>QA & testing guidance</span>
                            </div>

                            <div className="space-y-2.5 text-xs">
                              <div className="flex items-start gap-2.5 text-[var(--ps-ink-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--ps-cobalt)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--ps-ink)] font-medium">
                                    Basis path coverage:
                                  </strong>{" "}
                                  Requires at least{" "}
                                  <span className="ps-mono font-medium text-[var(--ps-ink)]">
                                    {ccVal} independent test cases
                                  </span>{" "}
                                  to achieve 100% path coverage.
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5 text-[var(--ps-ink-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--ps-ink-muted)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--ps-ink)] font-medium">
                                    Decision points:
                                  </strong>{" "}
                                  Detected{" "}
                                  <span className="ps-mono font-medium text-[var(--ps-ink)]">
                                    {Math.max(0, ccVal - 1)} conditional
                                    branches
                                  </span>{" "}
                                  (if, switch, loop, ternary).
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5 text-[var(--ps-ink-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--ps-ink-muted)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--ps-ink)] font-medium">
                                    Recommendation:
                                  </strong>{" "}
                                  {meta.recommendation}
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
